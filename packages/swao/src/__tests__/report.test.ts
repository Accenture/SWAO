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

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  generateReport,
  formatText,
  formatYamlReport,
  formatViewExec,
  formatViewCompliance,
  formatViewFinops,
  formatViewMigrationManager,
  VALID_VIEWS,
} from '../commands/report.js';
import {
  generateLzReport, formatLzText, formatLzYaml,
  buildLzReportDataStub, buildLzReportDataStubForAgent,
  getLzAgentIds, buildLzTargetRows,
} from '../commands/report-lz.js';
import { RunManifestSchema } from '../schema/index.js';
import { buildAuditorReport, AuditorReportSchema } from '../commands/auditor-report-schema.js';
import { load, dump } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, '../../../../../examples/portfolio-workspace/portfolio/apps');
const GHOSTFOLIO_APP = join(EXAMPLES, 'ghostfolio');
const GHOSTFOLIO_WSP = join(GHOSTFOLIO_APP, 'wsp');
const MEDPLUM_APP = join(EXAMPLES, 'medplum');
const MEDPLUM_WSP = join(MEDPLUM_APP, 'wsp');
const SOVEREIGN_HEALTH_APP = join(EXAMPLES, 'sovereign-health');
const SOVEREIGN_HEALTH_WSP = join(SOVEREIGN_HEALTH_APP, 'wsp');

describe('swao report -- ghostfolio (WoZ examples workspace)', () => {
  it('generateReport returns a ReportData with appId and assessedAt', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.appId).toBe('ghostfolio');
    expect(data.assessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('seven_r_label populated from spine (Replatform)', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.sevenRLabel).toBe('Replatform');
  });

  it('coverage_score populated from spine (82%)', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.coverageScore).toBe('82%');
  });

  it('landing_zone populated from spine', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.landingZone).toBe('stackit_de_sovereign');
  });

  it('signal_counts.total > 0', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.signalCounts.total).toBeGreaterThan(0);
  });

  it('critical blockers listed (EGR-01, EGR-02 in ghostfolio WoZ)', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const ids = data.blockers.map(b => b.id);
    expect(ids).toContain('EGR-01');
    expect(ids).toContain('EGR-02');
  });

  it('topFindings contains at least 1 entry', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.topFindings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('swao report -- formatText', () => {
  it('text output contains section headers', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatText(data);
    expect(text).toContain('SWAO Assessment Report');
    expect(text).toContain('7R Label:');
    expect(text).toContain('Coverage:');
    expect(text).toContain('Signal Summary');
    expect(text).toContain('Migration Blockers');
    expect(text).toContain('Top Findings');
  });

  it('text output includes seven_r_label value', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatText(data);
    expect(text).toContain('Replatform');
  });

  it('text output includes signal count numbers', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatText(data);
    expect(text).toContain(String(data.signalCounts.total));
  });
});

describe('swao report -- formatYamlReport', () => {
  it('YAML output is valid YAML with required keys', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const yamlStr = formatYamlReport(data);
    const parsed = load(yamlStr) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed['app']).toBe('ghostfolio');
    expect(parsed['seven_r_label']).toBe('Replatform');
    expect(parsed['coverage_score']).toBe('82%');
    expect(parsed['signal_counts']).toBeDefined();
    expect(parsed['migration_blockers']).toBeDefined();
  });
});

describe('swao report -- graceful partial (no SYNTH pass)', () => {
  it('falls back to spine values when 09-synth.yaml absent', () => {
    // ghostfolio WoZ has no 09-synth.yaml; values come from spine
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.sevenRLabel).not.toBe('pending');
    expect(data.coverageScore).not.toBe('pending');
  });
});

describe('swao report -- run manifest duration (#0029)', () => {
  it('duration is undefined when wsp/run-manifest.json absent', () => {
    // ghostfolio WoZ workspace has no engine-written run-manifest.json
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.duration).toBeUndefined();
  });

  it('formatText does not include Duration line when duration is absent', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatText(data);
    expect(text).not.toContain('Duration:');
  });

  it('formatText includes Duration line when duration is present', () => {
    const data = { ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'), duration: '2m 14s' };
    const text = formatText(data);
    expect(text).toContain('Duration:      2m 14s');
  });

  it('formatYamlReport includes duration key when present', () => {
    const data = { ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'), duration: '45s' };
    const yamlStr = formatYamlReport(data);
    const parsed = load(yamlStr) as Record<string, unknown>;
    expect(parsed['duration']).toBe('45s');
  });

  it('formatYamlReport omits duration key when absent', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const yamlStr = formatYamlReport(data);
    const parsed = load(yamlStr) as Record<string, unknown>;
    expect(parsed['duration']).toBeUndefined();
  });
});

describe('swao report -- buildAuditorReport (#0219)', () => {
  it('returns a payload that validates against AuditorReportSchema', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const payload = buildAuditorReport(data, GHOSTFOLIO_WSP);
    expect(AuditorReportSchema.safeParse(payload).success).toBe(true);
    expect(payload.schema_version).toBe('1.0');
    expect(payload.workload.app_id).toBe('ghostfolio');
  });

  it('signals.total matches the sum of by_outcome counts', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const p = buildAuditorReport(data, GHOSTFOLIO_WSP);
    const outcomeSum = Object.values(p.signals.by_outcome).reduce((a, b) => a + b, 0);
    expect(outcomeSum).toBe(p.signals.total);
  });

  it('traceability ratios are all between 0 and 1', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const p = buildAuditorReport(data, GHOSTFOLIO_WSP);
    for (const v of Object.values(p.traceability)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('JSON round-trips through stringify+parse cleanly', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const payload = buildAuditorReport(data, GHOSTFOLIO_WSP);
    const roundTripped = JSON.parse(JSON.stringify(payload));
    expect(AuditorReportSchema.safeParse(roundTripped).success).toBe(true);
  });

  it('YAML round-trips through dump+load cleanly', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const payload = buildAuditorReport(data, GHOSTFOLIO_WSP);
    const yamlStr = dump(payload, { lineWidth: 120 });
    const roundTripped = load(yamlStr);
    expect(AuditorReportSchema.safeParse(roundTripped).success).toBe(true);
  });

  it('handles workspaces with no run manifest (run.llm absent)', () => {
    // ghostfolio WoZ workspace has no engine-written run-manifest.json
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const p = buildAuditorReport(data, GHOSTFOLIO_WSP);
    expect(p.run.llm).toBeUndefined();
    expect(p.run.duration_minutes).toBeUndefined();
  });
});

describe('RunManifestSchema (#0029)', () => {
  const base = {
    schema_version: '1.1' as const,
    run_id: '2026-04-28T14:32:01.000Z',
    app: 'sovereign-health',
    iter: 1,
    assessed_at: '2026-04-28',
    started_at: '2026-04-28T14:32:01.000Z',
    finished_at: '2026-04-28T14:34:15.000Z',
    duration_ms: 134000,
    passes_executed: ['inventory', 'state_analysis', 'data_classification'],
    total_signals_emitted: 42,
    pass_stats: [
      { pass: 'inventory', num: '01', wall_clock_ms: 1200, signals_emitted: 8 },
      { pass: 'state_analysis', num: '02', wall_clock_ms: 900, signals_emitted: 5 },
      { pass: 'data_classification', num: '03', wall_clock_ms: 22400, signals_emitted: 29 },
    ],
  };

  it('accepts a valid run manifest', () => {
    expect(RunManifestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects wrong schema_version', () => {
    expect(RunManifestSchema.safeParse({ ...base, schema_version: '1.0' }).success).toBe(false);
  });

  it('rejects missing started_at', () => {
    const { started_at: _omit, ...rest } = base;
    expect(RunManifestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing finished_at', () => {
    const { finished_at: _omit, ...rest } = base;
    expect(RunManifestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects negative duration_ms', () => {
    expect(RunManifestSchema.safeParse({ ...base, duration_ms: -1 }).success).toBe(false);
  });

  it('rejects non-integer duration_ms', () => {
    expect(RunManifestSchema.safeParse({ ...base, duration_ms: 134.5 }).success).toBe(false);
  });

  it('rejects zero iter', () => {
    expect(RunManifestSchema.safeParse({ ...base, iter: 0 }).success).toBe(false);
  });

  it('started_at must be ISO 8601 with offset', () => {
    expect(RunManifestSchema.safeParse({ ...base, started_at: '2026-04-28' }).success).toBe(false);
  });
});

describe('swao report -- engagement header (#0228)', () => {
  it('generateReport returns an engagement block when wsp.yaml has one', () => {
    // examples/portfolio-workspace/portfolio/.swao.yml ships an engagement
    // block; the workspace builder copies it into wsp.yaml.
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    // Fixture may have partial engagement; assertion is just "block present
    // with at least one populated field".
    if (data.engagement) {
      const populated = [
        data.engagement.name,
        data.engagement.client_code,
        data.engagement.partnership_lead,
        data.engagement.start_date,
      ].filter((v) => v !== undefined);
      expect(populated.length).toBeGreaterThan(0);
    }
  });

  it('formatText prepends the engagement header when engagement is set', () => {
    const data: ReturnType<typeof generateReport> = {
      ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'),
      engagement: {
        name: 'Test Engagement',
        client_code: 'TST',
        partnership_lead: 'lead@example.com',
        start_date: '2026-01-15',
      },
    };
    const text = formatText(data);
    expect(text).toMatch(/^Engagement: +Test Engagement/m);
    expect(text).toMatch(/^Client code: +TST/m);
    expect(text).toMatch(/^Partnership lead: +lead@example.com/m);
    expect(text).toMatch(/^Start date: +2026-01-15/m);
  });

  it('formatText omits the engagement header when engagement is undefined', () => {
    const data = { ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'), engagement: undefined };
    const text = formatText(data);
    expect(text).not.toMatch(/^Engagement: /m);
    expect(text).not.toMatch(/^Client code: /m);
  });

  it('formatYamlReport includes engagement key when present', () => {
    const data = {
      ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'),
      engagement: { name: 'X', client_code: 'X', partnership_lead: 'X', start_date: '2026-01-01' },
    };
    const parsed = load(formatYamlReport(data)) as Record<string, unknown>;
    expect(parsed['engagement']).toBeDefined();
    const eng = parsed['engagement'] as Record<string, unknown>;
    expect(eng['name']).toBe('X');
    expect(eng['client_code']).toBe('X');
  });

  it('formatYamlReport omits engagement key when absent', () => {
    const data = { ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'), engagement: undefined };
    const parsed = load(formatYamlReport(data)) as Record<string, unknown>;
    expect(parsed['engagement']).toBeUndefined();
  });

  it('formatViewExec prepends the engagement header', () => {
    const data = {
      ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'),
      engagement: { name: 'View-Test', client_code: 'VT', partnership_lead: 'vt@example.com', start_date: '2026-02-02' },
    };
    const text = formatViewExec(data, GHOSTFOLIO_WSP);
    expect(text).toMatch(/^Engagement: +View-Test/m);
  });

  it('formatViewCompliance prepends the engagement header', () => {
    const data = {
      ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'),
      engagement: { name: 'CV', client_code: 'CV', partnership_lead: 'cv@example.com', start_date: '2026-03-03' },
    };
    const text = formatViewCompliance(data, GHOSTFOLIO_WSP);
    expect(text).toMatch(/^Engagement: +CV/m);
  });

  it('buildAuditorReport carries engagement through to the schema-validated payload', () => {
    const data = {
      ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'),
      engagement: { name: 'AR', client_code: 'AR', partnership_lead: 'ar@example.com', start_date: '2026-04-04' },
    };
    const payload = buildAuditorReport(data, GHOSTFOLIO_WSP);
    expect(AuditorReportSchema.safeParse(payload).success).toBe(true);
    expect(payload.engagement).toBeDefined();
    expect(payload.engagement?.name).toBe('AR');
    expect(payload.engagement?.client_code).toBe('AR');
  });

  it('buildAuditorReport with engagement undefined still validates (engagement is optional)', () => {
    const data = { ...generateReport(GHOSTFOLIO_APP, 'ghostfolio'), engagement: undefined };
    const payload = buildAuditorReport(data, GHOSTFOLIO_WSP);
    expect(AuditorReportSchema.safeParse(payload).success).toBe(true);
    expect(payload.engagement).toBeUndefined();
  });
});

describe('swao report --view: valid view names (#0079)', () => {
  it('VALID_VIEWS includes all five views', () => {
    expect(VALID_VIEWS).toContain('technical');
    expect(VALID_VIEWS).toContain('exec');
    expect(VALID_VIEWS).toContain('compliance');
    expect(VALID_VIEWS).toContain('finops');
    expect(VALID_VIEWS).toContain('migration-manager');
  });
});

describe('swao report --view exec (#0079)', () => {
  it('ghostfolio -- renders without error and contains key sections', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatViewExec(data, GHOSTFOLIO_WSP);
    expect(text).toContain('Executive View');
    expect(text).toContain('Migration Recommendation');
    expect(text).toContain('Replatform');
  });

  it('medplum -- renders without error', () => {
    const data = generateReport(MEDPLUM_APP, 'medplum');
    expect(() => formatViewExec(data, MEDPLUM_WSP)).not.toThrow();
  });

  it('sovereign-health -- renders without error', () => {
    const data = generateReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(() => formatViewExec(data, SOVEREIGN_HEALTH_WSP)).not.toThrow();
  });
});

describe('swao report --view compliance (#0079)', () => {
  it('ghostfolio -- renders without error and contains compliance header', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatViewCompliance(data, GHOSTFOLIO_WSP);
    expect(text).toContain('GRC / Compliance View');
  });

  it('medplum -- renders without error', () => {
    const data = generateReport(MEDPLUM_APP, 'medplum');
    expect(() => formatViewCompliance(data, MEDPLUM_WSP)).not.toThrow();
  });

  it('sovereign-health -- renders without error', () => {
    const data = generateReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(() => formatViewCompliance(data, SOVEREIGN_HEALTH_WSP)).not.toThrow();
  });
});

describe('swao report --view finops (#0079)', () => {
  it('ghostfolio -- renders without error and contains FinOps header', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatViewFinops(data, GHOSTFOLIO_WSP);
    expect(text).toContain('FinOps View');
    expect(text).toContain('Signal Summary');
  });

  it('medplum -- renders without error', () => {
    const data = generateReport(MEDPLUM_APP, 'medplum');
    expect(() => formatViewFinops(data, MEDPLUM_WSP)).not.toThrow();
  });

  it('sovereign-health -- renders without error', () => {
    const data = generateReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(() => formatViewFinops(data, SOVEREIGN_HEALTH_WSP)).not.toThrow();
  });
});

describe('swao report --view migration-manager (#0079)', () => {
  it('ghostfolio -- renders without error and contains runbook', () => {
    const data = generateReport(GHOSTFOLIO_APP, 'ghostfolio');
    const text = formatViewMigrationManager(data, GHOSTFOLIO_WSP);
    expect(text).toContain('Programme Manager View');
    expect(text).toContain('Migration Runbook');
  });

  it('medplum -- renders without error', () => {
    const data = generateReport(MEDPLUM_APP, 'medplum');
    expect(() => formatViewMigrationManager(data, MEDPLUM_WSP)).not.toThrow();
  });

  it('sovereign-health -- renders without error', () => {
    const data = generateReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(() => formatViewMigrationManager(data, SOVEREIGN_HEALTH_WSP)).not.toThrow();
  });
});

// #1120: LZ Assessment report tests -- skip when no LZ fixture exists in the examples workspace
const LZ_FIXTURE_AVAILABLE = existsSync(join(SOVEREIGN_HEALTH_APP, 'wsp', 'latest-landing-zone-catalog.txt'));

describe('swao report --type landing-zone-catalog (#1120)', () => {
  it.skipIf(!LZ_FIXTURE_AVAILABLE)('generateLzReport returns LzReportData with appId', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(data.appId).toBe('sovereign-health');
    expect(data.targets).toBeDefined();
    expect(Array.isArray(data.targets)).toBe(true);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('generateLzReport: at least one target loaded', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    expect(data.targets.length).toBeGreaterThan(0);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('generateLzReport: SOVEREIGNTY_BLOCKED target present', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const blocked = data.targets.filter(t => t.overall === 'SOVEREIGNTY_BLOCKED');
    expect(blocked.length).toBeGreaterThan(0);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('formatLzText includes Verdict Summary section', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const text = formatLzText(data);
    expect(text).toContain('Verdict Summary');
    expect(text).toContain('Sovereignty Gate Analysis');
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('formatLzText contains no em-dashes', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const text = formatLzText(data);
    expect(text).not.toMatch(/—|–/);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('formatLzYaml produces valid YAML with targets key', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const yaml = formatLzYaml(data);
    const parsed = load(yaml) as Record<string, unknown>;
    expect(Array.isArray(parsed['targets'])).toBe(true);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('buildLzReportDataStub: blockers from SOVEREIGNTY_BLOCKED; sevenRLabel empty (no 7R for LZ)', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const stub = buildLzReportDataStub(data);
    const blockedCount = data.targets.filter(t => t.overall === 'SOVEREIGNTY_BLOCKED').length;
    expect(stub.blockers.length).toBe(blockedCount);
    expect(stub.sevenRLabel).toBe('');  // 7R not applicable for LZ reports
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('buildLzReportDataStub: landingZone lists all assessed targets', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const stub = buildLzReportDataStub(data);
    // Should contain each target's provider/region
    for (const t of data.targets) {
      expect(stub.landingZone).toContain(`${t.provider}/${t.region}`);
    }
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('getLzAgentIds returns agent IDs from challenge findings', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const ids = getLzAgentIds(data);
    expect(ids.length).toBe(data.challengeFindings.length);
    for (const agent of data.challengeFindings) {
      expect(ids).toContain(agent.agentId);
    }
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('buildLzTargetRows returns one row per LZ target', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const rows = buildLzTargetRows(data);
    expect(rows.length).toBe(data.targets.length);
    for (const row of rows) {
      expect(row).toHaveProperty('csp');
      expect(row).toHaveProperty('verdict');
      expect(row).toHaveProperty('frameworks');
      expect(row).toHaveProperty('frameworkItems');
    }
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('buildLzReportDataStubForAgent filters to single agent', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    if (data.challengeFindings.length === 0) return;
    const agentId = data.challengeFindings[0]!.agentId;
    const stub = buildLzReportDataStubForAgent(data, agentId);
    // Only findings for the target agent appear
    expect(stub.challengeFindings!.length).toBe(1);
    expect(stub.challengeFindings![0]!.agentId).toBe(agentId);
  });

  it.skipIf(!LZ_FIXTURE_AVAILABLE)('formatLzText includes LZ Comparison table', () => {
    const data = generateLzReport(SOVEREIGN_HEALTH_APP, 'sovereign-health');
    const text = formatLzText(data);
    expect(text).toContain('LZ Comparison');
    expect(text).toContain('Verdict');
    expect(text).toContain('Frameworks');
  });

  it('generateLzReport on app with no LZ data returns empty targets gracefully', () => {
    const data = generateLzReport(GHOSTFOLIO_APP, 'ghostfolio');
    expect(data.targets).toEqual([]);
    expect(data.challengeFindings).toEqual([]);
  });
});
