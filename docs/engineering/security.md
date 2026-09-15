# Security Architecture

## Security Threat Surface

A Cloud IDE has an unusually large threat surface because it:
1. Accepts and executes arbitrary user code
2. Stores user files and credentials
3. Proxies AI API calls
4. Handles file uploads (including images)
5. Uses JWT tokens for authentication

Every one of these surfaces requires specific defenses.

---

## 1. Secrets Management

### Current Critical Issues
- Firebase Admin SDK private key committed to git
- MongoDB connection string hardcoded in `config/db.js`
- JWT secret is weak and in `.env` which may be committed

### Production Secret Management

**All secrets → environment variables only. Nothing in source code.**

```
Required environment variables:
MONGO_URI=mongodb+srv://...
JWT_ACCESS_SECRET=<256-bit random hex>   # 15m access token
JWT_REFRESH_SECRET=<256-bit random hex>  # 7d refresh token (different from access)
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
GEMINI_API_KEY=<key>
FIREBASE_SERVICE_ACCOUNT=<base64-encoded JSON>
REDIS_URL=redis://...
```

For generating secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" # run twice
```

For Firebase credentials without a committed JSON file:
```javascript
// Instead of reading a file:
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
```

**Immediate actions required**:
1. Rotate the Firebase service account key (revoke the committed one)
2. Rotate MongoDB credentials (assume compromised)
3. Rotate JWT secret (all existing tokens become invalid — users re-login)
4. Remove the Firebase JSON file from git history using `git filter-repo`
5. Add `.env`, `*.json` credentials to `.gitignore`

---

## 2. Authentication & Authorization — Access + Refresh Tokens

### Token Design

**Access Token (short-lived, stateless JWT):**
```ts
// payload — src/types/auth.ts
{
  userId: string;  // ObjectId
  email: string;
  jti: string;     // uuid v4
  iat: number;
  exp: number;     // 15 minutes
}
```
- Secret: `JWT_ACCESS_SECRET` (256-bit, HS256)
- Expiry: **15m** (`ACCESS_TOKEN_EXPIRY`)
- Transport: `Authorization: Bearer <accessToken>` header + in-memory (not localStorage). Never in cookie.
- Purpose: authenticate every API + Socket.IO handshake (`socket.handshake.auth.token`)

**Refresh Token (long-lived, stateful, rotating):**
```ts
{
  userId: string;
  jti: string;     // uuid v4, links to DB row
  iat: number;
  exp: number;     // 7 days
}
```
- Secret: `JWT_REFRESH_SECRET` (different 256-bit key, HS256)
- Expiry: **7d** (`REFRESH_TOKEN_EXPIRY`)
- Transport: `HttpOnly + Secure + SameSite=Strict` cookie `refreshToken`, `Path=/api/auth/refresh`, `Max-Age=604800`
- Storage: hashed (`SHA-256`) in MongoDB `refresh_tokens` collection + Redis `refresh:{jti}` for fast revocation check. Raw token never stored.
- Rotation: on every `/api/auth/refresh`, old token is revoked and a new pair is issued (reuse detection → revoke family).

**Why two tokens:** 15m access token limits damage if XSS leaks it (in-memory only, short window). Refresh token is `HttpOnly` so JS can't read it, survives page reload, and is revocable (logout, password change, breach) via DB/Redis.

### Auth Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | no | create user → set refresh cookie + return `{accessToken}` |
| POST | `/api/auth/login` | no | verify creds → set refresh cookie + return `{accessToken}` |
| POST | `/api/auth/refresh` | refresh cookie | verify + rotate → set new refresh cookie + return `{accessToken}` |
| POST | `/api/auth/logout` | refresh cookie | revoke current refresh token + clear cookie |
| POST | `/api/auth/logout-all` | access token | revoke all refresh tokens for user |
| POST | `/api/auth/google` | no | verify Firebase idToken → issue pair |

```ts
// login / refresh response
res.cookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth/refresh',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
res.json({ accessToken }); // access token in body only
```

### Middleware

```ts
// src/middleware/auth.ts
export const authenticateAccessToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing access token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessPayload;
    if (await redis.sismember(`revoked:access:${payload.jti}`, '1')) throw new Error();
    req.user = { id: payload.userId, email: payload.email, jti: payload.jti };
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired access token' }); }
};
```

Socket.IO:
```ts
io.use((socket, next) => {
  const token = socket.handshake.auth.token as string;
  try { socket.userId = (jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessPayload).userId; next(); }
  catch { next(new Error('Unauthorized')); }
});
```

### Refresh Rotation & Reuse Detection

```ts
// POST /api/auth/refresh
const oldPayload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as RefreshPayload;
const record = await RefreshToken.findOne({ jti: oldPayload.jti, userId: oldPayload.userId });
if (!record || record.revokedAt) {
  // reuse detected → revoke entire family (all tokens for user)
  await RefreshToken.updateMany({ userId: oldPayload.userId, revokedAt: null }, { revokedAt: new Date() });
  await redis.del(`refresh:family:${oldPayload.userId}`);
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  return res.status(401).json({ error: 'Refresh reuse detected' });
}
const newJti = uuidv4();
const accessToken = sign({ userId: oldPayload.userId, email: user.email, jti: uuidv4() }, JWT_ACCESS_SECRET, { expiresIn: '15m' });
const newRefreshToken = sign({ userId: oldPayload.userId, jti: newJti }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
await RefreshToken.create({ userId: oldPayload.userId, jti: newJti, tokenHash: sha256(newRefreshToken), expiresAt: addDays(7), ip: req.ip, userAgent: req.headers['user-agent'] });
record.revokedAt = new Date(); record.replacedBy = newJti; await record.save();
await redis.set(`refresh:${newJti}`, '1', 'EX', 7*86400);
```

Store: `refresh_tokens` collection (see `storage.md`), index `{ userId:1, expiresAt:1 }` TTL, `{ jti:1 }` unique.

### Frontend Handling (Vite + Axios/fetch)

- Keep `accessToken` in memory (`useRef` / Redux `auth.accessToken` NOT persisted). No `localStorage`.
- Axios interceptor: on `401` from API, call `POST /api/auth/refresh` with `credentials: 'include'`, retry original request once with new access token. Queue concurrent 401s.
- On refresh failure (401) → redirect to `/login`, clear state.
- Socket.IO: on `connect_error` due to expired access token, refresh then `socket.auth.token = newAccessToken; socket.connect()`.

### Authorization Pattern (unchanged)

Every protected endpoint must verify:
1. Access token valid and not expired (via `authenticateAccessToken`)
2. The user owns the resource

```ts
const file = await File.findById(req.params.id);
if (!file || file.userId.toString() !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
```

**Current gap**: Execution endpoint has no auth. File endpoints don't check ownership. Add both.

### Security Properties Achieved

- XSS can't steal refresh token (HttpOnly). Access token theft window is 15m.
- CSRF on `/refresh` mitigated by `SameSite=Strict` + requiring no custom header reading cookie directly; additionally verify `Origin` header matches allowlist.
- Logout/revocation is instant (DB + Redis). Password change → `logout-all`.
- Reuse detection prevents refresh-token replay.

---

## 3. Code Execution Security

See `execution-system.md` for the full isolation model. Summary:

- **Never execute user code on the host process** — always inside Docker
- **--network=none**: no outbound network from execution containers
- **--memory=128m**: memory limit
- **--pids-limit=50**: prevent fork bombs
- **--cap-drop=ALL**: drop Linux capabilities
- **--read-only**: read-only filesystem
- **Non-root user inside container**
- **15-second wall-clock timeout** enforced at API level
- **Auth required** on all execution endpoints

---

## 4. File Upload Security

### Current Vulnerabilities
- No file size limit
- No MIME type validation
- No file type checking
- Base64 payload can be arbitrarily large

### Secure Upload Design

```javascript
// MIME type allowlist for OCR uploads
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif'
]);

// Body size limit on Express
app.use(express.json({ limit: '10mb' }));

const validateImageUpload = (req, res, next) => {
  const { image, mimeType } = req.body;
  
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported file type' });
  }
  
  const decodedBytes = (image.length * 3) / 4;  // Base64 decoded size estimate
  if (decodedBytes > 5 * 1024 * 1024) {  // 5MB limit
    return res.status(400).json({ error: 'File too large (max 5MB)' });
  }
  
  next();
};
```

For Phase 2 (direct-to-S3 uploads via presigned URLs):
- Client requests a presigned PUT URL from the API
- API validates user auth and rate limit, returns signed URL
- Client uploads directly to S3
- S3 bucket policy enforces size and content-type restrictions
- This keeps large binaries off the API server

---

## 5. Path Traversal Prevention

### Current Risk

The file API uses paths like `src/utils/helper.py`. A malicious user could submit:
- `../../etc/passwd`
- `../server.js`

While the current implementation uses MongoDB (not the actual filesystem), if Docker volumes are used in Phase 2 for terminal workspaces, path traversal becomes a real filesystem attack.

### Mitigation

```javascript
const path = require('path');

const sanitizeFilePath = (userPath, workspaceRoot) => {
  // Resolve the path within the workspace root
  const resolved = path.resolve(workspaceRoot, userPath);
  
  // Ensure the resolved path is still inside workspaceRoot
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error('Path traversal attempt detected');
  }
  
  return resolved;
};

// For MongoDB paths, validate against a regex:
const isValidFilePath = (p) => /^[a-zA-Z0-9_\-./]+$/.test(p) && !p.includes('..');
```

---

## 6. Injection Prevention

### Command Injection

**Current risk**: Compiled language execution builds shell commands like:
```javascript
exec(`javac ${javaFilePath}`, ...)
exec(`g++ ${cppFilePath} -o ${cppOutputPath}`, ...)
```

If `javaFilePath` or `cppFilePath` contains shell metacharacters (`; rm -rf /`), this becomes command injection.

**Fix**: Use `execFile` instead of `exec`, or pass arguments as array to `spawn`:
```javascript
// WRONG:
exec(`javac ${javaFilePath}`, callback);

// CORRECT:
execFile('javac', [javaFilePath], callback);
// or:
spawn('javac', [javaFilePath], { stdio: 'pipe' });
```

Since `javaFilePath` is generated from `os.tmpdir()` + a filename, and in the Docker model this happens inside the container, this risk is lower. But fix it anyway.

### XSS Prevention

- The frontend uses React, which escapes JSX content by default
- Use `dangerouslySetInnerHTML` only if absolutely necessary (it's not)
- Content Security Policy header:

```javascript
// In Express:
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",  // Monaco requires unsafe-inline
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' wss://your-api-url.com",
    "font-src 'self'"
  ].join('; '));
  next();
});
```

### CSRF Prevention

Refresh token cookie is `SameSite=Strict` — CSRF is implicit. Additionally:
- Validate `Origin` header on `POST /api/auth/refresh` against `ALLOWED_ORIGIN` allowlist.
- Socket.IO: `cors: { origin: process.env.ALLOWED_ORIGIN, credentials: true }` (never `*`).
```ts
const io = new Server(server, { cors: { origin: process.env.ALLOWED_ORIGIN, credentials: true } });
```

---

## 7. Rate Limiting

### Per-IP Limits (express-rate-limit)

```javascript
import rateLimit from 'express-rate-limit';

// Auth endpoints: aggressive limiting
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  limit: 10,
  message: 'Too many authentication attempts'
}));

// General API: prevent API scraping
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  limit: 200
}));
```

### Per-User Limits (Redis counters)

```javascript
const checkUserRateLimit = async (userId, endpoint, limit, windowSeconds) => {
  const key = `rate:${endpoint}:${userId}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const count = await redis.incr(key);
  await redis.expire(key, windowSeconds);
  
  if (count > limit) {
    throw new RateLimitError(`${endpoint} limit exceeded: ${limit} per ${windowSeconds}s`);
  }
};

// Usage:
await checkUserRateLimit(userId, 'exec', 30, 3600);   // 30 executions/hour
await checkUserRateLimit(userId, 'ai_chat', 100, 86400); // 100 AI messages/day
await checkUserRateLimit(userId, 'ocr', 10, 86400);    // 10 OCR requests/day
```

---

## 8. CORS Configuration

### Current Problem
CORS is fully open (`origin: "*"`). This allows any website to make authenticated API calls using the user's browser cookies.

### Fix

```javascript
const ALLOWED_ORIGINS = [
  'https://your-frontend.vercel.app',
  'http://localhost:3000'   // development only
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true  // Allow cookies
}));
```

---

## 9. SSRF Prevention

When the server makes HTTP requests based on user input (currently: AI calls based on image upload), SSRF allows a malicious user to make the server request internal resources.

In this project:
- The Gemini API call uses user-provided image data (base64), not a URL — so no SSRF risk there
- If you ever add a feature to fetch a URL (e.g., import a package), validate against an allowlist of external URLs only

---

## 10. Security Headers

Add a comprehensive set of HTTP security headers using the `helmet` middleware:

```javascript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // CSP as above
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

---

## Security Checklist

### Immediate (Before Any Public Launch)
- [ ] Rotate Firebase service account key — revoke exposed one
- [ ] Rotate MongoDB credentials
- [ ] Rotate `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (two independent 256-bit keys)
- [ ] Remove Firebase JSON from git history
- [ ] Add `authenticateAccessToken` to execution endpoint
- [ ] Replace hardcoded MongoDB URI in `config/db.ts`
- [ ] Fix CORS to explicit origin allowlist
- [ ] Add 10-second execution timeout

### Phase 1
- [ ] Implement access+refresh token flow (15m access, 7d refresh, rotation, reuse detection, Redis)
- [ ] Add frontend Axios refresh interceptor + Socket.IO token refresh
- [ ] Implement Docker-based execution sandboxing
- [ ] Add per-IP and per-user rate limiting
- [ ] Add file upload size and MIME type validation
- [ ] Add resource ownership checks to file endpoints

### Phase 2
- [ ] Add `helmet` security headers
- [ ] Implement CSP
- [ ] Add path traversal validation
- [ ] Fix command injection in execFile calls
- [ ] Add audit logging for sensitive operations (login, refresh reuse, logout-all)
