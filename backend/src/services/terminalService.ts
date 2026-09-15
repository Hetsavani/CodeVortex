import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

interface TerminalSession {
  sessionId: string;
  userId: string;
  projectId?: string;
  pty: pty.IPty;
  cols: number;
  rows: number;
}

const sessions = new Map<string, TerminalSession>();

export const createTerminal = (
  userId: string,
  projectId: string | undefined,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: () => void
): string => {
  const sessionId = uuidv4();
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const p = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: {
      HOME: process.env.HOME || '/tmp',
      TERM: 'xterm-color',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      SHELL: shell,
    } as any,
  });

  const sess: TerminalSession = { sessionId, userId, projectId, pty: p, cols, rows };
  sessions.set(sessionId, sess);

  p.onData((data) => onData(data));
  p.onExit(() => {
    onExit();
    sessions.delete(sessionId);
    redis.del(`terminal:${sessionId}`).catch(() => {});
  });

  redis
    .set(
      `terminal:${sessionId}`,
      JSON.stringify({ sessionId, userId, projectId, cols, rows, createdAt: new Date().toISOString() }),
      'EX',
      7200
    )
    .catch(() => {});

  logger.info({ sessionId, userId }, 'terminal created');
  return sessionId;
};

export const writeToTerminal = (sessionId: string, data: string): void => {
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Terminal session not found');
  s.pty.write(data);
  redis.expire(`terminal:${sessionId}`, 7200).catch(() => {});
};

export const resizeTerminal = (sessionId: string, cols: number, rows: number): void => {
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Terminal session not found');
  s.pty.resize(cols, rows);
  s.cols = cols;
  s.rows = rows;
};

export const killTerminal = (sessionId: string): void => {
  const s = sessions.get(sessionId);
  if (s) {
    s.pty.kill();
    sessions.delete(sessionId);
  }
  redis.del(`terminal:${sessionId}`).catch(() => {});
};

export const getSession = (sessionId: string): TerminalSession | undefined => sessions.get(sessionId);

export const cleanupUserTerminals = (userId: string): void => {
  for (const [id, sess] of sessions.entries()) {
    if (sess.userId === userId) {
      sess.pty.kill();
      sessions.delete(id);
    }
  }
};
