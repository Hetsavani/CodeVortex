import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err instanceof AppError ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    logger.error({ err, statusCode }, message);
  } else {
    logger.warn({ err: err.message, statusCode }, message);
  }

  res.status(statusCode).json({
    error: message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};
