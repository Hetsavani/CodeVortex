# Real-Time Process Execution & Terminal Design

## How the Current Model Works (and Why It Fails)

The current model is fundamentally synchronous:
```
POST /api/execute/run → block until process exits → return JSON
```

This model fails for any program that:
- Takes more than a few seconds to run
- Outputs progressively (not all at the end)
- Needs stdin while running (e.g., `input()` mid-execution)
- Runs indefinitely (e.g., `python server.py`)
- Is interactive (REPLs, menu-driven programs)

A real Cloud IDE needs to support all of these.

---

## The Process Lifecycle Model

Instead of request-response, treat processes as **persistent entities with a lifecycle**:

```
                     ┌────────────────────────────────────┐
                     │          Process Lifecycle          │
                     └────────────────────────────────────┘

  Client                         API Server                  Docker Container
    │                                │                              │
    │  socket.emit("exec:start")     │                              │
    │  { code, language, projectId } │                              │
    │──────────────────────────────▶│                              │
    │                               │  Create process record       │
    │                               │  processId = uuid()          │
    │                               │  Store in Redis              │
    │                               │  { status: "starting" }     │
    │                               │                              │
    │  { processId: "abc123" }       │  docker run ...             │
    │◀──────────────────────────────│──────────────────────────────▶
    │                               │                              │ RUNNING
    │  Join socket room:            │  Attach stdout/stderr        │
    │  `process:abc123`             │◀─────── data chunks ─────────│
    │                               │                              │
    │◀── "process:output" ──────────│                              │
    │  { chunk: "Hello\n" }         │                              │
    │◀── "process:output" ──────────│                              │
    │                               │                              │
    │  socket.emit("process:stdin") │                              │
    │  { processId, data: "Alice\n"}│                              │
    │──────────────────────────────▶│──── write to stdin ──────────▶
    │                               │                              │ (reads input)
    │◀── "process:output" ──────────│◀─────── "Hello, Alice\n" ────│
    │                               │                              │
    │  socket.emit("process:kill")  │                              │
    │  { processId }                │                              │
    │──────────────────────────────▶│  docker kill container      │
    │                               │──────────────────────────────▶
    │                               │                              │ STOPPED
    │◀── "process:done" ────────────│                              │
    │  { exitCode: -1 }             │  Update Redis: "killed"      │
    │                               │  Save to MongoDB log         │
    │                               │  Container auto-removed      │
```

---

## Process State Machine

```
                ┌──────────┐
                │  QUEUED  │   (created, waiting for container)
                └────┬─────┘
                     │ Container started
                     ▼
                ┌──────────┐
                │ STARTING │   (container running, process not yet executing)
                └────┬─────┘
                     │ Process PID assigned
                     ▼
                ┌──────────┐
                │ RUNNING  │   (active, streaming output)
                └────┬─────┘
          ┌──────────┼─────────────┐
          │          │             │
    Natural exit   Timeout       Kill signal
          │          │             │
          ▼          ▼             ▼
      ┌────────┐ ┌─────────┐ ┌─────────┐
      │  DONE  │ │ TIMEOUT │ │ KILLED  │
      └────────┘ └─────────┘ └─────────┘
          │          │             │
          └──────────┴─────────────┘
                     │
                     ▼
                ┌──────────┐
                │ CLEANED  │   (container removed, Redis key expired)
                └──────────┘
```

### Process State in Redis

```
Key: process:{processId}
TTL: 30 minutes
Value: {
  processId: "abc123",
  userId: "user456",
  projectId: "proj789",
  containerId: "docker-container-id",
  language: "python",
  status: "running",    // queued | starting | running | done | timeout | killed | error
  startedAt: "2024-01-15T10:30:00Z",
  exitCode: null,
  pid: 1234             // PID inside container
}
```

---

## Terminal Sessions (Long-Running / Interactive)

For the integrated terminal (xterm.js), a different model applies: a **PTY (pseudo-terminal)** session.

### What a PTY Does

A PTY gives the process a real terminal interface — ANSI escape codes work, programs that check `isatty()` behave correctly (color output, progress bars, cursor movement). This is what makes `vim`, `htop`, `python` REPL, and colored `ls` output work correctly.

### Required: `node-pty`

`node-pty` is the Node.js binding for the native PTY API. It's used by VS Code's integrated terminal, Theia, and most other browser-based terminals.

```javascript
const pty = require('node-pty');

const shell = pty.spawn('/bin/bash', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: '/workspace',   // User's workspace directory in container
  env: {               // Minimal, safe environment
    HOME: '/home/runner',
    SHELL: '/bin/bash',
    TERM: 'xterm-color',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    // NO server env vars, NO secrets
  }
});
```

### Terminal Session Lifecycle

```
Client                          API Server                     Container
  │                                │                               │
  │  socket.emit("term:start")     │                               │
  │  { projectId, cols, rows }     │                               │
  │──────────────────────────────▶│                               │
  │                               │  Check existing session       │
  │                               │  (allow reconnect to same PTY)│
  │                               │  Create container with        │
  │                               │  user workspace volume        │
  │                               │  node-pty.spawn('/bin/bash')  │
  │                               │──────────────────────────────▶│
  │                               │                               │ bash started
  │  { sessionId: "sess_xyz" }     │                               │
  │◀──────────────────────────────│                               │
  │                               │                               │
  │  (user types "ls")            │                               │
  │  socket.emit("term:input")     │                               │
  │  { sessionId, data: "ls\r" }  │                               │
  │──────────────────────────────▶│                               │
  │                               │  pty.write("ls\r")           │
  │                               │──────────────────────────────▶│
  │                               │                               │ ls executes
  │                               │◀──── pty data event ──────────│
  │◀─── socket "term:output" ─────│                               │
  │  { data: "\r\nfile1.py\r\n" } │                               │
  │  xterm.js writes to terminal  │                               │
  │                               │                               │
  │  (user resizes terminal)      │                               │
  │  socket.emit("term:resize")   │                               │
  │  { cols: 120, rows: 30 }      │                               │
  │──────────────────────────────▶│  pty.resize(120, 30)         │
  │                               │──────────────────────────────▶│ SIGWINCH sent
```

### Terminal Session State in Redis

```
Key: terminal:{sessionId}
TTL: 2 hours (extended on each interaction)
Value: {
  sessionId: "sess_xyz",
  userId: "user456",
  projectId: "proj789",
  containerId: "docker-id",
  ptyPid: 5678,
  cols: 80,
  rows: 24,
  createdAt: "...",
  lastActivity: "..."
}
```

---

## WebSocket Event Protocol

### Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `exec:start` | `{ code, language, stdin?, projectId }` | Start a short execution (requires valid access token in `socket.handshake.auth.token`) |
| `exec:kill` | `{ processId }` | Kill a running execution |
| `term:start` | `{ projectId, cols, rows }` | Start a terminal session |
| `term:input` | `{ sessionId, data }` | Send keystroke(s) to terminal |
| `term:resize` | `{ sessionId, cols, rows }` | Resize the terminal |
| `term:stop` | `{ sessionId }` | Close the terminal session |
| `process:stdin` | `{ processId, data }` | Send stdin to a running process |

### Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `exec:started` | `{ processId }` | Execution started, container running |
| `exec:output` | `{ processId, chunk, stream }` | stdout/stderr chunk (stream: 'stdout'/'stderr') |
| `exec:done` | `{ processId, exitCode, duration }` | Process exited naturally |
| `exec:timeout` | `{ processId }` | Process killed due to timeout |
| `exec:error` | `{ processId, message }` | System-level error starting process |
| `term:output` | `{ sessionId, data }` | PTY output chunk (already ANSI-encoded) |
| `term:ready` | `{ sessionId }` | Terminal session ready for input |
| `term:closed` | `{ sessionId, code }` | Terminal session ended |

---

## Reconnection Design

### Problem
A user refreshes the page or loses connectivity while a process is running. The container keeps running. How does the UI reconnect and resume receiving output?

### Solution: Buffered Output with Replay

1. The API server stores a **ring buffer** of recent output chunks in Redis (max 100KB per process)
2. On reconnect, the client sends `{ sessionId }` or `{ processId }`
3. The server looks up the session in Redis
4. If `status === "running"`:
   - Replay buffered output to the client
   - Resume live streaming
5. If `status === "done"` / `"timeout"` / `"killed"`:
   - Return the final status and exit code

```javascript
// On reconnect:
socket.on('exec:reconnect', async ({ processId }) => {
  const process = await redis.get(`process:${processId}`);
  if (!process) {
    socket.emit('exec:error', { message: 'Session expired' });
    return;
  }
  
  // Replay buffered output
  const buffer = await redis.lrange(`process:buffer:${processId}`, 0, -1);
  for (const chunk of buffer) {
    socket.emit('exec:output', JSON.parse(chunk));
  }
  
  // Subscribe to live output if still running
  if (process.status === 'running') {
    socket.join(`process:${processId}`);
  } else {
    socket.emit('exec:done', { exitCode: process.exitCode });
  }
});
```

---

## Heartbeat / Session Health

- The server sends a `ping` to each active Socket.IO connection every 30 seconds
- If no `pong` received within 60 seconds, the connection is considered dead
- Terminal sessions with no activity for > 30 minutes are automatically closed (container killed)
- Execution processes with no connected clients for > 5 minutes are killed and cleaned up

This prevents orphaned containers from accumulating and avoids resource leaks.

---

## How This Differs From the Current Model

| Aspect | Current | Target |
|---|---|---|
| Execution model | Sync HTTP request | Async socket events |
| Output delivery | Buffered, after exit | Streamed in real-time |
| stdin | Pre-execution only | During execution, any time |
| Long-running | Not supported | Fully supported |
| Interactive programs | Broken | Works correctly via PTY |
| Process termination | Not possible | `exec:kill` event |
| Reconnection | N/A | Buffered output replay |
| Multiple processes | Not possible | Supported |
| Process listing | Not possible | Redis-backed process manager |

---

## Dependencies to Add

| Package | Purpose |
|---|---|
| `node-pty` | PTY creation for interactive terminals |
| `dockerode` | Already present — Docker container management |
| `ioredis` | Redis client (better than `redis` for this use case) |
| `uuid` | Process and session ID generation |
| `socket.io-redis` | (Phase 2) Shared socket state across multiple API servers |

---

## Implementation Notes

1. **`node-pty` must run on the host**, not inside the container. It creates a PTY on the host, then attaches to the container's shell via `docker exec -it`. This keeps the PTY logic in Node.js while the process runs safely inside the container.

2. **Output buffering in Redis**: Use a Redis list as a circular buffer. `RPUSH process:buffer:{id} chunk` + `LTRIM process:buffer:{id} 0 999` keeps the last 1000 chunks. Set a TTL of 1 hour.

3. **One container per terminal session**: Don't share containers between users. Each user terminal gets its own container with its own workspace volume mounted.

4. **Security for terminal sessions**: The terminal session container must have the same security constraints as execution containers — except it needs network access if the user is running a dev server. This is an advanced scenario; initially, disable network for terminal sessions too unless the user explicitly requests a "networked terminal" mode.
