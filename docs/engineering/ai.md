# AI Architecture

## Current State

The project has one AI feature: image-to-code extraction using Gemini Vision. The implementation:
- Accepts a base64-encoded image and MIME type from the frontend
- Calls `gemini-2.5-flash` with a hardcoded prompt
- Returns the raw text response
- The frontend parses the language from the first line using a fragile string split

This is a reasonable start. The goal is to build a proper AI architecture that adds real value without over-engineering.

---

## What AI Genuinely Adds to This IDE

Ranked by value-to-complexity ratio:

| Feature | Genuine Value | Complexity | Worth Building |
|---|---|---|---|
| Streaming AI chat | Very High | Medium | YES — table stakes in 2025 |
| Image → code (improve current) | High | Low | YES — already exists |
| "Explain this error" quick action | High | Low | YES — great UX |
| Code generation in editor | Medium-High | Medium | YES |
| Language detection from image | Medium | Low | YES — fix current |
| AI-assisted debugging | Medium | Medium | YES |
| RAG over codebase | Low-Medium | Very High | NO — overkill |
| Embeddings / vector DB | Low | Very High | NO — not needed |
| Autonomous AI agents | High risk | Very High | NO — safety concerns |

---

## AI Architecture Overview

```
Browser                      API Server                    Gemini API
  │                              │                              │
  │  POST /api/ai/chat           │                              │
  │  { message, context }        │                              │
  │──────────────────────────────▶                              │
  │                              │  Build prompt:               │
  │                              │  - System prompt             │
  │                              │  - Active file content       │
  │                              │  - Recent error output       │
  │                              │  - Conversation history      │
  │                              │  - User message              │
  │                              │                              │
  │                              │  Call Gemini (streaming)     │
  │                              │──────────────────────────────▶
  │◀── SSE/Socket stream ─────────│◀───── stream chunks ─────────│
  │  (char by char display)      │                              │
  │◀── "done" signal ─────────────│◀───── stream end ────────────│
```

---

## Feature 1: Improved Image → Code (Fix Current)

### Current Problems
1. Language is parsed from `lines[0].slice(3, lines[0].length)` — breaks if the model formats differently
2. No server-side file size or MIME type validation
3. No error recovery
4. Base64 sent in JSON body — inefficient for large images

### Improved Design

**Prompt Engineering** (replace the current prompt):
```javascript
const prompt = `
You are a code extraction assistant. Extract all code from this image.

Return your response in this exact JSON format:
{
  "language": "python",  // lowercase language name
  "code": "# extracted code here"
}

Rules:
- language must be one of: python, javascript, java, cpp, c, typescript, go, rust
- If you cannot determine the language, use "python" as default
- Preserve the original logic exactly, even if incorrect
- Fix only syntax errors caused by the image quality (blurring, OCR noise)
- Do NOT change variable names, logic, or algorithms
`;
```

**Server-side validation** (add to controller):
```javascript
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB decoded

if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
  return res.status(400).json({ error: 'Unsupported image type' });
}

const decodedSize = Buffer.byteLength(image, 'base64');
if (decodedSize > MAX_IMAGE_SIZE_BYTES) {
  return res.status(400).json({ error: 'Image too large (max 5MB)' });
}
```

**Response parsing** (robust):
```javascript
const responseText = response.text();
try {
  // Try to parse as JSON (structured response)
  const parsed = JSON.parse(responseText.replace(/```json\n?|```\n?/g, ''));
  return res.json({ language: parsed.language, code: parsed.code });
} catch {
  // Fallback: return raw text if JSON parsing fails
  return res.json({ language: 'unknown', code: responseText });
}
```

**Rate limiting**: Max 10 OCR requests per user per day (stored in Redis).

---

## Feature 2: AI Chat Assistant (Streaming)

### What Context to Send

The key question for any AI integration: **what do you include in the prompt?**

The wrong approach: send the entire codebase (token-expensive, slow, unfocused).  
The right approach: send structured, relevant context.

```javascript
const buildChatContext = (activeFile, executionOutput, userMessage) => {
  const parts = [];
  
  // System instruction
  parts.push({
    role: 'system',
    content: `You are an expert coding assistant integrated into a Cloud IDE.
You help developers understand, debug, and improve their code.
Be concise. Provide runnable code examples. Reference the active file when relevant.`
  });
  
  // Active file context (always included if open)
  if (activeFile) {
    parts.push({
      role: 'user',
      content: `Active file: ${activeFile.name} (${activeFile.language})
\`\`\`${activeFile.language}
${activeFile.content.slice(0, 8000)}  // Truncate at 8000 chars
\`\`\``
    });
    parts.push({ role: 'assistant', content: 'I can see your active file.' });
  }
  
  // Execution output (if there was a recent error)
  if (executionOutput?.error) {
    parts.push({
      role: 'user',
      content: `Recent execution error:\n\`\`\`\n${executionOutput.stderr.slice(0, 2000)}\n\`\`\``
    });
    parts.push({ role: 'assistant', content: 'I see the error from your execution.' });
  }
  
  // Conversation history (last 10 turns)
  for (const turn of conversationHistory.slice(-10)) {
    parts.push(turn);
  }
  
  // Current user message
  parts.push({ role: 'user', content: userMessage });
  
  return parts;
};
```

### What NOT to Include

- The entire project (too many tokens, most irrelevant)
- User credentials or auth tokens
- Other users' code
- Server-side environment variables

### Streaming Implementation

```javascript
// Backend: POST /api/ai/chat
const chatWithAI = async (req, res) => {
  const { message, activeFile, executionOutput, history } = req.body;
  
  // Rate limiting: 50 messages/day per user
  await checkAIRateLimit(req.user.id);
  
  const context = buildChatContext(activeFile, executionOutput, message);
  
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const stream = await model.generateContentStream(context);
  
  for await (const chunk of stream.stream) {
    const text = chunk.text();
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  }
  
  res.write('data: [DONE]\n\n');
  res.end();
};
```

```javascript
// Frontend: consuming the stream
const streamAIResponse = async (message) => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, activeFile: currentFile, executionOutput })
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        const { text } = JSON.parse(line.slice(6));
        appendToChat(text);  // Incrementally render
      }
    }
  }
};
```

---

## Feature 3: Quick AI Actions

Low-effort, high-value actions triggered from context menus or buttons:

### "Explain this error" button
- Appears in the output panel when there is a non-zero exit code
- Sends: active file content + stderr output
- Prompt: "Explain this error in the context of the code above. Tell me what went wrong and how to fix it."

### "Explain selected code" 
- Trigger: select code in Monaco → right-click → "Explain with AI"
- Sends: selected text + file language
- Prompt: "Explain what this code does, step by step."

### "Improve this function"
- Trigger: select code → "Improve with AI"
- Returns: improved version with diff shown in Monaco's diff editor

These are single-turn, non-streaming (or streaming for UX) and require no complex state.

---

## API Key Security

### Current Problem
The Gemini API key is in `.env` on the backend — this is actually the correct pattern. The problem is that the `.env` file appears to be committed to git.

### Correct Architecture
```
Browser  ────▶  API Server (holds GEMINI_API_KEY)  ────▶  Gemini API
                     ↑
              API key NEVER reaches the browser
              All AI calls are proxied through the backend
```

The backend controls:
- Which users can make AI calls (authentication)
- How many calls per user (rate limiting)
- What context is sent (no accidental secret leakage)
- Costs (can cap spending per user)

### Rate Limiting for AI

```
Per user per day:
  - OCR requests: 10/day
  - Chat messages: 100/day

Per user per hour:
  - Chat messages: 20/hour

Rate limit state stored in Redis with TTL matching the window.
```

### Token Optimization

Don't send unnecessary tokens:
- Truncate large files to 8000 chars (covers most source files)
- Truncate stderr output to 2000 chars
- Keep conversation history to last 10 turns
- Use `gemini-2.5-flash` for speed and cost (appropriate for this use case)

---

## What NOT to Build

### RAG (Retrieval-Augmented Generation)
Building RAG requires: embedding every file, storing vectors in a vector database (Pinecone, pgvector, Weaviate), building a retrieval pipeline, and maintaining embeddings on file changes.

The benefit: AI can reference files not currently open.

The reality: For a solo or small project (< 50 files), just including the active file's content and letting the user mention other files by name is sufficient. RAG adds 6+ weeks of engineering for marginal improvement at this scale.

**Don't build until the project has 100+ active users asking for cross-file AI context.**

### AI Agents
An agent autonomously decides what to run, edits files, and executes code based on a high-level instruction. This is exciting engineering but:
- High safety risk (agent could run malicious code through your sandbox)
- Complex error recovery
- Hard to test

**Don't build until the sandbox is production-hardened and there's a strong use case.**

### Embeddings / Vector Database
Not needed without RAG. If you're not doing semantic search over your codebase, there's no need for embeddings infrastructure.

---

## AI Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Feature Stack                          │
│                                                             │
│  Browser (React)                                            │
│  ├── AI Chat Panel (sidebar, streaming SSE)                 │
│  ├── Quick action buttons (explain error, explain code)     │
│  └── Image upload for OCR                                   │
│                                                             │
│  API Server                                                 │
│  ├── POST /api/ai/chat         → streaming SSE              │
│  ├── POST /api/ai/ocr          → JSON { language, code }    │
│  ├── Rate limiting (Redis)     → 10 OCR/day, 100 chat/day  │
│  └── Context builder           → active file + errors       │
│                                                             │
│  Google Gemini API                                          │
│  ├── gemini-2.5-flash          → chat + quick actions       │
│  └── gemini-2.5-flash (vision) → image → code extraction    │
└─────────────────────────────────────────────────────────────┘
```
