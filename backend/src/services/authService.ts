import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { redis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';
import { sha256, generateJti } from '../utils/crypto.js';
import type { AccessPayload, RefreshPayload } from '../types/auth.js';

const ACCESS_EXP = env.ACCESS_TOKEN_EXPIRY;
const REFRESH_EXP = env.REFRESH_TOKEN_EXPIRY;

function signAccess(userId: string, email: string): { token: string; jti: string } {
  const jti = generateJti();
  const token = jwt.sign({ userId, email, jti } as Omit<AccessPayload, 'iat' | 'exp'>, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_EXP,
  } as any);
  return { token, jti };
}

function signRefresh(userId: string): { token: string; jti: string } {
  const jti = generateJti();
  const token = jwt.sign({ userId, jti } as Omit<RefreshPayload, 'iat' | 'exp'>, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_EXP,
  } as any);
  return { token, jti };
}

export const register = async (email: string, password: string, username: string, ip?: string, userAgent?: string) => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new AppError('Email already registered', 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email: email.toLowerCase(), username, passwordHash });

  const { token: accessToken } = signAccess(user._id.toString(), user.email);
  const { token: refreshToken, jti } = signRefresh(user._id.toString());

  await RefreshToken.create({
    userId: user._id,
    jti,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ip,
    userAgent,
  });
  await redis.set(`refresh:${jti}`, '1', 'EX', 7 * 86400);

  return { user, accessToken, refreshToken };
};

export const login = async (email: string, password: string, ip?: string, userAgent?: string) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new AppError('Invalid credentials', 401);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError('Invalid credentials', 401);

  const { token: accessToken } = signAccess(user._id.toString(), user.email);
  const { token: refreshToken, jti } = signRefresh(user._id.toString());

  await RefreshToken.create({
    userId: user._id,
    jti,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ip,
    userAgent,
  });
  await redis.set(`refresh:${jti}`, '1', 'EX', 7 * 86400);

  return { user, accessToken, refreshToken };
};

export const refresh = async (rawToken: string, ip?: string, userAgent?: string) => {
  let payload: RefreshPayload;
  try {
    payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as RefreshPayload;
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const record = await RefreshToken.findOne({ jti: payload.jti, userId: payload.userId });
  if (!record || record.revokedAt) {
    // reuse detection -> revoke all
    await RefreshToken.updateMany({ userId: payload.userId, revokedAt: null }, { revokedAt: new Date() });
    const keys = await redis.keys(`refresh:*`);
    // narrow cleanup is optional; we just delete family
    if (keys.length) {
      // best-effort: delete all refresh keys for user? We store per jti, so we need to find them
      // Instead, we rely on DB revocation as source of truth
    }
    throw new AppError('Refresh reuse detected - all tokens revoked', 401);
  }

  // verify hash matches (prevent token substitution)
  if (record.tokenHash !== sha256(rawToken)) {
    throw new AppError('Refresh token mismatch', 401);
  }

  const user = await User.findById(payload.userId);
  if (!user) throw new AppError('User not found', 401);

  // rotate
  const { token: newAccessToken } = signAccess(user._id.toString(), user.email);
  const { token: newRefreshToken, jti: newJti } = signRefresh(user._id.toString());

  record.revokedAt = new Date();
  record.replacedBy = newJti;
  await record.save();
  await redis.del(`refresh:${payload.jti}`);

  await RefreshToken.create({
    userId: user._id,
    jti: newJti,
    tokenHash: sha256(newRefreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ip,
    userAgent,
  });
  await redis.set(`refresh:${newJti}`, '1', 'EX', 7 * 86400);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

export const logout = async (rawToken: string): Promise<void> => {
  try {
    const payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as RefreshPayload;
    const record = await RefreshToken.findOne({ jti: payload.jti });
    if (record && !record.revokedAt) {
      record.revokedAt = new Date();
      await record.save();
    }
    await redis.del(`refresh:${payload.jti}`);
  } catch {
    // ignore invalid token on logout
  }
};

export const logoutAll = async (userId: string): Promise<void> => {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  // delete redis keys for this user family: we stored per jti without user prefix, so scan
  const keys = await redis.keys('refresh:*');
  if (keys.length) {
    // We can't know which belong to user without extra index; for simplicity, we fetch DB jtis and delete
    const tokens = await RefreshToken.find({ userId }).select('jti');
    const pipeline = redis.pipeline();
    for (const t of tokens) pipeline.del(`refresh:${t.jti}`);
    await pipeline.exec();
  }
};
