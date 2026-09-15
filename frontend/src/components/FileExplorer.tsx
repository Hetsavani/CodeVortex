import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { openTab } from '@/store/editorSlice';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function FileExplorer({ projectId }: { projectId: string | null }): JSX.Element {
  const [files, setFiles] = useState<Array<{ _id: string; path: string; name: string; language: string; content?: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
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

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim() || !projectId) return;
    const res = await fetch(`${API_URL}/api/files/project/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ path: newName, content: '', language: 'plaintext' }),
    });
    if (res.ok) {
      toast.success('File created');
      setNewName('');
      setCreating(false);
      load();
    } else {
      toast.error('Failed to create');
    }
  };

  const handleOpen = async (f: { _id: string; path: string; language: string }): Promise<void> => {
    const res = await fetch(`${API_URL}/api/files/${f._id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const full = await res.json();
      dispatch(openTab({ id: full._id, path: full.path, content: full.content || '', language: full.language, isDirty: false }));
    }
  };

  return (
    <div className="flex h-full flex-col border-r bg-[#fafafa] dark:bg-[#252526] dark:text-gray-200">
      <div className="flex items-center justify-between p-2 text-sm font-semibold">
        <span>Explorer</span>
        <button onClick={() => setCreating(true)} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">
          New File
        </button>
      </div>
      {creating && (
        <div className="p-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="path/to/file"
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {files.map((f) => (
          <div key={f._id} onClick={() => handleOpen(f)} className="cursor-pointer px-3 py-1 text-sm hover:bg-gray-200 dark:hover:bg-gray-700">
            {f.path}
          </div>
        ))}
      </div>
    </div>
  );
}
