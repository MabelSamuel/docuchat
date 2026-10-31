import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../../src/agents/executor";
import { openaiBreaker } from "../../src/lib/http/openai.breaker";
import { semanticSearch } from "../../src/services/search.service";
import type * as AgentMocks from "./helpers/agent-mocks";
import { createMockLLM } from "./helpers/mock-llm";

vi.mock("../../src/lib/http/openai.breaker", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).openaiBreakerMock);
vi.mock("../../src/mcp/client", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpClientMock);
vi.mock("../../src/services/mcp.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpServiceMock);
vi.mock("../../src/services/search.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).searchServiceMock);

const agentOptions = { userId: "user-123", correlationId: "agent-test" };

describe("Agent Tool Calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls search tool with user query for factual questions", async () => {
    const mockLLM = createMockLLM([
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "pricing" }
        }
      },
      {
        textResponse: "The free tier is $0 and Pro is $29/month."
      }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "What are the pricing tiers?"
    });

    // Verify the search ran once, scoped to the calling user
    expect(semanticSearch).toHaveBeenCalledTimes(1);
    expect(semanticSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "pricing",
        userId: agentOptions.userId
      })
    );

    // Its results were fed back to the model as an observation
    const observations = result.trace.filter(s => s.phase === "observe");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.tool).toBe("search_documents");
  });

  it("does not call tools for greetings", async () => {
    const mockLLM = createMockLLM([
      { textResponse: "Hello! How can I help you with your document?" }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "Hi there"
    });

    expect(semanticSearch).not.toHaveBeenCalled();
    expect(result.trace.some(s => s.tool)).toBe(false);
  });
});
