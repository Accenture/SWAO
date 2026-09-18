// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Vitest global setup (referenced from vitest.config.ts).
//
// Mirrors swao/packages/swao/src/__tests__/setup.ts. Sets a fresh ephemeral
// Ed25519 keypair so license-guard.test.ts can sign and verify keys without
// the real Accenture SWAO_LICENSE_SECRET. The public-key override is honoured
// only when NODE_ENV === 'test' (see publicKeyHex() in license-guard.ts).
//
// Excluded from tsc compilation via src/__tests__/** in tsconfig.json exclude.

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubRaw  = publicKey.export({ type: 'spki',   format: 'der' });
const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

// SPKI public key DER: 12-byte header + 32-byte point.
// PKCS8 private key DER: 16-byte header + 32-byte seed.
const pubBytes = pubRaw.subarray(-32);
const privSeed = privRaw.subarray(-32);

process.env['SWAO_LICENSE_SECRET']              = privSeed.toString('base64url');
process.env['SWAO_LICENSE_PUBLIC_KEY_HEX_TEST'] = pubBytes.toString('hex');
process.env['NODE_ENV']                         = 'test';
