# 7-Day Sprint Plan (2 hrs/day · 14 hrs total) — TypeScript Edition

**Goal**: Transform the prototype into a secure, streaming, production-oriented Cloud IDE. All code in TypeScript.  
**Constraint**: 2 focused hours per day — no half-measures, finish each day's tasks before moving on.
> Stack source of truth: [`tech-stack.md`](tech-stack.md) (Vite + React TS + Tailwind + shadcn/ui + Express TS via tsx + Zod + pino + BullMQ + Gemini)

---

## Day 1 — Critical Security Fixes (2 hrs)

> These bugs make the current system dangerous. Fix them before anything else.

**Hour 1 — Credential cleanup**

1. Revoke the Firebase Admin service account key in Firebase Console → create new one
2. Rotate MongoDB Atlas password → create new DB user, delete old one
3. Generate a new JWT secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Remove Firebase JSON from git history:
   ```bash
   cd Cloud_IDE_backend
   git filter-repo --path codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json --invert-paths
   ```
5. Add to `.gitignore`: `*.json` (credentials), `.env`
6. Update `config/db.js` line 8 — remove hardcoded URI, use `process.env.MONGO_URI` only
7. Update `.env` with all new credentials

**Hour 2 — Bug fixes**

1. **Add auth to execution endpoint** — `executionRoutes.js` line 22:
   ```js
   router.post('/run', authMiddleware, executionController.executeCode);
   ```
2. **Add 10-second timeout** to `codeExecutionService.js` inside `execCode()`:
   ```js
   const timer = setTimeout(() => {
     childProcess.kill('SIGKILL');
     resolve({ stdout: 'Execution timed out (10s limit)', stderr: '', exit_code: -1,
       status: { id: 'TIMEOUT', description: 'Time Limit Exceeded' }});
   }, 10_000);
   childProcess.on('close', () => clearTimeout(timer));
   ```
3. **Fix stdout/stderr swap** — `codeExecutionService.js` line ~235: change `stdout: stderrData` → `stdout: stdoutData`
4. **Fix CORS** — `server.js` line 18:
   ```js
   app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000' }));
   ```
5. Fix Socket.IO CORS too — `server.js` line 59: `origin: process.env.ALLOWED_ORIGIN`

**✅ Day 1 Done**: No more credential leaks. Execution requires auth. Infinite loops timeout. CORS locked.

---

## Day 2 — Rate Limiting + Redis + Logging (2 hrs)

**Hour 1 — Rate limiting**

```bash
cd Cloud_IDE_backend
npm install express-rate-limit ioredis pino pino-http
```

1. Create `config/redis.js`:
   ```js
   const Redis = require('ioredis');
   const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
   module.exports = redis;
   ```
2. Add per-IP rate limiters in `server.js`:
   ```js
   const rateLimit = require('express-rate-limit');
   app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, limit: 10 }));
   app.use('/api/', rateLimit({ windowMs: 60*1000, limit: 200 }));
   ```
3. Create `Middleware/rateLimitMiddleware.js` with per-user execution limit (30/hour) using Redis INCR + EXPIRE
4. Apply it to the execution route

**Hour 2 — Structured logging**

1. Create `config/logger.js` using pino
2. Replace every `console.log` in Controllers + Services with `logger.info` / `logger.error`
3. Add `pino-http` middleware to `server.js`
4. Create `GET /health` route:
   ```js
   app.get('/health', async (req, res) => {
     const mongo = mongoose.connection.readyState === 1 ? 'ok' : 'error';
     res.status(mongo === 'ok' ? 200 : 503).json({ status: mongo === 'ok' ? 'healthy' : 'degraded', mongo });
   });
   ```
5. Add `GET /health/live` that just returns `{ status: 'alive' }`
6. Add `.env` variable: `REDIS_URL=redis://localhost:6379`

**✅ Day 2 Done**: Rate limiting active. Redis connected. Structured logs. Health endpoint live.

---

## Day 3 — Docker Execution Sandbox (2 hrs)

> The most important engineering day. Replace host-process execution with containerized execution.

**Hour 1 — Docker images**

1. Create `code-runners/` directory in backend
2. Write `code-runners/python.Dockerfile`:
   ```dockerfile
   FROM python:3.12-alpine
   RUN addgroup -S runner && adduser -S -G runner runner
   USER runner
   WORKDIR /home/runner
   ```
3. Write `code-runners/node.Dockerfile` (same pattern, `node:20-alpine`)
4. Write `code-runners/java.Dockerfile` (`eclipse-temurin:21-alpine`)
5. Write `code-runners/cpp.Dockerfile` (`gcc:13-alpine`)
6. Build all images:
   ```bash
   docker build -f code-runners/python.Dockerfile -t code-runner:python .
   docker build -f code-runners/node.Dockerfile -t code-runner:node .
   docker build -f code-runners/java.Dockerfile -t code-runner:java .
   docker build -f code-runners/cpp.Dockerfile -t code-runner:cpp .
   ```

**Hour 2 — Rewrite execution service**

Rewrite `Services/codeExecutionService.js` to use `dockerode`:

```js
const Docker = require('dockerode');
const docker = new Docker();

const IMAGES = {
  python: 'code-runner:python',
  javascript: 'code-runner:node',
  java: 'code-runner:java',
  cpp: 'code-runner:cpp',
  c: 'code-runner:cpp',
};

const COMMANDS = {
  python: (code) => ['python3', '-c', code],
  javascript: (code) => ['node', '-e', code],
  // java/cpp still need file write — handle separately
};

const execCode = async (language, code, input = '') => {
  const image = IMAGES[language];
  if (!image) throw { error: 'Unsupported language' };

  const container = await docker.createContainer({
    Image: image,
    Cmd: COMMANDS[language](code),
    NetworkDisabled: true,
    HostConfig: {
      Memory: 128 * 1024 * 1024,    // 128MB
      MemorySwap: 128 * 1024 * 1024,
      CpuQuota: 50000,               // 0.5 CPU
      PidsLimit: 50,
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,size=10m' },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      AutoRemove: true,
    },
    OpenStdin: true,
    StdinOnce: true,
  });

  let stdout = '', stderr = '';
  const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true });
  
  const timer = setTimeout(() => container.kill().catch(() => {}), 15_000);

  if (input) { stream.write(input); }
  stream.end();

  container.modem.demuxStream(stream, 
    { write: (c) => stdout += c },
    { write: (c) => stderr += c }
  );

  await container.start();
  const result = await container.wait();
  clearTimeout(timer);

  return {
    stdout: stdout.trim(), stderr: stderr.trim(),
    exit_code: result.StatusCode,
    status: { id: result.StatusCode === 0 ? 3 : 4,
      description: result.StatusCode === 0 ? 'Accepted' : 'Runtime Error' }
  };
};

module.exports = { execCode };
```

Test with: `node -e "require('./Services/codeExecutionService').execCode('python','print(42)').then(console.log)"`

**✅ Day 3 Done**: User code no longer runs on host. Fully containerized and resource-limited.

---

## Day 4 — Real-Time Output Streaming (2 hrs)

> Turn the request-response execution model into a streaming Socket.IO model.

**Hour 1 — Backend: Socket.IO execution events**

Wire up Socket.IO in `server.js`:

```js
const { v4: uuidv4 } = require('uuid'); // npm install uuid
const redis = require('./config/redis');

io.use((socket, next) => {
  // Auth: verify JWT from socket handshake
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  socket.on('exec:start', async ({ language, code, input }) => {
    const processId = uuidv4();
    socket.join(`exec:${processId}`);
    socket.emit('exec:started', { processId });

    try {
      // Stream version: attach container streams directly to socket
      await runAndStream(language, code, input, processId, io);
    } catch (err) {
      io.to(`exec:${processId}`).emit('exec:error', { processId, message: err.message });
    }
  });

  socket.on('exec:kill', async ({ processId }) => {
    const state = await redis.get(`process:${processId}`);
    if (state) {
      const { containerId } = JSON.parse(state);
      await docker.getContainer(containerId).kill().catch(() => {});
    }
  });
});
```

Create `runAndStream()` in the execution service — like `execCode` but emits chunks via Socket.IO room as they arrive instead of buffering.

**Hour 2 — Frontend: connect to streaming**

1. Fix `Socket.js` — point to backend URL:
   ```js
   const socket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000', {
     auth: { token: localStorage.getItem('token') },
     autoConnect: false,
   });
   ```
2. In `Editor.js`, replace `handleRunButton`'s fetch call with socket events:
   ```js
   const handleRunButton = () => {
     socket.connect();
     setOutputVal('');
     socket.emit('exec:start', { language, code, input: inputVal });
     socket.on('exec:output', ({ chunk, stream }) => {
       setOutputVal(prev => prev + chunk);
     });
     socket.on('exec:done', ({ exitCode }) => {
       socket.off('exec:output');
       socket.off('exec:done');
     });
   };
   ```
3. Add a "Kill" button that emits `exec:kill`
4. Add a running indicator (spinner while `exec:started` → `exec:done`)

**✅ Day 4 Done**: Output streams live to the browser. Users see results as they happen.

---

## Day 5 — Frontend: Tab Persistence + Autosave + Layout (2 hrs)

**Hour 1 — State persistence**

```bash
cd Cloud_IDE_frontend
npm install redux-persist use-debounce react-hot-toast react-resizable-panels
```

1. Wrap Redux store with `redux-persist` (persist `tabs` and `activeTab` to localStorage)
2. Add `<Toaster />` from `react-hot-toast` to `App.js`
3. Add debounced autosave in `Editor.js`:
   ```js
   const debouncedSave = useDebouncedCallback(async (path, content) => {
     await fetch(`${API_BASE_URL}/api/files/${path}/content`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json',
         Authorization: 'Bearer ' + localStorage.getItem('token') },
       body: JSON.stringify({ content }),
     });
     toast.success('Saved', { duration: 1000 });
     setIsDirty(false);
   }, 2000);
   ```
4. Add `isDirty` state — set true on edit, false on save
5. Show `●` unsaved indicator on tab when `isDirty === true`

**Hour 2 — Layout fixes**

1. Fix editor height: change `height="400px"` → `height="100%"` with flex container wrapping it
2. Fix all `class=` → `className=` in `Editor.js` (lines ~332–408)
3. Remove duplicate run button (keep only the one in the toolbar header area)
4. Replace `prompt()` in `Files.js` with a simple controlled `<input>` that appears inline
5. Replace `alert()` with `toast.error()` in `Files.js`
6. Fix `SOCKET_URL` in `config.js` to use `process.env.REACT_APP_SOCKET_URL`

**✅ Day 5 Done**: Tabs survive refresh. Edits autosave. Editor fills space. No more browser dialogs.

---

## Day 6 — Interactive Terminal (2 hrs)

> The feature that makes this feel like a real IDE.

**Hour 1 — Backend: PTY server**

```bash
cd Cloud_IDE_backend
npm install node-pty  # Note: requires node-gyp, build tools
```

Add terminal Socket.IO handlers to `server.js`:

```js
const pty = require('node-pty');
const terminalSessions = new Map(); // sessionId → ptyProcess

io.on('connection', (socket) => {
  // ... existing exec handlers ...

  socket.on('term:start', ({ cols = 80, rows = 24 }) => {
    const sessionId = uuidv4();
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color', cols, rows,
      cwd: process.env.HOME,
      env: { HOME: process.env.HOME, TERM: 'xterm-color',
        PATH: '/usr/local/bin:/usr/bin:/bin', SHELL: shell },
    });

    terminalSessions.set(sessionId, ptyProcess);
    ptyProcess.onData(data => socket.emit('term:output', { sessionId, data }));
    ptyProcess.onExit(() => socket.emit('term:closed', { sessionId }));

    socket.emit('term:ready', { sessionId });
  });

  socket.on('term:input', ({ sessionId, data }) => {
    terminalSessions.get(sessionId)?.write(data);
  });

  socket.on('term:resize', ({ sessionId, cols, rows }) => {
    terminalSessions.get(sessionId)?.resize(cols, rows);
  });

  socket.on('term:stop', ({ sessionId }) => {
    terminalSessions.get(sessionId)?.kill();
    terminalSessions.delete(sessionId);
  });

  socket.on('disconnect', () => {
    // Kill all terminal sessions owned by this socket
    terminalSessions.forEach((pty, id) => { pty.kill(); terminalSessions.delete(id); });
  });
});
```

**Hour 2 — Frontend: xterm.js**

```bash
cd Cloud_IDE_frontend
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

Create `src/Components/Terminal/TerminalPanel.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import socket from '../../Socket';

export default function TerminalPanel() {
  const containerRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({ theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
      fontFamily: 'Consolas, monospace', fontSize: 14, cursorBlink: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    socket.connect();
    socket.emit('term:start', { cols: term.cols, rows: term.rows });
    socket.on('term:ready', ({ sessionId }) => {
      term.onData(data => socket.emit('term:input', { sessionId, data }));
      term.onResize(({ cols, rows }) => socket.emit('term:resize', { sessionId, cols, rows }));
      window.__termSessionId = sessionId;
    });
    socket.on('term:output', ({ data }) => term.write(data));

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      socket.emit('term:stop', { sessionId: window.__termSessionId });
      socket.off('term:ready'); socket.off('term:output');
      term.dispose(); observer.disconnect();
    };
  }, []);

  return <div ref={containerRef} style={{ height: '100%', backgroundColor: '#1e1e1e' }} />;
}
```

Add a bottom panel to the IDE layout with two tabs: **Output** (existing textarea) and **Terminal** (new component).

**✅ Day 6 Done**: A real interactive terminal runs in the browser. Type commands, run REPLs.

---

## Day 7 — AI Chat + Polish + Deploy (2 hrs)

**Hour 1 — Streaming AI chat**

1. Add new route `Routes/aiRoutes.js` → `POST /api/ai/chat`
2. Create `Controllers/aiController.js`:

```js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const chatWithAI = async (req, res) => {
  const { message, activeFile } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const context = [
    { role: 'user', parts: [{ text: 'You are a coding assistant in a Cloud IDE. Be concise.' }] },
    { role: 'model', parts: [{ text: 'Ready to help.' }] },
    { role: 'user', parts: [{ text: activeFile
      ? `Active file (${activeFile.name}):\n\`\`\`\n${activeFile.content?.slice(0,6000)}\n\`\`\`\n\n${message}`
      : message }] },
  ];

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const stream = await model.generateContentStream({ contents: context });

  for await (const chunk of stream.stream) {
    res.write(`data: ${JSON.stringify({ text: chunk.text() })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
};

module.exports = { chatWithAI };
```

3. Register route in `server.js`: `app.use('/api/ai', authMiddleware, aiRoutes)`

4. Create `src/Components/AI/AIChatPanel.jsx` — a simple collapsible sidebar:
   - Input textarea + Send button
   - On submit: `fetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({message, activeFile}) })`
   - Read SSE stream, append chunks to the last message in state
   - Add "Explain this error" button to the Output panel that prefills the message

**Hour 2 — Polish + Deployment prep**

1. **Fix OCR language detection** in `Editor.js` line ~298:
   ```js
   // Replace the fragile string parse with:
   try {
     const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, ''));
     setImageCode(parsed.code);
     setlanguage(parsed.language);
   } catch {
     // fallback: use text as-is
     setImageCode(text);
   }
   ```
   Also update the OCR prompt in `ocrController.js` to return `{ "language": "python", "code": "..." }`

2. **Docker Compose** — create `docker-compose.dev.yml` in project root:
   ```yaml
   version: '3.9'
   services:
     redis:
       image: redis:7-alpine
       ports: ["6379:6379"]
     api:
       build: ./Cloud_IDE_backend
       ports: ["5000:5000"]
       environment:
         MONGO_URI: ${MONGO_URI}
         JWT_SECRET: ${JWT_SECRET}
         GEMINI_API_KEY: ${GEMINI_API_KEY}
         REDIS_URL: redis://redis:6379
         ALLOWED_ORIGIN: http://localhost:3000
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock
       depends_on: [redis]
   ```

3. Create `.env.example` with all required variables (no values) and commit it

4. Update `README.md` with: `docker compose -f docker-compose.dev.yml up`

5. Set up UptimeRobot (free) to ping `GET /health` every 5 minutes

**✅ Day 7 Done**: Streaming AI chat works. Local dev is one command. Monitoring is active.

---

## End-of-Week Result

| Feature | Before | After |
|---|---|---|
| Code execution | Unsandboxed, on host, no timeout | Dockerized, resource-limited, 15s timeout |
| Output delivery | All at once after exit | Streams live to browser |
| Authentication | Missing on /execute | Required on all endpoints |
| Credentials | Committed to git | Env vars, rotated |
| Terminal | Non-existent | xterm.js + PTY, interactive |
| AI chat | None | Streaming, context-aware |
| Tab state | Lost on refresh | Persisted via redux-persist |
| Autosave | Manual Ctrl+S only | Debounced 2s autosave |
| Rate limiting | None | Per-IP + per-user Redis counters |
| Logging | console.log noise | Structured pino + /health endpoint |

**14 hours. Real engineering. No buzzwords.**

---

## Daily Checklist

- [ ] Day 1: Credentials rotated, auth on /execute, timeout working, CORS fixed
- [ ] Day 2: Redis running, rate limits active, /health returns 200, pino logs structured
- [ ] Day 3: Docker images built, `execCode()` uses dockerode, test locally
- [ ] Day 4: exec:start/output/done socket events work, frontend shows streaming output
- [ ] Day 5: Tabs survive reload, autosave fires, editor fills height, no browser dialogs
- [ ] Day 6: Terminal opens in browser, can type `python3`, get interactive REPL
- [ ] Day 7: AI chat streams responses, docker-compose.dev.yml works with one command
