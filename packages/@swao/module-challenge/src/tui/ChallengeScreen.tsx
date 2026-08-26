// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #0259.C4 -- CLI/TUI parity. The `swao challenge` command was previously
// CLI-only and effectively hidden from operators. This screen surfaces it
// under the Tools menu with a brief explanation + a launcher.
//
// M18 #0277 update: the Enterprise gate is now ALSO enforced at the TUI
// surface via LicenseGate. Community / Consultant operators see a locked
// panel with the "Request a licence" CTA instead of the launcher.

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { HeaderView, type LicenseStateView, SelectInput, MultiSelect, TextInput, LiveOutput, GuidanceBox, ProgressBar } from '@swao/tui-kit';
import { LicenseGate, isAllowed } from '@swao/tui-kit';
import { findWorkspace, LicenseGuard, credentialStore } from '@swao/core';
import type { LicenseState } from '@swao/core';
import { LZ_AGENT_IDS } from '../challenge.js';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

// #0286 -- Display labels from the canonical PERSONAS taxonomy, in
// CANONICAL_AGENT_ORDER (Architect -> Business -> Compliance -> FinOps
// -> Migration). Kept as a literal here (not imported) because the TUI
// build must not require the commander/CLI surface; the audit gate
// `stakeholder-taxonomy-consistent.gate.mjs` enforces equivalence.
const AGENT_OPTIONS = [
  { label: 'All agents (recommended)',                                               value: 'all'                    },
  { label: 'Application Architect  -- architecture-fitness of the migration plan', value: 'application-architect'  },
  { label: 'Business Owner         -- value, outcome and risk angle',               value: 'business-owner'        },
  { label: 'GRC / Compliance Officer  -- regulatory and controls angle',             value: 'grc-compliance-officer' },
  { label: 'FinOps Lead               -- unit-economics and cloud-cost angle',       value: 'finops-lead'            },
  { label: 'Migration / Programme Manager  -- delivery, dependencies and risk',     value: 'programme-manager'      },
];

// #1109: LZ Sovereignty Challenge agent options (separate taxonomy, LZCA_ prefix).
const LZ_AGENT_OPTIONS = [
  { label: 'All agents (recommended)',                                               value: 'all'                         },
  { label: 'Sovereignty / GRC Reviewer  -- framework verdicts, certification gaps', value: 'lzca-sovereignty-grc'        },
  { label: 'Landing Zone Architect      -- service gaps, deployment readiness',     value: 'lzca-lz-architect'           },
  { label: 'Procurement / Vendor Management  -- contracts, lock-in, exit strategy', value: 'lzca-procurement'            },
  { label: 'CISO / Security            -- exposure, encryption, incident response', value: 'lzca-ciso-security'          },
];
const LZ_ALL_AGENT_VALUES = Object.keys(LZ_AGENT_IDS);

interface ChallengeScreenProps {
  onBack: () => void;
  /** Called when the challenge completes successfully and the user presses Enter.
   *  Defaults to onBack when not provided (preserves backward compatibility). */
  onComplete?: () => void;
  onOpenLicense?: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
  /** #1109: 'app' (default) = App Stakeholder Challenge; 'lz' = LZ Sovereignty Challenge. */
  mode?: 'app' | 'lz';
  /** #1109: Pre-selected app for LZ challenge (skips pick-app step). */
  initialApp?: string;
}

export function ChallengeScreen({ onBack, onComplete, onOpenLicense, version, mode = 'app', initialApp }: ChallengeScreenProps) {
  // Enterprise gate (M18 #0277). Mirrors the CLI gate in challenge.ts.
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

  if (!isAllowed(licenseState, 'enterprise')) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Stakeholder Challenge" />
        <LicenseGate
          required="enterprise"
          state={licenseState}
          feature="swao challenge (adversarial WSP review)"
          onOpenLicenseScreen={onOpenLicense ?? onBack}
          onBack={onBack}
        >
          <></>
        </LicenseGate>
      </Box>
    );
  }

  const workspace = findWorkspace(process.cwd());

  const assessedApps: string[] = workspace && existsSync(join(workspace, 'apps'))
    ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
        .filter(d => d.isDirectory() && existsSync(join(workspace, 'apps', d.name, 'wsp', 'latest.txt')))
        .map(d => d.name)
    : [];

  const isLzMode = mode === 'lz';
  const screenTitle = isLzMode ? 'LZ Sovereignty Challenge' : 'Stakeholder Challenge';

  type Phase = 'pick-app' | 'pick-agent' | 'pick-output' | 'running' | 'done';
  // #1109: LZ challenge skips pick-app when initialApp is provided.
  const [phase, setPhase] = useState<Phase>(isLzMode && initialApp ? 'pick-agent' : 'pick-app');
  const [app, setApp]       = useState(initialApp ?? '');
  const [agents, setAgents] = useState<string[]>([]);
  const [agentIndex, setAgentIndex] = useState(0);
  const [outputFile, setOutputFile] = useState('');
  const [lines, setLines]   = useState<string[]>([]);
  const [done, setDone]     = useState(false);
  const [code, setCode]     = useState<number | null>(null);

  // #0854: run all selected agents sequentially; agentIndex advances on each close.
  useEffect(() => {
    if (phase !== 'running') return;
    const currentAgent = agents[agentIndex];
    if (!currentAgent) { setPhase('done'); return; }

    const args = ['challenge', '--app', app, '--agent', currentAgent, '--report'];
    // #1109: LZ Sovereignty Challenge uses --type lz and a separate output path.
    if (isLzMode) args.push('--type', 'lz');
    if (agents.length === 1 && outputFile.trim()) {
      args.push('--output', outputFile.trim());
    } else if (agents.length > 1) {
      // #1056: write each agent to a timestamped subdirectory so runs
      // don't overwrite each other; all agents in one session share the ts.
      if (!challengeRunTsRef.current) {
        challengeRunTsRef.current = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      }
      // #1109: LZ challenge uses wsp/challenge-lz/ with LZCA_ prefix; App uses wsp/challenge-app/.
      const subDir = isLzMode ? 'challenge-lz' : 'challenge-app';
      const filePrefix = isLzMode ? 'LZCA_' : 'AA_';
      const baseDir = workspace ? join(workspace, 'apps', app, 'wsp', subDir) : join('apps', app, 'wsp', subDir);
      const autoDir = join(baseDir, challengeRunTsRef.current);
      args.push('--output', join(autoDir, `${filePrefix}${currentAgent}.yaml`));
    }

    const push = (chunk: Buffer) => {
      setLines(prev => [...prev, ...chunk.toString().split('\n').filter(Boolean)]);
    };

    let childRef: ReturnType<typeof spawn> | null = null;

    // Inject credentials from the store before spawning -- mirrors AssessScreen.buildChildEnv.
    // credentialStore.get() is async so we resolve before spawn.
    void (async () => {
      const env = { ...process.env };
      const anthropicKey    = await credentialStore.get('anthropic-api-key');
      const openaiKey       = await credentialStore.get('openai-api-key');
      const ollamaEndpoint  = await credentialStore.get('ollama-endpoint');
      if (anthropicKey)   { env['SWAO_LLM_PROVIDER'] = 'anthropic'; env['SWAO_ANTHROPIC_API_KEY'] = anthropicKey; }
      else if (openaiKey) { env['SWAO_LLM_PROVIDER'] = 'openai';    env['SWAO_OPENAI_API_KEY']    = openaiKey; }
      if (ollamaEndpoint)   env['SWAO_OLLAMA_URL'] = ollamaEndpoint;

      const child = spawn(BIN, [SELF, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd: workspace ?? undefined,
      });
      childRef = child;

      child.stdout.on('data', push);
      child.stderr.on('data', push);
      child.on('close', (exitCode) => {
        setCode(exitCode);
        // On non-zero exit abort immediately -- do not advance to the next agent.
        if (exitCode !== 0) {
          setDone(true);
          setPhase('done');
          return;
        }
        if (agentIndex < agents.length - 1) {
          setLines(prev => [...prev, `${currentAgent}: done.`]);
          setAgentIndex(prev => prev + 1);
        } else {
          setDone(true);
          setPhase('done');
        }
      });
    })();

    return () => { childRef?.kill(); };
  }, [phase, agentIndex]);

  const guidanceOpenRef = useRef(false);
  // #1056: stable timestamp for the current challenge run so all agents
  // in a multi-agent session share the same output subdirectory.
  const challengeRunTsRef = useRef<string>('');

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if ((phase === 'done' || phase === 'pick-app') && key.escape) onBack();
    if ((phase === 'pick-agent' || phase === 'pick-output') && key.escape) { setAgents([]); setPhase('pick-app'); }
    if (phase === 'done' && key.return) (onComplete ?? onBack)();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={app ? `${screenTitle} -- ${app}` : screenTitle} />

      {phase === 'pick-app' && (
        <Box flexDirection="column">
          <Box marginTop={1}>
            {workspace
              ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
              : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
          </Box>
          <Box marginTop={1}>
            {assessedApps.length > 0 ? (
              <SelectInput
                label="Select assessed application to challenge"
                options={assessedApps.map(a => ({ label: a, value: a }))}
                onSelect={(v) => { setApp(v); setPhase('pick-agent'); }}
                active
              />
            ) : (
              <Text color="yellow">No assessed apps found. Run an assessment first.</Text>
            )}
          </Box>
          <GuidanceBox
            title="Stakeholder Challenge"
            what="LLM agent that stress-tests the 7R recommendation from a stakeholder lens."
            affordances={['Up/Down -- pick app  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'pick-agent' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1}>
            <MultiSelect
              label={isLzMode ? 'Select LZ sovereignty agent(s)' : 'Select stakeholder agent(s)'}
              options={isLzMode ? LZ_AGENT_OPTIONS : AGENT_OPTIONS}
              initialSelected={['all']}
              allValue="all"
              onConfirm={(selected) => {
                if (selected.length === 0) return;
                // #1109: expand 'all' to the full LZ agent list when in LZ mode.
                const resolved = selected.includes('all') && isLzMode ? LZ_ALL_AGENT_VALUES : selected;
                setAgents(resolved);
                setAgentIndex(0);
                setPhase('pick-output');
              }}
            />
          </Box>
          <GuidanceBox
            title={isLzMode ? 'LZ sovereignty agent(s)' : 'Stakeholder agent(s)'}
            what={isLzMode
              ? 'Select one or more LZ sovereignty lenses. Each produces a separate LZCA_ challenge report.'
              : 'Select one or more lenses to run in sequence. Each produces a separate challenge report.'}
            details={isLzMode ? [
              { label: 'GRC',        value: 'Sovereignty verdicts, framework interpretation' },
              { label: 'Architect',  value: 'Service gaps, deployment readiness' },
              { label: 'Procurement', value: 'Contracts, lock-in, exit strategy' },
              { label: 'CISO',       value: 'Exposure, encryption, incident response' },
            ] : [
              { label: 'Architect',   value: 'Architecture fitness, technical debt' },
              { label: 'Business',    value: 'Value, outcome, migration ROI' },
              { label: 'Compliance',  value: 'Regulatory controls, data-protection gaps' },
              { label: 'FinOps',      value: 'Cloud cost, licence drag' },
              { label: 'Programme',   value: 'Delivery, dependencies, schedule' },
            ]}
            affordances={['Space -- toggle  |  A -- select all  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'pick-output' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text>  Stakeholders: <Text color="cyanBright">{agents.join(', ')}</Text></Text>
          <Text dimColor>Optional -- write the structured YAML report to a file (single agent only).</Text>
          <Text dimColor>Press Enter on blank to print to stdout only (or auto-path for multi-agent).</Text>
          <Box marginTop={1}>
            <TextInput
              key="challenge-output"
              label="Output file path (optional)"
              placeholder="apps/sovereign-health/wsp/challenge-app/<agent>.yaml"
              onSubmit={(v) => { setOutputFile(v); setPhase('running'); }}
              active
            />
          </Box>
          <GuidanceBox
            title="Output file"
            what="Path for the YAML challenge transcript. Enter to print to stdout only."
            affordances={['Enter -- confirm or skip  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {(phase === 'running' || phase === 'done') && (
        <Box flexDirection="column">
          {/* #0918/#1053: constrain agent list to Box width and truncate the whole line */}
          <Box flexDirection="column" width={Math.min(100, Math.max(63, (process.stdout.columns ?? 80) - 2))}>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text wrap="truncate-end">Stakeholders: <Text color="cyanBright">{agents.join(', ')}</Text></Text>
          </Box>
          {/* #0917: progress bar -- one step per agent */}
          <ProgressBar
            value={done ? agents.length : Math.min(agentIndex + 1, Math.max(1, agents.length - 1))}
            total={agents.length > 0 ? agents.length : 1}
            width={Math.min(40, Math.max(20, (process.stdout.columns ?? 80) - 20))}
            color={done && code === 0 ? 'green' : 'cyan'}
          />
          {!done && (
            <Text color="yellow">Running: <Text bold>{agents[agentIndex]}</Text></Text>
          )}
          {done && code === 0 && <Text color="green">Challenge complete ({agents.length} agent{agents.length > 1 ? 's' : ''}).</Text>}
          {done && code !== 0 && <Text color="red">Challenge failed. See the output above for details.</Text>}
          <LiveOutput lines={lines} maxLines={20} />
          {/* #0916: guidance box (Ctrl+G) for running/done phase */}
          <GuidanceBox
            title="Stakeholder Challenge"
            what={
              'Each agent reviews your Workload Sovereignty Profile (WSP) from their stakeholder ' +
              'perspective and generates a structured challenge report with findings and questions.'
            }
            details={[
              { label: 'Output',   value: 'apps/<app>/wsp/challenge-app/<ts>/<agent>.yaml  (one file per agent)' },
              { label: 'Next',     value: 'Open each report to prepare your consultant response before the review meeting. Use the questions as a pre-flight checklist.' },
              { label: 'Agents',   value: 'application-architect | business-owner | grc-compliance-officer | finops-lead | programme-manager' },
            ]}
            affordances={[done ? 'Enter or Escape to return.' : 'Escape to cancel.']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}
    </Box>
  );
}
