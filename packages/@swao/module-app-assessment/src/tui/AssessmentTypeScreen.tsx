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
 * #4255: on ScreenLayout with a numbered SelectInput (Design 126 section 4.1).
 */

import { useMemo, useRef } from 'react';
import { useInput, useApp } from 'ink';
import { ScreenLayout, SelectInput, guidanceOwnsKey, useOptionGuidance, type GuidanceEntry, type KeyHint, type LicenseStateView, type SelectOption } from '@swao/tui-kit';
import { LicenseGuard } from '@swao/core';

/** Canonical assessment types -- mirrors KNOWN_ASSESSMENT_TYPE_ENTRIES in assess-router.ts */
export type AssessmentType = 'application' | 'audit' | 'landing-zone-catalog' | 'landing-zone-live' | 'llm' | 'hybrid' | 'service';

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
  /** #4110: short plain description shown on the menu line (owner wording). */
  detail: string;
  /** #4110: the CLI equivalent; shown in the guidance box, never on the menu line. */
  cli: string;
  what: string;
  type: AssessmentType;
  available: boolean;
  /** Populated on coming-soon entries only; displayed as a guidance popup title. */
  comingSoonTitle?: string;
  /** Populated on coming-soon entries only; each element is one bullet line. */
  comingSoonBody?: string[];
}

// Design 092 s2 (#1419, sprint-114) + Design 103 s3.6 (#3073, sprint-150):
// the menu lists the four REAL assessment surfaces in a fixed order. The former coming-soon placeholder entries
// (audit, hybrid) are removed from this array by operator direction; their
// TYPE values remain canonical in KNOWN_ASSESSMENT_TYPES (router coming-soon
// guard + historical run manifests keep working). The audit engine module
// itself was removed at #1434. `landing-zone-live` (#3568, Design 120) sits
// directly after the catalogue assessment (#3588, Design 120 section 14.2).
export const ASSESSMENT_TYPE_ENTRIES: TypeEntry[] = [
  {
    key: '1',
    label: 'Application Assessment',
    detail: 'static/dynamic on source code',
    cli: 'swao assess --app <id>',
    what: 'Assesses an application from its source code, configuration, and context inputs. ' +
          'Runs up to 14 analysis passes (inventory, SBOM, cryptography, compliance, 7R synthesis, ' +
          'landing-zone readiness, ...) and produces signals, reports, a BI bundle, and an HTML publication.',
    type: 'application',
    available: true,
  },
  {
    key: '2',
    label: 'Service Portfolio Assessment',
    detail: '3rd party, SaaS, COTS service catalog',
    cli: 'swao service',
    what: 'Assesses a portfolio of third-party, SaaS, and COTS applications from an Excel inventory, ' +
          'with no source code required. Scaffolds one workspace app per row, researches CVE and ' +
          'end-of-life status, and produces per-app risk findings and a portfolio summary.',
    type: 'service',
    available: true,
  },
  {
    key: '3',
    label: 'Landing Zone Catalog Assessment',
    detail: 'based on the CSP service catalog',
    cli: 'swao assess --type landing-zone-catalog',
    what: 'Assesses an application against CSP service catalogs (Azure, AWS, GCP) to identify sovereignty ' +
          'fit/gap based on regional data-residency guarantees, compliance certifications, and sovereign service ' +
          'tier availability. Produces a landing-zone readiness report per provider and region.',
    type: 'landing-zone-catalog',
    available: true,
  },
  {
    key: '4',
    label: 'Landing Zone Live Assessment',
    detail: 'based on your live CSP data',
    cli: 'swao assess --type landing-zone-live --lz <lz-id>',
    what: 'Assesses a registered landing zone from its live, read-only API view: regions, services, guardrails, resources, ' +
          'quotas and activity per scope, evaluated against the community frameworks installed in the workspace. ' +
          'Probes read-only access first; writes landing-zones/<lz-id>/wsp/runs/<ts>/ and publishes as the lz-live view. ' +
          'Consultant and Enterprise tiers.',
    type: 'landing-zone-live',
    available: true,
  },
  {
    key: '5',
    label: 'LLM Assessment for SWAO',
    detail: 'compare up to 5 LLMs',
    cli: 'swao assess --type llm',
    what: 'Runs your already-assessed application through 2 to 5 LLM (connector, model) legs and compares the ' +
          'models across performance, cost, completion reliability, structural and content quality, reasoning, ' +
          'and security dimensions. Requires a completed Application Assessment for the selected app. ' +
          'Consultant and Enterprise tiers.',
    type: 'llm',
    available: true,
  },
];

/** #4230: the guidance entry of one assessment type (the CLI line in the guidance only, #4110). */
export function assessmentTypeGuidance(t: TypeEntry): GuidanceEntry {
  return { title: t.label, what: t.what, cli: t.cli };
}

/** #4255: the menu entries; the number keys stay those of the entries. */
export const ASSESSMENT_TYPE_OPTIONS: SelectOption[] = ASSESSMENT_TYPE_ENTRIES.map((t) => ({
  label: t.label, value: t.type, number: t.key, detail: t.detail, guidance: assessmentTypeGuidance(t),
}));

/** #4255 (section 7.9): the menu hint line (was a dashed affordance line); 0 still exits SWAO. */
export const ASSESSMENT_TYPE_KEYS: readonly KeyHint[] = [
  { key: '↑↓', verb: 'select' }, { key: '1 to 9', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' },
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
  const guidanceOpenRef = useRef(false);

  // #4255 / #4230 (Design 126 sections 4.1, 7.8 and 7.10): the menu is the
  // central SelectInput with a guidance entry per type; the box follows the
  // highlighted type and an open box owns Esc, PgUp and PgDn only. Number keys
  // pick a type; 0 exits SWAO as before.
  const { entry, onCursorChange } = useOptionGuidance(assessmentTypeGuidance(ASSESSMENT_TYPE_ENTRIES[0]!));
  useInput((input, key) => {
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape) { if (onBack) { onBack(); } else { exit(); } return; }
    if (input === '0') exit();
  });

  return (
    <ScreenLayout
      header={{ subtitle: 'Run Assessment', version, licenseState: license.state, licenseError: license.error }}
      title={{ title: 'Select Assessment Type', subtitle: 'Choose the assessment surface for this engagement.' }}
      keys={ASSESSMENT_TYPE_KEYS}
      guidance={{ entry, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      <SelectInput
        label="Assessment type"
        options={ASSESSMENT_TYPE_OPTIONS}
        numbered
        visibleCount={ASSESSMENT_TYPE_OPTIONS.length}
        showKeyHints={false}
        onCursorChange={onCursorChange}
        onSelect={(v) => {
          const selected = ASSESSMENT_TYPE_ENTRIES.find((t) => t.type === v);
          if (selected?.available) onSelect(selected.type);
        }}
      />
    </ScreenLayout>
  );
}
