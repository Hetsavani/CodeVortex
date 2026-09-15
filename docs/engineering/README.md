# CodeVortex Engineering Blueprint

> **Start here.** This is the master index for all engineering documentation.

---

## Current State

CodeVortex is a functional Cloud IDE prototype with:
- Monaco editor + multi-tab file management
- Multi-language code execution (JS, Python, Java, C, C++)
- File tree explorer (MongoDB-backed)
- JWT authentication + Google OAuth
- Image-to-code extraction via Gemini Vision
- Socket.IO initialized (but not wired up)

**The problem**: The current system is a prototype with critical security flaws (code runs unsandboxed on the host server), no streaming, no real terminal, and fragile architecture throughout.

→ See [`current-state.md`](current-state.md) for a detailed analysis.

---

## Biggest Problems (Top 5)

| # | Problem | Severity |
|---|---|---|
| 1 | **User code executes directly on the host server** — no isolation, no limits | CRITICAL |
| 2 | **No execution timeout** — infinite loops hang the server for all users | CRITICAL |
| 3 | **Firebase key + MongoDB credentials committed to git** | CRITICAL |
| 4 | **Execution endpoint has no authentication** — publicly accessible RCE | CRITICAL |
| 5 | **No long-running process support** — only short scripts work | HIGH |

→ See [`problems.md`](problems.md) for all 14 identified problems with full analysis.

---

## Target Product

A browser-based development environment that a developer would actually use:

- **Real Monaco editor** with autosave, tab persistence, unsaved indicator
- **Interactive terminal** (xterm.js + PTY) that runs `python repl`, `npm run dev`, any interactive program
- **Streaming code execution** — output appears as the process runs, not after it exits
- **Sandboxed execution** — user code can't harm the server or other users
- **AI chat assistant** — streaming responses, context-aware (includes current file)
- **Proper file system** — files/projects as first-class database entities, not embedded JSON

→ See [`target-product.md`](target-product.md) for the full product definition with prioritized features.

---

## Target Architecture

```
Browser (React TS + Vite + Monaco + xterm.js)
           │
           │  HTTP REST + Socket.IO
           ▼
Express API Server (TypeScript monolith, tsx)
     │         │         │
     ▼         ▼         ▼
MongoDB    Redis    Docker Engine
Atlas      Cache    (Execution)
            State         │
                          ▼
                    Sandboxed Containers
                    (per execution/terminal)
```

> **TypeScript everywhere** — see [`tech-stack.md`](tech-stack.md) for the single source of truth (Vite, Tailwind, shadcn/ui, Monaco, Redux Toolkit, Socket.IO, Express TS, pino, BullMQ, Gemini, etc.).

**Key design decisions**:
- **Monolith first** — no premature microservices
- **Redis for shared state** — execution state, rate limits, session data
- **Docker for isolation** — every execution is a sandboxed, ephemeral container
- **Socket.IO for real-time** — streaming output, terminal I/O
- **BullMQ queue** (Phase 2) — decouples execution from API serving

→ See [`architecture.md`](architecture.md) for full component diagrams and communication patterns.

---

## Most Valuable Technical Improvements

Ranked by engineering impact × implementation value:

| Rank | Improvement | Documents |
|---|---|---|
| 1 | Docker sandboxed execution (cgroups, no host access) | [`execution-system.md`](execution-system.md) |
| 2 | Real-time streaming output via Socket.IO | [`realtime-execution.md`](realtime-execution.md) |
| 3 | Interactive PTY terminal (xterm.js + node-pty) | [`realtime-execution.md`](realtime-execution.md) |
| 4 | Job queue with worker pool (BullMQ + Redis) | [`scalability.md`](scalability.md) |
| 5 | Redis rate limiting (per-user sliding window) | [`security.md`](security.md) |
| 6 | Process supervision & orphan cleanup | [`realtime-execution.md`](realtime-execution.md) |
| 7 | AI chat with streaming SSE | [`ai.md`](ai.md) |
| 8 | Structured logging + observability (pino + Sentry) | [`observability.md`](observability.md) |
| 9 | Tab persistence + autosave (redux-persist) | [`frontend.md`](frontend.md) |
| 10 | Storage refactor (files/projects as collections) | [`storage.md`](storage.md) |

---

## Advanced Engineering Concepts

| Concept | Engineering Value | Priority |
|---|---|---|
| Docker container isolation (cgroups, namespaces) | Critical | P1 |
| Real-time streaming (Socket.IO + Node streams) | Very High | P1 |
| PTY terminal (node-pty, ANSI protocol) | Very High | P2 |
| Job queue (BullMQ, dead-letter, backpressure) | High | P2 |
| Redis rate limiting (atomic counters, sliding window) | Medium-High | P1 |
| Process registry + orphan detection | High | P2 |
| AI streaming (SSE, context management, token limits) | Medium | P3 |
| OpenTelemetry distributed tracing | High | P3 |
| Output buffer with reconnection replay | Medium-High | P3 |

→ See [`advanced-concepts.md`](advanced-concepts.md) for full concept-by-concept analysis.

---

## 6-Week Implementation Roadmap

```
Week 1  │ Phase 1: Security + Foundations
        │ ├── Credential rotation (IMMEDIATE)
        │ ├── Critical bug fixes (auth on /execute, timeout, bugs)
        │ ├── Rate limiting (express-rate-limit + Redis)
        │ ├── Structured logging (pino) + error tracking (Sentry)
        │ └── Frontend: tab persistence, autosave, fix editor height

Week 2-3│ Phase 2: Secure Execution Architecture
        │ ├── Docker sandboxed execution (dockerode, security flags)
        │ ├── Socket.IO streaming output (exec:output, exec:done)
        │ ├── BullMQ job queue + worker process
        │ └── Process supervision + orphan cleanup

Week 4  │ Phase 3: Interactive Terminal
        │ ├── node-pty backend + Docker exec integration
        │ └── xterm.js frontend + Socket.IO terminal events

Week 5  │ Phase 4: IDE Layout & UX
        │ ├── react-resizable-panels layout
        │ ├── Bottom panel (Terminal | Output | Problems)
        │ ├── File context menu + inline create/rename
        │ └── Status bar, keyboard shortcuts

Week 6  │ Phase 5: AI + Storage
        │ ├── Storage refactor (projects/files collections + migration)
        │ ├── AI streaming chat (SSE endpoint + frontend component)
        │ ├── Fixed OCR language detection
        │ └── Observability (prom-client + Grafana)
```

→ See [`roadmap.md`](roadmap.md) for the full 6-week plan with daily task breakdowns.

---

## Document Index

| Document | Description |
|---|---|
| [`current-state.md`](current-state.md) | Current architecture, capabilities, limitations, and 8 real bugs |
| [`problems.md`](problems.md) | 14 biggest problems preventing production readiness |
| [`target-product.md`](target-product.md) | Full product definition with prioritized features |
| [`architecture.md`](architecture.md) | Target system architecture with component and sequence diagrams |
| [`execution-system.md`](execution-system.md) | Secure Docker-based execution design with threat model |
| [`realtime-execution.md`](realtime-execution.md) | Process lifecycle, PTY terminal, WebSocket protocol, reconnection |
| [`scalability.md`](scalability.md) | Distributed systems concepts: queue, workers, backpressure, caching |
| [`storage.md`](storage.md) | Data model, MongoDB schema, Redis keys, storage migration plan |
| [`ai.md`](ai.md) | AI features: streaming chat, OCR improvements, context management |
| [`security.md`](security.md) | Full security model: secrets, auth, isolation, rate limiting, CORS |
| [`observability.md`](observability.md) | Logging, metrics, tracing, health checks |
| [`frontend.md`](frontend.md) | IDE layout, terminal, AI panel, UX improvements |
| [`testing.md`](testing.md) | Unit, integration, security, concurrency, and E2E test strategy |
| [`deployment.md`](deployment.md) | Docker Compose, CI/CD, VPS deployment, rollback procedure |
| [`advanced-concepts.md`](advanced-concepts.md) | Ranked advanced engineering concepts to implement |
| [`not-worth-building.md`](not-worth-building.md) | What to explicitly avoid (K8s, Kafka, microservices, RAG) |
| [`roadmap.md`](roadmap.md) | 6-week implementation plan with phases, tasks, and priorities |
| [`tech-stack.md`](tech-stack.md) | **Single source of truth** — all tech (TypeScript, Vite, Tailwind, shadcn/ui, Monaco, xterm.js, Express TS, Redis, Docker, Gemini, etc.) |
| [`weekly-sprint.md`](weekly-sprint.md) | 7-day × 2hr/day executable sprint (now TypeScript edition) |

---

## Final Goal

After implementing this roadmap, CodeVortex demonstrates:

> **"A production-grade Cloud IDE built by one developer that shows real engineering depth across secure distributed execution, real-time systems, AI integration, and modern frontend engineering — using technologies that solve actual problems rather than resume-driven architecture."**

Specifically, it demonstrates:
- **Security engineering**: Container isolation, cgroup limits, secret management, auth at every layer
- **Distributed systems**: Redis-backed state, BullMQ queue, process supervision, orphan cleanup
- **Real-time systems**: Socket.IO streaming, PTY terminals, reconnection with output replay  
- **Backend engineering**: Structured observability, health checks, proper data model, rate limiting
- **AI integration**: Context-aware streaming chat, robust vision-to-code, token management
- **Production frontend**: Persistent workspace, interactive terminal, professional IDE UX
- **DevOps**: Docker Compose, CI/CD, health monitoring, zero-downtime deployment

Each of these is implemented because it solves a real problem — not to fill out a buzzword checklist.
