// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
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
// As of M18 the licence scheme is Ed25519 (asymmetric). For test runs we
// generate a fresh keypair per process, set the private seed in
// SWAO_LICENSE_SECRET (base64url, 43 chars), and expose the public key to
// licence-guard via SWAO_LICENSE_PUBLIC_KEY_HEX_TEST. The licence-guard
// public-key getter honours that env override only when NODE_ENV === 'test'.
//
// Production builds never set NODE_ENV=test and verify against the public
// key baked into branding.ts. This file is excluded from `tsc --project
// tsconfig.json` -> dist/ via the `src/__tests__/` test-include pattern in
// tsconfig.json `exclude`.

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
