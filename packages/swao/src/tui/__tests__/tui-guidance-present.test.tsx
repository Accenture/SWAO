// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-05: guidance per sub-step and per option (#4230)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-05, the Setup Wizard part (#4230 criterion 3;
// the screen part, a guidance box on every screen, stays with #4213).
// Scope: every Setup Wizard step and branch (generic, Application, Service,
// LZ Catalog, LZ Live, LLM): swao/src/setup/, tui/screens/wizard/ and the
// Landing Zone Connections screen the LZ Live branch embeds.
//
// G-05a every SetupStepFrame passes a guidance entry (each sub-step has one).
// G-05b every SelectInput and MultiSelect passes onCursorChange (the box
//       follows the highlighted option).
// G-05c every file with a picker (SelectInput, MultiSelect, a list drawn with
//       CURSOR_MARKER, ActionRows or PickerRow) has an entry in PICKERS below, with the
//       SelectInput count of the file; a new picker fails until its options
//       are registered.
// G-05d every registered option list gives each option a guidance entry with
//       a title and an explanation, and a list of two or more options does
//       not give every option the same entry (one static entry for a list).
//
// The screen part (#4213, Design 126 section 14 row TUI-14): every screen the
// App routes to, listed once in `__tests__/helpers/screen-cases.tsx`.
//
// G-05e every screen file (`*Screen.tsx`, `*Menu.tsx`, `*Wizard.tsx`) has a
//       render case or a documented exemption (SCREEN_EXEMPT: Help #2347, the
//       Enterprise Chat in the private tui13-chat-width.test.tsx).
// G-05f every screen renders a guidance box, on its first frame and after the
//       keys of its case: main menu, Setup Wizard, Tools, Assessment type,
//       Application, LZ Catalog, LZ Live, LLM and Service assessments, Health
//       Check, Generate Report, Publish, Serve, Export BI, Licence,
//       Credentials, Lenses, Regime Selector, Update LZ Catalogue, LZ
//       Connections, Update LLM Gateway, Ingest, Support Bundle, Upgrade
//       prompt, Chat notice, and (where swao-premium is present) Portfolio
//       Operations, Stakeholder Challenge and Generate TF.
// G-05g every SelectInput and MultiSelect of the screen trees (every TUI file
//       outside tui-kit and the Setup Wizard sources above) passes
//       onCursorChange, so the box follows the highlighted option.
// G-05h every option list a screen renders (captured from SelectInput and
//       MultiSelect while the cases render) gives each option its own guidance
//       entry (the G-05d rule). Header rows of a grouped list are not options.
//
// Strict since 2026-11-13 (#4213 criterion 3, night lane tui): G-05g and G-05h
// have no skip list; every screen picker passes onCursorChange and every
// rendered option list has one guidance entry per option.

import { describe, it, expect, vi, afterAll } from 'vitest';
import React from 'react';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { GuidanceEntry, SelectOption } from '@swao/tui-kit';

// G-05h: the option lists the screens hand to SelectInput and MultiSelect.
interface CapturedList { kind: string; label: string; options: ReadonlyArray<{ label?: string; value?: string; guidance?: GuidanceEntry; header?: boolean }> }
const captured = vi.hoisted(() => ({ lists: [] as CapturedList[], ws: '' }));
vi.mock('@swao/tui-kit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/tui-kit')>();
  const { createElement } = await import('react');
  const wrap = <P extends { label?: unknown; options: CapturedList['options'] }>(kind: string, C: (p: P) => React.ReactNode) =>
    (props: P): React.ReactNode => {
      captured.lists.push({ kind, label: typeof props.label === 'string' ? props.label : '', options: props.options });
      return createElement(C as React.FC<P>, props);
    };
  return {
    ...original,
    SelectInput: wrap('SelectInput', original.SelectInput as never),
    MultiSelect: wrap('MultiSelect', original.MultiSelect as never),
  };
});
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => captured.ws),
    logPortfolio: vi.fn(),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01', fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com', firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined } })) },
  };
});
// Screens that start a CLI child get a fake that prints one line and exits 0.
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...original,
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: () => true, end: () => undefined }, kill: () => true, pid: 0 });
      setTimeout(() => { child.stdout.emit('data', Buffer.from('[ok]  done\n')); child.emit('close', 0); }, 20);
      return child;
    }),
  };
});
import { SETUP_ASSESSMENT_TYPES } from '@swao/core';
import { sourceFiles, PACKAGES_DIR, REPO_ROOT, repoPath, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { isScreenFile } from '../../__tests__/helpers/tui-gate-rules.js';
import { renderAt } from '../../__tests__/helpers/render-at.js';
import { SCREEN_EXEMPT, fixtureWorkspace, screenCases } from '../../__tests__/helpers/screen-cases.js';
import { setupStartOptions } from '../../setup/SetupStartStep.js';
import { typeSelectionGuidance } from '../../setup/TypeSelectionStep.js';
import { catalogueGuidance, targetKeepGuidance, targetOptionGuidance, targetProviderGuidance } from '../../setup/branches/lz-catalog.js';
import type { LzCatalogueRow } from '../../setup/branches/lz-catalog-checks.js';
import { PROBE_ASK_OPTIONS, PROBE_RESULT_OPTIONS, baselineFrameworkGuidance } from '../../setup/branches/lz-live-steps.js';
import { SERVICE_WORKSPACE_OPTIONS, intakeActionGuidance, intakeWorkbookGuidance } from '../../setup/branches/service.js';
import { APP_SOURCE_CHOICES, appListChoices, appListGuidance, appSourceGuidance } from '../../setup/steps/ApplicationAppStep.js';
import { SOURCE_ACTIONS, SOURCE_ACTION_GUIDANCE, sourceAppGuidance } from '../../setup/steps/ApplicationSourceStep.js';
import { TOOLS_ACTIONS, TOOLS_ACTION_GUIDANCE, toolGuidance } from '../../setup/steps/ApplicationToolsStep.js';
import { APPLICATION_TOOLS } from '../../setup/application-tools.js';
import { candidateConnectorGuidance, candidateGuidance, candidateModelGuidance } from '../../setup/steps/LlmCandidatesStep.js';
import type { CandidateConnector } from '../../setup/llm-values.js';
import { subjectGuidance } from '../../setup/steps/LlmSubjectStep.js';
import { credentialFailOptions } from '../screens/wizard/steps/CredentialsStep.js';
import { INIT_EXISTING_OPTIONS } from '../screens/wizard/steps/InitStep.js';
import { MCP_CONTINUE_INDEX, WIZARD_MCP_CLIENTS, mcpClientGuidance, playwrightOptions } from '../screens/wizard/steps/IntegrationsStep.js';
import { secondaryOptions } from '../screens/wizard/steps/LlmSecondaryStep.js';
import { connectorUpdateOptions, legacyModelOptions, modelCheckFailOptions, providerOptions } from '../screens/wizard/steps/LlmStep.js';
import { LZ_CONNECTIONS_STEP_CHOICES, LZ_CONNECTIONS_STEP_GUIDANCE } from '../screens/wizard/steps/LzConnectionsStep.js';
import { testCodeOptions } from '../screens/wizard/steps/TestCodeStep.js';
import { modelOption, OTHER_MODEL_OPTION } from '../model-label.js';
import {
  CONNECTION_ACTIONS,
  LZ_CONNECTIONS_ACTION_GUIDANCE,
  lzAppLinkGuidance,
  lzAuthMethodGuidance,
  lzMigrateTargetGuidance,
  lzPickLandingZoneGuidance,
  lzProviderGuidance,
  lzRemoveTargetGuidance,
  lzScopeKindGuidance,
} from '../screens/lz-connections-flow.js';

const SRC = join(PACKAGES_DIR, 'swao', 'src');
const rel = (file: string): string => file.slice(SRC.length + 1).replace(/\\/g, '/');

/** The Setup Wizard sources: setup steps and branches, wizard steps, the embedded LZ Connections screen. */
function wizardFiles(): string[] {
  return [
    ...sourceFiles(join(SRC, 'setup')),
    ...sourceFiles(join(SRC, 'tui', 'screens', 'wizard')),
    join(SRC, 'tui', 'screens', 'LzConnectionsScreen.tsx'),
  ].filter((f) => f.endsWith('.tsx'));
}

/** The opening tags of a JSX element (name to the matching `>`), with their line. */
export function jsxElements(text: string, name: string): Array<{ line: number; tag: string }> {
  const out: Array<{ line: number; tag: string }> = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let end = text.length;
    for (let i = m.index + 1; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && text[i - 1] !== '=') { end = i; break; }
    }
    out.push({ line: text.slice(0, m.index).split('\n').length, tag: text.slice(m.index, end + 1) });
  }
  return out;
}

const selectCount = (text: string): number => jsxElements(text, 'SelectInput').length + jsxElements(text, 'MultiSelect').length;
const hasPicker = (text: string): boolean => selectCount(text) > 0 || /\bCURSOR_MARKER\b/.test(text) || /<(ActionRows|PickerRow)\b/.test(text);

/** Components that draw a list for their callers; their call sites are registered, not them. */
const LIST_COMPONENTS: Readonly<Record<string, string>> = {
  'setup/steps/step-ui.tsx': 'ActionRows, the action entries below the status rows of the setup steps; the steps that call them are registered',
  'tui/screens/wizard/GroupedRegionPicker.tsx': '#4494, the grouped region rows of the Add scope step; LzConnectionsScreen (registered) gives the step guidance',
};

type Lists = Record<string, ReadonlyArray<GuidanceEntry | undefined>>;
const fromOptions = (options: readonly SelectOption[]): Array<GuidanceEntry | undefined> => options.map((o) => o.guidance);

const CONNECTOR: CandidateConnector = { id: 'gw-one', name: 'Gateway One', defaultModel: 'model-a', models: ['model-a', 'model-b'], credentialKey: 'GW_ONE_KEY', hasCredential: false, prices: { 'model-a': { input: 1, output: 2 } } };
const ROW: LzCatalogueRow = { provider: 'otc', origin: 'bundled', name: 'T Cloud Public', lastUpdated: '2026-11-01', ageDays: 12, stale: false, qualityErrors: 0, qualityWarnings: 0, qualityRules: [] };
const OTC_METHODS = [
  { id: 'iam-password-token', required: ['username', 'password', 'domain'], optional: [] },
  { id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'] },
];
const ALL_METHODS = [
  ...OTC_METHODS,
  { id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: ['session-token', 'expires-at'] },
  { id: 'service-principal-secret', required: ['tenant-id', 'client-id', 'client-secret'], optional: [] },
  { id: 'service-principal-certificate', required: ['tenant-id', 'client-id', 'client-certificate'], optional: [] },
  { id: 'key-flow', required: ['service-account-key'], optional: [] },
];
const LZ = { id: 'otc-prod', scopes: [{ id: 'platform', kind: 'platform' }, { id: 'payments', kind: 'application' }] };

/**
 * G-05c: every Setup Wizard file with a picker, the number of SelectInput and
 * MultiSelect elements in it, and the option lists of all its pickers (hand
 * drawn lists included), built with the functions the step itself uses.
 */
const PICKERS: Readonly<Record<string, { selects: number; lists: () => Lists }>> = {
  'setup/SetupStartStep.tsx': { selects: 1, lists: () => ({ menu: fromOptions(setupStartOptions('/ws')) }) },
  'setup/TypeSelectionStep.tsx': {
    selects: 0,
    lists: () => ({
      single: SETUP_ASSESSMENT_TYPES.map((t) => typeSelectionGuidance(t, 'enterprise', true, undefined)),
      multi: SETUP_ASSESSMENT_TYPES.map((t) => typeSelectionGuidance(t, 'community', false, 'ready')),
    }),
  },
  'setup/branches/lz-catalog.tsx': {
    selects: 0,
    lists: () => ({
      catalogues: [catalogueGuidance(ROW, true), catalogueGuidance({ ...ROW, provider: 'aws', name: 'Amazon Web Services', origin: 'user-defined' }, false)],
      providers: [targetProviderGuidance('otc'), targetProviderGuidance('aws'), targetKeepGuidance('Skip this step', [])],
      regions: [targetOptionGuidance('otc', { kind: 'country', key: 'country:DE', label: 'Germany (DE)', regions: ['eu-de'], depth: 0 }), targetOptionGuidance('otc', { kind: 'region', key: 'region:eu-de', label: 'eu-de', region: 'eu-de', depth: 1 })],
    }),
  },
  'setup/branches/lz-live-steps.tsx': {
    selects: 1,
    lists: () => ({
      probeAsk: fromOptions(PROBE_ASK_OPTIONS),
      probeResult: fromOptions(PROBE_RESULT_OPTIONS),
      frameworks: [
        baselineFrameworkGuidance({ id: 'CLIENT_LZ_POLICY_BASELINE', folder: 'client_lz_policy_baseline', version: '1.0' }, true, 'otc-prod'),
        baselineFrameworkGuidance({ id: 'DORA', folder: 'dora', version: '2025', name: 'Digital Operational Resilience Act' }, false, 'otc-prod'),
      ],
    }),
  },
  'setup/branches/service.tsx': {
    selects: 1,
    lists: () => ({
      workspace: fromOptions(SERVICE_WORKSPACE_OPTIONS),
      intake: [
        intakeWorkbookGuidance({ file: 'intake.xlsx', path: 'wsp/inputs/intake/intake.xlsx', sheets: [], rows: 12, mapping: 'default' }, undefined),
        intakeActionGuidance('template', 'Skip this step'),
        intakeActionGuidance('reread', 'Skip this step'),
        intakeActionGuidance('keep', 'Skip this step'),
      ],
    }),
  },
  'setup/steps/ApplicationAppStep.tsx': {
    selects: 2,
    lists: () => ({
      apps: appListChoices(true).map((l) => appListGuidance(l, ['shop'])),
      noApps: appListChoices(false).map((l) => appListGuidance(l, [])),
      source: APP_SOURCE_CHOICES.map((c) => appSourceGuidance(c)),
    }),
  },
  'setup/steps/ApplicationSourceStep.tsx': {
    selects: 1, // #4490: the paged results list above 8 apps
    lists: () => ({
      source: [
        sourceAppGuidance({ app_id: 'shop', vcs_url: 'https://git.example.com/shop.git', host: 'git.example.com', outcome: 'ok', hint: '' }),
        ...SOURCE_ACTIONS.map((a) => SOURCE_ACTION_GUIDANCE[a]),
      ],
    }),
  },
  'setup/steps/ApplicationToolsStep.tsx': {
    selects: 0,
    lists: () => ({ tools: [...APPLICATION_TOOLS.map((tool) => toolGuidance({ tool, found: false })), ...TOOLS_ACTIONS.map((a) => TOOLS_ACTION_GUIDANCE[a])] }),
  },
  'setup/steps/LlmCandidatesStep.tsx': {
    selects: 2, // the connector and model pickers (#4254 run 9); the candidate list is StatusRows and PickerRows
    lists: () => ({
      candidates: [candidateGuidance({ connector: 'gw-one', model: 'model-a' }, CONNECTOR), candidateGuidance({ connector: 'gw-one', model: 'model-b' }, CONNECTOR)],
      connectors: [candidateConnectorGuidance(CONNECTOR), candidateConnectorGuidance({ ...CONNECTOR, id: 'local', name: 'Local runtime', credentialKey: undefined })],
      models: CONNECTOR.models.map((m) => candidateModelGuidance(CONNECTOR, m)),
    }),
  },
  'setup/steps/LlmSubjectStep.tsx': {
    selects: 1, // #4490: the paged list above 8 apps
    lists: () => ({ subject: [subjectGuidance({ appId: 'shop', latestRun: 'run-1' }, 1, 'Skip this step', undefined), subjectGuidance(undefined, 1, 'Skip this step', undefined)] }),
  },
  'tui/screens/wizard/steps/CredentialsStep.tsx': { selects: 1, lists: () => ({ failed: fromOptions(credentialFailOptions('HTTP 401', 'https://example.com/keys')) }) },
  'tui/screens/wizard/steps/InitStep.tsx': { selects: 1, lists: () => ({ existing: fromOptions(INIT_EXISTING_OPTIONS) }) },
  'tui/screens/wizard/steps/IntegrationsStep.tsx': {
    selects: 1,
    lists: () => ({
      playwrightWindows: fromOptions(playwrightOptions('win32')),
      playwrightLinux: fromOptions(playwrightOptions('linux')),
      mcpClients: Array.from({ length: MCP_CONTINUE_INDEX + 1 }, (_, i) => mcpClientGuidance(i, { details: [], registered: new Set([WIZARD_MCP_CLIENTS[1]!.id]), desktopInstalled: false })),
    }),
  },
  'tui/screens/wizard/steps/LlmSecondaryStep.tsx': { selects: 1, lists: () => ({ none: fromOptions(secondaryOptions(null)), set: fromOptions(secondaryOptions('openrouter')) }) },
  'tui/screens/wizard/steps/LlmStep.tsx': {
    selects: 5, // connector, gateway model, legacy model, the choice after a failed model test (#4500), the connector file update offer (#4491)
    lists: () => ({
      providers: fromOptions(providerOptions([])),
      gatewayModels: fromOptions([modelOption({ id: 'model-a' }, 'Gateway One'), modelOption({ id: 'model-b', notes: 'fast' }, 'Gateway One'), OTHER_MODEL_OPTION]),
      anthropic: fromOptions(legacyModelOptions('anthropic')),
      openai: fromOptions(legacyModelOptions('openai')),
      modelCheckFail: fromOptions(modelCheckFailOptions('vendor/model-a', 'model rejected by the platform')),
      connectorUpdate: fromOptions(connectorUpdateOptions({ file: 'anthropic.yaml', bundledReviewed: '2026-11-16', workspaceReviewed: '2026-08-05' })),
    }),
  },
  'tui/screens/wizard/steps/LzConnectionsStep.tsx': { selects: 1, lists: () => ({ step: LZ_CONNECTIONS_STEP_CHOICES.map((c) => LZ_CONNECTIONS_STEP_GUIDANCE[c.id]) }) },
  'tui/screens/wizard/steps/TestCodeStep.tsx': { selects: 1, lists: () => ({ fresh: fromOptions(testCodeOptions(undefined)), stored: fromOptions(testCodeOptions('exclude')) }) },
  'tui/screens/LzConnectionsScreen.tsx': {
    selects: 2, // the sub-step picker (#4257 run 8) and the menu; the cursor feeds the guidance of the highlighted row
    lists: () => ({
      menu: [...CONNECTION_ACTIONS.map((a) => LZ_CONNECTIONS_ACTION_GUIDANCE[a.id]), LZ_CONNECTIONS_ACTION_GUIDANCE.continue],
      provider: [lzProviderGuidance('otc', 'T Cloud Public', OTC_METHODS), lzProviderGuidance('aws', 'Amazon Web Services', [ALL_METHODS[2]!])],
      landingZone: (['add-scope', 'probe', 'remove'] as const).map((a) => lzPickLandingZoneGuidance(LZ, 'T Cloud Public', a)),
      kind: (['platform', 'application'] as const).map((k) => lzScopeKindGuidance(k)),
      auth: ALL_METHODS.map((m) => lzAuthMethodGuidance(m)),
      app: [lzAppLinkGuidance(undefined), lzAppLinkGuidance('payments')],
      migrate: [lzMigrateTargetGuidance({ lzId: 'aws-prod', scopeId: 'platform' }, 2), lzMigrateTargetGuidance({ lzId: 'aws-prod', scopeId: 'shop' }, 2)],
      remove: [lzRemoveTargetGuidance('otc-prod', undefined), lzRemoveTargetGuidance('otc-prod', 'payments')],
    }),
  },
};

/** G-05d: the offenders of one option list (empty when every option has its own entry). */
export function listOffenders(name: string, entries: ReadonlyArray<GuidanceEntry | undefined>): string[] {
  const out: string[] = [];
  if (entries.length === 0) out.push(`${name}: no options`);
  entries.forEach((e, i) => {
    if (!e) out.push(`${name}[${i}]: no guidance entry`);
    else if (!e.title.trim() || !e.what.trim()) out.push(`${name}[${i}]: guidance without a title or an explanation`);
  });
  if (entries.length > 1 && entries.every((e) => e && JSON.stringify(e) === JSON.stringify(entries[0]))) out.push(`${name}: one entry for every option`);
  return out;
}

describe('G-05 guidance per sub-step and per option in the Setup Wizard (#4230, Design 126 sections 4.2, 9.2 and 13.2)', () => {
  const files = wizardFiles();

  it('the rule fails on an option without an entry and on one static entry for a whole list', () => {
    expect(listOffenders('x', [{ title: 'A', what: 'a' }, undefined])).toEqual(['x[1]: no guidance entry']);
    expect(listOffenders('x', [{ title: 'A', what: 'a' }, { title: 'A', what: 'a' }])).toEqual(['x: one entry for every option']);
    expect(listOffenders('x', [{ title: 'A', what: '' }])).toEqual(['x[0]: guidance without a title or an explanation']);
    expect(listOffenders('x', [{ title: 'A', what: 'a' }, { title: 'B', what: 'b' }])).toEqual([]);
    expect(jsxElements('<SelectInput options={o} onCursorChange={(v) => f(v)} onSelect={go} />', 'SelectInput')[0]!.tag).toContain('onCursorChange');
  });

  it('G-05a every SetupStepFrame passes a guidance entry', () => {
    const missing = files.flatMap((f) => jsxElements(readFileSync(f, 'utf-8'), 'SetupStepFrame').filter((e) => !/\bguidance=/.test(e.tag)).map((e) => `${rel(f)}:${e.line}`));
    expect(missing).toEqual([]);
  });

  it('G-05b every SelectInput and MultiSelect passes onCursorChange (the box follows the cursor)', () => {
    const missing = files.flatMap((f) => {
      const text = readFileSync(f, 'utf-8');
      return [...jsxElements(text, 'SelectInput'), ...jsxElements(text, 'MultiSelect')].filter((e) => !/\bonCursorChange=/.test(e.tag)).map((e) => `${rel(f)}:${e.line}`);
    });
    expect(missing).toEqual([]);
  });

  it('G-05c every file with a picker is registered with its SelectInput count; no stale entry', () => {
    const found = new Map(files.map((f) => [rel(f), readFileSync(f, 'utf-8')] as const).filter(([r, t]) => hasPicker(t) && !(r in LIST_COMPONENTS)));
    const unregistered = [...found.keys()].filter((r) => !(r in PICKERS));
    expect(unregistered, 'a new picker needs its option lists in PICKERS').toEqual([]);
    const stale = Object.keys(PICKERS).filter((r) => !found.has(r));
    expect(stale, 'a registered file without a picker').toEqual([]);
    const drift = [...found.entries()].filter(([r, t]) => PICKERS[r] && selectCount(t) !== PICKERS[r]!.selects).map(([r, t]) => `${r}: ${selectCount(t)} pickers, registered ${PICKERS[r]!.selects}`);
    expect(drift, 'a picker added or removed; register its options').toEqual([]);
  });

  it('G-05d every registered option has its own guidance entry', () => {
    const offenders = Object.entries(PICKERS).flatMap(([file, p]) => Object.entries(p.lists()).flatMap(([name, entries]) => listOffenders(`${file} ${name}`, entries)));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The screen part (#4213)
// ---------------------------------------------------------------------------

const GUIDANCE_BOX = /\(Ctrl\+G for guidance\)|Ctrl\+G close guidance/;
const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

const screenTreeFiles = (): string[] => {
  const wizard = new Set(wizardFiles());
  return tuiFiles({ includeTuiKit: false }).filter((f) => f.endsWith('.tsx') && !wizard.has(f));
};

/** G-05g: the SelectInput and MultiSelect elements of a source text without onCursorChange (their lines). */
export function pickersWithoutCursor(text: string): number[] {
  return [...jsxElements(text, 'SelectInput'), ...jsxElements(text, 'MultiSelect')].filter((e) => !/\bonCursorChange=/.test(e.tag)).map((e) => e.line);
}

/** G-05h: the offenders of one captured option list (header rows of a grouped list excluded). */
export function capturedOffenders(name: string, list: CapturedList): string[] {
  return listOffenders(name, list.options.filter((o) => !o.header).map((o) => o.guidance));
}

describe('G-05 a guidance box on every screen and a guidance entry per option (#4213, Design 126 sections 9 and 13.2)', () => {
  captured.ws = fixtureWorkspace();
  afterAll(() => { if (captured.ws) rmSync(captured.ws, { recursive: true, force: true }); });
  const cases = screenCases(captured.ws);
  const premiumPresent = existsSync(join(REPO_ROOT, 'swao-premium', 'packages'));
  const seen = new Map<string, CapturedList>();

  it('the rules fail on a picker without onCursorChange and on an option list without entries', () => {
    expect(pickersWithoutCursor('<SelectInput options={o} onSelect={go} />\n<MultiSelect options={o} onCursorChange={f} onConfirm={go} />')).toEqual([1]);
    expect(capturedOffenders('x', { kind: 'SelectInput', label: 'x', options: [{ label: 'a', value: 'a' }] })).toEqual(['x[0]: no guidance entry']);
    expect(capturedOffenders('x', { kind: 'MultiSelect', label: 'x', options: [{ label: 'DE', header: true }, { label: 'a', guidance: { title: 'A', what: 'a' } }] })).toEqual([]);
  });

  it('G-05e every screen file has a render case or a documented exemption', () => {
    const covered = new Set([...cases.map((c) => c.file), ...Object.keys(SCREEN_EXEMPT)]);
    const files = tuiFiles({ includeTuiKit: false }).filter(isScreenFile).map(repoPath);
    expect(files.length).toBeGreaterThan(25);
    expect(files.filter((f) => !covered.has(f)), 'a new screen needs a case in helpers/screen-cases.tsx').toEqual([]);
    const missing = [...covered].filter((f) => !existsSync(join(REPO_ROOT, f)) && !(f.startsWith('swao-premium/') && !premiumPresent));
    expect(missing, 'a case or an exemption names a file that does not exist').toEqual([]);
  });

  for (const c of cases) {
    it(`G-05f ${c.name} renders a guidance box`, async () => {
      const element = await c.element();
      if (!element) return; // swao-premium absent (public tree)
      captured.lists.length = 0;
      const r = renderAt(element, 100, 60);
      await settle();
      const frames = [r.lastFrame()];
      for (const k of c.keys ?? []) { r.stdin.write(k); await settle(); frames.push(r.lastFrame()); }
      r.unmount();
      frames.forEach((f, i) => expect(f, `${c.name}, frame ${i}:\n${f}`).toMatch(GUIDANCE_BOX));
      for (const l of captured.lists) seen.set(`${c.name} ${l.kind} "${l.label}"`, l);
    });
  }

  it('G-05g every SelectInput and MultiSelect of a screen passes onCursorChange (strict)', () => {
    const missing = screenTreeFiles().map((f) => [repoPath(f), pickersWithoutCursor(readFileSync(f, 'utf-8'))] as const).filter(([, l]) => l.length > 0).map(([f, l]) => `${f}: lines ${l.join(', ')}`);
    expect(missing, 'a picker without onCursorChange').toEqual([]);
  });

  it('G-05h every option list on a screen has one guidance entry per option (strict)', () => {
    expect(seen.size).toBeGreaterThan(10);
    const offenders = [...seen.entries()].flatMap(([k, l]) => capturedOffenders(k, l));
    expect(offenders).toEqual([]);
  });
});
