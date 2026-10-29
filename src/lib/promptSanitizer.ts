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

// Runs detectPromptInjection over every string in a tool's arguments
export function sanitizeToolArgs<T>(args: T): { isSuspicious: boolean; sanitized: T } {
  let isSuspicious = false;

  const walk = (value: any): any => {
    if (typeof value === 'string') {
      const result = detectPromptInjection(value);
      if (result.isSuspicious) isSuspicious = true;
      return result.sanitized;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const clean: any = {};
      for (const key of Object.keys(value)) {
        clean[key] = walk(value[key]);
      }
      return clean;
    }
    return value;
  };

  const sanitized = walk(args) as T;
  return { isSuspicious, sanitized };
}
