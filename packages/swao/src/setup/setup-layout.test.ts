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

// #4190 (Design 125 section 9): no spaced "--" in the text of the setup
// screens: the wizard steps (tui/screens/wizard/steps), the engine screens and
// every branch module (setup/, setup/branches/). Comments, log messages and
// written file headers are not screen text and are skipped.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const roots = [here, join(here, '..', 'tui', 'screens', 'wizard', 'steps')];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Lines of `text` that carry a spaced "--" in screen text. Exported for the self-test. */
export function dashOffenders(text: string): number[] {
  const hits: number[] = [];
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
    if (/logPortfolio\(|writeFileSync\(/.test(line)) return;
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/\s.*$/, '');
    if (/\s--\s/.test(code)) hits.push(i + 1);
  });
  return hits;
}

describe('setup screens: no spaced "--" in screen text (#4190, Design 125 section 9)', () => {
  it('the scan flags screen text and skips comments, logs and file headers', () => {
    expect(dashOffenders("affordances={['Enter -- confirm']}")).toEqual([1]);
    expect(dashOffenders('<Text>Step 1 -- Init</Text>')).toEqual([1]);
    expect(dashOffenders('// Enter -- confirm\n  /* a -- b */\nlogPortfolio(\'info\', \'x\', \'a -- b\');')).toEqual([]);
    expect(dashOffenders("<Text>aws sso login --profile</Text>")).toEqual([]);
  });

  it('no setup source has one', () => {
    const offenders: string[] = [];
    for (const root of roots) for (const f of sources(root)) {
      for (const line of dashOffenders(readFileSync(f, 'utf-8'))) offenders.push(`${relative(here, f)}:${line}`);
    }
    expect(offenders).toEqual([]);
  });

  it('scans the wizard steps and the branch modules (guards against a wrong root)', () => {
    const all = roots.flatMap(sources).map((f) => f.replace(/\\/g, '/'));
    expect(all.some((f) => f.endsWith('wizard/steps/CredentialsStep.tsx'))).toBe(true);
    expect(all.some((f) => f.endsWith('setup/branches/application.tsx'))).toBe(true);
  });
});
