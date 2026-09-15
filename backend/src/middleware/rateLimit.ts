import rateLimit from 'express-rate-limit';
import { redis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many authentication attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const checkUserRateLimit = async (
  userId: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<void> => {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rate:${endpoint}:${userId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > limit) {
    throw new AppError(`${endpoint} limit exceeded: ${limit} per ${windowSeconds}s`, 429);
  }
};

export const executionRateLimitMiddleware = async (
  req: { user?: { id: string } },
  _res: unknown,
  next: (err?: unknown) => void
): Promise<void> => {
  try {
    if (req.user?.id) {
      await checkUserRateLimit(req.user.id, 'exec', 30, 3600);
    }
    next();
  } catch (err) {
    next(err);
  }
};
