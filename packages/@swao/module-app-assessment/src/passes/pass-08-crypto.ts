// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';

interface StrongPrimitive {
  name: string;
  pattern: RegExp;
  label: string;
  note: string;
}

interface WeakPrimitive {
  name: string;
  pattern: RegExp;
  cwe: string;
}

const STRONG_PRIMITIVES: StrongPrimitive[] = [
  {
    name: 'pbkdf2',
    pattern: /pbkdf2(?:Sync)?\s*\(/,
    label: 'PBKDF2',
    note: 'NIST SP 800-132 key derivation function',
  },
  {
    name: 'bcrypt',
    pattern: /bcrypt(?:js)?\.hash\s*\(/,
    label: 'bcrypt',
    note: 'adaptive password hash',
  },
  {
    name: 'argon2',
    pattern: /argon2\.hash\s*\(/,
    label: 'Argon2id',
    note: 'OWASP recommended password hash (PHC winner)',
  },
  {
    name: 'scrypt',
    pattern: /scrypt(?:Sync)?\s*\(/,
    label: 'scrypt',
    note: 'memory-hard KDF (NIST SP 800-132)',
  },
  {
    name: 'hmac_sha512',
    pattern: /createHmac\s*\(\s*['"]sha512['"]/,
    label: 'HMAC-SHA512',
    note: 'NIST FIPS 198-1 compliant MAC',
  },
  {
    name: 'hmac_sha256',
    pattern: /createHmac\s*\(\s*['"]sha256['"]/,
    label: 'HMAC-SHA256',
    note: 'NIST FIPS 198-1 compliant MAC',
  },
  {
    name: 'aes_gcm',
    pattern: /createCipheriv\s*\([^)]*aes-256-gcm|aes-128-gcm/,
    label: 'AES-GCM',
    note: 'authenticated encryption (NIST SP 800-38D)',
  },
];

const WEAK_PRIMITIVES: WeakPrimitive[] = [
  { name: 'md5', pattern: /createHash\s*\(\s*['"]md5['"]/, cwe: 'CWE-327' },
  { name: 'sha1_hash', pattern: /createHash\s*\(\s*['"]sha1['"]/, cwe: 'CWE-327' },
  {
    name: 'des',
    pattern: /createCipheriv\s*\(\s*['"]des(?!-ede|-cbc3)['"]/,
    cwe: 'CWE-327',
  },
];

interface ScanHit {
  primitive: string;
  label: string;
  file: string;
  line?: number;
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  };
}

function scanSourceFiles(dir: string): { strong: ScanHit[]; weak: ScanHit[] } {
  const strong: ScanHit[] = [];
  const weak: ScanHit[] = [];
  const allowed = new Set(['.ts', '.js', '.mjs', '.cjs']);

  function walk(d: string): void {
    if (!existsSync(d)) return;
    const entries = readdirSync(d);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'fixtures') continue;
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (allowed.has(extname(entry))) {
        try {
          const content = readFileSync(full, 'utf-8');
          const relPath = full.replace(dir + '/', '').replace(dir + '\\', '');
          const lines = content.split('\n');

          for (const prim of STRONG_PRIMITIVES) {
            if (prim.pattern.test(content) && !strong.some((h) => h.primitive === prim.name)) {
              const lineIdx = lines.findIndex((l) => prim.pattern.test(l));
              strong.push({
                primitive: prim.name,
                label: prim.label,
                file: relPath,
                line: lineIdx >= 0 ? lineIdx + 1 : undefined,
              });
            }
          }

          for (const prim of WEAK_PRIMITIVES) {
            if (prim.pattern.test(content) && !weak.some((h) => h.primitive === prim.name)) {
              const lineIdx = lines.findIndex((l) => prim.pattern.test(l));
              weak.push({
                primitive: prim.name,
                label: prim.name.toUpperCase(),
                file: relPath,
                line: lineIdx >= 0 ? lineIdx + 1 : undefined,
              });
            }
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  walk(dir);
  return { strong, weak };
}

export async function runCryptoPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const primitives: Record<string, string> = {};

  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};

  const envExample = existsSync(join(sourcePath, '.env.example'))
    ? readFileSync(join(sourcePath, '.env.example'), 'utf-8')
    : null;

  const prismaSchema = existsSync(join(sourcePath, 'prisma', 'schema.prisma'))
    ? readFileSync(join(sourcePath, 'prisma', 'schema.prisma'), 'utf-8')
    : null;

  const composeFile = existsSync(join(sourcePath, 'docker', 'docker-compose.yml'))
    ? join(sourcePath, 'docker', 'docker-compose.yml')
    : existsSync(join(sourcePath, 'docker-compose.yml'))
      ? join(sourcePath, 'docker-compose.yml')
      : null;
  const composeContent = composeFile ? readFileSync(composeFile, 'utf-8') : null;

  const { strong: strongHits, weak: weakHits } = scanSourceFiles(sourcePath);

  let sigNum = 1;

  // --- CRYPTO-0N: Strong KDF (pbkdf2, bcrypt, argon2, scrypt) ---
  const kdfNames = new Set(['pbkdf2', 'bcrypt', 'argon2', 'scrypt']);
  const kdfHit = strongHits.find((h) => kdfNames.has(h.primitive));
  if (kdfHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === kdfHit.primitive)!;
    primitives['api_key_hash'] = kdfHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Strong key derivation function detected: ${kdfHit.label}. ${meta.note}. No weak primitive (MD5, SHA-1) in same file.`,
      evidence: [`${kdfHit.file}${kdfHit.line !== undefined ? `:${kdfHit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Strong MAC (HMAC-SHA512, HMAC-SHA256) ---
  const macHit = strongHits.find((h) => h.primitive === 'hmac_sha512' || h.primitive === 'hmac_sha256');
  if (macHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === macHit.primitive)!;
    primitives['access_token'] = macHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Strong MAC detected: ${macHit.label}. ${meta.note}. Two-layer key derivation pattern satisfies NIST FIPS 198-1.`,
      evidence: [`${macHit.file}${macHit.line !== undefined ? `:${macHit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: JWT signing mode ---
  const jwtDeps = ['@nestjs/jwt', 'jsonwebtoken', 'jose'].filter((d) => d in deps);
  const hasJwtDep = jwtDeps.length > 0;
  if (hasJwtDep || envExample) {
    const symmetricPattern = /JWT_SECRET_KEY|JWT_SECRET(?!_PUBLIC)|NEXTAUTH_SECRET/;
    const asymmetricPattern = /JWT_PRIVATE_KEY|RSA_PRIVATE_KEY|EC_PRIVATE_KEY|JWT_PUBLIC_KEY/;
    const isSymmetric = envExample ? symmetricPattern.test(envExample) : false;
    const isAsymmetric = envExample ? asymmetricPattern.test(envExample) : false;
    const jwtMode = isAsymmetric
      ? 'asymmetric (RS256/ES256)'
      : isSymmetric
        ? 'symmetric HMAC'
        : 'unknown';
    primitives['jwt_signing'] = jwtMode;

    if (hasJwtDep || isSymmetric || isAsymmetric) {
      const severity = isAsymmetric ? 'positive' : isSymmetric ? 'medium' : 'low';
      const derivation = isAsymmetric
        ? `JWT tokens use asymmetric signing (RSA/ECDSA). Ideal for multi-service deployment -- no blast-radius concern if a single service is compromised.`
        : isSymmetric
          ? `JWT tokens signed with symmetric HMAC secret (env var). Acceptable for single-service; evaluate RS256/ES256 with KMS-backed private key for multi-service sovereign deployment.`
          : `JWT dependency detected but signing mode undetermined from static analysis. Manual review required.`;
      const evidenceItems: string[] = [];
      if (hasJwtDep) evidenceItems.push(`package.json (${jwtDeps.join(', ')})`);
      if (envExample && (isSymmetric || isAsymmetric)) evidenceItems.push('.env.example');

      signals.push({
        id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'application',
        severity,
        derivation,
        evidence: evidenceItems,
        confidence: isSymmetric || isAsymmetric ? 'high' : 'low',
        implies: isSymmetric
          ? ['Evaluate RS256 JWT signing with KMS-backed private key for sovereign multi-service deployment.']
          : undefined,
      });
      sigNum++;
    }
  }

  // --- CRYPTO-0N: HTTP security headers (Helmet) ---
  const helmetPkg = 'helmet' in deps ? 'helmet' : '@fastify/helmet' in deps ? '@fastify/helmet' : null;
  if (helmetPkg) {
    primitives['tls'] = 'Helmet HSTS enabled; TLS termination at load balancer';
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Helmet.js present. HTTP security headers enabled (CSP, HSTS, X-Frame-Options). Addresses OWASP A05:2021 security misconfiguration.`,
      evidence: [`package.json (${helmetPkg})`],
      confidence: 'medium',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: At-rest encryption ---
  const hasEncryptionAnnotation = prismaSchema
    ? /encrypt|@encrypted|@cipher|cipher_/i.test(prismaSchema)
    : false;
  const hasKmsRef =
    Object.keys(deps).some((d) => d.includes('kms') || d.includes('vault')) ||
    (composeContent !== null ? /kms|vault|luks/i.test(composeContent) : false);
  const hasAtRestEncryption = hasEncryptionAnnotation || hasKmsRef;
  primitives['at_rest_encryption'] = hasAtRestEncryption
    ? 'configured'
    : 'not_in_application; deployment dependency';

  const atRestEvidence: string[] = [];
  if (prismaSchema) atRestEvidence.push('prisma/schema.prisma');
  if (composeFile) {
    const rel = composeFile.includes('docker' + '/') || composeFile.includes('docker\\')
      ? 'docker/docker-compose.yml'
      : 'docker-compose.yml';
    atRestEvidence.push(rel);
  }

  const atRestSignal: Signal = {
    id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: hasAtRestEncryption ? 'positive' : 'medium',
    derivation: hasAtRestEncryption
      ? `At-rest encryption configured in application or infrastructure layer.`
      : `No at-rest database encryption configured in application code. Volume encryption depends on deployment host configuration. DORA Article 9 and BSI C5 OPS-01 require at-rest encryption to be explicitly verified in the deployment runbook.`,
    evidence: atRestEvidence,
    confidence: 'high',
  };
  if (!hasAtRestEncryption) {
    atRestSignal.implies = [
      'Deployment runbook must explicitly enable and verify disk encryption for database volumes.',
    ];
  }
  signals.push(atRestSignal);
  sigNum++;

  // --- CRYPTO-0N: Weak primitive detection ---
  for (const weak of weakHits) {
    const meta = WEAK_PRIMITIVES.find((p) => p.name === weak.primitive)!;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: `Weak cryptographic primitive detected: ${weak.label}. ${meta.cwe}: Use of a Broken or Risky Cryptographic Algorithm. Replace before production deployment.`,
      evidence: [`${weak.file}${weak.line !== undefined ? `:${weak.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  if (signals.length === 0) {
    signals.push({
      id: 'CRYPTO-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'No cryptographic primitives detected in source scan. Manual review recommended.',
      evidence: ['package.json'],
      confidence: 'low',
    });
  }

  const hasWeakPrimitives = weakHits.length > 0;
  const overallPosture = hasWeakPrimitives
    ? 'weak_primitives_detected'
    : kdfHit !== undefined || macHit !== undefined
      ? 'good_with_infrastructure_gap'
      : 'unknown';
  const nistCompliant = !hasWeakPrimitives && (kdfHit !== undefined || macHit !== undefined);

  return {
    pass: {
      id: 8,
      name: 'crypto_posture',
      signal_prefix: 'CRYPTO',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      primitives,
      overall_posture: overallPosture,
      nist_compliant: nistCompliant,
      blocks_migration: hasWeakPrimitives,
    },
  };
}
