import type { MCPRequest, MCPResponse } from "../../src/services/mcp.service";

export const NOT_FOUND_ANSWER = "That information is not found in your documents.";

// Stand-in for mcpComplete. generateRAGResponse opens the final user message
// with "No relevant context" when retrieval came back empty; a model following
// RAG_SYSTEM_PROMPT refuses there, so the mock does too. Otherwise it answers.
export async function mockMcpComplete(request: MCPRequest): Promise<MCPResponse> {
  const prompt = request.messages.at(-1)?.content ?? "";
  const content = prompt.startsWith("No relevant context")
    ? NOT_FOUND_ANSWER
    : "Based on the document, the upload limit is 10MB for free tier.";

  return {
    content,
    model: "mock-model",
    promptVersion: "test",
    tokensUsed: { prompt: 150, completion: 40, total: 190 },
    costUsd: 0.0001,
    latencyMs: 1,
    fallbackUsed: false
  };
}
