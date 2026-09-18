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
import { Box, Text } from 'ink';
import { SelectInput, PICKER_VISIBLE_COUNT, TextInput, GuidanceBox } from '@swao/tui-kit';
import {
  listConnectors,
  discoverModels,
  mergeDiscoveredModels,
  writeWorkspaceConnector,
  type LoadedConnector,
  type ConnectorModelEntry,
} from '@swao/module-llm-providers';
import { type LlmProvider, setWizardGuidanceOpen } from '../shared.js';

// #1400 sprint-113: `gw:<connector-id>` selects a SWAO LLM-Gateway connector
// (Design 090); the literal values remain for the legacy fallback path.
const LLM_OPTIONS = [
  { label: 'Anthropic Claude   (recommended -- requires Anthropic API key)', value: 'anthropic'         },
  { label: 'OpenAI ChatGPT     (requires OpenAI API key)',                   value: 'openai'            },
  { label: 'Ollama             (local model -- no API key needed)',           value: 'ollama'            },
  { label: 'Open LLM Provider  (custom OpenAI-compatible endpoint)',         value: 'open-llm-provider' },
  { label: 'Skip               -- configure manually in .swao.yml later',    value: 'skip'              },
];

const ANTHROPIC_MODELS = [
  { label: 'claude-opus-4-8         (most capable, recommended)', value: 'claude-opus-4-8'          },
  { label: 'claude-sonnet-5         (balanced)',                   value: 'claude-sonnet-5'           },
  { label: 'claude-haiku-4-5-20251001  (fast, economical)',        value: 'claude-haiku-4-5-20251001' },
];

const OPENAI_MODELS = [
  { label: 'gpt-4o             (recommended)', value: 'gpt-4o'       },
  { label: 'gpt-4o-mini        (economical)',  value: 'gpt-4o-mini'  },
  { label: 'gpt-4-turbo',                      value: 'gpt-4-turbo'  },
];

type LlmPhase =
  | 'pick-provider'
  | 'pick-model'
  | 'gw-model'
  | 'gw-model-custom'
  | 'ollama-endpoint'
  | 'ollama-model'
  | 'open-llm-url'
  | 'open-llm-model';

export function LlmStep({
  onNext,
  workspaceRoot,
  isSecondary,
}: {
  onNext: (provider: LlmProvider, model: string, endpoint: string, openLlmBaseUrl: string) => void;
  workspaceRoot?: string;
  isSecondary?: boolean;
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
      ? [
          ...gwOptions,
          { label: 'Open LLM Provider  (custom OpenAI-compatible endpoint)', value: 'open-llm-provider' },
          { label: 'Skip  -- configure manually in .swao.yml later',         value: 'skip' },
        ]
      : LLM_OPTIONS;
    return (
      <Box flexDirection="column">
        {!isSecondary && <Text bold color="cyanBright">Step 1b -- LLM Provider (LLM-Gateway)</Text>}
        {!isSecondary && <Text dimColor>SWAO uses an LLM for code analysis and synthesis passes.</Text>}
        {!isSecondary && <Text dimColor>Connectors are files -- copy wsp/inputs/llm-gateway/_template.yaml to add your own platform.</Text>}
        <Box marginTop={1}>
          <SelectInput
            label={isSecondary ? 'Select secondary LLM connector' : 'Select LLM connector'}
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
        {isSecondary ? (
          <GuidanceBox
            title="Secondary LLM connector"
            what="Choose the connector that will run in parallel with the primary during LLM Assessment. Results appear side-by-side in the HTML and PDF reports (Design 092)."
            details={[
              { label: 'Tip',        value: 'Pick a different provider family from the primary to get meaningful comparison data.' },
              { label: 'Custom',     value: 'Copy wsp/inputs/llm-gateway/_template.yaml to add any OpenAI-compatible endpoint.' },
              { label: 'Skip',       value: 'You can add providers.llm.secondary manually in .swao.yml at any time.' },
            ]}
            affordances={['Arrows -- navigate', 'Enter -- select', 'Esc -- skip secondary']}
            onOpenChange={setWizardGuidanceOpen}
          />
        ) : (
          <GuidanceBox
            title="What does the LLM do?"
            what="SWAO uses an LLM connector for classification, compliance verdicts, and 7R synthesis passes. Select a built-in connector or add your own via wsp/inputs/llm-gateway/."
            details={[
              { label: 'Built-in',  value: 'Anthropic, OpenAI, Ollama, and OpenRouter connectors are included.' },
              { label: 'Custom',    value: 'Copy wsp/inputs/llm-gateway/_template.yaml to add any OpenAI-compatible endpoint.' },
              { label: 'Skip',      value: 'LLM passes fall back to UNKNOWN verdicts; configure later in .swao.yml.' },
            ]}
            affordances={['Arrows -- navigate', 'Enter -- select', 'Esc -- return to main menu']}
            onOpenChange={setWizardGuidanceOpen}
          />
        )}
      </Box>
    );
  }

  // #1400: model picker for a gateway connector with a catalogue.
  if (phase === 'gw-model' && selectedConnector) {
    const conn = selectedConnector.file.connector;
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
        label: `${m.id}${m.cost ? `   [$${fmtCost(m.cost.input_per_million)}/M in, $${fmtCost(m.cost.output_per_million)}/M out]` : ''}`,
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
