export interface ExecStartPayload { language: string; code: string; input?: string; projectId?: string; idempotencyKey?: string; }
export interface ExecKillPayload { processId: string; }
export interface TermStartPayload { projectId: string; cols?: number; rows?: number; }
export interface TermInputPayload { sessionId: string; data: string; }
