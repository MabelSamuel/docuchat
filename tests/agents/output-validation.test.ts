import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../../src/agents/executor";
import { openaiBreaker } from "../../src/lib/http/openai.breaker";
import type * as AgentMocks from "./helpers/agent-mocks";
import { createMockLLM } from "./helpers/mock-llm";

vi.mock("../../src/lib/http/openai.breaker", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).openaiBreakerMock);
vi.mock("../../src/mcp/client", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpClientMock);
vi.mock("../../src/services/mcp.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).mcpServiceMock);
vi.mock("../../src/services/search.service", async () => (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).searchServiceMock);

const agentOptions = { userId: "user-123", correlationId: "agent-test" };

describe("Agent Output Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured response with required fields", async () => {
    const mockLLM = createMockLLM([
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "upload limit" }
        }
      },
      {
        textResponse: "The upload limit is 10MB."
      }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "What is the upload limit?"
    });

    // Structural validation, not content validation
    expect(result).toHaveProperty("answer");
    expect(result).toHaveProperty("sources");
    expect(result).toHaveProperty("iterations");
    expect(result).toHaveProperty("confidence");
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(result.confidence);
  });

  it("includes source references when tools were used", async () => {
    const mockLLM = createMockLLM([
      {
        toolCall: {
          name: "search_documents",
          arguments: { query: "pricing" }
        }
      },
      {
        toolCall: {
          name: "final_answer",
          arguments: {
            answer: "Pricing is $29/month for Pro.",
            sources: ["Product Spec"],
            confidence: "high"
          }
        }
      }
    ]);
    vi.mocked(openaiBreaker.fire).mockImplementation(mockLLM);

    const result = await runAgent({
      ...agentOptions,
      question: "What is the pricing?"
    });

    // If the agent used search, it must cite sources
    const toolsUsed = result.trace.filter(s => s.tool).map(s => s.tool);
    expect(toolsUsed).toContain("search_documents");
    expect(result.sources.length).toBeGreaterThan(0);
  });
});
