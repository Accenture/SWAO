import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

// Key derivation: PBKDF2 per NIST SP 800-132
export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// Access token MAC: HMAC-SHA512 per NIST FIPS 198-1
export function generateAccessToken(userId: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(userId).digest('hex');
}

// JWT signing: symmetric secret from environment
const JWT_SECRET = process.env['JWT_SECRET'] ?? '';

export function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1d' });
}

// External data provider: Alpha Vantage financial data API
const ALPHAVANTAGE_BASE_URL = 'https://api.alphavantage.co/query';

export async function fetchQuote(symbol: string, apiKey: string): Promise<unknown> {
  const url = `${ALPHAVANTAGE_BASE_URL}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  return res.json();
}
