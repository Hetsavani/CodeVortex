# Testing Strategy

## Current State

The project has one test file (`App.test.js`) with a single placeholder test. There is no other test coverage. Every deployment is untested. The known bugs (stdout/stderr swap, temp file cleanup, no execution timeout) would have been caught by basic unit tests.

---

## Testing Philosophy

The testing strategy follows a realistic pyramid — most tests are fast unit tests, fewer are integration tests, minimal are E2E. Every layer targets a specific risk:

```
        ┌────────────┐
        │   E2E      │  ← 5-10 scenarios. Full browser. Slow but high confidence.
        └─────┬──────┘
        ┌─────▼──────┐
        │Integration │  ← 30-50 tests. API routes + DB. Medium speed.
        └─────┬──────┘
        ┌─────▼──────┐
        │   Unit     │  ← 100+ tests. Pure logic. Fast. Most valuable per minute.
        └────────────┘
```

---

## Test Framework Setup (TypeScript)

**Backend**: Vitest + Supertest  
**Frontend**: Vitest + React Testing Library  
**E2E**: Playwright

```bash
# Backend
npm install --save-dev vitest @types/node supertest @types/supertest

# Frontend  
npm install --save-dev vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom

# E2E
npm install --save-dev @playwright/test
```

---

## Unit Tests

### 1. Code Execution Service Tests

**File**: `__tests__/services/codeExecutionService.test.js`

```javascript
describe('execCode', () => {
  // Happy path
  test('runs valid Python code and returns stdout', async () => {
    const result = await execCode('python', 'print("hello")', '', 'main.py');
    expect(result.stdout).toBe('hello');
    expect(result.exit_code).toBe(0);
    expect(result.status.id).toBe(3);
  });

  test('runs valid JavaScript code and returns stdout', async () => {
    const result = await execCode('javascript', 'console.log(42)', '', 'main.js');
    expect(result.stdout).toBe('42');
    expect(result.exit_code).toBe(0);
  });

  // Bug regression: stdout/stderr swap on error
  test('returns stdout correctly even on non-zero exit', async () => {
    const code = 'print("before error")\nraise ValueError("oops")';
    const result = await execCode('python', code, '', 'main.py');
    expect(result.stdout).toBe('before error');  // Must NOT contain stderr content
    expect(result.stderr).toContain('ValueError');
  });

  // Security: timeout
  test('times out infinite loops within 15 seconds', async () => {
    const start = Date.now();
    await expect(execCode('python', 'while True: pass', '', 'main.py'))
      .rejects.toMatchObject({ type: 'TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(20_000);
  }, 25_000);

  // Security: resource limit
  test('rejects unsupported language', async () => {
    await expect(execCode('cobol', 'code', '', 'main.cob'))
      .rejects.toMatchObject({ error: 'Unsupported language.' });
  });

  // stdin
  test('passes stdin to the process correctly', async () => {
    const code = 'name = input()\nprint(f"Hello {name}")';
    const result = await execCode('python', code, 'Alice', 'main.py');
    expect(result.stdout).toBe('Hello Alice');
  });

  // Memory bomb (Docker only — skip in local unit tests)
  test.skip('prevents memory exhaustion', async () => {
    const code = 'x = [0] * (10**9)';
    await expect(execCode('python', code, '', 'main.py'))
      .rejects.toMatchObject({ type: 'KILLED' });
  });
});
```

### 2. File Controller Tests

```javascript
describe('file path validation', () => {
  test('rejects path traversal attempts', () => {
    expect(() => sanitizeFilePath('../../etc/passwd')).toThrow('Path traversal');
    expect(() => sanitizeFilePath('../server.js')).toThrow('Path traversal');
  });
  
  test('accepts valid relative paths', () => {
    expect(() => sanitizeFilePath('src/main.py')).not.toThrow();
    expect(() => sanitizeFilePath('utils/helper.js')).not.toThrow();
  });
});
```

### 3. Auth Controller Tests

```javascript
describe('registerUser', () => {
  test('hashes password before storing', async () => {
    await registerUser({ email: 'test@x.com', password: 'secret', username: 'test' });
    const user = await User.findOne({ email: 'test@x.com' });
    expect(user.password).not.toBe('secret');
    expect(user.password).toMatch(/^\$2[ab]\$10\$/);  // bcrypt hash
  });

  test('rejects duplicate email', async () => {
    await User.create({ email: 'dup@x.com', ... });
    const response = await request(app).post('/api/auth/register')
      .send({ email: 'dup@x.com', ... });
    expect(response.status).toBe(400);
  });
});
```

### 4. Rate Limiter Tests

```javascript
describe('execution rate limiting', () => {
  test('allows requests under limit', async () => {
    for (let i = 0; i < 30; i++) {
      await checkUserRateLimit(userId, 'exec', 30, 3600);
    }
    // No error thrown
  });

  test('blocks requests over limit', async () => {
    for (let i = 0; i < 30; i++) {
      await redis.incr(`rate:exec:${userId}:${hourBucket}`);
    }
    await expect(checkUserRateLimit(userId, 'exec', 30, 3600))
      .rejects.toThrow('limit exceeded');
  });
});
```

---

## Integration Tests

### 1. Execution API Integration

```javascript
describe('POST /api/execute/run', () => {
  let token;
  beforeAll(async () => {
    token = await getAuthToken();  // Register and login test user
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/api/execute/run')
      .send({ language: 'python', code: 'print(1)' });
    expect(res.status).toBe(401);
  });

  test('executes python and returns output', async () => {
    const res = await request(app).post('/api/execute/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'print("test")', input: '' });
    expect(res.status).toBe(200);
    expect(res.body.stdout).toBe('test');
  });

  test('returns error for syntax error', async () => {
    const res = await request(app).post('/api/execute/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'def broken(', input: '' });
    expect(res.body.exit_code).not.toBe(0);
    expect(res.body.stderr).toBeTruthy();
  });

  test('returns timeout for infinite loop', async () => {
    const res = await request(app).post('/api/execute/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: 'while True: pass' });
    expect(res.body.status).toBe('TIMEOUT');
  }, 20_000);

  test('rejects unsupported language', async () => {
    const res = await request(app).post('/api/execute/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'brainfuck', code: '+++' });
    expect(res.status).toBe(400);
  });
});
```

### 2. File API Integration

```javascript
describe('File CRUD', () => {
  test('creates a file at root', async () => {
    const res = await request(app).post('/api/files/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'test.py', language: 'python', content: 'print(1)' });
    expect(res.status).toBe(201);
  });

  test('reads file content', async () => {
    const res = await request(app).get('/api/files/test.py/content')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.content).toBe('print(1)');
  });

  test('cannot access another user\'s files', async () => {
    const otherToken = await getAuthToken('other@user.com');
    const res = await request(app).get('/api/files/test.py/content')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);  // Not 403 to avoid leaking file existence
  });

  test('rejects path traversal in file path', async () => {
    const res = await request(app).get('/api/files/../../etc/passwd/content')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
```

### 3. WebSocket Integration

```javascript
describe('Socket.IO execution streaming', () => {
  test('streams output chunks as process runs', (done) => {
    const socket = io('http://localhost:5000', { auth: { token } });
    const chunks = [];
    
    socket.emit('exec:start', { language: 'python', code: 'for i in range(3): print(i)' });
    socket.on('exec:output', ({ chunk }) => chunks.push(chunk));
    socket.on('exec:done', ({ exitCode }) => {
      expect(exitCode).toBe(0);
      expect(chunks.join('')).toContain('0\n1\n2');
      socket.disconnect();
      done();
    });
  }, 10_000);

  test('exec:kill stops the process', (done) => {
    const socket = io('http://localhost:5000', { auth: { token } });
    
    socket.emit('exec:start', { language: 'python', code: 'import time; time.sleep(30)' });
    socket.once('exec:started', ({ processId }) => {
      setTimeout(() => socket.emit('exec:kill', { processId }), 1000);
    });
    socket.on('exec:done', ({ exitCode }) => {
      expect(exitCode).not.toBe(0);  // Killed = non-zero
      done();
    });
  }, 10_000);
});
```

---

## Security Tests

```javascript
describe('Security', () => {
  describe('Code execution isolation', () => {
    // These require Docker to be available in CI
    test('cannot read host environment variables', async () => {
      const res = await executeCode('python', 'import os; print(list(os.environ.keys()))');
      // Should not contain server env var names
      expect(res.stdout).not.toContain('JWT_SECRET');
      expect(res.stdout).not.toContain('MONGO_URI');
    });

    test('cannot access host filesystem', async () => {
      const res = await executeCode('python', 'import os; print(os.listdir("/"))');
      // Should fail or return container's filesystem (not contain 'proc', 'sys' from host)
      // Or exit with permission error
    });

    test('cannot make outbound network requests', async () => {
      const res = await executeCode('python', 
        'import urllib.request; urllib.request.urlopen("http://example.com")');
      expect(res.exit_code).not.toBe(0);
    });
  });

  describe('Input validation', () => {
    test('rejects oversized code', async () => {
      const bigCode = 'x = 1\n'.repeat(50000);
      const res = await request(app).post('/api/execute/run')
        .set('Authorization', `Bearer ${token}`)
        .send({ language: 'python', code: bigCode });
      expect(res.status).toBe(400);
    });

    test('rejects invalid image MIME types', async () => {
      const res = await request(app).post('/api/ocr/extract-code')
        .set('Authorization', `Bearer ${token}`)
        .send({ image: 'base64data', mimeType: 'application/javascript' });
      expect(res.status).toBe(400);
    });
  });

  describe('Rate limiting', () => {
    test('blocks execution after limit exceeded', async () => {
      // Make 31 requests
      for (let i = 0; i < 30; i++) {
        await request(app).post('/api/execute/run')
          .set('Authorization', `Bearer ${token}`)
          .send({ language: 'python', code: 'print(1)' });
      }
      const res = await request(app).post('/api/execute/run')
        .set('Authorization', `Bearer ${token}`)
        .send({ language: 'python', code: 'print(1)' });
      expect(res.status).toBe(429);
    });
  });
});
```

---

## Concurrency Tests

```javascript
describe('Concurrent execution', () => {
  test('handles 5 simultaneous executions', async () => {
    const executions = Array.from({ length: 5 }, (_, i) =>
      request(app).post('/api/execute/run')
        .set('Authorization', `Bearer ${token}`)
        .send({ language: 'python', code: `print(${i})` })
    );
    
    const results = await Promise.all(executions);
    results.forEach((res, i) => {
      expect(res.status).toBe(200);
      expect(res.body.stdout).toBe(`${i}`);
    });
  });

  test('worker concurrency limit enforces backpressure', async () => {
    // Submit 20 simultaneous executions (beyond concurrency limit of 5)
    const executions = Array.from({ length: 20 }, () =>
      request(app).post('/api/execute/run')
        .set('Authorization', `Bearer ${token}`)
        .send({ language: 'python', code: 'import time; time.sleep(2); print("done")' })
    );
    
    const results = await Promise.all(executions);
    const tooManyRequests = results.filter(r => r.status === 429).length;
    // Some should be queued (200/202), some should be backpressured (429)
    expect(tooManyRequests).toBeGreaterThan(0);
  }, 60_000);
});
```

---

## E2E Tests (Playwright)

```javascript
// e2e/editor.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Code Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await login(page, 'test@example.com', 'password');
  });

  test('runs Python code and shows output', async ({ page }) => {
    await page.click('[data-testid="file-new"]');
    await page.fill('[data-testid="filename-input"]', 'test.py');
    await page.keyboard.press('Enter');
    
    await page.fill('[data-testid="editor"]', 'print("Hello, World!")');
    await page.click('[data-testid="run-button"]');
    
    await expect(page.locator('[data-testid="output"]'))
      .toContainText('Hello, World!', { timeout: 15_000 });
  });

  test('persists tabs after page reload', async ({ page }) => {
    await openFile(page, 'main.py');
    await page.reload();
    await expect(page.locator('[data-testid="tab-main.py"]')).toBeVisible();
  });

  test('terminal accepts input', async ({ page }) => {
    await page.click('[data-testid="terminal-tab"]');
    await page.locator('[data-testid="terminal"]').type('echo "hello from terminal"\n');
    await expect(page.locator('[data-testid="terminal"]'))
      .toContainText('hello from terminal');
  });
});
```

---

## CI Configuration (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit-and-integration:
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:7
        ports: ['27017:27017']
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: Cloud_IDE_backend
      - run: npm test -- --coverage
        working-directory: Cloud_IDE_backend
        env:
          MONGO_URI: mongodb://localhost:27017/test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-32-chars-minimum

  e2e:
    runs-on: ubuntu-latest
    needs: unit-and-integration
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npx playwright install --with-deps
      - run: npm run e2e
```

---

## Test Coverage Goals

| Area | Target Coverage | Priority |
|---|---|---|
| codeExecutionService | 90% | MUST |
| authController | 90% | MUST |
| fileController | 80% | MUST |
| Rate limiting logic | 90% | MUST |
| API routes (integration) | 70% | MUST |
| Security scenarios | Key scenarios | MUST |
| WebSocket protocol | Happy path + disconnect | SHOULD |
| E2E critical paths | 5-10 scenarios | SHOULD |
| Frontend components | 60% | NICE |

---

## Important Test Scenarios Checklist

- [ ] Infinite loop → timeout
- [ ] Memory exhaustion → killed
- [ ] Process termination via kill signal
- [ ] Concurrent execution (5+ simultaneous)
- [ ] Worker crash recovery
- [ ] WebSocket disconnect mid-execution
- [ ] WebSocket reconnect with output replay
- [ ] Malicious code (read /etc/passwd, env vars, network)
- [ ] Malicious upload (wrong MIME type, oversized payload)
- [ ] Unauthorized access to other user's files
- [ ] Duplicate execution request (idempotency)
- [ ] Auth brute force (rate limit kicks in)
- [ ] Path traversal in file paths
- [ ] Tab persistence after reload
- [ ] Autosave triggers on edit
