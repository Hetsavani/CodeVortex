import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Toaster } from 'react-hot-toast';
import { RootState } from '@/store';
import { setCredentials, logout } from '@/store/authSlice';
import FileExplorer from '@/components/FileExplorer';
import EditorPanel from '@/components/EditorPanel';
import OutputPanel from '@/components/OutputPanel';
import TerminalPanel from '@/components/TerminalPanel';
import AIChatPanel from '@/components/AIChatPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function Login(): JSX.Element {
  const dispatch = useDispatch();
  const [email, setEmail] = useState('test@test.com');
  const [password, setPassword] = useState('password');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('tester');

  const submit = async (): Promise<void> => {
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = mode === 'login' ? { email, password } : { email, password, username };
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    const data = await res.json();
    if (data.accessToken) {
      dispatch(setCredentials({ accessToken: data.accessToken, user: data.user }));
    } else {
      alert(data.error || 'Auth failed');
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <div className="w-96 rounded border bg-white p-6 shadow">
        <h1 className="mb-4 text-xl font-bold">CodeVortex</h1>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="mb-2 w-full rounded border px-3 py-2" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" className="mb-2 w-full rounded border px-3 py-2" />
        {mode === 'register' && <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="mb-2 w-full rounded border px-3 py-2" />}
        <button onClick={submit} className="w-full rounded bg-blue-600 py-2 text-white">
          {mode === 'login' ? 'Login' : 'Register'}
        </button>
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="mt-2 text-sm text-blue-600">
          Switch to {mode === 'login' ? 'Register' : 'Login'}
        </button>
      </div>
    </div>
  );
}

function IDE(): JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ _id: string; name: string }>>([]);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output'>('terminal');
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const dispatch = useDispatch();

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
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <strong>CodeVortex</strong>
          <select value={projectId || ''} onChange={(e) => setProjectId(e.target.value)} className="rounded border px-2 py-1 text-sm">
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={createProject} className="rounded bg-gray-800 px-3 py-1 text-sm text-white">
            New Project
          </button>
        </div>
        <button
          onClick={async () => {
            await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
            dispatch(logout());
          }}
          className="text-sm text-gray-600"
        >
          Logout
        </button>
      </header>
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={20} minSize={12}>
          <FileExplorer projectId={projectId} />
        </Panel>
        <PanelResizeHandle className="w-1 bg-gray-200" />
        <Panel defaultSize={60}>
          <PanelGroup direction="vertical">
            <Panel defaultSize={65}>
              <EditorPanel />
            </Panel>
            <PanelResizeHandle className="h-1 bg-gray-200" />
            <Panel defaultSize={35} minSize={15}>
              <div className="flex h-full flex-col">
                <div className="flex border-b">
                  <button onClick={() => setBottomTab('terminal')} className={`px-4 py-1 text-sm ${bottomTab === 'terminal' ? 'border-b-2 border-blue-500 text-blue-600' : ''}`}>
                    Terminal
                  </button>
                  <button onClick={() => setBottomTab('output')} className={`px-4 py-1 text-sm ${bottomTab === 'output' ? 'border-b-2 border-blue-500 text-blue-600' : ''}`}>
                    Output
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">{bottomTab === 'terminal' ? <TerminalPanel /> : <OutputPanel />}</div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="w-1 bg-gray-200" />
        <Panel defaultSize={22} minSize={15} collapsible>
          <AIChatPanel />
        </Panel>
      </PanelGroup>
      <footer className="bg-[#007acc] px-3 py-1 text-xs text-white">CodeVortex · Ready</footer>
    </div>
  );
}

export default function App(): JSX.Element {
  const { accessToken } = useSelector((s: RootState) => s.auth);
  return (
    <>
      <Toaster />
      {accessToken ? <IDE /> : <Login />}
    </>
  );
}
