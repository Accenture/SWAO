// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, StatusLabel, StatusRow, DetailRow tests (#4247)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// SL-01 STATUS_MAP: seven levels, one word and one token each (section 6, 15.4)
// SL-02 form="list" renders [warn], form="summary" renders warn (M-07)
// SL-03 Q-13 / D-4: the accepted write-capable login is warn with the decided text
// SR-01 M-06 rows at 100 and 80 columns: status, label and summary on line 1; detail on line 2 under the label
// SR-02 the gitleaks and opentofu details of #4223 render in full, no ellipsis, within the header rule
// SR-03 counters are right-aligned so the label column does not shift ([ 1/15] and [10/15])
// SR-04 a selected row carries the central cursor marker
// DR-01 DetailRow block of M-06; a long value wraps under the value column
// DR-02 path shortens in the middle only, so the file name stays visible
// SR-05 #4295 / #4348: labels widen to fit and never wrap inside the column ("Vendor catalogue (Tier 2)") at 100 and 80 columns

import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import {
  DetailRow, STATUS_LEVELS, STATUS_MAP, StatusLabel, StatusRow, WRITE_CAPABLE_ACCEPTED, formatCounter, statusText,
  statusLabelWidth, statusRowHeight,
} from './StatusLabel.js';
import { headerRuleWidth } from './header-width.js';
import { renderAt, widest } from '../testing/render-at.js';

// #4223: the detail texts of the Application Assessment Ready step (swao/src/setup/application-tools.ts:52,77).
const GITLEAKS = 'The default secret scan (Pass 14 secrets) cannot run: every assessment records MAL-00 and lists the secret scan under the passes not executed.';
const OPENTOFU = 'Nothing is lost in the assessment: SWAO reads OpenTofu sources and state files placed in the app inputs without the tool.';
const CHECKOV = 'The IaC security scan uses kics instead; install checkov for the full rule set. Both tools read Terraform, OpenTofu and Kubernetes manifests.';

function rows(columns: number, el: JSX.Element): string[] {
  const r = renderAt(el, columns);
  const lines = r.lines().map((l) => l.trimEnd());
  r.unmount();
  return lines;
}

/** Text of the wrapped lines that start at `col`, joined with spaces. */
function joinedFrom(lines: string[], col: number): string {
  return lines.map((l) => l.slice(col).trim()).join(' ');
}

describe('StatusLabel and STATUS_MAP (#4247, Design 126 section 6)', () => {
  it('SL-01 seven levels, one word and one token each', () => {
    expect(STATUS_LEVELS).toEqual(['ok', 'info', 'warn', 'waiting', 'cancelled', 'fail', 'missing']);
    expect(Object.fromEntries(STATUS_LEVELS.map((l) => [l, [STATUS_MAP[l].word, STATUS_MAP[l].token]]))).toEqual({
      ok: ['ok', 'ok'], info: ['info', 'info'], warn: ['warn', 'warning'], waiting: ['waiting', 'warning'],
      cancelled: ['cancelled', 'warning'], fail: ['fail', 'error'], missing: ['missing', 'error'],
    });
    expect(STATUS_MAP.info.style).toEqual({ dimColor: true });
    expect(STATUS_MAP.fail.style).toEqual({ color: 'red' });
  });

  for (const columns of [100, 80]) {
    it(`SL-02 M-07 list and summary forms at ${columns} columns`, () => {
      const lines = rows(columns, (
        <Box flexDirection="column">
          {STATUS_LEVELS.map((l) => (
            <Box key={l}><Box width={14}><StatusLabel level={l} /></Box><StatusLabel level={l} form="summary" /></Box>
          ))}
        </Box>
      ));
      expect(lines).toEqual(STATUS_LEVELS.map((l) => `[${l}]`.padEnd(14) + l));
      expect(statusText('warn')).toBe('[warn]');
      expect(statusText('warn', 'summary')).toBe('warn');
    });
  }

  it('SL-04 #4294: a state word of its own in the colour of the level, brackets by form', () => {
    const lines = rows(100, (
      <Box flexDirection="column">
        <StatusLabel level="ok" form="summary" text="ready" />
        <StatusLabel level="waiting" text="not set up" />
      </Box>
    ));
    expect(lines.slice(0, 2)).toEqual(['ready', '[not set up]']);
  });

  it('SL-03 Q-13 / D-4: an accepted write-capable login is warn with the decided words', () => {
    expect(WRITE_CAPABLE_ACCEPTED).toEqual({ level: 'warn', text: 'write-capable, accepted for this run; SWAO only reads' });
  });
});

describe('StatusRow, two-line rows (#4247, #4223, mockup M-06)', () => {
  it('SR-01 M-06 at 100 columns: label column 20, detail under the label', () => {
    const lines = rows(100, (
      <Box flexDirection="column">
        <StatusRow level="ok" label="gitleaks" summary="secret scan in every run" />
        <StatusRow level="warn" label="checkov" summary="not found" detail={CHECKOV} />
        <StatusRow level="missing" label="source path" summary="required" detail="Enter the folder that holds the application source in the Source access step." />
      </Box>
    ));
    expect(lines[0]).toBe('  [ok]      gitleaks            secret scan in every run');
    expect(lines[1]).toBe('  [warn]    checkov             not found');
    expect(lines[2]!.startsWith('            The IaC security scan uses kics instead;')).toBe(true);
    expect(joinedFrom(lines.slice(2, 4), 12)).toBe(CHECKOV);
    expect(lines[4]).toBe('  [missing] source path         required');
    expect(lines[5]).toBe('            Enter the folder that holds the application source in the Source access step.');
    expect(widest(lines)).toBeLessThanOrEqual(98);
  });

  it('SR-01 M-06 at 80 columns: label column 18, the detail wraps within the 78-column rule', () => {
    const lines = rows(80, (
      <Box flexDirection="column">
        <StatusRow level="ok" label="gitleaks" summary="secret scan in every run" />
        <StatusRow level="warn" label="checkov" summary="not found" detail={CHECKOV} />
      </Box>
    ));
    expect(lines[0]).toBe('  [ok]      gitleaks          secret scan in every run');
    expect(lines[1]).toBe('  [warn]    checkov           not found');
    const detail = lines.slice(2);
    expect(detail.length).toBeGreaterThanOrEqual(2);
    for (const l of detail) expect(l.startsWith('            ')).toBe(true);
    expect(joinedFrom(detail, 12)).toBe(CHECKOV);
    expect(widest(lines)).toBeLessThanOrEqual(78);
  });

  for (const columns of [100, 80]) {
    it(`SR-02 the #4223 gitleaks and opentofu details render in full at ${columns} columns`, () => {
      const lines = rows(columns, (
        <Box flexDirection="column">
          <StatusRow level="warn" label="gitleaks" summary="not found" detail={GITLEAKS} />
          <StatusRow level="info" label="opentofu" summary="not found" detail={OPENTOFU} />
        </Box>
      ));
      const frame = lines.join('\n');
      expect(frame).not.toMatch(/\.\.\.|…/);
      const opentofuAt = lines.findIndex((l) => l.includes('[info]'));
      expect(joinedFrom(lines.slice(1, opentofuAt), 12)).toBe(GITLEAKS);
      expect(joinedFrom(lines.slice(opentofuAt + 1), 12)).toBe(OPENTOFU);
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    });
  }

  it('SR-03 counters are right-aligned to a fixed width', () => {
    expect(formatCounter(1, 15)).toBe(' [1/15]');
    expect(formatCounter(10, 15)).toBe('[10/15]');
    const lines = rows(100, (
      <Box flexDirection="column">
        <StatusRow level="ok" label="licence" counter={{ index: 1, total: 15 }} />
        <StatusRow level="ok" label="workspace" counter={{ index: 10, total: 15 }} />
      </Box>
    ));
    expect(lines[0]!.indexOf('licence')).toBe(lines[1]!.indexOf('workspace'));
  });

  it('SR-04 a selected row carries the central cursor marker', () => {
    const lines = rows(100, <StatusRow level="warn" label="otc-prod / platform" summary="write-capable login" selected />);
    expect(lines[0]!.startsWith(String.fromCodePoint(0x276f) + ' [warn]')).toBe(true);
  });
});

describe('DetailRow (#4247, mockup M-06)', () => {
  for (const columns of [100, 80]) {
    it(`DR-01 the M-06 block at ${columns} columns; a long value wraps under the value column`, () => {
      const lines = rows(columns, (
        <Box flexDirection="column">
          <DetailRow label="App" value="sovereign-health" />
          <DetailRow label="Passes" value="26 run, 2 skipped (no container image)" />
          <DetailRow label="Outputs" value="apps/sovereign-health/wsp/runs/2026-11-09T15-14-37/" path />
          <DetailRow label="Duration" value={`about 35 min (measured pass times of the last run). ${CHECKOV}`} />
        </Box>
      ));
      expect(lines[0]).toBe('  App        sovereign-health');
      expect(lines[1]).toBe('  Passes     26 run, 2 skipped (no container image)');
      expect(lines[2]).toBe('  Outputs    apps/sovereign-health/wsp/runs/2026-11-09T15-14-37/');
      expect(lines.length).toBeGreaterThan(4);
      for (const l of lines.slice(4)) expect(l.startsWith('             ')).toBe(true);
      expect(joinedFrom(lines.slice(3), 13)).toBe(`about 35 min (measured pass times of the last run). ${CHECKOV}`);
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    });
  }

  it('DR-02 a path shortens in the middle only and keeps the file name', () => {
    const long = 'apps/sovereign-health/wsp/runs/2026-11-09T15-14-37/publications/very/deep/folder/structure/report-final.html';
    const lines = rows(80, <DetailRow label="Report" value={long} path />);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith('  Report     apps/')).toBe(true);
    expect(lines[0]!.endsWith('report-final.html')).toBe(true);
    expect(lines[0]).toContain('...');
    expect(widest(lines)).toBeLessThanOrEqual(78);
  });
});

describe('status label column (#4295, #4348)', () => {
  const PROBES = ['Licence', 'LLM gateway', 'Vendor catalogue (Tier 2)', 'Service workspace'];
  for (const columns of [100, 80]) {
    it(`SR-05 "Vendor catalogue (Tier 2)" stays on one line at ${columns} columns; the counted height is the rendered height`, () => {
      const width = headerRuleWidth(columns);
      const labelWidth = statusLabelWidth(PROBES, width, { counter: { total: 26 } });
      expect(labelWidth).toBe('Vendor catalogue (Tier 2)'.length + 2);
      const r = renderAt(
        <Box flexDirection="column">
          {PROBES.map((p, i) => <StatusRow key={p} level={i === 2 ? 'warn' : 'ok'} label={p} labelWidth={labelWidth} counter={{ index: i + 1, total: 26 }} />)}
        </Box>,
        columns,
      );
      const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
      r.unmount();
      expect(lines).toHaveLength(PROBES.length);
      expect(lines.find((l) => l.includes('Vendor catalogue'))).toContain('Vendor catalogue (Tier 2)');
      // Every row starts its label in the same column.
      const cols = PROBES.map((p) => lines.find((l) => l.includes(p))!.indexOf(p));
      expect(new Set(cols).size).toBe(1);
      expect(statusRowHeight({ level: 'warn', label: 'Vendor catalogue (Tier 2)', labelWidth, counter: { index: 3, total: 26 } }, width)).toBe(1);
    });
  }

  it('SR-05 a column given too narrow widens to the label (StatusRow and statusRowHeight agree)', () => {
    const width = headerRuleWidth(100);
    expect(statusRowHeight({ level: 'ok', label: 'Vendor catalogue (Tier 2)', labelWidth: 24 }, width)).toBe(1);
    const r = renderAt(<StatusRow level="ok" label="Vendor catalogue (Tier 2)" summary="catalogue found" labelWidth={24} />, 100);
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    r.unmount();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Vendor catalogue (Tier 2) catalogue found');
  });

  it('SR-05 the column is capped so a summary of MIN_STATUS_SUMMARY_WIDTH still fits', () => {
    const width = headerRuleWidth(80);
    const w = statusLabelWidth(['x'.repeat(200)], width);
    expect(w).toBe(width - 2 - 10 - 20);
    expect(statusLabelWidth(['ab'], width, { min: 8 })).toBe(8);
  });
});
