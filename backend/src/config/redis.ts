import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // log but don't crash; will retry
  console.error('Redis error', err.message);
});
redis.on('connect', () => {
  // connected
});
