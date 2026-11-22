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

// #0872: TUI wrapper for `swao lz catalogue update`.
// Consultant+ licence required (entry gate via LicenseGate).
// #3589 (Design 120 sections 10.2, 14.2): when the workspace registers a live
// landing zone, a source selector comes first: Internet sources (the existing
// flow) or the live landing zone catalogue (select LZ + run, dry-run diff,
// confirm, write, or build a new catalogue file). Without a registered
// landing zone the screen opens on the provider list as before.
// #4257 (TUI-13, Design 126 sections 3, 4, 6 and 7): on ScreenLayout; the
// source, landing zone, run and provider lists through the central
// SelectInput with one guidance entry per option; key hints from KeyHints
// only; status words through StatusRow; the output through RunOutput
// (wrapped, never cut); the CLI equivalent in the guidance entry.

import { useMemo, useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  KEY_HINTS, LicenseGate, ProgressBar, RunOutput, ScreenLayout, SelectInput, StatusRow,
  guidanceOwnsKey, isAllowed, tone, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type LicenseStateView, type SelectOption,
} from '@swao/tui-kit';
import { useScreenHeader } from '../components/screen-header.js';
import { LicenseGuard } from '../../license/license-guard.js';
import { findWorkspace } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { resolveBundledLzCataloguesDir, discoverLzCatalogues } from '@swao/module-landing-zone';
import {
  CATALOGUE_SOURCES,
  buildLiveCatalogueUpdateArgs,
  dryRunWritable,
  listLiveCatalogueLandingZones,
  listLiveCatalogueRuns,
  validateNewSlug,
  type CatalogueSource,
  type LiveCatalogueLz,
} from './lz-catalogue-live-flow.js';

type Phase = 'source' | 'live-lz' | 'live-run' | 'live-slug' | 'live-dry' | 'live-diff' | 'live-write' | 'input-provider' | 'warn-overwrite' | 'running' | 'done';

/** #3589: spawn this SWAO binary with `args`; lines streamed, exit code on close. */
function spawnSwao(args: string[], cwd: string, onLines: (lines: string[]) => void, onClose: (code: number) => void): () => void {
  const selfCmd = selfSpawnCommand(args);
  const child = spawn(selfCmd.command, selfCmd.args, {
    cwd, env: selfCmd.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const push = (data: Buffer): void => {
    const l = data.toString().split('\n').map((x) => x.replace(/\r$/, '')).filter((x) => x.length > 0);
    if (l.length > 0) onLines(l);
  };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  child.on('close', (code) => onClose(code ?? 0));
  return () => { child.kill(); };
}

/** Returns filenames in the workspace LZ catalogue directory that differ from the bundled seed. */
function detectModifiedCatalogues(workspacePath: string | null): string[] {
  if (!workspacePath) return [];
  const catalogDir = join(workspacePath, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
  if (!existsSync(catalogDir)) return [];
  // The shipped catalogues only: the cwd-relative resolver could pick the workspace folder itself.
  const bundledDir = resolveBundledLzCataloguesDir();
  if (!bundledDir) return [];
  const modified: string[] = [];
  for (const f of readdirSync(catalogDir)) {
    if (!f.endsWith('.json')) continue;
    const bundledFile = join(bundledDir, f);
    if (!existsSync(bundledFile)) continue; // user-added file, skip
    const wHash = createHash('sha256').update(readFileSync(join(catalogDir, f))).digest('hex');
    const bHash = createHash('sha256').update(readFileSync(bundledFile)).digest('hex');
    if (wHash !== bHash) modified.push(f);
  }
  return modified;
}

const REFRESH_GUIDANCE: GuidanceEntry = {
  title: 'Update LZ Catalogue',
  what:
    'Refresh the landing zone service catalogues for AWS, Azure, GCP and STACKIT. The bundled catalogues ship with each SWAO release; ' +
    'run this before an engagement to pick up services launched since the last release. With all, Azure or AWS selected, the same run ' +
    'refreshes the VM prices (Linux and Windows) of the service cost model from the Azure and AWS price APIs.',
  sections: [
    { label: 'When to use', text: 'Requires a Consultant licence or higher. No cloud credentials needed: AWS, Azure, GCP and STACKIT use public APIs.' },
    { label: 'Deliverables', text: 'Updated JSON catalogue files and prices/vm-prices.json in <workspace>/wsp/inputs/catalogs/lz-catalogues/; they override the bundled copy.' },
  ],
  cli: 'swao lz catalogue update --provider <id>',
};

// #3298 (Design 110 E-24): the provider list is built from the bundled
// catalogue files' own meta blocks (no index.json). Adding a catalogue file is
// sufficient, no code change required here. Curated providers (source
// "curated") are included for discoverability; selecting one prints a skip
// message from the CLI backend. #4257: name and description in two columns,
// one guidance entry per provider.
export function buildProviderOptions(): SelectOption[] {
  const opts: SelectOption[] = [{
    label: 'all', value: 'all', detail: 'all configured providers',
    guidance: { ...REFRESH_GUIDANCE, title: 'All providers', what: 'Refresh every provider catalogue that has an automated source, and the Azure and AWS VM prices.', cli: 'swao lz catalogue update --provider all' },
  }];
  const dir = resolveBundledLzCataloguesDir();
  if (!dir) return opts;
  try {
    for (const c of discoverLzCatalogues(dir)) {
      opts.push({
        label: c.provider, value: c.provider, detail: c.short_description,
        guidance: { ...REFRESH_GUIDANCE, title: c.provider, what: `${c.short_description}. Refresh this provider catalogue from its public source.`, cli: `swao lz catalogue update --provider ${c.provider}` },
      });
    }
  } catch { /* bundled catalogues unreadable; fall back to all-only list */ }
  return opts;
}

const PROVIDER_OPTIONS: SelectOption[] = buildProviderOptions();

const SOURCE_OPTIONS: SelectOption[] = CATALOGUE_SOURCES.map((x) => ({
  label: x.label, value: x.id, number: x.key, detail: x.detail,
  guidance: {
    title: x.label,
    what: x.id === 'internet'
      ? 'Refresh the catalogues from the public CSP sources (the bundled source list).'
      : x.id === 'live'
        ? 'Update the provider catalogue from the live landing zone catalogue of a Landing Zone Live run: dry run with a diff first, then write.'
        : 'Build a new catalogue file from a live run, for a CSP or private cloud without a catalogue.',
    cli: x.id === 'internet' ? 'swao lz catalogue update --provider <id>' : 'swao lz catalogue update --source live --lz <id>',
  },
}));

/** The phase keys of the screen (Design 126 section 7.9). */
export function lzCatalogueKeys(phase: Phase, writable: boolean): readonly KeyHint[] {
  switch (phase) {
    case 'source':
    case 'live-lz':
    case 'live-run':
    case 'input-provider':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
    case 'live-slug':
      return [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
    case 'live-dry':
    case 'running':
      return KEY_HINTS.run;
    case 'live-write':
      return [];
    case 'live-diff':
      return writable ? [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'cancel' }] : [{ key: 'Esc', verb: 'back' }];
    case 'warn-overwrite':
      return [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'cancel' }];
    case 'done':
      return KEY_HINTS.lastStep.filter((h) => h.key !== '↑↓');
    default: {
      const never: never = phase;
      return never;
    }
  }
}

export interface LzCatalogueUpdateScreenProps {
  onBack: () => void;
  onOpenLicense: () => void;
}

export function LzCatalogueUpdateScreen({ onBack, onOpenLicense }: LzCatalogueUpdateScreenProps) {
  const header = useScreenHeader('Update LZ Catalogue');
  const licenseState = useMemo<LicenseStateView>(() => {
    try {
      return LicenseGuard.load().state as LicenseStateView;
    } catch {
      return { tier: 'community', assessmentCount: 0, firstRun: '' };
    }
  }, []);
  const allowed = isAllowed(licenseState, 'consultant');

  // #3589: registered live landing zones decide whether the source selector shows.
  const workspaceRoot = useMemo(() => findWorkspace(process.cwd()), []);
  const liveLzs = useMemo<LiveCatalogueLz[]>(() => listLiveCatalogueLandingZones(workspaceRoot), [workspaceRoot]);
  const [phase, setPhase]                   = useState<Phase>(liveLzs.length > 0 ? 'source' : 'input-provider');
  const [source, setSource]                 = useState<CatalogueSource>('internet');
  const [liveLz, setLiveLz]                 = useState<LiveCatalogueLz | null>(null);
  const [liveRun, setLiveRun]               = useState<string | undefined>(undefined);
  const [newSlug, setNewSlug]               = useState<string | undefined>(undefined);
  const [slugInput, setSlugInput]           = useState('');
  const [liveError, setLiveError]           = useState('');
  const liveRuns = useMemo(() => (workspaceRoot && liveLz ? listLiveCatalogueRuns(workspaceRoot, liveLz.id) : []), [workspaceRoot, liveLz]);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [modifiedFiles, setModifiedFiles]   = useState<string[]>([]);
  const [lines, setLines]                   = useState<string[]>([]);
  const [exitCode, setExitCode]             = useState<number | null>(null);
  // #0912: track per-provider progress by counting "updated:" lines in CLI output.
  const [providersCompleted, setProvidersCompleted] = useState(0);
  const guidanceOpenRef                     = useRef(false);
  const sourceGuidance   = useOptionGuidance(REFRESH_GUIDANCE);
  const providerGuidance = useOptionGuidance(REFRESH_GUIDANCE);
  // #4213 (Design 126 section 9): the landing zone and run pickers of the live source feed the box too.
  const liveLzGuidance   = useOptionGuidance(REFRESH_GUIDANCE);
  const liveRunGuidance  = useOptionGuidance(REFRESH_GUIDANCE);

  // Spawn `swao lz catalogue update --provider <X>` when phase transitions
  // to 'running'. Streams stdout + stderr into the lines state; transitions
  // to 'done' on close.
  useEffect(() => {
    if (phase !== 'running') return;

    const workspace  = findWorkspace(process.cwd());
    const selfCmd = selfSpawnCommand(['lz', 'catalogue', 'update', '--provider', selectedProvider]);
    const child = spawn(
      selfCmd.command,
      selfCmd.args,
      {
        cwd:         workspace ?? process.cwd(),
        env:         selfCmd.env,
        stdio:       ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    const appendLines = (data: Buffer) => {
      const chunks = data.toString().split('\n').filter(l => l.length > 0);
      if (chunks.length > 0) {
        setLines(prev => [...prev, ...chunks]);
        // #0912: detect "updated:" / "written:" lines to advance progress bar.
        // #2623: curated providers emit a skip message ("source.mode curated, no
        // automated adapter") instead of "updated:"; count those too.
        const completions = chunks.filter(l =>
          /^\s*(updated|written):/.test(l) ||
          /source\.mode.*curated.*no automated adapter/i.test(l)
        );
        if (completions.length > 0) setProvidersCompleted(prev => prev + completions.length);
      }
    };

    child.stdout?.on('data', appendLines);
    child.stderr?.on('data', appendLines);
    child.on('close', (code) => {
      setExitCode(code ?? 0);
      setPhase('done');
    });

    return () => { child.kill(); };
  }, [phase]); // selectedProvider is stable when phase transitions to 'running'

  // #3589: dry run (live-dry) and write (live-write) of the live source.
  useEffect(() => {
    if ((phase !== 'live-dry' && phase !== 'live-write') || !liveLz) return;
    const dryRun = phase === 'live-dry';
    setLines([]);
    const collected: string[] = [];
    return spawnSwao(
      buildLiveCatalogueUpdateArgs({ lzId: liveLz.id, provider: liveLz.provider, ...(liveRun ? { run: liveRun } : {}), ...(newSlug !== undefined ? { newSlug } : {}), dryRun }),
      workspaceRoot ?? process.cwd(),
      (l) => {
        collected.push(...l);
        setLines((prev) => [...prev, ...l]);
        if (!dryRun) setProvidersCompleted((n) => n + l.filter((x) => /^\s*written:/.test(x)).length);
      },
      (code) => {
        setExitCode(code);
        if (dryRun) {
          setLiveError(dryRunWritable(code, collected) ? '' : 'Nothing to write (see the output above).');
          setPhase('live-diff');
        } else {
          setPhase('done');
        }
      },
    );
  }, [phase]);

  useInput((input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    // The LicenseGate handles its own keys (Esc back, L licence) below the Consultant tier.
    if (!allowed) return;
    switch (phase) {
      case 'source':
        if (key.escape) onBack();
        return;
      case 'live-lz':
        if (key.escape) setPhase('source');
        return;
      case 'live-run':
        if (key.escape) setPhase('live-lz');
        return;
      case 'live-slug': {
        if (key.escape) { setPhase('live-run'); return; }
        if (key.return) {
          const slug = slugInput.trim();
          const bad = validateNewSlug(slug);
          if (bad) { setLiveError(bad); return; }
          setLiveError('');
          setNewSlug(slug);
          setPhase('live-dry');
          return;
        }
        if (key.backspace || key.delete) setSlugInput((v) => v.slice(0, -1));
        else if (input && !key.ctrl && !key.meta) setSlugInput((v) => v + input);
        return;
      }
      case 'live-diff':
        if (key.escape || input === 'n') { onBack(); return; }
        if ((key.return || input === 'y') && !liveError) setPhase('live-write');
        return;
      case 'live-dry':
      case 'running':
        // Q-09: Esc cancels at once (the unmount stops the child).
        if (key.escape) onBack();
        return;
      case 'live-write':
        return;
      case 'input-provider':
        if (key.escape) { if (liveLzs.length > 0) setPhase('source'); else onBack(); }
        return;
      case 'warn-overwrite':
        if (key.return) { setPhase('running'); return; }
        if (key.escape || input === '0') onBack();
        return;
      case 'done':
        if (key.return || key.escape) onBack();
        return;
      default: {
        const never: never = phase;
        return never;
      }
    }
  });

  const total = selectedProvider === 'all' ? 6 : 1;
  const target = newSlug !== undefined ? `new ${newSlug}.json` : (liveLz?.provider ?? '');
  const runLabel = liveRun ? `run ${liveRun}` : 'latest run';
  const title = !allowed ? { title: 'Update LZ Catalogue' }
    : phase === 'source' ? { title: 'Select the catalogue source', subtitle: 'Internet sources or the live landing zone catalogue of a registered landing zone.' }
    : phase === 'live-lz' ? { title: 'Select the landing zone', subtitle: 'Its live run is the source.' }
    : phase === 'live-run' ? { title: `Select the run of ${liveLz?.id ?? ''}` }
    : phase === 'live-slug' ? { title: 'New catalogue file slug', subtitle: 'For example private-cloud-dc1.' }
    : phase === 'live-dry' || phase === 'live-diff' ? { title: 'Dry run (diff)', subtitle: `${target} from ${liveLz?.id ?? ''}, ${runLabel}` }
    : phase === 'live-write' ? { title: 'Writing the catalogue', subtitle: `${target} from ${liveLz?.id ?? ''}, ${runLabel}` }
    : phase === 'input-provider' ? { title: 'Update LZ Catalogue', subtitle: 'Refresh the provider service catalogues from their public sources.' }
    : phase === 'warn-overwrite' ? { title: 'Warning: modified catalogue files' }
    : phase === 'running' ? { title: `Updating the ${selectedProvider} catalogue` }
    : { title: 'Update LZ Catalogue' };
  const guidanceEntry: GuidanceEntry = phase === 'source' ? sourceGuidance.entry
    : phase === 'input-provider' ? providerGuidance.entry
    : phase === 'live-lz' ? liveLzGuidance.entry
    : phase === 'live-run' ? liveRunGuidance.entry
    : REFRESH_GUIDANCE;
  const keys: readonly KeyHint[] = allowed ? lzCatalogueKeys(phase, !liveError) : [{ key: 'Esc', verb: 'back' }];
  const done = phase === 'done';

  return (
    <ScreenLayout
      header={header}
      title={title}
      keys={keys}
      guidance={{ entry: guidanceEntry, initiallyCollapsed: true, onOpenChange: (open: boolean) => { guidanceOpenRef.current = open; } }}
    >
      <LicenseGate
        required="consultant"
        state={licenseState}
        feature="LZ Catalogue Update"
        onOpenLicenseScreen={onOpenLicense}
        onBack={onBack}
      >
        {phase === 'source' && (
          <SelectInput
            label="Catalogue source"
            options={SOURCE_OPTIONS}
            numbered
            visibleCount={SOURCE_OPTIONS.length}
            showKeyHints={false}
            onCursorChange={sourceGuidance.onCursorChange}
            onSelect={(value) => {
              const picked = value as CatalogueSource;
              setSource(picked);
              setPhase(picked === 'internet' ? 'input-provider' : 'live-lz');
            }}
          />
        )}
        {phase === 'live-lz' && (
          <SelectInput
            label="Landing zone"
            visibleCount={Math.min(Math.max(1, liveLzs.length), 10)}
            options={liveLzs.map((l) => ({
              label: l.id,
              value: l.id,
              detail: `${l.provider}${l.display ? `, ${l.display}` : ''}`,
              guidance: {
                title: l.id,
                what: `Uses the live landing zone catalogue of ${l.id} (${l.provider}${l.display ? `, ${l.display}` : ''}) as the source; the run is picked next.`,
                cli: `swao lz catalogue update --provider ${l.provider} --source live --lz ${l.id}`,
              },
            }))}
            showKeyHints={false}
            onCursorChange={liveLzGuidance.onCursorChange}
            onSelect={(value) => {
              const lz = liveLzs.find((l) => l.id === value);
              if (!lz) return;
              setLiveLz(lz);
              setSelectedProvider(lz.provider);
              setPhase('live-run');
            }}
          />
        )}
        {phase === 'live-run' && liveLz && (
          <>
            <SelectInput
              label="Run"
              visibleCount={Math.min(liveRuns.length + 1, 10)}
              options={[
                {
                  label: 'latest run',
                  value: '__latest',
                  detail: 'latest-lz-live.txt',
                  guidance: { title: 'latest run', what: `Reads lz-live-catalogue.json of the run that latest-lz-live.txt of ${liveLz.id} points to; a dry run (diff) comes first.`, cli: `swao lz catalogue update --provider ${liveLz.provider} --source live --lz ${liveLz.id} --dry-run` },
                },
                ...liveRuns.map((r) => ({
                  label: r,
                  value: r,
                  guidance: { title: `Run ${r}`, what: `Reads lz-live-catalogue.json of the run ${r} of ${liveLz.id}; a dry run (diff) comes first.`, cli: `swao lz catalogue update --provider ${liveLz.provider} --source live --lz ${liveLz.id} --run ${r} --dry-run` },
                })),
              ]}
              showKeyHints={false}
              onCursorChange={liveRunGuidance.onCursorChange}
              onSelect={(value) => {
                setLiveRun(value === '__latest' ? undefined : value);
                if (source === 'live-new') { setSlugInput(''); setPhase('live-slug'); } else { setNewSlug(undefined); setPhase('live-dry'); }
              }}
            />
            {liveRuns.length === 0 && (
              <StatusRow level="warn" label="Runs" summary="No run with lz-live-catalogue.json yet; run a Landing Zone Live Assessment first." />
            )}
          </>
        )}
        {phase === 'live-slug' && (
          <Text>
            <Text {...tone('accent')}>{slugInput}</Text>
            <Text {...tone('selection')}>|</Text>
          </Text>
        )}
        {(phase === 'live-dry' || phase === 'live-diff' || phase === 'live-write') && (
          <>
            {lines.length > 0 && <RunOutput lines={lines} maxLines={14} />}
            {phase === 'live-diff' && !liveError && <Text bold>Write this catalogue to the workspace?</Text>}
          </>
        )}
        {liveError ? <StatusRow level={phase === 'live-diff' ? 'warn' : 'fail'} label="Result" summary={liveError} /> : null}
        {phase === 'input-provider' && (
          <SelectInput
            label="Select provider to update"
            options={PROVIDER_OPTIONS}
            showKeyHints={false}
            onCursorChange={providerGuidance.onCursorChange}
            onSelect={(val: string) => {
              setSelectedProvider(val);
              // #1523: detect user-modified catalogue files before overwriting.
              const workspace = findWorkspace(process.cwd());
              const modified = detectModifiedCatalogues(workspace);
              if (modified.length > 0) {
                setModifiedFiles(modified);
                setPhase('warn-overwrite');
              } else {
                setPhase('running');
              }
            }}
          />
        )}
        {phase === 'warn-overwrite' && (
          <>
            <Text wrap="wrap">These workspace catalogue files were changed since they were seeded; the update overwrites them and the manual changes are lost:</Text>
            {modifiedFiles.map((f) => <StatusRow key={f} level="warn" label={f} summary="modified" />)}
            <Text {...tone('muted')} wrap="wrap">To keep the changes, cancel, then rename or back up the files before the next update.</Text>
          </>
        )}
        {(phase === 'running' || done) && (
          <>
            {/* #0912: progress bar, advances on each "updated: ..." line in the CLI output */}
            <ProgressBar
              value={done && exitCode === 0 ? total : providersCompleted}
              total={total}
              width={Math.min(36, Math.max(20, (process.stdout.columns ?? 80) - 20))}
            />
            {lines.length > 0 && <RunOutput lines={lines} maxLines={10} />}
          </>
        )}
        {done && (
          <Text bold {...tone(exitCode === 0 ? 'ok' : 'error')}>
            {exitCode === 0
              ? `Update complete. (${providersCompleted} provider file${providersCompleted !== 1 ? 's' : ''} written)`
              : 'Update failed. See the output above for details.'}
          </Text>
        )}
      </LicenseGate>
    </ScreenLayout>
  );
}
