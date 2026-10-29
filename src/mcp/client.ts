import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cacheRedis } from '../lib/cache';
import { logger } from '../lib/logger';
import { mcpToolCalls, mcpToolDuration } from '../lib/metrics';
import { detectPromptInjection } from '../lib/promptSanitizer';
import { auditToolCall } from '../services/mcp.service';
import {
  EXTERNAL_MCP_SERVERS,
  type ExternalMCPServerConfig,
} from '../config/mcp-servers';

export interface ExternalTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
  // Stored for execution; stripped before schemas go to OpenAI
  _mcpClient: Client;
  _mcpToolName: string;
  _mcpServer: ExternalMCPServerConfig;
}

export async function createMCPClient(
  serverUrl: string,
  timeoutMs: number
) {
  const client = new Client({
    name: 'docuchat-agent',
    version: '1.0.0',
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl)
  );

  await client.connect(transport, { timeout: timeoutMs });

  return client;
}

// Discover tools from the explicitly configured servers only
export async function discoverExternalTools(): Promise<ExternalTool[]> {
  const servers = EXTERNAL_MCP_SERVERS.filter(
    s => s.url && s.allowedTools.length > 0
  );
  const results = await Promise.all(servers.map(discoverServerTools));
  return results.flat();
}

// Discovery opens one client per server; call this once the agent run is over
export async function closeExternalClients(tools: ExternalTool[]): Promise<void> {
  const clients = new Set(tools.map(t => t._mcpClient));
  await Promise.all([...clients].map(client =>
    client.close().catch((error) => {
      logger.warn('Failed to close MCP client', {
        error: (error as Error).message,
      });
    })
  ));
}

async function discoverServerTools(
  server: ExternalMCPServerConfig
): Promise<ExternalTool[]> {
  try {
    const client = await createMCPClient(server.url!, server.timeoutMs);
    const { tools } = await client.listTools(undefined, { timeout: server.timeoutMs });

    // Never pass every discovered tool to the model, only the allowlisted ones
    const allowed = tools.filter(t => server.allowedTools.includes(t.name));
    const dropped = tools.filter(t => !server.allowedTools.includes(t.name));

    logger.info('Discovered MCP tools', {
      server: server.name,
      allowed: allowed.map(t => t.name),
      dropped: dropped.map(t => t.name),
    });

    // Convert MCP tool schemas to OpenAI function format
    // so our agent executor can use them
    return allowed.map(tool => {
      // Descriptions go into the prompt too, so they get the injection filter
      const description = detectPromptInjection(tool.description || '');
      if (description.isSuspicious) {
        logger.warn('Prompt injection filtered from MCP tool description', {
          server: server.name,
          tool: tool.name,
        });
      }

      return {
        type: 'function' as const,
        function: {
          name: `mcp_${server.name}_${tool.name}`,
          description: description.sanitized,
          parameters: tool.inputSchema,
        },
        _mcpClient: client,
        _mcpToolName: tool.name,
        _mcpServer: server,
      };
    });
  } catch (error) {
    logger.error('Failed to discover MCP tools', {
      server: server.name,
      error: (error as Error).message,
    });
    return [];
  }
}

// Fixed one-minute window counter; returns the call count in the current window
async function countCall(key: string): Promise<number> {
  const calls = await cacheRedis.incr(key);
  if (calls === 1) {
    await cacheRedis.expire(key, 60);
  }
  return calls;
}

// The per-user limit stops one user from starving everyone else; the per-server
// limit protects the external server's quota like any third-party API
async function enforceOutboundRateLimit(
  server: ExternalMCPServerConfig,
  userId: string
): Promise<void> {
  const userCalls = await countCall(`rl:mcp-out:${server.name}:user:${userId}`);
  if (userCalls > server.maxCallsPerUserPerMinute) {
    throw new Error(`Rate limit reached for MCP server "${server.name}". Please slow down.`);
  }

  const serverCalls = await countCall(`rl:mcp-out:${server.name}`);
  if (serverCalls > server.maxCallsPerMinute) {
    throw new Error(`Rate limit reached for MCP server "${server.name}"`);
  }
}

export async function callExternalTool(
  tool: ExternalTool,
  args: Record<string, unknown>,
  ctx: { userId: string; correlationId: string }
): Promise<string> {
  const server = tool._mcpServer;
  const toolName = `${server.name}/${tool._mcpToolName}`;
  const startTime = Date.now();
  const end = mcpToolDuration.startTimer({ tool: toolName, source: 'outbound' });

  try {
    await enforceOutboundRateLimit(server, ctx.userId);

    const result = await tool._mcpClient.callTool(
      { name: tool._mcpToolName, arguments: args },
      undefined,
      { timeout: server.timeoutMs },
    );

    // Extract text content from MCP response
    const rawText = (result.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    // The result is about to be fed to the LLM: same injection filter as user input
    const filtered = detectPromptInjection(rawText);
    if (filtered.isSuspicious) {
      logger.warn('Prompt injection filtered from MCP tool result', {
        tool: toolName,
        correlationId: ctx.correlationId,
      });
    }

    if (result.isError) {
      throw new Error(filtered.sanitized.substring(0, 500));
    }

    const text = filtered.sanitized.length > server.maxResultChars
      ? filtered.sanitized.substring(0, server.maxResultChars) + '\n[truncated]'
      : filtered.sanitized;

    mcpToolCalls.inc({ tool: toolName, source: 'outbound', status: 'success' });
    await auditToolCall({
      ...ctx,
      direction: 'outbound',
      tool: toolName,
      args,
      status: 'success',
      latencyMs: Date.now() - startTime,
      output: text,
      injectionFlagged: filtered.isSuspicious,
    });

    return text;
  } catch (error) {
    // Error messages can carry server-controlled text into the prompt too
    const { sanitized: message, isSuspicious } =
      detectPromptInjection((error as Error).message);

    mcpToolCalls.inc({ tool: toolName, source: 'outbound', status: 'error' });
    await auditToolCall({
      ...ctx,
      direction: 'outbound',
      tool: toolName,
      args,
      status: 'error',
      latencyMs: Date.now() - startTime,
      output: message,
      injectionFlagged: isSuspicious,
    });

    throw new Error(message);
  } finally {
    end();
  }
}
