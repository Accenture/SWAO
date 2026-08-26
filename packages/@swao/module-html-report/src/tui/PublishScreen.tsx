// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Publish HTML screen -- TUI entry for `swao publish`.
 * Mirrors ReportScreen pattern: select mode → select app ID → run command →
 * stream output → show output path.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { LicenseGuard } from '@swao/core';
import { HeaderView, type LicenseStateView } from '@swao/tui-kit';
import { LiveOutput } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { RunContextPicker } from '@swao/tui-kit';
import type { SelectedRunContext } from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type Phase = 'mode-select' | 'input-app' | 'input-evidence-url' | 'pick-run-context' | 'non-app-redirect' | 'editor-confirm' | 'running' | 'done' | 'error';

function getPublishAvailableTypes(wspDir: string): string[] {
  if (!existsSync(wspDir)) return [];
  const files = readdirSync(wspDir);
  return files
    .map((f: string) => /^latest-(.+)\.txt$/.exec(f)?.[1])
    .filter((t: string | undefined): t is string => t !== undefined);
}

type PublishMode = 'html' | 'site' | 'headless' | 'editor' | 'serve' | 'llm';

interface ModeEntry {
  key: string;
  mode: PublishMode;
  label: string;
  detail: string;
  what: string;
  output: string;
  tier: string;
  comingSoon?: boolean;
  advanced?: boolean;
}

const MODES: ModeEntry[] = [
  {
    key: '1', mode: 'html', label: 'Single-Page HTML Report',
    detail: 'swao publish --app / --lz / --llm',
    what: 'Publishes the selected assessment run type -- Application Assessment, Landing Zone Catalog, or LLM Assessment. Use the Run Context picker to choose between run types and historical runs.',
    output: 'apps/<id>/wsp/publications/',
    tier: 'Community+',
  },
  {
    key: '2', mode: 'editor', label: 'HTML Editor',
    detail: 'swao publish --edit',
    what: 'Opens the Publication Editor in your browser. Customise layout, blocks and style, then export the final HTML.',
    output: 'Browser at http://127.0.0.1:4001',
    tier: 'Consultant+',
  },
  {
    key: '4', mode: 'headless', label: 'JSON data export',
    detail: 'Coming soon',
    what: 'Raw publication-data.json for custom integrations. Planned for a future release.',
    output: '',
    tier: 'Community+',
    comingSoon: true,
  },
  {
    key: '5', mode: 'site', label: 'HTML Site',
    detail: 'Coming soon',
    what: 'Multi-page static site publication. Planned for a future release.',
    output: '',
    tier: 'Enterprise',
    comingSoon: true,
  },
  {
    key: '6', mode: 'serve', label: 'HTML Portal',
    detail: 'Coming soon',
    what: 'Live REST portal with write-back remediation. Planned for a future release.',
    output: '',
    tier: 'Enterprise',
    comingSoon: true,
  },
];

const ACTIVE_MODES = MODES.filter(m => !m.comingSoon);

function buildArgs(
  mode: PublishMode,
  appId: string,
  firstApp?: string,
  evidenceBaseUrl?: string,
  runCtx?: SelectedRunContext | null,
): string[] {
  switch (mode) {
    case 'html': {
      const args = ['publish', '--app', appId];
      if (evidenceBaseUrl) args.push('--evidence-base-url', evidenceBaseUrl);
      if (runCtx?.assessmentType === 'landing-zone-catalog') {
        args.push('--lz');
        if (runCtx.runTimestamp) args.push('--run', runCtx.runTimestamp);
      } else if (runCtx?.assessmentType === 'llm') {
        args.push('--llm');
        if (runCtx.runTimestamp) args.push('--run', runCtx.runTimestamp);
      }
      return args;
    }
    case 'llm': return ['publish', '--llm', '--app', appId];
    case 'headless': return ['publish', '--headless', '--app', appId];
    case 'editor': {
      // Auto-select first available app so preview loads immediately
      const editorApp = appId || firstApp || '';
      return editorApp ? ['publish', '--edit', '--app', editorApp] : ['publish', '--edit'];
    }
    default:         return ['publish', '--app', appId, '--open'];
  }
}

interface PublishScreenProps {
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
}

export function PublishScreen({ onBack, version }: PublishScreenProps) {
  const workspace = findWorkspace(process.cwd());

  // Local master-banner wrapper: closes over the host-injected version + the
  // licence state (LicenseGuard is in @swao/core). Memoised for a stable
  // identity so HeaderView (which holds resize state) does not remount. Lets
  // the existing `<Header subtitle=... />` call site stay unchanged. Mirrors
  // the #0573 DoctorScreen / #0553 AssessScreen pattern.
  const Header = useMemo(() => {
    let licenseState: LicenseStateView | null = null;
    let licenseError: string | null = null;
    try { licenseState = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { licenseError = (e as Error).message; }
    return function Header(props: { subtitle?: string; stepInfo?: string; hideLicenseStatus?: boolean }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={licenseState} licenseError={licenseError} />;
    };
  }, [version]);

  // Discover available apps from workspace apps/ directory
  const availableApps: string[] = (() => {
    if (!workspace) return [];
    const appsDir = join(workspace, 'apps');
    if (!existsSync(appsDir)) return [];
    try {
      return readdirSync(appsDir).filter(name =>
        existsSync(join(appsDir, name, 'wsp', 'runs')),
      );
    } catch {
      return [];
    }
  })();

  const [phase, setPhase]       = useState<Phase>('mode-select');
  const [mode, setMode]         = useState<PublishMode>('html');
  const [modeIdx, setModeIdx]   = useState(0);
  const [appId, setAppId]       = useState('');
  const [appInput, setAppInput] = useState('');
  const [appListIdx, setAppListIdx] = useState(0);
  const [evidenceBaseUrl, setEvidenceBaseUrl] = useState('');
  const [evidenceUrlInput, setEvidenceUrlInput] = useState('');
  const [lines, setLines]       = useState<string[]>([]);
  const [outputPath, setOutputPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [comingSoonMsg, setComingSoonMsg] = useState('');
  const [browserOpened, setBrowserOpened] = useState(false);
  const [publishRunCtx, setPublishRunCtx] = useState<SelectedRunContext | null>(null);

  function openInBrowser(filePath: string) {
    // In a pkg binary, process.execPath is the binary itself -- NOT Node.js.
    // The Node.js '-e helper' pattern does not work from a packaged binary.
    // Use platform open commands directly.
    // Path safety: outputPath comes from our own subprocess stdout (not user CLI
    // input), so injection risk is minimal; still reject obviously dangerous chars.
    const safe = filePath.replace(/[;&|`$<>]/g, '').trim();
    if (!safe) return;
    if (process.platform === 'win32') {
      // Use file:// URL so Windows routes through the URI protocol handler (default browser)
      // rather than the .html file-extension handler, which may differ from the default browser.
      // Percent-encode spaces; other reserved chars in drive path are safe.
      const fileUrl = 'file:///' + safe.replace(/\\/g, '/').replace(/ /g, '%20');
      spawn('cmd', ['/c', 'start', '', fileUrl], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [safe], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [safe], { detached: true, stdio: 'ignore' }).unref();
    }
    setBrowserOpened(true);
  }

  const currentModeObj = ACTIVE_MODES.find(m => m.mode === mode) ?? ACTIVE_MODES[0];

  // Reset to mode-select, clearing transient state
  function backToModeSelect() {
    setPhase('mode-select');
    setAppInput('');
    setAppListIdx(0);
    setEvidenceUrlInput('');
    setEvidenceBaseUrl('');
    setLines([]);
    setOutputPath('');
    setErrorMsg('');
  }

  const guidanceOpenRef = useRef(false);

  // Keyboard handling
  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (phase === 'mode-select') {
      if (key.escape || (key.ctrl && input === 'c')) { onBack(); return; }
      setComingSoonMsg('');
      // Arrow key navigation (active modes only)
      if (key.upArrow)   { setModeIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModeIdx(i => Math.min(ACTIVE_MODES.length - 1, i + 1)); return; }
      // Number shortcut -- active modes only
      const found = ACTIVE_MODES.find(m => m.key === input);
      const selected = found ?? ACTIVE_MODES[modeIdx];
      if (key.return || found) {
        if (!selected) return;
        setMode(selected.mode);
        setModeIdx(ACTIVE_MODES.indexOf(selected));
        // Editor: show confirmation screen before launching browser
        if (selected.mode === 'editor') { setPhase('editor-confirm'); return; }
        setPhase('input-app');
      }
      return;
    }

    // Esc always returns to mode-select (not root menu) except during active run
    if (key.escape || (key.ctrl && input === 'c')) {
      if (phase === 'running') {
        // interrupt in-progress publish; child.kill() is handled by useEffect cleanup
        backToModeSelect();
      } else {
        backToModeSelect();
      }
      return;
    }

    // 0 key: exit to main menu from done/error
    if (input === '0' && (phase === 'done' || phase === 'error')) {
      onBack(); return;
    }

    // O key: open published HTML in browser from done phase
    // O or Enter: open in browser from done phase
    if (phase === 'done' && outputPath && ((input === 'o' || input === 'O') || key.return)) {
      openInBrowser(outputPath);
      return;
    }

    // Q key: stop editor server while running
    if ((input === 'q' || input === 'Q') && phase === 'running' && mode === 'editor') {
      backToModeSelect();
      return;
    }

    // editor-confirm phase: Enter launches, Esc goes back
    if (phase === 'editor-confirm') {
      if (key.return) { setPhase('running'); return; }
      if (key.escape) { backToModeSelect(); return; }
    }

    if (phase === 'non-app-redirect' && key.escape) {
      backToModeSelect(); return;
    }

    if (phase === 'input-app') {
      // Arrow key navigation cycles the list when no text has been typed (#1771)
      if (key.upArrow && appInput === '') { setAppListIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow && appInput === '') { setAppListIdx(i => Math.min(availableApps.length - 1, i + 1)); return; }
      if (key.return) {
        const chosen = appInput.trim() || (availableApps[appListIdx] ?? '');
        if (!chosen) { setErrorMsg('No app ID entered and no apps detected.'); setPhase('error'); return; }
        setAppId(chosen);
        // For html mode, ask for optional evidence base URL before running
        if (mode === 'html') { setPhase('input-evidence-url'); return; }
        setPhase('running');
        return;
      }
      // Digit quick-select: pressing 1-9 when input is empty moves to the nth app
      const digit = parseInt(input, 10);
      if (!isNaN(digit) && digit >= 1 && digit <= availableApps.length && appInput === '') {
        setAppListIdx(digit - 1);
        setAppInput(availableApps[digit - 1] ?? '');
        return;
      }
      if (key.backspace || key.delete) {
        setAppInput(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setAppInput(prev => prev + input);
      }
    }

    if (phase === 'input-evidence-url') {
      if (key.return) {
        const url = evidenceUrlInput.trim();
        setEvidenceBaseUrl(url);
        // Show RunContextPicker for html mode when multiple types are present (#0786)
        if (workspace) {
          const wspDir = join(workspace, 'apps', appId, 'wsp');
          const types = getPublishAvailableTypes(wspDir);
          if (types.length > 1) { setPhase('pick-run-context'); return; }
        }
        setPhase('running');
        return;
      }
      if (key.backspace || key.delete) {
        setEvidenceUrlInput(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setEvidenceUrlInput(prev => prev + input);
      }
    }
  });

  // Run swao publish when phase transitions to 'running'
  useEffect(() => {
    if (phase !== 'running') return;
    // editor mode spawns without an explicit appId -- buildArgs falls back to firstApp
    if (!appId && mode !== 'editor') return;

    const child = spawn(BIN, [SELF, ...buildArgs(mode, appId, availableApps[0], evidenceBaseUrl, publishRunCtx)], {
      cwd: workspace ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const incoming = text.split('\n').filter(Boolean).map((l) => {
        // Replace "Publishing X from C:\...\<timestamp>" with a cleaner status line.
        const pathMatch = l.match(/Publishing .+ from [A-Za-z]:\\.*\\(\d{4}-\d{2}-\d{2}T[\d-]+)\s*$/);
        if (pathMatch) return `Run: ${pathMatch[1]}  --  generating...`;
        return l;
      });
      setLines(prev => [...prev, ...incoming]);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      // stdout carries the output path
      const path = chunk.toString('utf-8').trim();
      if (path) setOutputPath(path);
    });

    child.on('close', (code) => {
      if (code === 0) {
        setPhase('done');
      } else {
        // Use last non-empty stderr line as the displayed error; fall back to a
        // generic message if stderr was empty (e.g. process killed).
        setLines(prev => {
          const last = [...prev].reverse().find(l => l.trim().length > 0);
          setErrorMsg(last ?? 'Publication failed -- check the output above for details.');
          return prev;
        });
        setPhase('error');
      }
    });

    return () => { child.kill(); };
  }, [phase, appId, mode, workspace, evidenceBaseUrl, publishRunCtx]);

  // Quick-select digits for common app IDs
  const appsForDisplay = availableApps.slice(0, 9);

  // #1772: show mode-specific subtitle in done/running/error phases; workspace path otherwise.
  const headerSubtitle = (phase === 'done' || phase === 'running' || phase === 'error')
    ? (publishRunCtx?.assessmentType === 'llm'
        ? 'Publish -- LLM Assessment'
        : publishRunCtx?.assessmentType === 'landing-zone-catalog'
          ? 'Publish -- LZ Assessment'
          : 'Publish -- App Assessment')
    : `workspace: ${workspace ?? '(none)'}`;

  return (
    <Box flexDirection="column">
      <Header subtitle={headerSubtitle} />

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box>
          <Text bold color="cyanBright">Publish</Text>
          {phase !== 'mode-select' && (
            <Text color="gray"> -- {currentModeObj?.label}</Text>
          )}
        </Box>
        <Text color="gray">
          {phase === 'mode-select'
            ? 'Select an option, then choose the app to publish.'
            : currentModeObj?.detail ?? ''}
        </Text>
      </Box>

      {phase === 'mode-select' && (
        <Box flexDirection="column" paddingX={1}>
          {ACTIVE_MODES.map((m, activeIdx) => {
            const active = activeIdx === modeIdx;
            return (
              <Box key={m.mode}>
                <Text color={active ? 'cyan' : undefined}>{active ? '> ' : '  '}</Text>
                <Text color="yellow">[{m.key}]</Text>
                <Text> </Text>
                <Text bold color={active ? 'cyan' : undefined}>
                  {m.label}
                </Text>
                <Text color="gray">  {m.detail}{m.advanced ? '  [advanced]' : ''}</Text>
              </Box>
            );
          })}
          {comingSoonMsg ? (
            <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
              <Text color="yellow">{comingSoonMsg}  Press Esc to go back.</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <GuidanceBox
                title={`${ACTIVE_MODES[modeIdx]?.label ?? ''}`}
                what={ACTIVE_MODES[modeIdx]?.what ?? ''}
                details={ACTIVE_MODES[modeIdx]?.output
                  ? [{ label: 'Output', value: ACTIVE_MODES[modeIdx]?.output ?? '' }]
                  : []}
                affordances={['Up/Down or 1, 2 -- select', 'Enter -- confirm', 'Esc -- back']}
                initiallyCollapsed
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            </Box>
          )}
        </Box>
      )}

      {phase === 'input-app' && (
        <Box flexDirection="column" paddingX={2}>
          {availableApps.length > 0 ? (
            <>
              <Text>Available apps in this workspace:</Text>
              {appsForDisplay.map((a, i) => {
                const isSelected = i === appListIdx && appInput === '';
                return (
                  <Box key={a}>
                    <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '> ' : '  '}</Text>
                    <Text color={isSelected ? 'cyan' : 'yellow'}>{i + 1}. {a}</Text>
                  </Box>
                );
              })}
              <Box marginTop={1}>
                <Text>App ID: </Text>
                <Text color="green">{appInput || (availableApps[appListIdx] ?? '')}</Text>
                <Text color="gray">{appInput ? '' : ' (Enter to confirm)'}</Text>
              </Box>
            </>
          ) : (
            <Box flexDirection="column">
              <Text color="yellow">No assessed apps found in {workspace ?? process.cwd()}.</Text>
              <Text color="gray">Run swao assess first, then return here.</Text>
              <Box marginTop={1}>
                <Text>App ID: </Text>
                <Text color="green">{appInput}</Text>
              </Box>
            </Box>
          )}
          <GuidanceBox
            title={`${currentModeObj?.label ?? 'Publish'} -- Select App`}
            what={currentModeObj?.what ?? ''}
            details={currentModeObj?.output ? [{ label: 'Output', value: currentModeObj.output }] : []}
            affordances={[
              availableApps.length > 1 ? '1-9 -- quick-select app from list' : 'Enter -- use first app',
              'Enter -- confirm  |  Esc -- back',
            ]}
            initiallyCollapsed
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
          <Text color="gray" dimColor>Enter: confirm | Esc: back to mode select</Text>
        </Box>
      )}

      {phase === 'input-evidence-url' && (
        <Box flexDirection="column" paddingX={2}>
          <Box marginBottom={1}>
            <Text>Evidence base URL </Text>
            <Text>(optional -- press Enter to skip):</Text>
          </Box>
          <Box>
            <Text>URL: </Text>
            {evidenceUrlInput
              ? <Text color="green">{evidenceUrlInput}</Text>
              : <Text dimColor>https://github.com/your-org/your-repo/tree/main/apps/sovereign-health/wsp/inputs</Text>
            }
          </Box>
          <GuidanceBox
            title="Evidence base URL"
            what="Set a base URL so evidence file links resolve when the HTML report is shared without the local wsp/inputs/ directory."
            details={[{
              label: 'Example',
              value: 'https://github.com/your-org/your-repo/tree/main/apps/sovereign-health/wsp/inputs',
            }]}
            affordances={['Enter -- confirm (or skip if blank)  |  Esc -- back to mode select']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'pick-run-context' && workspace && (
        <Box flexDirection="column" paddingX={2}>
          <RunContextPicker
            wspDir={join(workspace, 'apps', appId, 'wsp')}
            onSelect={(ctx) => {
              setPublishRunCtx(ctx);
              if (ctx.assessmentType === 'application' || ctx.assessmentType === 'landing-zone-catalog' || ctx.assessmentType === 'llm') {
                setPhase('running');
              } else {
                setPhase('non-app-redirect');
              }
            }}
            onCancel={backToModeSelect}
          />
        </Box>
      )}

      {phase === 'non-app-redirect' && (
        <Box flexDirection="column" paddingX={2}>
          <Text color="yellow">
            HTML publication for {publishRunCtx?.assessmentType} assessment type is coming soon.
          </Text>
          <Text dimColor>
            Use <Text bold>swao publish --lz --app &lt;id&gt;</Text> for Landing Zone, <Text bold>swao publish --llm --app &lt;id&gt;</Text> for LLM Assessment.
          </Text>
          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Esc</Text> to go back to mode select.</Text>
          </Box>
          <GuidanceBox
            title="HTML Publication -- coming soon"
            what="Single-page HTML publication for this assessment type is not yet available. Application and Landing Zone Catalog assessments are fully supported."
            details={[
              { label: 'Available now', value: 'Application Assessment -- use Full Assessment Report (1)' },
              { label: 'Available now', value: 'Landing Zone Assessment -- use Full Assessment Report (1)' },
              { label: 'Coming soon',   value: 'LLM Assessment -- future milestone' },
              { label: 'Coming soon',   value: 'Audit, Hybrid -- future milestone' },
            ]}
            affordances={['Esc -- go back to mode select']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'editor-confirm' && (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          <Text bold color="cyanBright">HTML Editor</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Opens the SWAO HTML Editor in your browser.</Text>
            <Box marginTop={1}>
              <Text color="gray">Your browser will open at: </Text>
              <Text color="cyanBright" bold>http://127.0.0.1:4001</Text>
            </Box>
          </Box>
          <Box marginTop={2} flexDirection="column">
            <Text>  <Text color="cyanBright" bold>[Enter]</Text>  Launch editor</Text>
            <Text>  <Text color="gray">[Esc]  </Text>  Back</Text>
          </Box>
        </Box>
      )}

      {phase === 'running' && mode === 'editor' && (
        <Box flexDirection="column" paddingX={2}>
          <Text color="green" bold>HTML Editor running</Text>
          <Box marginTop={1}>
            <Text color="gray">Browser: </Text>
            <Text color="cyanBright" bold>http://127.0.0.1:4001</Text>
          </Box>
          <LiveOutput lines={lines} maxLines={12} />
          <Box marginTop={1}>
            <Text color="gray" dimColor>[Q] Stop editor and return to menu</Text>
          </Box>
          <GuidanceBox
            title="HTML Editor"
            what="Customise the HTML publication layout, block order, and branding directly in your browser."
            details={[
              { label: 'Layout tab',  value: 'Toggle top-nav links and reorder sidebar items' },
              { label: 'Content tab', value: 'Enable or disable report blocks; set classification band' },
              { label: 'Style tab',   value: 'Adjust brand colours and presets' },
            ]}
            affordances={['[Q] -- stop editor and return  |  browser at http://127.0.0.1:4001']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'running' && mode !== 'editor' && (
        <Box flexDirection="column" paddingX={2}>
          <Text color="cyanBright">Publishing <Text bold>{appId}</Text>
            {publishRunCtx?.assessmentType === 'landing-zone-catalog'
              ? ' -- LZ Catalogue Assessment'
              : publishRunCtx?.assessmentType === 'llm'
                ? ' -- LLM Assessment'
                : publishRunCtx
                  ? ' -- Application Assessment'
                  : ''}...
          </Text>
          <LiveOutput lines={lines} maxLines={10} />
          <Box marginTop={1}>
            <GuidanceBox
              title="Publishing"
              what="Generating HTML report. When complete, press O to open in browser."
              affordances={['Esc -- cancel']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {phase === 'done' && (
        <Box flexDirection="column" paddingX={2}>
          <Text color="green" bold>Publication complete.</Text>
          {outputPath && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="white">Output: <Text color="cyanBright">{outputPath}</Text></Text>
              <Box marginTop={1}>
                <Text bold color="cyanBright">[Enter]</Text>
                <Text color="white"> Open in browser</Text>
                <Text color="gray" dimColor>  (also: letter O)</Text>
                {browserOpened && <Text color="green">  (opened)</Text>}
              </Box>
            </Box>
          )}
          <Box marginTop={1}>
            <LiveOutput lines={lines} maxLines={10} />
          </Box>
          <Box marginTop={1}>
            <GuidanceBox
              title="Done"
              what="Press Enter or O (letter) to open the HTML report in your default browser."
              affordances={['Enter/O -- open  |  Esc -- back  |  Backspace -- main menu']}
              initiallyCollapsed
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
          <Text color="gray" dimColor>Enter/O(letter): open in browser  |  Esc: back</Text>
        </Box>
      )}

      {phase === 'error' && (
        <Box flexDirection="column" paddingX={2}>
          <Text color="red" bold>Publication failed.</Text>
          <Text color="red">{errorMsg}</Text>
          <LiveOutput lines={lines} maxLines={15} />
          <Box marginTop={1}>
            <GuidanceBox
              title="Publication Error"
              what="The error message above explains what went wrong. Most common cause: the selected app has no completed assessment run. Run Assessment first (menu option 3), then return here."
              affordances={['Esc -- back to publish menu  |  0 -- main menu']}
              initiallyCollapsed
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
          <Text color="gray" dimColor>Esc: back to Publish menu | 0: main menu</Text>
        </Box>
      )}
    </Box>
  );
}
