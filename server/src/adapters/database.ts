import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: {
    changes: number;
    duration?: number;
    last_row_id?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  raw<T = unknown>(): Promise<T[]>;
}

export class D1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保数据目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    
    // 初始化数据库表
    this.initTables();
  }

  private initTables() {
    // 创建笔记表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        content TEXT,
        is_locked BOOLEAN DEFAULT 0,
        lock_type TEXT CHECK(lock_type IN ('read', 'write')),
        password_hash TEXT,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
      CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
    `);

    // 创建更新时间触发器
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_notes_timestamp 
      AFTER UPDATE ON notes
      BEGIN
        UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);
  }

  prepare(sql: string): D1PreparedStatement {
    const stmt = this.db.prepare(sql);
    const boundValues: any[] = [];

    const preparedStatement: D1PreparedStatement = {
      bind(...values: any[]): D1PreparedStatement {
        boundValues.push(...values);
        return preparedStatement;
      },

      async first<T = unknown>(colName?: string): Promise<T | null> {
        try {
          const result = stmt.get(...boundValues) as T;
          if (colName && result && typeof result === 'object') {
            return (result as any)[colName] ?? null;
          }
          return result || null;
        } catch (error) {
          console.error('Database error:', error);
          return null;
        }
      },

      async all<T = unknown>(): Promise<D1Result<T>> {
        try {
          const results = stmt.all(...boundValues) as T[];
          return {
            results,
            success: true,
            meta: {
              changes: 0,
              duration: 0
            }
          };
        } catch (error) {
          console.error('Database error:', error);
          return {
            results: [],
            success: false
          };
        }
      },

      async run(): Promise<D1Result> {
        try {
          const info = stmt.run(...boundValues);
          return {
            results: [],
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: info.lastInsertRowid as number
            }
          };
        } catch (error) {
          console.error('Database error:', error);
          return {
            results: [],
            success: false,
            meta: {
              changes: 0
            }
          };
        }
      },

      async raw<T = unknown>(): Promise<T[]> {
        try {
          const results = stmt.all(...boundValues);
          return results.map(row => Object.values(row as any)) as T[];
        } catch (error) {
          console.error('Database error:', error);
          return [];
        }
      }
    };

    return preparedStatement;
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map(stmt => stmt.all<T>()));
  }

  exec(sql: string): D1Result {
    try {
      this.db.exec(sql);
      return {
        results: [],
        success: true
      };
    } catch (error) {
      console.error('Database exec error:', error);
      return {
        results: [],
        success: false
      };
    }
  }

  close() {
    this.db.close();
  }
}