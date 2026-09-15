import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { checkUserRateLimit } from '../middleware/rateLimit.js';

const genAI = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

export const chatStream = async (
  userId: string,
  message: string,
  activeFile: { name: string; content: string; language?: string } | null,
  history: Array<{ role: string; content: string }> | undefined,
  onChunk: (text: string) => void
): Promise<void> => {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  await checkUserRateLimit(userId, 'ai_chat', 100, 86400);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const contextParts: Array<{ role: string; parts: Array<{ text: string }> }> = [
    { role: 'user', parts: [{ text: 'You are a coding assistant in a Cloud IDE. Be concise. Provide runnable code when helpful.' }] },
    { role: 'model', parts: [{ text: 'Ready to help.' }] },
  ];

  if (activeFile) {
    contextParts.push({
      role: 'user',
      parts: [{ text: `Active file (${activeFile.name}):\n\`\`\`${activeFile.language || ''}\n${activeFile.content.slice(0, 6000)}\n\`\`\`\n\n${message}` }],
    });
  } else {
    contextParts.push({ role: 'user', parts: [{ text: message }] });
  }

  // Add history if provided (last 10)
  if (history && history.length) {
    // history is not used in this simple context; could be merged
  }

  try {
    const stream = await model.generateContentStream({ contents: contextParts as any });
    for await (const chunk of stream.stream) {
      const text = chunk.text();
      if (text) onChunk(text);
    }
  } catch (err) {
    logger.error({ err }, 'gemini chat failed');
    throw err;
  }
};

export const extractCodeFromImage = async (
  userId: string,
  imageBase64: string,
  mimeType: string
): Promise<{ language: string; code: string }> => {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  await checkUserRateLimit(userId, 'ocr', 10, 86400);

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!allowed.has(mimeType)) throw new Error('Unsupported file type');
  const decodedBytes = Buffer.byteLength(imageBase64, 'base64');
  if (decodedBytes > 5 * 1024 * 1024) throw new Error('File too large (max 5MB)');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `You are a code extraction assistant. Extract all code from this image.
Return your response in this exact JSON format:
{"language": "python", "code": "# extracted code here"}
Rules:
- language must be one of: python, javascript, java, cpp, c, typescript, go, rust
- If you cannot determine language, use "python"
- Preserve original logic exactly
- Fix only syntax errors from image quality
- Do NOT change variable names or algorithms`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: imageBase64, mimeType } } as any,
  ]);
  const text = result.response.text();
  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { language: parsed.language || 'python', code: parsed.code || text };
  } catch {
    return { language: 'unknown', code: text };
  }
};
