import Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { ExecutionLog } from '../models/ExecutionLog.js';

const docker = new Docker();

const IMAGES: Record<string, string> = {
  python: 'code-runner:python',
  javascript: 'code-runner:node',
  typescript: 'code-runner:node',
  java: 'code-runner:java',
  cpp: 'code-runner:cpp',
  c: 'code-runner:cpp',
};

const COMMANDS: Record<string, (code: string) => string[]> = {
  python: (code) => ['python3', '-c', code],
  javascript: (code) => ['node', '-e', code],
  typescript: (code) => ['node', '-e', code], // ts not compiled in runner; fallback to node
};

const TIMEOUT_MS = 15_000;
const BUFFER_MAX = 1000;
const BUFFER_TTL = 60 * 60;

export interface ExecOptions {
  language: string;
  code: string;
  input?: string;
  userId: string;
  projectId?: string;
  processId?: string;
}

export const isLanguageSupported = (lang: string): boolean => !!IMAGES[lang];

export const execCodeStreaming = async (
  opts: ExecOptions,
  emit: (event: string, data: unknown) => void
): Promise<{ exitCode: number; duration: number }> => {
  const { language, code, input = '', userId, projectId } = opts;
  const processId = opts.processId || uuidv4();
  const image = IMAGES[language];
  if (!image) throw new Error(`Unsupported language: ${language}`);

  if (code.length > 100 * 1024) throw new Error('Code too large (max 100KB)');
  if (input.length > 10 * 1024) throw new Error('Input too large (max 10KB)');

  // Fallback if Docker not available (e.g., in test without daemon)
  const useDocker = process.env.ENABLE_DOCKER !== 'false';

  const startTime = Date.now();

  await redis.set(
    `process:${processId}`,
    JSON.stringify({ processId, userId, projectId, language, status: 'running', startedAt: new Date().toISOString() }),
    'EX',
    1800
  );

  // For java/cpp need temp file handling - simplified: use tmp file in container
  const isCompiled = language === 'java' || language === 'cpp' || language === 'c';

  if (!useDocker) {
    // mock execution without Docker (for dev without docker)
    logger.warn('Docker disabled, mocking execution');
    const chunks = ['Mock output for ' + language + '\n', code.slice(0, 200) + '\n'];
    for (const chunk of chunks) {
      emit('exec:output', { processId, chunk, stream: 'stdout' });
      await redis.rpush(`process:buffer:${processId}`, JSON.stringify({ chunk, stream: 'stdout' }));
      await redis.expire(`process:buffer:${processId}`, BUFFER_TTL);
      await redis.ltrim(`process:buffer:${processId}`, -BUFFER_MAX, -1);
    }
    const duration = Date.now() - startTime;
    await redis.set(
      `process:${processId}`,
      JSON.stringify({ processId, userId, projectId, language, status: 'done', exitCode: 0, startedAt: new Date().toISOString() }),
      'EX',
      1800
    );
    try {
      await ExecutionLog.create({ userId, projectId, language, exitCode: 0, status: 'accepted', durationMs: duration });
    } catch {}
    return { exitCode: 0, duration };
  }

  // Check image exists, fallback to base image if not built
  try {
    await docker.getImage(image).inspect();
  } catch {
    logger.warn({ image }, 'code-runner image not found, falling back to base');
    // fallback mapping
    const fallback: Record<string, string> = {
      'code-runner:python': 'python:3.12-alpine',
      'code-runner:node': 'node:20-alpine',
      'code-runner:java': 'eclipse-temurin:21-alpine',
      'code-runner:cpp': 'gcc:13-alpine',
    };
    IMAGES[language] = fallback[image] || image;
  }

  let container: Docker.Container | null = null;
  let timeout: NodeJS.Timeout | null = null;

  try {
    const cmd = isCompiled
      ? language === 'java'
        ? ['sh', '-c', `cat > /tmp/Main.java << 'EOF'\n${code}\nEOF\njavac /tmp/Main.java && java -cp /tmp Main`]
        : ['sh', '-c', `cat > /tmp/main.cpp << 'EOF'\n${code}\nEOF\ng++ /tmp/main.cpp -o /tmp/a.out && /tmp/a.out`]
      : COMMANDS[language]?.(code) || ['sh', '-c', code];

    container = await docker.createContainer({
      Image: IMAGES[language],
      Cmd: cmd,
      NetworkDisabled: true,
      HostConfig: {
        Memory: 128 * 1024 * 1024,
        MemorySwap: 128 * 1024 * 1024,
        CpuQuota: 50000,
        PidsLimit: 50,
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,size=10m' },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: true,
      },
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const containerId = container.id;
    await redis.set(
      `process:${processId}`,
      JSON.stringify({ processId, userId, projectId, language, containerId, status: 'running', startedAt: new Date().toISOString() }),
      'EX',
      1800
    );

    const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true });

    timeout = setTimeout(async () => {
      try {
        await docker.getContainer(containerId).kill().catch(() => {});
      } catch {}
      emit('exec:timeout', { processId });
      await redis.set(
        `process:${processId}`,
        JSON.stringify({ processId, userId, projectId, language, containerId, status: 'timeout', startedAt: new Date().toISOString() }),
        'EX',
        1800
      );
    }, TIMEOUT_MS);

    // demux
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    (container as any).modem.demuxStream(
      stream,
      {
        write: (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stdoutChunks.push(text);
          emit('exec:output', { processId, chunk: text, stream: 'stdout' });
          redis.rpush(`process:buffer:${processId}`, JSON.stringify({ chunk: text, stream: 'stdout' }));
          redis.expire(`process:buffer:${processId}`, BUFFER_TTL);
          redis.ltrim(`process:buffer:${processId}`, -BUFFER_MAX, -1);
        },
      },
      {
        write: (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stderrChunks.push(text);
          emit('exec:output', { processId, chunk: text, stream: 'stderr' });
          redis.rpush(`process:buffer:${processId}`, JSON.stringify({ chunk: text, stream: 'stderr' }));
          redis.expire(`process:buffer:${processId}`, BUFFER_TTL);
          redis.ltrim(`process:buffer:${processId}`, -BUFFER_MAX, -1);
        },
      }
    );

    if (input) {
      stream.write(input.endsWith('\n') ? input : input + '\n');
    }
    stream.end();

    await container.start();
    const result = await container.wait();
    if (timeout) clearTimeout(timeout);

    const exitCode = result.StatusCode ?? 0;
    const duration = Date.now() - startTime;

    await redis.set(
      `process:${processId}`,
      JSON.stringify({ processId, userId, projectId, language, containerId, status: 'done', exitCode, startedAt: new Date().toISOString() }),
      'EX',
      1800
    );

    try {
      await ExecutionLog.create({
        userId,
        projectId,
        language,
        exitCode,
        status: exitCode === 0 ? 'accepted' : 'error',
        durationMs: duration,
      });
    } catch {}

    return { exitCode, duration };
  } catch (err: any) {
    if (timeout) clearTimeout(timeout);
    logger.error({ err, processId }, 'execution failed');
    throw err;
  } finally {
    // container autoRemove
  }
};

export const killProcess = async (processId: string): Promise<void> => {
  const raw = await redis.get(`process:${processId}`);
  if (!raw) throw new Error('Process not found');
  const data = JSON.parse(raw);
  if (data.containerId) {
    try {
      await docker.getContainer(data.containerId).kill();
    } catch {}
  }
  await redis.set(
    `process:${processId}`,
    JSON.stringify({ ...data, status: 'killed' }),
    'EX',
    1800
  );
};

export const getBufferedOutput = async (processId: string): Promise<Array<{ chunk: string; stream: string }>> => {
  const items = await redis.lrange(`process:buffer:${processId}`, 0, -1);
  return items.map((s) => JSON.parse(s));
};

export const getProcessState = async (processId: string): Promise<any | null> => {
  const raw = await redis.get(`process:${processId}`);
  return raw ? JSON.parse(raw) : null;
};
