// #4506: the LZ Catalog run screen reads the markers of the CLI through the one
// parser of @swao/core and opts in to them; the CLI side is pinned end to end in
// swao/src/commands/assess-lz-run-markers.test.ts. #4501: the framework metadata
// of the frameworks step reaches the guidance box without a spaced double hyphen.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyLzCuratedLabels } from '@swao/tui-kit';
import { normaliseLzGateFrameworks } from '../assess-helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(here, 'LzAssessmentScreen.tsx'), 'utf-8');

describe('LZ Catalog run screen wiring (#4506)', () => {
  it('opts in with SWAO_PASS_MARKERS=1 and parses the markers with parseLzRunMarker, never with its own regex', () => {
    expect(screen).toContain("SWAO_PASS_MARKERS: '1'");
    expect(screen).toContain('parseLzRunMarker(l)');
    expect(screen).toContain('parsePostStepLine(l)');
    expect(screen).toContain('postStep }}');
    expect(screen).not.toContain('lz-target-verdict');
  });
});

describe('LZ Catalog frameworks step metadata (#4501)', () => {
  it('a spaced double hyphen in name, description, authority or gate summary never reaches the picker option (the guidance entry reads these fields)', () => {
    const [option] = applyLzCuratedLabels(normaliseLzGateFrameworks([{
      id: 'GDPR_DEMO', name: 'GDPR Demo (11 controls) -- Live-Presentation Subset',
      description: 'Demo subset -- for live use', authority: 'EU -- Demo', gate_summary: 'residency -- EU', controlsCount: 11,
    }]));
    const text = JSON.stringify(option);
    expect(option!.name).toBe('GDPR Demo (11 controls), Live-Presentation Subset');
    expect(option!.description).toBe('Demo subset, for live use');
    expect(text).not.toContain(' -- ');
  });
  it('fields that are absent stay absent', () => {
    expect(normaliseLzGateFrameworks([{ id: 'X' }])).toEqual([{ id: 'X' }]);
  });
});
