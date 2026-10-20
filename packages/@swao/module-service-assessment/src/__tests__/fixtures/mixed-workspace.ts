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
 * Mixed workspace for the combined portfolio view (#3280, Design 103 §22),
 * synthetic data only: one application app (`sovereign-health`, the permitted
 * demo subject) with a complete application run, and two service apps (one
 * with a service run, one with intake and research only). A landing zone app
 * is added as a distractor: it must not appear in the portfolio.
 *
 * Application run (apps/sovereign-health/wsp/runs/2026-10-11T17-35-32/):
 * wsp.yaml (7R Replatform, portability 0.2), run-manifest.json, wsp-plan.yaml
 * (three GDPR controls, all GAP), passes 05-sbom (dependency CVE lookup
 * completed, 2 packages with high or critical CVEs, Node maintenance LTS) and
 * 08-crypto (one negative critical finding); wsp/latest-lz-primary.yaml with
 * verdict BLOCKED. Expected application domain scores: APM-TCH 40 (70, 10),
 * APM-SEC 10, APM-REG 0, APM-MIG 10 (20, 0); health 20 with the bundled
 * weights (TCH 20, SEC 18, REG 8, MIG 6), risk 80.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';

export const MIXED_APP = 'sovereign-health';
export const MIXED_APP_RUN = '2026-10-11T17-35-32';
export const MIXED_SVC_ASSESSED = 'hosapp100';
export const MIXED_SVC_UNASSESSED = 'hosapp200';
export const MIXED_LZ_APP = 'lz-only';

export interface MixedWorkspaceOptions {
  /** Leave out the application app (service-only baseline). */
  serviceOnly?: boolean;
}

export function makeMixedWorkspace(opts: MixedWorkspaceOptions = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-3280-mixed-'));
  writeFileSync(join(ws, '.swao.yml'), dump({ wsp_version: '0.9', service_portfolio: { source: 'intake.xlsx' } }));

  const service = (id: string, cfg: Record<string, unknown>, run: boolean) => {
    const research = join(ws, 'apps', id, 'wsp', 'inputs', 'research');
    mkdirSync(research, { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), dump({
      app_id: id, app_name: id.toUpperCase(), assessment: { type: 'service' }, disposition: { operational_status: 'active' }, integrations: [], ...cfg,
    }));
    writeFileSync(join(research, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', is_eol: false, months_until_eol: 60, date: '2031-10-14' } })}---\n`);
    writeFileSync(join(research, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', count: 0, critical_count: 0, high_count: 0, kev_match: false, top: [] } })}---\n`);
    if (run) {
      mkdirSync(join(ws, 'apps', id, 'wsp', 'runs', '20261017-080000'), { recursive: true });
      writeFileSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'), 'runs/20261017-080000');
    }
  };
  service(MIXED_SVC_ASSESSED, {}, true);
  // The unassessed service app depends on the application app (integration across types).
  service(MIXED_SVC_UNASSESSED, { integrations: opts.serviceOnly ? [MIXED_SVC_ASSESSED] : [MIXED_SVC_ASSESSED, MIXED_APP] }, false);

  // Landing zone app: never part of the portfolio.
  mkdirSync(join(ws, 'apps', MIXED_LZ_APP), { recursive: true });
  writeFileSync(join(ws, 'apps', MIXED_LZ_APP, '.swao.yml'), dump({ app_id: MIXED_LZ_APP, assessment: { type: 'landing-zone-catalog' } }));

  if (opts.serviceOnly) return ws;

  const appDir = join(ws, 'apps', MIXED_APP);
  const run = join(appDir, 'wsp', 'runs', MIXED_APP_RUN);
  mkdirSync(join(run, 'passes'), { recursive: true });
  // Application .swao.yml as `swao assess` leaves it: no assessment.type (defaults to application).
  writeFileSync(join(appDir, '.swao.yml'), dump({ wsp_version: '0.9', app_id: MIXED_APP, app_name: 'Sovereign Health Platform', assessment: { pass_profile: ['inv', 'sbom', 'crypto', 'comp'] } }));
  writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${MIXED_APP_RUN}\n`);
  writeFileSync(join(appDir, 'wsp', 'latest-lz-primary.yaml'), dump({ landing_zone: { primary: 'synthetic/eu01', verdict: 'BLOCKED' } }));
  writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ run_id: MIXED_APP_RUN, pass_stats: [] }));
  writeFileSync(join(run, 'wsp.yaml'), dump({
    schema_version: '0.9', app_id: MIXED_APP, run_id: MIXED_APP_RUN,
    overall: { seven_r_label: 'Replatform', modernization_position: 'invest_modernize_with_remediation', coverage_score: 0.9, portability_score: 0.2, confidence: 'medium' },
  }));
  writeFileSync(join(run, 'wsp-plan.yaml'), dump({
    compliance: { regimes: [{ id: 'GDPR', controls: [{ id: 'GDPR_Art_32', outcome: 'GAP' }, { id: 'GDPR_Art_5_1_f', outcome: 'GAP' }, { id: 'GDPR_Art_30', outcome: 'GAP' }] }] },
  }));
  writeFileSync(join(run, 'passes', '05-sbom.yaml'), dump({
    pass: { id: 5, name: 'sbom_cve', signal_prefix: 'SBOM', status: 'complete' },
    signals: [{ id: 'SBOM-01', severity: 'low', outcome: 'negative', derivation: 'Spot check: 2 packages with high or critical CVEs.' }],
    assessment: { cve_lookup: 'completed', critical_cves_found: 2, node_eol_status: 'maintenance_lts' },
  }));
  writeFileSync(join(run, 'passes', '08-crypto.yaml'), dump({
    pass: { id: 8, name: 'crypto', signal_prefix: 'CRYPTO', status: 'complete' },
    signals: [
      { id: 'CRYPTO-01', severity: 'positive', outcome: 'positive', derivation: 'Strong MAC detected.' },
      { id: 'CRYPTO-02', severity: 'critical', outcome: 'negative', derivation: 'Private key committed to the repository.' },
    ],
  }));
  return ws;
}
