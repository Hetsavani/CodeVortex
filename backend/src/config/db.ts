import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed');
    throw err;
  }
};
