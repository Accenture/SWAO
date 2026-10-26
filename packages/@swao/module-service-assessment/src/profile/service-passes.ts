// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Service-mode runners for Pass 03 DATA and Pass 08 CRYPTO (Design 103 §5.1,
 * §5.2, #3095, #3096).
 *
 * The application passes scan source trees and, given config files or ERDs,
 * report "no source files" or source-only absence findings. Per Design 103
 * §2.3 service behaviour is new code, not a conditional inside the existing
 * pass: `swao assess` uses these runners for service apps. They emit the same
 * pass header (id, name, signal prefix) and PassFile shape.
 *
 * Evidence strings cite file and line only; matched values (passwords,
 * tokens) are never copied into a signal.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load } from 'js-yaml';
import { listInputFiles, type PassContext, type PassResult, type Signal } from '@swao/core';

const TEXT_CONFIG = /\.(ini|xml|conf|cfg|config|json|env|properties|ya?ml|toml|txt|reg)$/i;
const TEXT_DOC = /\.(md|txt|csv|sql|xml|json|ya?ml|html?)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** SWAO-generated or configuration folders under wsp/inputs/ that are never service evidence (#3212). */
const GENERATED_INPUT_DIRS = new Set(['research', 'binary', 'catalogs', 'llm-gateway', 'yara-rules', 'service-intake', 'cache']);

// #3428: input-folder walk through the central source scope's sibling walker.
function listFiles(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return listInputFiles(dir, { skipDirNames: GENERATED_INPUT_DIRS })
    .filter((f) => re.test(f.name) && f.sizeBytes <= MAX_FILE_BYTES)
    .map((f) => f.abs)
    .sort();
}

function signal(id: string, fields: Partial<Signal> & Pick<Signal, 'derivation' | 'evidence' | 'severity' | 'outcome'>): Signal {
  return { id, source: 'static_analysis', category: 'application', confidence: 'high', assessor: 'rule_engine', ...fields } as Signal;
}

// ---------------------------------------------------------------- CRYPTO

interface CryptoRule { key: string; re: RegExp; severity: 'high' | 'medium'; label: string }

const CRYPTO_RULES: readonly CryptoRule[] = [
  { key: 'weak_algorithm', re: /\b(md5|sha-?1|rc4|arcfour|3des|tripledes|des(?:-cbc|-ede)?|ecb)\b/i, severity: 'high', label: 'weak or deprecated cryptographic algorithm' },
  { key: 'cleartext_endpoint', re: /\b(http|ldap|ftp|telnet):\/\/(?!localhost|127\.0\.0\.1)[^\s"'<>]+/i, severity: 'medium', label: 'unencrypted network endpoint' },
  { key: 'hardcoded_secret', re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\b\s*[=:]\s*["']?(?!\s*$|\$\{|%|<|\*{3,}|changeit_placeholder)[^\s"'#;]{3,}/i, severity: 'high', label: 'hard-coded credential' },
];

interface CryptoHit { rule: string; file: string; line: number }

export function scanConfigFiles(dir: string, root: string): CryptoHit[] {
  const hits: CryptoHit[] = [];
  for (const file of listFiles(dir, TEXT_CONFIG)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    readFileSync(file, 'utf-8').split(/\r?\n/).forEach((text, i) => {
      for (const r of CRYPTO_RULES) if (r.re.test(text)) hits.push({ rule: r.key, file: rel, line: i + 1 });
    });
  }
  return hits;
}

interface CertInfo { subject?: string; not_after?: string; timestamped?: boolean }

function expiredCertificates(appDir: string, now: Date): Array<{ subject: string; not_after: string }> {
  const p = join(appDir, 'wsp', 'inputs', 'binary', 'binary-analysis.json');
  if (!existsSync(p)) return [];
  try {
    const doc = JSON.parse(readFileSync(p, 'utf-8')) as { files?: Array<{ certificates?: CertInfo[] }> };
    return (doc.files ?? []).flatMap((f) => f.certificates ?? [])
      // A timestamped signature stays valid after the signer certificate expires; only untimed ones count.
      .filter((c): c is Required<CertInfo> => typeof c.not_after === 'string' && Date.parse(c.not_after) < now.getTime() && c.timestamped !== true)
      .map((c) => ({ subject: c.subject ?? 'unknown subject', not_after: c.not_after }));
  } catch {
    return [];
  }
}

export async function runServiceCryptoPass(ctx: PassContext): Promise<PassResult> {
  const appDir = ctx.workspacePath;
  const hits = scanConfigFiles(ctx.sourcePath, appDir);
  const certs = expiredCertificates(appDir, new Date(`${ctx.assessedAt}T00:00:00Z`));
  const signals: Signal[] = [];
  let n = 1;
  for (const rule of CRYPTO_RULES) {
    const ruleHits = hits.filter((h) => h.rule === rule.key);
    if (ruleHits.length === 0) continue;
    signals.push(signal(`CRYPTO-${String(n++).padStart(2, '0')}`, {
      severity: rule.severity,
      outcome: 'negative',
      derivation: `Service config scan found ${ruleHits.length} ${rule.label} reference(s) in supplied configuration files (Design 103 §5.2; CRYPTO.${rule.key.toUpperCase()}).`,
      evidence: ruleHits.slice(0, 20).map((h) => `${h.file}:${h.line}`),
    }));
  }
  if (certs.length > 0) {
    signals.push(signal(`CRYPTO-${String(n++).padStart(2, '0')}`, {
      severity: 'high',
      outcome: 'negative',
      derivation: `Pass 25 binary analysis recorded ${certs.length} expired code-signing certificate(s) without a timestamp (CRYPTO.EXPIRED_CERT).`,
      evidence: certs.slice(0, 20).map((c) => `wsp/inputs/binary/binary-analysis.json: ${c.subject} expired ${c.not_after.slice(0, 10)}`),
    }));
  }
  if (signals.length === 0) {
    signals.push(signal('CRYPTO-01', {
      severity: 'informational',
      outcome: 'indeterminate',
      confidence: 'medium',
      derivation: 'No weak algorithm, cleartext endpoint, or hard-coded credential found in the supplied configuration files; absence in a partial sample is not proof of a sound posture.',
      evidence: [relative(appDir, ctx.sourcePath).replace(/\\/g, '/') || '.'],
    }));
  }
  return {
    pass: { id: 8, name: 'crypto_posture', signal_prefix: 'CRYPTO', status: 'complete', iter: ctx.iter, assessed_at: ctx.assessedAt },
    signals,
    assessment: {
      mode: 'service',
      files_scanned: listFiles(ctx.sourcePath, TEXT_CONFIG).length,
      findings: Object.fromEntries(CRYPTO_RULES.map((r) => [r.key, hits.filter((h) => h.rule === r.key).length])),
      expired_certificates: certs.length,
      blocks_migration: hits.some((h) => h.rule === 'weak_algorithm') || certs.length > 0,
    },
  };
}

// ---------------------------------------------------------------- DATA

const PERSONAL_FIELD = /\b(patient|name|vorname|nachname|birth|geburt|address|adresse|phone|telefon|email|insurance|versicher|ssn|social[_ ]security|diagnos|befund|icd|medication|medikament)\w*/i;
const HEALTH_FIELD = /\b(patient|diagnos|befund|icd|medication|medikament|dicom|study|modality|lab[_ ]?result|vital)\w*/i;

interface AppDataBlock {
  health_data?: boolean | null;
  pii?: boolean | null;
  gdpr_art9?: boolean | null;
  categories?: string[] | null;
  classification?: string | null;
}

function readDataBlock(appDir: string): AppDataBlock {
  try {
    const doc = load(readFileSync(join(appDir, '.swao.yml'), 'utf-8')) as { data?: AppDataBlock } | null;
    return doc?.data ?? {};
  } catch {
    return {};
  }
}

/** True when the app `.swao.yml` declares any data classification field (Design 103 §5.1). */
export function hasDeclaredDataFields(appDir: string): boolean {
  const d = readDataBlock(appDir);
  return [d.health_data, d.pii, d.gdpr_art9, d.classification].some((v) => v !== null && v !== undefined) || (d.categories?.length ?? 0) > 0;
}

export async function runServiceDataPass(ctx: PassContext): Promise<PassResult> {
  const appDir = ctx.workspacePath;
  const data = readDataBlock(appDir);
  const docs = existsSync(ctx.sourcePath) && relative(join(appDir, 'wsp', 'service-no-source'), ctx.sourcePath) !== '' ? listFiles(ctx.sourcePath, TEXT_DOC) : [];
  const personal: string[] = [];
  const health: string[] = [];
  for (const file of docs) {
    const rel = relative(appDir, file).replace(/\\/g, '/');
    readFileSync(file, 'utf-8').split(/\r?\n/).forEach((text, i) => {
      if (PERSONAL_FIELD.test(text)) personal.push(`${rel}:${i + 1}`);
      if (HEALTH_FIELD.test(text)) health.push(`${rel}:${i + 1}`);
    });
  }
  const signals: Signal[] = [];
  let n = 1;
  const id = () => `DATA-${String(n++).padStart(2, '0')}`;
  const declaredHealth = data.health_data === true || data.gdpr_art9 === true;
  if (declaredHealth || health.length > 0) {
    signals.push(signal(id(), {
      severity: 'high',
      outcome: 'negative',
      derivation: 'App processes special-category health data (GDPR Art. 9); stricter controls under GDPR, SGB V, and the data processing agreement apply (Design 103 §5.1).',
      evidence: [...(declaredHealth ? ['.swao.yml data.health_data / data.gdpr_art9'] : []), ...health.slice(0, 15)],
    }));
  }
  if (data.pii === true || personal.length > 0) {
    signals.push(signal(id(), {
      severity: 'medium',
      outcome: 'negative',
      derivation: 'App handles personal data fields; data subject rights, retention, and residency obligations apply to its migration.',
      evidence: [...(data.pii === true ? ['.swao.yml data.pii'] : []), ...personal.slice(0, 15)],
    }));
  }
  if (signals.length === 0) {
    signals.push(signal(id(), {
      severity: 'informational',
      outcome: 'indeterminate',
      confidence: 'medium',
      derivation: 'Neither the intake data fields nor the supplied data-flow documents indicate personal or health data; confirm with the business owner.',
      evidence: ['.swao.yml data'],
    }));
  }
  return {
    pass: { id: 3, name: 'data_classification', signal_prefix: 'DATA', status: 'complete', iter: ctx.iter, assessed_at: ctx.assessedAt },
    signals,
    assessment: {
      mode: 'service',
      declared: { health_data: data.health_data ?? null, pii: data.pii ?? null, gdpr_art9: data.gdpr_art9 ?? null, classification: data.classification ?? null },
      data_flow_documents: docs.length,
      personal_field_references: personal.length,
      health_field_references: health.length,
    },
  };
}
