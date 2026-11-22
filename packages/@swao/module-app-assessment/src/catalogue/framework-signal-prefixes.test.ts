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

// #3963: every `evidence_basis: - signal_prefix: <P>` of a bundled framework
// catalogue names a prefix some pass emits. A binding to a prefix no pass
// emits (OBS, found in #3962) documents an evidence source that never exists.
// Checked over the package frameworks and the standalone download copy
// (swao/community-frameworks/, mirrored byte for byte, community-frameworks
// test A9), plus the demo frameworks build-lib.mjs stages from
// docs/custom-frameworks/ into the binary (private checkout only).

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { passContributions } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOTS: Array<{ dir: string; only?: readonly string[] }> = [
  { dir: join(here, '..', '..', '..', 'community-frameworks', 'frameworks') },
  { dir: join(here, '..', '..', '..', '..', '..', 'community-frameworks') },
  // build-lib.mjs DEMO_FW_FOLDERS: the other docs/custom-frameworks folders are authoring drafts, not shipped.
  { dir: join(here, '..', '..', '..', '..', '..', '..', 'docs', 'custom-frameworks'), only: ['gdpr-demo', 'ai-10-pillars-demo', 'nist-hipaa-demo'] },
];

/**
 * Prefixes emitted outside passContributions (documented external emitters):
 *   IAM  Pass 21, opt-in (pass-21-iam.ts, orchestrator.ts OPT_IN_PASSES)
 *   COMP Pass 11 in @swao/module-framework (compliance-evaluator.ts)
 *   LZ   the landing-zone pass of the CLI (packages/swao assess.ts)
 */
const EXTERNAL_PREFIXES: readonly string[] = ['IAM', 'COMP', 'LZ'];

function emittedPrefixes(): Set<string> {
  return new Set([...passContributions.map((p) => p.signal_prefix), ...EXTERNAL_PREFIXES]);
}

/** `framework/control -> prefix` for every signal_prefix binding no pass emits. */
function unemittedBindings(frameworksDir: string, emitted: ReadonlySet<string>, only?: readonly string[]): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('_') || dir.name.startsWith('.')) continue;
    if (only && !only.includes(dir.name)) continue;
    const file = join(frameworksDir, dir.name, 'controls.yaml');
    if (!existsSync(file)) continue;
    const doc = load(readFileSync(file, 'utf-8')) as { controls?: Array<{ id?: unknown; evidence_basis?: unknown }> } | null;
    for (const c of doc?.controls ?? []) {
      if (!Array.isArray(c.evidence_basis)) continue;
      for (const e of c.evidence_basis as unknown[]) {
        const p = e !== null && typeof e === 'object' ? (e as Record<string, unknown>)['signal_prefix'] : undefined;
        if (typeof p === 'string' && !emitted.has(p)) out.push(`${dir.name}/${String(c.id)} -> ${p}`);
      }
    }
  }
  return out.sort();
}

describe('#3963: catalogue evidence_basis signal_prefix bindings name an emitting pass', () => {
  it('the emitted set holds the pass prefixes the catalogues use', () => {
    const emitted = emittedPrefixes();
    for (const p of ['TF', 'STATE', 'CTX', 'QUAL', 'IAM', 'INV', 'LZR']) expect(emitted.has(p), p).toBe(true);
    expect(emitted.has('OBS')).toBe(false);
  });

  for (const root of ROOTS) {
    it.skipIf(!existsSync(root.dir))(`no binding to a prefix no pass emits in ${root.dir.split(/[\\/]/).slice(-2).join('/')}`, () => {
      expect(unemittedBindings(root.dir, emittedPrefixes(), root.only)).toEqual([]);
    });
  }
});
