// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Portfolio module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  HeaderView,
  TextInput,
  SelectInput,
  LiveOutput,
  GuidanceBox,
  type LicenseStateView,
} from '@swao/tui-kit';
import { findWorkspace, openWithDefaultApp, copyToClipboard, LicenseGuard } from '@swao/core';
import type { LicenseState } from '@swao/core';
import { LicenseGate, isAllowed } from '@swao/tui-kit';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

// Portfolio operations (#0230): aggregate analysis across all apps under
// <workspace>/apps/. Enterprise-gated at the CLI layer.
// #0417 (sprint-040 round-14): split the export-done state into two
// pages (summary + powerbi-links) mirroring ExportBiScreen.
type Phase = 'menu' | 'input-lz' | 'running' | 'done-summary' | 'done-powerbi' | 'done';
type Action = 'assess-lzr' | 'export' | 'report-lzr';

const ACTIONS = [
  { label: 'Assess (LZR)  -- aggregate landing-zone readiness across all assessed apps', value: 'assess-lzr' as Action },
  { label: 'Export BI     -- emit the portfolio 19-CSV bundle for swao-portfolio.pbit',  value: 'export'     as Action },
  { label: 'Report (LZR)  -- render the portfolio LZR aggregate to text',                value: 'report-lzr' as Action },
];

interface PortfolioScreenProps {
  onBack: () => void;
  onOpenLicense?: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function PortfolioScreen({ onBack, onOpenLicense, version }: PortfolioScreenProps) {
  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call sites stay unchanged. Mirrors
  // the #0573 DoctorScreen pattern.
  const Header = useMemo(() => {
    let licenseStateView: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseStateView = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseStateView} licenseError={licenseError} />;
    };
  }, [version]);

  // Enterprise gate (M18 #0277). Load once on mount; if loading fails treat
  // as Community for gate purposes so the locked panel renders rather
  // than the screen crashing.
  const licenseState: LicenseState = useMemo(() => {
    try {
      return LicenseGuard.load().state;
    } catch {
      return {
        tier: 'community',
        fingerprint: 'unknown',
        firstRun: new Date().toISOString().slice(0, 10),
        assessmentCount: 0,
        daysElapsed: 0,
      };
    }
  }, []);

  if (!isAllowed(licenseState, 'enterprise')) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Portfolio Operations" />
        <LicenseGate
          required="enterprise"
          state={licenseState}
          feature="swao assess --portfolio (cross-app portfolio mode)"
          onOpenLicenseScreen={onOpenLicense ?? onBack}
          onBack={onBack}
        >
          {/* unreachable when not allowed; kept for type completeness */}
          <></>
        </LicenseGate>
      </Box>
    );
  }

  const workspace = findWorkspace(process.cwd());

  // Apps with an application run. Mirrors ExportBiScreen eligibility: prefer
  // latest-application.txt; fall back to latest.txt only when no type pointers
  // exist (pre-sprint-076 workspaces). Portfolio export uses star-schema data
  // which requires application pass files (#0786).
  const assessedApps: string[] = workspace && existsSync(join(workspace, 'apps'))
    ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
        .filter(d => {
          if (!d.isDirectory()) return false;
          const wspDir = join(workspace, 'apps', d.name, 'wsp');
          if (!existsSync(wspDir)) return false;
          if (existsSync(join(wspDir, 'latest-application.txt'))) return true;
          if (!existsSync(join(wspDir, 'latest.txt'))) return false;
          const hasTypedPointers = readdirSync(wspDir).some(f => /^latest-.+\.txt$/.test(f));
          return !hasTypedPointers;
        })
        .map(d => d.name)
    : [];

  // Discover LZR input files across apps. Pass 23 reads from
  // <appDir>/wsp/inputs/terraform/ and recognises lz-meshstack-snapshot.json,
  // lz-aws-snapshot.json, lz-azure-snapshot.json, or any *.tfstate / *.tfplan
  // file. The --lzr flag value is a free-form label for the run, not a
  // selector -- but suggesting one of the discovered providers gives the
  // operator a sensible default.
  interface LzInputFile { appId: string; filename: string; suggestedId: string }
  const lzInputFiles: LzInputFile[] = [];
  if (workspace && existsSync(join(workspace, 'apps'))) {
    for (const appId of readdirSync(join(workspace, 'apps'))) {
      const tfDir = join(workspace, 'apps', appId, 'wsp', 'inputs', 'terraform');
      if (!existsSync(tfDir)) continue;
      for (const f of readdirSync(tfDir)) {
        if (f === 'lz-meshstack-snapshot.json') lzInputFiles.push({ appId, filename: f, suggestedId: 'lz-meshstack-01' });
        else if (f === 'lz-aws-snapshot.json')  lzInputFiles.push({ appId, filename: f, suggestedId: 'lz-aws-01' });
        else if (f === 'lz-azure-snapshot.json') lzInputFiles.push({ appId, filename: f, suggestedId: 'lz-azure-01' });
        else if (f.endsWith('.tfstate') || f.endsWith('.tfplan')) lzInputFiles.push({ appId, filename: f, suggestedId: 'lz-terraform-01' });
      }
    }
  }
  const lzOptions = Array.from(new Set(lzInputFiles.map(f => f.suggestedId)))
    .map(id => ({
      label: `${id}  -- found in: ${lzInputFiles.filter(f => f.suggestedId === id).map(f => `apps/${f.appId}/wsp/inputs/terraform/${f.filename}`).join(', ')}`,
      value: id,
    }));

  const [phase, setPhase]   = useState<Phase>('menu');
  const [action, setAction] = useState<Action | null>(null);
  const [lzId, setLzId]     = useState('');
  const [lines, setLines]   = useState<string[]>([]);
  const [done, setDone]     = useState(false);
  const [code, setCode]     = useState<number | null>(null);
  const [bundleDir, setBundleDir] = useState('');
  const [csvCount, setCsvCount]   = useState(0);
  const [pbitPath, setPbitPath]   = useState('');
  // #0417 (sprint-040 round-14): toast for the export-done page-2 hot-keys.
  const [actionToast, setActionToast] = useState('');
  const toastExport = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(''), 2500);
  };

  const guidanceOpenRef = useRef(false);

  useEffect(() => {
    if (phase !== 'running' || !action) return;

    let args: string[];
    if (action === 'assess-lzr') {
      args = ['assess', '--portfolio', '--lzr', lzId];
    } else if (action === 'export') {
      args = ['export', '--portfolio', '--formats', 'csv,ndjson,xlsx'];
    } else {
      args = ['report', '--portfolio', '--view', 'lzr'];
    }

    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: workspace ?? undefined,
    });

    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      setLines(prev => [...prev, ...text.split('\n').filter(Boolean)]);
      // Capture the star/ directory and CSV file count from the export's "[ok]" line.
      // Format: [ok]  Portfolio star CSV bundle written  ->  <path>/star  (N app(s), M files, R rows total)
      const starMatch = text.match(/\[ok\]\s+Portfolio star CSV bundle written\s+->\s+(\S+[/\\]star[/\\]?)\s+\(\d+\s+app\(s\),\s+(\d+)\s+files/);
      if (starMatch) {
        setBundleDir(((starMatch[1] ?? '').trim()).replace(/[/\\]$/, ''));
        if (starMatch[2]) setCsvCount(parseInt(starMatch[2], 10));
      }
      const pbitMatch = text.match(/\[ok\]\s+PowerBI template ready\s+->\s+(\S+\.pbit)/g);
      if (pbitMatch && pbitMatch.length > 0) {
        const last = pbitMatch[pbitMatch.length - 1] ?? '';
        const m = last.match(/->\s+(\S+\.pbit)/);
        if (m) setPbitPath((m[1] ?? '').trim());
      }
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      setCode(exitCode);
      setDone(true);
      // #0417: on a successful Portfolio Export BI, land on the summary
      // page first. Other actions / failures fall through to the generic
      // 'done' state with LiveOutput.
      if (exitCode === 0 && action === 'export') setPhase('done-summary');
      else setPhase('done');
    });
    return () => { child.kill(); };
  }, [phase]);

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    // #0417 (round-14): two-page export-done. Summary -> Enter advances
    // to powerbi page; Escape returns to main menu. PowerBI page Enter/
    // Escape returns to main menu. Failure 'done' state Enter/Escape returns.
    if (phase === 'done-summary' && key.return) setPhase('done-powerbi');
    if (phase === 'done-summary' && key.escape) onBack();
    if (phase === 'done-powerbi' && (key.return || key.escape)) onBack();
    if (phase === 'done' && (key.return || key.escape)) onBack();
    if (!done && phase !== 'running' && key.escape) onBack();
    // Hot-keys on the powerbi page: P opens the portfolio template, C
    // copies the SWAOPortfolioExportPath to the clipboard.
    if (phase === 'done-powerbi' && code === 0) {
      if ((input === 'p' || input === 'P') && pbitPath) {
        toastExport(openWithDefaultApp(pbitPath) ? `Opening portfolio template -> ${pbitPath}` : `Could not open ${pbitPath}`);
      }
      if ((input === 'c' || input === 'C') && bundleDir) {
        toastExport(copyToClipboard(bundleDir) ? `Copied SWAOPortfolioExportPath to clipboard: ${bundleDir}` : 'Clipboard copy failed');
      }
    }
  });

  const handleActionSelect = (v: Action) => {
    setAction(v);
    if (v === 'assess-lzr') setPhase('input-lz');
    else setPhase('running');
  };

  const labelFor = (a: Action | null): string => {
    if (a === 'assess-lzr') return 'Portfolio Assess (LZR)';
    if (a === 'export')     return 'Portfolio Export BI';
    if (a === 'report-lzr') return 'Portfolio Report (LZR)';
    return '';
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Portfolio Operations (Enterprise)" />

      {phase === 'menu' && (
        <Box flexDirection="column">
          {workspace
            ? <Text><Text dimColor>Workspace: </Text><Text bold color="whiteBright">{workspace}</Text></Text>
            : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
          <Text><Text dimColor>Assessed apps in this workspace: </Text><Text bold color="cyanBright">{assessedApps.length > 0 ? assessedApps.join(', ') : '(none)'}</Text></Text>
          {assessedApps.length === 0 && (
            <Text color="yellow">Run Assessment on at least one app first; portfolio operations aggregate per-app data.</Text>
          )}
          <Box marginTop={1}>
            <SelectInput
              label="Choose a portfolio operation"
              options={ACTIONS}
              onSelect={(v) => handleActionSelect(v as Action)}
              active
            />
          </Box>
          <GuidanceBox
            title="Portfolio Operations"
            what="Aggregates all app assessments into engagement-wide analysis and PowerBI export."
            details={[
              { label: 'Assess (LZR)', value: 'Landing-zone readiness across all apps' },
              { label: 'Export BI',    value: 'Portfolio bundle for swao-portfolio.pbit' },
            ]}
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'input-lz' && (
        <Box flexDirection="column">
          <Text>Action: <Text color="cyanBright">{labelFor(action)}</Text></Text>
          {lzOptions.length > 0 ? (
            <>
              <Box marginTop={1}>
                <Text dimColor>The Portfolio LZR pass reads landing-zone state files from each app's </Text>
                <Text color="cyanBright">wsp/inputs/terraform/</Text>
                <Text dimColor> directory. Discovered files:</Text>
              </Box>
              <Box marginTop={1}>
                <SelectInput
                  label="Pick a landing-zone label for this run"
                  options={lzOptions}
                  onSelect={(v) => { setLzId(v); setPhase('running'); }}
                  active
                />
              </Box>
            </>
          ) : (
            <>
              <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
                <Text bold color="yellow">No landing-zone input files found.</Text>
                <Text>The Portfolio LZR pass needs at least one of these in any</Text>
                <Text><Text color="cyanBright">apps/&lt;id&gt;/wsp/inputs/terraform/</Text> directory:</Text>
                <Box flexDirection="column" marginTop={1}>
                  <Text>  - <Text color="cyanBright">lz-meshstack-snapshot.json</Text> -- meshStack landing zone (recommended for PoC)</Text>
                  <Text>  - <Text color="cyanBright">lz-aws-snapshot.json</Text>      -- AWS landing zone</Text>
                  <Text>  - <Text color="cyanBright">lz-azure-snapshot.json</Text>    -- Azure landing zone</Text>
                  <Text>  - any <Text color="cyanBright">*.tfstate</Text> or <Text color="cyanBright">*.tfplan</Text> file</Text>
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>Sample stub files are in </Text>
                  <Text color="cyanBright">examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp/inputs/terraform/</Text>
                  <Text dimColor> in the SWAO repo.</Text>
                </Box>
              </Box>
              <Box marginTop={1}>
                <TextInput
                  key="input-lz"
                  label="Landing-zone label for this run (free-form, e.g. lz-stackit-de-01)"
                  placeholder="lz-stackit-de-01"
                  onSubmit={(v) => { if (v) { setLzId(v); setPhase('running'); } }}
                  active
                />
              </Box>
            </>
          )}
        </Box>
      )}

      {phase === 'running' && (
        <>
          <Box>
            <Text>Action: <Text color="cyanBright">{labelFor(action)}</Text></Text>
            {lzId && <Text dimColor>  LZ: {lzId}</Text>}
          </Box>
          <Text color="yellow">Running portfolio {action}...</Text>
          <LiveOutput lines={lines} maxLines={22} />
          <Box marginTop={1}>
            <Text dimColor>Escape to cancel...</Text>
          </Box>
        </>
      )}

      {/* #0417 (sprint-040 round-14): two-page export-done view mirroring
          ExportBiScreen. Page 1 = summary + "open PowerBI?" prompt.
          Page 2 = paths + hot-keys + GuidanceBox. Only fires for the
          export action; assess-lzr + report-lzr fall through to the
          generic 'done' state below. */}
      {phase === 'done-summary' && (
        <>
          <Box>
            <Text>Action: <Text color="cyanBright">{labelFor(action)}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>Portfolio export complete.</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text>  Bundle:   <Text color="cyanBright">{bundleDir || '(see live output for path)'}</Text></Text>
            <Text>  Apps:     <Text color="cyanBright">{assessedApps.length} ({assessedApps.join(', ')})</Text></Text>
            <Text>  Files:    <Text color="cyanBright">CSV star schema ({csvCount > 0 ? csvCount : 22} files) + NDJSON mirror + XLSX rollup</Text></Text>
            <Text>  Template: <Text color="cyanBright">swao-portfolio.pbit (cross-app rollup)</Text></Text>
          </Box>
          <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
            <Text bold>Want to load this into PowerBI Desktop now?</Text>
            <Text dimColor>The next page shows the paths + hot-keys to open the portfolio template directly.</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text color="cyanBright" bold>Enter</Text>  -- continue to PowerBI links</Text>
            <Text>  <Text color="cyanBright" bold>Escape</Text> -- return to main menu (bundle stays on disk)</Text>
          </Box>
          <GuidanceBox
            title="Portfolio export complete"
            what="Bundle written. Continue to open the portfolio template in PowerBI."
            details={[{ label: 'Note', value: 'Use SWAOPortfolioExportPath parameter (not SWAOExportPath)' }]}
            affordances={['Enter -- PowerBI links  |  Esc -- main menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'done-powerbi' && (
        <>
          <Box>
            <Text>Action: <Text color="cyanBright">{labelFor(action)}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>PowerBI portfolio artefacts ready.</Text>
          </Box>
          {bundleDir && (
            <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
              <Box>
                <Text bold color="cyanBright">1. SWAOPortfolioExportPath (press </Text>
                <Text bold color="cyanBright">C</Text>
                <Text bold color="cyanBright"> to copy):</Text>
              </Box>
              <Text bold color="whiteBright">{bundleDir}</Text>
            </Box>
          )}
          {pbitPath && (
            <Box marginTop={1}>
              <Text dimColor>2. Portfolio template (press </Text>
              <Text bold color="cyanBright">P</Text>
              <Text dimColor> to open): </Text>
              <Text color="whiteBright">{pbitPath}</Text>
            </Box>
          )}
          {actionToast && (
            <Box marginTop={1}>
              <Text color="yellow">{actionToast}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              Press {pbitPath ? 'P/' : ''}{bundleDir ? 'C/' : ''}Enter/Escape...
            </Text>
          </Box>
          <GuidanceBox
            title="Portfolio PowerBI"
            what="Open the portfolio template and copy the path into SWAOPortfolioExportPath."
            details={[
              { label: 'P', value: 'Open swao-portfolio.pbit in PowerBI Desktop' },
              { label: 'C', value: 'Copy SWAOPortfolioExportPath to clipboard' },
            ]}
            affordances={['P -- open  |  C -- copy  |  Enter/Esc -- main menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'done' && (
        <>
          <Box>
            <Text>Action: <Text color="cyanBright">{labelFor(action)}</Text></Text>
            {lzId && <Text dimColor>  LZ: {lzId}</Text>}
          </Box>
          {code === 0 && <Text color="green">Portfolio {action} complete.</Text>}
          {code !== 0 && <Text color="red">Finished with exit {code}. (Enterprise licence required for portfolio operations.)</Text>}
          <LiveOutput lines={lines} maxLines={22} />
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Escape to return to menu...</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
