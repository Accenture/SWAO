// #4400 (Design 103 section 7, D-10): the framework step of the Service Portfolio Assessment.
// #4456 (Design 103 section 6.1): installed frameworks only, plus SWAO_APM; one line per row.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { CURSOR_MARKER, PICKER_ROW_INDENT, detailLines, headerRuleWidth, labelColumnWidth, rowLabelWidth } from '@swao/tui-kit';
import {
  SERVICE_FRAMEWORKS_MORE_HINT, frameworkDisplayName, serviceFrameworkChoice, serviceFrameworkRowDetails, serviceFrameworksLine, unknownServiceFrameworks, unknownServiceFrameworksMessage,
} from '../service-frameworks.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(installed: readonly string[] = []): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-svc-fw-'));
  dirs.push(ws);
  for (const folder of installed) cpSync(join(communityFrameworksDir, folder), join(ws, 'wsp', 'inputs', 'catalogs', 'community', folder), { recursive: true });
  return ws;
}

describe('serviceFrameworkChoice (#4400, #4456)', () => {
  it('resolves SWAO_APM from the bundled copy and offers no bundled framework in a workspace without installed ones', () => {
    const c = serviceFrameworkChoice(workspace(), communityFrameworksDir);
    expect(c.baseline).toEqual({ id: 'SWAO_APM', source: 'bundled' });
    expect(c.options).toEqual([]);
  });

  it('offers only the installed frameworks whose scope fits a service run, sorted by id', () => {
    // gdpr and nis2 fit (scope app or service); llm-selection is LLM-only and is not offered.
    const c = serviceFrameworkChoice(workspace(['nis2', 'gdpr', 'llm-selection']), communityFrameworksDir);
    const ids = c.options.map((o) => o.id);
    expect(ids).toEqual(['GDPR', 'NIS2']);
    expect(ids).not.toContain('SWAO_APM');
    // A bundled framework that is not installed (DORA, BSI_C5, ...) is never offered.
    expect(ids).not.toContain('DORA');
  });

  it('prefers the workspace copy of SWAO_APM and never lists it as an option', () => {
    const c = serviceFrameworkChoice(workspace(['swao-apm', 'nis2']), communityFrameworksDir);
    expect(c.baseline).toEqual({ id: 'SWAO_APM', source: 'workspace' });
    expect(c.options.map((o) => o.id)).toEqual(['NIS2']);
  });

  it('shows a spaced double dash of a catalogue name as a comma', () => {
    expect(frameworkDisplayName('GDPR Demo (11 controls) ' + '-'.repeat(2) + ' Live-Presentation Subset')).toBe('GDPR Demo (11 controls), Live-Presentation Subset');
    const c = serviceFrameworkChoice(workspace(['nis2']), communityFrameworksDir);
    expect(c.options[0]!.name).not.toContain(' ' + '-'.repeat(2) + ' ');
  });

  it('names SWAO_APM missing when it resolves nowhere', () => {
    expect(serviceFrameworkChoice(workspace(), undefined)).toEqual({ baseline: null, options: [] });
  });

  it('the confirmation line keeps SWAO_APM first', () => {
    expect(serviceFrameworksLine([])).toBe('SWAO_APM (always evaluated) and the default frameworks of each app');
    expect(serviceFrameworksLine(['NIS2', 'SWAO_APM', 'NIS2'])).toBe('SWAO_APM (always evaluated), NIS2');
  });
});

describe('serviceFrameworkRowDetails: one line per framework (#4456)', () => {
  const options = [
    { id: 'NIS2', name: 'Network and Information Security Directive 2, the EU directive on a high common level of cybersecurity across the Union' },
    { id: 'BSI_GRUNDSCHUTZ_2023', name: 'BSI IT-Grundschutz Kompendium 2023 with the modules for hospitals, data centres and cloud services' },
    { id: 'GDPR', name: 'General Data Protection Regulation' },
  ];

  for (const columns of [80, 100]) {
    it(`never wraps a row at ${columns} columns (MultiSelect width rule)`, () => {
      const width = headerRuleWidth(columns);
      const details = serviceFrameworkRowDetails(options, width);
      // The same arithmetic as MultiSelect: row width, checkbox prefix, padded label column.
      const rowWidth = width - PICKER_ROW_INDENT;
      const prefix = CURSOR_MARKER.length + 4;
      const labelWidth = labelColumnWidth(options.map((o) => o.id), rowWidth, prefix, true);
      options.forEach((o, i) => {
        const used = prefix + rowLabelWidth(o.id, labelWidth);
        const lines = detailLines(details[i], rowWidth, used, prefix);
        expect(lines.rest).toEqual([]);
        expect(lines.first).toBe(details[i]);
        expect(PICKER_ROW_INDENT + used + 2 + details[i]!.length).toBeLessThanOrEqual(width);
      });
      // A short name stays whole; a long one is cut with "...".
      expect(details[2]).toBe('General Data Protection Regulation');
      expect(details[0]!.endsWith('...')).toBe(true);
    });
  }
});

describe('unknownServiceFrameworks: --regimes parity (#4456)', () => {
  it('accepts SWAO_APM and installed ids, refuses the rest with the GitHub hint', () => {
    const ws = workspace(['nis2']);
    expect(unknownServiceFrameworks(ws, ['SWAO_APM', 'NIS2'])).toEqual([]);
    expect(unknownServiceFrameworks(ws, ['NIS2', 'DORA', 'DORA', 'BSI_C5'])).toEqual(['DORA', 'BSI_C5']);
    const msg = unknownServiceFrameworksMessage(['DORA']);
    expect(msg).toContain('DORA is not installed in this workspace');
    expect(msg).toContain(SERVICE_FRAMEWORKS_MORE_HINT);
    expect(SERVICE_FRAMEWORKS_MORE_HINT).toContain('https://github.com/Accenture/SWAO/tree/main/community-frameworks');
    expect(SERVICE_FRAMEWORKS_MORE_HINT).toContain('wsp/inputs/catalogs/community/<folder>/');
  });
});
