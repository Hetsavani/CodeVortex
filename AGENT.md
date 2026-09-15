# AGENT.md — Cloud IDE Rebuild

> This file is the instruction set for any AI agent working on this repo. Read it before writing code.

## 1. Context

You are **re-creating a new version** of an existing Cloud IDE project (old code in `Cloud_IDE_frontend/` + `Cloud_IDE_backend/` — CRA + Express JS, unsafe `child_process.spawn` execution). Do **not** patch the old code in place incrementally — the new version is a fresh TypeScript codebase that replaces it.

Old prototype problems: unsandboxed execution on host, no timeout, secrets in git, unauth `/execute`, `stdout/stderr` swap, no streaming, no terminal, fragile file storage (`user.directory` embedded), no rate limiting/observability/tests.

Goal: production-grade demo that passes the test **"would a developer use this over a local terminal?"** — built by 1 dev in 6 weeks (or 7 days × 2hr sprint if time-boxed).

## 2. Blueprint — Docs Folder is Source of Truth

All design decisions are in `docs/` — do not invent architecture.

| Doc | Use it for |
|---|---|
| `docs/engineering/README.md` | Master index, start here |
| `docs/engineering/tech-stack.md` | **Single source of tech stack** — every lib/version lives here |
| `docs/engineering/architecture.md` | Target monolith + Redis + Docker + Socket.IO + lifecycle diagrams |
| `docs/engineering/execution-system.md` | Docker isolation (5 layers, threat model) |
| `docs/engineering/realtime-execution.md` | Process states, `exec:*`/`term:*` protocol, PTY, replay |
| `docs/engineering/execution-flow.md` + `diagrams/execution-sequence.mmd` | End-to-end sequences (auth, save, exec, terminal, AI, reconnect) |
| `docs/engineering/frontend.md` | IDE layout, resizable panels, terminal, AI panel, UX fixes |
| `docs/engineering/storage.md` | `users/projects/files/execution_logs` + Redis keys + R2 |
| `docs/engineering/security.md` | Secrets, auth, Docker isolation, rate limits, CORS, helmet |
| `docs/engineering/scalability.md` | BullMQ queue, concurrency, backpressure, what to defer |
| `docs/engineering/deployment.md` | `docker-compose.dev.yml`, Dockerfiles, nginx WS proxy, GH Actions |
| `docs/engineering/observability.md` | pino + Sentry + prom-client + `/health` |
| `docs/engineering/testing.md` | Vitest/Supertest/Playwright pyramid |
| `docs/engineering/ai.md` | Gemini SSE chat + OCR JSON parsing |
| `docs/engineering/roadmap.md` | 6-week phases |
| `docs/engineering/weekly-sprint.md` | 7-day × 2hr executable plan (TS edition) |
| `docs/engineering/advanced-concepts.md` | Ranked 11 concepts with priorities |
| `docs/engineering/not-worth-building.md` | **What NOT to build** — mandatory |
| `docs/azure-vs-cloudflare-comparison.md` | Infra cost comparison |

If docs conflict, priority: `tech-stack.md` > `architecture.md` > `weekly-sprint.md` > other docs. Ask before deviating.

## 3. What NOT to Do (from `not-worth-building.md`)

Do not add these — they add burden without solving a current problem:

- **Kubernetes / Docker Swarm / Service Mesh** → use Docker Compose on VPS
- **Kafka / RabbitMQ** → use BullMQ + Redis
- **Microservices** → keep Express monolith + optional worker process
- **RAG / Vector DB / Embeddings** → include active file content directly in prompt
- **Event Sourcing / CQRS** → simple MongoDB CRUD + `file_versions` last-10
- **GraphQL** → REST with typed Zod schemas
- **Unbounded caching** (file content/tree/user) → only cache `rate:*`, `process:*`, `terminal:*`, buffers
- **Autonomous AI agents** (write-enabled) → streaming chat + explain-error only, until sandbox is hardened

Rule: every tech must solve a real, measurable problem now.

## 4. How Things Should Be Done

**TypeScript everywhere.** No `.js` files. `strict: true` in `tsconfig.json`. Shared Zod schemas for request/response. Path alias `@/*` → `src/*`.

**Stack adhesion:** use only libs listed in `tech-stack.md`. If you need a new dep, update that file first and justify.

**Architecture adhesion:**
- Frontend: Vite (not CRA) → `VITE_API_URL`/`VITE_SOCKET_URL`; Tailwind + shadcn/ui (Radix); Monaco only (remove ace/prism); Redux Toolkit + redux-persist; xterm.js + FitAddon
- Backend: Express TS via `tsx watch src/server.ts` → `tsc` build → `node dist/server.js`; Socket.IO rooms; Docker via `dockerode` with flags `--network=none --memory=128m --cpus=0.5 --pids-limit=50 --read-only --cap-drop=ALL --security-opt no-new-privileges`; Redis (`ioredis`) for `process:*`/`terminal:*`/`rate:*`/buffer; BullMQ only Phase 2
- Streaming first: exec output and AI chat are SSE/Socket.IO streaming, not buffered
- Security first: secrets via `process.env` only (base64 Firebase), access (15m) + refresh (7d rotating, HttpOnly) JWT + ownership checks, `helmet`, CORS allowlist, per-IP + per-user rate limits, 15s timeout, input validation via Zod

**Phased build:** follow `weekly-sprint.md` (Day1 security → Day5 frontend → Day2 Redis/logging → Day4 streaming → Day3 Docker → Day6 PTY → Day7 AI). Don't jump to Phase 3 before Phase 1 is green.

## 5. Coding Conventions & Consistency

- **Naming:** `PascalCase` components (`TerminalPanel.tsx`), `camelCase` vars/fns, `kebab-case` files for utils, `SCREAMING_SNAKE` for env. No abbreviations.
- **Structure (in `CodeVortex/`):** `backend/src/routes/*.ts` → `backend/src/controllers/*.ts` → `backend/src/services/*.ts` → `backend/src/models/*.ts` → `backend/src/middleware/*.ts` → `backend/src/config/*`. Frontend: `frontend/src/components/{Editor,Terminal,AI,Explorer}/`, `frontend/src/store/`, `frontend/src/hooks/`, `frontend/src/lib/`, `frontend/src/types/`.
- **Types:** export `types.ts` per domain; no `any`; use `unknown` + Zod parse at boundaries. Socket events typed in `src/types/socket.ts`.
- **Validation:** Zod at every boundary (HTTP body, query, env, Socket payload). `zod` schemas are the contract.
- **Errors:** `AppError` class with `statusCode`; centralized `errorMiddleware`. Never leak stack in prod.
- **Logging:** `pino` only — no `console.log`. `logger.info({ userId, processId }, 'msg')`. Remove debug logs before commit.
- **Styling:** Tailwind only; no inline `style` except xterm container. Use `cn()` from `src/lib/utils.ts` (shadcn).
- **State:** Redux slices with typed `RootState`/`AppDispatch`; `redux-persist` whitelist `['tabs','activeTab']`; debounced autosave 2s via `use-debounce`.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`); run `npm run lint && npm run typecheck` before push (see `AGENTS.md` lint commands if added).
- **Env:** never commit `.env`; commit `.env.example` with all keys empty + comments. Use `process.env.VITE_*` in frontend, `process.env.*` via Zod-validated `src/config/env.ts` in backend.
- **Tests:** Vitest + Supertest + Playwright; colocate `__tests__/` or `*.test.ts` next to source; target coverage in `testing.md`.

## 6. Workflow for Agents

1. Read `tech-stack.md` + relevant doc before coding.
2. Search existing code before adding new logic — reuse `lib/utils`, `middleware/auth.ts`, `config/redis.ts`, `config/logger.ts`.
3. Write TS with types + Zod; no JS.
4. Verify with `npm run lint`, `npm run typecheck`, `npm run test` (or `vitest run`).
5. Update docs if you change stack/architecture.
6. Never add a tech from the NOT-to-build list without explicit user approval.
