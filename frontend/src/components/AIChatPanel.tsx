import { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AIChatPanel(): JSX.Element {
  const { tabs, activeTabId } = useSelector((s: RootState) => s.editor);
  const { accessToken } = useSelector((s: RootState) => s.auth);
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const send = async (): Promise<void> => {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg, { role: 'ai', content: '' }]);
    setInput('');
    setStreaming(true);

    const res = await fetch(`${API_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message: input, activeFile: activeTab ? { name: activeTab.path, content: activeTab.content, language: activeTab.language } : null }),
    });

    if (!res.body) {
      setStreaming(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const { text } = JSON.parse(line.slice(6));
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last.role === 'ai') return [...prev.slice(0, -1), { ...last, content: last.content + text }];
              return prev;
            });
          } catch {}
        }
      }
    }
    setStreaming(false);
  };

  return (
    <div className="flex h-full flex-col border-l bg-white dark:bg-[#252526]">
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-blue-600' : 'text-gray-800 dark:text-gray-200'}>
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>
      <div className="border-t p-2 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask AI... (Shift+Enter for newline)"
          className="flex-1 resize-none rounded border p-2 text-sm"
          rows={2}
        />
        <button onClick={send} disabled={streaming} className="rounded bg-blue-600 px-3 text-white">
          {streaming ? '...' : '→'}
        </button>
      </div>
    </div>
  );
}
