const DANGEROUS_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/gi,
  /disregard (all )?(previous|prior|above)/gi,
  /you are now/gi,
  /pretend (you are|to be)/gi,
  /system prompt:/gi,
  /new instructions:/gi,
];

export function detectPromptInjection(input: string): {
  isSuspicious: boolean;
  sanitized: string;
} {
  let sanitized = input;
  let isSuspicious = false;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      isSuspicious = true;
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  }

  return { isSuspicious, sanitized };
}
