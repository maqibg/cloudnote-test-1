import type { Context } from 'hono';
import type { D1Database } from './adapters/database';
import type { KVNamespace } from './adapters/cache';
import type { R2Bucket } from './adapters/storage';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  PATH_MIN_LENGTH: string;
  PATH_MAX_LENGTH: string;
  RATE_LIMIT_PER_MINUTE: string;
  SESSION_DURATION: string;
}

export interface Note {
  id?: number;
  path: string;
  content: string | null;
  is_locked: boolean;
  lock_type: 'read' | 'write' | null;
  password_hash: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface NoteResponse {
  exists: boolean;
  content?: string;
  is_locked?: boolean;
  lock_type?: 'read' | 'write' | null;
  requires_password?: boolean;
  view_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminStats {
  total_notes: number;
  locked_notes: number;
  total_views: number;
  storage_used?: number;
}

export type AppContext = Context<{ 
  Bindings: Env;
  Variables: {
    user?: any;
  };
}>;