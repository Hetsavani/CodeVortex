# Frontend Engineering Design

## Current UI Assessment

The current UI has the bones of a real IDE but fails on several dimensions that prevent it from feeling like a professional tool:

**What works reasonably well**:
- Monaco editor is functional with theme toggle
- File explorer with folder/file navigation
- Tab management (open/close)
- Tailwind CSS for consistent styling
- Framer Motion animations on login page

**What doesn't work or feels broken**:
- Editor is hardcoded to 400px height — wastes screen space
- Tabs and editor state reset on page reload (no persistence)
- No unsaved-changes indicator
- Run button appears twice with no clear UI hierarchy
- Socket.IO connected to localhost — fails silently in production
- No terminal (the main missing feature)
- No AI chat panel
- Inline styles mixed with Tailwind classes throughout Editor.js
- `class` instead of `className` in several JSX elements
- Debug console.logs visible in production
- No autosave
- File create/delete uses browser `prompt()` — jarring UX

---

## Target IDE Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER                                                               │
│ [CodeVortex Logo] | [Project: "My Project ▾"] | [Run ▶] [Share]    │
│                                              [Theme][Avatar]         │
├────────────┬─────────────────────────────────────┬───────────────────┤
│            │ EDITOR HEADER                        │                   │
│            │ [src/utils/helper.py] ✕  [main.py] ✕│                   │
│  FILE      ├─────────────────────────────────────┤    AI CHAT       │
│ EXPLORER   │                                      │    (collapsible) │
│            │                                      │                   │
│  ─ src/    │      Monaco Editor                   │  > Ask AI...      │
│    ─ main  │         (flex-1, fills height)       │                   │
│    ─ utils │                                      │                   │
│  ─ README  │                                      │                   │
│            │                                      │                   │
├────────────┴─────────────────────────────────────┴───────────────────┤
│ BOTTOM PANEL [Terminal] [Output] [Problems] [AI]                      │
│                                                                       │
│  $ python main.py                                                     │
│  > Hello World                                                        │
│  $                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ STATUS BAR [Python] [Ln 42, Col 8] [Spaces: 4] [UTF-8] [● Saving...] │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Panel Architecture

Use `react-resizable-panels` for the split pane layout (see [`tech-stack.md`](tech-stack.md) for all deps: Vite + Tailwind + shadcn/ui + Monaco + xterm.js):

```bash
npm install react-resizable-panels
```

```tsx
// Main IDE layout — all components are .tsx
<PanelGroup direction="horizontal">
  <Panel defaultSize={18} minSize={12} maxSize={30}>
    <FileExplorer />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={62}>
    <PanelGroup direction="vertical">
      <Panel defaultSize={65}>
        <EditorArea />
      </Panel>
      <PanelResizeHandle />
      <Panel defaultSize={35} minSize={15}>
        <BottomPanel />
      </Panel>
    </PanelGroup>
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={20} collapsible>
    <AIChatPanel />
  </Panel>
</PanelGroup>
```

Panel sizes are persisted to `localStorage` so the layout survives reloads.

---

## Editor Area Improvements

### Fix 1: Dynamic Height
```jsx
// Remove this:
<Editor height="400px" ... />

// Replace with:
<div className="h-full">
  <Editor height="100%" ... />
</div>
```

### Fix 2: Unsaved Indicator
```jsx
// In Tab component:
<div className={`tab ${isActive ? 'active' : ''}`}>
  <span>{fileName}</span>
  {isDirty && <span className="text-yellow-400 ml-1">●</span>}
  <button onClick={handleClose}>✕</button>
</div>
```

`isDirty` is true when the in-memory content differs from the last saved content.

### Fix 3: Autosave
```javascript
// Debounced autosave — fires 2s after last keystroke
const debouncedSave = useDebouncedCallback(async (path, content) => {
  await saveFile(path, content);
  setDirty(false);
  showToast('Saved', 'success');
}, 2000);

const handleCodeChange = (newCode) => {
  setCode(newCode);
  setDirty(true);
  debouncedSave(activePath, newCode);
};
```

### Fix 4: Tab Persistence (`redux-persist`)
```bash
npm install redux-persist
```

```javascript
const persistConfig = {
  key: 'ide',
  storage: localStorage,
  whitelist: ['tabs', 'activeTab']  // Only persist these fields
};
```

### Fix 5: Remove Duplicate Run Button
Currently there are two run buttons. Consolidate to one prominent "Run" button in the header with a clear keyboard shortcut tooltip (`Ctrl+Enter`).

---

## File Explorer Improvements

### Replace `prompt()` with Inline Input

```jsx
// Instead of:
const fileName = prompt("Enter file name:");

// Use an inline input that appears in the tree:
const [creatingFile, setCreatingFile] = useState(false);
const [newFileName, setNewFileName] = useState('');

{creatingFile && (
  <input
    autoFocus
    value={newFileName}
    onChange={e => setNewFileName(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') handleCreateFile(newFileName);
      if (e.key === 'Escape') setCreatingFile(false);
    }}
    className="text-sm border border-blue-400 px-1 rounded w-full"
  />
)}
```

### Add File Rename
Currently missing entirely. Add an inline rename triggered by pressing F2 or double-clicking the file name.

### Context Menu
Right-click on file/folder → show:
- New File
- New Folder
- Rename
- Delete
- Copy Path

Use a lightweight context menu library or build one with a positioned `div` and `useClickAway`.

---

## Terminal Component (xterm.js)

### Setup

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

```jsx
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TerminalPanel = ({ sessionId }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  
  useEffect(() => {
    const terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();
    
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    
    // Connect to Socket.IO for terminal I/O
    socket.emit('term:start', { projectId, cols: terminal.cols, rows: terminal.rows });
    
    socket.on('term:output', ({ data }) => terminal.write(data));
    terminal.onData(data => socket.emit('term:input', { sessionId, data }));
    
    return () => {
      terminal.dispose();
      socket.emit('term:stop', { sessionId });
    };
  }, []);
  
  return (
    <div ref={terminalRef} className="h-full bg-[#1e1e1e]" />
  );
};
```

---

## Bottom Panel (Tabs)

```jsx
const PANEL_TABS = ['Terminal', 'Output', 'Problems', 'AI'];

const BottomPanel = () => {
  const [activeTab, setActiveTab] = useState('Terminal');
  
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex border-b border-[#3c3c3c]">
        {PANEL_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1 text-sm ${
              activeTab === tab ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'Terminal' && <TerminalPanel />}
        {activeTab === 'Output' && <OutputPanel />}
        {activeTab === 'Problems' && <ProblemsPanel />}
        {activeTab === 'AI' && <AIChatPanel embedded />}
      </div>
    </div>
  );
};
```

---

## AI Chat Panel

```jsx
const AIChatPanel = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  
  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    
    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setStreaming(true);
    
    // Add placeholder AI message
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);
    
    // Stream response
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: input, activeFile: currentFile })
    });
    
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      // Parse SSE and update last message
      setMessages(prev => {
        const last = { ...prev[prev.length - 1], content: prev[prev.length - 1].content + text };
        return [...prev.slice(0, -1), last];
      });
    }
    
    setStreaming(false);
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
      </div>
      <div className="p-2 border-t border-[#3c3c3c]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
            placeholder="Ask AI... (Shift+Enter for newline)"
            className="flex-1 bg-[#2d2d2d] text-white resize-none rounded p-2 text-sm"
            rows={2}
          />
          <button onClick={sendMessage} disabled={streaming} className="px-3 bg-blue-600 rounded">
            {streaming ? '...' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

## Status Bar

A status bar at the bottom provides at-a-glance information:

```jsx
const StatusBar = () => (
  <div className="flex items-center justify-between px-3 py-0.5 bg-[#007acc] text-white text-xs">
    <div className="flex items-center gap-4">
      <span>CodeVortex</span>
      {activeProcess && <span className="text-yellow-300">● Running</span>}
    </div>
    <div className="flex items-center gap-4">
      <span>Ln {cursor.line}, Col {cursor.col}</span>
      <span>{activeLanguage}</span>
      <span>{saveStatus}</span>  {/* "Saved" / "Saving..." / "Unsaved" */}
    </div>
  </div>
);
```

---

## Toast Notification System

Replace browser `alert()` calls with non-blocking toasts:

```bash
npm install react-hot-toast
```

```javascript
import toast from 'react-hot-toast';

// Usage:
toast.success('File saved');
toast.error('Execution timed out');
toast('Execution started', { icon: '▶' });
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save active file (exists) |
| `Ctrl+Enter` | Run active file |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Switch to next tab |
| `` Ctrl+` `` | Focus terminal |
| `Ctrl+B` | Toggle file explorer |
| `Ctrl+L` | Toggle AI panel |
| `Ctrl+,` | Open settings |

All shortcuts registered via `useEffect` + `window.addEventListener('keydown', ...)`, with `e.preventDefault()` to suppress browser defaults.

---

## Accessibility

- All interactive elements must have `aria-label` or visible label text
- File tree uses `role="tree"` / `role="treeitem"` (already done)
- Focus management on tab open/close
- Keyboard navigation in file explorer (Arrow keys, Enter to open)
- Color contrast ratio ≥ 4.5:1 for all text

---

## The Developer Experience Test

After implementing these changes, a developer should be able to:
1. Open the URL and see their project dashboard in < 2 seconds
2. Open a file, edit it, see it autosave with a subtle indicator
3. Run code and see output streaming line by line as it executes
4. Run a program that asks for input and type the response in the terminal
5. Ask AI to explain an error and get a streaming response
6. Refresh the page and see all their tabs still open exactly as they left them

**That** is the test for whether this is a real IDE or just a code editor.
