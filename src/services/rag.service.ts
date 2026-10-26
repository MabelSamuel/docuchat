import { RAG_SYSTEM_PROMPT } from "../config/prompts";
import { appEvents } from "../lib/events";
import { openaiBreaker } from "../lib/http/openai.breaker";
import { logger } from "../lib/logger";
import { SearchResult } from "./search.service";


export interface AssembledContext {
  chunks: SearchResult[];
  contextText: string;
  totalTokens: number;
  citations: Citation[];
}

export interface Citation {
  index: number;         // [1], [2], etc.
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
}

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUsd: number;
  model: string;
}

const CONTEXT_TOKEN_BUDGET = 3500;

function isRedundant(
  candidate: SearchResult,
  selected: SearchResult[]
): boolean {
  return selected.some(s =>
    s.documentId === candidate.documentId &&
    Math.abs(s.chunkIndex - candidate.chunkIndex) <= 1
  );
}

export function assembleContext(
  searchResults: SearchResult[]
): AssembledContext {
  const selected: SearchResult[] = [];
  let totalTokens = 0;

  // Results are already sorted by score (descending)
  for (const result of searchResults) {
    if (isRedundant(result, selected)) continue;
    if (totalTokens + result.tokenCount > CONTEXT_TOKEN_BUDGET) {
      break; // Budget exhausted
    }
    selected.push(result);
    totalTokens += result.tokenCount;
  }

  // Build citations
  const citations: Citation[] = selected.map((chunk, i) => ({
    index: i + 1,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
  }));

  // Build the context text block
  const contextText = selected
    .map((chunk, i) =>
      `[Source ${i + 1}: "${chunk.documentTitle}", Section ${chunk.chunkIndex + 1}]\n${chunk.content}`
    )
    .join('\n\n---\n\n');

  return {
    chunks: selected,
    contextText,
    totalTokens,
    citations,
  };
}

const CHAT_MODEL = 'gpt-4o';

export async function generateRAGResponse(options: {
  question: string;
  context: AssembledContext;
  conversationHistory?: { role: string; content: string }[];
  userId: string;
  conversationId: string;
  correlationId: string;
}): Promise<RAGResponse> {
  const {
    question, context, conversationHistory,
    userId, conversationId, correlationId,
  } = options;

  // Build the messages array
  const messages: any[] = [
    { role: 'system', content: RAG_SYSTEM_PROMPT },
  ];


  // Add recent conversation history (last 5 exchanges)
  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-10); // Last 5 Q&A pairs
    messages.push(...recent);
  }

  // Add the context and question
  if (context.chunks.length > 0) {
    messages.push({
      role: 'user',
      content: [
        'Here is the relevant context from my documents:',
        '',
        context.contextText,
        '',
        '---',
        '',
        `My question: ${question}`,
      ].join('\n'),
    });
  } else {
    // No relevant context found
    messages.push({
      role: 'user',
      content: [
        'No relevant context was found in my documents for this question.',
        '',
        `My question: ${question}`,
      ].join('\n'),
    });
  }

  const startTime = Date.now();

  // Call the LLM through the circuit breaker
  const response = await openaiBreaker.fire('/chat/completions', {
    model: CHAT_MODEL,
    messages,
    temperature: 0.1,  // Low temperature for factual answers
    max_tokens: 1500,
  });

  const result = response.data;
  const answer = result.choices[0].message.content;
  const usage = result.usage;
  const duration = Date.now() - startTime;

  // Calculate cost (GPT-4o pricing)
  const costUsd =
    (usage.prompt_tokens / 1_000_000) * 2.50 +     // Input
    (usage.completion_tokens / 1_000_000) * 10.00;  // Output

  logger.info('RAG response generated', {
    correlationId,
    conversationId,
    model: CHAT_MODEL,
    contextChunks: context.chunks.length,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    costUsd: costUsd.toFixed(6),
    durationMs: duration,
  });

  // Track usage
  appEvents.emit('ai:chat-completed', {
    userId,
    conversationId,
    correlationId,
    model: CHAT_MODEL,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    costUsd,
  });

  return {
    answer,
    citations: context.citations,
    tokensUsed: {
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
      total: usage.total_tokens,
    },
    costUsd,
    model: CHAT_MODEL,
  };
}

