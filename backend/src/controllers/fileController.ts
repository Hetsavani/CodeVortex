import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { File } from '../models/File.js';
import { Project } from '../models/Project.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

const isValidPath = (p: string): boolean => /^[a-zA-Z0-9_\-./]+$/.test(p) && !p.includes('..');

const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cc: 'cpp',
    cxx: 'cpp',
    go: 'go',
    rs: 'rust',
    html: 'html',
    css: 'css',
    json: 'json',
    sh: 'shell',
    md: 'markdown',
  };
  return map[ext || ''] || 'plaintext';
};

const createSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(512 * 1024).optional().default(''),
  isFolder: z.boolean().optional().default(false),
  language: z.string().optional(),
});

const updateContentSchema = z.object({
  content: z.string().max(512 * 1024),
});

export const listFiles = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = req.params.projectId;
    const project = await Project.findById(projectId);
    if (!project || project.userId.toString() !== req.user!.id) throw new AppError('Project not found', 404);
    const files = await File.find({ projectId }).sort({ path: 1 });
    res.json(files);
  } catch (err) {
    next(err);
  }
};

export const createFile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = req.params.projectId;
    const project = await Project.findById(projectId);
    if (!project || project.userId.toString() !== req.user!.id) throw new AppError('Project not found', 404);
    const { path, content, isFolder, language } = createSchema.parse(req.body);
    if (!isValidPath(path)) throw new AppError('Invalid path', 400);
    const name = path.split('/').pop() || path;
    const size = Buffer.byteLength(content || '', 'utf8');
    const inferred = isFolder ? 'plaintext' : getLanguageFromPath(path);
    const finalLanguage = !language || language === 'plaintext' ? inferred : language;
    const file = await File.create({
      projectId,
      userId: req.user!.id,
      path,
      name,
      language: finalLanguage,
      content: isFolder ? '' : content,
      size,
      isFolder,
    });
    res.status(201).json(file);
  } catch (err: any) {
    if (err?.code === 11000) {
      next(new AppError('File already exists at this path', 409));
      return;
    }
    next(err);
  }
};

export const getFile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = await File.findById(req.params.id);
    if (!file || file.userId.toString() !== req.user!.id) throw new AppError('File not found', 404);
    res.json(file);
  } catch (err) {
    next(err);
  }
};

export const updateFileContent = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { content } = updateContentSchema.parse(req.body);
    const file = await File.findById(req.params.id);
    if (!file || file.userId.toString() !== req.user!.id) throw new AppError('File not found', 404);
    if (file.isFolder) throw new AppError('Cannot update folder content', 400);
    file.content = content;
    file.size = Buffer.byteLength(content, 'utf8');
    await file.save();
    res.json(file);
  } catch (err) {
    next(err);
  }
};

export const deleteFile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = await File.findById(req.params.id);
    if (!file || file.userId.toString() !== req.user!.id) throw new AppError('File not found', 404);
    await file.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
};

export const getFileByPath = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = req.params.projectId;
    const filePath = (req.query.path as string) || '';
    const project = await Project.findById(projectId);
    if (!project || project.userId.toString() !== req.user!.id) throw new AppError('Project not found', 404);
    const file = await File.findOne({ projectId, path: filePath });
    if (!file) throw new AppError('File not found', 404);
    res.json(file);
  } catch (err) {
    next(err);
  }
};
