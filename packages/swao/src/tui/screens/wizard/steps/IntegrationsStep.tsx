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

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { findInstalledChromium, PLAYWRIGHT_VERSION, resolveClaudeDesktopConfigs, selectClaudeDesktopPatchTargets, type ClaudeDesktopConfigCandidate } from '@swao/core';
import { GuidanceBox } from '@swao/tui-kit';
import { _wizardGuidanceOpen, setWizardGuidanceOpen } from '../shared.js';
import { formatMcpRegistrationRefusal, mcpRegistrationRefusal, patchAllClaudeDesktopConfigs, resolveStableBinary, stableCopyWarning, type ClaudeDesktopPatchOutcome, type StableBinaryResolution } from '../../../mcp-config.js';

// #3217: the stable binary path (a stable copy next to the running SWAO
// binary, #2908; node plus the script path on a source run, #3286) comes from
// the shared resolver in mcp-config.ts, the same one `swao init --mcp` and
// `swao mcp install` use.

/** #3216: Claude Desktop config state, resolved once per step mount. */
interface ClaudeDesktopConfigState {
  candidates: ClaudeDesktopConfigCandidate[];
  configPath: string;
  installed: boolean;
  targets: ClaudeDesktopConfigCandidate[];
}

function resolveConfigState(resolveConfigs: () => ClaudeDesktopConfigCandidate[]): ClaudeDesktopConfigState {
  // #3163: every Claude Desktop config (MSIX virtualised + conventional), not
  // only the effective one, so a stale SWAO entry in the other config is updated.
  const candidates = resolveConfigs();
  // Same rule as claudeDesktopConfigPath(): the effective config, else the first.
  const configPath = (candidates.find((c) => c.effective) ?? candidates[0])?.path ?? '';
  const installed = candidates.some((c) => existsSync(c.path));
  const targets = installed ? selectClaudeDesktopPatchTargets(candidates) : [];
  return { candidates, configPath, installed, targets };
}

// -- Step 4: Claude Desktop MCP config ------------------------------------

export interface ClaudeDesktopStepProps {
  workDir: string;
  onNext: () => void;
  /** #3216: injectable for tests; defaults to resolveClaudeDesktopConfigs. */
  resolveConfigs?: () => ClaudeDesktopConfigCandidate[];
  /** #3216 / #3217: injectable for tests; defaults to the shared stable-copy resolver. */
  resolveBinary?: () => StableBinaryResolution;
  /**
   * #3341: the MCP registration gate shared with `swao mcp install` and
   * `swao init --mcp` (licence tier and binary edition). Returns the [LICENSE]
   * text when registration is refused, undefined when allowed. Injectable for tests.
   */
  checkLicence?: () => string | undefined;
}

/** #3341: default wizard gate, same decision as the CLI entry points. */
export function defaultMcpWizardLicenceCheck(): string | undefined {
  const r = mcpRegistrationRefusal();
  return r ? formatMcpRegistrationRefusal(r, 'MCP server registration') : undefined;
}

export function ClaudeDesktopStep({
  workDir,
  onNext,
  resolveConfigs = resolveClaudeDesktopConfigs,
  resolveBinary = () => resolveStableBinary(),
  checkLicence = defaultMcpWizardLicenceCheck,
}: ClaudeDesktopStepProps) {
  // #3341: evaluated once per mount, before any copy or config write.
  const [licenceRefusal] = useState<string | undefined>(() => checkLicence());
  // #3216: resolve and read the configs once per step mount (lazy initial
  // state), not on every Ink render.
  const [{ candidates, configPath, installed, targets }] = useState<ClaudeDesktopConfigState>(
    () => resolveConfigState(resolveConfigs),
  );

  const [status, setStatus] = useState<'idle' | 'done' | 'skipped'>('idle');
  const [outcomes, setOutcomes] = useState<ClaudeDesktopPatchOutcome[]>([]);
  // #3286 (Design 110 D-10): copy failure shown like `mcp install` and `init` print it.
  const [copyWarning, setCopyWarning] = useState<string[] | undefined>(undefined);

  const doSkip = () => { setStatus('skipped'); onNext(); };
  const doPatch = () => {
    if (licenceRefusal !== undefined) return; // #3341: never copy or write below Enterprise
    // #3216: the binary copy is a side effect, so it runs only on the user's
    // Enter (the path is not displayed before then), never during render.
    // #3217: resolveStableBinary is the helper shared with init and mcp install.
    const resolved = resolveBinary();
    setCopyWarning(stableCopyWarning(resolved));
    setOutcomes(patchAllClaudeDesktopConfigs(resolved.path, candidates, resolved.args));
    setStatus('done');
  };
  const anyPatched = outcomes.some((o) => o.result === 'patched');
  const anyError = outcomes.some((o) => o.result === 'error');

  useInput((_input, key) => {
    if (status === 'skipped') return;
    if (status === 'done' && key.return) { onNext(); return; }
    if (status !== 'idle') return;
    // #3341: refused below Enterprise; Enter and Esc both skip.
    if (licenceRefusal !== undefined) {
      if ((key.return || key.escape) && !_wizardGuidanceOpen) doSkip();
      return;
    }
    // #2320: when Claude Desktop is not installed, Enter and Esc both skip --
    // never call doPatch() against a non-existent config file.
    if (!installed) {
      if ((key.return || key.escape) && !_wizardGuidanceOpen) doSkip();
      return;
    }
    if (key.return && !_wizardGuidanceOpen) doPatch();
    if (key.escape && !_wizardGuidanceOpen) doSkip();
  });

  void workDir;

  if (status === 'done') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">MCP Client Setup</Text>
        <Box marginTop={1} flexDirection="column">
          {/* #3163: one line per config file SWAO touched (path + result). */}
          {outcomes.map((o) => (
            <Text key={o.path} color={o.result === 'error' ? 'red' : 'green'}>
              {o.result === 'patched' ? 'Updated' : o.result === 'already_present' ? 'Already current' : 'Failed to write'}
              {`  ${o.path}`}{o.effective ? '' : '  (older install, stale SWAO entry refreshed)'}
            </Text>
          ))}
          {copyWarning && copyWarning.map((line, i) => (
            <Text key={`copy-warn-${i}`} color="yellow">{i === 0 ? `Warning: ${line}` : `  ${line}`}</Text>
          ))}
          {anyPatched && <Text color="yellow">Restart Claude Desktop to load the new tool registry.</Text>}
          {!anyPatched && !anyError && <Text color="green">SWAO already registered in Claude Desktop.</Text>}
          {anyError && <Text color="red">Failed to write a config -- add the SWAO entry manually to the file marked above.</Text>}
        </Box>
        <Box marginTop={1}><Text dimColor>Press Enter to continue...</Text></Box>
        <GuidanceBox
          title="MCP Client Setup"
          what="SWAO is now registered as an MCP server. Restart Claude Desktop to activate the tool registry."
          details={[{ label: 'Next step', value: 'Restart Claude Desktop, then open the workspace and type /swao-doctor to verify the connection.' }]}
          affordances={['Enter -- continue to next step']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (licenceRefusal !== undefined) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">MCP Client Setup</Text>
        <Box marginTop={1} flexDirection="column">
          {licenceRefusal.split('\n').map((line, i) => (
            <Text key={`lic-${i}`} color={i === 0 ? 'yellow' : undefined}>{line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter / Esc -- skip this step (nothing is copied or written)</Text>
        </Box>
      </Box>
    );
  }

  if (!installed) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">MCP Client Setup</Text>
        <Box marginTop={1}>
          <Text color="yellow">No MCP client detected.</Text>
        </Box>
        <Text dimColor>SWAO could not find a Claude Desktop config at:</Text>
        <Text dimColor>  {configPath}</Text>
        {/* #3386: column layout; Ink rows put both hint lines side by side. */}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>If you do not use Claude Desktop, you can skip this step.</Text>
          <Text dimColor>To add SWAO as an MCP server manually later, run: <Text bold>swao mcp --help</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter / Esc -- skip this step</Text>
        </Box>
        <GuidanceBox
          title="MCP Client Setup (skipped)"
          what="No supported MCP client detected. Install Claude Desktop to enable AI-assisted analysis of findings."
          details={[{ label: 'Manual setup', value: 'Run `swao mcp --help` for instructions on adding SWAO as an MCP server.' }]}
          affordances={['Enter -- skip this step  |  Esc -- skip this step']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">MCP Client Setup</Text>
      <Text>Detected Claude Desktop config at: <Text bold color="whiteBright">{configPath}</Text></Text>
      <Text dimColor>(SWAO probes only Claude Desktop today -- it is the only MCP host currently shipped. Path is Claude\ because that is the host detected.)</Text>
      {/* #3163: list every file Enter will write, not only the effective one. */}
      {targets.length > 1 && (
        <Box marginTop={1} flexDirection="column">
          <Text>SWAO will update {targets.length} Claude Desktop configs:</Text>
          {targets.map((t) => <Text key={t.path} dimColor>  {t.path}{t.effective ? '' : '  (holds an older SWAO entry)'}</Text>)}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text>SWAO will register itself as an MCP server with this client.</Text>
        <Text dimColor>After patching, the client can ask SWAO about findings, apps, and reports.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>  <Text color="cyanBright">Enter</Text>  -- patch config and continue</Text>
        <Text>  <Text color="cyanBright">Escape</Text> -- skip (add manually later)</Text>
      </Box>
      <GuidanceBox
        title="MCP Client Setup"
        what="Adds SWAO as an MCP server in Claude Desktop. Restart the client after patching for the tool to appear."
        details={[{ label: 'Action', value: 'Writes mcpServers entry to Claude Desktop config; preserves existing key name if found' }]}
        affordances={['Enter -- patch and continue  |  Esc -- skip']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

// -- Step 6: Playwright / Chromium (optional) --------------------------------

const DEFAULT_VISION_SCREENS = 2;
const MIN_VISION_SCREENS = 1;
const MAX_VISION_SCREENS = 10;

export function PlaywrightStep({ onNext }: { onNext: (visionMaxScreens?: number) => void }) {
  const [playwrightOk, setPlaywrightOk] = useState<boolean | null>(null);
  // #2815: when Playwright IS installed, ask for vision_max_screens before advancing.
  const [visionPhase, setVisionPhase] = useState(false);
  const [visionInput, setVisionInput] = useState(String(DEFAULT_VISION_SCREENS));

  useEffect(() => {
    // #0799: use filesystem-based detection from @swao/core (safe in PKG binaries).
    // require('playwright') always throws in the binary -- findInstalledChromium()
    // scans %LOCALAPPDATA%\ms-playwright instead, no module import needed.
    const chromiumPath = findInstalledChromium();
    setPlaywrightOk(chromiumPath !== null);
  }, []);

  // #0804: use useRef (not a plain object) so the value persists across
  // re-renders. A plain `{ current: false }` is recreated on every render,
  // meaning the GuidanceBox onOpenChange closes over a stale object and the
  // guard in useInput always reads false even when the panel is open.
  const playwrightGuidanceOpenRef = useRef(false);

  const commitVisionPhase = () => {
    const parsed = parseInt(visionInput, 10);
    const screens = isNaN(parsed)
      ? DEFAULT_VISION_SCREENS
      : Math.min(MAX_VISION_SCREENS, Math.max(MIN_VISION_SCREENS, parsed));
    onNext(screens);
  };

  useInput((_input, key) => {
    if (visionPhase) {
      if (key.return) { commitVisionPhase(); return; }
      if (key.escape) { onNext(DEFAULT_VISION_SCREENS); return; }
      if (key.backspace || key.delete) { setVisionInput(v => v.slice(0, -1)); return; }
      if (/^\d$/.test(_input)) { setVisionInput(v => (v + _input).slice(0, 2)); return; }
      return;
    }
    if ((key.return || key.escape) && !playwrightGuidanceOpenRef.current) {
      if (playwrightOk) { setVisionPhase(true); } else { onNext(); }
      return;
    }
    if (_input === '9' || _input === 's') {
      if (process.platform === 'win32') {
        const child = spawn('cmd', ['/c', 'start', 'cmd'], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
        child.unref();
      }
    }
  });

  // #0761: moved step instructions to GuidanceBox; main area now shows
  // status line + concise key legend only.
  const crawlerGuidance = (
    <GuidanceBox
      title="Dynamic UI Crawler (optional)"
      what="Headless Chromium captures screenshots and JS execution traces for Pass 10 (dynamic analysis). Skipping drops ~10% coverage. All 13 static + LLM passes work without it."
      details={[
        { label: 'Install',   value: `Run: swao install-playwright  (or manually: npx playwright@${PLAYWRIGHT_VERSION} install chromium)` },
        { label: 'Footprint', value: '~170 MB download to user profile (one-time)' },
        { label: 'After',     value: 'Re-run Health Check to confirm Chromium is detected' },
      ]}
      affordances={['Enter -- continue  |  Esc -- continue  |  S -- open shell']}
      onOpenChange={(open) => { playwrightGuidanceOpenRef.current = open; setWizardGuidanceOpen(open); }}
    />
  );

  // #2815: vision_max_screens sub-phase (only reached when Playwright is installed).
  if (visionPhase) {
    const screens = parseInt(visionInput, 10);
    const valid = !isNaN(screens) && screens >= MIN_VISION_SCREENS && screens <= MAX_VISION_SCREENS;
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Dynamic UI Crawler (optional)</Text>
        <Text color="green">Chromium is installed.</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Vision analysis: how many screenshots should SWAO send to the LLM per assessment?</Text>
          <Text dimColor>More screens = higher coverage + higher LLM cost. Recommended: 2-5.</Text>
          <Text dimColor>The value is written to .swao.yml as <Text bold>assessment.vision_max_screens</Text> and can be changed anytime.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>  Screens (1-{MAX_VISION_SCREENS}, default {DEFAULT_VISION_SCREENS}): </Text>
          <Text color={valid ? 'cyanBright' : 'yellow'}>{visionInput || '_'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter a number and press <Text bold>Enter</Text>, or press <Text bold>Esc</Text> to use the default ({DEFAULT_VISION_SCREENS}).</Text>
        </Box>
      </Box>
    );
  }

  if (playwrightOk === null) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Dynamic UI Crawler (optional)</Text>
        <Text dimColor>Checking Chromium...</Text>
        {crawlerGuidance}
      </Box>
    );
  }

  if (playwrightOk) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Dynamic UI Crawler (optional)</Text>
        <Text color="green">Chromium is installed -- the dynamic UI crawler pass is available.</Text>
        <Text dimColor>SWAO will capture screenshots and analyse web app UI flows during assessments.</Text>
        <Box marginTop={1}><Text dimColor>Press Enter to configure vision settings and continue...</Text></Box>
        {crawlerGuidance}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Dynamic UI Crawler (optional)</Text>
      <Text color="yellow">Chromium not detected. Press Ctrl+G to see install instructions.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>  <Text color="cyanBright">S</Text>      -- Open shell here (to run: swao install-playwright)</Text>
        <Text dimColor>  <Text color="cyanBright">Enter</Text>  -- Continue without Playwright (install later)</Text>
      </Box>
      {crawlerGuidance}
    </Box>
  );
}
