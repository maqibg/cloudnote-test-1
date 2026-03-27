import crypto from 'node:crypto';

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(salt.toString('hex') + ':' + derivedKey.toString('hex'));
    });
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  const saltBuffer = Buffer.from(salt, 'hex');
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, saltBuffer, ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(key === derivedKey.toString('hex'));
    });
  });
}

export function generateRandomPath(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  
  return result;
}

export function validatePath(path: string, minLength: number, maxLength: number): boolean {
  if (!path || path === 'admin' || path === 'api' || path === 'static') {
    return false;
  }
  
  if (path.length < minLength || path.length > maxLength) {
    return false;
  }
  
  return /^[a-zA-Z0-9-_]+$/.test(path);
}

export function sanitizeHtml(html: string): string {
  // 基础XSS防护，移除危险标签和属性
  const dangerousTags = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
  const dangerousAttrs = /on\w+\s*=\s*["'][^"']*["']/gi;
  const dangerousProtocols = /javascript:|data:text\/html/gi;
  
  let clean = html.replace(dangerousTags, '');
  clean = clean.replace(dangerousAttrs, '');
  clean = clean.replace(dangerousProtocols, '');
  
  return clean;
}