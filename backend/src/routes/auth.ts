import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authenticateAccessToken } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use(authRateLimiter);

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/logout-all', authenticateAccessToken, authController.logoutAll);

export default router;
