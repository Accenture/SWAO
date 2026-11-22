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

import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { findInstalledChromium, PLAYWRIGHT_VERSION, resolveClaudeDesktopConfigs, selectClaudeDesktopPatchTargets, type ClaudeDesktopConfigCandidate } from '@swao/core';
import { PickerRow, SelectInput, TextInput, fitToWidth, guidanceOwnsKey, tone, useGuidanceOpen, useHeaderWidth, useOptionGuidance, type GuidanceEntry, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';
import { resolve } from 'path';
import {
  DEFAULT_MCP_HTTP_URL,
  mcpClientHelpers,
  type McpClientInstallRequest,
  type McpClientInstallResult,
} from '../../../../lib/mcp-chat-contract.js';
import { formatMcpRegistrationRefusal, mcpRegistrationRefusal, patchAllClaudeDesktopConfigs, resolveStableBinary, stableCopyWarning, type ClaudeDesktopPatchOutcome, type StableBinaryResolution } from '../../../mcp-config.js';
import { installMcpClient } from '../../../../lib/mcp-client-install.js';
import { SWAO_VERSION } from '../../../../branding.js';

/**
 * #3479 (Design 116 REQ-13.3): MCP clients the wizard offers, the same
 * targets as `swao mcp install --client`. Claude Desktop stays first and
 * preselected, so Enter keeps the existing flow.
 * #4116: Cursor and VS Code added. `scope` is the scope the wizard passes to
 * the shared writer: the CLI default (user), except VS Code, whose writer only
 * supports project scope (`swao mcp install --client vscode --scope project`,
 * mcp-client-install.ts `case 'vscode'`); the project is the workspace.
 * #4115: `hint` is a short menu hint; transports and paths are in the guidance.
 */
export const WIZARD_MCP_CLIENTS = [
  { id: 'claude-desktop', label: 'Claude Desktop', hint: 'stdio, detected config', scope: 'user', detail: 'stdio; SWAO updates every Claude Desktop config that holds or needs the SWAO entry.' },
  { id: 'claude-code', label: 'Claude Code', hint: 'HTTP transport, agent', scope: 'user', detail: 'HTTP on localhost (start the SWAO MCP server in HTTP mode first), lean agent, starter profile, scope user.' },
  { id: 'kilo', label: 'Kilo', hint: 'stdio, lean agent', scope: 'user', detail: 'stdio, lean agent, starter profile, scope user (Kilo user config).' },
  { id: 'cursor', label: 'Cursor', hint: 'stdio, user config', scope: 'user', detail: 'stdio, starter profile, scope user: ~/.cursor/mcp.json.' },
  { id: 'vscode', label: 'VS Code', hint: 'stdio, workspace .vscode', scope: 'project', detail: 'stdio, starter profile, scope project: .vscode/mcp.json in the workspace (the CLI has no user scope for VS Code).' },
] as const;
export type WizardMcpClient = (typeof WIZARD_MCP_CLIENTS)[number]['id'];

/**
 * #3479 / #4116: the request the wizard sends to the shared writer for every
 * client except Claude Desktop: the `swao mcp install --client <id>` defaults
 * (client transport, lean agent where the client takes one, starter profile),
 * the client's wizard scope, and the workspace being set up as workspace and
 * project folder.
 */
export function wizardInstallRequest(
  client: Exclude<WizardMcpClient, 'claude-desktop'>,
  workDir: string,
  binary: StableBinaryResolution,
  version: string = SWAO_VERSION,
): McpClientInstallRequest {
  const ws = resolve(workDir);
  const scope = WIZARD_MCP_CLIENTS.find((c) => c.id === client)?.scope ?? 'user';
  return {
    client,
    scope,
    profile: 'starter',
    profileExplicit: false,
    tools: mcpClientHelpers().profileToolNames('starter'),
    transport: mcpClientHelpers().defaultTransport(client),
    url: DEFAULT_MCP_HTTP_URL,
    agent: true,
    dryRun: false,
    uninstall: false,
    workspace: ws,
    binary: { path: binary.path, args: binary.args },
    projectDir: ws,
    version,
  };
}

/**
 * #4115: fit one output line into `width` columns. Well-known folders are
 * written as %LOCALAPPDATA%, %APPDATA% or ~ first; a line that is still too
 * long keeps its start and its end around a middle ellipsis (shared
 * `fitToWidth`, #4110), so the file name stays visible.
 */
export function fitLine(line: string, width: number, env: NodeJS.ProcessEnv = process.env): string {
  return fitToWidth(shortenKnownDirs(line, env), Math.max(4, width), 'middle');
}

/** #4115: write %LOCALAPPDATA%, %APPDATA% or ~ for the well-known folders in a line. */
export function shortenKnownDirs(line: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = line;
  const prefixes: Array<[string | undefined, string]> = [
    [env['LOCALAPPDATA'], '%LOCALAPPDATA%'],
    [env['APPDATA'], '%APPDATA%'],
    [env['USERPROFILE'], '~'],
    [env['HOME'], '~'],
  ];
  for (const [dir, token] of prefixes) {
    if (dir && dir.length > 3) out = out.split(dir).join(token);
  }
  return out;
}

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
  /**
   * #3479: the per-client safe writer shared with `swao mcp install --client`
   * (Claude Code, Kilo, Cursor, VS Code). Injectable for tests; defaults to installMcpClient.
   */
  installClient?: (request: McpClientInstallRequest) => McpClientInstallResult;
}

/**
 * #3479 / #4115: the client list of the MCP step. One line per client, name
 * plus a short hint, labels padded so the hints align; the same number of
 * lines for every selection.
 */
// #4254 (run 9): the rows are central PickerRows (marker and colour of the
// pickers); the list stays local because a registered client keeps its hint
// in the ok colour. The keys are the KeyHints line, not the label.
function ClientChoice({ choice, desktopInstalled, width, registered }: { choice: number; desktopInstalled: boolean; width: number; registered: ReadonlySet<WizardMcpClient> }) {
  const pad = Math.max(...WIZARD_MCP_CLIENTS.map((c) => c.label.length)) + 2;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>MCP client:</Text>
      {WIZARD_MCP_CLIENTS.map((c, i) => {
        // #4221: a client registered in this pass is marked; the step can register several.
        const hint = registered.has(c.id) ? 'registered in this setup' : c.id === 'claude-desktop' && !desktopInstalled ? 'not detected' : c.hint;
        const label = `${i + 1}  ${c.label.padEnd(pad)}`;
        return (
          <PickerRow key={c.id} selected={i === choice} indent={false} wrap="truncate">
            <Text {...tone(i === choice ? 'selection' : 'text')}>{label}</Text>
            <Text {...tone(registered.has(c.id) ? 'ok' : 'muted')}>{hint.slice(0, Math.max(0, width - 2 - label.length))}</Text>
          </PickerRow>
        );
      })}
      <PickerRow selected={choice === MCP_CONTINUE_INDEX} indent={false}>
        <Text {...tone(choice === MCP_CONTINUE_INDEX ? 'selection' : 'text')}>0  Continue</Text>
      </PickerRow>
    </Box>
  );
}

/** #4221 (Design 126 section 4.5): the Continue entry after the clients goes on to the next step. */
export const MCP_CONTINUE_INDEX = WIZARD_MCP_CLIENTS.length;

/** #4221: after a registration the cursor moves to the next client not registered yet, else to Continue. */
export function nextMcpChoice(from: number, registered: ReadonlySet<WizardMcpClient>): number {
  for (let k = 1; k <= WIZARD_MCP_CLIENTS.length; k++) {
    const i = (from + k) % WIZARD_MCP_CLIENTS.length;
    if (!registered.has(WIZARD_MCP_CLIENTS[i]!.id)) return i;
  }
  return MCP_CONTINUE_INDEX;
}

/** #3341: default wizard gate, same decision as the CLI entry points. */
export function defaultMcpWizardLicenceCheck(): string | undefined {
  const r = mcpRegistrationRefusal();
  return r ? formatMcpRegistrationRefusal(r, 'MCP server registration') : undefined;
}

/**
 * #4115: the guidance of the MCP step. Paths, transports and what Enter will
 * write live here, not above or below the menu.
 * #4230 (Design 126 section 9.2, replaces the #4115 rule of one entry for the
 * whole list): the box shows the entry of the highlighted client or of
 * Continue and follows the cursor (`mcpClientGuidance`).
 */
function mcpGuidanceDetails(installed: boolean, configPath: string, targets: ClaudeDesktopConfigCandidate[], workDir: string, width: number): Array<{ label: string; value: string }> {
  const desktop = installed
    ? `${WIZARD_MCP_CLIENTS[0].detail} Will update ${targets.length} config${targets.length === 1 ? '' : 's'}: ${targets.map((t) => fitLine(t.path, width - 6) + (t.effective ? '' : ' (older SWAO entry)')).join('; ')}`
    : `Not detected; expected at ${fitLine(configPath, width - 6)}.`;
  return [
    { label: 'Claude Desktop', value: desktop },
    ...WIZARD_MCP_CLIENTS.slice(1).map((c) => ({
      label: c.label,
      value: c.id === 'vscode' ? `${c.detail} Workspace: ${fitLine(resolve(workDir), width - 20)}` : c.detail,
    })),
  ];
}

/** #4230: what registering each client does and when to choose it (one entry per list row). */
const MCP_CLIENT_WHAT: Readonly<Record<WizardMcpClient, string>> = {
  'claude-desktop': 'Registers SWAO as an MCP server in Claude Desktop, so the SWAO tools appear in its chats. Choose it when the team works in Claude Desktop.',
  'claude-code': 'Registers SWAO with Claude Code over HTTP, with the lean SWAO agent. Choose it when you work in Claude Code; start the SWAO MCP server in HTTP mode first.',
  kilo: 'Registers SWAO in the Kilo user config, with the lean SWAO agent. Choose it when you work in Kilo.',
  cursor: 'Registers SWAO in the Cursor user config. Choose it when you work in Cursor.',
  vscode: 'Registers SWAO for this workspace in VS Code (.vscode/mcp.json). Choose it when you open the workspace in VS Code.',
};

/**
 * #4230: the guidance entry of one row of the MCP client list: a client (its
 * transport and the files it writes) or Continue (index MCP_CONTINUE_INDEX).
 */
export function mcpClientGuidance(
  index: number,
  ctx: { details: ReadonlyArray<{ label: string; value: string }>; registered: ReadonlySet<WizardMcpClient>; desktopInstalled: boolean },
): GuidanceEntry {
  const client = WIZARD_MCP_CLIENTS[index];
  if (!client) {
    return {
      title: 'Continue',
      what: `Goes on to the health check${ctx.registered.size > 0 ? ` with ${ctx.registered.size} client(s) registered` : ' without registering a client'}. Clients can be registered later from Workspace Setup.`,
      sections: [{ label: 'Restart', text: 'Restart each registered client for the SWAO tools to appear.' }],
      cli: 'swao mcp install --client <name>',
    };
  }
  const detail = ctx.details.find((d) => d.label === client.label)?.value ?? client.detail;
  const notDetected = client.id === 'claude-desktop' && !ctx.desktopInstalled;
  return {
    title: `MCP client ${client.label}`,
    what: notDetected ? 'Claude Desktop was not found on this machine; choosing it skips this step. Install Claude Desktop and run the setup again to register SWAO there.' : MCP_CLIENT_WHAT[client.id],
    sections: [
      { label: 'Setup', text: detail },
      ...(ctx.registered.has(client.id) ? [{ label: 'State', text: 'registered in this setup; Enter registers it again' }] : []),
      { label: 'Afterwards', text: `Restart ${client.label} for the SWAO tools to appear.` },
    ],
    cli: `swao mcp install --client ${client.id}`,
  };
}

export function ClaudeDesktopStep({
  workDir,
  onNext,
  resolveConfigs = resolveClaudeDesktopConfigs,
  resolveBinary = () => resolveStableBinary(),
  checkLicence = defaultMcpWizardLicenceCheck,
  installClient = (request) => installMcpClient(request),
}: ClaudeDesktopStepProps) {
  // #4115: no line wider than the header rule.
  // #4110: shared header-rule width (tui-kit header-width.ts).
  const width = useHeaderWidth();
  // #3479: index into WIZARD_MCP_CLIENTS; 0 (Claude Desktop) keeps the existing flow.
  const [choice, setChoice] = useState(0);
  const [clientResult, setClientResult] = useState<McpClientInstallResult | undefined>(undefined);
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
  // #3479 / #4116: every other client through the writer `swao mcp install --client` uses.
  const doClientInstall = (client: Exclude<WizardMcpClient, 'claude-desktop'>) => {
    if (licenceRefusal !== undefined) return;
    const resolved = resolveBinary();
    setCopyWarning(stableCopyWarning(resolved));
    setClientResult(installClient(wizardInstallRequest(client, workDir, resolved)));
    setStatus('done');
  };
  const anyPatched = outcomes.some((o) => o.result === 'patched');
  const anyError = outcomes.some((o) => o.result === 'error');
  const chosen = WIZARD_MCP_CLIENTS[choice]?.id ?? 'claude-desktop';
  // #4221: clients registered in this pass; after a result Enter returns to the list.
  const [registered, setRegistered] = useState<ReadonlySet<WizardMcpClient>>(new Set());
  // #4394: the open state of the guidance box (the wizard's owner, tui-kit guidance-open.ts).
  const guidance = useGuidanceOpen();
  const backToList = (): void => {
    const ok = clientResult !== undefined ? clientResult.exitCode === 0 : !anyError;
    const next = ok ? new Set([...registered, chosen]) : registered;
    setRegistered(next);
    setChoice(nextMcpChoice(choice, next));
    setClientResult(undefined);
    setOutcomes([]);
    setCopyWarning(undefined);
    setStatus('idle');
  };

  useInput((input, key) => {
    if (status === 'skipped') return;
    if (status === 'done' && key.return) { backToList(); return; }
    if (status !== 'idle') return;
    // #3341: refused below Enterprise; Enter skips (#4341: Esc belongs to the wizard).
    if (licenceRefusal !== undefined) {
      if (key.return) doSkip();
      return;
    }
    if (guidanceOwnsKey(key, guidance.isOpen())) return; // #4230: arrows and number keys keep working with the box open
    // #3479: client choice.
    // #4221: the list holds the clients and the Continue entry (0).
    const rows = WIZARD_MCP_CLIENTS.length + 1;
    if (key.upArrow) { setChoice((c) => (c + rows - 1) % rows); return; }
    if (key.downArrow) { setChoice((c) => (c + 1) % rows); return; }
    const digit = /^[1-9]$/.test(input) ? parseInt(input, 10) - 1 : -1;
    if (digit >= 0 && digit < WIZARD_MCP_CLIENTS.length) { setChoice(digit); return; }
    if (input === '0') { setChoice(MCP_CONTINUE_INDEX); return; }
    // #4341: no Esc skip; the Continue entry (0) of the list leaves the step.
    if (!key.return) return;
    if (choice === MCP_CONTINUE_INDEX) { setStatus('skipped'); onNext(); return; }
    if (chosen !== 'claude-desktop') { doClientInstall(chosen); return; }
    // #2320: when Claude Desktop is not installed, Enter skips; never call
    // doPatch() against a non-existent config file.
    if (!installed) { doSkip(); return; }
    doPatch();
  });

  const fit = (line: string) => fitLine(line, width);

  // #4221 (Design 126 sections 7 and 9): every view of the step hands its
  // title, key hints and guidance to the wizard frame (SetupStepFrame); the
  // keys are the central KeyHints line, never words on the screen.
  const resultKeys: KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
  if (status === 'done' && clientResult !== undefined) {
    const label = WIZARD_MCP_CLIENTS[choice]?.label ?? '';
    return (
      <SetupStepFrame
        title={`MCP Client Setup: ${label}`}
        keys={resultKeys}
        guidance={{ title: `MCP Client Setup: ${label}`, what: 'The result of the registration. Back in the client list, register another client or choose Continue. Restart the client for the tools to appear.' }}
      >
        <Box flexDirection="column" width={width}>
          {[...clientResult.out, ...clientResult.err].map((line, i) => (
            <Text key={`res-${i}`} {...tone(clientResult.exitCode !== 0 ? 'error' : 'text')} wrap="wrap">{shortenKnownDirs(line)}</Text>
          ))}
          {copyWarning && copyWarning.map((line, i) => (
            <Text key={`copy-warn-${i}`} {...tone('warning')} wrap="wrap">{shortenKnownDirs(i === 0 ? `Warning: ${line}` : `  ${line}`)}</Text>
          ))}
          {clientResult.exitCode !== 0 && <Text {...tone('error')} wrap="wrap">The MCP client setup did not finish (see above). Fix the cause, then register the client again (the command is in the guidance).</Text>}
        </Box>
        <Box marginTop={1}><Text {...tone('muted')}>Back in the client list, register another client or choose Continue.</Text></Box>
      </SetupStepFrame>
    );
  }

  if (status === 'done') {
    const doneGuidance: GuidanceEntry = {
      title: 'MCP Client Setup',
      what: 'SWAO is now registered as an MCP server. Restart Claude Desktop to activate the tool registry.',
      sections: [
        { label: 'Next step', text: 'Restart Claude Desktop, then open the workspace and type /swao-doctor to verify the connection.' },
        { label: 'Files', text: outcomes.map((o) => o.path).join('; ') },
      ],
    };
    return (
      <SetupStepFrame title="MCP Client Setup" keys={resultKeys} guidance={doneGuidance}>
        <Box flexDirection="column" width={width}>
          {/* #3163: one line per config file SWAO touched (path + result); #4115: fitted to the header width. */}
          {outcomes.map((o) => (
            <Text key={o.path} {...tone(o.result === 'error' ? 'error' : 'ok')}>
              {fit(`${o.result === 'patched' ? 'Updated' : o.result === 'already_present' ? 'Already current' : 'Failed to write'}  ${o.path}${o.effective ? '' : '  (older install, refreshed)'}`)}
            </Text>
          ))}
          {copyWarning && copyWarning.map((line, i) => (
            <Text key={`copy-warn-${i}`} {...tone('warning')} wrap="wrap">{shortenKnownDirs(i === 0 ? `Warning: ${line}` : `  ${line}`)}</Text>
          ))}
          {anyPatched && <Text {...tone('warning')}>Restart Claude Desktop to load the new tool registry.</Text>}
          {!anyPatched && !anyError && <Text {...tone('ok')}>SWAO already registered in Claude Desktop.</Text>}
          {anyError && <Text {...tone('error')} wrap="wrap">Failed to write a config: add the SWAO entry manually to the file marked above.</Text>}
        </Box>
        <Box marginTop={1}><Text {...tone('muted')}>Back in the client list, register another client or choose Continue.</Text></Box>
      </SetupStepFrame>
    );
  }

  if (licenceRefusal !== undefined) {
    return (
      <SetupStepFrame
        title="MCP Client Setup"
        keys={[{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'abort' }]}
        guidance={{ title: 'MCP Client Setup', what: 'MCP server registration needs the Enterprise tier. This step is skipped; nothing is copied or written.' }}
      >
        <Box flexDirection="column" width={width}>
          {licenceRefusal.split('\n').map((line, i) => (
            <Text key={`lic-${i}`} {...tone(i === 0 ? 'warning' : 'text')} wrap="wrap">{line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text {...tone('muted')}>This step is skipped; nothing is copied or written.</Text>
        </Box>
      </SetupStepFrame>
    );
  }

  // #4115: one layout for both cases (Claude Desktop detected or not): a status
  // line, the client menu, one action line, the guidance. Every line has the
  // same count for every selection, so moving the selection never reflows.
  // #4221: the action line says what the highlighted entry does, without key
  // words; the KeyHints line names Enter (configure the client, or continue on
  // the Continue entry) and Esc (abort, the wizard's).
  const chosenLabel = WIZARD_MCP_CLIENTS[choice]?.label ?? '';
  const onContinue = choice === MCP_CONTINUE_INDEX;
  const action = onContinue
    ? `Continue goes on with the setup${registered.size > 0 ? ` (${registered.size} client${registered.size === 1 ? '' : 's'} registered)` : ''}`
    : chosen !== 'claude-desktop'
    ? `Selected: configure ${chosenLabel}`
    : installed ? 'Selected: register SWAO in Claude Desktop' : 'Selected: skip this step';
  const listKeys: KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: onContinue ? 'next' : 'confirm' }, { key: 'Esc', verb: 'abort' }];
  // #4230: the entry of the highlighted client or of Continue; the box follows the cursor.
  const listGuidance = mcpClientGuidance(choice, { details: mcpGuidanceDetails(installed, configPath, targets, workDir, width), registered, desktopInstalled: installed });
  return (
    <SetupStepFrame title="MCP Client Setup" keys={listKeys} guidance={listGuidance}>
      {installed
        ? <Text>{`Claude Desktop detected (${targets.length} config${targets.length === 1 ? '' : 's'} to update; paths: Ctrl+G).`}</Text>
        : <Text {...tone('warning')}>No Claude Desktop config detected. Choose another client or skip.</Text>}
      <ClientChoice choice={choice} desktopInstalled={installed} width={width} registered={registered} />
      <Box marginTop={1}><Text {...tone('muted')}>{action}</Text></Box>
    </SetupStepFrame>
  );
}

/// -- Playwright / Chromium (optional) ----------------------------------------

// #4254 / #4341 / #4230 (Design 126 sections 4.5, 7.7 and 9): the step renders
// through SetupStepFrame. Without Chromium a numbered menu offers "Continue
// without the browser", "Check again" and (Windows) "Open a shell here", each
// with its own guidance; the install command lives in the guidance (CLI line),
// not on the screen. With Chromium the step asks for the screenshot count of
// the vision analysis in a text input (#2815). Esc belongs to the wizard.

const DEFAULT_VISION_SCREENS = 2;
const MIN_VISION_SCREENS = 1;
const MAX_VISION_SCREENS = 10;

/** #2815: the screen count from the operator's entry; empty or invalid keeps the default, out of range is clamped. */
export function visionScreens(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isNaN(parsed) ? DEFAULT_VISION_SCREENS : Math.min(MAX_VISION_SCREENS, Math.max(MIN_VISION_SCREENS, parsed));
}

const CRAWLER_WHAT = 'Headless Chromium captures screenshots and JavaScript execution traces for Pass 10 (dynamic analysis). Without it about 10% of the coverage is lost; all static and LLM passes work without it.';
const CRAWLER_SECTIONS = [
  { label: 'Footprint', text: 'About 170 MB downloaded once into the user profile.' },
  { label: 'After', text: 'The Application health check confirms that Chromium is found.' },
];
// The guidance cli line of the step and its entries (Design 126 section 9.3).
const CRAWLER_CLI_FIELD = { cli: `swao install-playwright (or npx playwright@${PLAYWRIGHT_VERSION} install chromium)` } as const;

/** #4230: the entries of the menu without Chromium, each with its guidance. */
export function playwrightOptions(platform: NodeJS.Platform = process.platform): SelectOption[] {
  return [
    { label: 'Continue without the browser', value: 'continue', guidance: { title: 'Continue without the browser', what: 'Goes on without Chromium. Pass 10 (dynamic analysis) is then skipped, about 10% of the coverage; install it later.', sections: [{ label: 'Later', text: 'This step and the health check show the browser once it is installed.' }, ...CRAWLER_SECTIONS], ...CRAWLER_CLI_FIELD } },
    { label: 'Check again', value: 'recheck', guidance: { title: 'Check again', what: 'Looks for Chromium again, for example after installing it in another terminal.', sections: CRAWLER_SECTIONS, ...CRAWLER_CLI_FIELD } },
    ...(platform === 'win32'
      ? [{ label: 'Open a shell here', value: 'shell', guidance: { title: 'Open a shell here', what: 'Opens a command prompt in a new window to install the browser; come back and choose Check again afterwards.', sections: CRAWLER_SECTIONS, ...CRAWLER_CLI_FIELD } }]
      : []),
  ];
}

export function PlaywrightStep({ onNext, find = findInstalledChromium }: { onNext: (visionMaxScreens?: number) => void; find?: () => string | null }) {
  const [playwrightOk, setPlaywrightOk] = useState<boolean | null>(null);
  const [round, setRound] = useState(0);
  const { entry, onCursorChange } = useOptionGuidance({ title: 'Dynamic UI crawler (optional)', what: CRAWLER_WHAT, sections: CRAWLER_SECTIONS, ...CRAWLER_CLI_FIELD });

  useEffect(() => {
    // #0799: use filesystem-based detection from @swao/core (safe in PKG binaries).
    // require('playwright') always throws in the binary; findInstalledChromium()
    // scans %LOCALAPPDATA%\ms-playwright instead, no module import needed.
    let found = false;
    try { found = find() !== null; } catch { found = false; }
    setPlaywrightOk(found);
  }, [round]);

  const title = 'Playwright';
  const subtitle = 'The browser for the dynamic UI crawler (Pass 10), optional.';

  if (playwrightOk === null) {
    return (
      <SetupStepFrame title={title} subtitle={subtitle} kind="picker" guidance={entry}>
        <Text {...tone('progressRunning')}>Checking Chromium...</Text>
      </SetupStepFrame>
    );
  }

  // #2815: vision_max_screens (only when Chromium is installed).
  if (playwrightOk) {
    return (
      <SetupStepFrame
        title={title}
        subtitle={subtitle}
        kind="textInput"
        guidance={{
          title: 'Screenshots per assessment',
          what: `How many screenshots SWAO sends to the LLM per assessment for the vision analysis. More screens give more coverage and a higher LLM cost; 2 to 5 is recommended. An empty entry keeps ${DEFAULT_VISION_SCREENS}.`,
          sections: [{ label: 'Saved as', text: 'assessment.vision_max_screens in the workspace .swao.yml; change it at any time.' }, ...CRAWLER_SECTIONS],
        }}
      >
        <Box flexDirection="column">
          <Text {...tone('ok')}>Chromium is installed; the dynamic UI crawler pass is available.</Text>
          <Box marginTop={1}>
            <TextInput
              key="vision-screens"
              label={`Screens (${MIN_VISION_SCREENS} to ${MAX_VISION_SCREENS}, default ${DEFAULT_VISION_SCREENS})`}
              initialValue={String(DEFAULT_VISION_SCREENS)}
              onSubmit={(v) => onNext(visionScreens(v))}
            />
          </Box>
        </Box>
      </SetupStepFrame>
    );
  }

  return (
    <SetupStepFrame title={title} subtitle={subtitle} kind="picker" guidance={entry}>
      <Box flexDirection="column">
        <Text {...tone('warning')}>Chromium not found. The install command is in the guidance.</Text>
        <Box marginTop={1}>
          <SelectInput
            label=""
            options={playwrightOptions()}
            numbered
            showKeyHints={false}
            visibleCount={3}
            onCursorChange={onCursorChange}
            onSelect={(v) => {
              if (v === 'recheck') { setRound((n) => n + 1); return; }
              if (v === 'shell') {
                if (process.platform === 'win32') {
                  const child = spawn('cmd', ['/c', 'start', 'cmd'], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
                  child.unref();
                }
                return;
              }
              onNext();
            }}
          />
        </Box>
      </Box>
    </SetupStepFrame>
  );
}
