# Target Product Definition

> **Goal**: A browser-based development environment that a developer would actually choose to use for real work — not just a demo or portfolio piece.

---

## The Product Vision

CodeVortex should feel like a lightweight, cloud-native VS Code: fast, reliable, capable of running real code including long-running servers, with a genuine AI assistant, and a real file system. It should demonstrate serious engineering depth while remaining something that one developer can ship.

---

## IDE

### Editor (Monaco)
**Must build:**
- Remove hardcoded 400px height — editor should fill available space dynamically
- Auto-detect language from file extension (already exists, needs fixing)
- Unsaved-changes indicator (dot on tab, like VS Code)
- Debounced autosave (2s of inactivity → save to API)
- `redux-persist` to restore open tabs on page reload
- Proper `className` in JSX (fix current bugs)

**Should build:**
- Breadcrumb path display in editor header
- Word wrap toggle
- Font size controls
- Multiple cursors / column selection (already Monaco default, just needs to be unlocked)

**Nice to have:**
- Custom Monaco themes (e.g., One Dark, Monokai) via `monaco-themes` library
- Command palette (`Ctrl+Shift+P`) — Monaco has a built-in one, needs activation

### File Explorer
**Must build:**
- Context menu (right-click) for: New File, New Folder, Rename, Delete
- Drag-and-drop file reordering (nice-to-have)
- Search/filter in file tree
- Icons by file type (already has basic icons, expand)

**Should build:**
- Rename file/folder in-place (currently missing entirely)

### Tabs
**Must build:**
- Persist open tabs across page reload (localStorage via redux-persist)
- Unsaved indicator per tab
- Tab scroll when many files are open

**Should build:**
- Tab reordering via drag-and-drop

### Keyboard Shortcuts
**Must build:**
- `Ctrl+S`: Save (exists)
- `Ctrl+W`: Close tab
- `Ctrl+Tab`: Switch tab
- `Ctrl+\``: Open/focus terminal

**Should build:**
- Custom shortcut configuration page

---

## Terminal

This is the most important missing feature for making this feel like a real IDE.

### What it should support
**Must build:**
- A real interactive terminal using `xterm.js` in the frontend
- PTY (pseudo-terminal) support on the backend using `node-pty`
- Proper ANSI escape code rendering (colors, cursor movement)
- stdin forwarding from the browser to the process
- stdout/stderr streaming back to the browser

**Should build:**
- Multiple terminal tabs
- Terminal resize propagation (SIGWINCH)
- Terminal history persistence within a session

**Nice to have:**
- Named terminal sessions
- Terminal reconnection after page reload (reconnect to same PTY session)

### Technical requirement
The terminal must run inside a sandboxed environment (the Docker container), NOT on the host. The user's terminal session is a shell inside their workspace container.

---

## Code Execution

### Short-Running Programs
**Must build:**
- Output streaming (don't wait for process exit — emit chunks via WebSocket)
- Proper timeout (10s default, configurable up to 30s)
- Process kill button in the UI
- Execution status indicator (running / success / error / timeout)
- Separate stdout and stderr display

### Long-Running Processes
**Must build:**
- Process manager: list running processes, show status, kill individual processes
- Persistent process IDs that survive WebSocket reconnection
- Session-based process ownership (your processes are yours)

### Interactive Programs
**Must build:**
- stdin input via the terminal (xterm.js forwards keystrokes to the PTY)
- Programs using `input()` / `scanf()` / `readline()` work correctly

### Execution History
**Should build:**
- Per-file execution log: last N runs with timestamp, exit code, duration
- Stored in MongoDB (not Redux)

### Resource Limits
**Must build:**
- CPU: 0.5 CPU seconds max for short executions
- Memory: 128MB max per container
- Execution time: 30s wall-clock max
- No network access from execution containers (unless explicitly opted in for future feature)

---

## Projects

### Persistent Projects
**Must build:**
- Multiple projects per user
- Each project has its own file tree, settings
- Project dashboard on login
- Project creation, renaming, deletion

### Workspace Persistence
**Must build:**
- Files persisted to MongoDB (and later object storage for large files)
- Open tabs, active file, scroll position persisted per project

### Project Sharing
**Nice to have:**
- Read-only project share link
- Fork a shared project into your own workspace

---

## AI Integration

### AI Coding Assistant (Chat)
**Must build:**
- Sidebar chat panel (collapsible)
- Context-aware: the active file's content is automatically included in the prompt
- Streaming responses (character-by-character, not full response wait)
- Conversation history within a session

**Should build:**
- "Explain this code" / "Debug this error" quick-action buttons
- Code diff view for AI-suggested changes
- Insert AI-generated code at cursor position

### Image → Code
**Must build:**
- Fix fragile language detection (parse from AI response structure, not first-line string split)
- Server-side file size and MIME type validation
- Loading state while processing

**Should build:**
- Show preview of uploaded image alongside extracted code
- Allow user to edit before executing

### Handwritten Code Recognition
Already works via Gemini Vision. Needs:
- Better prompt engineering for accuracy
- Language detection improvement
- Confidence indicator

### What NOT to build in AI
- RAG over the user's entire codebase: too complex for the current scope; not needed yet
- AI agents that autonomously run code: significant safety concerns, add after sandbox is solid
- Embeddings / vector database: overkill for a single-developer project without many users

---

## UX — What Makes This Feel Like a Real Developer Tool

### Layout
```
┌────────────────────────────────────────────────┐
│  Header: Logo | Project Name | Run | Share     │
├──────────┬─────────────────────┬───────────────┤
│  File    │                     │  AI Chat      │
│ Explorer │   Monaco Editor     │  (collapsible)│
│          │                     │               │
├──────────┴─────────────────────┴───────────────┤
│  Terminal / Output / Process Manager (tabs)    │
└────────────────────────────────────────────────┘
```

### Must-Have UX Improvements
- **Resizable panels**: File explorer, editor, terminal, AI chat should all be resizable (use `react-resizable-panels` or similar)
- **Bottom panel tabs**: Terminal | Output | Problems | Logs
- **Status bar**: Active language, line/column, git status if applicable, execution status
- **Loading skeletons**: Not spinners — proper layout skeletons while files load
- **Toasts for actions**: "File saved" / "Execution timed out" / "Code copied" — non-blocking
- **Error boundaries**: Catch React errors and show recovery UI instead of blank screen
- **Empty states**: Well-designed "No files yet — create one" instead of empty white space

### Should-Have UX
- Onboarding: first-time user flow with example project
- Keyboard shortcut reference (`Ctrl+K` → shortcut viewer)
- Project settings panel

### The Developer Experience Test
Ask: "Would a developer use this instead of opening a local terminal?"  
Currently: No — it can't run servers, can't interact with programs, loses state on refresh.  
After target state: Yes — for quick experiments, learning, sharing snippets, running code without local setup.

---

## Prioritization Summary

| Feature | Priority | Complexity | Value |
|---|---|---|---|
| Sandbox execution (Docker) | MUST | High | Critical |
| Execution timeout | MUST | Low | Critical |
| Auth on execution endpoint | MUST | Low | Critical |
| Secret rotation | MUST | Low | Critical |
| xterm.js terminal | MUST | Medium | Very High |
| node-pty backend | MUST | Medium | Very High |
| Output streaming (WebSocket) | MUST | Medium | High |
| Autosave + tab persistence | MUST | Low | High |
| AI chat (streaming) | MUST | Medium | High |
| Rate limiting | MUST | Low | High |
| Resizable panels | SHOULD | Low | High |
| Multiple projects | SHOULD | Medium | High |
| Process manager | SHOULD | Medium | Medium |
| Execution history | SHOULD | Low | Medium |
| File rename | SHOULD | Low | Medium |
| Command palette | NICE | Low | Medium |
| Project sharing | NICE | Medium | Medium |
