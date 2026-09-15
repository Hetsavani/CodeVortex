import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  GEMINI_API_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  ALLOWED_ORIGIN: z.string().default('http://localhost:5173'),
  SENTRY_DSN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
