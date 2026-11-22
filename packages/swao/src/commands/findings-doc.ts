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

// #2674: findings.yaml of an application or service run, flattened from the
// compliance controls of wsp-plan.yaml.
//
// #4286: a run that evaluated no compliance framework no longer writes a
// silent `findings: []`; the document carries `reason`, taken from Pass 11
// (`passes/11-comp.yaml`: skipped_reason, or the signals that say why a listed
// framework was not evaluated).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

export interface FindingsRegime { id?: string; controls?: Array<Record<string, unknown>> }

export interface FindingsDoc {
  findings: Array<Record<string, unknown>>;
  reason?: string;
}

/** Why Pass 11 evaluated nothing, from its pass file; null when it cannot tell. */
export function complianceSkipReason(runDir: string): string | null {
  const p = join(runDir, 'passes', '11-comp.yaml');
  if (!existsSync(p)) return 'Pass 11 (compliance evaluation) did not run in this assessment';
  try {
    const doc = load(readFileSync(p, 'utf-8')) as { assessment?: Record<string, unknown>; signals?: Array<{ derivation?: unknown }> } | null;
    const skipped = doc?.assessment?.['skipped_reason'];
    if (typeof skipped === 'string' && skipped.trim()) return skipped.trim();
    const why = (doc?.signals ?? [])
      .map((s) => (typeof s.derivation === 'string' ? s.derivation : ''))
      .filter((d) => /no framework with this id|no catalog found/i.test(d));
    if (why.length > 0) return why.join(' ');
  } catch { /* unreadable pass file */ }
  return null;
}

export function buildFindingsDoc(regimes: readonly FindingsRegime[], assessedAt: string, runDir: string): FindingsDoc {
  const findings = regimes.flatMap((regime) =>
    (regime.controls ?? []).map((ctrl) => ({
      id: ctrl['id'],
      title: ctrl['title'] ?? '',
      severity: ctrl['severity'] ?? 'medium',
      outcome: ctrl['outcome'] ?? 'UNKNOWN',
      regime: regime.id ?? '',
      assessed_at: String(ctrl['assessed_at'] ?? assessedAt),
    })),
  );
  if (regimes.length > 0) return { findings };
  const why = complianceSkipReason(runDir);
  return { findings, reason: `No compliance framework was evaluated in this run, so there are no compliance findings${why ? `: ${why}` : '.'}` };
}
