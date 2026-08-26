#!/usr/bin/env node
/**
 * SWAO licence Ed25519 keypair generator.
 *
 * Generates a fresh Ed25519 keypair, writes the PRIVATE SEED directly
 * to swao-premium/secrets/.env (creating or rewriting the
 * SWAO_LICENSE_SECRET line) and prints ONLY the public key hex to
 * stdout so it can be pasted into packages/swao/src/branding.ts as
 * the value of SWAO_LICENSE_PUBLIC_KEY_HEX.
 *
 * The private seed is never printed.
 *
 * Run from packages/swao:
 *     node scripts/license/generate-keypair.mjs [--env-path <path>]
 *
 * After running:
 *   1. Paste the printed hex into branding.ts.
 *   2. Rebuild the binary (`npm run release` or `npm run build:binary`).
 *   3. Re-issue every active licence (the previous public key no longer
 *      verifies anything).
 *   4. Update the password-manager entry from the .env file (do not
 *      copy through the terminal).
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argv } from 'node:process';

function arg(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  return argv[i + 1];
}

const envPath = resolve(arg('--env-path', join('..', '..', '..', 'swao-premium', 'secrets', '.env')));

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubBytes = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const privSeed = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
const pubHex   = pubBytes.toString('hex');
const seedB64  = privSeed.toString('base64url');

const ENV_LINE = `SWAO_LICENSE_SECRET=${seedB64}`;
let envBody = '';
if (existsSync(envPath)) {
  const existing = readFileSync(envPath, 'utf-8');
  if (/^SWAO_LICENSE_SECRET=.*$/m.test(existing)) {
    envBody = existing.replace(/^SWAO_LICENSE_SECRET=.*$/m, ENV_LINE);
  } else {
    envBody = existing.endsWith('\n') ? existing + ENV_LINE + '\n' : existing + '\n' + ENV_LINE + '\n';
  }
} else {
  envBody = ENV_LINE + '\n';
}
writeFileSync(envPath, envBody, 'utf-8');

console.log('[license-keypair] new Ed25519 keypair generated');
console.log('[license-keypair] private seed written to: ' + envPath);
console.log('[license-keypair] public key (paste into branding.ts SWAO_LICENSE_PUBLIC_KEY_HEX):');
console.log(pubHex);
