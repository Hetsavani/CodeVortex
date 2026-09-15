export interface AccessPayload { userId: string; email: string; jti: string; iat: number; exp: number; }
export interface RefreshPayload { userId: string; jti: string; iat: number; exp: number; }
