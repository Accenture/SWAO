// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * AssessmentTypeScreen -- assessment-type selector sub-screen.
 *
 * Reached from MainMenu via "3. Run Assessment". Lists the three real
 * assessment surfaces (Design 092 s2, #1419): Application, Landing Zone
 * Catalog, LLM Assessment for SWAO. Placeholder types stay canonical in
 * KNOWN_ASSESSMENT_TYPES but are no longer rendered.
 *
 * ESC returns to the main menu (onBack). 0 exits SWAO entirely.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { GuidanceBox, HeaderView, type LicenseStateView } from '@swao/tui-kit';
import { LicenseGuard } from '@swao/core';

/** Canonical assessment types -- mirrors KNOWN_ASSESSMENT_TYPE_ENTRIES in assess-router.ts */
export type AssessmentType = 'application' | 'audit' | 'landing-zone-catalog' | 'landing-zone-customer' | 'llm' | 'hybrid';

interface AssessmentTypeScreenProps {
  onSelect: (type: AssessmentType) => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
  /** ESC navigates back to the calling screen (main menu) when provided. */
  onBack?: () => void;
}

interface TypeEntry {
  key: string;
  label: string;
  detail: string;
  what: string;
  type: AssessmentType;
  available: boolean;
  /** Populated on coming-soon entries only; displayed as a guidance popup title. */
  comingSoonTitle?: string;
  /** Populated on coming-soon entries only; each element is one bullet line. */
  comingSoonBody?: string[];
}

// Design 092 s2 (#1419, sprint-114): the menu lists the three REAL
// assessment surfaces only. The former coming-soon placeholder entries
// (audit, landing-zone-customer, hybrid) are removed from this array by
// operator direction; their TYPE values remain canonical in
// KNOWN_ASSESSMENT_TYPES (router coming-soon guard + historical run
// manifests keep working). The audit engine module itself was removed
// at #1434.
export const ASSESSMENT_TYPE_ENTRIES: TypeEntry[] = [
  {
    key: '1',
    label: 'Application Assessment',
    detail: 'swao assess - static + LLM pass suite',
    what: 'Assesses an application from its source code, configuration, and context inputs. ' +
          'Runs up to 14 analysis passes (inventory, SBOM, cryptography, compliance, 7R synthesis, ' +
          'landing-zone readiness, ...) and produces signals, reports, a BI bundle, and an HTML publication.',
    type: 'application',
    available: true,
  },
  {
    key: '2',
    label: 'Landing Zone Catalog Assessment',
    detail: 'swao assess --type lz-catalog - CSP service catalog fit/gap',
    what: 'Assesses an application against CSP service catalogs (Azure, AWS, GCP) to identify sovereignty ' +
          'fit/gap based on regional data-residency guarantees, compliance certifications, and sovereign service ' +
          'tier availability. Produces a landing-zone readiness report per provider and region.',
    type: 'landing-zone-catalog',
    available: true,
  },
  {
    key: '3',
    label: 'LLM Assessment for SWAO',
    detail: 'swao assess --type llm - compare up to 5 LLMs on your assessed app',
    what: 'Runs your already-assessed application through 2 to 5 LLM (connector, model) legs and compares the ' +
          'models across performance, cost, completion reliability, structural and content quality, reasoning, ' +
          'and security dimensions. Requires a completed Application Assessment for the selected app. ' +
          'Consultant and Enterprise tiers.',
    type: 'llm',
    available: true,
  },
];

export function AssessmentTypeScreen({ onSelect, version, onBack }: AssessmentTypeScreenProps): JSX.Element {
  const { exit } = useApp();
  const license = useMemo(() => {
    try {
      return { state: LicenseGuard.load().state as LicenseStateView, error: null as string | null };
    } catch (e) {
      return { state: null as LicenseStateView | null, error: (e as Error).message };
    }
  }, []);
  const [idx, setIdx] = useState(0);
  const guidanceOpenRef = useRef(false);
  const { stdout } = useStdout();
  const [termCols, setTermCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTermCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  useInput((input, key) => {
    if (key.upArrow)   { setIdx(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx(i => Math.min(ASSESSMENT_TYPE_ENTRIES.length - 1, i + 1)); return; }
    if (guidanceOpenRef.current) return;
    if (key.escape) { if (onBack) { onBack(); } else { exit(); } return; }
    if (input === '0') { exit(); return; }
    const found = ASSESSMENT_TYPE_ENTRIES.find(t => t.key === input);
    const selected = found ?? (key.return ? ASSESSMENT_TYPE_ENTRIES[idx] : undefined);
    if (selected && selected.available) onSelect(selected.type);
  });

  const active = ASSESSMENT_TYPE_ENTRIES[idx];
  const affordanceHint = `Up/Down or 1 to select  |  Enter to confirm  |  Esc to go back  |  0 to exit`;

  return (
    <Box flexDirection="column">
      <HeaderView subtitle="Run Assessment" version={version} licenseState={license.state} licenseError={license.error} hideLicenseStatus />

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyanBright">Select Assessment Type</Text>
        <Text dimColor>Choose the assessment surface for this engagement.</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        {ASSESSMENT_TYPE_ENTRIES.map((t, i) => {
          const isActive = i === idx;
          // Truncate detail text to prevent row overflow on narrow terminals.
          // Row prefix = cursor(2) + [key](3) + space(1) + label + double-space(2).
          const prefixLen = 2 + 3 + 1 + t.label.length + 2;
          const maxDetail = Math.max(0, termCols - prefixLen);
          const detail = t.detail.length > maxDetail
            ? t.detail.slice(0, Math.max(0, maxDetail - 3)) + '...'
            : t.detail;
          return (
            <Box key={t.key}>
              <Text color={isActive && t.available ? 'cyan' : undefined}>{isActive ? '> ' : '  '}</Text>
              <Text color={t.available ? 'yellow' : 'gray'}>[{t.key}]</Text>
              <Text> </Text>
              <Text bold={isActive && t.available} color={isActive && t.available ? 'cyan' : t.available ? undefined : 'gray'}>
                {t.label}
              </Text>
              <Text color="gray">{'  '}{detail}</Text>
            </Box>
          );
        })}

        {active && (
          <GuidanceBox
            title={active.label}
            what={active.what}
            affordances={[affordanceHint]}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        )}

      </Box>
    </Box>
  );
}
