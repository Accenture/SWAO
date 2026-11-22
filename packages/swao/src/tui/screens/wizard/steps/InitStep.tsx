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

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { logPortfolio, patchSwaoYmlFileOrThrow } from '@swao/core';
import { seedBundledConnectors } from '@swao/module-llm-providers';
import { buildWorkspaceSwaoYml, runWorkspaceScaffolders, validateIso8601Date } from '../../../../commands/init.js';
import { DetailRow, SelectInput, TextInput, tone, useOptionGuidance, type FlowStepKind, type GuidanceEntry, type SelectOption } from '@swao/tui-kit';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

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

// #3373: Enter-only confirmation (Escape is handled by the wizard shell).
function ConfirmEnter({ onConfirm }: { onConfirm: () => void }) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
  });
  return null;
}

/** #4230: the entries of the existing-workspace menu, each with its guidance entry. */
export const INIT_EXISTING_OPTIONS: readonly SelectOption[] = [
  { label: 'Continue with this workspace', value: 'continue', guidance: { title: 'Continue with this workspace', what: 'Keeps the engagement details and updates the bundled assets of the workspace (frameworks, templates, connectors) without touching your settings.' } },
  { label: 'Edit the engagement details', value: 'edit', guidance: { title: 'Edit the engagement details', what: 'Asks again for the engagement name, the client code and the owner email, each pre-filled; only these keys of .swao.yml are changed.' } },
];

// -- Init workspace -------------------------------------------------------------

export function InitStep({ onNext }: { onNext: (s: { workDir: string; engagementName: string; clientCode: string; partnershipLead: string }) => void }) {
  const [phase, setPhase]         = useState<InitPhase>('input-dir');
  const [workDir, setWorkDir]     = useState('');
  const [engName, setEngName]     = useState('');
  const [clientCode, setClientCode] = useState('');
  const [lead, setLead]           = useState('');
  const [engagementLead, setEngagementLead] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [existingParsed, setExistingParsed] = useState<ExistingSwaoYml | null>(null);
  const [error, setError]         = useState('');
  // #4230: the guidance of the existing-workspace menu follows the highlighted entry.
  const { entry: existingEntry, onCursorChange: onExistingCursor } = useOptionGuidance({
    title: 'Workspace found',
    what: 'This folder already holds a SWAO workspace. Continue with it, or edit its engagement details first.',
  });

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
      // #3388 (Design 112): seed the packaged LLM gateway connectors into
      // wsp/inputs/llm-gateway/ so they are visible and editable at setup time.
      // Best-effort; the runtime loader still falls back to the bundled seeds.
      try { seedBundledConnectors(resolved); } catch { /* non-fatal */ }
    } catch (e) {
      setError(`Could not write .swao.yml: ${(e as Error).message}`);
      return;
    }
    // #2386 / #4121: engagement data of a new workspace collected and written. One code, one
    // meaning: the wizard shell emits wizard.engagement.confirmed when the step completes.
    try { logPortfolio('info', 'wizard.engagement.collected', 'InitStep engagement data collected', { context: { engagement_name: name, client_code: code, has_lead: Boolean(ownerLead), has_engagement_lead: Boolean(engLead), has_end_date: Boolean(end) } }); } catch { /* best-effort */ }
    onNext({ workDir: resolved, engagementName: name, clientCode: code, partnershipLead: ownerLead });
  };

  // Update engagement fields in an existing .swao.yml without touching other blocks.
  const writeAndUpdate = (name: string, code: string, ownerLead: string, engLead: string, end: string) => {
    const yamlPath = join(workDir, '.swao.yml');
    try {
      // #4283: minimal patch of the engagement keys only; comments, quoting and
      // every other key of the file stay (Design 125 section 7).
      const engagement = (key: string, value: string) => ({ path: ['engagement', key], value });
      patchSwaoYmlFileOrThrow(yamlPath, [
        engagement('name', name),
        engagement('client_code', code),
        engagement('partnership_lead', ownerLead),
        ...(engLead ? [engagement('engagement_lead', engLead)] : []),
        ...(end ? [engagement('end_date', end)] : []),
      ]);
      try { runWorkspaceScaffolders(workDir); } catch { /* best-effort */ }
    } catch (e) {
      setError(`Could not update .swao.yml: ${(e as Error).message}`);
      return;
    }
    // #2386 / #4121: engagement data of an existing workspace edited and written.
    try { logPortfolio('info', 'wizard.engagement.updated', 'InitStep engagement data updated', { context: { engagement_name: name, client_code: code, has_lead: Boolean(ownerLead), has_engagement_lead: Boolean(engLead), has_end_date: Boolean(end) } }); } catch { /* best-effort */ }
    onNext({ workDir, engagementName: name, clientCode: code, partnershipLead: ownerLead });
  };

  // #4254 TUI-10 (Design 126 sections 4.5, 7.2, 7.7 and 9): every phase renders
  // through SetupStepFrame (title "Init" without a number, the hint line of its
  // input kind, one guidance box); each sub-phase goes back with Shift+Tab
  // through the frame's `back`; Esc belongs to the wizard. The engagement facts
  // are DetailRows; continue or edit an existing workspace are menu entries
  // with their own guidance (#4230), no letter key.
  const facts = (rows: ReadonlyArray<[string, string]>): JSX.Element => (
    <Box flexDirection="column" marginBottom={1}>
      {rows.map(([label, value]) => <DetailRow key={label} label={label} value={value || '(not set)'} labelWidth={16} path={label === 'Workspace' || label === 'Portfolio root'} />)}
    </Box>
  );
  const frame = (subtitle: string, kind: FlowStepKind, guidance: GuidanceEntry, back: (() => void) | undefined, body: JSX.Element): JSX.Element => (
    <SetupStepFrame title="Init" subtitle={subtitle} kind={kind} guidance={guidance} back={back}>
      <Box flexDirection="column">
        {body}
        {error && <Text {...tone('error')}>{error}</Text>}
      </Box>
    </SetupStepFrame>
  );
  const keepNote = (current: string): string => `Current: ${current || '(not set)'}. An empty entry keeps it.`;

  // -- Edit-existing flow (pre-filled inputs from parsed YAML) ---------------

  if (phase === 'edit-existing-name') {
    return frame('Edit the engagement details.', 'textInput', { title: 'Engagement name', what: `${keepNote(engName)} The name is shown on every report cover.` }, () => setPhase('confirm-existing'), (
      <TextInput
        key="edit-eng-name"
        label="Engagement name"
        placeholder={engName || 'My Cloud Transformation'}
        onSubmit={(v) => { setEngName(v || engName); setPhase('edit-existing-code'); }}
        active
      />
    ));
  }

  if (phase === 'edit-existing-code') {
    return frame('Edit the engagement details.', 'textInput', { title: 'Client code', what: `${keepNote(clientCode)} A short slug used in folder names and BI exports.` }, () => setPhase('edit-existing-name'), (
      <>
        {facts([['Engagement', engName]])}
        <TextInput
          key="edit-client-code"
          label="Client code (slug)"
          placeholder={clientCode || 'acme'}
          onSubmit={(v) => { setClientCode(v || clientCode); setPhase('edit-existing-lead'); }}
          active
        />
      </>
    ));
  }

  if (phase === 'edit-existing-lead') {
    return frame('Edit the engagement details.', 'textInput', { title: 'Engagement owner email', what: `${keepNote(lead)} Shown on report covers.` }, () => setPhase('edit-existing-code'), (
      <>
        {facts([['Engagement', engName], ['Client code', clientCode]])}
        <TextInput
          key="edit-lead"
          label="Engagement owner email (empty keeps it)"
          placeholder={lead || 'you@example.com'}
          onSubmit={(v) => { writeAndUpdate(engName, clientCode, v || lead, engagementLead, endDate); }}
          active
        />
      </>
    ));
  }

  if (phase === 'confirm-existing') {
    const eng = existingParsed?.engagement;
    const options = [...INIT_EXISTING_OPTIONS];
    return frame('A workspace was found in this folder.', 'picker', existingEntry, () => setPhase('input-dir'), (
      <>
        {facts([['Workspace', `${workDir}/.swao.yml`], ['Engagement', eng?.name ?? ''], ['Client code', eng?.client_code ?? ''], ['Lead email', eng?.partnership_lead ?? '']])}
        <SelectInput
          label=""
          options={options}
          numbered
          showKeyHints={false}
          visibleCount={options.length}
          onCursorChange={onExistingCursor}
          onSelect={(v) => {
            if (v === 'edit') { setPhase('edit-existing-name'); return; }
            try { runWorkspaceScaffolders(workDir); } catch { /* best-effort */ }
            onNext({ workDir, engagementName: engName, clientCode, partnershipLead: lead });
          }}
        />
      </>
    ));
  }

  if (phase === 'input-engagement-name') {
    return frame('These details appear in all assessment reports.', 'textInput', { title: 'Engagement name', what: 'The name shown on every report cover (e.g. ACME Cloud Transformation).' }, () => setPhase('input-dir'), (
      <TextInput
        key="input-engagement-name"
        label="Engagement name (e.g. ACME Cloud Transformation)"
        placeholder="My Cloud Transformation"
        onSubmit={(v) => { if (v) { setEngName(v); setPhase('input-client-code'); } }}
        active
      />
    ));
  }

  if (phase === 'input-client-code') {
    return frame('These details appear in all assessment reports.', 'textInput', {
      title: 'Client code',
      what: 'A short slug used in folder names and BI exports.',
      sections: [{ label: 'Format', text: 'lowercase letters, digits, hyphens (e.g. acme)' }],
    }, () => setPhase('input-engagement-name'), (
      <>
        {facts([['Engagement', engName]])}
        <TextInput
          key="input-client-code"
          label="Client code (short slug, e.g. acme)"
          placeholder="acme"
          onSubmit={(v) => {
            if (v) { setClientCode(v); setPhase('input-lead'); }
          }}
          active
        />
      </>
    ));
  }

  if (phase === 'input-lead') {
    return frame('These details appear in all assessment reports.', 'textInput', { title: 'Engagement owner email', what: 'Optional contact shown on report covers. An empty entry skips it.' }, () => setPhase('input-client-code'), (
      <>
        {facts([['Engagement', engName], ['Client code', clientCode]])}
        <TextInput
          key="input-lead"
          label="Engagement owner email (optional)"
          placeholder="you@example.com"
          onSubmit={(v) => { setLead(v); setPhase('input-engagement-lead'); }}
          active
        />
      </>
    ));
  }

  if (phase === 'input-engagement-lead') {
    return frame('These details appear in all assessment reports.', 'textInput', { title: 'Engagement lead', what: 'The person leading delivery, shown on HTML publication covers. An empty entry skips it.' }, () => setPhase('input-lead'), (
      <>
        {facts([['Engagement', engName], ['Client code', clientCode]])}
        <TextInput
          key="input-engagement-lead"
          label="Engagement lead name or email (optional)"
          placeholder="firstname.lastname@example.com"
          onSubmit={(v) => { setEngagementLead(v); setPhase('input-end-date'); }}
          active
        />
      </>
    ));
  }

  if (phase === 'input-end-date') {
    return frame('These details appear in all assessment reports.', 'textInput', { title: 'Engagement end date', what: 'The target completion date in YYYY-MM-DD format, shown on publication covers. An empty entry skips it.' }, () => setPhase('input-engagement-lead'), (
      <>
        {facts([['Engagement', engName], ['Client code', clientCode]])}
        <TextInput
          key="input-end-date"
          label="Expected end date YYYY-MM-DD (optional)"
          placeholder="2026-12-31"
          onSubmit={(v) => {
            const err = validateIso8601Date(v);
            if (err) { setError(err); return; }
            writeAndFinish(engName, clientCode, lead, engagementLead, v);
          }}
          active
        />
      </>
    ));
  }

  // phase === 'input-dir'
  // #3373 / ADR-0070: the portfolio root is the folder SWAO runs in; no
  // free-text directory, because the TUI and its child commands work from
  // this folder (a sub-folder workspace was not found by the health check
  // and the support bundle).
  return frame('Creates .swao.yml for a new workspace, or continues with an existing one.', 'confirm', {
    title: 'Portfolio root',
    what: 'The folder SWAO was started in is the portfolio root: .swao.yml, apps/ and wsp/ are created here. An existing workspace in this folder is detected and reused.',
    sections: [{ label: 'Other folder', text: 'Quit, copy the SWAO executable to that folder and start it from there.' }],
  }, undefined, (
    <>
      {facts([['Portfolio root', resolve('.')]])}
      <ConfirmEnter onConfirm={() => tryDir('.')} />
    </>
  ));
}
