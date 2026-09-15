import { Router } from 'express';
import { authenticateAccessToken } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

// HTTP fallback for execution (REST) - main path is Socket.IO
// This is useful for simple cases and testing
router.use(authenticateAccessToken);

router.post('/run', async (req, res, next) => {
  try {
    const schema = z.object({
      language: z.string().min(1),
      code: z.string().min(1).max(100 * 1024),
      input: z.string().max(10 * 1024).optional(),
      projectId: z.string().optional(),
    });
    const data = schema.parse(req.body);
    // Return socket instruction - client should use socket for streaming
    res.json({ message: 'Use Socket.IO exec:start for streaming', ...data });
  } catch (err) {
    next(err);
  }
});

export default router;
