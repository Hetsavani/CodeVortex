import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '@/store';
import { updateTabContent, markSaved } from '@/store/editorSlice';
import { useDebouncedCallback } from 'use-debounce';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function EditorPanel(): JSX.Element {
  const dispatch = useDispatch();
  const { tabs, activeTabId } = useSelector((s: RootState) => s.editor);
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const debouncedSave = useDebouncedCallback(async (id: string, content: string) => {
    if (!activeTab) return;
    try {
      // fileId is id; we use /api/files/:id/content
      await fetch(`${API_URL}/api/files/${id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content }),
      });
      dispatch(markSaved(id));
      toast.success('Saved', { duration: 1000 });
    } catch {
      toast.error('Autosave failed');
    }
  }, 2000);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTabId) return;
      const content = value || '';
      dispatch(updateTabContent({ id: activeTabId, content }));
      debouncedSave(activeTabId, content);
    },
    [activeTabId, dispatch, debouncedSave]
  );

  if (!activeTab) {
    return <div className="flex h-full items-center justify-center text-gray-500">No file open</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b bg-[#1e1e1e] px-2 py-1 text-sm text-gray-300">
        {tabs.map((t) => (
          <span key={t.id} className={t.id === activeTabId ? 'text-white' : ''}>
            {t.path} {t.isDirty ? '●' : ''}
          </span>
        ))}
      </div>
      <div className="flex-1">
        <Editor height="100%" language={activeTab.language} value={activeTab.content} onChange={handleChange} theme="vs-dark" />
      </div>
    </div>
  );
}
