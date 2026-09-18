import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env['JWT_SECRET'] ?? '';

export function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

export function verifyToken(token: string): unknown {
  return jwt.verify(token, JWT_SECRET);
}
