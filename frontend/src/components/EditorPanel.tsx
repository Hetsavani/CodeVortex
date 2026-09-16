import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '@/store';
import { updateTabContent, markSaved, setActiveTab, closeTab } from '@/store/editorSlice';
import { useDebouncedCallback } from 'use-debounce';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import { FileText, X } from 'lucide-react';
import { SiPython, SiJavascript, SiTypescript, SiCplusplus, SiC, SiOpenjdk, SiHtml5, SiCss, SiJson, SiGo, SiRust } from 'react-icons/si';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function EditorPanel(): JSX.Element {
  const dispatch = useDispatch();
  const { theme } = useTheme();
  const { tabs, activeTabId } = useSelector((s: RootState) => s.editor);
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const debouncedSave = useDebouncedCallback(async (id: string, content: string) => {
    try {
      await fetch(`${API_URL}/api/files/${id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content }),
      });
      dispatch(markSaved(id));
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
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        <div className="text-center">
          <p className="font-medium">No file open</p>
          <p className="text-xs">Open a file from the explorer or create a new one</p>
        </div>
      </div>
    );
  }

  const getFileIcon = (path: string, language: string): JSX.Element => {
    const ext = path.split('.').pop()?.toLowerCase();
    const lang = language?.toLowerCase();
    if (ext === 'py' || lang === 'python') return <SiPython className="w-3.5 h-3.5 shrink-0" style={{ color: '#3776AB' }} />;
    if (ext === 'js' || ext === 'jsx' || lang === 'javascript') return <SiJavascript className="w-3.5 h-3.5 shrink-0" style={{ color: '#F7DF1E' }} />;
    if (ext === 'ts' || ext === 'tsx' || lang === 'typescript') return <SiTypescript className="w-3.5 h-3.5 shrink-0" style={{ color: '#3178C6' }} />;
    if (ext === 'java' || lang === 'java') return <SiOpenjdk className="w-3.5 h-3.5 shrink-0" style={{ color: '#ED8B00' }} />;
    if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || lang === 'cpp') return <SiCplusplus className="w-3.5 h-3.5 shrink-0" style={{ color: '#00599C' }} />;
    if (ext === 'c' || lang === 'c') return <SiC className="w-3.5 h-3.5 shrink-0" style={{ color: '#A97BFF' }} />;
    if (ext === 'go' || lang === 'go') return <SiGo className="w-3.5 h-3.5 shrink-0" style={{ color: '#00ADD8' }} />;
    if (ext === 'rs' || lang === 'rust') return <SiRust className="w-3.5 h-3.5 shrink-0" style={{ color: '#CE412B' }} />;
    if (ext === 'html' || lang === 'html') return <SiHtml5 className="w-3.5 h-3.5 shrink-0" style={{ color: '#E34F26' }} />;
    if (ext === 'css' || lang === 'css') return <SiCss className="w-3.5 h-3.5 shrink-0" style={{ color: '#1572B6' }} />;
    if (ext === 'json' || lang === 'json') return <SiJson className="w-3.5 h-3.5 shrink-0" style={{ color: '#CB171E' }} />;
    return <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 items-center gap-0 border-b bg-[#f3f3f3] dark:bg-[#252526] px-0 text-xs overflow-x-auto scrollbar-thin">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          return (
            <div
              key={t.id}
              onClick={() => dispatch(setActiveTab(t.id))}
              className={cn(
                'group/tab flex h-full items-center gap-2 px-3 pr-2 border-r cursor-pointer whitespace-nowrap relative shrink-0 transition-colors',
                isActive ? 'bg-white dark:bg-[#1e1e1e] text-foreground' : 'bg-transparent text-muted-foreground hover:bg-white/60 dark:hover:bg-[#2d2d2d] hover:text-foreground'
              )}
            >
              {getFileIcon(t.path, t.language)}
              <span className="truncate max-w-[140px] font-medium">{t.path.split('/').pop()}</span>
              <span className="ml-1 flex h-4 w-4 items-center justify-center">
                {t.isDirty ? (
                  <span className="h-2 w-2 rounded-full bg-yellow-500" title="Unsaved" />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(closeTab(t.id));
                    }}
                    className="opacity-0 group-hover/tab:opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
                    aria-label="Close"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
              {isActive && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-cyan-500" />}
            </div>
          );
        })}
        {tabs.length === 0 && <span className="px-3 text-xs text-muted-foreground">No tabs</span>}
      </div>
      <div className="flex-1">
        <Editor height="100%" language={activeTab.language} value={activeTab.content} onChange={handleChange} theme={theme === 'dark' ? 'vs-dark' : 'vs'} options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true }} />
      </div>
    </div>
  );
}
