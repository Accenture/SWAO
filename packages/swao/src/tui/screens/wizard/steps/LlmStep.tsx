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

// #4254 TUI-10 (Design 126 sections 4.5, 7.2, 7.7 and 9): every phase renders
// through SetupStepFrame (step title without a number, the hint line of its
// input kind, one guidance box that follows the highlighted option). The
// sub-phases go back with Shift+Tab (and Left arrow on a picker) through the
// frame's `back`; Esc belongs to the wizard (AbortDialog). Every picker option
// carries its own guidance entry (#4230); pickers are bounded (G-06).

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { logPortfolio } from '@swao/core';
import { SelectInput, StatusRow, PICKER_VISIBLE_COUNT, TextInput, fitToWidth, tone, useHeaderWidth, useOptionGuidance, type FlowStepKind, type GuidanceEntry, type GuidanceSection, type SelectOption, MODEL_FILTER_GUIDANCE } from '@swao/tui-kit';
import {
  listConnectors,
  discoveryEnabled,
  discoveryFallbackText,
  checkConnectorModel,
  connectorSeedStatus,
  seedStatusText,
  updateBundledConnectors,
  type ConnectorModelCheck,
  type ConnectorSeedStatus,
  type LoadedConnector,
} from '@swao/module-llm-providers';
import { type LlmProvider } from '../shared.js';
import { OTHER_MODEL_OPTION } from '../../../model-label.js';
import { notServedLine, pickerModelList, pickerModelOption, pickerSourceLine } from '../../../model-picker-list.js';
import { readLlmSlotFromYaml } from '../yaml-helpers.js';
import { useModelRefresh } from '../../../use-model-refresh.js';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

const CONNECTOR_FILE_SECTION: GuidanceSection = { label: 'Own platform', text: 'Copy wsp/inputs/llm-gateway/_template.yaml in the workspace to add any OpenAI-compatible endpoint.' };
const SKIP_GUIDANCE: GuidanceEntry = {
  title: 'Skip',
  what: 'No LLM is configured now. The LLM passes fall back to UNKNOWN verdicts until an LLM is set; add it later in .swao.yml or run this step again from Setup.',
};
const OPEN_LLM_GUIDANCE: GuidanceEntry = {
  title: 'Open LLM Provider',
  what: 'Any OpenAI-compatible endpoint of your own: SWAO asks for its base URL and the model name; the bearer token goes into the credential vault in the next step.',
  sections: [CONNECTOR_FILE_SECTION],
};

// #1400 sprint-113: `gw:<connector-id>` selects a SWAO LLM-Gateway connector
// (Design 090); the literal values remain for the legacy fallback path (no
// connector found, which the health check flags).
const LLM_OPTIONS: SelectOption[] = [
  { label: 'Anthropic Claude', detail: 'recommended, needs an Anthropic API key', value: 'anthropic', guidance: { title: 'Anthropic Claude', what: 'The Anthropic Messages API with an Anthropic API key, asked for in the Credentials step.' } },
  { label: 'OpenAI ChatGPT', detail: 'needs an OpenAI API key', value: 'openai', guidance: { title: 'OpenAI ChatGPT', what: 'The OpenAI chat API with an OpenAI API key, asked for in the Credentials step.' } },
  { label: 'Ollama', detail: 'local model, no API key', value: 'ollama', guidance: { title: 'Ollama', what: 'A model served by a local Ollama server; no data leaves the machine and no API key is needed.' } },
  { label: 'Open LLM Provider', detail: 'custom OpenAI-compatible endpoint', value: 'open-llm-provider', guidance: OPEN_LLM_GUIDANCE },
  { label: 'Skip', detail: 'configure later in .swao.yml', value: 'skip', guidance: SKIP_GUIDANCE },
];

const ANTHROPIC_MODELS: SelectOption[] = [
  { label: 'claude-opus-4-8', detail: 'most capable, recommended', value: 'claude-opus-4-8', guidance: { title: 'claude-opus-4-8', what: 'Most capable. Use for client engagements and audit-grade output; the highest cost per assessment.' } },
  { label: 'claude-sonnet-5', detail: 'balanced', value: 'claude-sonnet-5', guidance: { title: 'claude-sonnet-5', what: 'Balanced reasoning and cost. Standard assessments and iteration cycles.' } },
  { label: 'claude-haiku-4-5-20251001', detail: 'fast, economical', value: 'claude-haiku-4-5-20251001', guidance: { title: 'claude-haiku-4-5-20251001', what: 'Cheapest and fastest. Dry runs, first iterations and cost-sensitive work.' } },
];

const OPENAI_MODELS: SelectOption[] = [
  { label: 'gpt-4o', detail: 'recommended', value: 'gpt-4o', guidance: { title: 'gpt-4o', what: 'Recommended: the best OpenAI reasoning for compliance verdicts.' } },
  { label: 'gpt-4o-mini', detail: 'economical', value: 'gpt-4o-mini', guidance: { title: 'gpt-4o-mini', what: 'Economical: cheaper and faster, slightly weaker reasoning.' } },
  { label: 'gpt-4-turbo', value: 'gpt-4-turbo', guidance: { title: 'gpt-4-turbo', what: 'Older generation: choose it only if your organisation pins it for compatibility.' } },
];

type LlmPhase =
  | 'pick-provider'
  | 'pick-model'
  | 'gw-model'
  | 'gw-model-custom'
  | 'gw-model-check'
  | 'gw-update'
  | 'ollama-endpoint'
  | 'ollama-model'
  | 'open-llm-url'
  | 'open-llm-model';

/** #4220: the connector protocol in plain words (the dim second column of the connector picker). */
export const CONNECTOR_PROTOCOL_TEXT: Readonly<Record<string, string>> = {
  'openai-chat': 'OpenAI-compatible API',
  'anthropic-messages': 'Anthropic Messages API',
  ollama: 'local Ollama server',
  bedrock: 'Amazon Bedrock API',
};

/** #4220: one connector row: the name as label, origin and protocol as detail, a guidance entry. */
export function connectorOption(c: LoadedConnector): SelectOption {
  const { id, name, protocol } = c.file.connector;
  const words = CONNECTOR_PROTOCOL_TEXT[protocol] ?? protocol;
  const origin = c.origin === 'workspace' ? 'workspace connector' : 'bundled connector';
  return {
    label: name,
    value: `gw:${id}`,
    detail: c.origin === 'workspace' ? `workspace, ${words}` : words,
    guidance: {
      title: name,
      what: `${name} through the SWAO LLM gateway (${origin} ${id}, ${words}). The next questions pick the model and, when the connector needs one, the credential.`,
      sections: [{ label: 'Connector file', text: `wsp/inputs/llm-gateway/${id}.yaml in the workspace; copy _template.yaml in that folder to add your own platform.` }],
    },
  };
}

/**
 * #4230: the options of the connector picker: one per connector, then Open
 * LLM Provider and Skip, each with a guidance entry. Without any connector
 * (a broken build) the legacy provider list.
 */
export function providerOptions(connectors: readonly LoadedConnector[]): SelectOption[] {
  if (connectors.length === 0) return LLM_OPTIONS;
  return [
    ...connectors.map(connectorOption),
    { label: 'Open LLM Provider', detail: 'custom OpenAI-compatible endpoint', value: 'open-llm-provider', guidance: OPEN_LLM_GUIDANCE },
    { label: 'Skip', detail: 'configure later in .swao.yml', value: 'skip', guidance: SKIP_GUIDANCE },
  ];
}

/** #4230: the model options of the legacy Anthropic and OpenAI path, each with its guidance. */
export function legacyModelOptions(provider: 'anthropic' | 'openai'): SelectOption[] {
  return provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;
}

/** #4500: the entries after a failed test call of the chosen model, each with its guidance entry. */
export function modelCheckFailOptions(model: string, message: string): SelectOption[] {
  return [
    { label: 'Choose another model', value: 'again', guidance: { title: 'Choose another model', what: 'Back to the model list; the new choice is tested again before it is written to .swao.yml.', sections: [{ label: 'Reason', text: message }] } },
    { label: 'Use this model anyway', value: 'keep', guidance: { title: 'Use this model anyway', what: `${model} is written to .swao.yml as it is; the Health Check and the assessment report the connection again.`, sections: [{ label: 'Reason', text: message }] } },
  ];
}

/** #4491: the entries of the connector file update offer, each with its guidance entry. */
export function connectorUpdateOptions(s: Pick<ConnectorSeedStatus, 'file' | 'bundledReviewed' | 'workspaceReviewed'>): SelectOption[] {
  return [
    { label: 'Update the connector file', detail: 'newer prices and models', value: 'update', guidance: { title: 'Update the connector file', what: `wsp/inputs/llm-gateway/${s.file} is replaced by the packaged version (reviewed ${s.bundledReviewed ?? 'unknown'}); the next live model list adds the served models again.`, cli: `swao llm-gateway update` } },
    { label: 'Keep the workspace file', detail: 'older prices', value: 'keep', guidance: { title: 'Keep the workspace file', what: `The workspace copy (reviewed ${s.workspaceReviewed ?? 'unknown'}) stays; estimates use its older prices; the Setup LLM step offers the update again.`, cli: `swao llm-gateway update` } },
  ];
}

/** #4500: the model test of the LLM step (injectable for tests). */
export type ModelChecker = (loaded: LoadedConnector, model: string) => Promise<ConnectorModelCheck>;

export function LlmStep({
  onNext,
  workspaceRoot,
  isSecondary,
  onBack,
  checkModel = checkConnectorModel,
}: {
  onNext: (provider: LlmProvider, model: string, endpoint: string, openLlmBaseUrl: string) => void;
  workspaceRoot?: string;
  isSecondary?: boolean;
  /** Back from the connector picker (the secondary LLM returns to its yes/no question). */
  onBack?: () => void;
  /** #4500: the test call of the chosen gateway model before it is written. */
  checkModel?: ModelChecker;
}) {
  const [phase, setPhase]       = useState<LlmPhase>('pick-provider');
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [, setModel]            = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [openLlmBaseUrl, setOpenLlmBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const width = useHeaderWidth();

  // #1400: discover SWAO LLM-Gateway connectors once per step mount:
  // bundled seeds plus any file the user dropped into wsp/inputs/llm-gateway/.
  // #3372: keep the loader warnings so a connector that fails to parse is shown
  // with its reason instead of silently missing from the list.
  const loadConnectors = (): { connectors: LoadedConnector[]; skipped: string[] } => {
    try {
      const r = listConnectors({ workspaceRoot });
      return { connectors: r.connectors ?? [], skipped: r.warnings ?? [] };
    } catch { return { connectors: [], skipped: [] }; }
  };
  // #4491: reloaded after the connector file update.
  const [{ connectors, skipped }, setLoaded] = useState<{ connectors: LoadedConnector[]; skipped: string[] }>(loadConnectors);
  const [seed, setSeed] = useState<ConnectorSeedStatus | undefined>(undefined);
  const [seedMessage, setSeedMessage] = useState('');
  const { entry: seedGuidance, onCursorChange: onSeedCursor } = useOptionGuidance({
    title: 'Connector file update',
    what: 'A newer packaged version of this connector file exists (newer prices and models). Your workspace copy is unedited, so the update is safe.',
  });
  const selectedConnector = provider.startsWith('gw:')
    ? connectors.find(c => c.file.connector.id === provider.slice(3))
    : undefined;

  // #1405 / #4475 (Design 090 section 7.4): the served models are read live
  // when the model picker opens (5 s), merged into wsp/inputs/llm-gateway/<id>.yaml
  // (curated entries win, prices where the platform publishes them) and listed
  // with the shared picker rule (model-picker-list.ts). Offline or air-gapped:
  // the catalogue, said so.
  const [refreshedConnector, setRefreshedConnector] = useState<LoadedConnector | undefined>(undefined);
  const gwDiscovery = useModelRefresh(selectedConnector, workspaceRoot, phase === 'gw-model', setRefreshedConnector);

  // #4500 (Design 090 section 7.4): the chosen gateway model gets one test call
  // (the alias resolution and provider of the Health Check) before the step
  // writes it; a rejection offers to choose again. Without a stored key (first
  // Setup) the Credentials step makes the test after the key is entered.
  const [check, setCheck] = useState<{ model: string; from: 'gw-model' | 'gw-model-custom'; result?: ConnectorModelCheck } | undefined>(undefined);
  const { entry: checkGuidance, onCursorChange: onCheckCursor } = useOptionGuidance({
    title: 'Model test failed',
    what: 'The test call of the chosen model did not succeed. Choose another model, or use this one anyway.',
  });
  const startCheck = (model: string, from: 'gw-model' | 'gw-model-custom'): void => {
    setModel(model);
    setCheck({ model, from });
    setPhase('gw-model-check');
  };
  useEffect(() => {
    if (phase !== 'gw-model-check' || !check || check.result || !selectedConnector) return;
    let cancelled = false;
    const loaded = refreshedConnector?.file.connector.id === selectedConnector.file.connector.id ? refreshedConnector : selectedConnector;
    const connectorId = selectedConnector.file.connector.id;
    void checkModel(loaded, check.model)
      .catch((err: unknown): ConnectorModelCheck => ({ status: 'fail', model: check.model, message: err instanceof Error ? err.message : String(err), rejected: false }))
      .then((result) => {
        try {
          const context = result.status === 'ok' ? { resolved: result.model, duration_ms: result.ms }
            : result.status === 'skipped' ? { reason: result.reason } : { resolved: result.model, rejected: result.rejected };
          logPortfolio(result.status === 'fail' ? 'warn' : 'info', `wizard.llm.model-check.${result.status}`, `Setup LLM step model test: ${result.status}`, {
            context: { connector_id: connectorId, model: check.model, ...context },
          });
        } catch { /* best-effort */ }
        if (cancelled) return;
        if (result.status === 'fail') setCheck({ ...check, result });
        else onNext(provider, check.model, '', '');
      });
    return () => { cancelled = true; };
  }, [phase, check?.model, check?.result]);


  // #4220 / #4230: the guidance follows the highlighted connector.
  const { entry: connectorGuidance, onCursorChange: onConnectorCursor } = useOptionGuidance(isSecondary
    ? { title: 'Secondary LLM connector', what: 'The connector that runs in parallel with the primary during the LLM Assessment; the results appear side by side in the HTML and PDF reports (Design 092).', sections: [{ label: 'Tip', text: 'Pick a different provider family from the primary for a meaningful comparison.' }] }
    : { title: 'LLM connector', what: 'SWAO uses an LLM connector for classification, compliance verdicts and the 7R synthesis passes. Choose a bundled connector or add your own in wsp/inputs/llm-gateway/.', sections: [{ label: 'Skip', text: 'LLM passes fall back to UNKNOWN verdicts; configure the LLM later in .swao.yml.' }] });

  // #4220 / #4230: the model picker's box follows the highlighted model.
  const modelStepGuidance: GuidanceEntry = {
    title: 'Select model',
    what: `${selectedConnector && discoveryEnabled(selectedConnector.file.connector) ? 'SWAO reads the models the platform serves when this list opens; a model it no longer serves is marked not served. Without an answer the list is the catalogue of the connector file, not checked live' : 'The list is the catalogue of the connector file; live discovery is turned off for this connector'}. Other model lets you use any model the platform serves.`,
    sections: selectedConnector?.file.connector.sovereignty?.data_residency
      ? [{ label: 'Residency', text: String(selectedConnector.file.connector.sovereignty.data_residency) }]
      : [],
  };
  const { entry: modelGuidance, onCursorChange: onModelCursor } = useOptionGuidance(modelStepGuidance);
  const legacyModelStep: GuidanceEntry = { title: 'Select model', what: 'Better models improve verdict quality but cost more. Choose by audience: client report, the top model; dry run, an economical one.' };
  const { entry: legacyModelGuidance, onCursorChange: onLegacyModelCursor } = useOptionGuidance(legacyModelStep);

  const title = isSecondary ? 'Secondary LLM' : 'LLM';
  const toProvider = (): void => setPhase('pick-provider');
  /** The frame of one phase: the input kind gives the hint line, `back` the step-internal Shift+Tab. */
  const frame = (kind: FlowStepKind, guidance: GuidanceEntry, back: (() => void) | undefined, subtitle: string, body: JSX.Element): JSX.Element => (
    <SetupStepFrame title={title} subtitle={subtitle} kind={kind} guidance={guidance} back={back}>
      <Box flexDirection="column">{body}</Box>
    </SetupStepFrame>
  );
  const fact = (label: string, value: string): JSX.Element => (
    <Text wrap="truncate-end">{`${label}: `}<Text {...tone('accent')}>{value}</Text></Text>
  );

  if (phase === 'pick-provider') {
    // Gateway path: one option per discovered connector. Legacy hardcoded
    // list only as a fallback when discovery finds nothing (broken build;
    // the health check flags that state).
    // #4220: a short label (the connector name); origin and protocol in plain
    // words in the dim second column; what the connector is in its guidance.
    const options = providerOptions(connectors);
    return frame('picker', connectorGuidance, onBack, isSecondary
      ? 'The connector that runs in parallel with the primary in the LLM Assessment.'
      : 'SWAO uses an LLM for code analysis and synthesis passes; connectors are files in the workspace.', (
      <>
        {skipped.length > 0 && (
          <Box flexDirection="column">
            <Text {...tone('warning')}>{fitToWidth(`${skipped.length} connector file(s) were skipped (not shown in the list):`, width)}</Text>
            {skipped.slice(0, 5).map((w, i) => <Text key={i} {...tone('muted')}>{fitToWidth(`  ${w}`, width)}</Text>)}
          </Box>
        )}
        <Box marginTop={skipped.length > 0 ? 1 : 0}>
          <SelectInput
            label={isSecondary ? 'Secondary LLM connector' : 'LLM connector'}
            options={options}
            onCursorChange={onConnectorCursor}
            showKeyHints={false}
            visibleCount={PICKER_VISIBLE_COUNT}
            onSelect={(v) => {
              const p = v as LlmProvider;
              setProvider(p);
              if (p.startsWith('gw:')) {
                const conn = connectors.find(c => c.file.connector.id === p.slice(3));
                // #4475: a connector with live discovery opens the picker even without a catalogue.
                const hasCatalogue = (conn?.file.connector.models.catalogue?.length ?? 0) > 0
                  || (!!conn && discoveryEnabled(conn.file.connector));
                setCustomModel(conn?.file.connector.models.default ?? '');
                setRefreshedConnector(undefined);
                setSeedMessage('');
                // #4491: an unedited workspace seed older than the packaged file: offer the update first.
                const st = workspaceRoot && conn ? connectorSeedStatus(workspaceRoot, conn.file.connector.id) : undefined;
                setSeed(st);
                setPhase(st?.status === 'outdated' ? 'gw-update' : hasCatalogue ? 'gw-model' : 'gw-model-custom');
              }
              else if (p === 'anthropic' || p === 'openai') setPhase('pick-model');
              else if (p === 'ollama') setPhase('ollama-endpoint');
              else if (p === 'open-llm-provider') setPhase('open-llm-url');
              else onNext('skip', '', '', '');
            }}
            active
          />
        </Box>
      </>
    ));
  }

  // #4491: the update offer of an outdated unedited connector file.
  if (phase === 'gw-update' && selectedConnector && seed) {
    const conn = selectedConnector.file.connector;
    const toModels = (): void => {
      const has = (conn.models.catalogue?.length ?? 0) > 0 || discoveryEnabled(conn);
      setPhase(has ? 'gw-model' : 'gw-model-custom');
    };
    return frame('picker', seedGuidance, toProvider, `The connector file of ${conn.name}.`, (
      <>
        <StatusRow level="warn" label={seed.file} summary={seedStatusText(seed, { hint: 'none', withFile: false })} labelWidth={Math.min(24, seed.file.length + 1)} />
        <Box marginTop={1}>
          <SelectInput
            label=""
            options={connectorUpdateOptions(seed)}
            onCursorChange={onSeedCursor}
            showKeyHints={false}
            visibleCount={PICKER_VISIBLE_COUNT}
            onSelect={(v) => {
              if (v === 'update' && workspaceRoot) {
                try {
                  const r = updateBundledConnectors(workspaceRoot, { only: [seed.file] });
                  const ok = r.updated.includes(seed.file);
                  setSeedMessage(ok ? `Connector file ${seed.file} updated to the packaged version (reviewed ${seed.bundledReviewed ?? 'unknown'}).` : `Connector file ${seed.file} was not updated.`);
                  try { logPortfolio('info', 'wizard.llm.connector-update', `Setup LLM step connector file update: ${ok ? 'updated' : 'not updated'}`, { context: { connector_id: conn.id, file: seed.file, updated: ok } }); } catch { /* best-effort */ }
                } catch (err) { setSeedMessage(`Connector file ${seed.file} was not updated: ${err instanceof Error ? err.message : String(err)}`); }
                setLoaded(loadConnectors());
                setRefreshedConnector(undefined);
              }
              setSeed(undefined);
              toModels();
            }}
            active
          />
        </Box>
      </>
    ));
  }

  // #1400: model picker for a gateway connector with a catalogue.
  if (phase === 'gw-model' && selectedConnector) {
    const conn = selectedConnector.file.connector;
    // #4475: the shared list rule: served catalogue models first, then the
    // other served models (type to filter), the ones the platform does not
    // serve last and marked; the cursor never starts on a not served model.
    const listed = refreshedConnector?.file.connector.id === conn.id ? refreshedConnector.file.connector : conn;
    // #4475: the stored model of this slot (.swao.yml) is the current model of its connector.
    const stored = workspaceRoot ? readLlmSlotFromYaml(workspaceRoot, isSecondary ? 'secondary' : 'primary') : {};
    const current = stored.connector === conn.id ? stored.model : undefined;
    const list = pickerModelList(listed, { ...(current ? { current } : {}), servedIds: gwDiscovery.status === 'live' ? gwDiscovery.refresh?.servedIds : undefined });
    const discoveryNote = pickerSourceLine(gwDiscovery.status, gwDiscovery.refresh?.servedIds.length ?? 0,
      discoveryFallbackText({ status: gwDiscovery.status === 'off' ? 'off' : 'catalogue', reason: gwDiscovery.refresh?.reason }));
    // #4220: the model in words as the label ("DeepSeek Pro (latest)"), the
    // price in the dim detail column, the raw id in the guidance (model-label.ts).
    const modelOptions: SelectOption[] = [
      ...list.models.map((m) => pickerModelOption(m, conn.name)),
      OTHER_MODEL_OPTION,
    ];
    return frame('picker', modelGuidance, toProvider, `The model of ${conn.name}.`, (
      <>
        {fact('Connector', conn.name)}
        <Text {...tone('muted')}>{fitToWidth(discoveryNote, width)}</Text>
        {/* #4475: a stored current model the platform does not serve: a line, never an option. */}
        {list.notServedCurrent ? <Text {...tone('warning')}>{fitToWidth(notServedLine(list.notServedCurrent), width)}</Text> : null}
        {/* #4491: the result of the update, or the notice of an edited copy with a newer packaged file. */}
        {seedMessage ? <Text {...tone('muted')}>{fitToWidth(seedMessage, width)}</Text> : null}
        {seed?.status === 'edited' ? <Text {...tone('warning')}>{fitToWidth(`Note: ${seedStatusText(seed, { hint: 'none' })}.`, width)}</Text> : null}
        {gwDiscovery.status === 'running' ? null : (
        <Box marginTop={1}>
          <SelectInput
            key={gwDiscovery.status}
            label="Model"
            options={modelOptions}
            initialIndex={list.initial >= 0 ? list.initial : modelOptions.length - 1}
            filter={modelOptions.length > 12}
            itemNoun="models"
            filterGuidance={MODEL_FILTER_GUIDANCE}
            onCursorChange={onModelCursor}
            showKeyHints={false}
            onSelect={(v) => {
              if (v === '__custom__') { setPhase('gw-model-custom'); return; }
              startCheck(v, 'gw-model');
            }}
            active
            visibleCount={PICKER_VISIBLE_COUNT}
          />
        </Box>
        )}
      </>
    ));
  }

  // #1400: free-text model entry (no catalogue, or Other chosen).
  if (phase === 'gw-model-custom' && selectedConnector) {
    const conn = selectedConnector.file.connector;
    const hasCatalogue = (conn.models.catalogue?.length ?? 0) > 0 || discoveryEnabled(conn);
    return frame('textInput', {
      title: 'Model id',
      what: 'Type the model identifier exactly as the platform expects it (for aggregators the vendor-prefixed id, for example mistralai/mistral-large). An empty entry takes the connector default.',
      sections: [{ label: 'Default', text: conn.models.default }],
    }, hasCatalogue ? () => setPhase('gw-model') : toProvider, `The model of ${conn.name}.`, (
      <>
        {fact('Connector', conn.name)}
        <Box marginTop={1}>
          <TextInput
            key="gw-model-custom"
            label={`Model id (default ${conn.models.default})`}
            initialValue={customModel}
            onSubmit={(v) => {
              const m = v.trim() || conn.models.default;
              setCustomModel(m);
              startCheck(m, 'gw-model-custom');
            }}
          />
        </Box>
      </>
    ));
  }

  // #4500: the test call of the chosen model, then a choice on a failure.
  if (phase === 'gw-model-check' && selectedConnector && check) {
    const conn = selectedConnector.file.connector;
    const back = (): void => { setCheck(undefined); setPhase(check.from); };
    const failed = check.result?.status === 'fail' ? check.result : undefined;
    const labelWidth = Math.min(24, conn.name.length + 1);
    if (!failed) {
      return frame('confirm', { title: 'Model test', what: 'SWAO sends one short request to the chosen model, with the same alias resolution as the Health Check, before the model is written to .swao.yml.' }, back, `The model of ${conn.name}.`, (
        <StatusRow level="waiting" label={conn.name} summary={`testing ${check.model} (up to 20 seconds)`} labelWidth={labelWidth} />
      ));
    }
    const resolvedNote = failed.model !== check.model ? ` (resolved to ${failed.model})` : '';
    return frame('picker', checkGuidance, back, `The model of ${conn.name}.`, (
      <>
        <StatusRow level="warn" label={conn.name} summary={`test call failed for ${check.model}${resolvedNote}: ${failed.message}`} labelWidth={labelWidth} />
        <Box marginTop={1}>
          <SelectInput
            label=""
            options={modelCheckFailOptions(check.model, failed.message)}
            onCursorChange={onCheckCursor}
            showKeyHints={false}
            visibleCount={PICKER_VISIBLE_COUNT}
            onSelect={(v) => {
              if (v === 'again') { setCheck(undefined); setPhase(check.from); return; }
              onNext(provider, check.model, '', '');
            }}
            active
          />
        </Box>
      </>
    ));
  }

  if (phase === 'pick-model') {
    const options = legacyModelOptions(provider === 'openai' ? 'openai' : 'anthropic');
    return frame('picker', legacyModelGuidance, toProvider, 'Better models improve verdict quality but cost more.', (
      <>
        {fact('Provider', provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI ChatGPT')}
        <Box marginTop={1}>
          <SelectInput
            label="Model"
            options={options}
            onCursorChange={onLegacyModelCursor}
            showKeyHints={false}
            visibleCount={PICKER_VISIBLE_COUNT}
            onSelect={(v) => { setModel(v); onNext(provider, v, '', ''); }}
            active
          />
        </Box>
      </>
    ));
  }

  if (phase === 'ollama-endpoint') {
    return frame('textInput', {
      title: 'Ollama endpoint',
      what: 'The URL of your local Ollama server. An empty entry takes the local default http://127.0.0.1:11434.',
      sections: [{ label: 'Format', text: 'http://host:port (no trailing slash)' }],
    }, toProvider, 'The local Ollama server SWAO calls.', (
      <TextInput
        key="ollama-endpoint"
        label="Ollama endpoint (default http://127.0.0.1:11434)"
        placeholder="http://127.0.0.1:11434"
        onSubmit={(v) => { setEndpoint(v || 'http://127.0.0.1:11434'); setPhase('ollama-model'); }}
        active
      />
    ));
  }

  if (phase === 'open-llm-url') {
    return frame('textInput', {
      title: 'Open LLM Provider: base URL',
      what: 'The base URL of your OpenAI-compatible LLM endpoint, without the model prefix and without /v1/chat/completions.',
      sections: [
        { label: 'Format', text: 'https://host (no trailing slash)' },
        { label: 'Example', text: 'https://genai-hub.example.com' },
      ],
    }, toProvider, 'Your own OpenAI-compatible endpoint.', (
      <TextInput
        key="open-llm-url"
        label="Base URL (e.g. https://your-llm.example.com)"
        placeholder="https://your-llm.example.com"
        onSubmit={(v) => { if (v) { setOpenLlmBaseUrl(v); setPhase('open-llm-model'); } }}
        active
      />
    ));
  }

  if (phase === 'open-llm-model') {
    return frame('textInput', {
      title: 'Open LLM Provider: model',
      what: 'The model identifier served by your endpoint. It is used as the path prefix and in the request body.',
      sections: [
        { label: 'Format', text: 'The model name as-is (e.g. Mistral-Small-24B-Instruct-2501)' },
        { label: 'Bearer token', text: 'Asked for in the Credentials step and stored in the vault, never written to .swao.yml.' },
      ],
    }, () => setPhase('open-llm-url'), 'Your own OpenAI-compatible endpoint.', (
      <>
        {fact('Base URL', openLlmBaseUrl)}
        <Box marginTop={1}>
          <TextInput
            key="open-llm-model"
            label="Model name (e.g. Mistral-Small-24B-Instruct-2501)"
            placeholder="Mistral-Small-24B-Instruct-2501"
            onSubmit={(v) => { if (v) onNext('open-llm-provider', v, '', openLlmBaseUrl); }}
            active
          />
        </Box>
      </>
    ));
  }

  // ollama-model
  return frame('textInput', {
    title: 'Ollama model',
    what: 'The model name as the Ollama server lists it; pull the model on that server first if it is not installed.',
    sections: [{ label: 'Format', text: 'for example llama3.1, mistral, qwen2.5' }],
  }, () => setPhase('ollama-endpoint'), 'The local Ollama server SWAO calls.', (
    <>
      {fact('Endpoint', endpoint)}
      <Box marginTop={1}>
        <TextInput
          key="ollama-model"
          label="Model name (e.g. llama3.1, mistral)"
          placeholder="llama3.1"
          onSubmit={(v) => { if (v) onNext('ollama', v, endpoint, ''); }}
          active
        />
      </Box>
    </>
  ));
}
