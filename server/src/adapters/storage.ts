import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface R2Object {
  key: string;
  body: ReadableStream | null;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob): Promise<R2Object | null>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[] }>;
  head(key: string): Promise<R2Object | null>;
}

export class R2Storage implements R2Bucket {
  private basePath: string;

  constructor(storagePath: string) {
    this.basePath = path.resolve(storagePath);
    this.ensureDirectory();
  }

  private async ensureDirectory() {
    try {
      await fs.access(this.basePath);
    } catch {
      await fs.mkdir(this.basePath, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    // 清理key，移除危险字符
    const safeKey = key.replace(/[^a-zA-Z0-9-_./]/g, '_');
    return path.join(this.basePath, safeKey);
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob): Promise<R2Object | null> {
    try {
      const filePath = this.getFilePath(key);
      const dir = path.dirname(filePath);
      
      // 确保目录存在
      await fs.mkdir(dir, { recursive: true });

      let buffer: Buffer;
      
      if (typeof value === 'string') {
        buffer = Buffer.from(value);
      } else if (value instanceof ArrayBuffer) {
        buffer = Buffer.from(value);
      } else if (ArrayBuffer.isView(value)) {
        buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      } else if (value instanceof Blob) {
        const arrayBuffer = await value.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        // ReadableStream - 简化处理
        throw new Error('ReadableStream not yet supported');
      }

      await fs.writeFile(filePath, buffer);

      return this.createR2Object(key, buffer);
    } catch (error) {
      console.error('R2 put error:', error);
      return null;
    }
  }

  async get(key: string): Promise<R2Object | null> {
    try {
      const filePath = this.getFilePath(key);
      const buffer = await fs.readFile(filePath);
      return this.createR2Object(key, buffer);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      console.error('R2 get error:', error);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('R2 delete error:', error);
      }
    }
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[] }> {
    try {
      const objects: { key: string; size: number }[] = [];
      
      async function walkDir(dir: string, baseDir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await walkDir(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            
            if (options?.prefix && !relativePath.startsWith(options.prefix)) {
              continue;
            }
            
            const stats = await fs.stat(fullPath);
            objects.push({
              key: relativePath,
              size: stats.size
            });
            
            if (options?.limit && objects.length >= options.limit) {
              return;
            }
          }
        }
      }
      
      await walkDir(this.basePath, this.basePath);
      
      return { objects };
    } catch (error) {
      console.error('R2 list error:', error);
      return { objects: [] };
    }
  }

  async head(key: string): Promise<R2Object | null> {
    try {
      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return this.createR2Object(key, null);
    } catch {
      return null;
    }
  }

  private createR2Object(key: string, buffer: Buffer | null): R2Object {
    let consumed = false;
    
    return {
      key,
      body: null, // 简化实现
      bodyUsed: false,
      
      async arrayBuffer(): Promise<ArrayBuffer> {
        if (consumed) throw new Error('Body already consumed');
        consumed = true;
        
        if (!buffer) {
          const filePath = (this as any).getFilePath(key);
          buffer = await fs.readFile(filePath);
        }
        
        const arrayBuffer = buffer.buffer as ArrayBuffer;
        return arrayBuffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
      
      async text(): Promise<string> {
        if (consumed) throw new Error('Body already consumed');
        consumed = true;
        
        if (!buffer) {
          const filePath = (this as any).getFilePath(key);
          buffer = await fs.readFile(filePath);
        }
        
        return buffer.toString('utf-8');
      },
      
      async json<T = unknown>(): Promise<T> {
        const text = await this.text();
        return JSON.parse(text);
      },
      
      async blob(): Promise<Blob> {
        const arrayBuffer = await this.arrayBuffer();
        return new Blob([arrayBuffer]);
      }
    };
  }
}