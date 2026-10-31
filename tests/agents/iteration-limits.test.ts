import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../../src/agents/executor";
import { openaiBreaker } from "../../src/lib/http/openai.breaker";
import type * as AgentMocks from "./helpers/agent-mocks";
import { createMockLLM, MOCK_USAGE } from "./helpers/mock-llm";

vi.mock("../../src/lib/http/openai.breaker", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).openaiBreakerMock);
vi.mock("../../src/mcp/client", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpClientMock);
vi.mock("../../src/services/mcp.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpServiceMock);
vi.mock("../../src/services/search.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).searchServiceMock);

const agentOptions = { userId: "user-123", correlationId: "agent-test" };

describe("Agent Iteration Limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes simple search in 2 iterations or fewer", async () => {
    const mockLLM = createMockLLM([
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "upload limit" }
        }
      },
      {
        textResponse: "The upload limit is 10MB for free users."
      }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "What is the upload limit?"
    });

    expect(result.iterations).toBeLessThanOrEqual(2);
    expect(result.terminationReason).toBe("completed");
  });

  it("terminates when hitting max iterations", async () => {
    // Script an LLM that keeps calling tools forever
    const infiniteSteps = Array.from({ length: 15 }, () => ({
      toolCall: {
        name: "search_documents",
        arguments: { query: "something" }
      }
    }));

    const mockLLM = createMockLLM(infiniteSteps);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "Find everything about pricing",
      config: { maxIterations: 5 }
    });

    // Agent should stop at max, not loop forever
    expect(result.iterations).toBeLessThanOrEqual(5);
    expect(result.terminationReason).toBe("iteration_limit");
    // LLM was called at most maxIterations times
    expect(mockLLM).toHaveBeenCalledTimes(5);
  });

  it("tracks cost across iterations", async () => {
    const mockLLM = createMockLLM([
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "pricing" }
        }
      },
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "pricing tiers comparison" }
        }
      },
      {
        textResponse: "Here are the pricing details..."
      }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "Compare pricing tiers"
    });

    // Each of the 3 LLM calls is billed at gpt-4o rates
    const costPerCall =
      (MOCK_USAGE.prompt_tokens / 1_000_000) * 2.5 +
      (MOCK_USAGE.completion_tokens / 1_000_000) * 10;
    expect(result.iterations).toBe(3);
    expect(result.totalCostUsd).toBeCloseTo(costPerCall * 3, 10);
  });
});
