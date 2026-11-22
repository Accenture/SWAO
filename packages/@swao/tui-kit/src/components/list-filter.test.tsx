// #4492 (Design 126 section 7.14): a filterable list shows its filter: the
// accent filter line with a cursor, "Type filter" in the hint row while it is
// active, one Filter section in the guidance box; nothing without a filter.

import { describe, it, expect } from 'vitest';
import { Box } from 'ink';
import { SelectInput } from './SelectInput.js';
import { KeyHints } from './KeyHints.js';
import { GuidanceBox } from './GuidanceBox.js';
import { DEFAULT_FILTER_GUIDANCE, filterLineText, withFilterHint } from './list-filter.js';
import { renderAt } from '../testing/render-at.js';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const OPTIONS = Array.from({ length: 30 }, (_, i) => ({ label: `model-${i + 1}`, value: String(i) }));
const HINTS = [{ key: '↑↓' as const, verb: 'select' as const }, { key: 'Enter' as const, verb: 'next' as const }];

function Screen({ filter }: { filter: boolean }): JSX.Element {
  return (
    <Box flexDirection="column">
      <SelectInput label="Model" options={OPTIONS} filter={filter} itemNoun="models" visibleCount={8} showKeyHints={false} onSelect={() => undefined} />
      <GuidanceBox entry={{ title: 'Model', what: 'Pick the model.' }} initiallyCollapsed={false} />
      <KeyHints hints={HINTS} />
    </Box>
  );
}

describe('filterable list (#4492)', () => {
  it('withFilterHint puts Type filter after the arrows, once', () => {
    expect(withFilterHint(HINTS).map((h) => h.key)).toEqual(['↑↓', 'Type', 'Enter']);
    expect(withFilterHint(withFilterHint(HINTS))).toHaveLength(3);
  });

  it('the filter line: cursor and invitation when empty, query and count while filtering', () => {
    expect(filterLineText('', 30, 30, 'models', 60)).toBe('Filter: ▏ type to narrow 30 models');
    const typed = filterLineText('eu.', 3, 30, 'models', 40);
    expect(typed.startsWith('Filter: eu.▏')).toBe(true);
    expect(typed.endsWith('3 of 30 models')).toBe(true);
  });

  it('an active filterable list adds the hint and the guidance section; without the filter neither', async () => {
    const r = renderAt(<Screen filter />, 100);
    await wait(60);
    const frame = r.lastFrame();
    expect(frame).toContain('Type filter');
    expect(frame).toContain('Filter: ▏ type to narrow 30 models');
    expect(frame).toContain(DEFAULT_FILTER_GUIDANCE.slice(0, 30));
    r.unmount();
    const plain = renderAt(<Screen filter={false} />, 100);
    await wait(60);
    expect(plain.lastFrame()).not.toContain('Type filter');
    expect(plain.lastFrame()).not.toContain('Filter:');
    plain.unmount();
  });
});
