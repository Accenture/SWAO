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

// #4196 SET-07 (Design 125 sections 5.6 and 5.7): Candidates step of the LLM
// branch. Two to five connector and model pairs from wsp/inputs/llm-gateway/,
// each with its credential status. The list opens with the stored
// candidates (setup/defaults.ts readLlmDefaults, which also reads the older
// llm_assessment.legs); Enter saves them as assessment.llm.candidates. The
// same connector may appear twice with different models. Candidates without a
// stored credential then get the credentials screen of the workspace setup
// (CredentialsStep, with its connectivity check).
//
// #4347 (Design 126 sections 7, 8 and 9): one StatusRow per candidate (state,
// connector, then model and credential in the value column; the label column
// is as wide as the longest connector, so a model id never runs into it), the
// keys in the KeyHints line through SetupStepFrame, the guidance box follows
// the highlighted candidate (connector, model, credential, price per million
// tokens when the connector file states it) and never pages. Esc belongs to
// the wizard (#4341): keeping the stored candidates is the last list entry;
// the connector and model pickers go back with Left arrow or Shift+Tab.
// #4254 (run 9): the connector and model pickers are the central numbered
// SelectInput; the list rows are StatusRows and PickerRows (no local cursor
// marker); "Add a candidate" is a list entry (no letter A), D removes the
// highlighted candidate and is named only while a candidate is highlighted,
// and the Enter hint says what Enter does on the highlighted row.

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PICKER_VISIBLE_COUNT, PickerRow, SelectInput, StatusRow, fitToWidth, tone, useHeaderWidth, type GuidanceEntry, type KeyHint, MODEL_FILTER_GUIDANCE } from '@swao/tui-kit';
import { logPortfolio, providerLabel, providerName } from '@swao/core';
import { CredentialsStep } from '../../tui/screens/wizard/steps/CredentialsStep.js';
import { readLlmDefaults, type LlmCandidate } from '../defaults.js';
import {
  candidateKey,
  candidatesProblem,
  listCandidateConnectors,
  LLM_CANDIDATES_MAX,
  LLM_CANDIDATES_MIN,
  writeAssessmentLlm,
  type CandidateConnector,
} from '../llm-values.js';
import type { SetupStepProps } from '../types.js';
import { SetupStepFrame } from '../setup-frame.js';
import { discoveryFallbackText } from '@swao/module-llm-providers';
import { pickerModelList, pickerSourceLine, type PickerModel } from '../../tui/model-picker-list.js';
import { useModelRefresh } from '../../tui/use-model-refresh.js';

type Phase = 'list' | 'pick-connector' | 'pick-model' | 'credentials';

/** Injection point for tests: the connector list (default: the workspace gateway folder, seeded when empty). */
export type ConnectorLister = (workspaceRoot: string) => CandidateConnector[];
const defaultLister: ConnectorLister = (ws) => listCandidateConnectors(ws, { seedIfEmpty: true });

/** #4347: the connector as the row label: a cloud provider by its central abbreviation (#4296), else the id. */
export function connectorLabel(id: string): string {
  return providerName(id) ? providerLabel(id, 'abbr') : id;
}

/** The credential state of a candidate's connector. */
export function candidateCredential(c: CandidateConnector | undefined): { state: 'ok' | 'missing'; text: string } {
  if (!c) return { state: 'missing', text: 'connector not in the workspace' };
  if (!c.credentialKey) return { state: 'ok', text: 'no credential needed' };
  return c.hasCredential ? { state: 'ok', text: 'credential stored' } : { state: 'missing', text: 'credential missing, asked on save' };
}

/** #4347: the label column of the candidate rows: the longest connector label plus two, at least 10. */
export function candidateLabelWidth(candidates: readonly LlmCandidate[]): number {
  return Math.max(10, ...candidates.map((c) => connectorLabel(c.connector).length + 2));
}

const STEP_WHAT = 'The LLM Assessment runs the same assessment once per candidate and compares quality, reliability, performance, cost and security. The candidates chosen here are preselected when the assessment starts.';
const STEP_SECTIONS = [
  { label: 'Connectors', text: 'The LLM gateway connectors of this workspace (wsp/inputs/llm-gateway). The same connector can be chosen twice with different models.' },
  { label: 'Credentials', text: 'A candidate without a stored key gets the credentials screen after saving, with a connectivity check. Keys go into the SWAO credential vault.' },
  { label: 'Saved as', text: 'assessment.llm.candidates in the workspace .swao.yml; applies to LLM Assessments only.' },
] as const;

/** #4347: the guidance of one highlighted candidate. */
export function candidateGuidance(c: LlmCandidate, conn: CandidateConnector | undefined): GuidanceEntry {
  const model = c.model ?? conn?.defaultModel ?? '';
  const price = conn?.prices?.[model];
  const cloud = providerName(c.connector) ? providerLabel(c.connector) : undefined;
  return {
    title: `Candidate ${connectorLabel(c.connector)}${model ? ` ${model}` : ''}`,
    what: STEP_WHAT,
    sections: [
      { label: 'Connector', text: conn ? `${conn.name} (${conn.id})${cloud ? `, ${cloud}` : ''}` : `${c.connector}, not in the workspace gateway folder` },
      { label: 'Model', text: model || 'the connector default' },
      { label: 'Credential', text: candidateCredential(conn).text },
      { label: 'Price', text: price ? `${price.input} input and ${price.output} output per million tokens (connector file)` : 'not stated in the connector file' },
    ],
  };
}

/** #4230: the guidance of one highlighted connector of the add-candidate picker. */
export function candidateConnectorGuidance(c: CandidateConnector): GuidanceEntry {
  const cred = candidateCredential(c);
  return {
    title: `${c.name} (${c.id})`,
    what: `Adds a candidate on the ${c.name} connector; next you choose its model.${cred.state === 'missing' ? ' Its key is not stored yet; the credentials screen asks for it after saving.' : ''}`,
    sections: [
      { label: 'Models', text: c.models.length > 0 ? `${c.models.length} in the connector catalogue, default ${c.defaultModel}` : `the model the platform serves, default ${c.defaultModel}` },
      { label: 'Credential', text: cred.text },
    ],
  };
}

/** #4230: the guidance of one highlighted model of the add-candidate picker. */
export function candidateModelGuidance(c: CandidateConnector, model: string): GuidanceEntry {
  const price = c.prices?.[model];
  return {
    title: `Model ${model}`,
    what: `Adds ${c.name} with the model ${model} as a candidate${model === c.defaultModel ? ' (the connector default)' : ''}. The same connector can be a candidate again with another model.`,
    sections: [
      { label: 'Price', text: price ? `${price.input} input and ${price.output} output per million tokens (connector file)` : 'not stated in the connector file' },
      { label: 'Credential', text: candidateCredential(c).text },
    ],
  };
}

export function LlmCandidatesStep(props: SetupStepProps & { listConnectors?: ConnectorLister; credentialsStep?: typeof CredentialsStep }) {
  const { ctx, onNext, stepNumber } = props;
  const ws = ctx.workspaceRoot;
  const lister = props.listConnectors ?? defaultLister;
  const Creds = props.credentialsStep ?? CredentialsStep;
  const [connectors, setConnectors] = useState<CandidateConnector[]>(() => lister(ws));
  const [initial] = useState<LlmCandidate[]>(() => readLlmDefaults(ws).candidates);
  const [candidates, setCandidates] = useState<LlmCandidate[]>(initial);
  const [phase, setPhase] = useState<Phase>('list');
  // #4494 (Design 126 section 4): with stored candidates the cursor starts on the keep entry.
  const [cursor, setCursor] = useState(() => (initial.length > 0 ? initial.length + (initial.length < LLM_CANDIDATES_MAX ? 1 : 0) : 0));
  const [pickConnector, setPickConnector] = useState<CandidateConnector | undefined>(undefined);
  const [credQueue, setCredQueue] = useState<string[]>([]);
  const [error, setError] = useState('');
  const width = useHeaderWidth();

  const byId = new Map(connectors.map((c) => [c.id, c] as const));
  const changed = JSON.stringify(candidates) !== JSON.stringify(initial);
  const summary = (list: readonly LlmCandidate[]): string => `${list.length} candidates: ${list.map((c) => c.connector).join(', ')}`;

  const done = (status: 'done' | 'kept', list: readonly LlmCandidate[]): void => {
    try { logPortfolio('info', 'wizard.llm.candidates.complete', 'Setup: LLM candidates step complete', { context: { status, candidates: list.map(candidateKey) } }); } catch { /* best-effort */ }
    onNext(list.length > 0 ? { status, summary: summary(list) } : { status: 'skipped', summary: 'No LLM candidates' });
  };

  const save = (): void => {
    const problem = candidatesProblem(candidates);
    if (problem) { setError(problem); return; }
    if (changed) {
      try { writeAssessmentLlm(ws, { candidates }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); return; }
    }
    const missing = [...new Set(candidates.map((c) => c.connector))].filter((id) => byId.get(id) && !byId.get(id)!.hasCredential);
    if (missing.length > 0) { setCredQueue(missing); setPhase('credentials'); return; }
    done(changed ? 'done' : 'kept', candidates);
  };

  // List rows: the candidates, "Add a candidate" while fewer than the
  // maximum, then the keep entry (#4341: keep is a list entry, not Esc).
  const canAdd = candidates.length < LLM_CANDIDATES_MAX;
  const addIndex = canAdd ? candidates.length : -1;
  const keepIndex = candidates.length + (canAdd ? 1 : 0);
  const keepLabel = initial.length > 0 ? 'Keep the stored candidates and continue' : 'Skip this step';
  const listSize = keepIndex + 1;
  // #4475 (Design 090 section 7.4): the model picker reads the served models of
  // the connector when it opens and lists them with the shared rule (served
  // first, the ones the platform does not serve last and marked, the cursor
  // never on them). Offline: the catalogue, said so.
  const discovery = useModelRefresh(pickConnector?.loaded, ws, phase === 'pick-model');
  const pickConn = discovery.refresh?.status === 'live' ? discovery.refresh.loaded.file.connector : pickConnector?.loaded?.file.connector;
  const pickList = pickConn && pickConnector
    ? pickerModelList(pickConn, {
      ...(pickConn.models.catalogue?.some((m) => m.id === pickConnector.defaultModel) ? {} : { current: pickConnector.defaultModel }),
      servedIds: discovery.status === 'live' ? discovery.refresh?.servedIds : undefined,
    })
    : undefined;
  const pickModels: PickerModel[] = pickList?.models ?? (pickConnector?.models ?? []).map((id) => ({ entry: { id }, served: undefined }));
  const models = pickModels.map((m) => m.entry.id);
  const pickSource = pickerSourceLine(discovery.status, discovery.refresh?.servedIds.length ?? 0,
    discoveryFallbackText({ status: discovery.status === 'off' ? 'off' : 'catalogue', reason: discovery.refresh?.reason }));
  const menuSize = phase === 'pick-connector' ? connectors.length : phase === 'pick-model' ? models.length : listSize;

  const choose = (i: number): void => {
    setError('');
    if (phase === 'pick-connector') {
      const c = connectors[i];
      if (!c) return;
      setPickConnector(c);
      setCursor(0);
      setPhase('pick-model');
      return;
    }
    if (phase === 'pick-model' && pickConnector) {
      const next: LlmCandidate = { connector: pickConnector.id, model: models[i] ?? pickConnector.defaultModel };
      if (candidates.some((c) => candidateKey(c) === candidateKey(next))) { setError('This connector and model is already a candidate.'); return; }
      setCandidates([...candidates, next]);
      setPhase('list');
      setCursor(candidates.length);
      return;
    }
    if (i === keepIndex) { done('kept', initial); return; }
    if (i === addIndex) {
      if (connectors.length === 0) { setError('No LLM connector in this workspace. Set up the workspace LLM first.'); return; }
      setCursor(0);
      setPhase('pick-connector');
    }
  };

  const back = (): void => {
    setError('');
    if (phase === 'pick-model') { setPhase('pick-connector'); setCursor(0); return; }
    setPhase('list');
    setCursor(0);
  };

  // The connector and model pickers are SelectInputs with their own keys; the list keys are the step's.
  useInput((input, key) => {
    if (phase !== 'list' || menuSize === 0) return;
    if (key.upArrow) { setCursor((c) => (c + menuSize - 1) % menuSize); return; }
    if (key.downArrow) { setCursor((c) => (c + 1) % menuSize); return; }
    if (key.return) { if (cursor === addIndex || cursor === keepIndex) choose(cursor); else save(); return; }
    if ((input === 'd' || input === 'D' || key.delete) && cursor < candidates.length) {
      setCandidates(candidates.filter((_, i) => i !== cursor));
      setCursor((c) => Math.max(0, c - 1));
      setError('');
    }
  });

  if (phase === 'credentials' && credQueue.length > 0) {
    const id = credQueue[0]!;
    const model = candidates.find((c) => c.connector === id)?.model ?? byId.get(id)?.defaultModel ?? '';
    return (
      <Creds
        key={`cred-${id}`}
        provider={`gw:${id}`}
        model={model}
        workspaceRoot={ws}
        stepNumber={stepNumber}
        onNext={() => {
          const rest = credQueue.slice(1);
          if (rest.length > 0) { setCredQueue(rest); return; }
          setConnectors(lister(ws));
          done('done', candidates);
        }}
      />
    );
  }

  const title = 'LLM candidates';
  const subtitle = `The ${LLM_CANDIDATES_MIN} to ${LLM_CANDIDATES_MAX} connector and model pairs the LLM Assessment compares.`;

  if (phase !== 'list') {
    const pickKeys: KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
    // #4230: the box follows the highlighted connector or model.
    const highlightedConnector = phase === 'pick-connector' ? connectors[cursor] : undefined;
    const highlightedModel = phase === 'pick-model' ? models[cursor] : undefined;
    const guidance: GuidanceEntry = highlightedConnector
      ? candidateConnectorGuidance(highlightedConnector)
      : pickConnector && highlightedModel !== undefined
        ? candidateModelGuidance(pickConnector, highlightedModel)
        : phase === 'pick-connector'
          ? { title: 'Connector', what: 'The LLM gateway connector of the new candidate. A connector marked "credential missing" asks for its key after saving.', sections: [STEP_SECTIONS[0]] }
          : { title: `Model for ${pickConnector?.name ?? ''}`, what: 'The model of the new candidate; the connector default is marked. The same connector can be a candidate twice with different models.' };
    return (
      <SetupStepFrame title={title} subtitle={subtitle} keys={pickKeys} guidance={guidance} back={back}>
        <Box flexDirection="column">
          {phase === 'pick-connector' && (
            <SelectInput
              key="pick-connector"
              label="Connector"
              numbered
              visibleCount={PICKER_VISIBLE_COUNT}
              showKeyHints={false}
              options={connectors.map((c, i) => ({ label: `${c.name} (${c.id})${c.credentialKey && !c.hasCredential ? ', credential missing' : ''}`, value: String(i) }))}
              onCursorChange={(v) => setCursor(Number(v))}
              onSelect={(v) => choose(Number(v))}
            />
          )}
          {phase === 'pick-model' && pickConnector && pickConnector.loaded && (
            <Text {...tone('muted')}>{fitToWidth(pickSource, width)}</Text>
          )}
          {phase === 'pick-model' && pickConnector && discovery.status !== 'running' && (
            <SelectInput
              key={`pick-model-${pickConnector.id}-${discovery.status}`}
              label={`Model for ${pickConnector.name}`}
              numbered={models.length <= 9}
              filter={models.length > 12}
              itemNoun="models"
              filterGuidance={MODEL_FILTER_GUIDANCE}
              initialIndex={pickList && pickList.initial >= 0 ? pickList.initial : 0}
              visibleCount={PICKER_VISIBLE_COUNT}
              showKeyHints={false}
              options={pickModels.map((m, i) => ({
                label: `${m.entry.id}${m.entry.id === pickConnector.defaultModel ? ' (default)' : ''}${m.served === false ? ', not served' : ''}`,
                value: String(i),
              }))}
              onCursorChange={(v) => setCursor(Number(v))}
              onSelect={(v) => choose(Number(v))}
            />
          )}
          {error && <Text {...tone('error')}>{fitToWidth(error, width)}</Text>}
        </Box>
      </SetupStepFrame>
    );
  }

  // The Enter hint names what Enter does on the highlighted row; D only while a candidate is highlighted.
  const onCandidate = cursor < candidates.length;
  const listKeys: KeyHint[] = [
    { key: '↑↓', verb: 'select' },
    ...(onCandidate ? [{ key: 'D', verb: 'remove' } as const] : []),
    { key: 'Enter', verb: onCandidate ? 'save' : cursor === addIndex ? 'add' : 'next' },
    { key: 'Esc', verb: 'abort' },
  ];
  const highlighted = cursor < candidates.length ? candidates[cursor] : undefined;
  const guidance: GuidanceEntry = highlighted
    ? candidateGuidance(highlighted, byId.get(highlighted.connector))
    : cursor === keepIndex
      ? { title: keepLabel, what: initial.length > 0 ? 'Continues with the stored candidates; nothing is written.' : 'Continues without candidates; the LLM Assessment asks for them when it starts.', sections: [STEP_SECTIONS[2]] }
      : { title: 'Add a candidate', what: STEP_WHAT, sections: [...STEP_SECTIONS] };
  const labelWidth = candidateLabelWidth(candidates);
  const actionRow = (i: number, label: string) => (
    <PickerRow key={label} selected={cursor === i} indent={false} wrap="wrap">
      <Text {...tone(cursor === i ? 'selection' : 'text')}>{label}</Text>
    </PickerRow>
  );
  return (
    <SetupStepFrame title={title} subtitle={subtitle} keys={listKeys} guidance={guidance}>
      <Box flexDirection="column">
        {candidates.length > 0 ? (
          <Box flexDirection="column">
            {candidates.map((c, i) => {
              const v = candidateCredential(byId.get(c.connector));
              return (
                <StatusRow
                  key={candidateKey(c)}
                  level={v.state}
                  label={connectorLabel(c.connector)}
                  summary={`${c.model ?? byId.get(c.connector)?.defaultModel ?? ''}, ${v.text}`}
                  selected={cursor === i}
                  labelWidth={labelWidth}
                />
              );
            })}
          </Box>
        ) : (
          <Text {...tone('muted')}>No candidates yet.</Text>
        )}
        <Box flexDirection="column" marginTop={1}>
          {canAdd && actionRow(addIndex, 'Add a candidate')}
          {actionRow(keepIndex, keepLabel)}
        </Box>
        <Text {...tone('muted')}>{fitToWidth(`${candidates.length} of ${LLM_CANDIDATES_MIN} to ${LLM_CANDIDATES_MAX} chosen`, width)}</Text>
        {error && <Text {...tone('error')}>{fitToWidth(error, width)}</Text>}
      </Box>
    </SetupStepFrame>
  );
}
