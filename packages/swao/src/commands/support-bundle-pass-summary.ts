// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Support bundle: LLM pass summary (pass-inventory.json pass_summary)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { inferOutcomeFromSeverity, tallyComplianceRag, normaliseComplianceOutcome, type Signal } from '@swao/core';

/**
 * #3441: `pass_summary` for the LLM passes (03-data, 04-ctx, 11-comp) in the
 * support bundle's pass-inventory.json.
 *
 * Root cause of `signals_by_status: { unknown: N }`: the summary keyed on
 * `signal.status`, a field the WSP Signal schema does not have. A signal's
 * defined classification is `outcome` (positive / negative / neutral /
 * indeterminate; assess.ts enrichSignals defaults it from severity), so the
 * buckets are now outcomes: a legacy `status` string is used only when
 * `outcome` is absent, then the severity default. "unknown" no longer occurs.
 *
 * For Pass 11 the verdicts live on the controls, not on the COMP roll-up
 * signals, so the summary also carries `controls_by_status` (the shared
 * @swao/core classifier, same buckets as the publication and the hub),
 * `regimes_by_status` (regime-level status, e.g. evaluated / out_of_scope /
 * degraded) and the first GAP / PARTIAL control ids in `top_gaps`.
 */
export function summariseLlmPassForBundle(passData: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const signals = Array.isArray(passData['signals']) ? (passData['signals'] as Array<Record<string, unknown>>) : [];
  const byStatus: Record<string, number> = {};
  const regimes = new Set<string>();
  const topGaps: string[] = [];
  for (const sig of signals) {
    const key = signalOutcomeKey(sig);
    byStatus[key] = (byStatus[key] ?? 0) + 1;
    const fw = typeof sig['framework_id'] === 'string' ? sig['framework_id']
      : (typeof sig['regime'] === 'string' ? sig['regime'] : null);
    if (fw) regimes.add(fw);
    if (key === 'negative' && typeof sig['id'] === 'string' && topGaps.length < 5) topGaps.push(sig['id']);
  }
  const summary: Record<string, unknown> = { signals_by_status: byStatus };

  const assessment = passData['assessment'];
  const regimeList = assessment !== null && typeof assessment === 'object' && Array.isArray((assessment as Record<string, unknown>)['regimes'])
    ? ((assessment as Record<string, unknown>)['regimes'] as Array<Record<string, unknown>>)
    : [];
  if (regimeList.length > 0) {
    const statuses: Array<string | null> = [];
    const regimesByStatus: Record<string, number> = {};
    const controlGaps: string[] = [];
    for (const r of regimeList) {
      const rid = typeof r?.['id'] === 'string' ? r['id'] : null;
      if (rid) regimes.add(rid);
      const rs = typeof r?.['status'] === 'string' ? r['status'] : 'unknown';
      regimesByStatus[rs] = (regimesByStatus[rs] ?? 0) + 1;
      for (const c of Array.isArray(r?.['controls']) ? (r['controls'] as Array<Record<string, unknown>>) : []) {
        const s = typeof c?.['status'] === 'string' ? c['status'] : (typeof c?.['outcome'] === 'string' ? c['outcome'] : null);
        statuses.push(s);
        const o = normaliseComplianceOutcome(s);
        if ((o === 'GAP' || o === 'PARTIAL') && typeof c?.['id'] === 'string' && controlGaps.length < 5) {
          controlGaps.push(rid ? `${rid}/${c['id']}` : c['id']);
        }
      }
    }
    summary['controls_by_status'] = tallyComplianceRag(statuses);
    summary['regimes_by_status'] = regimesByStatus;
    // Pass 11: the control verdicts are the gaps, not the COMP roll-up signals.
    topGaps.length = 0;
    topGaps.push(...controlGaps);
  }
  if (regimes.size > 0) summary['regimes_evaluated'] = [...regimes].sort();
  if (topGaps.length > 0) summary['top_gaps'] = topGaps;
  return summary;
}

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low', 'informational', 'positive']);

/** Outcome bucket of one persisted signal: outcome, else legacy status, else the severity default. */
function signalOutcomeKey(sig: Readonly<Record<string, unknown>>): string {
  if (typeof sig['outcome'] === 'string' && sig['outcome'] !== '') return sig['outcome'];
  if (typeof sig['status'] === 'string' && sig['status'] !== '') return sig['status'];
  const sev = typeof sig['severity'] === 'string' && SEVERITIES.has(sig['severity'])
    ? (sig['severity'] as NonNullable<Signal['severity']>)
    : undefined;
  return inferOutcomeFromSeverity(sev);
}
