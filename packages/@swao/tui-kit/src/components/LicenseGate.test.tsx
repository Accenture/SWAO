// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, LicenseGate on the standard (#4257)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// LG-01 below the tier: the heading stays "<Tier> licence required"; no key
//       wording, dash punctuation or CLI command in the box; within the rule
//       at 100 and 80 columns
// LG-02 L opens the Licence screen, Esc goes back (keys unchanged)
// LG-03 at or above the tier the children render and the keys do nothing
// LG-04 LICENSE_GATE_KEYS and licenseGateGuidance (request command in `cli`)

import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { LicenseGate, LICENSE_GATE_KEYS, licenseGateGuidance } from './LicenseGate.js';
import { formatKeyHints } from './KeyHints.js';
import { headerRuleWidth } from './header-width.js';
import { renderAt, widest } from '../testing/render-at.js';

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);

describe('LicenseGate (#4257)', () => {
  for (const columns of [100, 80]) {
    it(`LG-01 the gate box at ${columns} columns`, async () => {
      const r = renderAt(
        <LicenseGate required="consultant" state={{ tier: 'community', expiredTier: 'consultant', exp: '2026-10-01' }} feature="Sample feature" onOpenLicenseScreen={() => {}} onBack={() => {}}>
          <Text>CHILD</Text>
        </LicenseGate>,
        columns,
      );
      await settle();
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      const text = lines.join(NL);
      expect(text).toContain('Consultant licence required');
      expect(text).toContain('expired on 2026-10-01');
      expect(text).not.toContain('CHILD');
      expect(text).not.toMatch(/\s--\s/);
      expect(text).not.toMatch(/Press |swao license/);
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  it('LG-02 L opens the Licence screen, Esc goes back', async () => {
    const onOpen = vi.fn();
    const onBack = vi.fn();
    const r = renderAt(
      <LicenseGate required="enterprise" state={{ tier: 'consultant' }} feature="X" onOpenLicenseScreen={onOpen} onBack={onBack}><></></LicenseGate>,
      100,
    );
    await settle();
    r.stdin.write('l');
    await settle();
    r.stdin.write(String.fromCharCode(27));
    await settle();
    r.unmount();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('LG-03 at the tier the children render and the keys do nothing', async () => {
    const onBack = vi.fn();
    const r = renderAt(
      <LicenseGate required="consultant" state={{ tier: 'enterprise' }} feature="X" onOpenLicenseScreen={() => {}} onBack={onBack}><Text>CHILD</Text></LicenseGate>,
      100,
    );
    await settle();
    expect(r.lines().join(NL)).toContain('CHILD');
    r.stdin.write(String.fromCharCode(27));
    await settle();
    r.unmount();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('LG-04 the host keys and guidance', () => {
    expect(formatKeyHints(LICENSE_GATE_KEYS)).toBe('L open licence   Esc back');
    const g = licenseGateGuidance('enterprise', 'Generate Terraform Modules');
    expect(g.title).toBe('Enterprise licence required');
    expect(g.cli).toBe('swao license request --tier enterprise');
    expect(g.what).not.toMatch(/\s--\s/);
  });
});
