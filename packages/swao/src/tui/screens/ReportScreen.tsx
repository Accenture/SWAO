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

// #4257 (TUI-13, Design 126 sections 3, 4, 6, 7 and 10): on ScreenLayout. The
// header subtitle is "Generate Report" (the run type goes to the step title);
// the app, format and view pickers are the central SelectInput (bounded, the
// description in the second column, one guidance entry per option); the PDF
// gate is the LicenseGate content with LICENSE_GATE_KEYS; the written files
// are full DetailRow paths (drive and file name kept), the output goes through
// RunOutput, the results and notes are StatusRows; keys per phase through
// KeyHints, one Esc owner per phase; the CLI only in the guidance `cli` field.

import { useMemo, useState, useEffect, useRef } from 'react';
import { useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  DetailRow, KEY_HINTS, LICENSE_GATE_KEYS, LicenseGate, RunContextPicker, RunOutput, ScreenLayout, SelectInput,
  StatusRow, TextInput, assessedAppOptions, guidanceOwnsKey, isAllowed, licenseGateGuidance, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type SelectOption, type SelectedRunContext,
} from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { LicenseGuard } from '../../license/license-guard.js';
import type { LicenseState } from '../../license/license-guard.js';
import { reportPathFromLine } from '../../commands/report-written-line.js';
import { useScreenHeader } from '../components/screen-header.js';

// #2576 / #4241: child processes start through the central self-spawn helper
// (selfSpawnCommand): the snapshot path is never passed in the binary.

export type ReportPhase = 'input-app' | 'pick-run-context' | 'non-app-redirect' | 'input-format' | 'pdf-locked' | 'input-view' | 'running' | 'done';

function getAvailableTypes(wspDir: string): string[] {
  if (!existsSync(wspDir)) return [];
  const files = readdirSync(wspDir);
  return files
    .map(f => /^latest-(.+)\.txt$/.exec(f)?.[1])
    .filter((t): t is string => t !== undefined);
}

const PICK_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];

/** The keys per phase (Design 126 section 7.9). */
export function reportKeys(phase: ReportPhase, appPicker: boolean): readonly KeyHint[] {
  switch (phase) {
    case 'input-app': return appPicker ? PICK_KEYS : [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
    case 'pick-run-context':
    case 'input-format':
    case 'input-view': return PICK_KEYS;
    case 'non-app-redirect': return [{ key: 'Esc', verb: 'back' }];
    case 'pdf-locked': return LICENSE_GATE_KEYS;
    case 'running': return KEY_HINTS.run;
    case 'done': return [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
    default: {
      const never: never = phase;
      return never;
    }
  }
}

const VIEW_OPTIONS: SelectOption[] = [
  { label: 'All views', value: 'all', detail: 'one file per stakeholder audience', guidance: { title: 'All views', what: 'Generates every stakeholder report in one step.' } },
  { label: 'Business Owner', value: 'exec', detail: 'executive summary', guidance: { title: 'Business Owner', what: 'C-suite: verdicts and recommendations.' } },
  { label: 'GRC / Compliance Officer', value: 'compliance', detail: 'compliance and data protection', guidance: { title: 'GRC / Compliance Officer', what: 'DPO and CISO: control outcomes and gaps.' } },
  { label: 'FinOps Lead', value: 'finops', detail: 'FinOps and cost analysis', guidance: { title: 'FinOps Lead', what: 'Cost drivers and FinOps findings.' } },
  { label: 'Migration / Programme Manager', value: 'migration-manager', detail: 'migration plan', guidance: { title: 'Migration / Programme Manager', what: 'Migration waves, effort and blockers.' } },
  { label: 'Application Architect', value: 'technical', detail: 'full technical report', guidance: { title: 'Application Architect', what: 'Engineering: full pass-by-pass signals.' } },
  { label: 'Auditor', value: 'auditor', detail: 'traceability and structured payload', guidance: { title: 'Auditor', what: 'Regulator: structured AuditorReport payload (Enterprise).' } },
];

/** The format rows; the PDF row names the tier when the licence lacks it (#2578). */
export function reportFormatOptions(pdfAllowed: boolean, assessmentType: string): SelectOption[] {
  return [
    { label: 'all', value: 'all', detail: pdfAllowed ? 'every format in one step' : 'every format in one step, pdf skipped below Consultant', guidance: { title: 'all', what: 'Generates text, yaml and json in one step, and pdf when the licence allows it.' } },
    { label: 'text', value: 'text', detail: 'human-readable summary', guidance: { title: 'text', what: assessmentType === 'application' ? 'Five stakeholder views (exec, compliance, migration-manager, finops, technical).' : 'Human-readable summary.' } },
    { label: 'yaml', value: 'yaml', detail: 'one machine-readable auditor.yaml', guidance: { title: 'yaml', what: 'Machine-readable: one auditor file only (not the audience views), for pipelines and BI.' } },
    { label: 'json', value: 'json', detail: 'one machine-readable auditor.json', guidance: { title: 'json', what: 'Machine-readable: one auditor file only (not the audience views), for pipelines and BI.' } },
    {
      label: 'pdf',
      value: 'pdf',
      detail: pdfAllowed ? 'print-quality PDF with a branded header' : 'print-quality PDF, needs a Consultant licence',
      guidance: { title: 'pdf', what: pdfAllowed ? 'Branded PDF for client handover.' : 'Branded PDF; requires a Consultant licence.' },
    },
  ];
}

const REPORT_GUIDANCE: GuidanceEntry = {
  title: 'Report generation',
  what: 'Generates stakeholder reports from the latest assessment of an app.',
  cli: 'swao report --app <id> --format <format>',
};

const RUN_CONTEXT_GUIDANCE: GuidanceEntry = {
  title: 'Select assessment run',
  what: 'Several assessment types were found for this app. Select the run whose data the report should use.',
  sections: [
    { label: 'Application', text: 'Source-code and LLM-pass based analysis' },
    { label: 'Landing Zone', text: 'CSP service catalogue fit and gap analysis' },
  ],
  cli: 'swao report --app <id> --type <type>',
};

/** The guidance of the finished run. */
export function reportDoneGuidance(assessmentType: string, ok: boolean): GuidanceEntry {
  if (!ok) {
    return {
      title: 'Generate Report, warnings',
      what: 'One or more report formats completed with errors. Check the output.',
      sections: [
        { label: 'Common cause', text: 'No assessment run found for this app. Run an assessment first.' },
        { label: 'Tier error', text: 'PDF requires a Consultant licence. Use text, yaml or json at Community tier.' },
      ],
      cli: 'swao assess --app <id>',
    };
  }
  return {
    title: 'Report generated',
    what: assessmentType === 'landing-zone-catalog'
      ? 'Landing Zone report written to the app wsp/reports-lz/ folder.'
      : assessmentType === 'llm'
        ? 'LLM Assessment report written to the app wsp/reports-llm/ folder.'
        : 'Report files written to the app wsp/reports-app/ folder.',
    cli: 'swao report --app <id> --format <format>',
  };
}

/** The step title of a phase; the run type of the app goes here, not into the header. */
function stepTitle(phase: ReportPhase, assessmentType: string): { title: string; subtitle?: string } {
  const kind = assessmentType === 'landing-zone-catalog' ? 'Landing Zone Assessment'
    : assessmentType === 'llm' ? 'LLM Assessment' : 'Application Assessment';
  switch (phase) {
    case 'input-app': return { title: 'Select application', subtitle: 'Stakeholder reports from the latest assessment of an app.' };
    case 'pick-run-context': return { title: 'Select assessment run' };
    case 'non-app-redirect': return { title: 'Report not available for this run type' };
    case 'input-format': return { title: 'Output format', subtitle: kind };
    case 'pdf-locked': return { title: 'PDF report', subtitle: 'Consultant licence required' };
    case 'input-view': return { title: 'Report view', subtitle: kind };
    case 'running': return { title: 'Generating the report', subtitle: kind };
    case 'done': return { title: 'Report', subtitle: kind };
    default: {
      const never: never = phase;
      return never;
    }
  }
}

interface ReportScreenProps {
  onBack: () => void;
  onOpenLicense?: () => void;
}

export function ReportScreen({ onBack, onOpenLicense }: ReportScreenProps) {
  const workspace = findWorkspace(process.cwd());
  const header = useScreenHeader('Generate Report');

  // Load licence state for the per-format gate (M18 #0277 follow-up).
  // PDF format is Consultant-tier-gated; other formats are Community.
  // Licence load failure surfaces in the header's status line; the
  // per-format gate uses the resolved state. Falling back to Community
  // here keeps the rest of the screen usable for text/yaml/json
  // formats even if the licence file is corrupt.
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
  const pdfAllowed = isAllowed(licenseState, 'consultant');
  // #2337: Auditor view depends on @swao/module-challenge (Enterprise-only).
  // Filter it from the per-view picker for Community and Consultant tiers.
  const enterpriseAllowed = isAllowed(licenseState, 'enterprise');
  const effectiveViewOptions = enterpriseAllowed
    ? VIEW_OPTIONS
    : VIEW_OPTIONS.filter((o) => o.value !== 'auditor');

  const [assessmentType, setAssessmentType] = useState('application');
  const formatOptions = reportFormatOptions(pdfAllowed, assessmentType);

  // Apps that have been assessed (app, LZ, or LLM run present).
  const assessedApps: string[] = useMemo(() => (workspace && existsSync(join(workspace, 'apps'))
    ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
        .filter(d => d.isDirectory() && (
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'latest.txt')) ||
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'latest-landing-zone-catalog.txt')) ||
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'run-manifest.json'))
        ))
        .map(d => d.name)
    : []), [workspace]);
  // #4213 (gate G-05h): one guidance entry per app: its runs and what the report reads.
  const appOptions: SelectOption[] = useMemo(() => (workspace ? assessedAppOptions(workspace, assessedApps, 'Generates the stakeholder reports from the latest assessment run of this app.', REPORT_GUIDANCE.cli) : []), [workspace, assessedApps]);

  const [phase, setPhase]             = useState<ReportPhase>('input-app');
  const [app, setApp]                 = useState('');
  const [format, setFormat]           = useState('text');
  const [view, setView]               = useState('all');
  const [lines, setLines]             = useState<string[]>([]);
  const [code, setCode]               = useState<number | null>(null);
  const [reportFiles, setReportFiles] = useState<string[]>([]);
  const [runCtx, setRunCtx]           = useState<SelectedRunContext | null>(null);
  const guidanceOpenRef               = useRef(false);
  const backRef                       = useRef(false);
  const formatGuidance = useOptionGuidance({ title: 'Output format', what: 'Choose the format for your audience.', cli: 'swao report --app <id> --format <format>' });
  const appGuidance = useOptionGuidance(REPORT_GUIDANCE);
  const viewGuidance = useOptionGuidance({ title: 'Report view', what: 'Select the stakeholder audience. All views emits one file per audience.', cli: 'swao report --app <id> --view <view>' });

  const done = phase === 'done';

  const handleAppSelect = (selectedApp: string) => {
    setApp(selectedApp);
    const wspDir = workspace ? join(workspace, 'apps', selectedApp, 'wsp') : '';
    const types = wspDir ? getAvailableTypes(wspDir) : [];
    if (types.length > 1) {
      setPhase('pick-run-context');
    } else {
      // Single type: set it so the running phase knows which CLI args to use
      const singleType = types[0] ?? 'application';
      setAssessmentType(singleType);
      if (singleType === 'application' || singleType === 'landing-zone-catalog' || singleType === 'llm') {
        setPhase('input-format');
      } else {
        setPhase('non-app-redirect');
      }
    }
  };

  const handleRunCtxSelect = (ctx: SelectedRunContext) => {
    setRunCtx(ctx);
    setAssessmentType(ctx.assessmentType);
    if (ctx.assessmentType === 'application' || ctx.assessmentType === 'landing-zone-catalog' || ctx.assessmentType === 'llm') {
      setPhase('input-format');
    } else {
      setPhase('non-app-redirect');
    }
  };

  useEffect(() => {
    if (phase !== 'running') return;

    setReportFiles([]);
    setLines([]);

    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      // The written files show as path rows; every other line (errors,
      // warnings, info) goes to the output.
      const out: string[] = [];
      const paths: string[] = [];
      for (const l of text.split('\n')) {
        if (!l) continue;
        const p = reportPathFromLine(l);
        if (p) paths.push(p); else out.push(l);
      }
      if (out.length > 0) setLines(prev => [...prev, ...out]);
      if (paths.length > 0) setReportFiles(prev => [...prev, ...paths]);
    };

    // Build CLI args for a given format string (used by both single and multi paths).
    const buildArgs = (fmt: string): string[] => {
      const args = ['report', '--app', app, '--format', fmt];
      if (assessmentType === 'llm') {
        args.push('--type', 'llm');
      } else if (assessmentType === 'landing-zone-catalog') {
        args.push('--type', 'landing-zone-catalog');
      } else if (fmt === 'yaml' || fmt === 'json') {
        // #2336: yaml/json always uses auditor view (the only view-differentiated payload).
        args.push('--view', 'auditor');
      } else if (view === 'all') {
        args.push('--all-views');
      } else {
        args.push('--view', view);
      }
      return args;
    };

    // #2553: 'all' format = text + yaml + json in sequence via async loop.
    // #2619: include pdf in 'all' run when the licence allows it (Consultant+).
    const formatsToRun = format === 'all'
      ? [...['text', 'yaml', 'json'], ...(pdfAllowed ? ['pdf'] : [])]
      : [format];

    if (formatsToRun.length === 1) {
      const selfCmd = selfSpawnCommand(buildArgs(formatsToRun[0] ?? format));
      const child = spawn(selfCmd.command, selfCmd.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: selfCmd.env,
        cwd: workspace ?? undefined,
      });
      child.stdout.on('data', push);
      child.stderr.on('data', push);
      child.on('close', (exitCode) => { setCode(exitCode); setPhase('done'); });
      return () => { child.kill(); };
    }

    // Multi-format path: run each format in sequence, collect all output paths.
    let cancelled = false;
    let current: ReturnType<typeof spawn> | null = null;
    void (async () => {
      let lastCode: number | null = 0;
      for (const fmt of formatsToRun) {
        if (cancelled) break;
        lastCode = await new Promise<number | null>((resolve) => {
          const selfCmd = selfSpawnCommand(buildArgs(fmt));
          const child = spawn(selfCmd.command, selfCmd.args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: selfCmd.env,
            cwd: workspace ?? undefined,
          });
          current = child;
          child.stdout.on('data', push);
          child.stderr.on('data', push);
          child.on('close', resolve);
        });
      }
      if (!cancelled) { setCode(lastCode); setPhase('done'); }
    })();
    return () => { cancelled = true; (current as ReturnType<typeof spawn> | null)?.kill(); };
  }, [phase]);

  const leave = (): void => {
    if (backRef.current) return;
    backRef.current = true;
    onBack();
  };

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    switch (phase) {
      // RunContextPicker and LicenseGate own their Esc (one Esc owner per phase).
      case 'pick-run-context':
      case 'pdf-locked':
        return;
      case 'done':
        if (key.return || key.escape) leave();
        return;
      default:
        // Q-09: Esc cancels a running report at once (the unmount stops the child).
        if (key.escape) leave();
    }
  });

  const handleFormatSelect = (v: string) => {
    setFormat(v);
    // PDF gate (M18 #0277 follow-up): if Community user picks PDF, show the
    // locked panel inline instead of letting the CLI raise the licence error.
    if (v === 'pdf' && !pdfAllowed) {
      setPhase('pdf-locked');
      return;
    }
    if (assessmentType === 'landing-zone-catalog' || assessmentType === 'llm') {
      // LZ and LLM reports: no view selection, single comprehensive output
      setPhase('running');
      return;
    }
    if (v === 'all') {
      // #2553: generate text + yaml + json in one step; no view selection needed
      setView('all');
      setPhase('running');
      return;
    }
    if (v === 'yaml' || v === 'json') {
      // #2408: JSON/YAML always emits the AuditorReport schema; skip the view picker.
      setView('auditor');
      setPhase('running');
      return;
    }
    setPhase('input-view');
  };

  const handleViewSelect = (v: string) => {
    setView(v);
    setPhase('running');
  };

  const ok = done && code === 0;
  const guidance: GuidanceEntry = phase === 'pick-run-context' ? RUN_CONTEXT_GUIDANCE
    : phase === 'input-format' ? formatGuidance.entry
    : phase === 'input-view' ? viewGuidance.entry
    : phase === 'pdf-locked' ? licenseGateGuidance('consultant', 'PDF reports')
    : phase === 'non-app-redirect' ? { title: 'Publish instead', what: 'This run type has no stakeholder report here; the HTML publication covers it.', cli: `swao publish --app ${app || '<id>'}` }
    : done ? reportDoneGuidance(assessmentType, ok)
    : phase === 'input-app' && assessedApps.length > 0 ? appGuidance.entry
    : REPORT_GUIDANCE;
  const runFacts = assessmentType === 'landing-zone-catalog' ? 'LZ Assessment' : (format === 'yaml' || format === 'json' ? 'auditor' : view);

  return (
    <ScreenLayout
      header={header}
      title={stepTitle(phase, assessmentType)}
      keys={reportKeys(phase, assessedApps.length > 0)}
      guidance={{ entry: guidance, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {phase === 'input-app' && (
        <>
          {workspace
            ? <DetailRow label="Workspace" value={workspace} path />
            : <StatusRow level="warn" label="Workspace" summary="not found; run Workspace Setup first" />}
          {assessedApps.length > 0 ? (
            <SelectInput
              label="Application"
              options={appOptions}
              visibleCount={Math.min(appOptions.length, 12)}
              showKeyHints={false}
              onCursorChange={appGuidance.onCursorChange}
              onSelect={(v) => handleAppSelect(v)}
              active
            />
          ) : (
            <TextInput
              key="input-app"
              label="Application ID"
              placeholder="sovereign-health"
              onSubmit={(v) => { if (v) handleAppSelect(v); }}
              active
            />
          )}
        </>
      )}

      {phase !== 'input-app' && <DetailRow label="App" value={app} />}

      {phase === 'pick-run-context' && workspace && (
        <RunContextPicker
          wspDir={join(workspace, 'apps', app, 'wsp')}
          onSelect={handleRunCtxSelect}
          onCancel={leave}
        />
      )}

      {phase === 'non-app-redirect' && (
        runCtx?.assessmentType === 'llm'
          ? <StatusRow level="info" label="LLM report" summary="the LLM Assessment PDF report comes in a future release; Publish HTML covers the results" />
          : <StatusRow level="info" label="Report" summary={`this view supports Application Assessment only; Publish HTML covers ${runCtx?.assessmentType ?? 'this'} runs`} />
      )}

      {phase === 'input-format' && (
        <SelectInput
          label="Output format"
          options={formatOptions}
          visibleCount={formatOptions.length}
          showKeyHints={false}
          onCursorChange={formatGuidance.onCursorChange}
          onSelect={handleFormatSelect}
          active
        />
      )}

      {phase === 'pdf-locked' && (
        <LicenseGate
          required="consultant"
          state={licenseState}
          feature="PDF reports (print quality)"
          onOpenLicenseScreen={onOpenLicense ?? onBack}
          onBack={() => setPhase('input-format')}
        >
          <></>
        </LicenseGate>
      )}

      {phase === 'input-view' && (
        <>
          {format === 'pdf' && <StatusRow level="info" label="PDF" summary="the report carries a branded header with your licensee name and organisation" />}
          <SelectInput
            label="Report view"
            options={effectiveViewOptions}
            visibleCount={effectiveViewOptions.length}
            showKeyHints={false}
            onCursorChange={viewGuidance.onCursorChange}
            onSelect={handleViewSelect}
            active
          />
        </>
      )}

      {(phase === 'running' || done) && (
        <>
          <DetailRow label="Format" value={`${format}, ${runFacts}`} />
          {!done && <StatusRow level="waiting" label="Report" summary="generating" />}
          {ok && reportFiles.length === 0 && (
            <StatusRow level="warn" label="Report" summary="exited 0 but wrote no files; check the output for stub or licence messages" />
          )}
          {ok && reportFiles.length > 0 && (
            <StatusRow level="ok" label="Report" summary={`${reportFiles.length} file${reportFiles.length === 1 ? '' : 's'} written`} />
          )}
          {done && code !== 0 && (
            <StatusRow level="warn" label="Report" summary={`completed with warnings${view !== 'all' && assessmentType === 'application' ? ` (${view} view)` : ''}`} />
          )}
          {reportFiles.map((p, i) => <DetailRow key={`${p}-${i}`} label={i === 0 ? 'Files' : ''} value={p} path />)}
          {lines.length > 0 && <RunOutput lines={lines} maxLines={22} />}
          {/* #2600: BI export is Consultant+; no hint at Community tier */}
          {ok && format !== 'pdf' && pdfAllowed && (
            <StatusRow level="info" label="BI bundle" summary="Export BI on the main menu produces the BI bundle" />
          )}
          {ok && format === 'pdf' && reportFiles.length === 0 && (
            <StatusRow level="info" label="HTML" summary="Publish HTML generates the HTML report as an alternative" />
          )}
          {/* #2581: format=all skips PDF; inform user so the skip is not a surprise */}
          {ok && format === 'all' && !pdfAllowed && (
            <StatusRow level="info" label="pdf" summary={`skipped, Consultant licence required (${licenseState.tier} tier)`} />
          )}
        </>
      )}
    </ScreenLayout>
  );
}
