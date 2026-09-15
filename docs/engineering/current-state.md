# Current State Analysis

## Current Architecture

### Frontend
- **Framework**: React (CRA) with Redux Toolkit for state management
- **Editor**: `@monaco-editor/react` — Monaco editor embedded inside a fixed `400px` height container
- **Routing**: React Router DOM
- **Styling**: Tailwind CSS (class-based, mixed with inline styles)
- **Real-time**: `socket.io-client` is imported and connected at startup, but **unused for code execution** — it only emits `set:user` and listens for `file:update` tree refreshes
- **Auth state**: JWT token stored in `localStorage`; username stored in `sessionStorage`
- **State**: Redux manages open tabs, active file, and file content only (no persistence across reloads)

### Backend
- **Runtime**: Node.js + Express
- **Database**: MongoDB Atlas via Mongoose
- **Auth**: JWT (jsonwebtoken) + bcryptjs; Google OAuth via Firebase Admin SDK
- **Real-time**: Socket.IO server is initialized but no socket event handlers are registered for execution or terminal
- **Deployment**: Deployed to Render (free tier); frontend connects to `https://cloude-ide-backend.onrender.com`

### Execution Mechanism
The current execution model is a synchronous request-response cycle:

```
POST /api/execute/run
  → execCode() in codeExecutionService.js
  → Node.js child_process.spawn() on the SERVER host (no isolation)
  → Collect all stdout/stderr
  → Resolve promise when process exits
  → Return JSON { stdout, stderr, exit_code, execution_time }
```

- **No timeout**: A process that runs forever will hang the request indefinitely
- **No isolation**: Code runs directly on the Node.js server process, same user, same filesystem
- **No sandboxing**: Malicious code can access server files, env vars, network, etc.
- **Languages supported**: JavaScript (node -e), Python (python -c), Java (javac + java), C++ (g++), C (gcc)
- Compiled languages write temp files to `os.tmpdir()`

### AI / API Integration
- Google Gemini API (`gemini-2.5-flash`) used for image-to-code OCR
- **API key is stored in the backend `.env` file** — correct placement
- The OCR endpoint (`POST /api/ocr/extract-code`) accepts base64-encoded image data from the frontend
- No AI coding assistant, no chat, no code explanation features
- No rate limiting on AI calls

### Image Upload
- Client selects a file, `FileReader` converts it to base64 in the browser
- Base64 string + MIME type POSTed directly to backend
- Backend calls Gemini vision model, returns extracted code as text
- The extracted code is parsed for a language hint on the first line (fragile string parsing)
- No file size validation on the server
- No file type validation on the server

### Persistence / Storage
- **File system**: Entire user workspace is stored as a deeply nested JSON document inside a single MongoDB `User` document (`directory` field of recursive `folderSchema`)
- **No separate file or project model** — everything is embedded in the User document
- File contents are strings stored in MongoDB — no object storage, no S3
- Tabs/open editors are Redux in-memory only; they reset on page reload

### Deployment
- Backend: Render.com (free tier, cold starts expected)
- Frontend: Likely Vercel or Netlify (not confirmed in repo)
- Database: MongoDB Atlas free tier
- No CI/CD configuration found
- Firebase credentials JSON file (`codevortex-f9667-firebase-adminsdk-...json`) committed to git

---

## Current Capabilities

- User registration and login (email/password + Google OAuth)
- Persistent file system per user (files and folders stored in MongoDB)
- Multi-file editor with tabs (Monaco editor)
- Ctrl+S save with PUT to API
- File tree explorer: create file, create folder, delete file, delete folder
- Code execution for JS, Python, Java, C, C++ (sync request-response)
- Pre-execution stdin input (passed before process starts)
- Image-to-code extraction using Gemini Vision (handwritten/printed code photos)
- Dark/light theme toggle (persisted to localStorage)
- Socket.IO initialized (but no production socket logic wired up)

---

## Current Limitations

### Critical Security
- **No execution isolation**: User code runs directly on the Express server process. A user can read server files, environment variables, kill the process, fork-bomb the server, or exfiltrate secrets.
- **No resource limits**: No CPU time limit, no memory limit, no process count limit, no disk write limit.
- **Firebase service account key committed to git** (`codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json`) — **this is a critical secret leak**.
- **MongoDB credentials hardcoded in `config/db.js`** (also in `.env`) — double exposure.
- **Execution endpoint has no auth middleware** — any anonymous request can trigger code execution on the server.
- **No file upload validation** — any base64-encoded data can be sent to the OCR endpoint.
- **CORS is fully open** (`origin: "*"`) on both Express and Socket.IO.
- **No rate limiting** anywhere — execution, auth, or OCR endpoints.

### Architecture
- No real terminal support — the `terminalService.js` and `terminalRoutes.js` exist but are completely disconnected from the running server (the WebSocket server has no event handlers registered).
- No support for long-running processes (servers, watchers, interactive programs).
- No process lifecycle management (start, pause, stop, reconnect).
- Execution result is buffered in memory — no streaming to the client.
- Socket.IO is initialized in `server.js` but emits nothing and handles nothing.

### Storage
- Storing all file content inside a single MongoDB document is an anti-pattern. A document can grow to MongoDB's 16MB BSON limit with large projects.
- No versioning, no snapshots, no history.
- No object storage for uploaded images.

### Frontend
- Editor height is hardcoded at `400px`.
- No autosave (only manual Ctrl+S or on tab close).
- No unsaved-changes indicator.
- No command palette.
- No keyboard shortcut system.
- `console.log` debug statements scattered throughout production code.
- `class` used instead of `className` in some JSX (e.g., `Editor.js:332`).
- Duplicate run button rendered twice in the editor toolbar area.
- Socket connected at app startup regardless of whether it's needed.
- Tab content is Redux in-memory only — browser refresh loses all open tabs.

### Observability
- No structured logging.
- No error tracking (Sentry etc.).
- No metrics collection.
- No health check endpoints.
- `console.log` / `console.error` is the only "logging".

---

## Important Existing Bugs

### Bug 1: Firebase Service Account Key in Git

**Problem**: `codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json` is committed to the repository.  
**Location**: `/Cloud_IDE_backend/codevortex-f9667-firebase-adminsdk-fbsvc-04726e35f2.json`  
**Why it happens**: Developer placed credentials in repo root instead of using environment variables.  
**Impact**: Anyone with repo access (or if repo is public) has full Firebase Admin SDK access — can read/write all Firebase project data, impersonate users, etc.  
**Recommended fix**: Remove file from git, add to `.gitignore`, pass credentials via `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to an external path, or use a base64-encoded env var.

---

### Bug 2: MongoDB Credentials Hardcoded in Source

**Problem**: Connection string with username/password hardcoded directly in `config/db.js` line 8 (in addition to `.env`).  
**Location**: `Cloud_IDE_backend/config/db.js:8`  
**Why it happens**: Developer bypassed `process.env.MONGO_URI` (commented out) and hardcoded the value.  
**Impact**: Anyone reading source code has database credentials. If repo becomes public, the entire database is compromised.  
**Recommended fix**: Use `process.env.MONGO_URI` exclusively. Rotate credentials immediately.

---

### Bug 3: Execution Endpoint Has No Authentication

**Problem**: `POST /api/execute/run` has no auth middleware — any anonymous user or bot can execute arbitrary code on the server.  
**Location**: `Cloud_IDE_backend/Routes/executionRoutes.js:22`  
**Why it happens**: Auth middleware was commented out during development.  
**Impact**: The server can be used as a free, anonymous remote code execution engine by anyone who discovers the endpoint URL.  
**Recommended fix**: Re-add `authMiddleware` to the execution route immediately.

---

### Bug 4: No Execution Timeout — Infinite Loop Hangs Server

**Problem**: `execCode()` in `codeExecutionService.js` spawns a child process with no timeout. A program with an infinite loop (or `while True: pass`) will hang the HTTP request handler indefinitely.  
**Location**: `Cloud_IDE_backend/Services/codeExecutionService.js`  
**Why it happens**: No `setTimeout` to kill the process, no `options.timeout` passed to `spawn`.  
**Impact**: On a single-instance server, even one bad request can exhaust the event loop, making the server unresponsive to all other users.  
**Recommended fix**: Kill the child process after N seconds (e.g., 10s) and return a timeout error response.

---

### Bug 5: Stdout/Stderr Swap on Non-Zero Exit Code

**Problem**: In `execCode()`, when `exit code !== 0`, the resolved object has `stdout: stderrData.trimEnd()` (stderr in the stdout field).  
**Location**: `Cloud_IDE_backend/Services/codeExecutionService.js:235`  
**Why it happens**: Copy-paste bug. Line 235: `stdout: stderrData.trimEnd()` should be `stdout: stdoutData.trimEnd()`.  
**Impact**: For programs that write to both stdout and stderr before a non-zero exit, the client receives the stderr content in the `stdout` field and never sees the actual stdout.  
**Recommended fix**: Change line 235 to `stdout: stdoutData.trimEnd()`.

---

### Bug 6: Temp File Cleanup Uses Wrong Filename for C/C++

**Problem**: Cleanup code on process exit uses the hardcoded string `"program.exe"` instead of the actual compiled output path variable.  
**Location**: `Cloud_IDE_backend/Services/codeExecutionService.js:212`  
**Why it happens**: The cleanup logic checks `language === "c++"` but the language value is `"cpp"`, so the `.exe` file is never cleaned up. Also uses `"program.exe"` not `cOutputPath`.  
**Impact**: Temp directory slowly fills with compiled executables from every C/C++ execution. On a busy server this causes disk exhaustion.  
**Recommended fix**: Use `cOutputPath` / `cppOutputPath` variables that were already computed, and fix the language string comparison.

---

### Bug 7: Socket.IO Connected at App Startup Unconditionally

**Problem**: `Socket.js` connects to `SOCKET_URL` (`http://localhost:3010`) immediately when the module is imported. This URL is localhost — different from the production API URL — causing silent connection failure.  
**Location**: `Cloud_IDE_frontend/src/Socket.js` and `src/config.js`  
**Why it happens**: Socket URL wasn't updated to match the deployed backend, and the socket is eagerly connected.  
**Impact**: Socket connection fails silently on every page load in production. Any feature relying on socket events will never work.  
**Recommended fix**: Point `SOCKET_URL` to the production backend; lazy-connect the socket only when needed.

---

### Bug 8: `class` Instead of `className` in JSX (React Warning / Bug)

**Problem**: Multiple JSX elements in `Editor.js` use `class=` instead of `className=`, which produces React warnings and can cause styling failures.  
**Location**: `Cloud_IDE_frontend/src/Components/Editor/Editor.js:332–408`  
**Why it happens**: HTML attributes pasted into JSX without conversion.  
**Impact**: Browser console warnings, potential React reconciliation issues, style may not apply correctly.  
**Recommended fix**: Replace all `class=` with `className=` in JSX.
