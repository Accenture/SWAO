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

// #4286 criterion 4: a service app scaffolded from an intake workbook the way
// `swao service init` does it, in a fresh workspace without any copied
// framework, evaluates SWAO_APM in Pass 11 (bundled copy, D-10). Fake LLM only.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { loadInfraCatalogue, parseIntakeSheets, planScaffold, writeScaffold, type SheetLike } from '@swao/module-service-assessment';
import { runCompliancePass } from '@swao/module-framework';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const HEADERS = ['App-ID', 'Anwendungsname', 'Hersteller', 'Betriebssystem', 'Fachbereich', 'App-Funktion', 'Kritikalität', 'Datenklassifizierung', 'Time-Einstufung'];
const ROW = ['APP0153', 'Network Access Control', 'Example Vendor', 'Windows Server 2019', 'IT', 'Netzwerk', 'Hoch', 'Vertraulich', 'Migrieren'];
function sheet(name: string, headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): SheetLike {
  const grid = [headers, ...rows];
  return { name, rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
}

describe('Pass 11 on a scaffolded service app in a fresh workspace (#4286)', () => {
  it('evaluates the SWAO_APM controls from the bundled copy', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ws = mkdtempSync(join(tmpdir(), 'swao-4286-init-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: Fixture Engagement\n');
    const intake = parseIntakeSheets([sheet('Anwendungen', HEADERS, [ROW])]);
    const plan = planScaffold(intake.rows, loadInfraCatalogue(), { generatedAt: '2026-11-09' });
    writeScaffold(ws, plan.apps, plan.signals, {
      source: 'intake.xlsx', mapping: null, imported_at: '2026-11-09', app_count: plan.apps.length, row_count: 1,
      sheets: ['Anwendungen'], headers: {}, pii_columns: [], cluster_threshold: 3,
    });
    const appId = plan.apps[0]!.appId;
    const appDir = join(ws, 'apps', appId);
    const yml = load(readFileSync(join(appDir, '.swao.yml'), 'utf-8')) as { assessment?: { type?: string; regimes_active?: string[] } };
    expect(yml.assessment).toMatchObject({ type: 'service', regimes_active: ['SWAO_APM'] });

    const passesDir = join(appDir, 'wsp', 'runs', '2026-11-09T15-14-37', 'passes');
    mkdirSync(passesDir, { recursive: true });
    writeFileSync(join(passesDir, '01-data.yaml'), 'pass:\n  id: 1\n  name: data\nsignals:\n  - id: DATA-01\n    severity: informational\n    derivation: "probe"\n');
    const llm = {
      complete: async (prompt: string): Promise<string> => JSON.stringify({
        controls: [...prompt.matchAll(/- id: (\S+)/g)].map((m) => ({ id: m[1], outcome: 'UNKNOWN', rationale: 'Fake rationale.', signal_refs: ['DATA-01'], remediation: '' })),
      }),
    };
    const out = await runCompliancePass({ appId, sourcePath: appDir, workspacePath: appDir, iter: 1, assessedAt: '2026-11-09', passesDir, llm });
    const a = out.assessment as { regimes_evaluated: number; controls_total: number };
    expect(a.regimes_evaluated).toBe(1);
    expect(a.controls_total).toBeGreaterThan(0);
  });
});
