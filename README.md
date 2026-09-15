# Cloud IDE — New (TypeScript)

Fresh rebuild next to `../docs` blueprint. Old code preserved in `../Cloud_IDE_frontend` + `../Cloud_IDE_backend` (archived, do not modify).

## Structure

```
app/
  frontend/   # Vite + React TS + Tailwind + shadcn/ui + Monaco + xterm.js
  backend/    # Express TS (tsx) + Socket.IO + Mongoose + ioredis + dockerode + pino
  docs -> ../docs  (source of truth, see ../docs/engineering/tech-stack.md)
  code-runners/    # Dockerfiles for python/node/java/cpp (copied from plan)
```

## Quick start

```bash
# backend
cd backend && npm install && cp .env.example .env && npm run dev

# frontend
cd frontend && npm install && npm run dev

# full stack (from app/)
docker compose -f docker-compose.dev.yml up
```

See `../docs/engineering/weekly-sprint.md` for 7-day plan and `../docs/engineering/tech-stack.md` for single source of every dep.
