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

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, relative, dirname } from 'path';
import { Header } from '../components/Header.js';
import { TextInput } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { LiveOutput } from '@swao/tui-kit';
import { LicenseGate, isAllowed } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { RunContextPicker } from '@swao/tui-kit';
import type { SelectedRunContext } from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';
import { LicenseGuard } from '../../license/license-guard.js';
import type { LicenseState } from '../../license/license-guard.js';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type Phase = 'input-app' | 'pick-run-context' | 'non-app-redirect' | 'input-format' | 'pdf-locked' | 'input-view' | 'running' | 'done';

function getAvailableTypes(wspDir: string): string[] {
  if (!existsSync(wspDir)) return [];
  const files = readdirSync(wspDir);
  return files
    .map(f => /^latest-(.+)\.txt$/.exec(f)?.[1])
    .filter((t): t is string => t !== undefined);
}

const VIEW_OPTIONS = [
  { label: 'All views                     -- Generate all 5 stakeholder reports', value: 'all' },
  { label: 'Business Owner                -- Executive summary', value: 'exec' },
  { label: 'GRC / Compliance Officer      -- Compliance & data protection', value: 'compliance' },
  { label: 'FinOps Lead                   -- FinOps & cost analysis', value: 'finops' },
  { label: 'Migration / Programme Manager -- Migration manager', value: 'migration-manager' },
  { label: 'Application Architect         -- Full technical report', value: 'technical' },
  { label: 'Auditor                       -- Traceability + structured payload', value: 'auditor' },
];

interface ReportScreenProps {
  onBack: () => void;
  onOpenLicense?: () => void;
}

export function ReportScreen({ onBack, onOpenLicense }: ReportScreenProps) {
  const workspace = findWorkspace(process.cwd());

  // Load licence state for the per-format gate (M18 #0277 follow-up).
  // PDF format is Consultant-tier-gated; other formats are Community.
  // The previous version silently fell back to Community on any load
  // failure, which made "SWAO_LICENSE_SECRET not set in this shell"
  // indistinguishable from "you genuinely have a Community licence".
  // We now keep the load error so it can be surfaced on screen.
  // Licence load failure surfaces in the Header's status line; the
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

  // Format menu shape adapts to tier: Community users see PDF tagged
  // "(Consultant licence required)" so they know it exists and what unlocks it.
  const FORMAT_OPTIONS = [
    { label: 'text  -- Human-readable summary (default)', value: 'text' },
    { label: 'yaml  -- Machine-readable YAML  (best with --view auditor)', value: 'yaml' },
    { label: 'json  -- Machine-readable JSON  (best with --view auditor)', value: 'json' },
    {
      label: pdfAllowed
        ? 'pdf   -- Print-quality PDF (branded header on Consultant / Enterprise)'
        : 'pdf   -- Print-quality PDF (Consultant licence required)',
      value: 'pdf',
    },
  ];

  // Apps that have been assessed (app, LZ, or LLM run present).
  const assessedApps: string[] = workspace && existsSync(join(workspace, 'apps'))
    ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
        .filter(d => d.isDirectory() && (
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'latest.txt')) ||
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'latest-landing-zone-catalog.txt')) ||
          existsSync(join(workspace, 'apps', d.name, 'wsp', 'run-manifest.json'))
        ))
        .map(d => d.name)
    : [];

  const [phase, setPhase]             = useState<Phase>('input-app');
  const [app, setApp]                 = useState('');
  const [format, setFormat]           = useState('text');
  const [view, setView]               = useState('all');
  const [assessmentType, setAssessmentType] = useState('application');
  const [notice, setNotice]           = useState('');
  const [lines, setLines]             = useState<string[]>([]);
  const [done, setDone]               = useState(false);
  const [code, setCode]               = useState<number | null>(null);
  const [reportFile,  setReportFile]  = useState('');
  const [reportFiles, setReportFiles] = useState<string[]>([]);
  const [runCtx, setRunCtx]           = useState<SelectedRunContext | null>(null);
  const guidanceOpenRef               = useRef(false);

  const handleAppSelect = (selectedApp: string) => {
    setApp(selectedApp);
    const wspDir = workspace ? join(workspace, 'apps', selectedApp, 'wsp') : '';
    const types = wspDir ? getAvailableTypes(wspDir) : [];
    if (types.length > 1) {
      setPhase('pick-run-context');
    } else {
      // Single type -- set it so the running phase knows which CLI args to use
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

    setReportFile('');
    setReportFiles([]);
    setLines([]);

    const args = ['report', '--app', app, '--format', format];
    if (assessmentType === 'llm') {
      args.push('--type', 'llm');
      // No --view or --all-views for LLM Assessment: single PDF per run
    } else if (assessmentType === 'landing-zone-catalog') {
      args.push('--type', 'landing-zone-catalog');
      // No --view or --all-views for LZ: single comprehensive report per run
    } else if (view === 'all') {
      args.push('--all-views');
    } else {
      args.push('--view', view);
      // No --output: CLI auto-saves with run timestamp to wsp/reports-app/
    }

    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: workspace ?? undefined,
    });

    // Workspace parent for computing display-relative paths (e.g. test-7.7\apps\...)
    const wsParent = workspace ? dirname(workspace) : undefined;
    const toRelPath = (abs: string) => wsParent ? relative(wsParent, abs) : abs;

    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      // Suppress "[ok] Report written to ..." lines from live output -- paths are
      // shown in the file list above. Show all other lines (errors, warnings, info).
      const filtered = text.split('\n')
        .filter(Boolean)
        .filter((l) => !/^\[ok\]\s+Report written to\b/.test(l));
      setLines(prev => [...prev, ...filtered]);
      // CLI emits one "[ok]  Report written to <path>" line per file. Keep
      // the most recent one (for single-view) and the full list (for --all-views).
      const pathRegex = /\[ok\]\s+Report written to (.+)/g;
      let match: RegExpExecArray | null;
      while ((match = pathRegex.exec(text)) !== null) {
        const p = (match[1] ?? '').trim();
        if (p) {
          setReportFile(toRelPath(p));
          setReportFiles(prev => [...prev, toRelPath(p)]);
        }
      }
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      setCode(exitCode);
      setDone(true);
      setPhase('done');
    });
    return () => { child.kill(); };
  }, [phase]);

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (done && (key.return || key.escape)) onBack();
    if (!done && key.escape) onBack();
    if (phase === 'non-app-redirect' && key.escape) onBack();
  });

  const handleFormatSelect = (v: string) => {
    setFormat(v);
    // PDF gate (M18 #0277 follow-up): if Community user picks PDF, show the
    // locked panel inline instead of letting the CLI raise the licence error.
    if (v === 'pdf' && !pdfAllowed) {
      setNotice('');
      setPhase('pdf-locked');
      return;
    }
    if (assessmentType === 'landing-zone-catalog') {
      // LZ reports: no view selection, single comprehensive output
      setNotice('');
      setPhase('running');
      return;
    }
    if (assessmentType === 'llm') {
      // LLM Assessment: PDF only, no view selection
      setNotice('');
      setPhase('running');
      return;
    }
    if ((v === 'yaml' || v === 'json') && view !== 'auditor') {
      setNotice(`Tip: pick the auditor view next for the structured, Zod-validated AuditorReport schema.`);
    } else if (v === 'pdf') {
      setNotice(`PDF reports include a branded header with your licensee name and organisation.`);
    } else {
      setNotice('');
    }
    setPhase('input-view');
  };

  const handleViewSelect = (v: string) => {
    setView(v);
    setPhase('running');
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={phase === 'input-app'
        ? 'Generate Report'
        : assessmentType === 'landing-zone-catalog'
          ? 'Landing Zone Assessment -- Generate Report'
          : assessmentType === 'llm'
            ? 'LLM Assessment -- Generate Report'
            : 'Application Assessment -- Generate Report'} />

      {phase === 'input-app' && (
        <Box flexDirection="column">
          {workspace
            ? <Text>Workspace: <Text bold color="whiteBright">{workspace}</Text></Text>
            : <Text color="yellow">No workspace found -- run Workspace Setup first.</Text>}
          <Box marginTop={1}>
            {assessedApps.length > 0 ? (
              <SelectInput
                label="Select application"
                options={assessedApps.map(a => ({ label: a, value: a }))}
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
          </Box>
          <GuidanceBox
            title="Report generation"
            what="Generates stakeholder reports from the latest assessment."
            affordances={['Up/Down -- pick app  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'pick-run-context' && workspace && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1}>
            <RunContextPicker
              wspDir={join(workspace, 'apps', app, 'wsp')}
              onSelect={handleRunCtxSelect}
              onCancel={onBack}
            />
          </Box>
          <GuidanceBox
            title="Select assessment run"
            what="Multiple assessment types were found for this app. Select the run whose data the report should use."
            details={[
              { label: 'Application', value: 'Source-code and LLM-pass based analysis' },
              { label: 'Landing Zone', value: 'CSP service catalog fit/gap analysis' },
            ]}
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- cancel']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {phase === 'non-app-redirect' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1} flexDirection="column">
            {runCtx?.assessmentType === 'llm' ? (
              <>
                <Text color="yellow" wrap="wrap">LLM Assessment PDF report is coming in a future release.</Text>
                <Text dimColor wrap="wrap">Use <Text bold>swao html publish --app {app}</Text> to generate an HTML publication from the LLM Assessment results.</Text>
              </>
            ) : (
              <>
                <Text color="yellow" wrap="wrap">This report view supports Application Assessment only.</Text>
                <Text dimColor wrap="wrap">For {runCtx?.assessmentType} runs, use <Text bold>swao html publish</Text> to generate a publication.</Text>
              </>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Esc</Text> to go back.</Text>
          </Box>
        </Box>
      )}

      {phase === 'input-format' && (
        <>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1}>
            <SelectInput
              label="Output format"
              options={FORMAT_OPTIONS}
              onSelect={handleFormatSelect}
              active
            />
          </Box>
          <GuidanceBox
            title="Output format"
            what="Choose the format for your audience."
            details={[
              { label: 'text', value: 'Human-readable summary (default)' },
              { label: 'yaml / json', value: 'Machine-readable for pipelines' },
              { label: 'pdf', value: pdfAllowed ? 'Branded PDF for client handover' : 'Branded PDF -- requires Consultant licence' },
            ]}
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {phase === 'pdf-locked' && (
        <Box flexDirection="column">
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          <Box marginTop={1}>
            <LicenseGate
              required="consultant"
              state={licenseState}
              feature="swao report --format pdf (print-quality PDF reports)"
              onOpenLicenseScreen={onOpenLicense ?? onBack}
              onBack={() => setPhase('input-format')}
            >
              <></>
            </LicenseGate>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press <Text bold>Esc</Text> to choose a different format (text, YAML, or JSON are available on Community).</Text>
          </Box>
        </Box>
      )}

      {phase === 'input-view' && (
        <>
          <Text>App: <Text color="cyanBright">{app}</Text></Text>
          {notice && <Text color="yellow">{notice}</Text>}
          <Box marginTop={1}>
            <SelectInput
              label="Report view"
              options={VIEW_OPTIONS}
              onSelect={handleViewSelect}
              active
            />
          </Box>
          <GuidanceBox
            title="Report view"
            what="Select the stakeholder audience. All views emits one file per audience."
            details={[
              { label: 'Business Owner',           value: 'C-suite: verdicts and recommendations' },
              { label: 'GRC / Compliance Officer', value: 'DPO/CISO: control outcomes and gaps' },
              { label: 'Application Architect',    value: 'Engineering: full pass-by-pass signals' },
              { label: 'Auditor',                  value: 'Regulator: structured AuditorReport payload' },
            ]}
            affordances={['Up/Down -- pick  |  Enter -- run  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {(phase === 'running' || phase === 'done') && (
        <>
          <Box>
            <Text>App: <Text color="cyanBright">{app}</Text></Text>
            <Text dimColor>  format: {format}{assessmentType === 'landing-zone-catalog' ? '  type: LZ Assessment' : (view ? `  view: ${view}` : '')}</Text>
          </Box>
          {notice && <Text color="yellow">{notice}</Text>}
          {!done && <Text color="yellow">Generating report...</Text>}
          {done && code === 0 && reportFiles.length === 0 && (
            <Text color="yellow">
              Report exited 0 but wrote no files. Check the output below for stub or licence messages.
            </Text>
          )}
          {done && code === 0 && reportFiles.length > 0 && (
            <Box flexDirection="column">
              <Text color="green">
                {assessmentType === 'landing-zone-catalog'
                  ? `Landing Zone report complete (format=${format}):`
                  : (view === 'all'
                    ? `Generated ${reportFiles.length} report${reportFiles.length === 1 ? '' : 's'}:`
                    : `Report complete (${view} view, format=${format}):`)}
              </Text>
              {reportFiles.map((p) => (
                <Text key={p} color="cyanBright">  {p}</Text>
              ))}
            </Box>
          )}
          {done && code !== 0 && (
            <Text color="yellow">
              {assessmentType === 'landing-zone-catalog'
                ? `Landing Zone report completed with warnings.${reportFile ? `  Saved -> ${reportFile}` : ''}`
                : (view === 'all'
                  ? `Report completed with warnings.`
                  : `Report completed with warnings${view !== 'all' ? ` (${view} view)` : ''}.${reportFile ? `  Saved -> ${reportFile}` : ''}`)}
            </Text>
          )}
          <LiveOutput lines={lines} maxLines={22} />

          {phase === 'done' && code === 0 && format !== 'pdf' && (
            <Box marginTop={1}>
              <Text dimColor>To produce the BI bundle, return to the main menu and pick "Export BI".</Text>
            </Box>
          )}
          {phase === 'done' && code === 0 && format === 'pdf' && reportFiles.length === 0 && (
            <Box marginTop={1}>
              <Text dimColor>Use Publish to generate the HTML report as an alternative.</Text>
            </Box>
          )}

          {phase === 'done' && code === 0 && reportFiles.length > 0 && (
            <GuidanceBox
              title="Report generated"
              what={assessmentType === 'landing-zone-catalog'
                ? 'Landing Zone report written to the app wsp/reports-lz/ folder.'
                : 'Report files written to the app wsp/reports-app/ folder.'}
              affordances={['Enter/Esc -- back to menu']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          )}

          <Box marginTop={1}>
            <Text dimColor>{done ? 'Press Enter or Escape to return to menu...' : 'Escape to cancel...'}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
