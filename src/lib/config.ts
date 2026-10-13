import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file into process.env
dotenv.config();

// Define the schema: every env var your app needs
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Authentication
  JWT_SECRET: z.string().min(32,
    'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // OpenAI (needed from Week 4 onward)
  OPENAI_API_KEY: z.string().optional(),

  // Redis (needed from Week 3 onward)
  REDIS_URL: z.string().optional(),
});

// Validate process.env against the schema
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1); // Crash immediately, do not start
}

export const config = parsed.data;

// TypeScript now knows the exact shape of config:
// config.PORT        -> number (not string!)
// config.NODE_ENV    -> 'development' | 'production' | 'test'
// config.JWT_SECRET  -> string (guaranteed at least 32 chars)
// config.OPENAI_API_KEY -> string | undefined
