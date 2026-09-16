import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { RootState } from '@/store';
import { logout } from '@/store/authSlice';
import FileExplorer from '@/components/FileExplorer';
import EditorPanel from '@/components/EditorPanel';
import OutputPanel from '@/components/OutputPanel';
import TerminalPanel from '@/components/TerminalPanel';
import AIChatPanel from '@/components/AIChatPanel';
import Logo from '@/components/landing/Logo';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { LogOut, User, ChevronDown, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function IDE(): JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ _id: string; name: string }>>([]);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output'>('output');
  const [showAI, setShowAI] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const { accessToken, user } = useSelector((s: RootState) => s.auth);
  const { theme, toggle } = useTheme();
  const dispatch = useDispatch();
  const nav = useNavigate();

  const loadProjects = async (): Promise<void> => {
    const res = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const data = await res.json();
      setProjects(data);
      if (data.length && !projectId) setProjectId(data[0]._id);
    }
  };

  const createProject = async (): Promise<void> => {
    const name = prompt('Project name');
    if (!name) return;
    const res = await fetch(`${API_URL}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name }) });
    if (res.ok) loadProjects();
  };

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="h-6 w-px bg-border" />
          <select value={projectId || ''} onChange={(e) => setProjectId(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm">
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={createProject}>
            New Project
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAI(!showAI)}>
            {showAI ? 'Hide AI' : 'Show AI'}
          </Button>
          <div className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border px-2 py-1 text-sm hover:bg-muted transition-colors"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500 text-white text-xs font-semibold">
                {(user?.username?.[0] || user?.email?.[0] || 'U').toUpperCase()}
              </span>
              <span className="hidden sm:block max-w-[120px] truncate text-xs">{user?.username || user?.email || 'Profile'}</span>
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
            </button>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border bg-card shadow-lg">
                  <div className="border-b px-3 py-2">
                    <p className="text-sm font-medium truncate">{user?.username || 'User'}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <div className="p-1">
                    <button
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted text-left"
                    >
                      <User className="h-4 w-4" /> Profile
                    </button>
                    <button
                      onClick={() => {
                        toggle();
                      }}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted text-left"
                    >
                      <span className="flex items-center gap-2">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                      <span className="text-xs text-muted-foreground">{theme === 'dark' ? 'Dark' : 'Light'}</span>
                    </button>
                    <div className="my-1 border-t" />
                    <button
                      onClick={async () => {
                        setProfileOpen(false);
                        await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
                        dispatch(logout());
                        nav('/login');
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-destructive/10 text-destructive text-left"
                    >
                      <LogOut className="h-4 w-4" /> Logout
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <PanelGroup direction="horizontal" autoSaveId="codevortex-ide-horizontal" className="flex-1">
        <Panel defaultSize={18} minSize={12} maxSize={32} collapsible collapsedSize={0} id="sidebar">
          <FileExplorer projectId={projectId} />
        </Panel>
        <PanelResizeHandle className="group flex w-2 items-center justify-center bg-transparent outline-none">
          <div className="h-full w-px bg-border group-hover:bg-cyan-500 group-data-[resize-handle-state=drag]:bg-cyan-500 transition-colors" />
        </PanelResizeHandle>
        <Panel defaultSize={showAI ? 60 : 82} id="center">
          <PanelGroup direction="vertical" autoSaveId="codevortex-ide-vertical">
            <Panel defaultSize={65} minSize={25} id="editor">
              <EditorPanel />
            </Panel>
            <PanelResizeHandle className="group flex h-2 items-center justify-center bg-transparent outline-none">
              <div className="h-px w-full bg-border group-hover:bg-cyan-500 group-data-[resize-handle-state=drag]:bg-cyan-500 transition-colors" />
            </PanelResizeHandle>
            <Panel defaultSize={35} minSize={15} collapsible collapsedSize={0} id="bottom">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1">
                  <button onClick={() => setBottomTab('output')} className={`px-3 py-1 text-xs rounded ${bottomTab === 'output' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
                    Output
                  </button>
                  <button onClick={() => setBottomTab('terminal')} className={`px-3 py-1 text-xs rounded ${bottomTab === 'terminal' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
                    Terminal
                  </button>
                  <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Enter to run</span>
                </div>
                <div className="flex-1 overflow-hidden bg-background">{bottomTab === 'terminal' ? <TerminalPanel /> : <OutputPanel />}</div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        {showAI && (
          <>
            <PanelResizeHandle className="group flex w-2 items-center justify-center bg-transparent outline-none">
              <div className="h-full w-px bg-border group-hover:bg-cyan-500 group-data-[resize-handle-state=drag]:bg-cyan-500 transition-colors" />
            </PanelResizeHandle>
            <Panel defaultSize={22} minSize={15} maxSize={40} collapsible collapsedSize={0} id="ai">
              <AIChatPanel />
            </Panel>
          </>
        )}
      </PanelGroup>

      <footer className="flex h-6 items-center justify-between border-t bg-card px-3 text-[11px] text-muted-foreground">
        <span>CodeVortex</span>
        <span>{projectId ? 'Ready' : 'Select a project'}</span>
      </footer>
    </div>
  );
}
