import { generateAccessToken } from "../../src/lib/tokens";

export function generateToken(user: { id: string; tier: string }): string {
  return generateAccessToken(user);
}
