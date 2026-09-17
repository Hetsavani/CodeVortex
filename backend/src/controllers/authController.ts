import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
  username: z.string().min(2).max(30),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function parseToMs(exp: string): number {
  const m = exp.match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[unit]!;
  return n * mult;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: parseToMs(env.REFRESH_TOKEN_EXPIRY),
  });
}

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, username } = registerSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.register(
      email,
      password,
      username,
      req.ip,
      req.headers['user-agent']
    );
    setRefreshCookie(res, refreshToken);
    logger.info({ userId: user._id }, 'user registered');
    res.status(201).json({ accessToken, user: { id: user._id, email: user.email, username: user.username } });
  } catch (err) {
    next(err);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await authService.login(
      email,
      password,
      req.ip,
      req.headers['user-agent']
    );
    setRefreshCookie(res, refreshToken);
    logger.info({ userId: user._id }, 'user login');
    res.json({ accessToken, user: { id: user._id, email: user.email, username: user.username } });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const raw = req.cookies?.refreshToken as string | undefined;
    if (!raw) {
      res.status(401).json({ error: 'Missing refresh token' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    const { accessToken, refreshToken, user } = await authService.refresh(raw, req.ip, req.headers['user-agent']) as any;
    // authService.refresh currently returns {accessToken, refreshToken}, fetch user for response
    let userData = user;
    if (!userData) {
      // fallback: decode accessToken to get userId then fetch
      try {
        const jwt = await import('jsonwebtoken');
        const payload = jwt.default.verify(accessToken, process.env.JWT_ACCESS_SECRET!) as any;
        const { User } = await import('../models/User.js');
        const u = await User.findById(payload.userId);
        if (u) userData = { id: u._id, email: u.email, username: u.username };
      } catch {}
    }
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user: userData });
  } catch (err) {
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    next(err);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const raw = req.cookies?.refreshToken as string | undefined;
    if (raw) await authService.logout(raw);
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
};

export const logoutAll = async (req: Request & { user?: { id: string } }, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    await authService.logoutAll(userId);
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    res.json({ message: 'All sessions revoked' });
  } catch (err) {
    next(err);
  }
};
