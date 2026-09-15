# Observability Design

## Current State

The only observability in the current system is `console.log` / `console.error` statements scattered throughout the codebase, many of which are debug-level noise (`console.log("Point 1")`, `console.log(content)`). There are no metrics, no error tracking, no health checks, and no structured logs.

When something breaks in production, there is no way to know why, when it started, or how often it's happening.

---

## Production Observability Stack (Realistic)

For a single-developer project, the goal is maximum signal with minimum operational overhead:

```
┌─────────────────────────────────────────────┐
│           Observability Stack                │
│                                             │
│  Structured Logs  →  stdout (Render/Vercel) │
│  Error Tracking   →  Sentry (free tier)     │
│  Health Checks    →  GET /health endpoint   │
│  Metrics          →  prom-client → Grafana  │
│                      (or just structured    │
│                       log aggregation)      │
└─────────────────────────────────────────────┘
```

This stack requires no new infrastructure, uses free tiers where possible, and provides genuine value.

---

## Logs

### Replace `console.log` with Structured Logging

Use `pino` — the fastest Node.js structured logger, battle-tested, minimal overhead.

```bash
npm install pino pino-http
```

```javascript
// logger.js
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) { return { level: label }; }
  },
  base: {
    service: 'codevortex-api',
    env: process.env.NODE_ENV
  }
});

module.exports = logger;
```

```javascript
// server.js
const pinoHttp = require('pino-http');
app.use(pinoHttp({ logger }));
```

### Log Events (What to Log and When)

| Event | Level | Fields |
|---|---|---|
| Server started | INFO | port, env, version |
| HTTP request | INFO | method, path, statusCode, duration |
| Execution started | INFO | executionId, userId, language |
| Execution completed | INFO | executionId, exitCode, durationMs |
| Execution timeout | WARN | executionId, userId, language |
| Container spawn failed | ERROR | executionId, errorMessage |
| Auth failure | WARN | ip, reason |
| Rate limit hit | WARN | userId, endpoint, count |
| DB connection error | ERROR | message, stack |
| Unhandled error | ERROR | message, stack, requestId |

### What NOT to Log

- File content (PII/privacy)
- User passwords or tokens
- Full code submissions (can contain sensitive data)
- High-frequency debug output in production

---

## Error Tracking

### Sentry Integration (Free Tier)

Sentry captures unhandled exceptions, links them to releases, and shows stack traces with source context. The free tier is sufficient for a small project.

```bash
npm install @sentry/node @sentry/tracing
```

```javascript
// server.js (before other middleware)
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,  // 10% of requests traced
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app }),
    new Sentry.Integrations.Mongo(),
  ]
});

app.use(Sentry.Handlers.requestHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler());
```

Sentry automatically captures:
- Unhandled promise rejections
- Uncaught exceptions
- Express route errors
- MongoDB query errors (when instrumented)

---

## Metrics

### What to Measure

**Execution Metrics**:
- `execution_total` — counter by language and status (success/error/timeout)
- `execution_duration_seconds` — histogram (p50, p90, p99 latency)
- `execution_active` — gauge (currently running containers)
- `execution_timeout_total` — counter

**API Metrics**:
- `http_request_duration_seconds` — histogram by method, path, status
- `http_requests_total` — counter by status code

**System Metrics**:
- `process_cpu_usage` — Node.js CPU
- `nodejs_heap_used_bytes` — heap memory
- `db_query_duration_seconds` — MongoDB query latency

**AI Metrics**:
- `ai_requests_total` — counter by endpoint (chat/ocr)
- `ai_request_duration_seconds` — latency histogram
- `ai_tokens_used_total` — approximate token usage

### Implementation with `prom-client`

```bash
npm install prom-client
```

```javascript
// metrics.js
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const executionDuration = new client.Histogram({
  name: 'execution_duration_seconds',
  help: 'Code execution duration in seconds',
  labelNames: ['language', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 30],
  registers: [register]
});

const executionActive = new client.Gauge({
  name: 'execution_active',
  help: 'Number of currently running executions',
  registers: [register]
});

const executionTotal = new client.Counter({
  name: 'execution_total',
  help: 'Total executions by language and status',
  labelNames: ['language', 'status'],
  registers: [register]
});

// Expose metrics endpoint (internal only)
app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType);
  register.metrics().then(data => res.end(data));
});

module.exports = { executionDuration, executionActive, executionTotal };
```

Usage in the execution service:
```javascript
const { executionDuration, executionActive, executionTotal } = require('./metrics');

const end = executionDuration.startTimer({ language });
executionActive.inc();

try {
  const result = await runInContainer(code, language);
  executionTotal.inc({ language, status: 'success' });
  return result;
} catch (err) {
  executionTotal.inc({ language, status: err.type || 'error' });
  throw err;
} finally {
  executionActive.dec();
  end({ status });
}
```

### Metrics Visualization

**Simple option**: Use Grafana Cloud free tier — paste the Prometheus metrics endpoint URL and build dashboards.

**Even simpler**: Export metrics as structured logs and use Render/Vercel's built-in log aggregation.

---

## Distributed Tracing

### When to Add It

Tracing is most valuable when there are multiple services communicating. For the current monolith (API + Docker), request-level timing is sufficient.

Add OpenTelemetry instrumentation now (low cost) so that when workers are extracted, traces flow automatically:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

```javascript
// tracing.js (load before everything else)
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),  // Log traces; swap for OTLP later
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();
```

This automatically instruments: HTTP, Express, MongoDB (mongoose), Redis, and more.

---

## Health Checks

Every component needs a health check so that:
1. The deployment platform knows the server is ready
2. Load balancers can route away from unhealthy instances
3. Uptime monitors can alert on downtime

### Implementation

```javascript
// GET /health (public — no auth)
app.get('/health', async (req, res) => {
  const checks = {};
  
  // Check MongoDB
  try {
    await mongoose.connection.db.admin().ping();
    checks.mongodb = 'ok';
  } catch {
    checks.mongodb = 'error';
  }
  
  // Check Redis
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }
  
  // Check Docker daemon
  try {
    await docker.ping();
    checks.docker = 'ok';
  } catch {
    checks.docker = 'error';
  }
  
  const allHealthy = Object.values(checks).every(v => v === 'ok');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
  });
});

// GET /health/live (liveness — minimal, just "is the process running")
app.get('/health/live', (req, res) => res.json({ status: 'alive' }));

// GET /health/ready (readiness — are all dependencies up)
app.get('/health/ready', async (req, res) => {
  // Same as /health but returns 503 if any dependency is down
});
```

Configure Render to use `GET /health/live` as the health check endpoint.

---

## Alerting

With Sentry capturing errors, set up alerts for:
- New error types (first occurrence)
- Error rate spike (> 10 errors in 5 minutes)
- Execution timeout rate > 20%

With Grafana (if using metrics):
- Alert when `execution_active > 10` (approaching concurrency limit)
- Alert when `http_request_duration_seconds p99 > 5s`
- Alert when MongoDB check fails

Minimum useful alert: **Sentry email notification on new errors** — set this up first, takes 5 minutes.

---

## Removing Debug Noise

The current codebase has dozens of `console.log` statements that would flood production logs. Before launching:

```bash
# Find all console.log in source (exclude node_modules)
grep -r "console.log" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules .
```

The policy:
- `console.log` → remove or replace with `logger.debug`
- `console.error` → replace with `logger.error` + include relevant context
- Keep error logging, remove debug logging from production builds

---

## Observability Summary

| Concern | Tool | Cost | When to Add |
|---|---|---|---|
| Structured logs | `pino` | Free | Phase 1 |
| Error tracking | Sentry free tier | Free | Phase 1 |
| Health checks | Express endpoint | Free | Phase 1 |
| Metrics | `prom-client` | Free | Phase 2 |
| Metrics dashboard | Grafana Cloud free | Free | Phase 2 |
| Distributed tracing | OpenTelemetry | Free | Phase 3 |
| Uptime monitoring | UptimeRobot free | Free | Phase 2 |
