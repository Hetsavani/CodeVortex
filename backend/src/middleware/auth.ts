import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AccessPayload } from '../types/auth.js';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; jti: string };
}

export const authenticateAccessToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing access token' });
    return;
  }
  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
    req.user = { id: payload.userId, email: payload.email, jti: payload.jti };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
};
