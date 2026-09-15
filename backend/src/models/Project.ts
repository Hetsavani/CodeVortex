import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  language?: string;
  settings: {
    executionTimeout: number;
    entryFile?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    language: { type: String },
    settings: {
      executionTimeout: { type: Number, default: 15 },
      entryFile: { type: String },
    },
  },
  { timestamps: true }
);

projectSchema.index({ userId: 1, name: 1 });

export const Project = mongoose.model<IProject>('Project', projectSchema);
