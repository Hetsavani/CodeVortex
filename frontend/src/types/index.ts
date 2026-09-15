export interface Tab {
  id: string;
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export interface FileNode {
  _id: string;
  path: string;
  name: string;
  isFolder: boolean;
  language: string;
  content?: string;
}

export interface Project {
  _id: string;
  name: string;
  description?: string;
}
