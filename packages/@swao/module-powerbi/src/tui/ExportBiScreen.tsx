// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
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
import { HeaderView, type LicenseStateView, TextInput, SelectInput, MultiSelect, LiveOutput, GuidanceBox } from '@swao/tui-kit';
import { findWorkspace, LicenseGuard } from '@swao/core';
import { openWithDefaultApp, copyToClipboard } from '@swao/core';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type Phase =
  | 'input-app'
  | 'input-target'
  | 'input-advanced-choice'  // #0735 -- gate: export-now shortcut vs optional steps 3-5
  | 'input-output'   // #0259.C2 -- --output path override (optional)
  | 'input-since'    // #0259.C2 -- --since ISO timestamp filter (optional)
  | 'input-options'
  | 'running'
  // #0411 (sprint-040 round-11): split the export-done state into two
  // pages so the tall content fits any terminal height. Page 1 = summary
  // + "open PowerBI?" prompt. Page 2 = the four PowerBI paths + hot-keys
  // + GuidanceBox.
  | 'done-summary'
  | 'done-powerbi'
  | 'done';

// #0259 -- CLI/TUI parity. CLI export accepts --no-bom and --crlf for
// platform-compatibility scenarios (Excel-unfriendly downstream tools,
// Windows-default CRLF). Exposed here as opt-in toggles; default
// behaviour (BOM on, LF) is unchanged.
const EXPORT_FLAG_OPTIONS = [
  { label: 'Suppress UTF-8 BOM (--no-bom) -- for downstream tools that choke on the BOM byte sequence', value: 'no-bom' },
  { label: 'Use Windows CRLF line endings (--crlf) -- otherwise LF',                                    value: 'crlf'   },
];

// Tier-2 submenu under "Export BI". Star-schema export drives PowerBI
// today; Tableau template ships in a later sprint (#0184).
const TARGET_OPTIONS = [
  { label: 'Star schema for PowerBI  -- CSV + NDJSON + XLSX bundle for swao-report.pbit', value: 'powerbi' },
  { label: 'Star schema for Tableau  -- [coming soon, #0184]',                              value: 'tableau' },
];

// #0735 -- default path skips the three optional steps (output, since, flags).
// Advanced path threads through them for power users who need overrides.
const ADVANCED_CHOICE_OPTIONS = [
  { label: 'Export now  -- use defaults (recommended)', value: 'now' },
  { label: 'Configure advanced options  -- output path, date filter, encoding', value: 'advanced' },
];

interface ExportBiScreenProps {
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function ExportBiScreen({ onBack, version }: ExportBiScreenProps) {
  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call sites stay unchanged. Mirrors
  // the #0573 DoctorScreen / #0578 GenerateTfScreen pattern. Export BI is
  // Community tier (ungated; the .pbit templates are public artefacts), so this
  // screen has no LicenseGate -- the only tier gate is the CLI's --portfolio
  // requireTier('enterprise') check, which lives in export.ts.
  const Header = useMemo(() => {
    let licenseStateView: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseStateView = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseStateView} licenseError={licenseError} />;
    };
  }, [version]);

  const workspace = findWorkspace(process.cwd());

  // Apps that have an application-type assessment run. Prefer
  // latest-application.txt (sprint-076 type-aware pointer); fall back to
  // latest.txt only when no type-specific pointers exist (pre-sprint-076
  // legacy workspaces). Apps that only have non-application runs (e.g. an
  // LZ catalog run) are excluded -- the star schema requires application
  // pass data (#0786).
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

  const [phase, setPhase]     = useState<Phase>('input-app');
  const [app, setApp]         = useState('');
  const [target, setTarget]   = useState('');
  const [notice, setNotice]   = useState('');
  const [lines, setLines]     = useState<string[]>([]);
  const [done, setDone]       = useState(false);
  const [code, setCode]       = useState<number | null>(null);
  const [bundleDir, setBundleDir] = useState('');
  const [csvCount, setCsvCount]   = useState(0);
  const [pbitPath, setPbitPath]   = useState('');           // app-report template
  const [portfolioPbitPath, setPortfolioPbitPath] = useState(''); // #0408 -- portfolio template
  const [flagOpts, setFlagOpts]   = useState<string[]>([]);  // #0259: --no-bom / --crlf toggles
  const [outputDir, setOutputDir] = useState('');   // #0259.C2: --output override (empty = use default wsp/exports/<ts>/)
  const [since, setSince]         = useState('');   // #0259.C2: --since ISO timestamp filter (empty = full bundle)

  useEffect(() => {
    if (phase !== 'running') return;
    if (target !== 'powerbi') {
      // Tableau path is a stub today -- show the message and stop.
      setLines([
        'Tableau export not yet implemented.',
        '',
        'A .twb template is planned for delivery alongside the next sprint.',
        'For now, use Star schema for PowerBI -- the resulting CSV bundle',
        'is consumable by Tableau too (Tableau opens any RFC-4180 CSV).',
      ]);
      setDone(true);
      setCode(0);
      setPhase('done');
      return;
    }

    // Run swao export --app <id> --formats csv,ndjson,xlsx in-process.
    const args = ['export', '--app', app, '--formats', 'csv,ndjson,xlsx'];
    if (flagOpts.includes('no-bom')) args.push('--no-bom');
    if (flagOpts.includes('crlf'))   args.push('--crlf');
    // #0259.C2 -- forward optional --output + --since overrides. CLI
    // currently warns these are not-yet-wired; the TUI plumbing is the
    // parity work.
    if (outputDir.trim()) args.push('--output', outputDir.trim());
    if (since.trim())     args.push('--since',  since.trim());

    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: workspace ?? undefined,
    });

    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      setLines(prev => [...prev, ...text.split('\n').filter(Boolean)]);
      // Capture the star/ directory and CSV file count from the export's "[ok]" line.
      // Format: [ok]  Star CSV bundle written  ->  <path>/star  (N files, M rows total)
      const starMatch = text.match(/\[ok\]\s+Star CSV bundle written\s+->\s+(\S+[/\\]star[/\\]?)\s+\((\d+)\s+files/);
      if (starMatch) {
        setBundleDir(((starMatch[1] ?? '').trim()).replace(/[/\\]$/, ''));
        if (starMatch[2]) setCsvCount(parseInt(starMatch[2], 10));
      }
      // #0408 (sprint-040 round-7): capture BOTH .pbit paths emitted by
      // the export -- swao-report.pbit (per-app template, SWAOWorkspaceRoot
      // = <ws>/apps/<id>) and swao-portfolio.pbit (cross-app rollup,
      // SWAOWorkspaceRoot = <ws>). Operator opens either directly via A/P.
      const pbitMatches = text.matchAll(/\[ok\]\s+PowerBI template ready\s+->\s+(\S+\.pbit)/g);
      for (const m of pbitMatches) {
        const p = (m[1] ?? '').trim();
        if (/swao-portfolio\.pbit$/i.test(p)) setPortfolioPbitPath(p);
        else                                  setPbitPath(p);
      }
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      setCode(exitCode);
      setDone(true);
      // #0411: split done into two pages. On success, land on the summary
      // page first; the operator presses Enter (or chooses Yes in the
      // SelectInput) to advance to the powerbi-links page. On failure go
      // straight to a generic 'done' state showing LiveOutput so the
      // error is visible.
      setPhase((exitCode === 0 && target === 'powerbi') ? 'done-summary' : 'done');
    });
    return () => { child.kill(); };
  }, [phase]);

  // #0408 (round-7): brief feedback line after a key launches PowerBI or
  // copies a path -- without it the keypress feels unresponsive.
  const [actionToast, setActionToast] = useState('');
  const toast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(''), 2500);
  };

  const guidanceOpenRef = useRef(false);

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    // #0411: page-1 (done-summary) Enter advances to page-2, Escape returns
    // to main menu. Page-2 (done-powerbi) Enter/Escape returns to main menu.
    // Generic 'done' (failure path) Enter/Escape returns to main menu.
    if (phase === 'done-summary' && key.return) setPhase('done-powerbi');
    if (phase === 'done-summary' && key.escape) onBack();
    if (phase === 'done-powerbi' && (key.return || key.escape)) onBack();
    if (phase === 'done' && (key.return || key.escape)) onBack();
    if (!done && key.escape) onBack();
    // After a successful export, hot-keys to open the templates (A/P) + copy
    // SWAOWorkspaceRoot (W/V). Lowercase + uppercase both fire so caps-lock
    // does not bite. Silent no-op when path is not known yet. Active on the
    // done-powerbi page only (Enter on done-summary already advances there).
    if (phase === 'done-powerbi' && code === 0) {
      // A/P -- open templates; W/V -- copy SWAOWorkspaceRoot for report/portfolio.
      // Lowercase + uppercase both fire so caps-lock does not bite.
      if ((input === 'a' || input === 'A') && pbitPath) {
        toast(openWithDefaultApp(pbitPath) ? `Opening report template -> ${pbitPath}` : `Could not open ${pbitPath} (no file association?)`);
      }
      if ((input === 'p' || input === 'P') && portfolioPbitPath) {
        toast(openWithDefaultApp(portfolioPbitPath) ? `Opening portfolio template -> ${portfolioPbitPath}` : `Could not open ${portfolioPbitPath}`);
      }
      // W -- SWAOWorkspaceRoot for swao-report.pbit (app-level).
      // SWAOExportPath + EvidenceUrlPrefix are derived from this in the template.
      if ((input === 'w' || input === 'W') && workspace && app) {
        const wsRoot = join(workspace, 'apps', app);
        toast(copyToClipboard(wsRoot) ? `Copied SWAOWorkspaceRoot to clipboard: ${wsRoot}` : 'Clipboard copy failed');
      }
      // V -- SWAOWorkspaceRoot for swao-portfolio.pbit (workspace-level root).
      if ((input === 'v' || input === 'V') && workspace && portfolioPbitPath) {
        toast(copyToClipboard(workspace) ? `Copied portfolio SWAOWorkspaceRoot to clipboard: ${workspace}` : 'Clipboard copy failed');
      }
    }
  });

  const handleTargetSelect = (v: string) => {
    setTarget(v);
    if (v === 'tableau') {
      setNotice('Tableau template export is not yet implemented (tracked as #0184). Use PowerBI for now.');
      setPhase('running');
    } else {
      setNotice('');
      setPhase('input-advanced-choice');  // #0735 -- offer export-now vs advanced options
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Export BI" />

      {phase === 'input-app' && (
        <Box flexDirection="column">
          {workspace
            ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
            : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
          <Box marginTop={1}>
            {assessedApps.length > 0 ? (
              <SelectInput
                label="Select application to export"
                options={assessedApps.map(a => ({ label: a, value: a }))}
                onSelect={(v) => { setApp(v); setPhase('input-target'); }}
                active
              />
            ) : (
              <>
                <Text color="yellow">No assessed apps found. Run an assessment first.</Text>
                <Box marginTop={1}>
                  <TextInput
                    key="input-app"
                    label="App ID (will fail if no wsp/ runs exist)"
                    placeholder="sovereign-health"
                    onSubmit={(v) => { if (v) { setApp(v); setPhase('input-target'); } }}
                    active
                  />
                </Box>
              </>
            )}
          </Box>
          <GuidanceBox
            title="Export BI"
            what="Emits CSV + NDJSON + XLSX bundle for PowerBI from the latest assessment."
            affordances={['Up/Down -- pick app  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'input-target' && (
        <>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1}>
            <SelectInput
              label="Export target"
              options={TARGET_OPTIONS}
              onSelect={handleTargetSelect}
              active
            />
          </Box>
          <GuidanceBox
            title="Export target"
            what="Select the BI tool. PowerBI is the active target; Tableau support is coming soon."
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'input-advanced-choice' && (
        <>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Text>Target: <Text color="cyanBright">{target}</Text></Text>
          <Box marginTop={1}>
            <SelectInput
              label="Export options"
              options={ADVANCED_CHOICE_OPTIONS}
              onSelect={(v) => {
                if (v === 'now') setPhase('running');
                else setPhase('input-output');
              }}
              active
            />
          </Box>
          <GuidanceBox
            title="Export options"
            what="Defaults: output to wsp/exports/<ts>/, full bundle, UTF-8 BOM, LF line endings."
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'input-output' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Text dimColor>Overrides the default wsp/exports/&lt;ts&gt;/ output path.</Text>
          <Text dimColor>Press Enter on blank to keep the default location.</Text>
          <Box marginTop={1}>
            <TextInput
              key="input-output"
              label="Output directory override (optional)"
              placeholder="C:/path/to/exports"
              onSubmit={(v) => { setOutputDir(v); setPhase('input-since'); }}
              active
            />
          </Box>
          <GuidanceBox
            title="Output directory"
            what="Override the default export path. Enter for default per-app location."
            details={[{ label: 'Format', value: 'Absolute path; folder created if missing' }]}
            affordances={['Enter -- confirm or skip  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'input-since' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Text dimColor>Filter signals/controls with assessed_at &gt;= this timestamp.</Text>
          <Text dimColor>ISO format (e.g. 2026-05-01T00:00:00Z). Enter on blank for full bundle.</Text>
          <Box marginTop={1}>
            <TextInput
              key="input-since"
              label="Since timestamp (optional, ISO)"
              placeholder="2026-05-01T00:00:00Z"
              onSubmit={(v) => { setSince(v); setPhase('input-options'); }}
              active
            />
          </Box>
          <GuidanceBox
            title="Since timestamp"
            what="Filter bundle to signals assessed at or after this date. Enter for full bundle."
            details={[{ label: 'Format', value: 'ISO 8601 (e.g. 2026-05-01T00:00:00Z)' }]}
            affordances={['Enter -- confirm or skip  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'input-options' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Text>Target: <Text color="cyanBright">{target}</Text></Text>
          {outputDir && <Text dimColor>Output override: <Text color="cyanBright">{outputDir}</Text></Text>}
          {since     && <Text dimColor>Since filter:    <Text color="cyanBright">{since}</Text></Text>}
          <Box marginTop={1}>
            <MultiSelect
              label="Optional export flags (Enter alone = use defaults: UTF-8 BOM + LF)"
              options={EXPORT_FLAG_OPTIONS}
              onConfirm={(vals) => { setFlagOpts(vals); setPhase('running'); }}
              allowEmptyConfirm
              active
            />
          </Box>
          <GuidanceBox
            title="Export flags"
            what="Defaults work for PowerBI on Windows. Leave unchanged unless your tool requires otherwise."
            details={[
              { label: 'UTF-8 BOM',    value: 'Default ON -- required by Excel + PowerBI' },
              { label: 'Line endings', value: 'Default LF -- PowerBI handles both' },
            ]}
            affordances={['Space -- toggle  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {/* Running phase: progress + LiveOutput. */}
      {phase === 'running' && (
        <>
          <Box>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text dimColor>  target: {target}</Text>
          </Box>
          {notice && <Text color="yellow">{notice}</Text>}
          <Text color="yellow">Emitting BI bundle...</Text>
          <LiveOutput lines={lines} maxLines={20} />
          <Box marginTop={1}>
            <Text dimColor>Escape to cancel...</Text>
          </Box>
        </>
      )}

      {/* #0411 (sprint-040 round-11): two-page export-success view.
          Page 1 = success summary + "open PowerBI?" question.
          Page 2 = the four PowerBI paths + hot-keys + GuidanceBox.
          Splitting keeps each page short enough to fit any terminal. */}
      {phase === 'done-summary' && (
        <>
          <Box>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text dimColor>  target: {target}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>BI export complete.</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text>  Star schema: <Text color="cyanBright">{bundleDir || '(see live output for path)'}</Text></Text>
            {bundleDir ? (
              <Text>  XLSX rollup: <Text color="cyanBright">{bundleDir.replace(/[/\\]star$/, '')}{process.platform === 'win32' ? '\\' : '/'}xlsx{process.platform === 'win32' ? '\\' : '/'}swao-export.xlsx</Text></Text>
            ) : null}
            <Text>  App:         <Text color="cyanBright">{app}</Text></Text>
            <Text>  Files:       <Text color="cyanBright">CSV star schema ({csvCount > 0 ? csvCount : 22} files) + NDJSON mirror + XLSX rollup</Text></Text>
            <Text>  Templates:   <Text color="cyanBright">swao-report.pbit{portfolioPbitPath ? ' + swao-portfolio.pbit' : ''}</Text></Text>
          </Box>
          <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1} width={72}>
            <Text bold wrap="wrap">Want to load these into PowerBI Desktop now?</Text>
            <Text dimColor wrap="wrap">The next page shows the SWAOWorkspaceRoot values to paste into PBI Desktop + hot-keys to open the templates directly.</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text color="cyanBright">Enter</Text>  -- continue to PowerBI links</Text>
            <Text>  <Text color="cyanBright">Escape</Text> -- return to main menu (paths still on disk + in the manifest)</Text>
          </Box>
          <GuidanceBox
            title="Export complete"
            what="Bundle written. Continue to see PowerBI paths and open templates."
            affordances={['Enter -- PowerBI links  |  Esc -- main menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'done-powerbi' && (
        <>
          <Box>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text dimColor>  target: {target}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>PowerBI artefacts ready.</Text>
          </Box>
          {/* #0734 -- portfolio items (P/V) are intentionally absent: this screen
              is always per-app; a portfolio export screen will surface them there. */}
          {pbitPath && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>{'Step 1:  Open the report template'}</Text>
              <Box marginLeft={2}>
                <Text dimColor>{'Press '}</Text>
                <Text bold color="cyanBright">A</Text>
                <Text dimColor>{' to open -- '}</Text>
                <Text color="whiteBright" wrap="truncate-end">{pbitPath}</Text>
              </Box>
            </Box>
          )}
          {workspace && app && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>{'Step 2:  Set SWAOWorkspaceRoot in PowerBI Desktop'}</Text>
              <Box marginLeft={2} flexDirection="column">
                <Box>
                  <Text dimColor>{'SWAOWorkspaceRoot (press '}</Text>
                  <Text bold color="cyanBright">W</Text>
                  <Text dimColor>{' to copy): '}</Text>
                  <Text color="whiteBright" wrap="truncate-end">{join(workspace, 'apps', app)}</Text>
                </Box>
                <Text dimColor>{'  Open swao-report.pbit in PowerBI Desktop, then Home > Transform Data > Edit Parameters.'}</Text>
              </Box>
            </Box>
          )}
          {actionToast && (
            <Box marginTop={1}>
              <Text color="yellow">{actionToast}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              {'Press '}{pbitPath ? 'A/' : ''}{workspace && app ? 'W/' : ''}{'Enter/Escape...'}
            </Text>
          </Box>
          <GuidanceBox
            title="PowerBI"
            what="SWAOExportPath and EvidenceUrlPrefix derive automatically from SWAOWorkspaceRoot. New workspace: one-time manual setup required in PBI Desktop."
            details={[
              { label: 'A',          value: 'Open app report template in PowerBI Desktop' },
              { label: 'W',          value: 'Copy SWAOWorkspaceRoot to clipboard' },
              { label: 'First time', value: 'Open pbit (A), Home > Edit Parameters, paste SWAOWorkspaceRoot (W), click OK. Same workspace next run: open + refresh, no entry needed.' },
            ]}
            affordances={['A -- open  |  W -- copy  |  Enter/Esc -- main menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {/* Generic 'done' state -- failure path. Keep LiveOutput visible for debug. */}
      {phase === 'done' && (
        <>
          <Box>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text dimColor>  target: {target}</Text>
          </Box>
          {notice && <Text color="yellow">{notice}</Text>}
          {code === 0 && target === 'tableau' && <Text color="yellow">Tableau target is a placeholder. PowerBI still works -- re-run and pick PowerBI.</Text>}
          {code !== 0 && <Text color="red">Export finished with warnings (exit {code}).</Text>}
          <LiveOutput lines={lines} maxLines={20} />
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Escape to return to menu...</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
