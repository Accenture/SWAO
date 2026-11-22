// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4190 SET-01 / #4194 SET-05 (Design 125 section 5.4, Q-01): the Landing
// Zone Catalog Assessment branch, short by owner decision: Catalogues (10),
// Targets (20), Refresh (30). Stores assessment.landing_zone.targets (read
// back by setup/defaults.ts readLzCatalogDefaults, section 5.7). Health check
// and Ready are added by the engine.
//
// Design 125 section 5.7 (owner rule 2026-11-08) brings back the target
// choice that ADR-0067 removed from the linear wizard (#3378): the branch
// writes the workspace targets and the LZ Catalog Assessment preselects them.
// The picker follows the removed LzTargetsStep (3e77d108), with the layout
// rules of section 9: no own title or step bar, one GuidanceBox, no CLI
// syntax, no line wider than the header rule.
//
// #4296 (Design 126 sections 6 and 9): every step hands title, input kind and
// guidance to the wizard frame (SetupStepFrame). Provider names come from the
// central map of @swao/core; the Catalogues row is `OTC  T Cloud Public
// [ok] no quality findings` and origin and date sit in the guidance box of
// the highlighted catalogue.

import { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { PickerRow, StatusRow, detailLines, fitToWidth, pagedListWindow, statusLabelWidth, statusRowHeight, tone, useHeaderWidth, useListBudget, type GuidanceEntry, type StatusLevel } from '@swao/tui-kit';
import { SetupStepFrame } from '../setup-frame.js';
import { SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER, providerColumns, providerLabel } from '@swao/core';
import { LZ_CATALOGUE_MAX_AGE_DAYS, type LzGeographyRegion } from '@swao/module-landing-zone';
import {
  readWorkspaceLzTargets,
  writeLzTargetsToYaml,
} from '../../tui/screens/wizard/lz-targets-helpers.js';
import { groupLzRegions, regionRowText, regionsForConfigured, rowRegions, toggleRow, type LzRegionRow } from '../../tui/screens/wizard/lz-region-groups.js';
import type { SetupBranchModule, SetupCheckItem, SetupHealthResult, SetupStepProps } from '../types.js';
import {
  checkLzCatalogues,
  checkLzFreshness,
  checkLzTargetItems,
  defaultLzRegionLoader,
  listLzCatalogueRows,
  type LzCatalogSources,
  type LzCatalogueOrigin,
  type LzCatalogueRow,
  type LzRegionLoader,
} from './lz-catalog-checks.js';
import { logSetupStepComplete } from '../step-events.js';

// #4348 / #4254 (run 9): every list of the branch (catalogues, providers,
// regions; Azure has more than 80 regions) pages through the shared paged-list
// window of tui-kit (pagedListWindow), not a constant of its own; the rows are
// central StatusRows and PickerRows (no local cursor marker).

function logStep(step: string, message: string, context: Record<string, unknown>): void {
  logSetupStepComplete(step, message, context); // #4263: dropped when the wizard cancels the step
}


// ---------------------------------------------------------------- Catalogues (10)

/** #4296: the quality state of a catalogue as a status level and a short text (Design 126 section 6). */
export function catalogueStatus(r: LzCatalogueRow, maxAgeDays = LZ_CATALOGUE_MAX_AGE_DAYS): { level: StatusLevel; text: string } {
  if (r.error) return { level: 'fail', text: 'meta block unreadable, not usable' };
  const rules = r.qualityRules.length > 0 ? `: ${r.qualityRules.join(', ')}` : '';
  if (r.qualityErrors > 0) return { level: 'fail', text: `${r.qualityErrors} error(s), ${r.qualityWarnings} warning(s)${rules}` };
  if (r.qualityWarnings > 0) return { level: 'warn', text: `${r.qualityWarnings} warning(s)${rules}` };
  if (r.stale) return { level: 'warn', text: r.ageDays === undefined ? 'no update date' : `older than ${maxAgeDays} days` };
  return { level: 'ok', text: 'no quality findings' };
}

const ORIGIN_WORDS: Readonly<Record<LzCatalogueOrigin, string>> = {
  'bundled': 'bundled, shipped with SWAO and maintained by the SWAO team.',
  'workspace copy': 'workspace copy in the workspace catalogue folder (wsp/inputs/catalogs/lz-catalogues), for example after an update; it wins over the bundled one.',
  'user-defined': 'user-defined, a catalogue for a provider SWAO does not ship or one marked operator-declared, such as a custom or on-premises landing zone.',
};

/**
 * #4296 / #4230: the guidance entry of the highlighted catalogue: provider
 * name, origin in words, last update and age, confidence, regions, quality
 * rules and how to update it. Origin and date live here, not in the row.
 */
export function catalogueGuidance(r: LzCatalogueRow | undefined, canUpdate: boolean, maxAgeDays = LZ_CATALOGUE_MAX_AGE_DAYS): GuidanceEntry {
  const title = 'Catalogues';
  if (!r) {
    return {
      title,
      what: 'No catalogue found. Each provider catalogue lists regions, services and sovereignty facts; the Landing Zone Catalog Assessment fits your targets against them.',
      sections: [{ label: 'Update', text: 'Tools, Update LZ Catalogue in the main menu.' }],
    };
  }
  const name = providerLabel(r.provider, 'full', r.name);
  if (r.error) {
    return {
      title,
      what: `The ${name} catalogue file cannot be read, so the assessment cannot use it.`,
      sections: [
        { label: 'Provider', text: providerLabel(r.provider, 'pair', r.name) },
        { label: 'Origin', text: ORIGIN_WORDS[r.origin] },
        { label: 'Problem', text: r.error },
        { label: 'Fix', text: r.origin === 'bundled' ? 'Reinstall SWAO, or update the catalogue (Tools, Update LZ Catalogue).' : 'Correct the meta block of the file, or remove the file to fall back to the bundled catalogue.' },
      ],
    };
  }
  const age = r.ageDays !== undefined
    ? `${r.lastUpdated}, ${r.ageDays} day(s) ago${r.stale ? `, older than ${maxAgeDays} days` : ''}.`
    : `${r.lastUpdated ? `${r.lastUpdated}, not a readable date` : 'no update date'}.`;
  const st = catalogueStatus(r, maxAgeDays);
  const update = r.origin === 'user-defined'
    ? 'maintained by hand: update its last_updated date when you review it.'
    : canUpdate
      ? 'Tools, Update LZ Catalogue in the main menu fetches the provider data and writes a workspace copy.'
      : 'Tools, Update LZ Catalogue needs a Consultant or Enterprise licence.';
  return {
    title,
    what: `${name}: the catalogue lists regions, services and sovereignty facts. The Landing Zone Catalog Assessment fits your targets against it.`,
    sections: [
      { label: 'Provider', text: providerLabel(r.provider, 'pair', r.name) },
      { label: 'Origin', text: ORIGIN_WORDS[r.origin] },
      { label: 'Last update', text: age },
      ...(r.confidence ? [{ label: 'Confidence', text: r.confidence }] : []),
      ...(r.regionsCount !== undefined ? [{ label: 'Regions', text: String(r.regionsCount) }] : []),
      { label: 'Quality', text: st.level === 'ok' ? 'no findings of the catalogue quality rules (schema, sovereignty facts, sources, age).' : `${st.text}. The health check lists every finding.` },
      { label: 'Update', text: update },
    ],
  };
}

export interface LzCatalogCataloguesStepProps extends SetupStepProps {
  /** Injectable for tests. */
  sources?: LzCatalogSources;
}

export function LzCatalogCataloguesStep({ ctx, onNext, sources }: LzCatalogCataloguesStepProps) {
  const width = useHeaderWidth();
  const rows = useMemo(() => listLzCatalogueRows(ctx.workspaceRoot, sources), []); // once per mount
  const [cursor, setCursor] = useState(0);
  const maxAgeDays = sources?.maxAgeDays ?? LZ_CATALOGUE_MAX_AGE_DAYS;

  const finish = (): void => {
    const withFindings = rows.filter((r) => r.error || r.qualityErrors + r.qualityWarnings > 0).length;
    logStep('lz-catalog.catalogues', 'LZ catalogues reviewed', { catalogues: rows.length, with_findings: withFindings });
    onNext({ status: 'kept', summary: `${rows.length} LZ catalogue(s), ${withFindings} with findings` });
  };

  useInput((_input, key) => {
    // #4341: Enter continues; Esc belongs to the wizard (abort).
    if (key.return) { finish(); return; }
    if (rows.length === 0) return;
    if (key.upArrow) setCursor((c) => (c - 1 + rows.length) % rows.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % rows.length);
  });

  // #4348: the window comes from the shared height rule (frame minus the measured
  // chrome), each StatusRow counted with its wrapped height; the "(n of m)"
  // line takes one row. Before the first measurement the shared fallback applies.
  const listRef = useRef<DOMElement>(null);
  const budget = useListBudget(listRef);
  const labels = rows.map((r) => providerColumns(r.provider, r.name));
  const labelWidth = statusLabelWidth(labels, width, { min: 8 });
  const statuses = rows.map((r) => catalogueStatus(r, maxAgeDays));
  const heights = rows.map((_, i) => statusRowHeight({ level: statuses[i]!.level, label: labels[i]!, summary: statuses[i]!.text, labelWidth }, width));
  const win = pagedListWindow(heights, cursor, budget === undefined ? undefined : budget - 1);
  const start = win.start;
  return (
    <SetupStepFrame
      title="Catalogues"
      subtitle="Landing zone catalogues the assessment compares against."
      kind="picker"
      guidance={catalogueGuidance(rows[cursor], ctx.tier !== 'community', maxAgeDays)}
    >
      <Box ref={listRef} flexDirection="column" width={width}>
        {rows.length === 0 && <Text {...tone('warning')}>{fitToWidth('No catalogue found. Update the LZ catalogues from the Tools menu.', width)}</Text>}
        {rows.slice(start, win.end).map((r, i) => {
          const idx = start + i;
          // The text wraps under its own column (no ellipsis on operator text, Design 126 section 10).
          return <StatusRow key={r.provider} level={statuses[idx]!.level} label={labels[idx]!} summary={statuses[idx]!.text} selected={idx === cursor} labelWidth={labelWidth} textTone="text" />;
        })}
        {win.end - start < rows.length && <Text {...tone('muted')}>{`  (${cursor + 1} of ${rows.length})`}</Text>}
      </Box>
    </SetupStepFrame>
  );
}

// ---------------------------------------------------------------- Targets (20)

/** #4296: `otc:germany` reads `OTC, T Cloud Public: germany`; the stored target keeps the id. */
export function targetLabel(target: string): string {
  const at = target.indexOf(':');
  return at > 0 ? `${providerLabel(target.slice(0, at))}: ${target.slice(at + 1)}` : providerLabel(target);
}

export interface LzCatalogTargetsStepProps extends SetupStepProps {
  /** Injectable for tests; default: the catalogue providers of the workspace. */
  listProviders?: (workspaceRoot: string) => string[];
  /** Injectable for tests; default: the layered catalogue resolver. */
  loadRegions?: LzRegionLoader;
  /** Injectable for tests; default: the workspace .swao.yml writer. */
  writeTargets?: (workspaceRoot: string, targets: string[]) => boolean;
  /** Injectable for tests; default: the workspace .swao.yml reader. */
  readTargets?: (workspaceRoot: string) => string[];
}

const defaultListProviders = (workspaceRoot: string): string[] =>
  listLzCatalogueRows(workspaceRoot, { quality: () => new Map() }).filter((r) => !r.error).map((r) => r.provider);

const TARGETS_WHAT = 'The providers and regions the Landing Zone Catalog Assessment compares. They are saved in the workspace .swao.yml and preselected in the assessment, where you can still change them for a run.';
const TARGETS_SAVED_AS = { label: 'Saved as', text: 'assessment.landing_zone.targets in the workspace .swao.yml, with the provider id as the key (otc:germany). An app .swao.yml with its own targets wins for that app.' };
const TARGETS_CHOICE = { label: 'Choice', text: 'Enter without a tick takes the highlighted entry.' };

/** #4230: the guidance of one highlighted provider of the Targets list. */
export function targetProviderGuidance(provider: string): GuidanceEntry {
  return {
    title: providerLabel(provider, 'full'),
    what: `Ticks ${providerLabel(provider, 'full')} for the comparison. After the provider list you pick its regions, grouped by country.`,
    sections: [{ label: 'Provider id', text: provider }, TARGETS_CHOICE, TARGETS_SAVED_AS],
  };
}

/** #4230: the guidance of the last entry of the provider list (keep the targets or skip). */
export function targetKeepGuidance(keepLabel: string, existing: readonly string[]): GuidanceEntry {
  return existing.length > 0
    ? { title: keepLabel, what: 'Keeps the targets that are set now and writes nothing.', sections: [{ label: 'Set now', text: existing.join(', ') }, TARGETS_SAVED_AS] }
    : { title: keepLabel, what: 'Goes on without targets; the Landing Zone Catalog Assessment asks for them when it starts.', sections: [TARGETS_SAVED_AS] };
}

/** #4230 / #4494: the guidance of one highlighted row of the grouped region list: a region, or a country or area heading. */
export function targetOptionGuidance(provider: string, row: LzRegionRow): GuidanceEntry {
  const name = providerLabel(provider, 'full');
  switch (row.kind) {
    case 'region':
      return {
        title: row.label,
        what: `The region ${row.region} of ${name}. Choose it when the workload must run in this region; the fit uses its services and sovereignty facts.`,
        sections: [{ label: 'Saved as', text: `${provider}:${row.region}` }, TARGETS_CHOICE],
      };
    case 'country':
    case 'area': {
      const ids = rowRegions(row);
      return {
        title: row.label,
        what: `Space ticks all ${ids.length} region${ids.length === 1 ? '' : 's'} of ${name} in ${row.label}, or unticks them when all are ticked. The targets are saved as regions.`,
        sections: [{ label: 'Regions', text: ids.join(', ') }, TARGETS_CHOICE],
      };
    }
    default: {
      const never: never = row;
      throw new Error(`unknown region row: ${String(never)}`);
    }
  }
}

type TargetsPhase =
  | { kind: 'providers' }
  | { kind: 'regions'; index: number }
  | { kind: 'done'; targets: string[]; written: boolean };

export function LzCatalogTargetsStep({
  ctx,
  onNext,
  listProviders = defaultListProviders,
  loadRegions = defaultLzRegionLoader,
  writeTargets = writeLzTargetsToYaml,
  readTargets = readWorkspaceLzTargets,
}: LzCatalogTargetsStepProps) {
  const ws = ctx.workspaceRoot;
  const width = useHeaderWidth();
  // #4348: the provider and region lists take the rows the frame leaves.
  const listRef = useRef<DOMElement>(null);
  const listBudget = useListBudget(listRef);
  const providers = useMemo(() => { try { return listProviders(ws); } catch { return []; } }, []); // once per mount
  const existing = useMemo(() => { try { return readTargets(ws); } catch { return []; } }, []);
  const existingProviders = useMemo(() => new Set(existing.map((t) => t.split(':')[0]!)), [existing]);

  const [phase, setPhase] = useState<TargetsPhase>({ kind: 'providers' });
  // #4494 (Design 126 section 4): with stored targets the cursor starts on the keep entry.
  const [cursor, setCursor] = useState(() => (existing.length > 0 ? providers.length : 0));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(providers.filter((p) => existingProviders.has(p))));
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const selectedProviders = providers.filter((p) => picked.has(p));
  const currentProvider = phase.kind === 'regions' ? selectedProviders[phase.index] : undefined;
  const regionsFor = (provider: string): LzGeographyRegion[] => {
    try { return loadRegions(provider, ws) as LzGeographyRegion[]; } catch { return []; }
  };
  // #4494: each region once, under its country heading (and the area heading over the countries).
  const options = useMemo(() => (currentProvider ? groupLzRegions(regionsFor(currentProvider)) : []), [currentProvider]);

  /** #4494: a stored geography (otc:germany) reads as the region a run resolves it to. */
  const preselect = (provider: string): Set<string> => {
    const configured = existing.filter((t) => t.startsWith(`${provider}:`)).map((t) => t.slice(provider.length + 1));
    return new Set(regionsForConfigured(configured, regionsFor(provider)));
  };

  const keep = (): void => {
    logStep('lz-catalog.targets', 'LZ targets kept', { targets: existing.length });
    onNext(existing.length > 0 ? { status: 'kept', summary: `LZ targets: ${existing.join(', ')}` } : { status: 'skipped' });
  };

  const enterProvider = (index: number, list: string[], next: Record<string, string[]>): void => {
    const provider = list[index];
    if (provider === undefined) {
      const targets = list.flatMap((p) => (next[p] ?? []).map((v) => `${p}:${v}`));
      if (targets.length === 0) { keep(); return; }
      const written = (() => { try { return writeTargets(ws, targets); } catch { return false; } })();
      setPhase({ kind: 'done', targets, written });
      return;
    }
    const ticked = preselect(provider);
    setToggled(ticked);
    // The cursor starts on the first ticked region, else on the first row.
    const rows = groupLzRegions(regionsFor(provider));
    setCursor(Math.max(0, rows.findIndex((r) => r.kind === 'region' && ticked.has(r.region))));
    setPhase({ kind: 'regions', index });
  };

  // #4341 (Design 126 sections 7.4 and 7.7): Esc belongs to the wizard (abort);
  // keeping the targets set now is the last visible entry of the provider list.
  const keepIndex = providers.length;
  const keepLabel = existing.length > 0 ? 'Keep the current targets and continue' : 'Skip this step';

  useInput((input, key) => {
    if (phase.kind === 'done') {
      if (key.return) {
        logStep('lz-catalog.targets', 'LZ targets set', { targets: phase.targets.length, written: phase.written });
        onNext(phase.written ? { status: 'done', summary: `LZ targets: ${phase.targets.join(', ')}` } : { status: 'skipped' });
      }
      return;
    }
    if (phase.kind === 'providers') {
      const rows = providers.length + 1;
      if (key.upArrow) setCursor((c) => (c - 1 + rows) % rows);
      else if (key.downArrow) setCursor((c) => (c + 1) % rows);
      else if (cursor === keepIndex) { if (key.return) keep(); }
      else if (input === ' ') {
        const p = providers[cursor]!;
        setPicked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
      } else if (key.return) {
        // Enter without a ticked provider picks the highlighted one.
        const set = picked.size > 0 ? picked : new Set([providers[cursor]!]);
        if (picked.size === 0) setPicked(set);
        const list = providers.filter((p) => set.has(p));
        enterProvider(0, list, chosen);
      }
      return;
    }
    const rows = options.length;
    if (key.upArrow && rows > 0) setCursor((c) => (c - 1 + rows) % rows);
    else if (key.downArrow && rows > 0) setCursor((c) => (c + 1) % rows);
    else if (input === ' ' && rows > 0) {
      const row = options[cursor]!;
      setToggled((s) => toggleRow(row, s));
    } else if (key.return) {
      // Regions only, in list order; Enter without a tick takes the highlighted row (a heading: its regions).
      const ticked = options.flatMap((o) => (o.kind === 'region' && toggled.has(o.region) ? [o.region] : []));
      const values = ticked.length > 0 ? ticked : rows > 0 ? [...rowRegions(options[cursor]!)] : [];
      const next = { ...chosen, [currentProvider!]: values };
      setChosen(next);
      enterProvider(phase.index + 1, selectedProviders, next);
    }
  });

  // #4230: the box shows the entry of the highlighted provider, keep entry, geography or region.
  const highlightedOption = phase.kind === 'regions' ? options[cursor] : undefined;
  const guidance: GuidanceEntry = phase.kind === 'providers'
    ? (cursor === keepIndex ? targetKeepGuidance(keepLabel, existing) : providers[cursor] ? targetProviderGuidance(providers[cursor]!) : { title: 'Targets', what: TARGETS_WHAT, sections: [TARGETS_SAVED_AS] })
    : currentProvider && highlightedOption
      ? targetOptionGuidance(currentProvider, highlightedOption)
      : { title: 'Targets', what: TARGETS_WHAT, sections: [TARGETS_SAVED_AS] };

  if (phase.kind === 'done') {
    return (
      <SetupStepFrame
        title="Targets"
        subtitle={phase.written ? 'Targets saved.' : 'Targets not saved.'}
        kind="confirm"
        back={() => { setCursor(0); setPhase({ kind: 'providers' }); }}
        guidance={{
          title: 'Targets saved',
          what: phase.written
            ? 'The Landing Zone Catalog Assessment preselects these targets.'
            : 'The workspace .swao.yml could not be written, so the targets were not saved. Check that the file is writable, then choose the targets again.',
          sections: [{ label: 'Saved as', text: 'assessment.landing_zone.targets in the workspace .swao.yml; the provider id stays the key.' }],
        }}
      >
        <Box flexDirection="column" width={width}>
          {phase.written ? (
            <>
              <Text {...tone('ok')}>Targets saved in the workspace .swao.yml:</Text>
              {phase.targets.map((t) => <Text key={t}>{fitToWidth(`  ${targetLabel(t)}`, width)}</Text>)}
            </>
          ) : (
            <Text {...tone('warning')}>{fitToWidth('Could not write the workspace .swao.yml; the targets were not saved.', width)}</Text>
          )}
        </Box>
      </SetupStepFrame>
    );
  }

  if (phase.kind === 'providers') {
    const pwin = pagedListWindow(providers.map(() => 1), Math.min(cursor, Math.max(0, providers.length - 1)), listBudget);
    return (
      <SetupStepFrame title="Targets" subtitle="The providers and regions the assessment compares." kind="multiSelect" guidance={guidance}>
        <Box flexDirection="column" width={width}>
          {providers.length === 0 ? (
            <Text {...tone('warning')}>{fitToWidth('No usable catalogue found; targets can be set once a catalogue is available.', width)}</Text>
          ) : (
            <Text>Which providers should the assessment compare?</Text>
          )}
          {existing.length > 0 && <Text {...tone('muted')}>{fitToWidth(`Set now: ${existing.map(targetLabel).join('; ')}`, width)}</Text>}
          <Box ref={listRef} flexDirection="column" marginTop={1}>
            {pwin.above > 0 && <Text {...tone('muted')}>{`  ↑ ${pwin.above} more`}</Text>}
            {providers.slice(pwin.start, pwin.end).map((p, i) => {
              const idx = pwin.start + i;
              return (
                <PickerRow key={p} selected={idx === cursor} indent={false}>
                  <Text {...(idx === cursor ? tone('selection') : {})}>{fitToWidth(`${picked.has(p) ? '[x]' : '[ ]'} ${providerColumns(p)}`, Math.max(1, width - 2))}</Text>
                </PickerRow>
              );
            })}
            {pwin.below > 0 && <Text {...tone('muted')}>{`  ↓ ${pwin.below} more`}</Text>}
          </Box>
          <PickerRow selected={cursor === keepIndex} indent={false} wrap="wrap">
            <Text {...(cursor === keepIndex ? tone('selection') : {})}>{keepLabel}</Text>
          </PickerRow>
        </Box>
      </SetupStepFrame>
    );
  }

  const rwin = pagedListWindow(options.map(() => 1), cursor, listBudget === undefined ? undefined : listBudget - 1);
  return (
    <SetupStepFrame
      title="Targets"
      subtitle="The providers and regions the assessment compares."
      kind="multiSelect"
      back={() => { setCursor(0); setPhase({ kind: 'providers' }); }}
      guidance={guidance}
    >
      <Box flexDirection="column" width={width}>
        <Text>{fitToWidth(`Provider ${phase.index + 1} of ${selectedProviders.length}: ${currentProvider ? providerLabel(currentProvider) : ''}. Pick regions; Space on a country ticks all its regions.`, width)}</Text>
        <Box ref={listRef} flexDirection="column" marginTop={1}>
          {options.length === 0 && <Text {...tone('warning')}>No regions in this catalogue; this provider is skipped.</Text>}
          {options.slice(rwin.start, rwin.end).map((o, i) => {
            const idx = rwin.start + i;
            return (
              <PickerRow key={o.key} selected={idx === cursor} indent={false}>
                <Text {...(idx === cursor ? tone('selection') : o.kind === 'region' ? {} : tone('brand', { bold: false }))}>{fitToWidth(regionRowText(o, toggled), Math.max(1, width - 2))}</Text>
              </PickerRow>
            );
          })}
          {rwin.end - rwin.start < options.length && <Text {...tone('muted')}>{`  (${cursor + 1} of ${options.length})`}</Text>}
        </Box>
      </Box>
    </SetupStepFrame>
  );
}

// ---------------------------------------------------------------- Refresh (30)

export interface LzCatalogRefreshStepProps extends SetupStepProps {
  /** Injectable for tests. */
  sources?: LzCatalogSources;
}

export function LzCatalogRefreshStep({ ctx, onNext, sources }: LzCatalogRefreshStepProps) {
  const width = useHeaderWidth();
  // #4348: the stale list shows the rows the frame leaves, then "and n more".
  const listRef = useRef<DOMElement>(null);
  const listBudget = useListBudget(listRef);
  const maxAgeDays = sources?.maxAgeDays ?? LZ_CATALOGUE_MAX_AGE_DAYS;
  const stale = useMemo(
    () => listLzCatalogueRows(ctx.workspaceRoot, { ...sources, quality: () => new Map() }).filter((r) => !r.error && r.stale),
    [],
  );
  const canUpdate = ctx.tier !== 'community';
  // #4213 (Design 126 section 8 rules 5 and 6): the provider on the row, origin and
  // date beside it, wrapped under their column or under the provider, never cut.
  const staleRows = stale.map((r) => {
    const name = `  ${providerLabel(r.provider, 'pair', r.name)}`;
    const detail = detailLines(`${r.origin}  ${r.ageDays !== undefined ? `${r.lastUpdated} (${r.ageDays} days)` : 'no update date'}`, width, name.length, 2);
    return { key: r.provider, name, detail, height: 1 + detail.rest.length };
  });
  const staleWin = pagedListWindow(staleRows.map((r) => r.height), 0, listBudget);

  useInput((_input, key) => {
    // #4341: Enter continues; Esc belongs to the wizard (abort).
    if (key.return) {
      logStep('lz-catalog.refresh', 'LZ catalogue freshness checked', { stale: stale.length });
      onNext(stale.length > 0
        ? { status: 'skipped', summary: `${stale.length} LZ catalogue(s) older than ${maxAgeDays} days` }
        : { status: 'kept', summary: `LZ catalogues within ${maxAgeDays} days` });
    }
  });

  return (
    <SetupStepFrame
      title="Refresh"
      subtitle="Catalogues older than the freshness threshold."
      kind="confirm"
      guidance={{
        title: 'Refresh',
        what: `Prices, regions and certifications change. A catalogue older than ${maxAgeDays} days is flagged so the fit does not rest on outdated facts.`,
        sections: [
          { label: 'Update', text: 'Update LZ Catalogue in the Tools menu fetches the provider data and writes a workspace copy; the bundled catalogue is not changed.' },
          { label: 'User-defined', text: 'A user-defined catalogue is maintained by hand: update its last_updated date when you review it.' },
        ],
      }}
    >
      <Box flexDirection="column" width={width}>
        {stale.length === 0 ? (
          <Text {...tone('ok')}>{fitToWidth(`Every catalogue was updated within the last ${maxAgeDays} days.`, width)}</Text>
        ) : (
          <>
            <Text {...tone('warning')}>{fitToWidth(`Older than ${maxAgeDays} days:`, width)}</Text>
            <Box ref={listRef} flexDirection="column">
              {staleRows.slice(0, staleWin.end).map((r) => (
                <Box key={r.key} flexDirection="column">
                  <Text>{r.name}{r.detail.first !== '' ? `  ${r.detail.first}` : ''}</Text>
                  {r.detail.rest.map((l, li) => <Text key={li}>{`${' '.repeat(r.detail.restIndent)}${l}`}</Text>)}
                </Box>
              ))}
              {staleWin.below > 0 && <Text {...tone('muted')}>{`  and ${staleWin.below} more`}</Text>}
            </Box>
            <Box marginTop={1}>
              <Text wrap="wrap">{canUpdate
                ? 'Update them after setup: main menu, Tools, Update LZ Catalogue.'
                : 'Updating catalogues needs a Consultant or Enterprise licence (Tools, Update LZ Catalogue).'}</Text>
            </Box>
          </>
        )}
      </Box>
    </SetupStepFrame>
  );
}

// ---------------------------------------------------------------- Ready

/** Ready lines (Design 125 section 5.4): targets set, catalogues valid, then the health result. */
export function lzCatalogReadySummary(workspaceRoot: string, health: SetupHealthResult | undefined, sources: LzCatalogSources = {}): SetupCheckItem[] {
  const catalogues = checkLzCatalogues(workspaceRoot, sources);
  const unusable = catalogues.filter((c) => c.state === 'missing');
  const items: SetupCheckItem[] = [
    ...checkLzTargetItems(workspaceRoot, sources),
    unusable.length === 0
      ? { label: 'LZ catalogues', state: 'ok', detail: `${catalogues.length} usable` }
      : { label: 'LZ catalogues', state: 'warn', detail: `${unusable.length} of ${catalogues.length} with errors: ${unusable.map((c) => c.label.replace(/^Catalogue /, '')).join(', ')}` },
    ...checkLzFreshness(workspaceRoot, sources),
  ];
  if (health) {
    items.push(health.failCount > 0
      ? { label: 'Health check', state: 'missing', detail: `failed: ${health.failedProbes.join(', ')}` }
      : { label: 'Health check', state: 'ok', detail: health.warnCount > 0 ? `passed with warnings: ${health.warnedProbes.join(', ')}` : 'passed' });
  }
  const targetsOk = items[0]?.state === 'ok';
  items.push(targetsOk && (!health || health.failCount === 0)
    ? { label: 'Run', state: 'ok', detail: 'a Landing Zone Catalog Assessment can start' }
    : { label: 'Run', state: 'info', detail: 'choose targets, or pick them when the assessment starts' });
  return items;
}

export const lzCatalogBranch: SetupBranchModule = {
  branch: {
    type: 'lz-catalog',
    label: SETUP_ASSESSMENT_TYPE_LABELS['lz-catalog'],
    description: 'Landing zone catalogues, targets and freshness',
    minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER['lz-catalog'],
    readySummary: (ws, health) => lzCatalogReadySummary(ws, health),
  },
  steps: [
    { id: 'lz-catalog.catalogues', label: 'Catalogues', assessmentType: 'lz-catalog', order: 10, guidance: 'Catalogues per provider: origin, last update and quality findings.', component: LzCatalogCataloguesStep, check: (ws) => checkLzCatalogues(ws) },
    { id: 'lz-catalog.targets', label: 'Targets', assessmentType: 'lz-catalog', order: 20, guidance: 'The providers and regions the assessment compares.', component: LzCatalogTargetsStep, check: (ws) => checkLzTargetItems(ws) },
    { id: 'lz-catalog.refresh', label: 'Refresh', assessmentType: 'lz-catalog', order: 30, guidance: 'Catalogues older than the freshness threshold.', component: LzCatalogRefreshStep, check: (ws) => checkLzFreshness(ws) },
  ],
};
