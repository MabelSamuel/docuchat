// Module mocks shared by the agent tests. vi.mock is hoisted per test file,
// so each file declares the mocks itself and pulls the factories from here:
//
//   vi.mock("../../src/lib/http/openai.breaker", async () =>
//     (await vi.importActual<typeof AgentMocks>("./helpers/agent-mocks")).openaiBreakerMock);
import { vi } from "vitest";

export const openaiBreakerMock = { openaiBreaker: { fire: vi.fn() } };

// No external MCP servers: the agent only sees its native tools
export const mcpClientMock = {
  discoverExternalTools: vi.fn(async () => []),
  closeExternalClients: vi.fn(async () => {}),
  callExternalTool: vi.fn()
};

export const mcpServiceMock = { enforceBudget: vi.fn(async () => {}) };

export const searchServiceMock = {
  semanticSearch: vi.fn(async () => [{
    chunkId: "chunk-pricing-1",
    documentId: "doc-123",
    documentTitle: "Product Spec",
    content: "Pricing: Free tier is $0, Pro is $29/month.",
    chunkIndex: 0,
    score: 0.91,
    tokenCount: 12
  }])
};
