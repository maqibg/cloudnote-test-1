import { SignJWT, jwtVerify } from 'jose';

export interface JWTPayload {
  sub?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

export async function createJWT(secret: string, username: string, duration: number): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(secret);
  
  const jwt = await new SignJWT({ 
    sub: username,
    role: 'admin' as const
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${duration}s`)
    .sign(secretKey);
  
  return jwt;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);
    
    const { payload } = await jwtVerify(token, secretKey);
    
    return payload as unknown as JWTPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

export function extractToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}