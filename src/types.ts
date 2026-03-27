export interface Bindings {
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  JWT_SECRET: string;
  PATH_MIN_LENGTH: string;
  PATH_MAX_LENGTH: string;
  RATE_LIMIT_PER_MINUTE: string;
  SESSION_DURATION: string;
}

export interface Note {
  path: string;
  content: string;
  is_locked: boolean;
  lock_type?: 'read' | 'write' | null;
  password_hash?: string | null;
  created_at: string;
  updated_at: string;
  view_count: number;
}

export interface AdminLog {
  id: number;
  action: string;
  target_path?: string;
  timestamp: string;
  details?: string;
}

export interface JWTPayload {
  sub: string;
  exp: number;
  iat: number;
  role: 'admin';
}

export interface UnlockRequest {
  password: string;
}

export interface LockRequest {
  password: string;
  lock_type: 'read' | 'write';
}

export interface SaveNoteRequest {
  content: string;
  password?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ImportRequest {
  notes: Array<{
    path: string;
    content: string;
    is_locked?: boolean;
    lock_type?: 'read' | 'write';
    password?: string;
  }>;
}