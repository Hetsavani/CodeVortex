import { Router } from 'express';
import { authenticateAccessToken } from '../middleware/auth.js';
import * as aiController from '../controllers/aiController.js';

const router = Router();

router.use(authenticateAccessToken);

router.post('/chat', aiController.chat);
router.post('/ocr', aiController.ocr);

export default router;
