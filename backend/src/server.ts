import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import type { AccessPayload } from './types/auth.js';
import { connectDB } from './config/db.js';
import { redis } from './config/redis.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalRateLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import fileRoutes from './routes/files.js';
import executionRoutes from './routes/execution.js';
import aiRoutes from './routes/ai.js';
import * as executionService from './services/executionService.js';
import * as terminalService from './services/terminalService.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: env.ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(generalRateLimiter);

app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  try {
    await mongoose.connection.db!.admin().ping();
    checks.mongodb = 'ok';
  } catch {
    checks.mongodb = 'error';
  }
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }
  checks.docker = 'ok'; // best-effort, not blocking
  const allHealthy = Object.values(checks).every((v) => v === 'ok');
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});
app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));
app.get('/health/ready', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = redis.status === 'ready';
  if (mongoOk && redisOk) res.json({ status: 'ready' });
  else res.status(503).json({ status: 'not ready', mongo: mongoOk ? 'ok' : 'error', redis: redisOk ? 'ok' : 'error' });
});
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.end('# metrics placeholder\n');
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/execute', executionRoutes);
app.use('/api/ai', aiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: env.ALLOWED_ORIGIN, credentials: true } });

io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
    (socket as any).userId = payload.userId;
    (socket as any).email = payload.email;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket as any).userId as string;
  logger.info({ userId }, 'socket connected');

  // Execution: streaming
  socket.on('exec:start', async (payload: { language: string; code: string; input?: string; projectId?: string; idempotencyKey?: string }) => {
    const processId = uuidv4();
    socket.join(`exec:${processId}`);
    socket.emit('exec:started', { processId });

    // optional idempotency
    if (payload.idempotencyKey) {
      const cached = await redis.get(`idem:exec:${payload.idempotencyKey}`);
      if (cached) {
        socket.emit('exec:done', JSON.parse(cached));
        return;
      }
    }

    try {
      const { exitCode, duration } = await executionService.execCodeStreaming(
        {
          language: payload.language,
          code: payload.code,
          input: payload.input,
          userId,
          projectId: payload.projectId,
          processId,
        },
        (event, data) => {
          io.to(`exec:${processId}`).emit(event, data);
          // also emit directly to sender if not in room yet
          socket.emit(event, data);
        }
      );
      const donePayload = { processId, exitCode, duration };
      io.to(`exec:${processId}`).emit('exec:done', donePayload);
      socket.emit('exec:done', donePayload);
      if (payload.idempotencyKey) {
        await redis.set(`idem:exec:${payload.idempotencyKey}`, JSON.stringify(donePayload), 'EX', 300);
      }
    } catch (err: any) {
      logger.error({ err, processId }, 'exec failed');
      const msg = err.message || 'Execution failed';
      io.to(`exec:${processId}`).emit('exec:error', { processId, message: msg });
      socket.emit('exec:error', { processId, message: msg });
    }
  });

  socket.on('exec:kill', async (payload: { processId: string }) => {
    try {
      await executionService.killProcess(payload.processId);
      io.to(`exec:${payload.processId}`).emit('exec:done', { processId: payload.processId, exitCode: -1 });
      socket.emit('exec:done', { processId: payload.processId, exitCode: -1 });
    } catch (err: any) {
      socket.emit('exec:error', { message: err.message });
    }
  });

  socket.on('exec:reconnect', async (payload: { processId: string }) => {
    const state = await executionService.getProcessState(payload.processId);
    if (!state) {
      socket.emit('exec:error', { message: 'Session expired' });
      return;
    }
    const buffer = await executionService.getBufferedOutput(payload.processId);
    for (const chunk of buffer) {
      socket.emit('exec:output', { processId: payload.processId, ...chunk });
    }
    if (state.status === 'running') {
      socket.join(`exec:${payload.processId}`);
    } else {
      socket.emit('exec:done', { processId: payload.processId, exitCode: state.exitCode });
    }
  });

  // Terminal PTY
  socket.on('term:start', (payload: { projectId?: string; cols?: number; rows?: number }) => {
    try {
      const sessionId = terminalService.createTerminal(
        userId,
        payload.projectId,
        payload.cols || 80,
        payload.rows || 24,
        (data) => socket.emit('term:output', { sessionId, data }),
        () => socket.emit('term:closed', { sessionId })
      );
      socket.emit('term:ready', { sessionId });
      // store sessionId on socket for cleanup
      (socket as any).terminalSessions = (socket as any).terminalSessions || [];
      (socket as any).terminalSessions.push(sessionId);
    } catch (err: any) {
      socket.emit('term:closed', { message: err.message });
    }
  });

  socket.on('term:input', (payload: { sessionId: string; data: string }) => {
    try {
      terminalService.writeToTerminal(payload.sessionId, payload.data);
    } catch {}
  });

  socket.on('term:resize', (payload: { sessionId: string; cols: number; rows: number }) => {
    try {
      terminalService.resizeTerminal(payload.sessionId, payload.cols, payload.rows);
    } catch {}
  });

  socket.on('term:stop', (payload: { sessionId: string }) => {
    terminalService.killTerminal(payload.sessionId);
  });

  socket.on('disconnect', () => {
    logger.info({ userId }, 'socket disconnected');
    // don't kill all terminals on disconnect; keep them alive for reconnect (2hr TTL)
    // Optionally clean up if needed: terminalService.cleanupUserTerminals(userId);
  });
});

const start = async (): Promise<void> => {
  httpServer.listen(env.PORT, () => logger.info(`API listening on ${env.PORT}`));

  // connect DB async without blocking server start
  connectDB().catch((err) => logger.warn({ err }, 'DB connect failed, continuing'));

  // best-effort redis connect - already auto-connects, just ensure
  if (redis.status !== 'ready' && redis.status !== 'connecting') {
    redis.connect().catch(() => logger.warn('Redis connect failed, retrying'));
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  httpServer.close(() => process.exit(0));
});

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app, httpServer, io };
