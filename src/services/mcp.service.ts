import { cacheGet, cacheRedis, cacheSet } from '../lib/cache';
import { AppError } from '../lib/errors';
import { openaiBreaker } from '../lib/http/openai.breaker';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export type TaskType = 'chat' | 'embedding' | 'agent' | 'summary';

export interface MCPRequest {
  taskType: TaskType;
  messages: { role: string; content: string }[];
  userId: string;
  correlationId: string;
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
}

export interface MCPResponse {
  content: string;
  toolCalls?: any[];
  model: string;
  promptVersion: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  costUsd: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

export async function mcpComplete(
  request: MCPRequest
): Promise<MCPResponse> {
  const startTime = Date.now();

  // 1. Check budget
  await enforceBudget(request.userId);

  // 2. Resolve prompt version
  const prompt = await resolvePrompt(request.taskType);

  // 3. Select model
  const model = await routeModel(request.taskType, request.messages);

  // 4. Call with fallback
  const result = await callWithFallback(model, {
    ...request,
    systemPrompt: prompt.content,
  });

  // 5. Track cost
  const costUsd = calculateCost(result.model, result.usage);
  await trackCost(request.userId, costUsd);

  // 6. Audit log
  await auditLog({
    ...request,
    model: result.model,
    promptVersion: prompt.version,
    costUsd,
    latencyMs: Date.now() - startTime,
  });


  if (request.taskType === 'chat') {
    // Track Confidence level metric
  }

  return {
    content: result.content,
    toolCalls: result.toolCalls,
    model: result.model,
    promptVersion: prompt.version,
    tokensUsed: {
      prompt: result.usage.prompt_tokens,
      completion: result.usage.completion_tokens,
      total: result.usage.total_tokens,
    },
    costUsd,
    latencyMs: Date.now() - startTime,
    fallbackUsed: result.fallbackUsed,
  };
}

async function resolvePrompt(
  taskType: TaskType
): Promise<{ content: string; version: string }> {
  // Check cache first
  const cacheKey = `prompt:${taskType}:active`;
  const cached = await cacheGet<{ content: string; version: string }>(cacheKey);
  if (cached) return cached;

  // Load from database
  const prompt = await prisma.promptTemplate.findFirst({
    where: { taskType, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!prompt) {
    throw new Error(`No active prompt for task type: ${taskType}`);
  }

  const result = { content: prompt.content, version: prompt.version };
  await cacheSet(cacheKey, result, 300); // Cache for 5 minutes
  return result;
}

interface ModelConfig {
  name: string;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  maxTokens: number;
}

const MODELS: Record<string, ModelConfig> = {
  'gpt-4o': {
    name: 'gpt-4o',
    costPerMillionInput: 2.50,
    costPerMillionOutput: 10.00,
    maxTokens: 128000,
  },
  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    costPerMillionInput: 0.15,
    costPerMillionOutput: 0.60,
    maxTokens: 128000,
  },
};

// Task type → default model mapping
const MODEL_ROUTING: Record<TaskType, string> = {
  chat: 'gpt-4o-mini',       // Simple Q&A — cheap model is fine
  embedding: 'text-embedding-3-small', // Embedding model
  agent: 'gpt-4o',            // Agents need strong reasoning
  summary: 'gpt-4o-mini',     // Summaries are straightforward
};

async function routeModel(
  taskType: TaskType,
  messages: any[]
): Promise<ModelConfig> {
  const modelName = MODEL_ROUTING[taskType];
  return MODELS[modelName] ?? MODELS['gpt-4o-mini']!;
}

const FALLBACK_CHAINS: Record<string, string[]> = {
  'gpt-4o': ['gpt-4o', 'gpt-4o-mini'],
  'gpt-4o-mini': ['gpt-4o-mini', 'gpt-4o'],
};

async function callWithFallback(
  primaryModel: ModelConfig,
  request: any
): Promise<any> {
  const chain = FALLBACK_CHAINS[primaryModel.name] || [primaryModel.name];

  for (let i = 0; i < chain.length; i++) {
    const modelName = chain[i];
    const isFallback = i > 0;

    try {
      const response = await openaiBreaker.fire('/chat/completions', {
        model: modelName,
        messages: [
          { role: 'system', content: request.systemPrompt },
          ...request.messages,
        ],
        tools: request.tools,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 1500,
      });

      if (isFallback) {
        logger.warn('Fallback model used', {
          correlationId: request.correlationId,
          primary: primaryModel.name,
          fallback: modelName,
        });
      }

      return {
        content: response.data.choices[0].message.content,
        toolCalls: response.data.choices[0].message.tool_calls,
        model: modelName,
        usage: response.data.usage,
        fallbackUsed: isFallback,
      };
    } catch (error) {
      logger.error(`Model ${modelName} failed`, {
        correlationId: request.correlationId,
        error: (error as Error).message,
        isLastFallback: i === chain.length - 1,
      });

      if (i === chain.length - 1) {
        throw error; // All models failed
      }
      // Try next model in chain
    }
  }

  throw new Error('All models in fallback chain failed');
}

function calculateCost(
  modelName: string,
  usage: { prompt_tokens: number; completion_tokens: number }
): number {
  const model = MODELS[modelName];
  if (!model) return 0;

  return (
    (usage.prompt_tokens / 1_000_000) * model.costPerMillionInput +
    (usage.completion_tokens / 1_000_000) * model.costPerMillionOutput
  );
}

const MONTHLY_BUDGETS: Record<string, number> = {
  free: 1.00,
  pro: 20.00,
  enterprise: 200.00,
};

// Exported so AI work that doesn't go through mcpComplete (the agent loop,
// MCP tool calls) still hits the same cost ceiling
export async function enforceBudget(userId: string): Promise<void> {
  // Get user's tier
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true },
  });

  // Unknown tiers get the free budget rather than no limit
  const budget = MONTHLY_BUDGETS[user?.tier || 'free'] ?? MONTHLY_BUDGETS['free']!;

  // Sum this month's AI costs
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await prisma.usageLog.aggregate({
    where: {
      userId,
      action: { in: ['chat', 'agent_run', 'document_ingested'] },
      createdAt: { gte: startOfMonth },
    },
    _sum: { costUsd: true },
  });

  const spent = result._sum.costUsd || 0;

  if (spent >= budget) {
    throw new AppError(
      `Monthly AI budget exhausted ($${spent.toFixed(2)}/$${budget.toFixed(2)})`,
      429,
      'BUDGET_EXHAUSTED'
    );
  }

  // Warn at 80%
  if (spent >= budget * 0.8) {
    logger.warn('User approaching budget limit', {
      userId,
      spent: spent.toFixed(4),
      budget: budget.toFixed(2),
      percentUsed: ((spent / budget) * 100).toFixed(1),
    });
  }
}

async function trackCost(
  userId: string,
  costUsd: number
): Promise<void> {
  // Atomic increment in Redis for fast budget checks
  const monthKey = `budget:${userId}:${new Date().toISOString().slice(0, 7)}`;
  await cacheRedis.incrbyfloat(monthKey, costUsd);

  // Set expiry: auto-cleanup after the month ends
  const daysLeft = daysRemainingInMonth();
  await cacheRedis.expire(monthKey, (daysLeft + 1) * 86400);
}

function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

async function auditLog(data: {
  userId: string;
  correlationId: string;
  taskType: TaskType;
  model: string;
  promptVersion: string;
  costUsd: number;
  latencyMs: number;
  messages: any[];
  response?: string;
  fallbackUsed?: boolean;
}): Promise<void> {
  try {
    const inputText = data.messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    await prisma.aIAuditLog.create({
      data: {
        userId: data.userId,
        correlationId: data.correlationId,
        taskType: data.taskType,
        model: data.model,
        promptVersion: data.promptVersion,
        inputTokens: 0,  // Filled from usage data
        outputTokens: 0,
        costUsd: data.costUsd,
        latencyMs: data.latencyMs,
        fallbackUsed: data.fallbackUsed ?? false,
        inputSummary: inputText.substring(0, 500),
        outputSummary: (data.response || '').substring(0, 500),
      },
    });
  } catch (error) {
    // Audit logging should never crash the request
    logger.error('Audit log failed', { error });
  }
}

// Audit an MCP tool call. Reuses AIAuditLog with taskType 'mcp_tool' (calls we
// serve) or 'mcp_external_tool' (calls the agent makes to external servers) and
// the tool name in the model column, so filter on taskType for LLM-only analytics.
export async function auditToolCall(data: {
  userId: string;
  correlationId: string;
  direction: 'inbound' | 'outbound';
  tool: string;
  args: unknown;
  status: 'success' | 'error';
  latencyMs: number;
  output?: string | undefined;
  injectionFlagged?: boolean;
}): Promise<void> {
  const flag = data.injectionFlagged ? '[injection-filtered] ' : '';
  try {
    await prisma.aIAuditLog.create({
      data: {
        userId: data.userId,
        correlationId: data.correlationId,
        taskType: data.direction === 'inbound' ? 'mcp_tool' : 'mcp_external_tool',
        model: data.tool,
        promptVersion: 'n/a',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: data.latencyMs,
        inputSummary: JSON.stringify(data.args ?? {}).substring(0, 500),
        outputSummary: `[${data.status}] ${flag}${data.output ?? ''}`.substring(0, 500),
      },
    });
  } catch (error) {
    logger.error('Tool audit log failed', { error, tool: data.tool });
  }
}


