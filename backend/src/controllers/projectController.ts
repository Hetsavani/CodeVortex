import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Project } from '../models/Project.js';
import { File } from '../models/File.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  language: z.string().optional(),
});

export const listProjects = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projects = await Project.find({ userId: req.user!.id }).sort({ updatedAt: -1 });
    res.json(projects);
  } catch (err) {
    next(err);
  }
};

export const createProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, description, language } = createSchema.parse(req.body);
    const project = await Project.create({ userId: req.user!.id, name, description, language });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
};

export const getProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project || project.userId.toString() !== req.user!.id) throw new AppError('Project not found', 404);
    res.json(project);
  } catch (err) {
    next(err);
  }
};

export const deleteProject = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project || project.userId.toString() !== req.user!.id) throw new AppError('Project not found', 404);
    await File.deleteMany({ projectId: project._id });
    await project.deleteOne();
    res.json({ message: 'Project deleted' });
  } catch (err) {
    next(err);
  }
};
