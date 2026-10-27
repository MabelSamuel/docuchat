import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  handler: (params: any, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  correlationId: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  tokensCost?: number;
}
