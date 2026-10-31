import { vi } from "vitest";

interface MockLLMStep {
  // What the mock LLM returns at this step
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  textResponse?: string;
}

export const MOCK_USAGE = { prompt_tokens: 100, completion_tokens: 20 };

// Scripted stand-in for openaiBreaker.fire('/chat/completions', ...).
// Returns the same axios-shaped response the agent executor reads.
export function createMockLLM(steps: MockLLMStep[]) {
  let callIndex = 0;

  return vi.fn().mockImplementation(async () => {
    // Past the script: the agent should have stopped by now
    const step = steps[callIndex] ?? { textResponse: "I have completed the task." };
    callIndex++;

    const message = step.toolCall
      ? {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: `call_${callIndex}`,
            type: "function",
            function: {
              name: step.toolCall.name,
              arguments: JSON.stringify(step.toolCall.arguments)
            }
          }]
        }
      : { role: "assistant", content: step.textResponse ?? "" };

    return { data: { usage: MOCK_USAGE, choices: [{ message }] } };
  });
}
