import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { getSocket } from '@/lib/socket';

export default function OutputPanel(): JSX.Element {
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [processId, setProcessId] = useState<string | null>(null);
  const { tabs, activeTabId } = useSelector((s: RootState) => s.editor);
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const run = (): void => {
    if (!activeTab || !accessToken) return;
    const socket = getSocket(accessToken);
    setOutput('');
    setRunning(true);
    socket.emit('exec:start', { language: activeTab.language, code: activeTab.content });
    const onOutput = (p: { chunk: string }): void => setOutput((prev) => prev + p.chunk);
    const onDone = (p: { exitCode: number }): void => {
      setOutput((prev) => prev + `\n[exit ${p.exitCode}]`);
      setRunning(false);
      cleanup();
    };
    const onError = (p: { message: string }): void => {
      setOutput((prev) => prev + `\n[error ${p.message}]`);
      setRunning(false);
      cleanup();
    };
    const onStarted = (p: { processId: string }): void => setProcessId(p.processId);
    const cleanup = (): void => {
      socket.off('exec:output', onOutput);
      socket.off('exec:done', onDone);
      socket.off('exec:error', onError);
      socket.off('exec:started', onStarted);
    };
    socket.on('exec:output', onOutput);
    socket.on('exec:done', onDone);
    socket.on('exec:error', onError);
    socket.on('exec:started', onStarted);
  };

  const kill = (): void => {
    if (!processId || !accessToken) return;
    const socket = getSocket(accessToken);
    socket.emit('exec:kill', { processId });
  };

  // cleanup on unmount
  useEffect(() => () => setRunning(false), []);

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e] text-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-700 p-2">
        <button onClick={run} disabled={running} className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50">
          {running ? 'Running...' : 'Run (Ctrl+Enter)'}
        </button>
        {running && (
          <button onClick={kill} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
            Kill
          </button>
        )}
      </div>
      <pre className="flex-1 overflow-auto p-3 text-sm whitespace-pre-wrap">{output || 'No output yet. Run a file to see results.'}</pre>
    </div>
  );
}
