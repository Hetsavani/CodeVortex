import { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { openTab } from '@/store/editorSlice';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/input';
import { Folder, File, ChevronDown, ChevronRight, FolderPlus, FilePlus, Trash2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

type FileDoc = { _id: string; path: string; language: string; isFolder?: boolean; content?: string };

function getLanguageFromPath(path: string): string {
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
}

type TreeNode = {
  __meta?: FileDoc;
  __isFolder?: boolean;
  [key: string]: TreeNode | FileDoc | boolean | undefined;
};

function buildTree(files: FileDoc[]): TreeNode {
  const root: TreeNode = {};
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let node: TreeNode = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node[part]) node[part] = {} as TreeNode;
      const child = node[part] as TreeNode;
      if (isLast) {
        child.__meta = f;
        child.__isFolder = !!f.isFolder;
      } else {
        // intermediate folders are folders
        if (child.__isFolder === undefined) child.__isFolder = true;
      }
      node = child;
    }
  }
  return root;
}

export default function FileExplorer({ projectId }: { projectId: string | null }): JSX.Element {
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({});
  const dispatch = useDispatch();
  const { accessToken } = useSelector((s: RootState) => s.auth);

  const load = async (): Promise<void> => {
    if (!projectId) return;
    const res = await fetch(`${API_URL}/api/files/project/${projectId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setFiles(await res.json());
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const tree = useMemo(() => buildTree(files), [files]);

  const togglePath = (path: string): void => setOpenPaths((prev) => ({ ...prev, [path]: !prev[path] }));

  const getFullPath = (name: string): string => (currentPath ? `${currentPath}/${name}` : name);

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim() || !projectId || !creating) return;
    const isFolder = creating === 'folder';
    const fullPath = getFullPath(newName.trim());
    const language = isFolder ? 'plaintext' : getLanguageFromPath(fullPath);
    const res = await fetch(`${API_URL}/api/files/project/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        path: fullPath,
        content: '',
        language,
        isFolder,
      }),
    });
    if (res.ok) {
      toast.success(isFolder ? 'Folder created' : 'File created');
      setNewName('');
      setCreating(null);
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'Failed to create');
    }
  };

  const handleDelete = async (meta: FileDoc, isFolder: boolean): Promise<void> => {
    if (!confirm(`Delete ${isFolder ? 'folder' : 'file'} "${meta.path}"?`)) return;
    if (!isFolder) {
      const res = await fetch(`${API_URL}/api/files/${meta._id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) {
        toast.success('Deleted');
        load();
      } else toast.error('Delete failed');
      return;
    }
    // folder: delete all files under prefix
    const prefix = meta.path;
    const toDelete = files.filter((f) => f.path === prefix || f.path.startsWith(prefix + '/'));
    for (const f of toDelete) {
      await fetch(`${API_URL}/api/files/${f._id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
    }
    toast.success('Folder deleted');
    load();
  };

  const handleOpen = async (meta: FileDoc): Promise<void> => {
    const res = await fetch(`${API_URL}/api/files/${meta._id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const full = await res.json();
      const lang = full.language && full.language !== 'plaintext' ? full.language : getLanguageFromPath(full.path);
      dispatch(openTab({ id: full._id, path: full.path, content: full.content || '', language: lang, isDirty: false }));
    }
  };

  if (!projectId) return <div className="p-4 text-sm text-muted-foreground">Select a project</div>;

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide">File Manager</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => { setCreating('folder'); setNewName(''); }} className="p-1 text-yellow-600 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded-full transition-colors" aria-label="Create new folder">
            <FolderPlus className="w-5 h-5" />
          </button>
          <button onClick={() => { setCreating('file'); setNewName(''); }} className="p-1 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full transition-colors" aria-label="Create new file">
            <FilePlus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {creating && (
        <div className="px-3 py-2 border-b bg-muted/20">
          <div className="text-[11px] text-muted-foreground mb-1">
            {creating === 'folder' ? 'New folder' : 'New file'} in <span className="font-mono">{currentPath || '/'}</span>
          </div>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreating(null);
            }}
            placeholder={creating === 'folder' ? 'myFolder' : 'main.py'}
            className="h-7 text-xs"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleCreate} className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded">Create</button>
            <button onClick={() => setCreating(null)} className="text-xs px-2 py-1 border rounded">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-2">
        {Object.keys(tree).length === 0 ? (
          <p className="text-xs text-muted-foreground px-2">No files or folders to display.</p>
        ) : (
          <FileTree
            tree={tree}
            level={0}
            path=""
            openPaths={openPaths}
            togglePath={togglePath}
            setCurrentPath={setCurrentPath}
            onOpen={handleOpen}
            onDelete={handleDelete}
            currentPath={currentPath}
          />
        )}
      </div>

      <div className="border-t p-2 text-[11px] text-muted-foreground truncate">
        {currentPath ? `/${currentPath}` : '/'}
      </div>
    </div>
  );
}

function FileTree({
  tree,
  level,
  path,
  openPaths,
  togglePath,
  setCurrentPath,
  onOpen,
  onDelete,
  currentPath,
}: {
  tree: TreeNode;
  level: number;
  path: string;
  openPaths: Record<string, boolean>;
  togglePath: (p: string) => void;
  setCurrentPath: (p: string) => void;
  onOpen: (meta: FileDoc) => void;
  onDelete: (meta: FileDoc, isFolder: boolean) => void;
  currentPath: string;
}): JSX.Element {
  if (!tree || typeof tree !== 'object') return <></>;
  return (
    <ul className={level > 0 ? 'ml-3 border-l border-muted/30 pl-1' : ''} role="tree">
      {Object.entries(tree)
        .filter(([k]) => !k.startsWith('__'))
        .sort((a, b) => {
          const av = a[1] as TreeNode;
          const bv = b[1] as TreeNode;
          const aIsFolder = !!av.__isFolder || Object.keys(av).some((k) => !k.startsWith('__'));
          const bIsFolder = !!bv.__isFolder || Object.keys(bv).some((k) => !k.startsWith('__'));
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a[0].localeCompare(b[0]);
        })
        .map(([name, value]) => (
          <FileTreeItem
            key={path ? `${path}/${name}` : name}
            name={name}
            value={value as TreeNode}
            level={level}
            path={path}
            openPaths={openPaths}
            togglePath={togglePath}
            setCurrentPath={setCurrentPath}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
    </ul>
  );
}

function FileTreeItem({
  name,
  value,
  level,
  path,
  openPaths,
  togglePath,
  setCurrentPath,
  onOpen,
  onDelete,
}: {
  name: string;
  value: TreeNode;
  level: number;
  path: string;
  openPaths: Record<string, boolean>;
  togglePath: (p: string) => void;
  setCurrentPath: (p: string) => void;
  onOpen: (meta: FileDoc) => void;
  onDelete: (meta: FileDoc, isFolder: boolean) => void;
}): JSX.Element {
  const meta = value.__meta as FileDoc | undefined;
  const hasChildren = Object.keys(value).some((k) => !k.startsWith('__'));
  const isFolder = !!value.__isFolder || hasChildren;
  const currentPath = path ? `${path}/${name}` : name;
  const isOpen = !!openPaths[currentPath];
  const isSelected = false;

  const handleClick = (): void => {
    if (isFolder) {
      togglePath(currentPath);
      setCurrentPath(currentPath);
    } else if (meta) {
      onOpen(meta);
      const parent = currentPath.split('/').slice(0, -1).join('/');
      setCurrentPath(parent);
    }
  };

  return (
    <li className="my-0.5 group" role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <div
        className={`flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted cursor-pointer ${isFolder && isOpen ? 'bg-muted/50' : ''} ${isSelected ? 'bg-primary/10' : ''}`}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
        tabIndex={0}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isFolder ? (
            isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {isFolder ? <Folder className="w-4 h-4 text-yellow-500 shrink-0" /> : <File className="w-4 h-4 text-blue-500 shrink-0" />}
          <span className="text-xs truncate">{name}</span>
        </div>
        {meta && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(meta, isFolder); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded transition-opacity"
            aria-label="Delete"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
        )}
      </div>
      {isFolder && isOpen && (
        <FileTree
          tree={value}
          level={level + 1}
          path={currentPath}
          openPaths={openPaths}
          togglePath={togglePath}
          setCurrentPath={setCurrentPath}
          onOpen={onOpen}
          onDelete={onDelete}
          currentPath={currentPath}
        />
      )}
    </li>
  );
}
