// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Service Portfolio Assessment artefacts for `swao support-bundle`
// (Design 103 §19.5, #3135, #3136). Collected only when the workspace
// `.swao.yml` has a `service_portfolio:` block, so application bundles are
// unchanged. Added under `service/` in the bundle:
//
//   service/scaffold-signals.json              wsp/signals/scaffold-signals.json
//   service/portfolio-summary.json             wsp/portfolio-summary.json
//   service/column-map.yaml                    service_portfolio.mapping (if set)
//   service/infra-cat/<file>.yaml              Tier 2 INFRA-CAT extensions
//   service/apps/<id>/research/<topic>.md      research stub front-matter only (body excluded)
//   service/apps/<id>/research/confidence.json
//   service/apps/<id>/binary/binary-analysis.json, manifest.json
//   redaction-log.txt                          second-pass redactions: file + field, never the value
//
// Second-pass PII redaction (safety net behind the G-06 intake scrub): e-mail
// addresses -> [REDACTED-EMAIL], phone numbers -> [REDACTED-PHONE], and
// personal names in person-valued fields (reviewed_by, contact, owner, ...)
// -> [REDACTED-NAME]. The core redactor then removes secrets and user paths.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { redactPhoneNumbers, redactPiiValue, type RedactionCounts } from '@swao/core';
import { looksLikePersonalName, readStub, tier2Dir } from '@swao/module-service-assessment';

export interface ServiceRedaction { file: string; field: string; kind: 'email' | 'phone' | 'name' }

export interface ServiceBundleArtefacts {
  entries: Array<{ name: string; content: Buffer }>;
  redactions: ServiceRedaction[];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_TEST = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PERSON_KEY_RE = /(^|_)(reviewed_by|contact|contact_name|owner|person|assignee|author|analyst)$/i;

type Rec = Record<string, unknown>;

function readYaml(p: string): unknown {
  try { return load(readFileSync(p, 'utf-8')); } catch { return undefined; }
}
function readJson(p: string): unknown {
  try { return JSON.parse(readFileSync(p, 'utf-8')) as unknown; } catch { return undefined; }
}

export function isServiceWorkspace(workspaceRoot: string): boolean {
  const doc = readYaml(join(workspaceRoot, '.swao.yml')) as Rec | null | undefined;
  return !!doc && typeof doc === 'object' && !!doc['service_portfolio'];
}

/** Walk a parsed value, redacting PII strings in place of a copy; every hit is logged by field path. */
export function redactServiceValue(value: unknown, file: string, log: ServiceRedaction[], path = ''): unknown {
  if (typeof value === 'string') {
    const key = path.split(/[.[\]]/).filter(Boolean).at(-1) ?? '';
    if (PERSON_KEY_RE.test(key) && looksLikePersonalName(value)) {
      log.push({ file, field: path, kind: 'name' });
      return '[REDACTED-NAME]';
    }
    let s = value;
    if (EMAIL_TEST.test(s)) {
      s = s.replace(EMAIL_RE, '[REDACTED-EMAIL]');
      log.push({ file, field: path, kind: 'email' });
    }
    const phone = redactPhoneNumbers(s);
    if (phone.count > 0) {
      s = phone.text;
      log.push({ file, field: path, kind: 'phone' });
    }
    return s;
  }
  if (Array.isArray(value)) return value.map((v, i) => redactServiceValue(v, file, log, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    const out: Rec = {};
    for (const [k, v] of Object.entries(value as Rec)) out[k] = redactServiceValue(v, file, log, path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}

export function renderRedactionLog(redactions: readonly ServiceRedaction[]): string {
  const lines = [
    '# SWAO support bundle: second-pass PII redaction log (Design 103 §19.5)',
    '# file<TAB>field<TAB>kind. Original values are never written.',
  ];
  if (redactions.length === 0) lines.push('# No redactions applied.');
  for (const r of redactions) lines.push(`${r.file}\t${r.field || '(value)'}\t${r.kind}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Collect the service artefacts for a service workspace; returns null for any
 * other workspace. `postProcess` applies the bundle's absolute-path redaction.
 */
export function collectServiceArtefacts(
  workspaceRoot: string,
  counts: RedactionCounts,
  postProcess: (v: unknown) => unknown,
): ServiceBundleArtefacts | null {
  if (!isServiceWorkspace(workspaceRoot)) return null;
  const entries: ServiceBundleArtefacts['entries'] = [];
  const redactions: ServiceRedaction[] = [];
  const clean = (name: string, v: unknown) => postProcess(redactPiiValue(redactServiceValue(v, name, redactions), counts));
  const addJson = (name: string, v: unknown) => {
    if (v === undefined) return;
    entries.push({ name, content: Buffer.from(`${JSON.stringify(clean(name, v), null, 2)}\n`, 'utf-8') });
  };
  const addYaml = (name: string, v: unknown, frontMatter = false) => {
    if (v === undefined || v === null) return;
    const text = dump(clean(name, v), { lineWidth: 120 });
    entries.push({ name, content: Buffer.from(frontMatter ? `---\n${text}---\n` : text, 'utf-8') });
  };

  addJson('service/scaffold-signals.json', readJson(join(workspaceRoot, 'wsp', 'signals', 'scaffold-signals.json')));
  addJson('service/portfolio-summary.json', readJson(join(workspaceRoot, 'wsp', 'portfolio-summary.json')));

  const ws = readYaml(join(workspaceRoot, '.swao.yml')) as Rec;
  const mapping = (ws['service_portfolio'] as Rec | undefined)?.['mapping'];
  if (typeof mapping === 'string' && !/^([a-zA-Z]:)?[\\/]/.test(mapping) && !mapping.includes('..')) {
    addYaml('service/column-map.yaml', readYaml(join(workspaceRoot, mapping)));
  }

  const t2 = tier2Dir(workspaceRoot);
  if (existsSync(t2)) {
    for (const f of readdirSync(t2).filter((n) => /\.ya?ml$/i.test(n)).sort()) addYaml(`service/infra-cat/${f}`, readYaml(join(t2, f)));
  }

  const appsDir = join(workspaceRoot, 'apps');
  const appIds = existsSync(appsDir) ? readdirSync(appsDir).filter((id) => {
    try { return statSync(join(appsDir, id)).isDirectory(); } catch { return false; }
  }).sort() : [];
  for (const id of appIds) {
    const app = readYaml(join(appsDir, id, '.swao.yml')) as Rec | null | undefined;
    if ((app?.['assessment'] as Rec | undefined)?.['type'] !== 'service') continue;
    const research = join(appsDir, id, 'wsp', 'inputs', 'research');
    if (existsSync(research)) {
      for (const f of readdirSync(research).filter((n) => n.endsWith('.md')).sort()) {
        const stub = readStub(join(research, f));
        if (stub) addYaml(`service/apps/${id}/research/${f}`, stub.front, true);
      }
      addJson(`service/apps/${id}/research/confidence.json`, readJson(join(research, 'confidence.json')));
    }
    const binary = join(appsDir, id, 'wsp', 'inputs', 'binary');
    addJson(`service/apps/${id}/binary/binary-analysis.json`, readJson(join(binary, 'binary-analysis.json')));
    addJson(`service/apps/${id}/binary/manifest.json`, readJson(join(binary, 'manifest.json')));
  }

  entries.push({ name: 'redaction-log.txt', content: Buffer.from(renderRedactionLog(redactions), 'utf-8') });
  return { entries, redactions };
}
