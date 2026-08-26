// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Run log + findings store (#1422, Design 092 s5.7).
//
// The LLM Assessment records its own operational findings as first-class
// result data: nothing that went wrong during a run is silently absorbed
// into an average. The findings `type` is an OPEN string (operator
// decision OQ-92-14): CORE_FINDING_TYPES ships described constants so
// common findings render with rich tooltips, and unknown types are fully
// legal, rendered generically.

import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type FindingSeverity = 'info' | 'warn' | 'error';

/** Described core vocabulary; NOT a closed enum (OQ-92-14). */
export const CORE_FINDING_TYPES: Readonly<Record<string, string>> = {
  timeout: 'A call exceeded the per-call timeout cap and was recorded as DNF.',
  truncation: 'A response was cut off at the model\'s max output tokens before completing the requested structure.',
  'rate-limit': 'The platform throttled a call (HTTP 429 or equivalent).',
  refusal: 'The model refused to answer a prompt containing only redacted workspace content.',
  'parse-failure': 'A response could not be parsed as the expected format.',
  'schema-failure': 'A parsed response failed the pass response schema.',
  'verdict-conflict': 'A leg\'s verdict conflicts with the majority of legs (flag only; never caps the final rank).',
  'guard-trip': 'An identical-input or workload-shape guard fired at run start.',
  'cost-overrun': 'Actual leg cost exceeded the pre-run preview beyond tolerance.',
  'cost-unavailable': 'A leg\'s model has no price row in its connector catalogue; cost renders "local"/unavailable instead of a silent zero.',
  'workload-incomplete': 'A regime in the app\'s regimes_active has no installed framework catalog; the compliance workload is partially skipped.',
  'shared-platform': 'Legs share one platform key; a rate-limit or credit event may reflect contention, not model speed.',
};

export interface Finding {
  id: string;               // F-1, F-2, ... assigned by the store
  severity: FindingSeverity;
  leg?: string;             // leg id; absent for run-level findings
  pass_id?: string;
  call_ref?: string;        // <pass_id>#<call_index> when call-scoped
  type: string;             // open vocabulary (OQ-92-14)
  message: string;
  metric_impact?: string;   // which metric cells this finding annotates
}

export interface RunLogEvent {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;            // dotted: leg.start, call.complete, ...
  message: string;
  context?: Record<string, unknown>;
}

/** Append-only NDJSON run log (092 s7: llm-assessments/<kind>/<ts>/log.ndjson). */
export class RunLog {
  constructor(
    private readonly path: string,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  write(level: RunLogEvent['level'], event: string, message: string, context?: Record<string, unknown>): void {
    const entry: RunLogEvent = { ts: this.clock(), level, event, message, ...(context ? { context } : {}) };
    appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf-8');
  }
}

export class FindingsStore {
  private readonly findings: Finding[] = [];
  private counter = 0;

  constructor(private readonly log?: RunLog) {}

  add(finding: Omit<Finding, 'id'>): Finding {
    this.counter += 1;
    const full: Finding = { id: `F-${this.counter}`, ...finding };
    this.findings.push(full);
    this.log?.write(
      finding.severity === 'error' ? 'error' : finding.severity === 'warn' ? 'warn' : 'info',
      'finding.recorded',
      `${full.id} ${full.type}: ${full.message}`,
      { leg: full.leg, pass_id: full.pass_id, call_ref: full.call_ref },
    );
    return full;
  }

  all(): readonly Finding[] {
    return this.findings;
  }

  forCell(leg: string, passId?: string): Finding[] {
    return this.findings.filter((f) => f.leg === leg && (passId === undefined || f.pass_id === passId));
  }

  /** Persist as findings.yaml (simple stable YAML; no dependency). */
  writeYaml(dir: string): string {
    const path = join(dir, 'findings.yaml');
    mkdirSync(dir, { recursive: true });
    const lines: string[] = ['findings:'];
    for (const f of this.findings) {
      lines.push(`  - id: ${f.id}`);
      lines.push(`    severity: ${f.severity}`);
      if (f.leg) lines.push(`    leg: ${JSON.stringify(f.leg)}`);
      if (f.pass_id) lines.push(`    pass_id: ${JSON.stringify(f.pass_id)}`);
      if (f.call_ref) lines.push(`    call_ref: ${JSON.stringify(f.call_ref)}`);
      lines.push(`    type: ${JSON.stringify(f.type)}`);
      lines.push(`    message: ${JSON.stringify(f.message)}`);
      if (f.metric_impact) lines.push(`    metric_impact: ${JSON.stringify(f.metric_impact)}`);
    }
    if (this.findings.length === 0) lines.push('  []');
    writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
    return path;
  }
}
