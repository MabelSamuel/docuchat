import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { semanticSearch } from '../services/search.service';
import { auditToolCall, enforceBudget } from '../services/mcp.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sanitizeToolArgs } from '../lib/promptSanitizer';
import { mcpToolCalls, mcpToolDuration } from '../lib/metrics';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

interface MCPContext {
  userId: string;
  correlationId: string;
}

// The transport puts the authenticated user on req.auth; the SDK hands it
// to every handler as extra.authInfo, so context is per-request, never shared.
function getContext(extra: Extra): MCPContext {
  const ctx = extra.authInfo?.extra as Partial<MCPContext> | undefined;
  if (!ctx?.userId) {
    throw new Error('Unauthenticated MCP request');
  }
  return { userId: ctx.userId, correlationId: ctx.correlationId ?? '' };
}

type ToolResult = { content: { type: 'text'; text: string }[] };

// Wraps a tool handler with prompt-injection filtering, budget enforcement,
// structured logging, Prometheus metrics, and audit logging
async function instrumentTool<A>(
  tool: string,
  rawArgs: A,
  extra: Extra,
  options: { usesAI: boolean },
  handler: (ctx: MCPContext, args: A) => Promise<ToolResult>,
): Promise<ToolResult> {
  const ctx = getContext(extra);
  const startTime = Date.now();

  // Same prompt-injection filter as chat input: the args may end up in an LLM prompt
  const { isSuspicious, sanitized: args } = sanitizeToolArgs(rawArgs);
  if (isSuspicious) {
    logger.warn('Prompt injection filtered from MCP tool input', {
      tool,
      userId: ctx.userId,
      correlationId: ctx.correlationId,
    });
  }

  logger.info('MCP tool called', {
    tool,
    source: 'mcp',
    userId: ctx.userId,
    correlationId: ctx.correlationId,
  });

  try {
    // Same cost ceiling as the frontend and the agent
    if (options.usesAI) await enforceBudget(ctx.userId);

    const result = await handler(ctx, args);
    const latencyMs = Date.now() - startTime;

    mcpToolCalls.inc({ tool, source: 'inbound', status: 'success' });
    mcpToolDuration.observe({ tool, source: 'inbound' }, latencyMs / 1000);
    await auditToolCall({
      ...ctx,
      direction: 'inbound',
      tool,
      args,
      status: 'success',
      latencyMs,
      output: result.content[0]?.text,
      injectionFlagged: isSuspicious,
    });

    return result;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const message = (error as Error).message;

    logger.error('MCP tool failed', {
      tool,
      source: 'mcp',
      userId: ctx.userId,
      correlationId: ctx.correlationId,
      error: message,
      latencyMs,
    });
    mcpToolCalls.inc({ tool, source: 'inbound', status: 'error' });
    mcpToolDuration.observe({ tool, source: 'inbound' }, latencyMs / 1000);
    await auditToolCall({
      ...ctx,
      direction: 'inbound',
      tool,
      args,
      status: 'error',
      latencyMs,
      output: message,
      injectionFlagged: isSuspicious,
    });

    throw error;
  }
}

// Stateless transport: one server instance per request (an McpServer can
// only be connected to a single transport at a time)
export function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: 'docuchat',
    version: '1.0.0',
  });

  // Tool 1: Semantic search across documents
  mcpServer.tool(
    'search_documents',
    'Search across uploaded documents for information relevant to a query. ' +
      'Returns the most relevant text passages with similarity scores.',
    {
      query: z.string().min(3).describe('What to search for'),
      documentId: z.string().uuid().optional()
        .describe('Optional: limit search to a specific document'),
      topK: z.number().int().min(1).max(10).default(5)
        .describe('Number of results to return'),
    },
    async (rawArgs, extra) =>
      instrumentTool('search_documents', rawArgs, extra, { usesAI: true }, async ({ userId, correlationId }, args) => {
        const results = await semanticSearch({
          query: args.query,
          userId,
          documentId: args.documentId,
          topK: args.topK,
          correlationId,
        });

        logger.info('MCP tool: search_documents', {
          correlationId,
          query: args.query.substring(0, 100),
          results: results.length,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              results: results.map(r => ({
                document: r.documentTitle,
                content: r.content,
                score: r.score.toFixed(4),
                chunkIndex: r.chunkIndex,
              })),
              totalResults: results.length,
            }, null, 2),
          }],
        };
      })
  );


  // Tool 2: List user's documents
  mcpServer.tool(
    'list_documents',
    'List all uploaded documents with their processing status.',
    {},  // No parameters needed
    async (_args, extra) =>
      instrumentTool('list_documents', {}, extra, { usesAI: false }, async ({ userId }) => {
        const docs = await prisma.document.findMany({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            status: true,
            chunkCount: true,
            createdAt: true,
          },
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(docs, null, 2),
          }],
        };
      })
  );


  // Resource: document content by ID
  mcpServer.resource(
    'document-content',
    new ResourceTemplate('docuchat://documents/{documentId}/content', {
      list: async (extra) => {
        const { userId } = getContext(extra);
        const docs = await prisma.document.findMany({
          where: { userId, deletedAt: null, status: 'ready' },
          select: { id: true, title: true },
        });
        return {
          resources: docs.map(d => ({
            uri: `docuchat://documents/${d.id}/content`,
            name: d.title,
            description: `Full text content of "${d.title}"`,
            mimeType: 'text/plain',
          })),
        };
      },
    }),
    async (uri, { documentId }, extra) => {
      const { userId } = getContext(extra);
      const doc = await prisma.document.findUnique({
        where: { id: String(documentId) },
        select: { content: true, title: true, userId: true },
      });

      if (!doc || doc.userId !== userId) {
        throw new Error('Document not found');
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain',
          text: doc.content,
        }],
      };
    }
  );

  mcpServer.prompt(
    'research-query',
    'Research a topic across uploaded documents',
    { topic: z.string().describe('The topic to research') },
    ({ topic }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Please research the following topic across my uploaded documents:`,
            ``,
            `Topic: ${topic}`,
            ``,
            `Use the search_documents tool to find relevant information.`,
            `Synthesize the findings and cite which documents you found `,
            `the information in. If the documents don't contain relevant `,
            `information, say so clearly.`,
          ].join('\n'),
        },
      }],
    })
  );

  return mcpServer;
}
