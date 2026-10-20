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

// Static-analysis gate: pins the complete list of `.complete(` call sites
// in the challenge assess path (Design 092 s3.4, #1708 Q5).
//
// If a new .complete( call is added to module-challenge/src/challenge.ts
// (the private premium module @swao/module-challenge since 0078cb6e),
// this test will fail with the actual line numbers so the developer can
// update EXPECTED_CALL_SITES below and confirm the new call is intentional.
//
// The registry maps each call-site line number to a short label. Line numbers
// are verified against the actual file content to guard against drift.
// To update: change EXPECTED_CALL_SITES to the new set; add a brief label.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #3300: module-challenge left swao/packages in the source-isolation commit
// 0078cb6e and now lives in the private premium tree
// (@swao/module-challenge). Resolve the first location
// that exists; the legacy in-tree path is kept for older checkouts.
const CHALLENGE_SRC_CANDIDATES = [
  resolve(__dirname, '../../../../../swao-premium/packages/@swao/module-challenge/src/challenge.ts'),
  resolve(__dirname, '../../module-challenge/src/challenge.ts'),
];
const CHALLENGE_SRC = CHALLENGE_SRC_CANDIDATES.find((p) => existsSync(p)) ?? CHALLENGE_SRC_CANDIDATES[0]!;
// The premium source is absent from public / Community checkouts; the gate
// then has nothing to pin, so the tests skip with this stated reason.
const CHALLENGE_SRC_ABSENT = !existsSync(CHALLENGE_SRC);
const SKIP_REASON = `module-challenge source absent (premium tree not checked out); looked in: ${CHALLENGE_SRC_CANDIDATES.join(', ')}`;
if (CHALLENGE_SRC_ABSENT) console.warn(`[call-site-registry] skipped: ${SKIP_REASON}`);

// Registry pinned at sprint-119 / #1708; updated sprint-121 / #1587 (+6 lines
// for --connector / --model option registration and CLI override block in challenge.ts).
// Each entry: { line, label }.
// Label is for human readability in test output only; not a semantic key.
const EXPECTED_CALL_SITES: Array<{ line: number; label: string }> = [
  { line: 193, label: 'generateChallengeReport - report generation' },
  { line: 238, label: 'runChallenge - opening turn' },
  { line: 260, label: 'runChallenge - dialogue turns loop' },
  { line: 454, label: 'runChallenge - LZ challenge generate report' },
];

describe('challenge.ts .complete( call-site registry (Design 092 s3.4, #1708 Q5)', () => {
  it.skipIf(CHALLENGE_SRC_ABSENT)('challenge.ts exists and is readable', () => {
    let src: string;
    try {
      src = readFileSync(CHALLENGE_SRC, 'utf-8');
    } catch {
      throw new Error(`challenge.ts not found at: ${CHALLENGE_SRC}`);
    }
    expect(src.length).toBeGreaterThan(0);
  });

  it.skipIf(CHALLENGE_SRC_ABSENT)('pinned .complete( call sites match the registry exactly', () => {
    const src = readFileSync(CHALLENGE_SRC, 'utf-8');
    const lines = src.split('\n');

    // Collect the 1-indexed line numbers of every .complete( occurrence.
    const actualLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('.complete(')) {
        actualLines.push(i + 1);
      }
    }

    const expectedLines = EXPECTED_CALL_SITES.map((e) => e.line).sort((a, b) => a - b);
    const sortedActual = [...actualLines].sort((a, b) => a - b);

    if (JSON.stringify(sortedActual) !== JSON.stringify(expectedLines)) {
      const added = sortedActual.filter((n) => !expectedLines.includes(n));
      const removed = expectedLines.filter((n) => !sortedActual.includes(n));
      const detail = [
        `Actual   : [${sortedActual.join(', ')}]`,
        `Expected : [${expectedLines.join(', ')}]`,
        added.length ? `New lines (need registry entry): ${added.join(', ')}` : '',
        removed.length ? `Removed lines (stale registry): ${removed.join(', ')}` : '',
        'Update EXPECTED_CALL_SITES in call-site-registry.test.ts to match.',
      ].filter(Boolean).join('\n');
      throw new Error(`challenge.ts .complete( call sites changed:\n${detail}`);
    }

    // Verify each registered line still contains .complete( (guards label drift).
    for (const entry of EXPECTED_CALL_SITES) {
      const lineContent = lines[entry.line - 1] ?? '';
      expect(
        lineContent.includes('.complete('),
        `Registry entry "${entry.label}" (line ${entry.line}) no longer contains .complete(: "${lineContent.trim()}"`,
      ).toBe(true);
    }
  });
});
