import { config } from '../lib/config';

export interface ExternalMCPServerConfig {
  name: string;               // Namespaces tool names for the agent: mcp_<name>_<tool>
  url: string | undefined;    // Unset = server is skipped entirely
  allowedTools: string[];     // Only these discovered tools are exposed to the agent
  maxCallsPerMinute: number;  // Outbound rate limit, shared across all users
  maxCallsPerUserPerMinute: number;  // So one user can't exhaust the shared limit
  timeoutMs: number;
  maxResultChars: number;     // Longer tool results are truncated before reaching the LLM
}

// The only MCP servers DocuChat will connect to. Never add servers from
// user input or auto-discovery: anything listed here can feed text to the agent.
export const EXTERNAL_MCP_SERVERS: ExternalMCPServerConfig[] = [
  {
    name: 'external',
    url: config.EXTERNAL_MCP_URL,
    // Empty until each tool is reviewed. Discovered tools not listed here are dropped.
    allowedTools: [],
    maxCallsPerMinute: 30,
    maxCallsPerUserPerMinute: 10,
    timeoutMs: 10_000,
    maxResultChars: 8_000,
  },
];
