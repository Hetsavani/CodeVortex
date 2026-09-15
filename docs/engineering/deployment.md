# DevOps & Deployment Design

## Current Deployment

- **Backend**: Render.com free tier (single instance, Node.js web service)
- **Frontend**: Unknown — likely Vercel or Netlify
- **Database**: MongoDB Atlas free tier (512MB)
- **No CI/CD**: Manual push-to-deploy
- **No staging environment**
- **Cold starts**: Render free tier spins down after 15 minutes of inactivity

---

## Deployment Architecture by Stage

### Local Development

Every developer should be able to run the full stack locally with one command.

**Docker Compose for local development**:

```yaml
# docker-compose.dev.yml
version: '3.9'

services:
  api:
    build:
      context: ./Cloud_IDE_backend
      dockerfile: Dockerfile.dev
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=development
      - MONGO_URI=mongodb://mongo:27017/codevortex_dev
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=dev-jwt-secret-change-in-production
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - ./Cloud_IDE_backend:/app
      - /app/node_modules
      - /var/run/docker.sock:/var/run/docker.sock  # For Docker-in-Docker execution
    depends_on:
      - mongo
      - redis

  frontend:
    build:
      context: ./Cloud_IDE_frontend
      dockerfile: Dockerfile.dev
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://localhost:5000
      - VITE_SOCKET_URL=http://localhost:5000
    volumes:
      - ./Cloud_IDE_frontend/src:/app/src

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mongo_data:
```

**One command to start everything**:
```bash
# Copy .env.example to .env and fill in GEMINI_API_KEY
cp .env.example .env
docker compose -f docker-compose.dev.yml up
```

**Hot reload**: Both frontend (React Fast Refresh) and backend (nodemon) reload on file changes via the volume mounts.

---

### Staging Environment

Staging should mirror production as closely as possible.

**Option: Render Preview Environments**
- Render automatically creates preview deployments for each pull request
- Same environment variables as production (separate set)
- Uses a dedicated staging MongoDB Atlas cluster (not the production one)

**What staging validates**:
- New features work end-to-end before touching production
- Database migrations don't break existing data
- Docker execution containers build and run correctly
- AI API integration works with staging Gemini key

---

### Production Environment

**Recommended Stack: Docker on a Single VPS + Managed Services**

At the current scale (solo project, prototype to production), **Docker Compose on a single VPS** is the right choice. Here's why:

- Kubernetes: Too much operational overhead for a one-person team. Requires understanding pod networking, ingress controllers, RBAC, persistent volume claims, etc.
- Docker Swarm: Adds complexity without strong benefits at single-machine scale.
- Docker Compose (production): Simple, understood, reliable. Can be upgraded to Swarm or K8s later if needed.

**Infrastructure**:
```
VPS (Digital Ocean Droplet, Hetzner, or Render VM)
  ├── Docker Engine
  ├── nginx (reverse proxy + TLS termination)
  └── Docker Compose services:
        ├── API container
        └── Execution containers (spawned dynamically by API)

Managed Services:
  ├── MongoDB Atlas (M0 free → M2/M5 paid when needed)
  ├── Redis (Upstash free tier → dedicated instance when needed)
  └── DNS (Cloudflare)

CI/CD:
  └── GitHub Actions → build/test → SSH deploy to VPS
```

**Why NOT Kubernetes yet**:
- K8s is appropriate when you need: multi-team development, very high availability, complex autoscaling, or when you have a DevOps engineer.
- For a solo project, K8s maintenance overhead (certificate rotation, upgrades, debugging pod networking) exceeds its benefits.
- The architecture is designed to migrate to K8s later if needed — stateless API, Redis-backed state, Docker-native execution.

---

## Docker Files

### Backend Production Dockerfile (TypeScript)

```dockerfile
# Cloud_IDE_backend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 5000
CMD ["node", "dist/server.js"]
```

### Backend Dev Dockerfile (tsx watch)

```dockerfile
# Cloud_IDE_backend/Dockerfile.dev
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
EXPOSE 5000
CMD ["npm", "run", "dev"]
# dev = "tsx watch src/server.ts"
```

### Execution Container Images

```dockerfile
# code-runners/python.Dockerfile
FROM python:3.12-alpine

RUN addgroup -S runner && adduser -S -G runner runner

# Install common libraries users might need
RUN pip install --no-cache-dir requests numpy pandas

USER runner
WORKDIR /home/runner
```

Build and push all runner images:
```bash
docker build -f code-runners/python.Dockerfile -t codevortex/runner-python:3.12 .
docker build -f code-runners/node.Dockerfile -t codevortex/runner-node:20 .
docker build -f code-runners/java.Dockerfile -t codevortex/runner-java:21 .
docker push codevortex/runner-python:3.12
# etc.
```

---

## nginx Configuration

```nginx
# /etc/nginx/sites-available/codevortex
server {
    listen 443 ssl http2;
    server_name api.codevortex.dev;
    
    ssl_certificate /etc/letsencrypt/live/api.codevortex.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.codevortex.dev/privkey.pem;
    
    # API proxy
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        
        # WebSocket support (critical for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts for long-running executions
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

---

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    uses: ./.github/workflows/test.yml

  deploy:
    needs: test
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Build and push Docker image
        run: |
          docker build -t ghcr.io/${{ github.repository }}/api:${{ github.sha }} .
          docker push ghcr.io/${{ github.repository }}/api:${{ github.sha }}
        working-directory: Cloud_IDE_backend
        env:
          CR_PAT: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/codevortex
            export IMAGE_TAG=${{ github.sha }}
            docker compose pull api
            docker compose up -d api
            docker system prune -f  # Clean up old images
```

### Deployment Strategy

**Zero-downtime deployment**:
1. Pull new image
2. Start new container
3. Health check new container (`GET /health`)
4. If healthy: stop old container
5. If unhealthy: roll back to previous image

With Docker Compose:
```bash
# Rolling update (simplified)
docker compose pull api
docker compose up -d --no-deps api
# Docker will gracefully replace the old container
```

---

## Secrets Management

**Production secrets are NEVER in the repository or Docker images**.

All secrets are stored as:
1. GitHub Actions secrets (for CI/CD pipeline)
2. Environment variables on the VPS (loaded by Docker Compose from a `.env` file outside the repo)
3. For Render deployments: Render's Environment Variables dashboard

```bash
# On the VPS, /opt/codevortex/.env (not in git, not in repo)
MONGO_URI=mongodb+srv://...
JWT_SECRET=<256-bit hex>
GEMINI_API_KEY=...
REDIS_URL=redis://...
FIREBASE_SERVICE_ACCOUNT=<base64>
SENTRY_DSN=...
```

---

## Health Checks and Monitoring

**Uptime monitoring**: UptimeRobot (free) pings `GET /health` every 5 minutes. Alerts via email on downtime.

**Container health in Docker Compose**:
```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

Docker will automatically restart the container if health checks fail 3 times in a row.

---

## Rollback Procedure

**If production breaks after deployment**:

```bash
# SSH into VPS
ssh user@vps

# List recent images
docker images | grep api | head -5

# Roll back to previous image
cd /opt/codevortex
docker compose stop api
docker run -d --name api-rollback --env-file .env codevortex/api:<previous-sha>
# Verify it's working
curl http://localhost:5000/health
# If good, update docker-compose.yml to previous tag
```

With a tagged deployment strategy, rolling back is always one command away.

---

## Summary: What to Use at Each Stage

| Stage | Frontend | Backend | Database | Execution | When |
|---|---|---|---|---|---|
| Development | Vite dev server | nodemon | Local MongoDB + Docker | Docker containers | Now |
| Staging | Vercel preview | Render preview | MongoDB Atlas | Docker on Render | Phase 1 |
| Production | Vercel | VPS + Docker Compose | MongoDB Atlas | Docker on VPS | Phase 2 |
| Scale | Vercel | Multiple VPS / Fly.io | MongoDB Atlas (dedicated) | Separate worker VMs | Phase 4+ |

The key decision: **stay on Render's managed platform as long as possible**, then move to a VPS when Docker execution control is needed (Render doesn't allow Docker socket access on free/hobby tiers).
