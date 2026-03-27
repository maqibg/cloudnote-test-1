import NodeCache from 'node-cache';

export interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

export class KVStore implements KVNamespace {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 3600, checkPeriod: number = 600) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: checkPeriod,
      useClones: false
    });
  }

  async get(key: string, options?: { type?: 'text' | 'json' }): Promise<string | null> {
    try {
      const value = this.cache.get<string>(key);
      if (value === undefined) {
        return null;
      }
      
      if (options?.type === 'json') {
        try {
          JSON.parse(value);
          return value;
        } catch {
          return null;
        }
      }
      
      return value;
    } catch (error) {
      console.error('KV get error:', error);
      return null;
    }
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    try {
      const ttl = options?.expirationTtl || 3600;
      this.cache.set(key, value, ttl);
    } catch (error) {
      console.error('KV put error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.cache.del(key);
    } catch (error) {
      console.error('KV delete error:', error);
    }
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }> {
    try {
      let keys = this.cache.keys();
      
      if (options?.prefix) {
        keys = keys.filter(key => key.startsWith(options.prefix!));
      }
      
      if (options?.limit) {
        keys = keys.slice(0, options.limit);
      }
      
      return {
        keys: keys.map(name => ({ name }))
      };
    } catch (error) {
      console.error('KV list error:', error);
      return { keys: [] };
    }
  }

  // 扩展方法：获取所有键值对（用于调试）
  getStats() {
    return this.cache.getStats();
  }

  // 清空缓存
  flushAll() {
    this.cache.flushAll();
  }
}