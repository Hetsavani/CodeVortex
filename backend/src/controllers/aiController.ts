import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as aiService from '../services/aiService.js';
import { AuthRequest } from '../middleware/auth.js';

const chatSchema = z.object({
  message: z.string().min(1).max(10000),
  activeFile: z
    .object({ name: z.string(), content: z.string(), language: z.string().optional() })
    .nullable()
    .optional(),
  history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
});

export const chat = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { message, activeFile, history } = chatSchema.parse(req.body);
    const userId = req.user!.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    await aiService.chatStream(userId, message, activeFile || null, history, (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      next(err);
      return;
    }
    try {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } catch {}
  }
};

const ocrSchema = z.object({
  image: z.string().min(1),
  mimeType: z.string().min(1),
});

export const ocr = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { image, mimeType } = ocrSchema.parse(req.body);
    const result = await aiService.extractCodeFromImage(req.user!.id, image, mimeType);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
