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
import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { CredentialStore, findInstalledChromium, PLAYWRIGHT_VERSION, logPortfolio, setWorkspaceRoot } from '@swao/core';
// claude-desktop probe relocated to @swao/module-doctor (#0573).
import { claudeDesktopConfigPath } from '@swao/module-health-check';
// #1400 sprint-113: SWAO LLM-Gateway connector discovery for the LLM step.
import { listConnectors, getConnector, copyConnectorToWorkspace, discoverModels, mergeDiscoveredModels, writeWorkspaceConnector, type LoadedConnector, type ConnectorModelEntry } from '@swao/module-llm-providers';
import { buildWorkspaceSwaoYml, runWorkspaceScaffolders, validateIso8601Date } from '../../commands/init.js';

function isCredentialStored(name: string): boolean {
  const envKey = `SWAO_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
  if (process.env[envKey]) return true;
  try {
    const creds = new CredentialStore().loadSync();
    return name in creds && !!creds[name];
  } catch { return false; }
}

import { patchClaudeDesktopConfig } from '../mcp-config.js';
import { Header } from '../components/Header.js';
import { StepBar } from '@swao/tui-kit';
import { TextInput } from '@swao/tui-kit';
import { PasswordInput } from '@swao/tui-kit';
import { SelectInput, PICKER_VISIBLE_COUNT } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
// DoctorProbeList relocated to @swao/module-doctor (#0573).
import { HealthCheckProbeList } from '@swao/module-health-check';
import { saveDefaultWorkspace } from '@swao/core';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

// #0760: module-level flag tracks whether any GuidanceBox in the wizard is
// currently expanded. The root useInput guard reads it to prevent Escape from
// navigating away when the user intends to close the guidance panel.
// One SetupWizard renders at a time so a module-level flag is safe here.
let _wizardGuidanceOpen = false;
const setWizardGuidanceOpen = (open: boolean): void => { _wizardGuidanceOpen = open; };

const CRED_PATH = join(homedir(), '.config', 'swao', '.swao-credentials.json');

type Step = 'init' | 'llm' | 'llm-secondary' | 'credentials' | 'health-check' | 'claude-desktop' | 'playwright' | 'ready';
// 'llm-secondary' is a sub-step of 'llm' -- not in STEP_LABELS so StepBar still shows 7 steps.
const STEP_LABELS: Exclude<Step, 'llm-secondary'>[] = ['init', 'llm', 'credentials', 'health-check', 'claude-desktop', 'playwright', 'ready'];
const STEP_NAMES = ['Init', 'LLM', 'Credentials', 'Health Check', 'MCP Client', 'Playwright', 'Ready'];

// #1400 sprint-113: `gw:<connector-id>` selects a SWAO LLM-Gateway connector
// (Design 090); the literal values remain for the legacy fallback path.
type LlmProvider = 'anthropic' | 'openai' | 'ollama' | 'open-llm-provider' | 'skip' | `gw:${string}`;

const LLM_OPTIONS = [
  { label: 'Anthropic Claude   (recommended -- requires Anthropic API key)', value: 'anthropic'         },
  { label: 'OpenAI ChatGPT     (requires OpenAI API key)',                   value: 'openai'            },
  { label: 'Ollama             (local model -- no API key needed)',           value: 'ollama'            },
  { label: 'Open LLM Provider  (custom OpenAI-compatible endpoint)',         value: 'open-llm-provider' },
  { label: 'Skip               -- configure manually in .swao.yml later',    value: 'skip'              },
];

const ANTHROPIC_MODELS = [
  { label: 'claude-opus-4-8         (most capable, recommended)', value: 'claude-opus-4-8'         },
  { label: 'claude-sonnet-5         (balanced)',                   value: 'claude-sonnet-5'          },
  { label: 'claude-haiku-4-5-20251001  (fast, economical)',        value: 'claude-haiku-4-5-20251001' },
];

const OPENAI_MODELS = [
  { label: 'gpt-4o             (recommended)', value: 'gpt-4o'       },
  { label: 'gpt-4o-mini        (economical)',  value: 'gpt-4o-mini'  },
  { label: 'gpt-4-turbo',                      value: 'gpt-4-turbo'  },
];

interface SetupState {
  workDir: string;
  engagementName: string;
  clientCode: string;
  partnershipLead: string;
  llmProvider: LlmProvider;
  llmModel: string;
  ollamaEndpoint: string;
  openLlmBaseUrl: string;
}

interface SetupWizardProps {
  onBack: () => void;
}

// -- Step 1: Init workspace -----------------------------------------------

type InitPhase =
  | 'input-dir'
  | 'input-engagement-name'
  | 'input-client-code'
  | 'input-lead'
  | 'input-engagement-lead'
  | 'input-end-date'
  | 'confirm-existing'
  | 'edit-existing-name'
  | 'edit-existing-code'
  | 'edit-existing-lead';

interface ExistingSwaoYml {
  engagement?: { name?: string; client_code?: string; partnership_lead?: string; start_date?: string; end_date?: string; engagement_lead?: string; account_executive?: string; project_manager?: string; engagement_id?: string; description?: string };
  crawl?: { target_url?: string };
  [key: string]: unknown;
}

function InitStep({ onNext }: { onNext: (s: Pick<SetupState, 'workDir' | 'engagementName' | 'clientCode' | 'partnershipLead'>) => void }) {
  const [phase, setPhase]         = useState<InitPhase>('input-dir');
  const [workDir, setWorkDir]     = useState('');
  const [engName, setEngName]     = useState('');
  const [clientCode, setClientCode] = useState('');
  const [lead, setLead]           = useState('');
  const [engagementLead, setEngagementLead] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [existingParsed, setExistingParsed] = useState<ExistingSwaoYml | null>(null);
  const [error, setError]         = useState('');

  const tryDir = (dir: string) => {
    const resolved = resolve(dir.trim() || '.');
    setWorkDir(resolved);
    const yamlPath = join(resolved, '.swao.yml');
    if (existsSync(yamlPath)) {
      try {
        const raw = readFileSync(yamlPath, 'utf-8');
        const parsed = (yamlLoad(raw) as ExistingSwaoYml) ?? {};
        setExistingParsed(parsed);
        setEngName(String(parsed.engagement?.name ?? ''));
        setClientCode(String(parsed.engagement?.client_code ?? ''));
        setLead(String(parsed.engagement?.partnership_lead ?? ''));
        setEngagementLead(String(parsed.engagement?.engagement_lead ?? ''));
        setEndDate(String(parsed.engagement?.end_date ?? ''));
      } catch {
        setExistingParsed({});
      }
      setPhase('confirm-existing');
    } else {
      setPhase('input-engagement-name');
    }
  };

  const writeAndFinish = (name: string, code: string, ownerLead: string, engLead: string, end: string) => {
    const resolved = workDir;
    let redactorType: 'gitleaks' | 'pattern' = 'pattern';
    try { const r = spawnSync('gitleaks', ['version'], { timeout: 3000, stdio: 'ignore' }); if (!r.error) redactorType = 'gitleaks'; } catch { /* pattern fallback */ }
    const yaml = buildWorkspaceSwaoYml({ name, code, ownerLead, engLead, endDate: end, redactorType });
    try {
      mkdirSync(resolved, { recursive: true });
      // #0775: apps/ is created empty; user adds apps via Run Assessment > "+ New app..."
      mkdirSync(join(resolved, 'apps'), { recursive: true });
      writeFileSync(join(resolved, '.swao.yml'), yaml, 'utf-8');
      runWorkspaceScaffolders(resolved);
    } catch (e) {
      setError(`Could not write .swao.yml: ${(e as Error).message}`);
      return;
    }
    onNext({ workDir: resolved, engagementName: name, clientCode: code, partnershipLead: ownerLead });
  };

  // Update engagement fields in an existing .swao.yml without touching other blocks.
  const writeAndUpdate = (name: string, code: string, ownerLead: string, engLead: string, end: string) => {
    const yamlPath = join(workDir, '.swao.yml');
    try {
      const base = existingParsed ?? {};
      const engBlock: ExistingSwaoYml['engagement'] = {
        ...(base.engagement ?? {}),
        name,
        client_code: code,
        partnership_lead: ownerLead,
      };
      if (engLead) engBlock.engagement_lead = engLead;
      if (end) engBlock.end_date = end;
      const updated: ExistingSwaoYml = { ...base, engagement: engBlock };
      writeFileSync(yamlPath, `# .swao.yml -- SWAO workspace configuration\n${yamlDump(updated)}`, 'utf-8');
      try { runWorkspaceScaffolders(workDir); } catch { /* best-effort */ }
    } catch (e) {
      setError(`Could not update .swao.yml: ${(e as Error).message}`);
      return;
    }
    onNext({ workDir, engagementName: name, clientCode: code, partnershipLead: ownerLead });
  };

  // -- Edit-existing flow (pre-filled inputs from parsed YAML) ---------------

  if (phase === 'edit-existing-name') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Edit Engagement Details</Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-eng-name"
            label="Engagement name"
            placeholder={engName || 'My Cloud Transformation'}
            onSubmit={(v) => { setEngName(v || engName); setPhase('edit-existing-code'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Engagement name"
          what={`Current: ${engName || '(not set)'}. Press Enter to keep, or type a new value.`}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'edit-existing-code') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Edit Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-client-code"
            label="Client code (slug)"
            placeholder={clientCode || 'acme'}
            onSubmit={(v) => { setClientCode(v || clientCode); setPhase('edit-existing-lead'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Client code"
          what={`Current: ${clientCode || '(not set)'}. Short slug used in folder names and BI exports.`}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'edit-existing-lead') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Edit Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text>  Code: <Text color="cyanBright">{clientCode}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-lead"
            label="Engagement owner email (Enter to keep)"
            placeholder={lead || 'you@example.com'}
            onSubmit={(v) => { writeAndUpdate(engName, clientCode, v || lead, engagementLead, endDate); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Engagement owner email"
          what={`Current: ${lead || '(not set)'}. Shown on report covers.`}
          affordances={['Enter -- confirm or keep  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'confirm-existing') {
    const eng = existingParsed?.engagement;
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Workspace Found</Text>
        <Text>  <Text color="cyanBright">{workDir}/.swao.yml</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>  Engagement:  <Text color="cyanBright">{eng?.name || '(not set)'}</Text></Text>
          <Text>  Client code: <Text color="cyanBright">{eng?.client_code || '(not set)'}</Text></Text>
          <Text>  Lead email:  <Text color="cyanBright">{eng?.partnership_lead || '(not set)'}</Text></Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>  <Text color="cyanBright">Enter</Text>  -- continue with this workspace</Text>
          <Text>  <Text color="cyanBright">E</Text>      -- edit engagement details</Text>
          <Text>  <Text color="cyanBright">Esc</Text>    -- choose a different directory</Text>
        </Box>
        <ConfirmOrEdit
          onConfirm={() => {
            try { runWorkspaceScaffolders(workDir); } catch { /* best-effort */ }
            onNext({ workDir, engagementName: engName, clientCode, partnershipLead: lead });
          }}
          onEdit={() => setPhase('edit-existing-name')}
          onBack={() => setPhase('input-dir')}
        />
        <GuidanceBox
          title="Workspace found"
          what="Continuing updates bundled assets. Press E to edit engagement name, code, or lead email."
          affordances={['Enter -- continue  |  E -- edit config  |  Esc -- choose different directory']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'input-engagement-name') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Engagement Details</Text>
        <Text dimColor>These appear in all assessment reports.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-engagement-name"
            label="Engagement name (e.g. ACME Cloud Transformation)"
            placeholder="My Cloud Transformation"
            onSubmit={(v) => { if (v) { setEngName(v); setPhase('input-client-code'); } }}
            active
          />
        </Box>
        {error && <Text color="red">{error}</Text>}
        <GuidanceBox
          title="Engagement name"
          what="Name shown on all report covers (e.g. ACME Cloud Transformation)."
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'input-client-code') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-client-code"
            label="Client code (short slug, e.g. acme)"
            placeholder="acme"
            onSubmit={(v) => {
              if (v) { setClientCode(v); setPhase('input-lead'); }
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Client code"
          what="Short slug used in folder names and BI exports."
          details={[{ label: 'Format', value: 'lowercase letters, digits, hyphens (e.g. acme)' }]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'input-lead') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text>  Code: <Text color="cyanBright">{clientCode}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-lead"
            label="Engagement owner email (Enter to skip)"
            placeholder="you@example.com"
            onSubmit={(v) => { setLead(v); setPhase('input-engagement-lead'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Engagement owner email"
          what="Optional contact shown on report covers. Enter to skip."
          affordances={['Enter -- confirm or skip  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'input-engagement-lead') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text>  Code: <Text color="cyanBright">{clientCode}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-engagement-lead"
            label="Engagement lead name or email (Enter to skip)"
            placeholder="firstname.lastname@example.com"
            onSubmit={(v) => { setEngagementLead(v); setPhase('input-end-date'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Engagement lead"
          what="The person leading delivery. Shown on HTML publication covers. Enter to skip."
          affordances={['Enter -- confirm or skip  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'input-end-date') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1 -- Engagement Details</Text>
        <Text>  Engagement: <Text color="cyanBright">{engName}</Text>  Code: <Text color="cyanBright">{clientCode}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-end-date"
            label="Expected end date YYYY-MM-DD (Enter to skip)"
            placeholder="2026-12-31"
            onSubmit={(v) => {
              const err = validateIso8601Date(v);
              if (err) { setError(err); return; }
              writeAndFinish(engName, clientCode, lead, engagementLead, v);
            }}
            active
          />
        </Box>
        {error && <Text color="red">{error}</Text>}
        <GuidanceBox
          title="Engagement end date"
          what="Target completion date in YYYY-MM-DD format. Shown on publication covers. Enter to skip."
          affordances={['Enter -- confirm or skip  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  // phase === 'input-dir'
  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 1 -- Initialise Workspace</Text>
      <Text dimColor>Creates .swao.yml for a new workspace, or continues with an existing one.</Text>
      <Box marginTop={1} flexDirection="column">
        <TextInput
          label="Workspace directory (Enter for current)"
          placeholder="."
          onSubmit={tryDir}
          active
        />
      </Box>
      {error && <Text color="red">{error}</Text>}
      <GuidanceBox
        title="Workspace directory"
        what="Folder for this engagement. Enter for current directory; existing workspaces are detected and reused."
        affordances={['Enter -- confirm  |  Esc -- back']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

function ConfirmContinue({ onConfirm, onBack }: { onConfirm: () => void; onBack: () => void }) {
  useInput((_input, key) => {
    // #1412: Enter fires even when guidance is open -- GuidanceBox closes in
    // the same keypress, giving one-press advance rather than two-press.
    if (key.return) onConfirm();
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });
  return null;
}

function ConfirmOrEdit({ onConfirm, onEdit, onBack }: { onConfirm: () => void; onEdit: () => void; onBack: () => void }) {
  useInput((input, key) => {
    if (key.return) onConfirm(); // #1412: same one-press advance
    if ((input === 'e' || input === 'E') && !_wizardGuidanceOpen) onEdit();
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });
  return null;
}

// -- Step 1b: LLM provider ------------------------------------------------

type LlmPhase =
  | 'pick-provider'
  | 'pick-model'
  | 'gw-model'
  | 'gw-model-custom'
  | 'ollama-endpoint'
  | 'ollama-model'
  | 'open-llm-url'
  | 'open-llm-model';

function LlmStep({
  onNext,
  workspaceRoot,
}: {
  onNext: (provider: LlmProvider, model: string, endpoint: string, openLlmBaseUrl: string) => void;
  workspaceRoot?: string;
}) {
  const [phase, setPhase]       = useState<LlmPhase>('pick-provider');
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [, setModel]            = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [openLlmBaseUrl, setOpenLlmBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // #1400: discover SWAO LLM-Gateway connectors once per step mount --
  // bundled seeds plus any file the user dropped into wsp/inputs/llm-gateway/.
  const [connectors] = useState<LoadedConnector[]>(() => {
    try { return listConnectors({ workspaceRoot }).connectors; } catch { return []; }
  });
  const selectedConnector = provider.startsWith('gw:')
    ? connectors.find(c => c.file.connector.id === provider.slice(3))
    : undefined;

  // #1405: dynamic model discovery + pricing capture. When the selected
  // connector declares a discovery_endpoint, fetch the platform's model list
  // once, merge it into the catalogue (curated entries always win), and
  // persist the refreshed connector into wsp/inputs/llm-gateway/<id>.yaml so
  // assess-time cost resolution knows every model's per-million prices.
  // Offline / air-gapped: silent fallback to the static catalogue.
  const [gwDiscovery, setGwDiscovery] = useState<{
    status: 'idle' | 'running' | 'done' | 'offline';
    count: number;
    catalogue?: ConnectorModelEntry[];
  }>({ status: 'idle', count: 0 });

  useEffect(() => {
    if (phase !== 'gw-model' || !selectedConnector) return;
    if (!selectedConnector.file.connector.models.discovery_endpoint) return;
    if (gwDiscovery.status !== 'idle') return;
    setGwDiscovery({ status: 'running', count: 0 });
    let cancelled = false;
    void discoverModels(selectedConnector, { timeoutMs: 5000 })
      .then(r => {
        if (!r.ok) {
          if (!cancelled) setGwDiscovery({ status: 'offline', count: 0 });
          return;
        }
        // Persist FIRST, unguarded: the operator often confirms a model
        // before the fetch returns, which unmounts/cancels this effect --
        // the refreshed catalogue + prices must land in the workspace
        // connector file regardless of where the UI is by then.
        const merged = mergeDiscoveredModels(selectedConnector.file, r.models);
        if (workspaceRoot) {
          try { writeWorkspaceConnector(workspaceRoot, merged); }
          catch { /* unwritable workspace -- the picker still refreshes */ }
        }
        if (cancelled) return;
        setGwDiscovery({ status: 'done', count: r.models.length, catalogue: merged.connector.models.catalogue });
      })
      .catch(() => { if (!cancelled) setGwDiscovery({ status: 'offline', count: 0 }); });
    return () => { cancelled = true; };
  }, [phase, selectedConnector, workspaceRoot, gwDiscovery.status]);

  if (phase === 'pick-provider') {
    // Gateway path: one option per discovered connector. Legacy hardcoded
    // list only as a fallback when discovery finds nothing (broken build --
    // the doctor probe 14/14 flags that state).
    const gwOptions = connectors.map(c => ({
      label: `${c.file.connector.name}${c.origin === 'workspace' ? '  [workspace]' : ''}  (protocol: ${c.file.connector.protocol})`,
      value: `gw:${c.file.connector.id}`,
    }));
    const options = gwOptions.length > 0
      ? [...gwOptions, { label: 'Skip  -- configure manually in .swao.yml later', value: 'skip' }]
      : LLM_OPTIONS;
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- LLM Provider (LLM-Gateway)</Text>
        <Text dimColor>SWAO uses an LLM for code analysis and synthesis passes.</Text>
        <Text dimColor>Connectors are files -- copy wsp/inputs/llm-gateway/_template.yaml to add your own platform.</Text>
        <Box marginTop={1}>
          <SelectInput
            label="Select LLM connector"
            options={options}
            onSelect={(v) => {
              const p = v as LlmProvider;
              setProvider(p);
              if (p.startsWith('gw:')) {
                const conn = connectors.find(c => c.file.connector.id === p.slice(3));
                const hasCatalogue = (conn?.file.connector.models.catalogue?.length ?? 0) > 0;
                setCustomModel(conn?.file.connector.models.default ?? '');
                setGwDiscovery({ status: 'idle', count: 0 }); // #1405: fresh discovery per connector
                setPhase(hasCatalogue ? 'gw-model' : 'gw-model-custom');
              }
              else if (p === 'anthropic' || p === 'openai') setPhase('pick-model');
              else if (p === 'ollama') setPhase('ollama-endpoint');
              else if (p === 'open-llm-provider') setPhase('open-llm-url');
              else onNext('skip', '', '', '');
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="What does the LLM do?"
          what="SWAO calls the chosen LLM for three passes: Pass 4 (data classification), Pass 9 (compliance verdicts), Pass 11 (7R synthesis). Each option is a connector FILE (Design 090): bundled seeds cover Anthropic, OpenAI, Ollama, generic OpenAI-compatible endpoints, and the OpenRouter aggregator; files you drop into wsp/inputs/llm-gateway/ appear here automatically."
          details={[
            { label: 'Anthropic',   value: 'Recommended -- highest reasoning quality for compliance verdicts.' },
            { label: 'Ollama',      value: 'Local model -- no API key, no data leaves the host.' },
            { label: 'OpenRouter',  value: 'One key, hundreds of vendor models -- ideal for model comparison.' },
            { label: 'vllm-generic', value: 'Template for internal GenAI hubs and vLLM deployments -- copy and amend.' },
            { label: 'Skip',        value: 'LLM passes fall back to UNKNOWN verdicts; configure later in .swao.yml.' },
            { label: 'Vision note', value: 'If assessment.vision_analysis: true is set in .swao.yml, Playwright screenshots are also sent to this connector. Cloud connectors (Anthropic, OpenAI) will receive raw screen data. Use Ollama or a local endpoint if the application under assessment handles sensitive data.' },
          ]}
          affordances={['Arrows -- navigate', 'Enter  -- select', 'Escape -- return to main menu']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  // #1400: model picker for a gateway connector with a catalogue.
  if (phase === 'gw-model' && selectedConnector) {
    const conn = selectedConnector.file.connector;
    const defaultId = conn.models.default;
    // #1405: prefer the refreshed catalogue. A large aggregator (e.g. OpenRouter,
    // 400+ models) is capped at GW_PICKER_CAP: curated entries first (hand-picked
    // in the connector YAML), then the top-ranked models from discovery to fill the
    // remaining slots. "Other model..." always covers the rest. Full list + prices
    // land in the workspace connector file regardless of the picker cap.
    const GW_PICKER_CAP = 40;
    const curated = conn.models.catalogue ?? [];
    // Cap at GW_PICKER_CAP at all times (running, offline, done) so the picker
    // never grows to hundreds of entries even when the connector file already
    // holds a full discovered catalogue from a previous session.
    let pickerModels = curated.slice(0, GW_PICKER_CAP);
    let discoveryNote = '';
    if (gwDiscovery.status === 'running') discoveryNote = 'Refreshing prices from the platform -- you can select from the list now or wait for updated pricing.';
    else if (gwDiscovery.status === 'offline') discoveryNote = 'Platform catalogue unreachable -- using the bundled catalogue.';
    else if (gwDiscovery.status === 'done' && gwDiscovery.catalogue) {
      if (gwDiscovery.catalogue.length <= GW_PICKER_CAP) {
        pickerModels = gwDiscovery.catalogue;
        discoveryNote = `Catalogue refreshed -- ${gwDiscovery.count} models with prices captured in the workspace connector file.`;
      } else {
        // Curated entries first (connector-YAML order), then top models from
        // discovery to fill up to GW_PICKER_CAP. "Other" covers the remainder.
        const curatedIds = new Set(curated.map(m => m.id));
        const curatedPicked  = gwDiscovery.catalogue.filter(m => curatedIds.has(m.id));
        const discoveryFill  = gwDiscovery.catalogue.filter(m => !curatedIds.has(m.id)).slice(0, GW_PICKER_CAP - curatedPicked.length);
        pickerModels = [...curatedPicked, ...discoveryFill].slice(0, GW_PICKER_CAP);
        discoveryNote = `${gwDiscovery.count} models discovered -- showing top ${pickerModels.length}; full list + prices in wsp/inputs/llm-gateway/${conn.id}.yaml.`;
      }
    }
    // Discovered per-million prices carry float noise (per-token strings
    // multiplied up); trim for display, keep full precision in the file.
    const fmtCost = (v: number): string => String(+v.toFixed(4));
    const modelOptions = [
      ...pickerModels.map(m => ({
        label: `${m.id}${m.id === defaultId ? '   (default)' : ''}${m.cost ? `   [$${fmtCost(m.cost.input_per_million)}/M in, $${fmtCost(m.cost.output_per_million)}/M out]` : ''}`,
        value: m.id,
      })),
      { label: 'Other model...   (type any model id the platform serves)', value: '__custom__' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- Model</Text>
        <Text>  Connector: <Text color="cyanBright">{conn.name}</Text></Text>
        {discoveryNote ? <Text dimColor>  {discoveryNote}</Text> : null}
        <Box marginTop={1}>
          <SelectInput
            key={gwDiscovery.status}
            label="Model"
            options={modelOptions}
            onSelect={(v) => {
              if (v === '__custom__') { setPhase('gw-model-custom'); return; }
              setModel(v);
              onNext(provider, v, '', '');
            }}
            active
            visibleCount={PICKER_VISIBLE_COUNT}
          />
        </Box>
        <GuidanceBox
          title="Select model"
          what={`The catalogue comes from the connector file${conn.models.discovery_endpoint ? '; the platform also supports dynamic model discovery' : ''}. The model catalogue is advisory -- Other lets you use any model the platform serves.`}
          details={[
            { label: 'Default', value: defaultId },
            ...(conn.sovereignty?.data_residency ? [{ label: 'Residency', value: String(conn.sovereignty.data_residency) }] : []),
          ]}
          affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  // #1400: free-text model entry (no catalogue, or Other chosen).
  if (phase === 'gw-model-custom' && selectedConnector) {
    const conn = selectedConnector.file.connector;
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- Model</Text>
        <Text>  Connector: <Text color="cyanBright">{conn.name}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="gw-model-custom"
            label={`Model id (Enter for default: ${conn.models.default})`}
            initialValue={customModel}
            onSubmit={(v) => {
              const m = v.trim() || conn.models.default;
              setModel(m);
              onNext(provider, m, '', '');
            }}
          />
        </Box>
        <GuidanceBox
          title="Model id"
          what="Type the model identifier exactly as the platform expects it (for aggregators use the vendor-prefixed id, e.g. mistralai/mistral-large)."
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'pick-model') {
    const models = provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;
    const guidanceDetails = provider === 'anthropic'
      ? [
          { label: 'opus-4-7',  value: 'Most capable. Use for client engagements + audit-grade output. ~$0.30-0.50/assess, 8-12 min.' },
          { label: 'sonnet-4-6', value: 'Balanced reasoning vs cost. Standard assessments + iteration cycles. ~$0.10-0.15/assess, 5-8 min.' },
          { label: 'haiku-4-5',  value: 'Cheapest + fastest. Dry-run / first iteration / cost-sensitive. ~$0.02-0.05/assess, 2-4 min.' },
        ]
      : [
          { label: 'gpt-4o',      value: 'Recommended -- best OpenAI reasoning for compliance verdicts.' },
          { label: 'gpt-4o-mini', value: 'Economical -- cheaper, faster, slightly weaker reasoning.' },
          { label: 'gpt-4-turbo', value: 'Older generation -- pick only if your org pins it for compatibility.' },
        ];
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- LLM Provider</Text>
        <Text>  Provider: <Text color="cyanBright">{provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI ChatGPT'}</Text></Text>
        <Box marginTop={1}>
          <SelectInput
            label="Model"
            options={models}
            onSelect={(v) => { setModel(v); onNext(provider, v, '', ''); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Select model"
          what="Better models improve verdict quality but cost more. Choose by audience: client report = top model, dry run = economical."
          details={guidanceDetails}
          affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'ollama-endpoint') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- Ollama</Text>
        <Box marginTop={1}>
          <TextInput
            key="ollama-endpoint"
            label="Ollama endpoint (Enter for http://127.0.0.1:11434)"
            placeholder="http://127.0.0.1:11434"
            onSubmit={(v) => { setEndpoint(v || 'http://127.0.0.1:11434'); setPhase('ollama-model'); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Ollama endpoint"
          what="URL of your local Ollama server. Enter for the local default."
          details={[{ label: 'Format', value: 'http://host:port  (no trailing slash)' }]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'open-llm-url') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- Open LLM Provider</Text>
        <Box marginTop={1}>
          <TextInput
            key="open-llm-url"
            label="Base URL (e.g. https://your-llm.example.com)"
            placeholder="https://your-llm.example.com"
            onSubmit={(v) => { if (v) { setOpenLlmBaseUrl(v); setPhase('open-llm-model'); } }}
            active
          />
        </Box>
        <GuidanceBox
          title="Open LLM Provider -- Base URL"
          what="The base URL of your OpenAI-compatible LLM endpoint. Do not include the model prefix or /v1/chat/completions."
          details={[
            { label: 'Format',  value: 'https://host (no trailing slash)' },
            { label: 'Example', value: 'https://preme-genai-hub.example.com' },
          ]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  if (phase === 'open-llm-model') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1b -- Open LLM Provider</Text>
        <Text>  Base URL: <Text color="cyanBright">{openLlmBaseUrl}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="open-llm-model"
            label="Model name (e.g. Mistral-Small-24B-Instruct-2501)"
            placeholder="Mistral-Small-24B-Instruct-2501"
            onSubmit={(v) => { if (v) onNext('open-llm-provider', v, '', openLlmBaseUrl); }}
            active
          />
        </Box>
        <GuidanceBox
          title="Open LLM Provider -- Model"
          what="The model identifier served by your endpoint. Used as the path prefix and in the JSON body."
          details={[
            { label: 'Format',  value: 'Model name as-is (e.g. Mistral-Small-24B-Instruct-2501)' },
            { label: 'Bearer token', value: 'Stored next -- never written to .swao.yml' },
          ]}
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  // ollama-model
  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 1b -- Ollama</Text>
      <Text>  Endpoint: <Text color="cyanBright">{endpoint}</Text></Text>
      <Box marginTop={1}>
        <TextInput
          key="ollama-model"
          label="Model name (e.g. llama3.1, mistral)"
          placeholder="llama3.1"
          onSubmit={(v) => { if (v) onNext('ollama', v, endpoint, ''); }}
          active
        />
      </Box>
      <GuidanceBox
        title="Ollama model"
        what="Model name as shown by `ollama list`. Run `ollama pull <name>` first if not installed."
        details={[{ label: 'Format', value: 'e.g. llama3.1, mistral, qwen2.5' }]}
        affordances={['Enter -- confirm  |  Esc -- back']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

// -- Step 1c: Secondary LLM provider (#1768) --------------------------------

// Reads the latest LLM Assessment run (if any) and returns the connector id
// of the top-ranked non-primary leg as a suggestion for the secondary slot.
function suggestSecondaryConnector(workspaceRoot: string, primaryProvider: LlmProvider): string | null {
  try {
    const latestFile = join(workspaceRoot, 'llm-assessments', 'swao', 'latest.txt');
    if (!existsSync(latestFile)) return null;
    const ts = readFileSync(latestFile, 'utf-8').trim();
    const pubPath = join(workspaceRoot, 'llm-assessments', 'swao', ts, 'comparison', 'publication-model.json');
    if (!existsSync(pubPath)) return null;
    const raw = JSON.parse(readFileSync(pubPath, 'utf-8')) as Record<string, unknown>;
    const final = raw['final'] as { rank?: Record<string, number | null> } | undefined;
    if (!final?.rank) return null;
    const legs = raw['legs'] as Array<{ id: string; connector: string; primary?: boolean }> | undefined;
    if (!legs) return null;
    // Sort legs by rank, pick the best-ranked leg that is NOT the primary.
    const ranked = Object.entries(final.rank)
      .filter(([, r]) => r !== null)
      .sort(([, a], [, b]) => (a as number) - (b as number));
    const primaryConnector = primaryProvider.startsWith('gw:') ? primaryProvider.slice(3) : null;
    for (const [legId] of ranked) {
      const leg = legs.find((l) => l.id === legId);
      if (!leg) continue;
      if (leg.primary) continue;
      if (primaryConnector && leg.connector === primaryConnector) continue;
      return leg.connector;
    }
    return null;
  } catch {
    return null;
  }
}

function LlmSecondaryStep({
  workspaceRoot,
  primaryProvider,
  onSkip,
  onNext,
}: {
  workspaceRoot: string;
  primaryProvider: LlmProvider;
  onSkip: () => void;
  onNext: (provider: LlmProvider, model: string, endpoint: string, openLlmBase: string) => void;
}) {
  const [phase, setPhase] = useState<'prompt' | 'configure'>('prompt');
  const suggestion = suggestSecondaryConnector(workspaceRoot, primaryProvider);

  useInput((_input, key) => {
    if (phase !== 'prompt') return;
    if (key.escape) onSkip();
  });

  if (phase === 'configure') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 1c -- Secondary LLM Provider</Text>
        <LlmStep
          workspaceRoot={workspaceRoot}
          onNext={onNext}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 1c -- Secondary LLM Provider (optional)</Text>
      <Text dimColor>A secondary provider runs LLM Assessment legs in parallel with the primary for direct model comparison.</Text>
      {suggestion && (
        <Box marginTop={1}>
          <Text>  Suggestion from last LLM Assessment: <Text color="cyan">{suggestion}</Text></Text>
        </Box>
      )}
      <Box marginTop={1}>
        <SelectInput
          label="Add a secondary LLM provider?"
          options={[
            { label: 'Yes -- configure a secondary provider now', value: 'yes' },
            { label: 'No  -- skip (can be added later in .swao.yml)', value: 'no' },
          ]}
          onSelect={(v) => {
            if (v === 'yes') setPhase('configure');
            else onSkip();
          }}
          active
        />
      </Box>
      <GuidanceBox
        title="Secondary LLM provider"
        what="Configure a second provider to enable head-to-head model comparison in LLM Assessment (Design 092). The secondary provider runs the same passes as the primary; results appear side-by-side in the HTML and PDF reports."
        details={[
          { label: 'When useful',  value: 'Comparing Anthropic vs OpenAI, testing a new model version, or benchmarking a private deployment.' },
          { label: 'Skip is fine', value: 'You can add providers.llm.secondary manually in .swao.yml at any time.' },
          ...(suggestion ? [{ label: 'Suggestion', value: `${suggestion} ranked #2 in your last LLM Assessment run.` }] : []),
        ]}
        affordances={['Up/Down -- select  |  Enter -- confirm  |  Escape -- skip']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

// -- Step 2: Credentials --------------------------------------------------

function CredentialsStep({
  provider,
  onNext,
  workspaceRoot,
}: {
  provider: LlmProvider;
  onNext: () => void;
  workspaceRoot?: string;
}) {
  const [status, setStatus] = useState('');
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  // #1400: gateway connector selection -- the connector file names the
  // credential-store entry; a connector without auth (ollama) needs nothing.
  const gwConnector = provider.startsWith('gw:')
    ? (() => { try { return getConnector(provider.slice(3), { workspaceRoot }); } catch { return undefined; } })()
    : undefined;
  const gwCredKey = gwConnector?.file.connector.auth.credential_key;
  const needsCredential = provider.startsWith('gw:')
    ? Boolean(gwCredKey)
    : (provider === 'anthropic' || provider === 'openai' || provider === 'open-llm-provider');

  // #0809: VCS token belongs in the Application Assessment flow (per-app),
  // not the global workspace wizard. Providers with no API key (ollama, skip)
  // have nothing to enter here; advance immediately to the next step.
  useEffect(() => {
    if (!needsCredential) {
      onNextRef.current();
    }
  }, []); // fires once on mount; provider is immutable for the wizard step lifetime

  const storeCredential = (name: string, value: string) => {
    if (!value) return;
    // #1835: pkg binary passes itself as argv[1] causing a MODULE_NOT_FOUND crash.
    // Use the same isPkg guard as spawnLeg / LlmAssessmentScreen to omit SELF.
    const _isPkg = Boolean((process as { pkg?: unknown }).pkg);
    const _baseArgs = _isPkg ? [] : [SELF];
    const child = spawn(BIN, [..._baseArgs, 'credential', 'set', name, value], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PKG_EXECPATH: '' },
    });
    child.on('close', (code) => {
      if (code !== 0) setStatus(`Warning: could not store ${name}`);
    });
  };

  if (!needsCredential) return null;

  const isOpenLlm = provider === 'open-llm-provider';
  const llmLabel = gwConnector
    ? `API key for ${gwConnector.file.connector.name} (Enter to skip if unauthenticated)`
    : isOpenLlm
      ? 'Bearer token for Open LLM Provider (Enter to skip if unauthenticated)'
      : provider === 'openai'
        ? 'OpenAI API key (sk-...)'
        : 'Anthropic API key (sk-ant-...)';
  const credName = gwCredKey
    ?? (isOpenLlm
      ? `open-llm-api-key-${process.env['SWAO_LLM_ENV'] ?? 'prod'}`
      : provider === 'openai'
        ? 'openai-api-key'
        : 'anthropic-api-key');
  const llmAlreadyStored = isCredentialStored(credName);
  const obtainUrl = gwConnector
    ? (gwConnector.file.connector.description ?? 'Your platform administrator -- see the connector file')
    : isOpenLlm
      ? 'Your platform administrator -- see runbook docs/runbooks/llm-provider-swap.md'
      : provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://console.anthropic.com/settings/keys';
  const providerLabel = gwConnector
    ? gwConnector.file.connector.name
    : isOpenLlm ? 'Open LLM Provider' : provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const llmStatusLine = llmAlreadyStored
    ? `${providerLabel} token: stored (Enter to keep)`
    : `${providerLabel} token: NOT stored -- needed for authenticated endpoints`;

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 2 -- Credentials</Text>
      <Text dimColor>Values are stored locally. Enter to keep existing value. Never printed after entry.</Text>
      <Text>Storage: <Text bold color="whiteBright">{CRED_PATH}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        {llmAlreadyStored && <Text color="green">{providerLabel} token already stored -- press Enter to keep.</Text>}
        <PasswordInput
          label={llmAlreadyStored ? `${llmLabel} (Enter to keep existing)` : llmLabel}
          onSubmit={(v) => {
            if (v) storeCredential(credName, v);
            onNext();
          }}
          active
        />
      </Box>
      {status && <Text color="green">{status}</Text>}
      <GuidanceBox
        title="Step 2 -- Credentials"
        what="Stored encrypted on this machine. Never printed in reports or logs."
        details={[
          { label: 'Token',     value: llmStatusLine },
          { label: 'Obtain at', value: obtainUrl },
        ]}
        affordances={['Enter -- save or keep existing  |  Esc -- back']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

// -- Step 4: Health Check -------------------------------------------------

function HealthCheckStep({ onNext }: { onNext: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try { logPortfolio('info', 'setup.health-check.start', 'Setup Wizard: invoking health-check probe runner'); } catch { /* best-effort */ }
    const child = spawn(BIN, [SELF, 'health-check'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // #1234: use parent env unchanged. PKG_EXECPATH='' prevents child VFS init
      // (0 probes). SELF as argv[1] covers the pkg splice; MCP spawns (server.ts)
      // omit SELF and still need PKG_EXECPATH='' -- do not change server.ts.
      env: process.env,
    });
    // #1147: buffer partial lines across chunk boundaries; strip \r for Windows
    // CRLF so HEADER_RE always sees complete lines (mirrors HealthCheckScreen.tsx).
    // #1675: separate buffers per stream -- a newline-less stderr write must not be
    // prepended to the next stdout chunk, which corrupts the [N/M] header pattern
    // and causes probes to be silently dropped from the TUI list.
    let stdoutBuf = '';
    let stderrBuf = '';
    // #1675: track probe count via closure so close handler can emit NDJSON events.
    let hcProbeCount = 0;
    let hcFailCount = 0;
    // Idle watchdog: if the child produces no output for 120 s, assume it is
    // wedged (post-probe sync check blocks exit) and unblock the wizard.
    // The timer resets on every data chunk so a slow-but-active health-check
    // is not killed prematurely.
    // 120 s because gatherProbes() is async and prints NO output while running
    // (only the intro line arrives before all probes complete). Observed
    // health-check durations are 28-60 s; the old 30 s threshold killed the
    // child before probe lines were printed, producing "No probes detected."
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { child.kill(); setDone(true); }, 120_000);
    };
    const makePush = (getBuf: () => string, setBuf: (s: string) => void) => (chunk: Buffer) => {
      resetWatchdog();
      const text = getBuf() + chunk.toString().replace(/\r/g, '');
      const parts = text.split('\n');
      setBuf(parts.pop() ?? '');
      const completeLines = parts.filter(Boolean);
      // #1675: count probes and failures via closure so close handler can emit events.
      for (const l of completeLines) {
        if (/\[\d+\/\d+\]/.test(l)) hcProbeCount++;
        if (/\bFAIL\b/.test(l)) hcFailCount++;
      }
      if (completeLines.length > 0) setLines(prev => [...prev, ...completeLines]);
    };
    child.stdout.on('data', makePush(() => stdoutBuf, s => { stdoutBuf = s; }));
    child.stderr.on('data', makePush(() => stderrBuf, s => { stderrBuf = s; }));
    resetWatchdog();
    child.on('close', () => {
      clearTimeout(watchdog);
      if (stdoutBuf.trim()) setLines(prev => [...prev, stdoutBuf]);
      if (stderrBuf.trim()) setLines(prev => [...prev, stderrBuf]);
      setDone(true);
      // #1675: emit setup.health-check.complete / .empty so the E2E monitor
      // can confirm the wizard health-check step ran and detect silent failures.
      try {
        if (hcProbeCount === 0) {
          logPortfolio('warn', 'setup.health-check.empty', 'Setup Wizard health-check: zero probes parsed -- output may be corrupt or binary mismatch');
        } else {
          logPortfolio('info', 'setup.health-check.complete', `Setup Wizard health-check finished: ${hcProbeCount} probes, ${hcFailCount} failure(s)`, { context: { probe_count: hcProbeCount, fail_count: hcFailCount } });
        }
      } catch { /* best-effort */ }
    });
    return () => {
      clearTimeout(watchdog);
      child.kill();
    };
  }, []);

  useInput((_input, key) => {
    if (done && key.return) onNext(); // #1412: one-press advance when guidance is open
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 4 -- Health Check</Text>
      {!done && <Text color="yellow">Running swao health-check...</Text>}
      <HealthCheckProbeList
        lines={lines}
        done={done}
        active
        onGuidanceOpenChange={setWizardGuidanceOpen}
      />
      {done && <Text dimColor>Press Enter to continue...</Text>}
    </Box>
  );
}

// -- Step 4: Ready --------------------------------------------------------

function ReadyStep({ state, onBack }: { state: SetupState; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.return) onBack(); // #1412: one-press advance when guidance is open
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });

  // #1400 polish: gateway connectors display as "Gateway: <id>" -- the
  // legacy fallthrough labelled every non-openai provider "Anthropic",
  // which mislabelled e.g. an OpenRouter+Gemini selection.
  const llmDisplay = state.llmProvider === 'skip'
    ? 'not configured (set manually in .swao.yml)'
    : state.llmProvider.startsWith('gw:')
      ? `Gateway: ${state.llmProvider.slice(3)}  (${state.llmModel})`
      : state.llmProvider === 'ollama'
        ? `Ollama  ${state.llmModel}  (${state.ollamaEndpoint})`
        : state.llmProvider === 'open-llm-provider'
          ? `Open LLM Provider  ${state.llmModel}  (${state.openLlmBaseUrl})`
          : `${state.llmProvider === 'openai' ? 'OpenAI' : 'Anthropic'}  ${state.llmModel}`;

  return (
    <Box flexDirection="column">
      <Text bold color="green">Workspace ready!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  Workspace:    <Text color="cyanBright">{state.workDir}</Text></Text>
        {state.engagementName && (
          <Text>  Engagement:   <Text color="cyanBright">{state.engagementName} ({state.clientCode})</Text></Text>
        )}
        <Text>  LLM:          <Text color="cyanBright">{llmDisplay}</Text></Text>
        <Text>  Credentials:  <Text color="cyanBright">{CRED_PATH}</Text></Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Next steps:</Text>
        <Text>  Choose "Run Assessment" from the main menu</Text>
        <Text>  Enter an app ID -- SWAO guides you through source and config setup</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Optional: drop documents into the app ingestion folder before running.</Text>
        <Text dimColor>SWAO will classify, extract, and index them during the assessment.</Text>
        <Text dimColor>Use Tools {'>'} Ingest Files to pre-process them manually.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to the main menu...</Text>
      </Box>
      <GuidanceBox
        title="Workspace ready"
        what="Go to Run Assessment from the main menu to begin your first analysis."
        affordances={['Enter -- return to main menu']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}

// -- Step 4: Claude Desktop MCP config ------------------------------------

function ClaudeDesktopStep({ workDir, onNext }: { workDir: string; onNext: () => void }) {
  const configPath = claudeDesktopConfigPath();
  const binaryPath = process.execPath;
  const installed = existsSync(configPath);

  // Check current state once at mount
  const [status, setStatus] = useState<'idle' | 'done' | 'skipped'>('idle');
  const [result, setResult] = useState('');

  const doSkip = () => { setStatus('skipped'); onNext(); };
  const doPatch = () => {
    const r = patchClaudeDesktopConfig(configPath, binaryPath);
    setResult(r);
    setStatus('done');
  };

  useInput((_input, key) => {
    if (status === 'skipped') return;
    if (status === 'done' && key.return) { onNext(); return; }
    if (status !== 'idle') return;
    if (key.return && !_wizardGuidanceOpen) doPatch();
    if (key.escape && !_wizardGuidanceOpen) doSkip();
  });

  void workDir;

  if (status === 'done') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 4 -- MCP Client Setup</Text>
        <Box marginTop={1}>
          {result === 'patched' && (
            <Box flexDirection="column">
              <Text color="green">MCP config updated.</Text>
              <Text color="yellow">Restart Claude Desktop to load the new tool registry.</Text>
            </Box>
          )}
          {result === 'already_present' && <Text color="green">SWAO already registered in Claude Desktop.</Text>}
          {result === 'error' && <Text color="red">Failed to write config -- add the SWAO entry manually.</Text>}
        </Box>
        <Box marginTop={1}><Text dimColor>Press Enter to continue...</Text></Box>
      </Box>
    );
  }

  if (!installed) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 4 -- MCP Client Setup</Text>
        <Text color="yellow">No MCP-aware AI client detected at {configPath}</Text>
        <Text dimColor>Install Claude Desktop (claude.ai/download) or another MCP host,</Text>
        <Text dimColor>or add the SWAO entry manually as described in the client runbook.</Text>
        <Box marginTop={1}><Text dimColor>Press Enter to continue...</Text></Box>
        <ConfirmContinue onConfirm={onNext} onBack={onNext} />
        <GuidanceBox
          title="MCP Client Setup (skipped)"
          what="No supported MCP client detected. Install Claude Desktop to enable AI-assisted analysis of findings."
          affordances={['Enter -- continue  |  Esc -- back']}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 4 -- MCP Client Setup</Text>
      <Text>Detected Claude Desktop config at: <Text bold color="whiteBright">{configPath}</Text></Text>
      <Text dimColor>(SWAO probes only Claude Desktop today -- it is the only MCP host currently shipped. Path is Claude\ because that is the host detected.)</Text>
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

function PlaywrightStep({ onNext }: { onNext: () => void }) {
  const [playwrightOk, setPlaywrightOk] = useState<boolean | null>(null);

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

  useInput((_input, key) => {
    if ((key.return || key.escape) && !playwrightGuidanceOpenRef.current) onNext();
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

  if (playwrightOk === null) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 5 -- Dynamic UI Crawler (optional)</Text>
        <Text dimColor>Checking Chromium...</Text>
        {crawlerGuidance}
      </Box>
    );
  }

  if (playwrightOk) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step 5 -- Dynamic UI Crawler (optional)</Text>
        <Text color="green">Chromium is installed -- the dynamic UI crawler pass is available.</Text>
        <Text dimColor>SWAO will capture screenshots and analyse web app UI flows during assessments.</Text>
        <Box marginTop={1}><Text dimColor>Press Enter to continue...</Text></Box>
        <ConfirmContinue onConfirm={onNext} onBack={onNext} />
        {crawlerGuidance}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step 5 -- Dynamic UI Crawler (optional)</Text>
      <Text color="yellow">Chromium not detected. Press Ctrl+G to see install instructions.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>  <Text color="cyanBright">S</Text>      -- Open shell here (to run: swao install-playwright)</Text>
        <Text dimColor>  <Text color="cyanBright">Enter</Text>  -- Continue without Playwright (install later)</Text>
      </Box>
      {crawlerGuidance}
    </Box>
  );
}

// -- Wizard root ----------------------------------------------------------

export function SetupWizard({ onBack }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('init');
  const [state, setState] = useState<SetupState>({
    workDir: '.',
    engagementName: '',
    clientCode: '',
    partnershipLead: '',
    llmProvider: 'anthropic',
    llmModel: '',
    ollamaEndpoint: '',
    openLlmBaseUrl: '',
  });
  // Guard: prevent double-logging when Ink re-renders cause onNext to fire twice (#1067).
  const loggedSteps = useRef(new Set<string>());

  // Top-level Escape handler so every step / sub-phase reliably returns
  // to the main menu (the footer promises "Escape at any time" but the
  // text-input phases didn't honour it before). Ink delivers input to all
  // active useInput hooks; the inner TextInput etc. don't consume Escape,
  // so this fires from any phase. (#0223 follow-up)
  // #0760: guard -- do NOT navigate when any GuidanceBox is open (the panel's
  // own useInput closes it first; this handler would wrongly navigate away).
  useInput((_input, key) => {
    if (key.escape && !_wizardGuidanceOpen) onBack();
  });

  // #0804: reset guidance open flag on every step change.
  // GuidanceBox.tsx now has an unmount cleanup, but this is a belt-and-braces
  // guard: if a step transitions while a panel is expanded, any residual
  // _wizardGuidanceOpen=true is cleared before the new step's useInput handlers fire.
  useEffect(() => { _wizardGuidanceOpen = false; }, [step]);

  // #0397 / #0400 / #0406 / #0407 REVERTED AGAIN -- see AssessScreen for
  // the same Ink-diff-renderer collision. Bleed-tolerance is the lesser
  // evil until sprint-041 picks a proper Ink-aware solution.

  const stepIdx = STEP_LABELS.indexOf((step === 'llm-secondary' ? 'llm' : step) as Exclude<Step, 'llm-secondary'>);

  const writeLlmToYaml = (
    workDir: string,
    provider: LlmProvider,
    model: string,
    endpoint: string,
    openLlmBase: string,
  ) => {
    const yamlPath = join(workDir, '.swao.yml');
    if (!existsSync(yamlPath)) return;
    try {
      let yaml = readFileSync(yamlPath, 'utf-8');
      let llmBlock = '';
      if (provider.startsWith('gw:')) {
        // #1400: SWAO LLM-Gateway connector selection (Design 090). Endpoint,
        // auth, protocol, and cost all come from the connector file.
        llmBlock = `      connector: ${provider.slice(3)}\n      model: ${model}\n      temperature: 0`;
      } else if (provider === 'anthropic') {
        llmBlock = `      type: anthropic\n      model: ${model}\n      temperature: 0\n      max_tokens: 32768`;
      } else if (provider === 'openai') {
        llmBlock = `      type: openai\n      model: ${model}\n      temperature: 0`;
      } else if (provider === 'ollama') {
        llmBlock = `      type: ollama\n      endpoint: "${endpoint}"\n      model: ${model}`;
      } else if (provider === 'open-llm-provider') {
        // Bearer token stored in credential store -- never written to .swao.yml (Design 082 D-04).
        llmBlock = `      type: open-llm-provider\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
      } else {
        return; // skip -- leave as ~
      }
      // #0405 (sprint-040 round-5): the previous regex `      type: ~\n      model: ~`
      // only matched the virgin template. Re-running Setup on an already-
      // configured workspace silently dropped the new LLM choice because
      // the regex no longer matched (the yaml now had `type: openai` etc.).
      // Match the WHOLE primary: block instead (every line indented with
      // 6+ spaces, until the next outdented sibling under providers:).
      // Idempotent: virgin yaml has just `type: ~\n      model: ~` which
      // is still 6-space-indented and will be replaced cleanly.
      const primaryBlock = /( {4}primary:\n)(?: {6}[^\n]*\n?)+/;
      if (primaryBlock.test(yaml)) {
        yaml = yaml.replace(primaryBlock, `$1${llmBlock}\n`);
      } else {
        // Defensive: if the providers.llm.primary: block is missing, fall
        // back to the legacy virgin-template replace. This was the only
        // path that previously existed.
        yaml = yaml.replace(/ {6}type: ~\n {6}model: ~/, llmBlock);
      }
      writeFileSync(yamlPath, yaml, 'utf-8');
    } catch { /* non-fatal */ }
  };

  // #1768: write providers.llm.secondary block to .swao.yml.
  // Inserts a `secondary:` sibling of `primary:` under `providers.llm:`.
  // If a secondary block already exists it is replaced. Mirrors writeLlmToYaml.
  const writeSecondaryLlmToYaml = (
    workDir: string,
    provider: LlmProvider,
    model: string,
    endpoint: string,
    openLlmBase: string,
  ) => {
    const yamlPath = join(workDir, '.swao.yml');
    if (!existsSync(yamlPath)) return;
    try {
      let yaml = readFileSync(yamlPath, 'utf-8');
      let llmBlock = '';
      if (provider.startsWith('gw:')) {
        llmBlock = `      connector: ${provider.slice(3)}\n      model: ${model}\n      temperature: 0`;
      } else if (provider === 'anthropic') {
        llmBlock = `      type: anthropic\n      model: ${model}\n      temperature: 0\n      max_tokens: 32768`;
      } else if (provider === 'openai') {
        llmBlock = `      type: openai\n      model: ${model}\n      temperature: 0`;
      } else if (provider === 'ollama') {
        llmBlock = `      type: ollama\n      endpoint: "${endpoint}"\n      model: ${model}`;
      } else if (provider === 'open-llm-provider') {
        llmBlock = `      type: open-llm-provider\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
      } else {
        return;
      }
      // Replace existing secondary: block if present, otherwise append after primary: block.
      const secondaryBlock = /( {4}secondary:\n)(?: {6}[^\n]*\n?)+/;
      if (secondaryBlock.test(yaml)) {
        yaml = yaml.replace(secondaryBlock, `$1${llmBlock}\n`);
      } else {
        // Append secondary: after the primary: block closes (first line after the block
        // that is indented less than 6 spaces, i.e. back to 4-space or root level).
        const primaryClose = /( {4}primary:\n(?:(?: {6}[^\n]*\n?))+)/;
        if (primaryClose.test(yaml)) {
          yaml = yaml.replace(primaryClose, `$1    secondary:\n${llmBlock}\n`);
        }
      }
      writeFileSync(yamlPath, yaml, 'utf-8');
    } catch { /* non-fatal */ }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Workspace Setup" stepInfo={`Step ${stepIdx + 1} of ${STEP_LABELS.length}`} />
      <StepBar steps={STEP_NAMES} currentIndex={stepIdx} />

      {step === 'init' && (
        <InitStep
          onNext={({ workDir, engagementName, clientCode, partnershipLead }) => {
            setState(s => ({ ...s, workDir, engagementName, clientCode, partnershipLead }));
            saveDefaultWorkspace(workDir);
            setWorkspaceRoot(workDir);
            if (!loggedSteps.current.has('init')) { loggedSteps.current.add('init'); try { logPortfolio('info', 'wsp.init.complete', 'Workspace initialised', { context: { wsp_version: '0.9', engagement_name: engagementName } }); } catch { /* best-effort */ } }
            setStep('llm');
          }}
        />
      )}

      {step === 'llm' && (
        <LlmStep
          workspaceRoot={state.workDir}
          onNext={(provider, model, endpoint, openLlmBase) => {
            setState(s => ({
              ...s,
              llmProvider: provider,
              llmModel: model,
              ollamaEndpoint: endpoint,
              openLlmBaseUrl: openLlmBase,
            }));
            writeLlmToYaml(state.workDir, provider, model, endpoint, openLlmBase);
            // #1400 operator decision 2026-08-06: materialise the selected
            // bundled connector into wsp/inputs/llm-gateway/ (raw copy,
            // comments preserved, never overwrites) so the operator can see
            // and edit the connectivity file that will serve the runs.
            if (provider.startsWith('gw:')) {
              try {
                const loaded = getConnector(provider.slice(3), { workspaceRoot: state.workDir });
                if (loaded && loaded.origin === 'bundled') {
                  copyConnectorToWorkspace(state.workDir, loaded.path, loaded.file.connector.id);
                }
              } catch { /* best-effort */ }
            }
            if (!loggedSteps.current.has('llm')) {
              loggedSteps.current.add('llm');
              try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
              try { logPortfolio('info', 'wizard.step.complete', 'LLM provider configured', { context: { step: 'llm', provider, model: model || null } }); } catch { /* best-effort */ }
            }
            setStep('llm-secondary');
          }}
        />
      )}

      {step === 'llm-secondary' && (
        <LlmSecondaryStep
          workspaceRoot={state.workDir}
          primaryProvider={state.llmProvider}
          onSkip={() => setStep('credentials')}
          onNext={(provider, model, endpoint, openLlmBase) => {
            writeSecondaryLlmToYaml(state.workDir, provider, model, endpoint, openLlmBase);
            if (provider.startsWith('gw:')) {
              try {
                const loaded = getConnector(provider.slice(3), { workspaceRoot: state.workDir });
                if (loaded && loaded.origin === 'bundled') {
                  copyConnectorToWorkspace(state.workDir, loaded.path, loaded.file.connector.id);
                }
              } catch { /* best-effort */ }
            }
            try { logPortfolio('info', 'wizard.step.complete', 'Secondary LLM provider configured', { context: { step: 'llm-secondary', provider, model: model || null } }); } catch { /* best-effort */ }
            setStep('credentials');
          }}
        />
      )}

      {step === 'credentials' && (
        <CredentialsStep
          provider={state.llmProvider}
          workspaceRoot={state.workDir}
          onNext={() => {
            if (!loggedSteps.current.has('credentials')) {
              loggedSteps.current.add('credentials');
              try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
              try { logPortfolio('info', 'wizard.step.complete', 'Credentials step completed', { context: { step: 'credentials', provider: state.llmProvider } }); } catch { /* best-effort */ }
            }
            setStep('health-check');
          }}
        />
      )}

      {step === 'health-check' && (
        <HealthCheckStep onNext={() => setStep('claude-desktop')} />
      )}

      {step === 'claude-desktop' && (
        <ClaudeDesktopStep workDir={state.workDir} onNext={() => {
          if (!loggedSteps.current.has('mcp')) {
            loggedSteps.current.add('mcp');
            try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
            try { logPortfolio('info', 'wizard.step.complete', 'MCP client step completed', { context: { step: 'claude-desktop' } }); } catch { /* best-effort */ }
          }
          setStep('playwright');
        }} />
      )}

      {step === 'playwright' && (
        <PlaywrightStep onNext={() => {
          const chromiumPath = findInstalledChromium();
          if (!loggedSteps.current.has('playwright')) { loggedSteps.current.add('playwright'); try { logPortfolio('info', 'playwright.check.complete', 'Playwright step completed', { context: { chromium_found: chromiumPath !== null, path: chromiumPath ?? undefined } }); } catch { /* best-effort */ } }
          if (!loggedSteps.current.has('ready')) {
            loggedSteps.current.add('ready');
            // #1766: ensure workspace root is set before the summary event, then emit.
            try { setWorkspaceRoot(state.workDir); } catch { /* best-effort */ }
            try {
              logPortfolio('info', 'wsp.setup.complete', 'Workspace setup completed', {
                context: {
                  steps_completed: STEP_LABELS.length,
                  workspace: state.workDir,
                  provider: state.llmProvider,
                  model: state.llmModel || null,
                },
              });
            } catch { /* best-effort */ }
          }
          setStep('ready');
        }} />
      )}

      {step === 'ready' && (
        <ReadyStep state={state} onBack={onBack} />
      )}

      <Box marginTop={1}>
        <Text dimColor>Escape at any time to return to the main menu</Text>
      </Box>
    </Box>
  );
}
