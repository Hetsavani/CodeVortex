import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { getSocket } from '@/lib/socket';
import { useTheme } from '@/components/ThemeProvider';

export default function TerminalPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!containerRef.current || !accessToken) return;
    const term = new Terminal({
      theme: isDark ? { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' } : { background: '#ffffff', foreground: '#000000', cursor: '#000000', selectionBackground: '#add6ff' },
      fontFamily: 'Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const socket = getSocket(accessToken);
    socket.emit('term:start', { cols: term.cols, rows: term.rows });

    let sessionId = '';
    const onReady = (p: { sessionId: string }): void => {
      sessionId = p.sessionId;
    };
    const onOutput = (p: { data: string }): void => term.write(p.data);

    socket.on('term:ready', onReady);
    socket.on('term:output', onOutput);

    term.onData((data) => {
      if (sessionId) socket.emit('term:input', { sessionId, data });
    });

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    const handleResize = (): void => {
      if (sessionId) socket.emit('term:resize', { sessionId, cols: term.cols, rows: term.rows });
    };
    term.onResize(handleResize);

    return () => {
      if (sessionId) socket.emit('term:stop', { sessionId });
      socket.off('term:ready', onReady);
      socket.off('term:output', onOutput);
      term.dispose();
      observer.disconnect();
    };
  }, [accessToken, isDark]);

  return <div ref={containerRef} className={`h-full ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`} />;
}
