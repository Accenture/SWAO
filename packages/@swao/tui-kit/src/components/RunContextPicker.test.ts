// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- RunContextPicker unit tests (#0784 / #0786)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatRunTs, loadEntries, displayName, DISPLAY_NAMES } from './RunContextPicker.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-rcp-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('formatRunTs', () => {
  it('converts run directory timestamp to ISO string', () => {
    expect(formatRunTs('2026-07-04T14-23-55')).toBe('2026-07-04T14:23:55Z');
  });

  it('handles minimum-length timestamps', () => {
    expect(formatRunTs('2026-07-04T00-00-00')).toBe('2026-07-04T00:00:00Z');
  });

  it('returns raw string when too short to parse', () => {
    expect(formatRunTs('short')).toBe('short');
  });
});

describe('displayName', () => {
  it('returns display name for known assessment types', () => {
    expect(displayName('application')).toBe('Application Assessment');
    expect(displayName('landing-zone-catalog')).toBe('Landing Zone Catalog Assessment');
    expect(displayName('audit')).toBe('Audit Assessment');
    expect(displayName('llm')).toBe('LLM Assessment');
    expect(displayName('hybrid')).toBe('Hybrid Assessment');
  });

  it('returns raw type for unknown types', () => {
    expect(displayName('custom-type')).toBe('custom-type');
  });

  it('DISPLAY_NAMES covers all expected types', () => {
    const expected = ['application', 'landing-zone-catalog', 'audit', 'llm', 'hybrid'];
    for (const t of expected) {
      expect(DISPLAY_NAMES[t]).toBeDefined();
    }
  });
});

describe('loadEntries', () => {
  it('returns empty array for non-existent directory', () => {
    const result = loadEntries(join(tmp, 'does-not-exist'));
    expect(result).toEqual([]);
  });

  it('returns empty array for directory with no type pointer files', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'latest.txt'), 'runs/2026-07-04T10-00-00', 'utf-8');
    const result = loadEntries(tmp);
    expect(result).toEqual([]);
  });

  it('parses a single latest-application.txt pointer', () => {
    writeFileSync(join(tmp, 'latest-application.txt'), 'runs/2026-07-04T09-00-00', 'utf-8');
    const result = loadEntries(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].assessmentType).toBe('application');
    expect(result[0].runTimestamp).toBe('2026-07-04T09:00:00Z');
    expect(result[0].label).toContain('Application Assessment');
    expect(result[0].label).toContain('2026-07-04T09:00:00Z');
  });

  it('parses multiple type pointers and sorts by assessment type', () => {
    writeFileSync(join(tmp, 'latest-application.txt'), 'runs/2026-07-04T09-00-00', 'utf-8');
    writeFileSync(join(tmp, 'latest-landing-zone-catalog.txt'), 'runs/2026-07-04T10-00-00', 'utf-8');
    writeFileSync(join(tmp, 'latest-audit.txt'), 'runs/2026-07-04T08-00-00', 'utf-8');
    const result = loadEntries(tmp);
    expect(result).toHaveLength(3);
    // Sorted alphabetically by assessmentType
    expect(result[0].assessmentType).toBe('application');
    expect(result[1].assessmentType).toBe('audit');
    expect(result[2].assessmentType).toBe('landing-zone-catalog');
  });

  it('strips the runs/ prefix from pointer content', () => {
    writeFileSync(join(tmp, 'latest-application.txt'), 'runs/2026-07-04T14-23-55', 'utf-8');
    const result = loadEntries(tmp);
    expect(result[0].runTimestamp).toBe('2026-07-04T14:23:55Z');
  });

  it('handles pointer content without runs/ prefix (flat workspace)', () => {
    writeFileSync(join(tmp, 'latest-application.txt'), '2026-07-04T14-23-55', 'utf-8');
    const result = loadEntries(tmp);
    expect(result[0].runTimestamp).toBe('2026-07-04T14:23:55Z');
  });

  it('ignores non-pointer files in the wsp directory', () => {
    writeFileSync(join(tmp, 'latest-application.txt'), 'runs/2026-07-04T09-00-00', 'utf-8');
    writeFileSync(join(tmp, 'latest.txt'), 'runs/2026-07-04T10-00-00', 'utf-8');
    writeFileSync(join(tmp, 'wsp.yaml'), 'wsp_version: "0.10"\n', 'utf-8');
    writeFileSync(join(tmp, 'run-context.yaml'), 'assessment_type: application\n', 'utf-8');
    // Only the latest-application.txt pointer should be picked up
    const result = loadEntries(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].assessmentType).toBe('application');
  });
});
