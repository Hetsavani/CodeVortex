# Tech Stack — Single Source of Truth (TypeScript Everywhere)

> All code is TypeScript. No plain `.js` files. Frontend and backend share strict `tsconfig.json`.

## Language & Runtime

| Tech | Version | Purpose |
|---|---|---|
| TypeScript | ^5.5 | Only language for all source code |
| Node.js | 20 LTS (Alpine) | Backend runtime |
| npm | 10 | Package manager |

## Frontend — `Cloud_IDE_frontend/`

| Tech | Version | Why |
|---|---|---|
| Vite | ^6.0 | Build tool / dev server — replaces CRA (`react-scripts`). Fast HMR, native TS, ESM |
| React | ^18.3 | UI framework |
| React Router | ^7.0 | SPA routing |
| TypeScript | ^5.5 | Strict types |
| Tailwind CSS | ^3.4 | Utility styling (replaces inline styles) |
| tailwindcss-animate | ^1.0 | Animation utilities |
| shadcn/ui (Radix UI + CVA) | latest | Headless UI components (Button, Dialog, ContextMenu) — replaces custom divs |
| @monaco-editor/react | ^4.6 | Code editor (VS Code engine) |
| monaco-editor | ^0.52 | Core Monaco |
| @xterm/xterm | ^5.5 | Terminal emulator |
| @xterm/addon-fit | ^0.10 | Terminal auto-fit |
| @xterm/addon-web-links | ^0.11 | Clickable links in terminal |
| @reduxjs/toolkit | ^2.5 | Global state (tabs, files, auth) |
| react-redux | ^9.2 | Redux bindings |
| redux-persist | ^6.0 | Persist tabs/activeTab to localStorage |
| socket.io-client | ^4.8 | Realtime execution + terminal |
| react-resizable-panels | ^2.1 | IDE layout (File Explorer \| Editor \| AI) + Bottom panel |
| react-hot-toast | ^2.4 | Toast notifications (replaces `alert/prompt`) |
| use-debounce | ^10.0 | Debounced autosave (2s) |
| framer-motion | ^11.18 | Login page animations |
| lucide-react | ^0.456 | Icons |
| @heroicons/react | ^2.2 | Alternative icons |
| react-icons | ^5.4 | Icon fallback |
| zod | ^3.23 | Frontend form/env validation (shared with backend) |
| vite-plugin-svgr | ^4.0 | SVG imports |
| ESLint + @typescript-eslint | ^8.0 | Lint |
| Prettier | ^3.3 | Format |
| Vitest + React Testing Library | ^2.0 / ^14 | Unit tests (replaces Jest CRA) |
| Playwright | ^1.48 | E2E |

**Removed vs current:** `react-scripts` (CRA), `ace-builds`, `react-ace`, `react-simple-code-editor`, `prismjs`, `monaco-python` (Monaco handles languages natively).

**Vite env:** `VITE_API_URL`, `VITE_SOCKET_URL` (replaces `REACT_APP_*`).

## Backend — `Cloud_IDE_backend/`

| Tech | Version | Why |
|---|---|---|
| Express | ^4.21 | HTTP framework |
| TypeScript | ^5.5 | Strict types |
| tsx | ^4.19 | Run/build TS directly (`tsx watch src/server.ts`, `tsx --build`) — replaces `node server.js` / `nodemon` |
| Socket.IO | ^4.8 | Realtime `exec:*` / `term:*` |
| Mongoose | ^8.9 | MongoDB ODM |
| ioredis | ^5.4 | Redis client (rate limit, process state, buffer) |
| dockerode | ^4.0 | Docker Engine API (sandboxed execution) |
| node-pty | ^1.0 | PTY for terminal |
| pino + pino-http | ^9.0 | Structured JSON logging |
| @sentry/node | ^8.0 | Error tracking |
| prom-client | ^15.0 | `/metrics` Prometheus |
| express-rate-limit | ^7.4 | IP rate limiting |
| helmet | ^8.0 | Security headers (CSP, HSTS) |
| cors | ^2.8 | CORS allowlist |
| jsonwebtoken | ^9.0 | JWT access (15m) + refresh (7d) auth |
| bcryptjs | ^2.4 | Password hashing |
| cookie-parser | ^1.4 | Parse `refreshToken` HttpOnly cookie |
| zod | ^3.23 | Request/env validation (single source) |
| dotenv | ^16.4 | Env loading |
| @google/generative-ai | ^0.24 | Gemini 2.5 Flash (OCR + chat SSE) |
| firebase-admin | ^13.1 | Google OAuth verification |
| uuid | ^11.0 | `processId` / `sessionId` |
| ws | ^8.18 | Raw WS fallback (if needed) |
| BullMQ | ^5.0 | Job queue (Phase 2) — Redis-backed |
| tsconfig-paths | ^4.2 | Path aliases `@/*` |
| ESLint + @typescript-eslint | ^8.0 | Lint |
| Prettier | ^3.3 | Format |
| Vitest + Supertest | ^2.0 / ^7.0 | Unit + integration tests |
| @types/* | latest | Types for express, node, jsonwebtoken, bcryptjs, dockerode, node-pty, etc. |

**Scripts (`package.json`):**
```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/server.js",
  "lint": "eslint src --ext .ts",
  "test": "vitest run --coverage"
}
```

## Shared

| Tech | Purpose |
|---|---|
| Zod schemas (`packages/shared` or `src/types`) | Shared validation: `ExecuteRequest`, `FileCreate`, `ChatRequest` |
| TypeScript strict mode | `strict: true`, `noImplicitAny`, `exactOptionalPropertyTypes` |
| Path alias `@/*` | `src/*` imports |

## Infrastructure & Services

| Tech | Purpose |
|---|---|
| Docker + Docker Compose | Local dev (`docker-compose.dev.yml`) + prod deploy; code-runner images (`python:3.12-alpine`, `node:20-alpine`, `eclipse-temurin:21-alpine`, `gcc:13-alpine`) |
| MongoDB Atlas | `users`, `projects`, `files`, `execution_logs`, `refresh_tokens` |
| Redis 7 (Alpine) | `rate:*`, `process:*`, `terminal:*`, `refresh:*`, output ring buffer |
| Cloudflare Pages | Frontend hosting (Vite build) |
| Cloudflare R2 | Object storage for large files/images (>512KB) |
| Cloudflare DNS/Tunnel | DNS + optional tunnel to VPS |
| VPS (Azure B1s / Hetzner) | Docker host for API + execution containers |
| nginx | Reverse proxy + TLS + WS upgrade (`Upgrade: websocket`) |
| GitHub Actions | CI (lint/typecheck/test) → build/push → SSH deploy |
| UptimeRobot | `GET /health` ping every 5m |
| Sentry (free) | Error tracking |
| Grafana Cloud (free) | `prom-client` metrics dashboard |
| Gemini 2.5 Flash | OCR (`image → {language,code}`) + streaming chat (SSE) |

## Tooling Config (root)

```
tsconfig.json (strict)
eslint.config.js (typescript-eslint + prettier)
.prettierrc
vite.config.ts
docker-compose.dev.yml (api + redis + mongo + docker.sock)
.env.example (no secrets, all keys documented)
```

## What Changed for TS Migration (vs original docs)

- CRA (`react-scripts`) → Vite + `vite.config.ts` + `VITE_*` env
- `server.js` / `*.js` → `src/server.ts`, `src/services/*.ts`, `src/controllers/*.ts` etc. with `tsx`
- `nodemon` → `tsx watch`
- `REACT_APP_SOCKET_URL` → `VITE_SOCKET_URL`
- All code examples in docs now use `.ts`/`.tsx` and typed imports
- Added `zod`, `helmet`, `tsx`, `@types/*`, `shadcn/ui` (Radix) to stack
- Removed `ace-builds`/`react-ace`/`prismjs` duplicates — Monaco only

## Install (one command per app)

```bash
# Frontend
npm create vite@latest Cloud_IDE_frontend -- --template react-ts
# then add deps above

# Backend
npm install -D typescript tsx @types/node @types/express @types/jsonwebtoken @types/bcryptjs @types/dockerode @types/node-pty @types/uuid --save-dev
```
