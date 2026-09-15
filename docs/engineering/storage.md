# Storage & Data Architecture

## Current Storage Problems

The current system stores **all file content for all users inside a single embedded document per user**. This is a MongoDB anti-pattern that creates:
- A 16MB hard BSON document size limit
- Full-document reads/writes for every file save
- No ability to query across files without loading the entire user record
- No file versioning or history

---

## Target Storage Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Storage Layer Overview                        │
│                                                                  │
│  MongoDB Atlas                    Object Storage (S3-compatible) │
│  ┌─────────────────┐             ┌──────────────────────────────┐│
│  │ users           │             │ user-uploads/                ││
│  │ projects        │             │   {userId}/images/{uuid}.png ││
│  │ files (metadata)│             │                              ││
│  │ execution_logs  │             │ user-workspaces/ (Phase 2+)  ││
│  └─────────────────┘             │   {userId}/{projectId}/...   ││
│                                  └──────────────────────────────┘│
│  Redis                                                            │
│  ┌─────────────────┐                                             │
│  │ rate limits     │                                             │
│  │ execution state │                                             │
│  │ terminal state  │                                             │
│  │ output buffers  │                                             │
│  └─────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## MongoDB Data Model

### Collection: `users`

```javascript
{
  _id: ObjectId,
  email: String,          // unique, indexed
  username: String,       // trim, lowercase
  passwordHash: String,   // bcrypt hash
  googleId: String,       // optional, for OAuth
  createdAt: Date,
  updatedAt: Date,
  settings: {             // per-user preferences
    theme: String,        // "vs-dark" | "vs-light"
    fontSize: Number,
    tabSize: Number,
    autoSave: Boolean
  }
}
```

**Why**: Users are a tiny, stable collection. Embedding settings here is appropriate because settings are always fetched with the user.

---

### Collection: `projects`

```javascript
{
  _id: ObjectId,
  userId: ObjectId,         // ref: users, indexed
  name: String,             // e.g., "My Python Project"
  description: String,
  language: String,         // dominant language hint
  createdAt: Date,
  updatedAt: Date,
  settings: {
    executionTimeout: Number,   // seconds
    entryFile: String           // default file to run
  }
}
```

**Index**: `{ userId: 1, name: 1 }` — for fetching user's project list.

**Why separate from users**: Multiple projects per user. Each project is an independent workspace.

---

### Collection: `files`

```javascript
{
  _id: ObjectId,
  projectId: ObjectId,      // ref: projects, indexed
  userId: ObjectId,         // indexed for ownership checks without joining
  path: String,             // e.g., "src/utils/helper.py" (relative to project root)
  name: String,             // filename only, e.g., "helper.py"
  language: String,         // "python", "javascript", etc.
  content: String,          // file content (for files ≤ 512KB)
  contentStorageKey: String, // S3 key if file > 512KB (null otherwise)
  size: Number,             // bytes
  isFolder: Boolean,        // true for directory entries
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ projectId: 1, path: 1 }` — unique index for file lookup by path
- `{ projectId: 1, isFolder: 1 }` — for listing directories

**Why**: Files are first-class entities. This allows querying individual files, efficient saves (update one document instead of the entire user), and future features like file history.

**Content storage strategy**:
- Files ≤ 512KB: Store content in `content` field (MongoDB)
- Files > 512KB: Store in object storage, put S3 key in `contentStorageKey`
- This covers >99% of code files (source code is rarely > 100KB)

---

### Collection: `refresh_tokens`

```ts
{
  _id: ObjectId,
  userId: ObjectId,         // ref: users, indexed
  jti: String,              // uuid v4, unique
  tokenHash: String,        // SHA-256 of raw refresh JWT (never store raw)
  expiresAt: Date,          // TTL index
  createdAt: Date,
  revokedAt: Date | null,
  replacedBy: String | null,// jti of replacement on rotation
  ip: String,
  userAgent: String
}
```

**Indexes**: `{ jti: 1 }` unique, `{ userId: 1, expiresAt: 1 }`, `{ expiresAt: 1 }` expireAfterSeconds 0 (TTL).

**Why separate collection**: enables rotation, reuse detection, `logout-all`, and audit without bloating `users`.

### Collection: `execution_logs`

```javascript
{
  _id: ObjectId,
  userId: ObjectId,         // indexed
  projectId: ObjectId,      // indexed
  fileId: ObjectId,         // which file was run
  language: String,
  exitCode: Number,
  status: String,           // "accepted" | "error" | "timeout" | "killed"
  durationMs: Number,
  memoryKb: Number,         // if available from Docker stats
  createdAt: Date
}
```

**Why**: Enables execution history per file/project. Useful for UI (show last N runs), analytics, and debugging.

**Retention**: Keep last 100 logs per user (capped collection or periodic cleanup).

---

### Entity-Relationship Diagram

```
┌──────────┐         ┌─────────────┐         ┌──────────┐
│  users   │ 1    n  │  projects   │ 1    n  │  files   │
│          │────────▶│             │────────▶│          │
│ _id      │         │ _id         │         │ _id      │
│ email    │         │ userId      │         │ projectId│
│ username │         │ name        │         │ userId   │
│ settings │         │ language    │         │ path     │
└──────────┘         │ settings    │         │ name     │
                     └─────────────┘         │ language │
                           │ 1               │ content  │
                           │                 │ isFolder │
                           ▼ n               └──────────┘
                    ┌─────────────┐
                    │execution_log│
                    │             │
                    │ projectId   │
                    │ userId      │
                    │ fileId      │
                    │ exitCode    │
                    │ durationMs  │
                    └─────────────┘
```

---

## Redis Data Model

### Rate Limit Keys

```
rate:auth:{ip}:{minuteBucket}        → count (TTL: 60s)
rate:exec:{userId}:{hourBucket}      → count (TTL: 3600s)
rate:ocr:{userId}:{dayBucket}        → count (TTL: 86400s)
```

### Execution State

```
process:{processId}                  → JSON blob (TTL: 30min)
process:buffer:{processId}           → List of output chunks (TTL: 60min, max 1000 items)
```

### Terminal Session State

```
terminal:{sessionId}                 → JSON blob (TTL: 2hr, refreshed on activity)
```

### Auth / Refresh State

```
refresh:{jti}                        → "1" (TTL: 7d, fast revocation check)
refresh:family:{userId}              → set of jtis (optional, for logout-all)
revoked:access:{jti}                 → "1" (TTL: 15m, if implement access denylist)
```

### Idempotency

```
idem:exec:{idempotencyKey}           → result JSON (TTL: 5min)
```

---

## Object Storage (Phase 2+)

**When to add**: When users upload images (already needed) or when files exceed 512KB.

**Provider options**:
| Provider | Cost | Best For |
|---|---|---|
| Cloudflare R2 | Very cheap (no egress fees) | Production ideal |
| AWS S3 | Industry standard | If already on AWS |
| MinIO | Free, self-hosted | Local development |

**Bucket structure**:
```
bucket/
  uploads/
    {userId}/
      {uuid}.png      ← OCR image uploads (currently sent as base64 — fix this)
  workspaces/         ← Phase 2: large file content
    {userId}/
      {projectId}/
        {fileId}
```

**Presigned URLs**: For uploads, generate a presigned URL from the backend and have the client upload directly to S3. This avoids sending large files through the API server.

---

## Filesystem (Docker Volumes)

For interactive terminal sessions, user workspace files need to be available inside the container:

```
Docker named volume: workspace-{userId}-{projectId}
Mount path inside container: /workspace
```

**Sync strategy**:
- On terminal session start: sync files from MongoDB → volume (write each file to the container's filesystem)
- On terminal session end: sync modified files from volume → MongoDB (read changed files, save content)
- For real-time saves during terminal: use `inotifywait` or periodic sync inside the container

This is a Phase 2+ feature. Initially, terminal sessions start with an empty workspace and changes are lost when the container closes (acceptable for short sessions).

---

## Migration Plan

**From current model (everything in User.directory)** to the new model:

```
1. Create projects collection
2. Create files collection
3. Migration script:
   a. For each user, create a default "My Workspace" project
   b. Walk user.directory recursive structure
   c. For each file item: create a File document with content
   d. For each folder item: create a File document with isFolder=true
4. Verify files collection has correct data
5. Update API endpoints to use new model
6. Remove directory field from User schema
```

This migration can be run as a one-time script and is non-destructive (old data stays until verified).
