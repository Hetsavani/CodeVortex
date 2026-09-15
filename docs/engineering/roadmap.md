# Implementation Roadmap: 6-Week Plan

---

## Phase Classification

### MUST BUILD
Critical for security, basic reliability, and the core IDE experience.

### SHOULD BUILD
Significantly improves the product. Implement after MUST items are solid.

### NICE TO HAVE
Valuable but not blocking a production-quality release.

---

## Phase 1 — Security Foundations & Critical Fixes
**Duration**: ~1 week  
**Dependency**: Nothing — start here  
**Goal**: Fix the critical security holes and basic bugs that make the current system dangerous

---

### Week 1 Tasks

#### Day 1-2: Credential Rotation & Secret Cleanup

**Why first**: The Firebase key and MongoDB credentials are leaked. This is the highest-severity issue.

- [ ] Revoke and rotate the Firebase Admin service account key
- [ ] Rotate MongoDB Atlas credentials (create new DB user, disable old one)
- [ ] Rotate JWT secret (users will need to re-login — acceptable)
- [ ] Remove `codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json` from git history
  ```bash
  git filter-repo --path codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json --invert-paths
  ```
- [ ] Update `.gitignore` to exclude `*.json` credentials, `.env`
- [ ] Replace hardcoded MongoDB URI in `config/db.js` with `process.env.MONGO_URI`
- [ ] Update `authConfig.js` to load Firebase credentials from base64-encoded env var
- [ ] Verify no secrets remain in any committed file

**Expected outcome**: Credentials are no longer in source code. All secrets are in environment variables only.

---

#### Day 2: Critical Bug Fixes

- [ ] Add auth middleware back to `POST /api/execute/run`
- [ ] Fix stdout/stderr swap in `codeExecutionService.js:235`
- [ ] Add 10-second execution timeout to `execCode()`:
  ```javascript
  const timer = setTimeout(() => {
    childProcess.kill('SIGKILL');
    resolve({ stdout: '', stderr: 'Execution timed out', exit_code: -1, status: { id: 'TIMEOUT' } });
  }, 10_000);
  childProcess.on('close', () => clearTimeout(timer));
  ```
- [ ] Fix `class=` → `className=` in `Editor.js`
- [ ] Fix C/C++ temp file cleanup (use actual path variables)
- [ ] Fix CORS: replace `origin: "*"` with explicit origin allowlist

**Expected outcome**: No more infinite hangs, auth is enforced on execution, known bugs are fixed.

---

#### Day 3-4: Rate Limiting & Input Validation

- [ ] Install and configure `express-rate-limit` for auth endpoints (10/15min)
- [ ] Install `ioredis` and set up Redis connection
- [ ] Implement per-user execution rate limiting (30/hour, Redis-backed)
- [ ] Add OCR endpoint input validation (MIME type allowlist, 5MB max)
- [ ] Add Express body size limit: `express.json({ limit: '10mb' })`
- [ ] Add `express-rate-limit` general API limiter (200req/min per IP)

**Expected outcome**: Auth endpoints are protected, AI API costs are bounded, upload abuse is prevented.

---

#### Day 4-5: Structured Logging & Error Tracking

- [ ] Install `pino` + `pino-http`
- [ ] Replace all `console.log` / `console.error` with `logger.info` / `logger.error`
- [ ] Add Sentry free tier and integrate `@sentry/node`
- [ ] Create `GET /health` endpoint checking MongoDB + Redis
- [ ] Create `GET /health/live` liveness endpoint (just returns 200)
- [ ] Remove all debug `console.log("Point 1")`, `console.log(content)` etc.

**Expected outcome**: Production logs are structured and useful. Errors are captured in Sentry. Health checks enable uptime monitoring.

---

#### Day 5-7: State Persistence (Frontend)

- [ ] Install `redux-persist` and configure for `tabs` and `activeTab` slices
- [ ] Install `use-debounce` for autosave
- [ ] Implement debounced autosave (2s after last keystroke → PUT to API)
- [ ] Add unsaved indicator (● dot) on tab
- [ ] Add toast notification for save status (install `react-hot-toast`)
- [ ] Remove double run button from `Editor.js`
- [ ] Fix editor height: remove hardcoded `400px`, use `height="100%"` with flex container

**Expected outcome**: Open tabs survive page reloads. Autosave prevents data loss. Editor uses available space.

---

**Phase 1 Complexity**: Medium-Low  
**Phase 1 Engineering value**: Critical (removes dangerous technical debt)  
**Phase 1 Outcome**: The project is now safe to run publicly. Basic bugs are fixed. State is persistent.

---

## Phase 2 — Secure Execution Architecture
**Duration**: ~2 weeks  
**Dependency**: Phase 1 complete  
**Goal**: Replace the dangerous host-process execution with Docker sandboxing + real-time streaming

---

### Week 2-3 Tasks

#### Docker Execution Engine

- [ ] Install Docker on development machine and production server
- [ ] Write `code-runners/python.Dockerfile`, `code-runners/node.Dockerfile`, `code-runners/java.Dockerfile`, `code-runners/cpp.Dockerfile`
- [ ] Build and tag all runner images locally
- [ ] Rewrite `codeExecutionService.js` to use `dockerode`:
  - `docker.createContainer()` with security flags
  - Attach stdin/stdout/stderr streams
  - Enforce 15-second wall-clock timeout at container level
  - Auto-remove container on exit (`--rm`)
- [ ] Implement execution state tracking in Redis (`process:{id}` key)
- [ ] Wire Socket.IO to emit `exec:output` events as chunks arrive
- [ ] Implement `exec:kill` socket handler to kill container on demand
- [ ] Frontend: switch from fetch-based execution to socket-based with streaming output display

**Expected outcome**: Code execution is isolated, safe, and streaming. Users see output as it's produced.

---

#### Job Queue (BullMQ)

- [ ] Install `bullmq`
- [ ] Create `execution-queue` with max concurrency 5
- [ ] Move container spawn logic into a BullMQ worker process
- [ ] API server enqueues job and returns `executionId` immediately (202)
- [ ] Worker emits output via Redis pub/sub → API → Socket.IO
- [ ] Add dead-letter queue for failed jobs
- [ ] Add backpressure check: if queue > 50 jobs, return 429

**Expected outcome**: Execution is fully decoupled from request handling. Concurrency is bounded.

---

#### Process Supervision

- [ ] On startup: scan `process:*` Redis keys, kill orphaned containers
- [ ] Background cleanup job: every 5 minutes, prune containers with elapsed > 2× timeout
- [ ] Add `exec:reconnect` socket handler that replays buffered output from Redis

**Expected outcome**: No container leaks. Clients can reconnect and get missed output.

---

**Phase 2 Complexity**: High  
**Phase 2 Engineering value**: Very High (transforms execution from dangerous to production-grade)  
**Phase 2 Outcome**: Docker-sandboxed, streamed, queue-backed execution. The most impressive technical piece.

---

## Phase 3 — Interactive Terminal
**Duration**: ~1 week  
**Dependency**: Phase 2 (Docker execution infrastructure)  
**Goal**: Add a real interactive terminal using xterm.js and node-pty

---

### Week 4 Tasks

#### Backend: PTY Server

- [ ] Install `node-pty`
- [ ] Create `terminalService.js` (replace the disconnected existing one):
  - `pty.spawn('/bin/bash', [], { cwd: '/workspace', env: safeEnv })`
  - Attach to Docker container via `docker exec -it`
  - Stream PTY output → Socket.IO `term:output` event
  - Accept `term:input` → write to PTY stdin
  - Accept `term:resize` → `pty.resize(cols, rows)`
  - Accept `term:stop` → kill container
- [ ] Wire Socket.IO event handlers for all terminal events
- [ ] Store terminal session state in Redis (`terminal:{sessionId}`)
- [ ] Implement terminal session reconnection (rejoin existing PTY if still alive)

#### Frontend: xterm.js Terminal

- [ ] Install `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`
- [ ] Create `TerminalPanel.jsx` component
- [ ] Connect to Socket.IO terminal events
- [ ] Implement terminal resize observer → `term:resize` emit
- [ ] Add terminal to bottom panel tabs (Terminal | Output | Problems)
- [ ] Style xterm.js to match the dark theme

**Expected outcome**: A real, working terminal. Run interactive Python REPLs, bash commands, servers.

---

**Phase 3 Complexity**: Medium-High  
**Phase 3 Engineering value**: Very High (this is what makes it feel like a real IDE)  
**Phase 3 Outcome**: Browser-based interactive terminal. Users can run any program interactively.

---

## Phase 4 — IDE Layout & UX Overhaul
**Duration**: ~1 week  
**Dependency**: Phase 3 (terminal exists)  
**Goal**: Redesign the IDE layout to feel like a real development environment

---

### Week 5 Tasks

- [ ] Install `react-resizable-panels`
- [ ] Implement the 3-panel layout: File Explorer | Editor | AI Chat (collapsible)
- [ ] Implement bottom panel: Terminal | Output | Problems tabs
- [ ] Add status bar at bottom: language, line/col, save status, execution status
- [ ] Add file tree context menu (right-click): New File, New Folder, Rename, Delete
- [ ] Implement inline file/folder creation (replace `prompt()`)
- [ ] Implement inline file rename (F2 key)
- [ ] Add keyboard shortcuts: `Ctrl+Enter` (run), `Ctrl+W` (close tab), `` Ctrl+` `` (terminal focus)
- [ ] Fix all JSX issues (`class` → `className`, inline styles cleanup)
- [ ] Move `SOCKET_URL` in `config.js` to point to production backend (not localhost:3010)
- [ ] Add project dashboard page (list of projects, create/delete project)

**Expected outcome**: The IDE looks and feels like VS Code-lite. Professional UX throughout.

---

**Phase 4 Complexity**: Medium  
**Phase 4 Engineering value**: High (product quality, UX)  
**Phase 4 Outcome**: A UI that a developer would actually enjoy using.

---

## Phase 5 — AI Chat & Storage Redesign
**Duration**: ~1 week  
**Dependency**: Phase 4  
**Goal**: Add streaming AI chat, improve image-to-code, fix storage architecture

---

### Week 6 Tasks

#### Storage Refactor

- [ ] Create `projects` and `files` MongoDB collections
- [ ] Write migration script: walk `user.directory` → create Project + File documents
- [ ] Update all file API endpoints to use new collection
- [ ] Update auth middleware to enforce file ownership checks
- [ ] Remove `directory` embedded field from User schema after verification

#### AI Chat

- [ ] Create `POST /api/ai/chat` streaming SSE endpoint
- [ ] Implement `buildChatContext()` with active file + error output
- [ ] Add per-user AI rate limiting (100 chat/day, 10 OCR/day)
- [ ] Create `AIChatPanel.jsx` component with streaming rendering
- [ ] Add "Explain this error" button to output panel
- [ ] Fix OCR language detection: use structured JSON response parsing

#### Observability

- [ ] Install `prom-client` and expose `GET /metrics`
- [ ] Add execution counter, duration histogram
- [ ] Set up Grafana Cloud free tier dashboard
- [ ] Set up UptimeRobot monitoring

**Expected outcome**: Proper data model, working AI chat, metrics visible in dashboard.

---

**Phase 5 Complexity**: High (storage migration is risky, do carefully)  
**Phase 5 Engineering value**: Very High  
**Phase 5 Outcome**: Production-quality data layer. Real AI assistant.

---

## Post-Phase 5 (NICE TO HAVE, no specific week)

These are improvements that add value but aren't critical for a production-quality release:

- [ ] OpenTelemetry distributed tracing
- [ ] Output buffer + reconnection replay
- [ ] File rename in explorer
- [ ] Command palette (`Ctrl+Shift+P`)
- [ ] Monaco custom themes (One Dark, Monokai)
- [ ] Project sharing (read-only link)
- [ ] Execution history per file
- [ ] CI/CD with GitHub Actions
- [ ] Docker Compose for production deployment (replaces Render)

---

## Summary Timeline

| Week | Phase | Key Deliverable |
|---|---|---|
| 1 | Security + Foundations | Safe, bug-fixed, persistent state |
| 2-3 | Secure Execution | Docker sandboxing + streaming output |
| 4 | Interactive Terminal | xterm.js + node-pty terminal |
| 5 | IDE Layout & UX | Professional IDE look and feel |
| 6 | AI + Storage | Streaming AI chat, proper data model |

---

## MUST BUILD (In Order)

1. Credential rotation + secret cleanup
2. Auth on execution endpoint + execution timeout
3. Rate limiting (Redis-backed)
4. Structured logging + Sentry
5. Tab persistence + autosave
6. Docker sandboxed execution + streaming output
7. Interactive terminal (xterm.js + node-pty)
8. IDE layout redesign

## SHOULD BUILD

9. Job queue (BullMQ)
10. Storage refactor (projects/files collections)
11. AI chat with streaming
12. Observability dashboard (prom-client + Grafana)
13. Process supervision / orphan cleanup
14. File context menu + inline rename

## NICE TO HAVE

15. OpenTelemetry tracing
16. Output buffer + reconnect replay
17. Command palette
18. Project sharing
19. Execution history
20. CI/CD pipeline

---

## Final Goal

After 6 weeks of this roadmap, the project demonstrates:

- **Security**: Sandboxed code execution with no host access, proper auth everywhere, rate limiting, secret management
- **Distributed systems**: Redis-backed state, BullMQ job queue, process supervision
- **Real-time systems**: Socket.IO streaming, PTY terminal, reconnection handling
- **Backend engineering**: Structured logging, health checks, metrics, proper data model
- **AI integration**: Context-aware streaming chat, robust image-to-code
- **Production frontend**: Persistent state, autosave, real terminal, resizable panels
- **DevOps**: Docker Compose deployment, GitHub Actions CI, health monitoring

That is a technically impressive project built by one developer in 6 weeks — not because of the number of technologies, but because every technology solves a real problem.
