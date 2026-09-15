import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import type { AccessPayload } from './types/auth.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: env.ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: env.ALLOWED_ORIGIN, credentials: true } });

io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
    (socket as any).userId = payload.userId;
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  logger.info({ userId: (socket as any).userId }, 'socket connected');
  socket.on('disconnect', () => logger.info('socket disconnected'));
});

httpServer.listen(env.PORT, () => logger.info(`API listening on ${env.PORT}`));
