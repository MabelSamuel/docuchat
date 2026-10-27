import { z } from 'zod';
import { ToolDefinition } from './index';

export const finalAnswerTool: ToolDefinition = {
  name: 'final_answer',
  description:
    'Provide the final answer to the user\'s question. ' +
    'Call this when you have gathered enough information.',
  parameters: z.object({
    answer: z.string().min(1)
      .describe('The complete answer to the user\'s question'),
    sources: z.array(z.string())
      .describe('List of document names used as sources'),
    confidence: z.enum(['high', 'medium', 'low'])
      .describe('How confident you are in the answer'),
  }),
  handler: async (params) => {
    return {
      success: true,
      data: params,
    };
  },
};