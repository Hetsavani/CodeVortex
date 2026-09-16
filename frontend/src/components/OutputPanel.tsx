import { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { getSocket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/ThemeProvider';

export default function OutputPanel(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
    getSocket(accessToken).emit('exec:kill', { processId });
  };

  return (
    <div className={`flex h-full flex-col ${isDark ? 'bg-[#1e1e1e] text-gray-200' : 'bg-white text-gray-900'}`}>
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? 'border-zinc-700' : 'border-gray-200 bg-gray-50'}`}>
        <Button size="sm" onClick={run} disabled={running || !activeTab} className="h-7">
          {running ? 'Running…' : 'Run'}
        </Button>
        {running && (
          <Button size="sm" variant="destructive" onClick={kill} className="h-7">
            Stop
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{activeTab ? activeTab.language : 'no file'}</span>
      </div>
      <pre className="flex-1 overflow-auto p-3 font-mono text-sm whitespace-pre-wrap">{output || 'No output yet. Press Run or Ctrl+Enter.'}</pre>
    </div>
  );
}
