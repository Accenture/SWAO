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

// -- Step: Landing zone targets (#3306) -------------------------------------
//
// TUI counterpart of `--lz-cat-targets` / assessment.landing_zone.targets:
// pick catalogue providers (listLzCatalogueProviders, the single discovery of
// Design 056 E-24), then per provider one or more geographies or regions
// (shared geography model). The choice is written to the workspace .swao.yml
// and used by every application run's inline LZ catalogue fit and by the
// Landing Zone Catalog Assessment, unless an app .swao.yml or a CLI flag
// overrides it. Skipping writes nothing.

import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { listLzCatalogueProviders, resolveProviderCatalogue, type LzGeographyRegion } from '@swao/module-landing-zone';
import {
  buildLzTargetOptions,
  optionMatches,
  readWorkspaceLzTargets,
  writeLzTargetsToYaml,
  type LzTargetOption,
} from '../lz-targets-helpers.js';

/** Rows of a list shown at once (Azure has more than 80 regions). */
const WINDOW = 10;

export interface LzTargetsStepProps {
  workDir: string;
  stepNumber?: number;
  /** Called with the written targets, or [] when the step was skipped. */
  onNext: (targets: string[]) => void;
  /** Injectable for tests; defaults to the catalogue discovery. */
  listProviders?: (workDir: string) => string[];
  /** Injectable for tests; defaults to the layered catalogue resolver. */
  loadRegions?: (provider: string, workDir: string) => LzGeographyRegion[];
  /** Injectable for tests; defaults to the workspace .swao.yml writer. */
  writeTargets?: (workDir: string, targets: string[]) => boolean;
  /** Injectable for tests; defaults to the workspace .swao.yml reader. */
  readTargets?: (workDir: string) => string[];
}

const defaultListProviders = (workDir: string): string[] => listLzCatalogueProviders(workDir);
const defaultLoadRegions = (provider: string, workDir: string): LzGeographyRegion[] =>
  resolveProviderCatalogue(provider, workDir).catalogue.regions;

function windowStart(cursor: number, total: number): number {
  if (total <= WINDOW) return 0;
  return Math.min(Math.max(0, cursor - Math.floor(WINDOW / 2)), total - WINDOW);
}

type Phase =
  | { kind: 'providers' }
  | { kind: 'regions'; index: number }
  | { kind: 'done'; targets: string[]; written: boolean };

export function LzTargetsStep({
  workDir,
  stepNumber = 4,
  onNext,
  listProviders = defaultListProviders,
  loadRegions = defaultLoadRegions,
  writeTargets = writeLzTargetsToYaml,
  readTargets = readWorkspaceLzTargets,
}: LzTargetsStepProps) {
  const providers = useMemo(() => {
    try { return listProviders(workDir); } catch { return []; }
  }, []); // once per mount
  const existing = useMemo(() => {
    try { return readTargets(workDir); } catch { return []; }
  }, []); // once per mount
  const existingProviders = useMemo(() => new Set(existing.map((t) => t.split(':')[0]!)), [existing]);

  const [phase, setPhase] = useState<Phase>({ kind: 'providers' });
  const [cursor, setCursor] = useState(0);
  const [pickedProviders, setPickedProviders] = useState<Set<string>>(
    () => new Set(providers.filter((p) => existingProviders.has(p))),
  );
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const selectedProviders = providers.filter((p) => pickedProviders.has(p));
  const currentProvider = phase.kind === 'regions' ? selectedProviders[phase.index] : undefined;
  const options: LzTargetOption[] = useMemo(() => {
    if (!currentProvider) return [];
    try { return buildLzTargetOptions(loadRegions(currentProvider, workDir)); } catch { return []; }
  }, [currentProvider]);

  const preselect = (provider: string, opts: LzTargetOption[]): Set<string> => {
    const configured = existing.filter((t) => t.startsWith(`${provider}:`)).map((t) => t.slice(provider.length + 1));
    return new Set(opts.filter((o) => configured.some((c) => optionMatches(o, c))).map((o) => o.value));
  };

  const enterProvider = (index: number, next: Record<string, string[]>) => {
    const provider = selectedProviders[index];
    if (provider === undefined) {
      const targets = selectedProviders.flatMap((p) => (next[p] ?? []).map((v) => `${p}:${v}`));
      if (targets.length === 0) { onNext([]); return; }
      const written = (() => { try { return writeTargets(workDir, targets); } catch { return false; } })();
      setPhase({ kind: 'done', targets, written });
      return;
    }
    let opts: LzTargetOption[] = [];
    try { opts = buildLzTargetOptions(loadRegions(provider, workDir)); } catch { /* empty list: skipped below */ }
    setToggled(preselect(provider, opts));
    setCursor(0);
    setPhase({ kind: 'regions', index });
  };

  useInput((input, key) => {
    if (phase.kind === 'done') {
      if (key.return) onNext(phase.written ? phase.targets : []);
      return;
    }
    if (phase.kind === 'providers') {
      if (providers.length === 0) { if (key.return) onNext([]); return; }
      // Rows: providers, then "Skip".
      const rows = providers.length + 1;
      if (key.upArrow) setCursor((c) => (c - 1 + rows) % rows);
      else if (key.downArrow) setCursor((c) => (c + 1) % rows);
      else if (input === 's' || input === 'S') onNext([]);
      else if (input === ' ' && cursor < providers.length) {
        const p = providers[cursor]!;
        setPickedProviders((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
      } else if (key.return) {
        if (cursor === providers.length) { onNext([]); return; }
        let picked = pickedProviders;
        if (picked.size === 0) {
          picked = new Set([providers[cursor]!]);
          setPickedProviders(picked);
        }
        // selectedProviders is derived from state on the next render; compute it here.
        const first = providers.find((p) => picked.has(p))!;
        let opts: LzTargetOption[] = [];
        try { opts = buildLzTargetOptions(loadRegions(first, workDir)); } catch { /* empty */ }
        setToggled(preselect(first, opts));
        setCursor(0);
        setPhase({ kind: 'regions', index: 0 });
      }
      return;
    }
    // Regions of the current provider.
    const rows = options.length;
    if (key.upArrow && rows > 0) setCursor((c) => (c - 1 + rows) % rows);
    else if (key.downArrow && rows > 0) setCursor((c) => (c + 1) % rows);
    else if (input === ' ' && rows > 0) {
      const v = options[cursor]!.value;
      setToggled((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
    } else if (key.return) {
      // Enter without a toggled value picks the highlighted one.
      const picked = options.filter((o) => toggled.has(o.value)).map((o) => o.value);
      const values = picked.length > 0 ? picked : rows > 0 ? [options[cursor]!.value] : [];
      const next = { ...chosen, [currentProvider!]: values };
      setChosen(next);
      enterProvider(phase.index + 1, next);
    }
  });

  const title = <Text bold color="cyanBright">Step {stepNumber} -- Landing Zone Targets</Text>;

  if (phase.kind === 'done') {
    return (
      <Box flexDirection="column">
        {title}
        {phase.written ? (
          <>
            <Text color="green">Wrote assessment.landing_zone.targets to .swao.yml:</Text>
            {phase.targets.map((t) => <Text key={t}>  {t}</Text>)}
            <Text dimColor>Every application run fits these targets; an app .swao.yml or --lz-cat-targets overrides them.</Text>
          </>
        ) : (
          <Text color="yellow">Could not write .swao.yml; set assessment.landing_zone.targets by hand or pass --lz-cat-targets.</Text>
        )}
        <Text dimColor>Press Enter to continue...</Text>
      </Box>
    );
  }

  if (phase.kind === 'providers') {
    if (providers.length === 0) {
      return (
        <Box flexDirection="column">
          {title}
          <Text color="yellow">No landing zone catalogue found. Run `swao lz catalogue list` after setup.</Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      );
    }
    const rows = [...providers, 'Skip (configure later)'];
    const start = windowStart(cursor, rows.length);
    return (
      <Box flexDirection="column">
        {title}
        <Text>Which cloud providers should every application run be fitted against?</Text>
        {existing.length > 0 && <Text dimColor>Configured now: {existing.join(', ')}</Text>}
        <Box flexDirection="column" marginTop={1}>
          {rows.slice(start, start + WINDOW).map((p, i) => {
            const idx = start + i;
            const isSkip = idx === providers.length;
            const mark = isSkip ? '   ' : pickedProviders.has(p) ? '[x]' : '[ ]';
            return (
              <Text key={p} color={idx === cursor ? 'cyanBright' : undefined}>
                {idx === cursor ? '> ' : '  '}{mark} {p}
              </Text>
            );
          })}
        </Box>
        <Text dimColor>Up/Down move, Space toggles, Enter continues, S skips.</Text>
      </Box>
    );
  }

  const start = windowStart(cursor, options.length);
  return (
    <Box flexDirection="column">
      {title}
      <Text>
        Provider {phase.index + 1} of {selectedProviders.length}: <Text bold>{currentProvider}</Text>. Pick geographies or regions.
      </Text>
      <Text dimColor>A geography resolves to its default region at run time (residency DE first).</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.length === 0 && <Text color="yellow">No regions found in this catalogue; Enter skips the provider.</Text>}
        {options.slice(start, start + WINDOW).map((o, i) => {
          const idx = start + i;
          return (
            <Text key={`${o.kind}:${o.value}`} color={idx === cursor ? 'cyanBright' : undefined}>
              {idx === cursor ? '> ' : '  '}{toggled.has(o.value) ? '[x]' : '[ ]'} {o.label}
            </Text>
          );
        })}
        {options.length > WINDOW && <Text dimColor>  ({cursor + 1} of {options.length})</Text>}
      </Box>
      <Text dimColor>Up/Down move, Space toggles, Enter confirms (the highlighted entry when none is ticked).</Text>
    </Box>
  );
}
