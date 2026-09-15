import { Router } from 'express';
import { authenticateAccessToken } from '../middleware/auth.js';
import * as fileController from '../controllers/fileController.js';

const router = Router();

router.use(authenticateAccessToken);

router.get('/project/:projectId', fileController.listFiles);
router.post('/project/:projectId', fileController.createFile);
router.get('/by-path/:projectId', fileController.getFileByPath);
router.get('/:id', fileController.getFile);
router.put('/:id/content', fileController.updateFileContent);
router.delete('/:id', fileController.deleteFile);

export default router;
