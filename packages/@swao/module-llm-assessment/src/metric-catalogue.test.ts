// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Metric catalogue completeness guard (#1424, Design 092 s5.1).
// Tooltips must stand alone (operator round 3): a metric without a
// complete description fails the build here, not in review.

import { describe, it, expect } from 'vitest';
import {
  METRIC_CATALOGUE,
  METRIC_CATALOGUE_VERSION,
  METRIC_GROUPS,
  metricById,
  metricsByGroup,
  scoredMetrics,
} from './metric-catalogue.js';

describe('metric catalogue completeness (#1424)', () => {
  it('has a semver catalogue version (feeds the comparability key)', () => {
    expect(METRIC_CATALOGUE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ids are unique and dotted <prefix>.<name>', () => {
    const ids = METRIC_CATALOGUE.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
  });

  it('every metric belongs to a known group', () => {
    for (const m of METRIC_CATALOGUE) {
      expect(METRIC_GROUPS).toContain(m.group);
    }
  });

  it('every group except metadata has at least one metric; metadata is neutral-only', () => {
    for (const g of METRIC_GROUPS) {
      expect(metricsByGroup(g).length, `group ${g} is empty`).toBeGreaterThan(0);
    }
    for (const m of metricsByGroup('metadata')) {
      expect(m.direction, `${m.id} in metadata must be neutral`).toBe('neutral');
    }
  });

  it('every description stands alone: non-trivial length and states what is measured', () => {
    for (const m of METRIC_CATALOGUE) {
      expect(m.label.length, `${m.id} label`).toBeGreaterThan(2);
      expect(
        m.description.length,
        `${m.id} description too thin for a standalone tooltip`,
      ).toBeGreaterThanOrEqual(80);
      // A standalone tooltip explains measurement or provenance, not just
      // restates the label.
      expect(
        m.description.toLowerCase(),
        `${m.id} description must not simply repeat the label`,
      ).not.toBe(m.label.toLowerCase());
    }
  });

  it('scored metrics have a real unit or an explicit rate/count semantic', () => {
    for (const m of scoredMetrics()) {
      expect(['lower', 'higher']).toContain(m.direction);
      expect(m.unit.length, `${m.id} scored metric needs a unit`).toBeGreaterThan(0);
    }
  });

  it('lookup helpers agree with the table', () => {
    for (const m of METRIC_CATALOGUE) {
      expect(metricById(m.id)).toBe(m);
    }
    expect(metricById('nope.missing')).toBeUndefined();
    const grouped = METRIC_GROUPS.flatMap((g) => metricsByGroup(g));
    expect(grouped.length).toBe(METRIC_CATALOGUE.length);
  });

  it('covers the Design 092 s5.3A core properties', () => {
    for (const required of [
      'qc.grounded_signal_rate',
      'qs.parse_valid_rate',
      'perf.latency_p50_ms',
      'cost.total_usd',
      'rel.dnf_count',
      'sec.redaction_marker_altered',
    ]) {
      expect(metricById(required), `${required} missing`).toBeDefined();
    }
  });
});
