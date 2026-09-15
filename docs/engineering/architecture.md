# Target Architecture

## Design Principles

1. **Realistic for one developer** — no unnecessary microservices
2. **Every component earns its place** — exists only to solve a real problem
3. **Stateless API layer** — horizontal scalability is possible even with a single server
4. **Security-first execution** — all user code is treated as malicious by default
5. **Progressive complexity** — start with a solid monolith, extract components only when needed

---

## High-Level Architecture Overview

```
                        ┌─────────────────────────────────────┐
                        │           Browser Client             │
                        │                                      │
                        │  Monaco Editor  │  xterm.js Terminal │
                        │  AI Chat Panel  │  File Explorer      │
                        └────────────────────────┬────────────┘
                                                  │
                               HTTP REST  +  Socket.IO
                                                  │
                        ┌─────────────────────────▼────────────┐
                        │         Express API Server            │
                        │                                       │
                        │  /api/auth      → Auth Controller     │
                        │  /api/files     → File Controller     │
                        │  /api/execute   → Execution Controller│
                        │  /api/ai        → AI Controller       │
                        │  /api/projects  → Project Controller  │
                        │                                       │
                        │  Socket.IO:                           │
                        │    execution:start / output / done    │
                        │    terminal:input / output / resize   │
                        └──────┬───────────────────┬───────────┘
                               │                   │
              ┌────────────────┘                   └────────────────────┐
              │                                                          │
    ┌─────────▼──────────┐                              ┌───────────────▼──────┐
    │   MongoDB Atlas     │                              │   Execution Layer    │
    │                     │                              │                      │
    │  Users              │                              │  Docker Engine       │
    │  Projects           │                              │  (on same host or    │
    │  Files (metadata)   │                              │   worker VM)         │
    │  ExecutionLogs      │                              │                      │
    └─────────────────────┘                              └───────────────┬──────┘
                                                                         │
                                                         ┌───────────────▼──────┐
              ┌──────────────────────────────────────────│  Sandboxed Containers│
              │                                          │                      │
    ┌─────────▼──────────┐                              │  Per-Execution:      │
    │   Redis             │                              │  • Ephemeral         │
    │                     │                              │  • No network        │
    │  Session cache      │                              │  • cgroups limits    │
    │  Rate limit state   │                              │  • Destroyed after   │
    │  Execution state    │                              └──────────────────────┘
    │  (running PIDs)     │
    └─────────────────────┘
```

---

## Component Breakdown

### Browser Client
**What it is**: Vite + React (TypeScript) SPA with Monaco editor and xterm.js; Tailwind CSS + shadcn/ui  
**Why it exists**: The IDE interface — editor, terminal, file explorer, AI chat  
**Communication**: HTTP REST (typed via Zod) for CRUD; Socket.IO for real-time output streaming, terminal I/O  
**State**: Redux Toolkit + `redux-persist` (open tabs survive reload)  
**Stateless**: Yes — all durable state is in the API  
**Build**: `vite build` → Cloudflare Pages; env via `VITE_API_URL` / `VITE_SOCKET_URL`

---

### Express API Server
**What it is**: Node.js 20 + Express (TypeScript, run via `tsx watch src/server.ts`, built with `tsc`) monolith handling all API routes and Socket.IO  
**Why it exists**: Central coordination point for all client requests  
**Communication**:
- Receives REST from browser, returns JSON
- Receives Socket.IO connections, maintains room-based sessions per user
- Calls Docker Engine to spawn/manage containers
- Reads/writes MongoDB and Redis

**Should be stateless?**: Mostly yes. The one exception is in-flight execution state, which must be stored in Redis (not in process memory) to support restart without losing running processes.

**Key design choice**: At the current scale, keeping this as one server is correct. Don't split it into microservices until execution load is the bottleneck.

---

### MongoDB Atlas
**What it stores**:
- `users`: id, email, hashed_password, created_at
- `projects`: id, user_id, name, created_at, settings
- `files`: id, project_id, path, name, language, content (small files only), size, created_at, updated_at
- `execution_logs`: id, user_id, project_id, language, exit_code, duration_ms, created_at

**Why MongoDB**: Already in use; flexible schema fits the nested file tree naturally when moved to a proper model. For this scale, Mongo is appropriate.

**Large files**: Files over 100KB should go to object storage, with only a reference stored in MongoDB.

---

### Redis
**What it stores**:
- Rate limit counters (per user, per endpoint, with TTL)
- Active execution state: `execution:{executionId}` → `{ pid, containerId, userId, startedAt, status }`
- Active terminal sessions: `terminal:{sessionId}` → `{ containerId, userId, createdAt }`
- Refresh token state: `refresh:{jti}` (TTL 7d) + optional `revoked:access:{jti}` (TTL 15m)
- Short-lived auth session cache (optional, reduces DB lookups)

**Why Redis**: Provides atomic operations for rate limiting, shared state for execution tracking that survives an API server restart, and fast key-value lookups.

**Is Redis strictly necessary right now?**: Rate limiting can start with `express-rate-limit` in-memory. But for execution state tracking (what processes are running?), Redis is the right choice because it allows future horizontal scaling without state loss.

---

### Docker Engine (Execution Layer)
**What it does**: Manages sandboxed container creation, execution, and cleanup  
**Why Docker**: Provides filesystem isolation, resource limits via cgroups, and process isolation via Linux namespaces. It's the industry-standard solution for user code execution at this scale.

**Container lifecycle**:
- Short execution: spawn → run → collect output → destroy
- Interactive/terminal: spawn → attach PTY → stream → destroy on disconnect or explicit kill

**Communication with API**: Via `dockerode` (already in `package.json`) using the Docker socket, or via Docker CLI calls.

---

### Object Storage (Phase 2+)
**What it stores**: Large file contents (> 100KB), uploaded images  
**Why**: MongoDB is not designed for binary blobs. Object storage (S3-compatible — AWS S3, MinIO, Cloudflare R2) provides unlimited scale and cheap storage.  
**When to add**: After Phase 3. Initially, all file content can stay in MongoDB (most code files are tiny).

---

## Communication Protocols

| Path | Protocol | Why |
|---|---|---|
| Browser ↔ API (CRUD) | HTTP REST | Simple, cacheable, stateless |
| Browser ↔ Execution output | Socket.IO | Real-time bidirectional streaming |
| Browser ↔ Terminal I/O | Socket.IO | Low-latency keystrokes and output |
| API → Docker | Unix socket (`dockerode`) | Local IPC, fastest path |
| API → MongoDB | MongoDB driver | Primary database |
| API → Redis | `ioredis` | Cache and state store |

---

## Where Caching Is Useful

| Data | Cache | TTL | Why |
|---|---|---|---|
| Rate limit counters | Redis | 60s–1hr | Atomic, distributed |
| Active execution state | Redis | 30min | Survives API restart |
| File tree | None needed | — | Reads are fast from MongoDB; tree is small |
| Auth token validation | Redis (optional) | 5min | Avoids DB hit on every request |

**What NOT to cache**: File content (stale risk), user data (consistency risk), execution output (already streaming).

---

## Request Lifecycle Diagrams

### Short Code Execution Lifecycle

```
Browser                    API Server                  Docker
  │                            │                           │
  │  POST /api/execute/run     │                           │
  │  {language, code, input}   │                           │
  │──────────────────────────▶│                           │
  │                            │  Validate auth + input    │
  │                            │  Check rate limit (Redis) │
  │                            │  Generate executionId     │
  │                            │                           │
  │  { executionId: "abc123" } │  docker run --rm          │
  │◀──────────────────────────│  --memory=128m            │
  │                            │  --cpus=0.5               │
  │  socket.on("exec:output")  │  --network=none           │
  │                            │──────────────────────────▶│
  │                            │                           │ Run code
  │                            │  Attach stdout/stderr     │ emit chunks
  │                            │◀─────────────────────────│
  │◀── socket emit "output" ───│                           │
  │◀── socket emit "output" ───│                           │
  │◀── socket emit "output" ───│                           │
  │                            │  Process exits / timeout  │
  │                            │  Save log to MongoDB      │
  │◀── socket emit "done" ─────│                           │
  │                            │  docker rm (auto --rm)    │
  │                            │──────────────────────────▶│ Container destroyed
```

---

### Interactive Terminal Session Lifecycle

```
Browser (xterm.js)         API Server                  Docker Container
  │                            │                           │
  │  socket.emit("term:start") │                           │
  │  { projectId }             │                           │
  │──────────────────────────▶│                           │
  │                            │  Create container with    │
  │                            │  workspace volume mounted │
  │                            │  docker run -it ...       │
  │                            │──────────────────────────▶│
  │                            │                           │ /bin/bash started
  │                            │  Attach PTY via node-pty  │
  │  { sessionId: "xyz789" }   │◀──────────── PTY ─────────│
  │◀──────────────────────────│                           │
  │                            │                           │
  │  (user types "ls -la")     │                           │
  │  socket.emit("term:input") │                           │
  │──────────────────────────▶│──── write to PTY ────────▶│
  │                            │                           │ execute ls
  │                            │◀──── PTY output ──────────│
  │◀─ socket emit "term:out" ──│                           │
  │  (xterm.js renders output) │                           │
  │                            │                           │
  │  (user closes tab)         │                           │
  │  socket.emit("term:stop")  │                           │
  │──────────────────────────▶│  docker kill container    │
  │                            │──────────────────────────▶│ Container destroyed
```

---

### File Save Lifecycle

```
Browser                    API Server                  MongoDB
  │                            │                           │
  │  (Ctrl+S / autosave)       │                           │
  │  PUT /api/files/:id/content│                           │
  │  { content: "..." }        │                           │
  │──────────────────────────▶│                           │
  │                            │  Auth middleware           │
  │                            │  Validate content size     │
  │                            │  UPDATE files SET content │
  │                            │──────────────────────────▶│
  │                            │◀──────────────────────────│
  │  { success: true }         │                           │
  │◀──────────────────────────│                           │
  │  (tab dot removed)         │                           │
```

---

## Stateless vs. Stateful Components

| Component | Stateless? | State Location |
|---|---|---|
| API Server | Mostly yes | MongoDB + Redis |
| Browser Client | No | Redux + localStorage |
| Execution Containers | Yes (ephemeral) | Destroyed after use |
| MongoDB | No | Primary data store |
| Redis | No | Ephemeral process state |

---

## Scalability Path

**Phase 1 (Now — single server):**
```
Browser → API Server (+ Docker) → MongoDB + Redis
```

**Phase 2 (If execution load grows):**
```
Browser → API Server → Redis Queue → Execution Worker(s) (with Docker)
```
The API server enqueues execution jobs. Separate worker process(es) consume the queue and manage containers. This separates web serving from resource-intensive code execution without requiring a full microservice split.

**Phase 3 (If users scale significantly):**
```
Multiple API Server instances behind a load balancer
Redis for shared session and Socket.IO state (socket.io-redis adapter)
```

---

## What This Architecture Deliberately Omits

- **Kubernetes**: Overkill for a single-developer project at current scale. Docker Compose is sufficient.
- **Message broker (Kafka, RabbitMQ)**: A Redis-backed queue solves the execution job problem with far less operational complexity.
- **Service mesh**: No multiple services to mesh.
- **Separate auth service**: The Express monolith handles auth fine.
- **CDN**: Nice-to-have after the product is stable; not architectural.
