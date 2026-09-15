# Biggest Problems to Solve

Ranked by a combination of **security risk + user impact + architectural severity**.

---

## Problem 1: Unsandboxed Code Execution on the Host Server

**Current situation:**  
User code is executed by calling `child_process.spawn()` directly on the Express server process. There are no cgroups, no namespaces, no containers, no filesystem restrictions, and no user isolation.

**Why it matters:**  
A single user submitting `require('fs').readdirSync('/')` gets the server's root directory. Submitting `process.env` dumps the JWT secret and Gemini API key. A fork bomb (`while True: os.fork()`) kills the server for all users. This is not a theoretical risk — it is trivially exploitable by anyone who can reach the endpoint.

**What a production system should do:**  
Every execution should occur inside an isolated, ephemeral sandbox with no access to the host filesystem, with CPU/memory/process/network limits enforced at the kernel level.

**Recommended direction:**  
Run each execution inside a Docker container with strict resource limits (`--memory`, `--cpus`, `--pids-limit`), a read-only root filesystem, no network access, and a dedicated non-root user. Containers are destroyed immediately after execution completes or times out.

**Priority:** CRITICAL

---

## Problem 2: No Execution Timeout — Server Hangs on Infinite Loops

**Current situation:**  
`execCode()` has no timeout. The Node.js event loop blocks waiting for the child process. An infinite loop hangs the HTTP request until the server is restarted.

**Why it matters:**  
A single bad request (infinite loop, `sleep(9999)`) can make the server unresponsive to all other users. On the current single-instance deployment, this is a denial-of-service by accident or by design.

**What a production system should do:**  
Every execution must have an enforced wall-clock timeout (e.g., 10–30 seconds). The process must be killed and the client must receive a meaningful `Timeout` error response.

**Recommended direction:**  
Add `setTimeout(() => childProcess.kill('SIGKILL'), TIMEOUT_MS)` and clean up immediately. In the Docker model, `docker run --timeout` or a supervisor-level kill accomplishes this more reliably.

**Priority:** CRITICAL

---

## Problem 3: Critical Secret Leaks (Firebase Key + MongoDB Credentials in Source)

**Current situation:**  
- Firebase Admin SDK private key file is committed to the git repository
- MongoDB Atlas credentials are hardcoded in `config/db.js` (bypassing `.env`)
- `.env` contains real credentials and is committed (appears so, given `config/db.js` fallback)

**Why it matters:**  
If this repository is or becomes public, or if any contributor's machine is compromised, all credentials are immediately accessible. The Firebase key allows full Firebase Admin access (user impersonation, etc.). The MongoDB credential exposes all user data.

**What a production system should do:**  
All secrets live in environment variables or a secrets manager (e.g., Doppler, AWS Secrets Manager). Nothing sensitive is ever committed to git.

**Recommended direction:**  
Rotate all exposed credentials immediately. Remove the Firebase JSON file from git history (`git filter-branch` or `git-filter-repo`). Add to `.gitignore`. Use environment variables exclusively.

**Priority:** CRITICAL

---

## Problem 4: Execution API Has No Authentication

**Current situation:**  
`POST /api/execute/run` has no `authMiddleware`. Any anonymous HTTP client can execute arbitrary code on the server.

**Why it matters:**  
This turns the server into an anonymous, publicly accessible remote code execution engine. Combined with Problem 1 (no sandboxing), this is a complete server compromise vector.

**What a production system should do:**  
All execution endpoints must require authentication. Even with sandboxing, anonymous execution enables abuse (crypto mining, DDoS amplification, etc.).

**Recommended direction:**  
Re-add `authMiddleware` to `/api/execute/run` immediately. Also add per-user rate limiting.

**Priority:** CRITICAL

---

## Problem 5: No Support for Long-Running or Interactive Processes

**Current situation:**  
The execution model is fundamentally `request → run → collect all output → response`. This means:
- `python server.py` will block until killed or until it exits
- `npm run dev` cannot be run at all
- Programs requiring stdin interaction (e.g., `input()` mid-execution) cannot receive input after execution starts
- Output only appears after the process exits (no streaming)

**Why it matters:**  
A Cloud IDE that can only run short scripts is fundamentally limited. Any real developer use case (running a web server, an interactive REPL, a file watcher) is impossible. The project cannot be called a real IDE without this.

**What a production system should do:**  
Processes should be started, assigned a process ID, and run persistently. stdout/stderr should stream to the client in real-time via WebSocket or SSE. The client should be able to send stdin. The process should be terminable on demand.

**Recommended direction:**  
Design a proper Process Lifecycle system: `start → assign PID → stream output via WebSocket → accept stdin from WebSocket → stop on demand`. See `realtime-execution.md` for the full design.

**Priority:** HIGH

---

## Problem 6: File Storage Model Doesn't Scale

**Current situation:**  
The entire user workspace (all files, folders, content) is stored as a deeply nested recursive subdocument inside a single MongoDB `User` document. MongoDB documents have a hard 16MB BSON limit.

**Why it matters:**  
A user with a moderately large project (e.g., a JS project with several source files) can approach the document size limit. Every file save rewrites the entire User document. Querying a single file requires loading the full user document. Performance degrades with document size.

**What a production system should do:**  
Files and projects are first-class database entities, stored in separate collections or as objects in object storage. File metadata (name, path, language) is in the database. File content is in object storage (S3-compatible) or a dedicated files collection.

**Recommended direction:**  
Create a `Project` collection and a `File` collection. Store file content in MongoDB GridFS or in object storage. The `User` document only holds a reference to their projects.

**Priority:** HIGH

---

## Problem 7: No Real-Time Output Streaming

**Current situation:**  
The client POSTs code and receives a single JSON response after the process exits. There is no incremental output — the user sees nothing while the program runs, then gets all output at once.

**Why it matters:**  
For programs that take more than 1–2 seconds, this feels broken. For long-running programs, this model is entirely unworkable.

**What a production system should do:**  
stdout and stderr chunks should be sent to the client as they are emitted by the process, via WebSocket or Server-Sent Events.

**Recommended direction:**  
Use Socket.IO (already installed) to emit `process:output` events from the backend as each `data` chunk arrives on the child process stdout/stderr stream.

**Priority:** HIGH

---

## Problem 8: No Rate Limiting — Open Invitation for Abuse

**Current situation:**  
No rate limiting exists on any endpoint: auth, execution, OCR, file operations. The Gemini API key is used with no per-user request tracking.

**Why it matters:**  
An attacker can:
- Brute-force login credentials
- Send thousands of execution requests (resource exhaustion)
- Exhaust the Gemini API quota and billing limit
- Create unlimited accounts

**What a production system should do:**  
Rate limiting at multiple layers: per-IP for auth, per-user for execution and AI endpoints, with daily/hourly quotas.

**Recommended direction:**  
Use `express-rate-limit` for basic per-IP limiting. Add Redis-backed per-user counters for per-user execution quotas.

**Priority:** HIGH

---

## Problem 9: No Observability — Cannot Debug Production Issues

**Current situation:**  
`console.log` and `console.error` are the only instrumentation. There is no structured logging, no error tracking, no metrics, no health checks.

**Why it matters:**  
When an execution fails silently in production, there is no way to know why. Debugging requires SSH access and reading raw server logs. No visibility into execution latency, failure rates, or resource usage.

**What a production system should do:**  
Structured JSON logs, basic metrics (execution count, failure rate, latency), error reporting, and `/health` endpoints for uptime monitoring.

**Recommended direction:**  
Use `pino` for structured logging. Add a simple `GET /health` endpoint. Integrate Sentry (free tier) for error tracking. Use Prometheus-compatible metrics or a simple dashboard.

**Priority:** MEDIUM-HIGH

---

## Problem 10: AI Features Are Minimal and Architecturally Weak

**Current situation:**  
The only AI feature is image-to-code OCR. There is no AI coding assistant, no code explanation, no debugging help. The language is parsed by a fragile string-split heuristic from the first line of the model's output.

**Why it matters:**  
The AI integration is a key differentiating feature, but it's barely functional. The language detection is unreliable. There is no streaming for AI responses (the user waits for the entire response). There is no AI chat, which is now a baseline expectation for any coding tool.

**What a production system should do:**  
A proper AI assistant with streaming responses, context-aware code generation, and a structured prompt pipeline that includes the active file's content.

**Recommended direction:**  
Add a streaming AI chat endpoint using Gemini's streaming API. Send structured context (current file content, language, error output) rather than raw prompts. Add language detection as a proper classification step, not a string parse.

**Priority:** MEDIUM-HIGH

---

## Problem 11: Frontend State Not Persisted Across Reloads

**Current situation:**  
Open tabs, editor content, and active file are all stored in Redux in-memory. A page reload loses all open tabs, cursor positions, and any unsaved edits.

**Why it matters:**  
This is a fundamental usability regression compared to real IDEs. Developers expect their workspace to survive a page refresh.

**What a production system should do:**  
Open tabs and last-active-file should be persisted (localStorage or backend). Unsaved content should be auto-saved to a draft in localStorage before being committed to the server.

**Recommended direction:**  
Use `redux-persist` with localStorage for tabs and active file. Add debounced autosave (every 2–3 seconds of inactivity) that PUTs content to the API.

**Priority:** MEDIUM

---

## Problem 12: No Input Validation or Upload Security

**Current situation:**  
The OCR endpoint accepts any base64-encoded data with any MIME type. There is no server-side validation of file size, file type, or content. No file size limit is enforced at the Express level.

**Why it matters:**  
A malicious user can send a 50MB base64 payload, exhausting memory. They can send invalid MIME types to probe the Gemini API. There is no protection against repeated large uploads.

**What a production system should do:**  
Validate MIME type against an allowlist (`image/jpeg`, `image/png`, `image/webp`), enforce a maximum decoded size limit, and reject invalid content before calling the AI API.

**Recommended direction:**  
Add `express-fileupload` or `multer` with size limits. Validate MIME type server-side. Add per-user daily OCR call limits.

**Priority:** MEDIUM

---

## Problem 13: Socket.IO Is Initialized But Does Nothing

**Current situation:**  
Socket.IO server is created in `server.js` but no event handlers are registered on it. `terminalService.js` and `terminalRoutes.js` exist but are completely disconnected. The frontend connects a socket to `localhost:3010` which fails in production.

**Why it matters:**  
The project has a non-functional real-time layer. Features that look real (socket-based file tree refresh, terminal) don't actually work. This is misleading and wastes the Socket.IO dependency.

**What a production system should do:**  
Either fully implement the real-time features that Socket.IO enables, or remove it until it's needed. Half-implemented features are worse than no features.

**Recommended direction:**  
Wire up Socket.IO properly with execution output streaming. Remove the dead `terminalService.js` logic until a proper terminal system is designed and built.

**Priority:** MEDIUM

---

## Problem 14: No CI/CD, No Testing, and Dangerously Manual Deployment

**Current situation:**  
There are no tests (except a placeholder `App.test.js`). Deployment is a manual push to Render. There is no staging environment, no automated test gate, and no rollback procedure.

**Why it matters:**  
Without automated testing, every deployment is a gamble. Without a staging environment, bugs reach users directly. The current execution system bugs (timeout, stdout swap, temp file leak) would have been caught by basic integration tests.

**What a production system should do:**  
At minimum: automated unit tests for the execution service, integration tests for critical API routes, and a CI pipeline (GitHub Actions) that runs tests on every PR.

**Recommended direction:**  
Add Jest for backend unit tests. Add basic API integration tests for auth and execution. Set up GitHub Actions CI. Use Render's preview environments for staging.

**Priority:** MEDIUM
