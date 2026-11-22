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

// #4190 SET-01 / #4193 SET-04 (Design 125 section 5.3): the Service Portfolio
// Assessment branch: Service workspace (10), Intake input (20), Scoring
// inputs (30). Stores service_portfolio.intake and .mapping (section 5.7,
// read back by readServiceDefaults in setup/defaults.ts). Health check and
// Ready are added by the engine.
//
// Intake contents are client data: the steps show file names, sheet names,
// counts and header names only, never a cell value. Layout per section 9: no
// own title or step bar, one GuidanceBox, no CLI syntax, lines fitted to the
// header rule.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { PickerRow, SelectInput, StatusRow, detailLines, fitToWidth, pagedListWindow, statusLabelWidth, tone, useHeaderWidth, useListBudget, useOptionGuidance, type DetailLines, type GuidanceEntry, type GuidanceSection, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { SetupStepFrame } from '../setup-frame.js';
import { SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import { copyIntakeTemplate, INTAKE_TEMPLATE_FILE } from '@swao/module-service-assessment';
import { readServiceDefaults, readWorkspaceYml } from '../defaults.js';
import type { SetupBranchModule, SetupCheckItem, SetupHealthResult, SetupStepProps } from '../types.js';
import {
  checkScoringInputs,
  checkServiceIntake,
  checkServiceWorkspace,
  INTAKE_TEMPLATE_HINT,
  inspectIntakeFolder,
  inspectedIntakeRows,
  isServiceWorkspaceYml,
  serviceAppIds,
  SERVICE_INTAKE_FOLDER,
  setUpServiceWorkspace,
  workspaceRelative,
  writeServiceIntake,
  type IntakeFolderSummary,
  type IntakeParser,
  type IntakeWorkbookSummary,
} from './service-checks.js';
import { logSetupStepComplete } from '../step-events.js';

function logStep(step: string, message: string, context: Record<string, unknown>): void {
  logSetupStepComplete(step, message, context); // #4263: dropped when the wizard cancels the step
}

// #4254 TUI-10 (Design 126 sections 4.5, 6, 7.7 and 9): the three steps render
// through SetupStepFrame (title, the hint line of their input kind, one
// guidance box that follows the highlighted entry); colours come from the
// theme tokens; "Read the folder again" and the blank template are list
// entries (the letter keys R and T are gone, KeyName has no such letters).
// #4254 (run 9, Design 126 sections 6 and 8 rule 5): the check lines are
// central StatusRows (status word and colour from STATUS_MAP, the detail
// wrapped under its column, never cut); the workbook list and its entries are
// PickerRows on the shared paged-list window (#4348).
function CheckLines({ items, width }: { items: readonly SetupCheckItem[]; width: number }) {
  const labelWidth = statusLabelWidth(items.map((i) => i.label), width, { min: 8 });
  return (
    <Box flexDirection="column">
      {items.map((i) => (
        <StatusRow key={i.label} level={i.state} label={i.label} summary={i.detail ?? ''} labelWidth={labelWidth} />
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------- Service workspace (10)

const WORKSPACE_SECTIONS: readonly GuidanceSection[] = [
  { label: 'Intake folder', text: `${SERVICE_INTAKE_FOLDER} in the workspace: the intake workbook and an optional column map file go here.` },
  { label: 'Set up', text: 'Writes the service_portfolio block with the intake folder as the default intake location and creates the folder. With one workbook in it, the workbook is recorded as the intake.' },
];
const WORKSPACE_WHAT = 'A service workspace holds the service_portfolio block in the workspace .swao.yml and one app folder per imported service. The assessment imports the services from the intake workbook.';

/** #4230: the two entries of the Service Setup question, each with its guidance. */
export const SERVICE_WORKSPACE_OPTIONS: SelectOption[] = [
  { label: 'Set it up for the Service Portfolio Assessment', value: 'setup', guidance: { title: 'Set up the service workspace', what: WORKSPACE_WHAT, sections: WORKSPACE_SECTIONS } },
  { label: 'Skip this step', value: 'skip', guidance: { title: 'Skip this step', what: 'The workspace stays as it is; nothing is written. Service Setup can run again from Setup, Set up an assessment type.', sections: WORKSPACE_SECTIONS } },
];

export function ServiceWorkspaceStep({ ctx, onNext }: SetupStepProps) {
  const ws = ctx.workspaceRoot;
  const width = useHeaderWidth();
  const isService = useMemo(() => isServiceWorkspaceYml(ws), []);
  const [result, setResult] = useState<null | { recorded: string | null; folder: string; block: boolean }>(null);
  const { entry, onCursorChange } = useOptionGuidance({ title: 'Service workspace', what: WORKSPACE_WHAT, sections: WORKSPACE_SECTIONS });

  // #4341 (Design 126 sections 7.4 and 7.7): Esc belongs to the wizard (abort);
  // leaving the workspace as it is is the visible "Skip this step" entry.
  const skip = (): void => {
    logStep('service.workspace', 'Service workspace step kept', { service_workspace: false });
    onNext({ status: 'skipped', summary: 'Not set up as a service workspace' });
  };

  const setUp = (): void => {
    // #4225 (D-3): set the workspace up for the Service Portfolio Assessment
    // right away (setUpServiceWorkspace). #4262: the log names what was created.
    const { recorded, folder, block, created } = setUpServiceWorkspace(ws);
    logStep('service.workspace', 'Service workspace set up', { block_written: block, intake_recorded: recorded !== null, created });
    setResult({ recorded, folder, block });
  };

  useInput((_input, key) => {
    if (!key.return) return;
    if (isService) {
      logStep('service.workspace', 'Service workspace confirmed', { service_workspace: true });
      onNext({ status: 'kept', summary: 'Service workspace' });
      return;
    }
    if (result) {
      onNext(!result.block
        ? { status: 'skipped', summary: 'Could not write the service_portfolio block' }
        : result.recorded
          ? { status: 'done', summary: `Service workspace, intake ${result.recorded}` }
          : { status: 'done', summary: `Service workspace, intake folder ${result.folder}` });
    }
    // Otherwise the choice list below reads Enter.
  });

  const apps = isService ? serviceAppIds(ws).length : 0;
  const choosing = !isService && !result;
  return (
    <SetupStepFrame
      title="Service Setup"
      subtitle="The workspace settings of the Service Portfolio Assessment."
      kind={choosing ? 'picker' : 'confirm'}
      guidance={choosing ? entry : { title: 'Service workspace', what: WORKSPACE_WHAT, sections: WORKSPACE_SECTIONS }}
    >
      <Box flexDirection="column" width={width}>
        {isService ? (
          <>
            <Text {...tone('ok')}>This workspace is set up for the Service Portfolio Assessment.</Text>
            <CheckLines items={checkServiceWorkspace(ws)} width={width} />
            {apps === 0 && <Text {...tone('muted')}>{fitToWidth('The assessment imports the intake workbook as its first step.', width)}</Text>}
          </>
        ) : result ? (
          !result.block ? (
            <Text {...tone('warning')}>{fitToWidth('Could not write the service_portfolio block to the workspace .swao.yml; check the file and run Service Setup again.', width)}</Text>
          ) : result.recorded ? (
            <Text {...tone('ok')}>{fitToWidth(`Service workspace set up; intake workbook ${result.recorded} recorded.`, width)}</Text>
          ) : (
            <>
              <Text {...tone('ok')}>{fitToWidth(`Service workspace set up; intake folder: ${result.folder}`, width)}</Text>
              <Text>{fitToWidth('Put the intake workbook there, or copy the blank template in the next step.', width)}</Text>
            </>
          )
        ) : (
          <>
            <Text>{fitToWidth('This workspace has no service portfolio settings yet.', width)}</Text>
            <Box marginTop={1}>
              <SelectInput
                label="Set up this workspace?"
                options={SERVICE_WORKSPACE_OPTIONS}
                onCursorChange={onCursorChange}
                onSelect={(v) => (v === 'skip' ? skip() : setUp())}
                showKeyHints={false}
                visibleCount={SERVICE_WORKSPACE_OPTIONS.length}
              />
            </Box>
          </>
        )}
      </Box>
    </SetupStepFrame>
  );
}

// ---------------------------------------------------------------- Intake input (20)

export interface ServiceIntakeStepProps extends SetupStepProps {
  /** Injectable for tests; default: parseIntakeWorkbook. */
  parse?: IntakeParser;
  /** Injectable for tests; default: copyIntakeTemplate (the blank intake workbook template, #4225). */
  copyTemplate?: (workspaceRoot: string) => Promise<{ path: string; created: boolean }>;
}

function workbookLine(w: IntakeWorkbookSummary): string {
  return `${w.file}  ${workbookDetail(w)}`;
}

/** The counts of a workbook row (or why it is unreadable), the dim second column of the row. */
function workbookDetail(w: IntakeWorkbookSummary): string {
  if (w.error) return `unreadable: ${w.error}`;
  const recognised = w.sheets.reduce((n, s) => n + s.recognised.length, 0);
  const columns = w.sheets.reduce((n, s) => n + s.columns, 0);
  return `${w.rows} rows in ${w.sheets.length} sheet(s), ${recognised} of ${columns} columns recognised${w.mapping === 'custom' ? ' (column map)' : ''}`;
}

/**
 * #4213 (Design 126 section 8 rules 5 and 6): one workbook row: the file name on
 * the row and its counts beside it, wrapped under their column or under the name
 * (a two-line row), never cut with an ellipsis. Rows start with the two-column marker.
 */
function workbookRow(w: IntakeWorkbookSummary, recordedIntake: string | undefined, width: number): { name: string; detail: DetailLines; height: number } {
  const name = w.file;
  const detail = detailLines(`${workbookDetail(w)}${w.path === recordedIntake ? '  (recorded)' : ''}`, width, 2 + name.length, 2);
  return { name, detail, height: 1 + detail.rest.length };
}

const INTAKE_WHAT = `The intake workbook lists the services or servers of the portfolio. SWAO reads it from ${SERVICE_INTAKE_FOLDER}; only file names, sheet names, counts and column names are shown here.`;
const INTAKE_SECTIONS: readonly GuidanceSection[] = [
  { label: 'Recognised columns', text: 'Header names the intake parser maps to a field (App ID, App Name, Vendor, OS and others, English or German). Other columns are ignored.' },
  { label: 'Column map', text: 'A file whose name ends in column-map.yaml next to the workbook maps your own column layout. One valid file is used for every workbook.' },
  { label: 'Saved as', text: 'service_portfolio.intake and service_portfolio.mapping in the workspace .swao.yml; the Service Portfolio Assessment preselects them.' },
  { label: 'Template', text: `${INTAKE_TEMPLATE_HINT} SWAO copies a blank template with the recognised columns to ${SERVICE_INTAKE_FOLDER}/${INTAKE_TEMPLATE_FILE} on request.` },
];

type IntakeAction = 'template' | 'reread' | 'keep';

/** #4230: the guidance of one highlighted workbook (names and counts only, never a cell value). */
export function intakeWorkbookGuidance(w: IntakeWorkbookSummary, recordedIntake: string | undefined): GuidanceEntry {
  if (w.error) return { title: w.file, what: `The workbook cannot be read: ${w.error}. ${INTAKE_TEMPLATE_HINT}`, sections: INTAKE_SECTIONS };
  if (w.rows === 0) return { title: w.file, what: 'The workbook has no rows yet (the blank template not filled in); it is not recorded. Fill in one row per service or server, save it, then choose Read the folder again.', sections: INTAKE_SECTIONS };
  return {
    title: w.file,
    what: `${w.path === recordedIntake ? 'The recorded intake; choosing it keeps it.' : 'Choosing it records it as the intake of the Service Portfolio Assessment.'} ${workbookLine(w)}.`,
    sections: INTAKE_SECTIONS,
  };
}

/** #4230: the guidance of the action entries of the intake list. */
export function intakeActionGuidance(a: IntakeAction, keepLabel: string): GuidanceEntry {
  switch (a) {
    case 'template': return { title: 'Copy the blank intake template', what: `Copies a blank workbook with the recognised columns to ${SERVICE_INTAKE_FOLDER}/${INTAKE_TEMPLATE_FILE}; an existing file is kept as it is.`, sections: INTAKE_SECTIONS };
    case 'reread': return { title: 'Read the folder again', what: `Reads ${SERVICE_INTAKE_FOLDER} again, for example after copying or saving a workbook there.`, sections: INTAKE_SECTIONS };
    case 'keep': return { title: keepLabel, what: keepLabel.startsWith('Keep') ? 'Continues with the recorded intake; nothing is written.' : 'Continues without an intake; the Service Portfolio Assessment asks for it when it starts.', sections: INTAKE_SECTIONS };
    default: {
      const never: never = a;
      throw new Error(`unknown intake action: ${String(never)}`);
    }
  }
}

export function ServiceIntakeStep({ ctx, onNext, parse, copyTemplate = copyIntakeTemplate }: ServiceIntakeStepProps) {
  const ws = ctx.workspaceRoot;
  const width = useHeaderWidth();
  // #4348: the workbook list takes the rows the frame leaves (shared paged-list window).
  const listRef = useRef<DOMElement>(null);
  const listBudget = useListBudget(listRef);
  const [summary, setSummary] = useState<IntakeFolderSummary | null>(null);
  const [reads, setReads] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [saved, setSaved] = useState<null | { ok: boolean; intake: string }>(null);
  const [template, setTemplate] = useState<null | { path: string; created: boolean } | { error: string }>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const recorded = useMemo(() => readServiceDefaults(ws), [saved]);

  useEffect(() => {
    let live = true;
    setSummary(null);
    inspectIntakeFolder(ws, parse).then((s) => {
      if (!live) return;
      setSummary(s);
      const at = s.workbooks.findIndex((w) => w.path === recorded.intake);
      setCursor(at >= 0 ? at : 0);
    }, () => { if (live) setSummary({ folder: SERVICE_INTAKE_FOLDER, workbooks: [], mappings: [] }); });
    return () => { live = false; };
  }, [reads]);

  const usable = summary?.workbooks ?? [];
  const validMaps = (summary?.mappings ?? []).filter((m) => !m.error);

  const keep = (): void => {
    logStep('service.intake', 'Intake kept', { intake_recorded: !!recorded.intake });
    onNext(recorded.intake ? { status: 'kept', summary: `Intake: ${recorded.intake}` } : { status: 'skipped', summary: 'No intake workbook recorded' });
  };

  // #4225 (D-3): copy the blank intake workbook template into the intake folder.
  const offerTemplate = (): void => {
    copyTemplate(ws).then((r) => {
      const path = workspaceRelative(ws, r.path);
      logStep('service.intake', r.created ? 'Intake template copied' : 'Intake template already there', { template: path, created: r.created });
      setTemplate({ path, created: r.created });
      setReads((n) => n + 1);
    }, (e: unknown) => setTemplate({ error: e instanceof Error ? e.message : String(e) }));
  };

  // #4341 (Design 126 sections 7.4 and 7.7): Esc belongs to the wizard (abort);
  // keeping the current intake is the last visible list entry. Without a
  // workbook the list offers the blank template first; "Read the folder
  // again" replaces the letter key R.
  const actions: IntakeAction[] = usable.length === 0 && !template ? ['template', 'reread', 'keep'] : ['reread', 'keep'];
  const rowCount = (usable.length > 0 ? usable.length : 0) + actions.length;
  const at = Math.min(cursor, rowCount - 1);
  const actionAt = at - (usable.length > 0 ? usable.length : 0);
  const keepLabel = recorded.intake ? 'Keep the current intake and continue' : 'Skip this step';

  useInput((_input, key) => {
    if (saved) {
      if (key.return) onNext(saved.ok ? { status: 'done', summary: `Intake: ${saved.intake}` } : { status: 'skipped' });
      return;
    }
    if (!summary) return;
    if (key.upArrow) { setEmpty(null); setCursor((at - 1 + rowCount) % rowCount); return; }
    if (key.downArrow) { setEmpty(null); setCursor((at + 1) % rowCount); return; }
    if (!key.return) return;
    if (actionAt >= 0) {
      const action = actions[actionAt];
      if (action === 'template') { offerTemplate(); return; }
      if (action === 'reread') { setEmpty(null); setReads((n) => n + 1); return; }
      keep();
      return;
    }
    const chosen = usable[at];
    if (!chosen) return;
    if (chosen.error) return; // an unreadable workbook cannot be recorded
    if (chosen.rows === 0) {
      // #4225: an empty workbook (the blank template not filled in yet) is not recorded.
      setEmpty(chosen.path);
      return;
    }
    const mapping = validMaps.length === 1 ? validMaps[0]!.path : undefined;
    if (chosen.path === recorded.intake && (mapping === undefined || mapping === recorded.mapping)) {
      logStep('service.intake', 'Intake kept', { intake_recorded: true, rows: chosen.rows });
      onNext({ status: 'kept', summary: `Intake: ${chosen.path} (${chosen.rows} rows)` });
      return;
    }
    const ok = writeServiceIntake(ws, { intake: chosen.path, ...(mapping ? { mapping } : {}) });
    logStep('service.intake', 'Intake recorded', { written: ok, rows: chosen.rows, sheets: chosen.sheets.length, mapping: mapping ? 'custom' : 'default' });
    setSaved({ ok, intake: chosen.path });
  });

  const stepEntry: GuidanceEntry = { title: 'Intake input', what: INTAKE_WHAT, sections: INTAKE_SECTIONS };
  const frame = (kind: 'picker' | 'confirm', guidance: GuidanceEntry, body: JSX.Element): JSX.Element => (
    <SetupStepFrame title="Intake Input" subtitle="The intake workbook of the Service Portfolio Assessment." kind={kind} guidance={guidance}>
      <Box flexDirection="column" width={width}>{body}</Box>
    </SetupStepFrame>
  );

  if (saved) {
    return frame('confirm', stepEntry, saved.ok
      ? <Text {...tone('ok')}>{fitToWidth(`Intake workbook recorded: ${saved.intake}`, width)}</Text>
      : <Text {...tone('warning')}>{fitToWidth('Could not write the workspace .swao.yml; the intake was not recorded.', width)}</Text>);
  }

  if (!summary) {
    return frame('picker', stepEntry, <Text {...tone('progressRunning')} wrap="wrap">{`Reading the intake folder ${SERVICE_INTAKE_FOLDER}; the workbooks are listed when it is read.`}</Text>);
  }

  const rows = usable.map((w) => workbookRow(w, recorded.intake, width));
  const win = pagedListWindow(rows.map((r) => r.height), Math.min(at, usable.length - 1), listBudget);
  const current = actionAt < 0 ? usable[at] : undefined;
  const guidance = current ? intakeWorkbookGuidance(current, recorded.intake) : intakeActionGuidance(actions[Math.max(0, actionAt)] ?? 'keep', keepLabel);
  return frame('picker', guidance, (
    <>
      <Text>{fitToWidth(`Intake folder: ${summary.folder}`, width)}</Text>
      {recorded.intake && <Text {...tone('muted')}>{fitToWidth(`Recorded now: ${recorded.intake}${recorded.mapping ? `, column map ${recorded.mapping}` : ''}`, width)}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {usable.length === 0 && (
          <>
            <StatusRow level="waiting" label="Intake" summary="No intake workbook in the folder yet." />
            <Text wrap="wrap">{INTAKE_TEMPLATE_HINT}</Text>
          </>
        )}
        {template && ('error' in template
          ? <Text {...tone('warning')}>{fitToWidth(`Could not copy the template: ${template.error}`, width)}</Text>
          : (
            <>
              <Text {...tone('ok')}>{fitToWidth(template.created ? `Blank intake template copied to ${template.path}` : `The template is already there: ${template.path} (kept as it is)`, width)}</Text>
              <Text>{fitToWidth('Fill in one row per service or server, save it, then choose Read the folder again.', width)}</Text>
            </>
          ))}
        {empty && <StatusRow level="waiting" label="Workbook" summary={`${empty} has no rows yet; fill it in, save it, then read the folder again.`} />}
        <Box ref={listRef} flexDirection="column">
          {win.above > 0 && <Text {...tone('muted')}>{`  ↑ ${win.above} more`}</Text>}
          {usable.slice(win.start, win.end).map((w, i) => {
            const idx = win.start + i;
            const row = rows[idx]!;
            const detailTone = w.error ? 'error' : 'muted';
            return (
              <Box key={w.file} flexDirection="column">
                <PickerRow selected={idx === at} indent={false} wrap="wrap">
                  <Text {...tone(idx === at ? 'selection' : w.error ? 'error' : 'text')}>{row.name}</Text>
                  {row.detail.first !== '' && <Text {...tone(detailTone)}>{`  ${row.detail.first}`}</Text>}
                </PickerRow>
                {row.detail.rest.map((l, li) => <Text key={li} {...tone(detailTone)}>{`${' '.repeat(row.detail.restIndent)}${l}`}</Text>)}
              </Box>
            );
          })}
          {win.below > 0 && <Text {...tone('muted')}>{`  ↓ ${win.below} more`}</Text>}
        </Box>
        {actions.map((a, i) => {
          const selected = actionAt === i;
          const label = a === 'template' ? `Copy the blank intake template to ${SERVICE_INTAKE_FOLDER}/${INTAKE_TEMPLATE_FILE}` : a === 'reread' ? 'Read the folder again' : keepLabel;
          return (
            // #4213: an action label wraps, it is never cut.
            <PickerRow key={a} selected={selected} indent={false} wrap="wrap">
              <Text {...tone(selected ? 'selection' : 'text')}>{label}</Text>
            </PickerRow>
          );
        })}
      </Box>
      {current && !current.error && current.sheets.map((s) => (
        <Box key={s.name} marginLeft={4}>
          <Text {...tone('muted')} wrap="wrap">{`${s.name}: ${s.rows} rows; recognised: ${s.recognised.length > 0 ? s.recognised.join(', ') : 'none'}`}</Text>
        </Box>
      ))}
      {current?.error && <Text {...tone('warning')} wrap="wrap">{INTAKE_TEMPLATE_HINT}</Text>}
      {summary.mappings.map((m) => (
        <Text key={m.file} {...tone(m.error ? 'error' : 'text')}>
          {fitToWidth(`  Column map ${m.file}: ${m.error ? `invalid, ${m.error}` : validMaps.length === 1 ? 'valid, used' : 'valid, not used (more than one map)'}`, width)}
        </Text>
      ))}
    </>
  ));
}

// ---------------------------------------------------------------- Scoring inputs (30)

export interface ServiceScoringStepProps extends SetupStepProps {
  /** Injectable clock for tests. */
  now?: Date;
}

/** Enter goes on (the step checks, nothing to confirm); Left arrow back; Esc aborts. */
const SCORING_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

export function ServiceScoringStep({ ctx, onNext, now }: ServiceScoringStepProps) {
  const width = useHeaderWidth();
  const items = useMemo(() => checkScoringInputs(ctx.workspaceRoot, now ?? new Date()), []);

  useInput((_input, key) => {
    // #4341: Enter continues; Esc belongs to the wizard (abort).
    if (key.return) {
      const attention = items.filter((i) => i.state === 'warn' || i.state === 'missing').length;
      logStep('service.scoring', 'Scoring inputs checked', { attention });
      onNext({ status: 'kept', summary: attention > 0 ? `Scoring inputs: ${attention} need attention` : 'Scoring inputs present' });
    }
  });

  return (
    <SetupStepFrame
      title="Scoring Inputs"
      subtitle="APM weights, vendor catalogue and research cache."
      kind="confirm"
      keys={SCORING_KEYS}
      guidance={{
        title: 'Scoring inputs',
        what: 'The portfolio score combines the SWAO_APM domain weights, the vendor catalogue that classifies each service, and the research cache (vulnerabilities and end of life).',
        sections: [
          { label: 'APM weights', text: 'domain_weights in the SWAO_APM framework-meta.yaml; a workspace copy under wsp/inputs/catalogs/community wins over the bundled one. The eleven weights sum to 100.' },
          { label: 'Vendor catalogue', text: 'Built-in INFRA-CAT files, plus optional workspace files in wsp/inputs/catalogs/infra-cat that add or replace categories.' },
          { label: 'Research cache', text: 'Research results per service app; older than 30 days is flagged. The Service Portfolio Assessment refreshes them.' },
        ],
      }}
    >
      <Box flexDirection="column" width={width}>
        <Text>Inputs the scoring uses:</Text>
        <CheckLines items={items} width={width} />
      </Box>
    </SetupStepFrame>
  );
}

// ---------------------------------------------------------------- Ready

/**
 * Ready lines (Design 125 section 5.3): services found in the intake and whether a run can start.
 * #4295: before the first import the intake is the next step, not a failure:
 * the Intake workbook line names the rows found (when the Intake Input step
 * read the workbook in this session), an Import line says the Service
 * Portfolio Assessment imports it at its first run; the service_workspace
 * probe is info before the import (@swao/module-health-check service-probes.ts)
 * and fails only when the recorded workbook cannot be imported.
 */
export function serviceReadySummary(workspaceRoot: string, health: SetupHealthResult | undefined): SetupCheckItem[] {
  const apps = serviceAppIds(workspaceRoot).length;
  const recorded = readServiceDefaults(workspaceRoot).intake;
  const rows = apps === 0 && recorded ? inspectedIntakeRows(workspaceRoot, recorded) : null;
  const items: SetupCheckItem[] = [...checkServiceWorkspace(workspaceRoot), ...checkServiceIntake(workspaceRoot)].map((i) =>
    (i.label === 'Intake workbook' && i.state === 'ok' && rows !== null ? { ...i, detail: `${i.detail}, ${rows} row(s) found` } : i));
  const sp = readWorkspaceYml(workspaceRoot)['service_portfolio'];
  const rowCount = sp && typeof sp === 'object' ? (sp as Record<string, unknown>)['row_count'] : undefined;
  const intakeOk = items.find((i) => i.label === 'Intake workbook')?.state === 'ok';
  if (apps > 0 && typeof rowCount === 'number') {
    items.push({ label: 'Services', state: 'ok', detail: `${rowCount} rows in the last import, ${apps} service app(s)` });
  } else if (apps === 0) {
    items.push({ label: 'Import', state: 'info', detail: intakeOk ? 'at the first Service Portfolio Assessment (Run Assessment, Service Portfolio Assessment)' : 'after the intake workbook is recorded', short: intakeOk ? 'at the first assessment run' : 'after the intake workbook is recorded' });
  } else {
    items.push({ label: 'Services', state: 'ok', detail: `${apps} service app(s)` });
  }
  if (health) {
    items.push(health.failCount > 0
      ? { label: 'Health check', state: 'missing', detail: `failed: ${health.failedProbes.join(', ')}` }
      : { label: 'Health check', state: 'ok', detail: health.warnCount > 0 ? `passed with warnings: ${health.warnedProbes.join(', ')}` : 'passed' });
  }
  // #4295: service_workspace no longer fails before the first import; a failure now is a broken
  // state (recorded workbook unreadable or without rows), so every failed probe blocks.
  const blocking = health?.failedProbes ?? [];
  items.push(intakeOk && blocking.length === 0
    ? { label: 'Run', state: 'ok', detail: 'a Service Portfolio Assessment can start' }
    : { label: 'Run', state: 'info', detail: intakeOk ? 'fix the failed checks first' : 'starts once the intake workbook is recorded' });
  return items;
}

export const serviceBranch: SetupBranchModule = {
  branch: {
    type: 'service',
    label: SETUP_ASSESSMENT_TYPE_LABELS.service,
    description: 'Service workspace, intake workbook and scoring inputs',
    minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER.service,
    readySummary: (ws, health) => serviceReadySummary(ws, health),
  },
  steps: [
    { id: 'service.workspace', label: 'Service Setup', assessmentType: 'service', order: 10, guidance: 'Is the workspace a service workspace; set it up if not.', component: ServiceWorkspaceStep, check: (ws) => checkServiceWorkspace(ws) },
    { id: 'service.intake', label: 'Intake Input', assessmentType: 'service', order: 20, guidance: 'The intake workbook and optional column map in the intake folder.', component: ServiceIntakeStep, check: (ws) => checkServiceIntake(ws) },
    { id: 'service.scoring', label: 'Scoring Inputs', assessmentType: 'service', order: 30, guidance: 'APM weights, vendor catalogue and research cache.', component: ServiceScoringStep, check: (ws) => checkScoringInputs(ws) },
  ],
};
