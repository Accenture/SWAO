// #3577: the community-frameworks probe line shows the service-mapping coverage
// per framework (Design 120 §8.2).

import { describe, it, expect } from 'vitest';
import { formatCommunityFrameworksProbeLine } from './health-check.js';
import type { CommunityFrameworksProbeResult, PolicyBaselineSummary, ServiceMappingSummary } from '../probes/compliance-catalogues-probe.js';

const NO_BASELINE: PolicyBaselineSummary = {
  status: 'absent', policies: 0, enabled: 0, disabled: 0, not_set: [], catalogue_version: null,
  shipped_version: null, stale: false, missing_shipped_ids: [], unused_tags: [],
};

function probe(service_mapping: ServiceMappingSummary, policy_baseline: PolicyBaselineSummary = NO_BASELINE): CommunityFrameworksProbeResult {
  return {
    status: 'ok', catalogs_dir: '/ws/wsp/inputs/catalogs', standard_count: 0, community_count: 1, bundled_count: 0,
    collisions: [], warnings: [], errors: [],
    frameworks: [{ id: 'BSI_C5', scope: 'community', contributor: 'SWAO Development Team', controls_count: 62, service_mapping, policy_baseline }],
  };
}

describe('formatCommunityFrameworksProbeLine (#3577)', () => {
  it('shows mapped / in-use capability tags for a framework with a mapping', () => {
    const line = formatCommunityFrameworksProbeLine(probe({ status: 'ok', mapped: 12, in_use: 73, unused_mappings: [] }));
    expect(line).toContain('[ok] community/BSI_C5: contributor=SWAO Development Team, 62 controls, service mapping 12/73 capability tags');
  });

  it('says so when a framework has no mapping or an invalid one', () => {
    expect(formatCommunityFrameworksProbeLine(probe({ status: 'absent', mapped: 0, in_use: 0, unused_mappings: [] }))).toContain('62 controls, no service mapping');
    expect(formatCommunityFrameworksProbeLine(probe({ status: 'invalid', mapped: 0, in_use: 73, unused_mappings: [] }))).toContain('62 controls, service mapping invalid');
  });
});

describe('formatCommunityFrameworksProbeLine policy baseline (#3869)', () => {
  const sm: ServiceMappingSummary = { status: 'ok', mapped: 12, in_use: 73, unused_mappings: [] };
  const ok: PolicyBaselineSummary = { ...NO_BASELINE, status: 'ok', policies: 20, enabled: 17, disabled: 3, catalogue_version: '1.0.0', shipped_version: '1.0.0' };

  it('adds nothing for a framework without a baseline', () => {
    expect(formatCommunityFrameworksProbeLine(probe(sm))).not.toContain('policy baseline');
  });

  it('shows enabled / total, not reviewed and stale', () => {
    expect(formatCommunityFrameworksProbeLine(probe(sm, ok))).toContain('service mapping 12/73 capability tags, policy baseline 17/20 enabled');
    const line = formatCommunityFrameworksProbeLine(probe(sm, { ...ok, not_set: ['CPB-LOG-03'], stale: true, shipped_version: '1.1.0' }));
    expect(line).toContain('policy baseline 17/20 enabled, 1 not reviewed, stale (1.0.0 < shipped 1.1.0)');
  });

  it('marks an invalid baseline FAIL', () => {
    const line = formatCommunityFrameworksProbeLine(probe(sm, { ...NO_BASELINE, status: 'invalid' }));
    expect(line).toContain('[FAIL] community/BSI_C5');
    expect(line).toContain('policy baseline invalid');
  });
});

// #4452: one line per further warning; no spaced double hyphen in the probe lines.
describe('formatCommunityFrameworksProbeLine warnings (#4452)', () => {
  it('prints the first warning on the head line and each further warning on its own line', () => {
    const base = probe({ status: 'ok', mapped: 12, in_use: 73, unused_mappings: [] });
    const line = formatCommunityFrameworksProbeLine({ ...base, status: 'warn', warnings: ['first warning', 'regime "X" declared in .swao.yml of 2 apps (apps/a, apps/b) is not found'] });
    const lines = line.split('\n');
    expect(lines[0]).toContain('WARN  0 standard + 1 community  first warning');
    expect(lines[1]).toContain('[warn] regime "X" declared in .swao.yml of 2 apps');
    expect(line).not.toContain(' -- ');
  });
});
