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
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { logPortfolio } from '@swao/core';
import { buildWorkspaceSwaoYml, runWorkspaceScaffolders, validateIso8601Date } from '../../../../commands/init.js';
import { TextInput } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { _wizardGuidanceOpen, setWizardGuidanceOpen } from '../shared.js';

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

// Shared key-handler helper: Enter confirms, Escape navigates back.
// Exported because PlaywrightStep also uses it.
export function ConfirmContinue({ onConfirm, onBack }: { onConfirm: () => void; onBack: () => void }) {
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

// -- Step 1: Init workspace -----------------------------------------------

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
    // #2386: emit wizard.engagement.complete so monitors can observe engagement data collection.
    try { logPortfolio('info', 'wizard.engagement.complete', 'InitStep engagement data collected', { context: { engagement_name: name, client_code: code, has_lead: Boolean(ownerLead), has_engagement_lead: Boolean(engLead), has_end_date: Boolean(end) } }); } catch { /* best-effort */ }
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
    // #2386: emit wizard.engagement.complete for update path as well.
    try { logPortfolio('info', 'wizard.engagement.complete', 'InitStep engagement data updated', { context: { engagement_name: name, client_code: code, has_lead: Boolean(ownerLead), has_engagement_lead: Boolean(engLead), has_end_date: Boolean(end) } }); } catch { /* best-effort */ }
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
