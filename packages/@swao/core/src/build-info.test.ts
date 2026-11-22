// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4430: build info helpers and the run-manifest 1.7 fixture (ADR-0012:
// additive minor bump; 1.6 manifests keep parsing).

import { describe, it, expect } from 'vitest';
import { buildShown, BUILD_INFO, buildCommitLabel, buildTag, versionWithBuild, buildProvenance, type BuildInfo } from './build-info.js';
import { RunManifestSchema } from './run-manifest.js';

const STAMPED: BuildInfo = { commit: '4c8dd01e', dirty: false, date: '2026-11-14', tag: null, display: true };

describe('#4430 build info', () => {
  it('an unbundled (source) run reports "source" and no date', () => {
    expect(BUILD_INFO).toEqual({ commit: 'source', dirty: false, date: null, tag: null, display: false });
    expect(versionWithBuild('1.6.1')).toBe('1.6.1 (source)');
    expect(buildProvenance()).toEqual({ build_commit: 'source', build_date: null });
  });

  it('a stamped build names commit and date; a dirty tree marks the commit', () => {
    expect(versionWithBuild('1.6.1', STAMPED)).toBe('1.6.1 (4c8dd01e, 2026-11-14)');
    expect(buildCommitLabel({ ...STAMPED, dirty: true })).toBe('4c8dd01e-dirty');
    expect(buildProvenance({ ...STAMPED, dirty: true })).toEqual({ build_commit: '4c8dd01e-dirty', build_date: '2026-11-14' });
  });

  it('a release build from a tag prints the tag instead of the date; the commit stays', () => {
    expect(buildTag({ ...STAMPED, tag: 'v1.6.1' })).toBe('4c8dd01e, v1.6.1');
    expect(buildProvenance({ ...STAMPED, tag: 'v1.6.1' }).build_date).toBe('2026-11-14');
  });

  it('owner decision 2026-11-15: a non-dev build (display false) shows the plain version and logs no build', () => {
    const release: BuildInfo = { ...STAMPED, tag: 'v1.6.1', display: false };
    expect(buildShown(release)).toBe(false);
    expect(buildTag(release)).toBeNull();
    expect(versionWithBuild('1.6.1', release)).toBe('1.6.1');
    expect(buildProvenance(release)).toEqual({});
    expect(JSON.stringify({ ...buildProvenance(release) })).not.toContain('4c8dd01e');
  });
});

const MANIFEST_16 = {
  schema_version: '1.6' as const,
  run_id: '2026-11-14T08-00-00',
  app: 'demo-app',
  iter: 1,
  assessed_at: '2026-11-14',
  started_at: '2026-11-14T08:00:00Z',
  finished_at: '2026-11-14T08:01:00Z',
  duration_ms: 60000,
  passes_executed: ['inv'],
  total_signals_emitted: 0,
  pass_stats: [],
  provenance: {
    temperature: 0,
    cassette_hits: [],
    placeholder_inputs: [],
    false_positive_flags: 0,
    lzr_input_type: 'none' as const,
    crawl_type: 'none' as const,
    swao_version: '1.6.1',
  },
};

describe('#4430 run-manifest 1.7 fixture: provenance.build_commit and build_date', () => {
  it('a 1.7 manifest with the build fields parses and keeps them', () => {
    const r = RunManifestSchema.parse({
      ...MANIFEST_16,
      schema_version: '1.7',
      provenance: { ...MANIFEST_16.provenance, build_commit: '4c8dd01e', build_date: '2026-11-14' },
    });
    expect(r.provenance?.build_commit).toBe('4c8dd01e');
    expect(r.provenance?.build_date).toBe('2026-11-14');
  });

  it('a source run (build_date null) parses', () => {
    expect(RunManifestSchema.safeParse({
      ...MANIFEST_16,
      schema_version: '1.7',
      provenance: { ...MANIFEST_16.provenance, ...buildProvenance() },
    }).success).toBe(true);
  });

  it('a 1.6 manifest without the build fields still parses (replay)', () => {
    expect(RunManifestSchema.safeParse(MANIFEST_16).success).toBe(true);
  });
});
