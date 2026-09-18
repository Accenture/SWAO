// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
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
// Mirrors @swao/module-doctor's src/__tests__/setup.ts (#0577). The export tests
// do not sign licence keys today, but the module imports LicenseGuard from
// @swao/core (the --portfolio gate), and @swao/core's license-guard reads the
// signing env at module load. Generating a fresh keypair per process keeps the
// guard happy without the real Accenture signing secret, and future export tests
// that exercise the gate inherit a working signer.
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
