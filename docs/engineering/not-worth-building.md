# What NOT to Build

> **Rule**: If a technology doesn't solve a current, real, measurable problem in this project, don't add it.

The temptation with "upgrade a portfolio project" tasks is to add buzzword technologies to make the architecture diagram look impressive. This is exactly the wrong approach. Every technology in a system adds: maintenance burden, debugging complexity, operational cost, and onboarding friction. Here is what to explicitly avoid.

---

## 1. Kubernetes

**Why people add it**: "Production-grade orchestration", "auto-scaling", "looks impressive".

**Why this project doesn't need it**:
- K8s is designed for multi-service, multi-team, large-scale deployments
- The operational overhead is substantial: cluster management, networking (CNI), ingress controllers, cert management, RBAC, persistent volumes, rolling upgrades
- A single developer running a small Cloud IDE has no business running K8s
- Docker Compose on a single VPS is provably sufficient for hundreds of concurrent users
- If traffic actually grows to K8s scale, you'll have enough users and revenue to hire a DevOps engineer

**What to do instead**: Docker Compose on a single VPS. Scale horizontally only when you have the traffic data to justify it.

---

## 2. Apache Kafka

**Why people add it**: "Event-driven architecture", "high throughput", "decoupled services".

**Why this project doesn't need it**:
- Kafka solves problems at millions of events per second and complex multi-consumer streaming topologies
- It requires ZooKeeper (or KRaft), multiple broker nodes, consumer group management, partition strategies
- BullMQ (Redis-backed) handles thousands of execution jobs per hour with zero operational complexity
- The benefit Kafka provides (durable log, consumer groups at scale) is not needed for a code execution queue

**What to do instead**: BullMQ + Redis. Handles this workload perfectly.

---

## 3. Microservices Architecture

**Why people add it**: "Separation of concerns", "independent deployment", "modern architecture".

**Why this project doesn't need it**:
- True microservices require: service discovery, inter-service auth, distributed tracing, network resilience (retries, timeouts, circuit breakers), API gateways
- The current monolith (Express + Docker execution) has a clear internal separation: routes, controllers, services
- Splitting into separate deployable services (auth-service, file-service, execution-service, ai-service) adds 6× the deployment complexity with no throughput benefit
- The right time to extract a service is when a specific component is the bottleneck and needs independent scaling — not before

**What to do instead**: A well-organized monolith with a separate worker process for execution (when needed). Extract only what needs to scale independently.

---

## 4. RAG / Vector Databases / Embeddings

**Why people add it**: "Context-aware AI", "semantic search", "LLM with memory".

**Why this project doesn't need it**:
- RAG requires: embedding every file on save, a vector database (Pinecone, Weaviate, pgvector), a retrieval pipeline, embedding freshness management, and careful prompt construction
- The actual user need ("explain this code") is solved by including the active file's content directly in the prompt — no vector search needed
- For a project with < 50 files per workspace, direct context inclusion is faster, cheaper, and more accurate than RAG
- RAG becomes valuable when you need to search across thousands of documents that don't fit in a context window

**What to do instead**: Include the active file + relevant error output in the AI prompt. This covers 95% of use cases with 5% of the complexity.

---

## 5. Event Sourcing

**Why people add it**: "Audit trail", "temporal queries", "CQRS pattern".

**Why this project doesn't need it**:
- Event sourcing stores every state change as an immutable event. Queries require replaying all events.
- The complexity cost (event schema versioning, snapshot management, read model projection) is enormous
- The project needs simple file history (last N saves) — achievable with a `file_versions` collection and a periodic cleanup job, not event sourcing

**What to do instead**: A simple `file_versions` collection storing the last 10 snapshots per file, created on each explicit save.

---

## 6. GraphQL

**Why people add it**: "Flexible queries", "type-safe API", "modern API design".

**Why this project doesn't need it**:
- GraphQL solves the over-fetching problem in complex, multi-resource APIs (Facebook, GitHub-scale)
- The current API has ~15 endpoints with simple, well-defined data shapes
- REST is simpler to implement, easier to debug, better supported by existing middleware (rate limiting, auth, caching), and works natively with fetch
- Adding GraphQL introduces a resolver layer, schema definition, N+1 query problems, and more

**What to do instead**: REST with well-named endpoints and consistent response shapes.

---

## 7. Service Mesh (Istio, Linkerd)

**Why people add it**: "mTLS between services", "traffic management", "observability".

**Why this project doesn't need it**:
- A service mesh is relevant when you have 10+ microservices that need mutual TLS, circuit breaking, and traffic shaping
- This project has 1 API service + 1 database + 1 cache. There is no mesh to manage.
- Service meshes add significant operational complexity (sidecar proxies, control plane management)

**What to do instead**: Nothing. Not applicable.

---

## 8. Complex CQRS

**Why people add it**: "Separate read and write models", "scalable reads", "DDD pattern".

**Why this project doesn't need it**:
- CQRS (Command Query Responsibility Segregation) is valuable when read patterns and write patterns diverge significantly and both need independent scaling
- File save (write) and file read are simple CRUD. The data model is straightforward.
- Adding separate read/write models for a file editor would double the code with no benefit

**What to do instead**: Standard MongoDB CRUD operations with appropriate indexes.

---

## 9. Unnecessary Caching

**Why people add it**: "Improve performance", "reduce DB load".

**What NOT to cache**:
- **File content**: Risk of serving stale content after a save. The user needs their latest version, always.
- **File tree**: Small, changes frequently (file create/delete/rename), cache invalidation is complex.
- **User profiles**: Fetched infrequently, always needs to be current.

**Only cache**: Rate limit counters, execution state, terminal sessions, short-lived idempotency keys.

---

## 10. Autonomous AI Agents

**Why people add it**: "AI-powered development", "agentic workflows", "next-generation features".

**Why this project shouldn't add it yet**:
- An agent that autonomously edits files, runs code, and makes decisions introduces serious safety risks when combined with a code execution system
- Without battle-tested sandboxing AND careful agent design, an agent could cause data loss, run malicious commands, or consume unlimited API credits
- The engineering complexity is significant: agent loop design, tool calling, error recovery, interrupt mechanisms, and safety guardrails

**When to add it**: After the sandbox is production-hardened (Phase 2+), and only with explicit user confirmation before any action. Even then, start with read-only agents (explain, suggest) before write-enabled agents.

---

## Summary

| Technology | Don't Build Because | Build Instead |
|---|---|---|
| Kubernetes | Operational overkill | Docker Compose on VPS |
| Kafka | Throughput mismatch | BullMQ + Redis |
| Microservices | Premature decomposition | Organized monolith + worker |
| RAG / Vector DB | Not needed at this scale | Direct file content in prompt |
| Event Sourcing | Excessive complexity | Simple versioned records |
| GraphQL | Simple REST suffices | REST with clear endpoints |
| Service Mesh | No services to mesh | Nothing |
| CQRS | No divergent read/write needs | Standard MongoDB CRUD |
| Unbounded caching | Stale data risk | Targeted Redis caching only |
| AI Agents | Safety risk, premature | Streaming chat + code gen |

The theme is consistent: **every technology should earn its place by solving a specific, measurable problem that exists in this project right now**.
