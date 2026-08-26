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

// #0872 -- TUI wrapper for `swao lz catalogue update`.
// Consultant+ licence required (entry gate via LicenseGate).

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GuidanceBox, LicenseGate, LiveOutput, ProgressBar, SelectInput } from '@swao/tui-kit';
import type { LicenseStateView } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { LicenseGuard } from '../../license/license-guard.js';
import { findWorkspace } from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogueIndex } from '@swao/module-landing-zone';

type Phase = 'input-provider' | 'warn-overwrite' | 'running' | 'done';

/** Returns filenames in the workspace LZ catalogue directory that differ from the bundled seed. */
function detectModifiedCatalogues(workspacePath: string | null): string[] {
  if (!workspacePath) return [];
  const catalogDir = join(workspacePath, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
  if (!existsSync(catalogDir)) return [];
  const bundledDir = resolveLzCataloguesDir();
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

interface ProviderOption {
  label: string;
  value: string;
}

// Provider list is built dynamically from the bundled lz-catalogues/index.json.
// Adding a catalogue to index.json is sufficient -- no code change required here.
// Curated providers (source === "curated") are included for discoverability;
// selecting one prints a skip message from the CLI backend.
// Progress bar total for "all" reflects automated (non-curated) providers only (6).
function buildProviderOptions(): ProviderOption[] {
  const opts: ProviderOption[] = [
    { label: 'all           -- all configured providers', value: 'all' },
  ];
  const dir = resolveLzCataloguesDir();
  if (!dir) return opts;
  try {
    const { catalogues } = loadLzCatalogueIndex(dir);
    for (const c of catalogues) {
      const pad = c.provider.padEnd(14);
      const desc = c.short_description ?? c.name;
      opts.push({ label: `${pad}-- ${desc}`, value: c.provider });
    }
  } catch { /* bundled index unreadable; fall back to all-only list */ }
  return opts;
}

const PROVIDER_OPTIONS: ProviderOption[] = buildProviderOptions();

export interface LzCatalogueUpdateScreenProps {
  onBack: () => void;
  onOpenLicense: () => void;
}

export function LzCatalogueUpdateScreen({ onBack, onOpenLicense }: LzCatalogueUpdateScreenProps) {
  const licenseState = useMemo<LicenseStateView>(() => {
    try {
      return LicenseGuard.load().state as LicenseStateView;
    } catch {
      return { tier: 'community', assessmentCount: 0, firstRun: '' };
    }
  }, []);

  const [phase, setPhase]                   = useState<Phase>('input-provider');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [modifiedFiles, setModifiedFiles]   = useState<string[]>([]);
  const [lines, setLines]                   = useState<string[]>([]);
  const [exitCode, setExitCode]             = useState<number | null>(null);
  // #0912: track per-provider progress by counting "updated:" lines in CLI output.
  const [providersCompleted, setProvidersCompleted] = useState(0);
  const guidanceOpenRef                     = useRef(false);

  // Spawn `swao lz catalogue update --provider <X>` when phase transitions
  // to 'running'. Streams stdout + stderr into the lines state; transitions
  // to 'done' on close.
  useEffect(() => {
    if (phase !== 'running') return;

    const workspace  = findWorkspace(process.cwd());
    const IS_PKG = Boolean((process as { pkg?: unknown }).pkg);
    const child = spawn(
      process.execPath,
      [...(IS_PKG ? [] : [process.argv[1] ?? '']), 'lz', 'catalogue', 'update', '--provider', selectedProvider],
      {
        cwd:         workspace ?? process.cwd(),
        env:         { ...process.env, PKG_EXECPATH: '' },
        stdio:       ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    const appendLines = (data: Buffer) => {
      const chunks = data.toString().split('\n').filter(l => l.length > 0);
      if (chunks.length > 0) {
        setLines(prev => [...prev, ...chunks]);
        // #0912: detect "updated: ..." or "written:" lines to advance progress bar.
        const completions = chunks.filter(l => /^\s*(updated|written):/.test(l));
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

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (phase === 'input-provider' && key.escape) { onBack(); return; }
    if (phase === 'warn-overwrite' && key.return) { setPhase('running'); return; }
    if (phase === 'warn-overwrite' && (key.escape || input === '0')) { onBack(); return; }
    if (phase === 'done' && (key.return || key.escape)) { onBack(); return; }
    void input; // suppress unused-var warning
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Update LZ Catalogue" />
      <LicenseGate
        required="consultant"
        state={licenseState}
        feature="LZ Catalogue Update"
        onOpenLicenseScreen={onOpenLicense}
        onBack={onBack}
      >
        {phase === 'input-provider' && (
          <Box flexDirection="column" marginTop={1}>
            <SelectInput
              label="Select provider to update"
              options={PROVIDER_OPTIONS}
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
              active
            />
          </Box>
        )}
        {phase === 'warn-overwrite' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="yellow">Update LZ Catalogue -- Warning</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>The following workspace catalogue files have been modified since they were</Text>
              <Text>last seeded and will be overwritten by this update:</Text>
              <Box marginTop={1} flexDirection="column" paddingLeft={2}>
                {modifiedFiles.map(f => (
                  <Text key={f} color="yellow">{f}  (modified)</Text>
                ))}
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text>Any manual changes to these files will be lost.</Text>
                <Text dimColor>To keep your changes: press Esc to cancel, then rename or back up</Text>
                <Text dimColor>the files before running the update again.</Text>
              </Box>
              <Box marginTop={1}>
                <Text bold>  [Enter]  Proceed and overwrite     [Esc]  Cancel</Text>
              </Box>
            </Box>
          </Box>
        )}
        {phase === 'running' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              Updating <Text color="cyanBright">{selectedProvider}</Text> catalogue...
            </Text>
            {/* #0912: progress bar -- advances on each "updated: ..." line in CLI output */}
            <ProgressBar
              value={providersCompleted}
              total={selectedProvider === 'all' ? 6 : 1}
              width={Math.min(36, Math.max(20, (process.stdout.columns ?? 80) - 20))}
            />
            <LiveOutput lines={lines} maxLines={20} label="Output" />
          </Box>
        )}
        {phase === 'done' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={exitCode === 0 ? 'green' : 'red'}>
              {exitCode === 0
                ? `Update complete. (${providersCompleted} provider file${providersCompleted !== 1 ? 's' : ''} written)`
                : `Update failed. See the output above for details.`}
            </Text>
            {/* #0912/#0913: show full progress bar + full output on done */}
            <ProgressBar
              value={exitCode === 0 ? (selectedProvider === 'all' ? 6 : 1) : providersCompleted}
              total={selectedProvider === 'all' ? 6 : 1}
              width={Math.min(36, Math.max(20, (process.stdout.columns ?? 80) - 20))}
              color={exitCode === 0 ? 'green' : 'red'}
            />
            <LiveOutput lines={lines} maxLines={40} label="Output" />
          </Box>
        )}
      </LicenseGate>
      <GuidanceBox
        title="Catalogue refresh"
        what={
          'Refresh the landing zone service catalogues for AWS, Azure, GCP, and STACKIT. ' +
          'The bundled catalogues ship with each SWAO release; run this before an engagement ' +
          'to pick up services launched since the last release.'
        }
        details={[
          {
            label: 'When to use',
            value:
              'Requires a Consultant or Enterprise licence. No cloud credentials required for ' +
              'AWS, Azure (Retail Prices API), GCP (region-picker), and STACKIT (PIM API). ' +
              'Refreshed files are written to <workspace>/wsp/inputs/catalogs/lz-catalogues/ and take precedence ' +
              'over the bundled binary copy for all assessments in this workspace.',
          },
          {
            label: 'Deliverables',
            value:
              'Updated JSON catalogue files in <workspace>/wsp/inputs/catalogs/lz-catalogues/. ' +
              'Run `swao lz catalogue list` to view the current state.',
          },
        ]}
        onOpenChange={(open: boolean) => { guidanceOpenRef.current = open; }}
      />
      {phase === 'done' && (
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to return to Tools.</Text>
        </Box>
      )}
    </Box>
  );
}
