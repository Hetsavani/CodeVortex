import { Router } from 'express';
import { authenticateAccessToken } from '../middleware/auth.js';
import * as projectController from '../controllers/projectController.js';

const router = Router();

router.use(authenticateAccessToken);

router.get('/', projectController.listProjects);
router.post('/', projectController.createProject);
router.get('/:id', projectController.getProject);
router.delete('/:id', projectController.deleteProject);

export default router;
