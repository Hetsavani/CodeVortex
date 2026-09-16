import { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    const text = input;
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'ai', content: '' }]);
    setInput('');
    setStreaming(true);
    const res = await fetch(`${API_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message: text, activeFile: activeTab ? { name: activeTab.path, content: activeTab.content, language: activeTab.language } : null }),
    });
    if (!res.body) { setStreaming(false); return; }
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
            const { text: chunk } = JSON.parse(line.slice(6));
            setMessages((prev) => { const last = prev[prev.length - 1]; return last.role === 'ai' ? [...prev.slice(0, -1), { ...last, content: last.content + chunk }] : prev; });
          } catch {}
        }
      }
    }
    setStreaming(false);
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-3 py-2 text-xs font-semibold">AI Assistant</div>
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {messages.length === 0 && <p className="text-xs text-muted-foreground">Ask about your active file, or paste an error.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-6 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground' : 'mr-6 rounded-lg bg-muted px-3 py-2 text-xs'}>
            {m.content || '…'}
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t p-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask AI… (Shift+Enter newline)" className="h-8 text-xs" />
        <Button size="sm" onClick={send} disabled={streaming} className="h-8">
          {streaming ? '…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
