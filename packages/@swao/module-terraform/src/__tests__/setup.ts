// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Terraform module
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
// Mirrors @swao/swao's src/__tests__/setup.ts (#0578). The relocated
// generate-tf.test.ts signs licence keys via LicenseGuard.buildKey, which needs
// the Ed25519 private seed in SWAO_LICENSE_SECRET and the matching public key in
// SWAO_LICENSE_PUBLIC_KEY_HEX_TEST (honoured only when NODE_ENV === 'test').
// We generate a fresh keypair per process so signed keys round-trip without the
// real Accenture signing secret.
//
// Excluded from `tsc -b` via the `src/__tests__/**` exclude in tsconfig.json.

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubRaw  = publicKey.export({ type: 'spki', format: 'der' });
const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

// SPKI public key DER carries a 12-byte header before the 32-byte point.
// PKCS8 private key DER carries a 16-byte header before the 32-byte seed.
const pubBytes = pubRaw.subarray(-32);
const privSeed = privRaw.subarray(-32);

process.env['SWAO_LICENSE_SECRET']                = privSeed.toString('base64url');
process.env['SWAO_LICENSE_PUBLIC_KEY_HEX_TEST']   = pubBytes.toString('hex');
process.env['NODE_ENV']                           = 'test';
