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
import { loadPassCatalog } from './pass-catalog-loader.js';

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
    // #3158: the old pattern `/createCipheriv\s*\([^)]*aes-256-gcm|aes-128-gcm/`
    // bound the alternation wrongly (any "aes-128-gcm" text matched) and the hit
    // was never emitted. Matches a GCM mode string passed to createCipheriv.
    pattern: /createCipheriv\s*\(\s*['"`]aes-(?:128|192|256)-gcm['"`]/i,
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

interface CatalogueHit {
  id: string;
  name: string;
  file: string;
  line?: number;
  cwe: string;
  note?: string;
}

// Scans source files for tokens from a catalogue entry's detection.imports list.
// Returns the first file hit, or null if no hit found.
function scanForCatalogueEntry(
  dir: string,
  importTokens: string[],
): { file: string; line?: number } | null {
  if (!importTokens.length || !existsSync(dir)) return null;
  const pattern = new RegExp(
    importTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  );
  const allowed = new Set(['.ts', '.js', '.mjs', '.cjs', '.java', '.py', '.cs', '.go', '.kt']);

  let result: { file: string; line?: number } | null = null;
  function walk(d: string): void {
    if (result) return;
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      if (result) return;
      if (entry === 'node_modules' || entry === 'dist' || entry === 'fixtures') continue;
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (allowed.has(extname(entry))) {
        try {
          const content = readFileSync(full, 'utf-8');
          if (pattern.test(content)) {
            const relPath = full.replace(dir + '/', '').replace(dir + '\\', '');
            const lineIdx = content.split('\n').findIndex((l) => pattern.test(l));
            result = { file: relPath, line: lineIdx >= 0 ? lineIdx + 1 : undefined };
          }
        } catch { /* skip */ }
      }
    }
  }
  walk(dir);
  return result;
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

  // #3063: supplement hardcoded primitives with catalogue-based detection (ADR-0063).
  const catalogueWeakHits: CatalogueHit[] = [];
  const catalogueStrongHits: CatalogueHit[] = [];
  const catalogue = loadPassCatalog(ctx.workspacePath, 'pass-08-crypto-algorithms.yaml');
  if (catalogue) {
    const hardcodedWeakIds = new Set(WEAK_PRIMITIVES.map((p) => p.name));
    const hardcodedStrongIds = new Set(STRONG_PRIMITIVES.map((p) => p.name));
    for (const entry of catalogue.entries) {
      if (hardcodedWeakIds.has(String(entry.id)) || hardcodedStrongIds.has(String(entry.id))) continue;
      const posture = entry.posture as { severity?: string; note?: string } | undefined;
      const detection = entry.detection as { imports?: string[] } | undefined;
      const importTokens = detection?.imports ?? [];
      if (!importTokens.length) continue;
      const severity = posture?.severity;
      const isWeak = severity === 'weak' || severity === 'deprecated';
      const isStrong = severity === 'approved' || severity === 'approved_preferred';
      if (!isWeak && !isStrong) continue;
      const hit = scanForCatalogueEntry(sourcePath, importTokens);
      if (hit) {
        const catalogueHit: CatalogueHit = {
          id: String(entry.id),
          name: String(entry.name),
          file: hit.file,
          line: hit.line,
          cwe: 'CWE-327',
          note: posture?.note,
        };
        if (isWeak) catalogueWeakHits.push(catalogueHit);
        else catalogueStrongHits.push(catalogueHit);
      }
    }
  }

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

  // --- CRYPTO-0N: Authenticated encryption (AES-GCM) (#3158: detected but never emitted) ---
  const aeadHit = strongHits.find((h) => h.primitive === 'aes_gcm');
  if (aeadHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === aeadHit.primitive)!;
    primitives['symmetric_encryption'] = aeadHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Authenticated symmetric encryption detected: ${aeadHit.label}, ${meta.note}.`,
      evidence: [`${aeadHit.file}${aeadHit.line !== undefined ? `:${aeadHit.line}` : ''}`],
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

  // --- CRYPTO-0N: no primitive detected (#3158) ---
  // The fallback used to sit after the at-rest signal, which is always
  // emitted, so `signals.length === 0` never held and it could not fire. It
  // now fires when the source scan found no primitive and no crypto-relevant
  // dependency, and takes the next ID in the sequence (no fixed CRYPTO-01).
  if (strongHits.length === 0 && weakHits.length === 0 && signals.length === 0) {
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'No cryptographic primitives detected in source scan. Manual review recommended.',
      evidence: pkg ? ['package.json'] : [],
      confidence: 'low',
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

  // --- CRYPTO-0N: Weak primitive detection (hardcoded patterns) ---
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

  // --- CRYPTO-0N: Weak primitive detection (catalogue-extended) ---
  for (const hit of catalogueWeakHits) {
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: `Weak/deprecated cryptographic primitive detected: ${hit.name}. ${hit.cwe}: Use of a Broken or Risky Cryptographic Algorithm.${hit.note ? ` ${hit.note}` : ''} Replace before production deployment.`,
      evidence: [`${hit.file}${hit.line !== undefined ? `:${hit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  const hasWeakPrimitives = weakHits.length > 0 || catalogueWeakHits.length > 0;
  const overallPosture = hasWeakPrimitives
    ? 'weak_primitives_detected'
    : kdfHit !== undefined || macHit !== undefined || aeadHit !== undefined
      ? 'good_with_infrastructure_gap'
      : 'unknown';
  const nistCompliant = !hasWeakPrimitives && (kdfHit !== undefined || macHit !== undefined || aeadHit !== undefined);

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
