import mongoose, { Schema, Document } from 'mongoose';

export interface IExecutionLog extends Document {
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  fileId?: mongoose.Types.ObjectId;
  language: string;
  exitCode: number | null;
  status: string;
  durationMs: number;
  createdAt: Date;
}

const executionLogSchema = new Schema<IExecutionLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', index: true },
    language: { type: String, required: true },
    exitCode: { type: Number, default: null },
    status: { type: String, required: true }, // accepted | error | timeout | killed
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ExecutionLog = mongoose.model<IExecutionLog>('ExecutionLog', executionLogSchema);
