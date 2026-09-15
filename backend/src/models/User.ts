import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  passwordHash: string;
  googleId?: string;
  settings: {
    theme: string;
    fontSize: number;
    tabSize: number;
    autoSave: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    googleId: { type: String },
    settings: {
      theme: { type: String, default: 'vs-dark' },
      fontSize: { type: Number, default: 14 },
      tabSize: { type: Number, default: 2 },
      autoSave: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
