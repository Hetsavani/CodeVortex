import mongoose, { Schema, Document } from 'mongoose';

export interface IFile extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  path: string;
  name: string;
  language: string;
  content: string;
  contentStorageKey: string | null;
  size: number;
  isFolder: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    path: { type: String, required: true },
    name: { type: String, required: true },
    language: { type: String, default: 'plaintext' },
    content: { type: String, default: '' },
    contentStorageKey: { type: String, default: null },
    size: { type: Number, default: 0 },
    isFolder: { type: Boolean, default: false },
  },
  { timestamps: true }
);

fileSchema.index({ projectId: 1, path: 1 }, { unique: true });
fileSchema.index({ projectId: 1, isFolder: 1 });

export const File = mongoose.model<IFile>('File', fileSchema);
