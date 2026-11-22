// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Parser for `swao health-check` stdout. Used by SetupWizard.HealthCheckStep and the
// main-menu HealthCheckScreen (#0385, sprint-040) so both render the probes as
// a two-column interactive list with per-probe GuidanceBox detail rather
// than the wall-of-text LiveOutput.
//
// Health-check emits one header line per probe in the form
//   "  [N/M] <Name>........  <status>  <headMessage>"  (M = total probe count)
// Some probes follow up with continuation lines (e.g. probe 4 lists every
// community framework). All lines after a header up to the next header
// belong to that probe.

import { tuiRemedyText } from '../../probes/service-probes.js';

export type ProbeStatus = 'ok' | 'INFO' | 'WARN' | 'FAIL';

export interface HealthCheckProbe {
  num: number;
  total: number;
  name: string;
  status: ProbeStatus;
  headMessage: string;
  detailLines: string[];
}

// Name group `([^.]+?)` excludes only dots, matching any other character (including
// spaces). This is safe against polynomial backtracking because [^.] and \.+ are
// mutually exclusive -- no overlap, O(n) matching. The earlier `[^\s.]*?` excluded
// spaces to avoid the [^.]*?/\s+ overlap that triggered CodeQL js/polynomial-redos
// #57, but it silently dropped probes whose names contain spaces (e.g. "Playwright /
// Chromium", "VCS auth", "Audit ingestion"). MAX_HEADER_LEN still caps input length.
const HEADER_RE = /^\s*\[(\d+)\/(\d+)\]\s+([^.]+?)\.+\s+(ok|INFO|WARN|FAIL)\s*(.*)$/;

// The regex still contains several whitespace quantifiers, so to keep it linear
// on adversarial input we bound the match input length (CodeQL js/polynomial-redos
// #57; same `slice`-before-regex pattern as health-check.ts/license.ts). A real
// health-check header line is ~100 chars; anything longer cannot be a probe header.
const MAX_HEADER_LEN = 512;

export function parseHealthCheckOutput(lines: ReadonlyArray<string>): HealthCheckProbe[] {
  const probes: HealthCheckProbe[] = [];
  let current: HealthCheckProbe | null = null;
  for (const raw of lines) {
    const m = HEADER_RE.exec(raw.slice(0, MAX_HEADER_LEN));
    if (m) {
      if (current) probes.push(current);
      current = {
        num: parseInt(m[1] ?? '0', 10),
        total: parseInt(m[2] ?? '0', 10),
        name: (m[3] ?? '').trim(),
        status: m[4] as ProbeStatus, // group 4 is required by HEADER_RE
        headMessage: (m[5] ?? '').trim(),
        detailLines: [],
      };
    } else if (current) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // Epilogue lines we don't want attached to the last probe.
      if (/^All probes passed/.test(trimmed)) continue;
      if (/^No probe failed/.test(trimmed)) continue;
      if (SUMMARY_FAILED_RE.test(trimmed.slice(0, MAX_HEADER_LEN))) continue;
      if (SUMMARY_WARNED_RE.test(trimmed.slice(0, MAX_HEADER_LEN))) continue;
      if (/^Machine fingerprint:/.test(trimmed)) continue;
      current.detailLines.push(trimmed);
    }
  }
  if (current) probes.push(current);
  return probes;
}

// #3170: text-mode epilogue written by the runner (formatHealthCheckSummaryLine):
//   "All probes passed."  or  "N probe(s) failed: key-a, key-b."
// Linear: a bounded digit run, a literal, then one greedy tail (trimmed in code).
const SUMMARY_FAILED_RE = /^(\d{1,4}) probe\(s\) failed(?::(.*))?/;
// #4260: warnings epilogue (formatHealthCheckWarningsLine): "Warnings (N): A, B."
// Same linear shape as SUMMARY_FAILED_RE.
const SUMMARY_WARNED_RE = /^Warnings \((\d{1,4})\):(.*)/;

export interface HealthCheckOutputSummary {
  /** Number of probe header lines parsed. */
  probeCount: number;
  /** Failures as declared by the runner's own summary line (the single definition, #3170). */
  failCount: number;
  /** Runner probe keys named in the summary line (empty when none or not stated). */
  failedProbes: string[];
  /**
   * Probes whose header status is WARN (not failures; reported separately,
   * #2388). #4260: read from the runner's warnings line when present, which
   * also names checks without a probe line (Source access).
   */
  warnCount: number;
  warnedProbes: string[];
}

/**
 * Summarise `swao health-check` text output for the Setup Wizard (#3170).
 *
 * The failure count is read from the runner's summary line so the wizard's
 * setup.health-check.complete event always matches health-check.complete.
 * Only when the summary line is missing (for example the child was killed by
 * the watchdog) does it fall back to counting FAIL probe headers. WARN probes
 * are counted separately and never added to the failure count.
 */
export function summariseHealthCheckOutput(lines: ReadonlyArray<string>): HealthCheckOutputSummary {
  const probes = parseHealthCheckOutput(lines);
  let summaryFail: { count: number; keys: string[] } | null = null;
  let summaryWarn: string[] | null = null;
  const names = (tail: string | undefined): string[] => (tail ?? '').trim().replace(/\.$/, '').split(',').map((k) => k.trim()).filter(Boolean);
  for (const raw of lines) {
    const trimmed = raw.trim().slice(0, MAX_HEADER_LEN);
    if (/^All probes passed/.test(trimmed) || /^No probe failed/.test(trimmed)) { summaryFail = { count: 0, keys: [] }; continue; }
    const m = SUMMARY_FAILED_RE.exec(trimmed);
    if (m) {
      summaryFail = { count: parseInt(m[1] ?? '0', 10), keys: names(m[2]) };
      continue;
    }
    const w = SUMMARY_WARNED_RE.exec(trimmed);
    if (w) summaryWarn = names(w[2]);
  }
  const failHeaders = probes.filter((p) => p.status === 'FAIL').map((p) => p.name);
  // #4260: the runner's warnings line is the single definition; header counting is the fallback.
  const warned = summaryWarn ?? probes.filter((p) => p.status === 'WARN').map((p) => p.name);
  return {
    probeCount: probes.length,
    failCount: summaryFail ? summaryFail.count : failHeaders.length,
    failedProbes: summaryFail ? summaryFail.keys : failHeaders,
    warnCount: warned.length,
    warnedProbes: warned,
  };
}

// Per-probe business-user-readable action text. Maps the probe name (from the
// `[N/10] <Name>` header) to an action paragraph the operator can act on
// without engineer jargon. Falls back to a generic line when unknown.
export function probeAction(probe: HealthCheckProbe): string {
  switch (probe.status) {
    case 'ok':
      return 'No action required. This check is healthy.';
    case 'INFO':
      return 'No action required. Information only; the run continues.';
    case 'WARN':
      if (probe.name === 'Prerequisites') {
        const isMalware = probe.headMessage.includes('Pass 14') ||
          /gitleaks|osv-scanner|clamav|yara/i.test(probe.headMessage);
        if (isMalware) {
          return 'One or more optional malware scan tools are not on PATH. Install them to enable Pass 14: gitleaks, osv-scanner, clamscan, yara. Proceed without them; the other passes run normally.';
        }
      }
      // #4451: a slow test launch is not a missing installation; nothing to install.
      if (probe.name === 'Playwright / Chromium' && probe.headMessage.includes('test launch took longer')) {
        return 'Chromium is installed; its test launch was slow, usually because the machine is busy. Run the health check again when the machine is less busy. Pass 10 can still run.';
      }
      // #2318: surface the specific gateway message so the operator knows why.
      if (probe.name === 'LLM gateway' && probe.headMessage) {
        return `Reason: ${probe.headMessage}. Check connector files in wsp/inputs/llm-gateway/ or run Workspace Setup to configure a gateway.`;
      }
      return PROBE_WARN_HINT[probe.name] ?? 'Optional fix recommended. The assessment can still run.';
    case 'FAIL':
      // #2318: surface the specific gateway message so the operator knows why.
      if (probe.name === 'LLM gateway' && probe.headMessage) {
        return `Reason: ${probe.headMessage}. Re-run Workspace Setup, or add a valid connector file to wsp/inputs/llm-gateway/.`;
      }
      // #4451: Chromium is on disk but did not start; name the launch error.
      if (probe.name === 'Playwright / Chromium' && probe.headMessage.startsWith('Chromium launch failed')) {
        return `Chromium is installed but did not start; the error is in the health check log (event health-check.probe.complete, field error_detail). Install it again with the Playwright step of the Application setup; the other passes run without it.`;
      }
      return PROBE_FAIL_HINT[probe.name] ?? 'Required fix. The next assessment step is blocked until this is resolved.';
  }
}

/** Human-friendly descriptions of what each probe checks. Shown in the guidance
 *  box "What does this check?" field regardless of probe status (#1348). */
export const PROBE_DESCRIPTION: Record<string, string> = {
  'License':               'Verifies that a valid SWAO licence is present and within its usage tier limits. A missing or expired licence blocks paid-tier capabilities.',
  'Prerequisites':         'Confirms that required host tools are on PATH (git, ssh, etc.) and that optional malware scan tools are available for Pass 14.',
  'VCS auth':              'Checks that VCS credentials are configured for each application source repository so SWAO can clone or fetch source code during assessment.',
  'Community frameworks': 'Validates that each installed community framework catalogue (framework-meta.yaml + controls.yaml) loads cleanly and passes integrity checks.',
  'Import templates':      'Confirms that context document templates are registered for workspace enrichment so Pass 4 (context ingestion) has input files to ingest.',
  'Traceability':          'Checks that all applications have the required fields set in .swao.yml: regimes_active (which frameworks to enforce) and source_path (where the code lives).',
  'Playwright / Chromium': 'Verifies that the Chromium browser engine needed by Pass 10 (dynamic UI crawl) is installed and launchable.',
  'SWAO-MCP':              'Checks that the SWAO Model Context Protocol server is registered with Claude Desktop so workspace context is available to AI-assisted features.',
  'Scope':                 'Confirms that Pass 13 (scope coverage) ran successfully on all applications in the portfolio, producing a scope signal for the report.',
  'BI export':             'Checks that at least one BI bundle has been exported for Power BI integration. Run an assessment and then choose "Export BI bundle" from the main menu.',
  'Audit ingestion':       'Verifies that the audit assessment ingestion pipeline is operational and can route documents from ingestion/ to wsp/inputs/.',
  'Ingestion folder':      'Confirms that the ingestion/ folder exists in the workspace root. SWAO routes inbound audit documents and CMDB exports through this folder before normalising them into wsp/inputs/.',
  // #2317: clarify that rule-engine-only mode still parses .tf/.tfstate files; only toolchain-specific
  // validation (terraform validate, checkov, drift detection) is skipped when no binary is found.
  'IaC toolchain':         'Detects whether a supported IaC toolchain (Terraform, OpenTofu, Pulumi, or Checkov) is installed. Pass 06 has two modes: toolchain mode (binary present) adds terraform validate, checkov scanning, and drift detection; rule-engine-only mode (no binary) still reads and analyses all .tf, .tfvars, and .tfstate files using the built-in HCL parser and applies sovereignty rules. Install Terraform (terraform.io) or Checkov (checkov.io) to unlock the toolchain layer. IaC files are covered either way.',
  'LLM gateway':           'Discovers and validates SWAO LLM-Gateway connector files (bundled seeds plus wsp/inputs/llm-gateway/). Reports the connector count and flags files that fail schema validation or contain secret-shaped values (Design 090).',
  'Engagement':            'Checks that the workspace .swao.yml engagement.name and client_code fields have been updated from their scaffold placeholder values. A placeholder name blocks publication.',
  // #4113: the probe checks the provider catalogues (bundled and workspace copies) and runs the catalogue quality rules.
  'LZ catalogue':          'Validates the Landing Zone catalogues (bundled and workspace copies under wsp/inputs/catalogs/lz-catalogues/): each provider catalogue loads and schema-validates, and the catalogue quality rules check region counts, age and sourced sovereignty facts. Each finding is listed below with catalogue, rule and text.',
};

const PROBE_WARN_HINT: Record<string, string> = {
  'License':                'Use a Community-tier limit or request a paid licence at https://accenture.github.io/SWAO/en/.',
  'Playwright / Chromium':  'Install Chromium to enable the dynamic UI crawler pass (Pass 10); the Playwright step of the Application setup shows how. The other 9 static passes work without it.',
  'SWAO-MCP':               'Re-run Setup to wire the MCP entry into Claude Desktop, or add it manually via the JSON shape in docs/runbooks/mcp-client.md.',
  'Community frameworks':  'A community framework folder under wsp/inputs/catalogs/community/ has an integrity issue. Open the named framework folder and verify framework-meta.yaml + controls.yaml parse cleanly.',
  'Import templates':       'No import templates registered yet. Drop CMDB / ServiceNow / FinOps exports into wsp/inputs/ to enrich Pass 4 (context ingestion).',
  'Traceability':           'One or more apps fall below the traceability target. Open the per-app .swao.yml and confirm regimes_active + source_path are set.',
  'BI export':              'No BI bundle emitted yet. Run an assessment, then choose "Export BI bundle" to populate wsp/exports/.',
  'Scope':                  'Pass 13 scope_coverage signal missing on one or more apps. Re-run assessment; Pass 13 ships by default in v0.0.37+.',
  'Prerequisites':          'A non-blocking host tool is missing (e.g. `ssh`). Install the named tool, or proceed (HTTPS+PAT paths still work).',
  'VCS auth':               'One or more apps skipped VCS authentication (no token, or non-HTTPS URL). Add a token via Credentials, or convert SSH URLs to HTTPS.',
  // #2317: IaC toolchain WARN means no binary found but rule-engine-only mode still works.
  'IaC toolchain':          'No IaC toolchain binary (terraform, tofu, pulumi, checkov) found in PATH. Pass 06 runs in rule-engine-only mode: .tf, .tfvars, and .tfstate files are still parsed and sovereignty rules applied. Install Terraform (terraform.io) or Checkov (checkov.io) to add toolchain-specific validation.',
  'Engagement':             'Update engagement.name and client_code in .swao.yml to the real engagement details before publishing.',
  // #4113: the findings are named in the detail rows and in the health-check NDJSON log.
  'LZ catalogue':           'Review the catalogue findings listed below. Refresh the catalogues with Tools > Update LZ Catalogue, or correct the named catalogue file. Assessments still run; the health-check log in wsp/logs/ names the findings too.',
};

const PROBE_FAIL_HINT: Record<string, string> = {
  'License':                'No valid licence detected. Request one from https://accenture.github.io/SWAO/en/ or paste a license key via main menu -> License.',
  'Community frameworks':  'One or more catalogues failed to load. Open the named folder under wsp/inputs/catalogs/community/ and check framework-meta.yaml + controls.yaml for YAML syntax errors.',
  'Playwright / Chromium':  'Chromium download failed. Install it again (the Playwright step of the Application setup); if it still fails check outbound HTTPS to playwright.azureedge.net.',
  'Import templates':       'A registered context_inputs file is missing. Drop it into ingestion/ and run the assessment again, or remove the stale context_inputs: entry from apps/<id>/.swao.yml.',
};

/** #4113: GuidanceBox truncates a detail value at 200 characters (tui-kit MAX_DETAIL_VALUE_CHARS). */
export const DETAIL_ROW_MAX_CHARS = 180;

/**
 * #4113: split a long detail line into rows of at most `max` characters, at a
 * comma or space boundary, so the GuidanceBox shows the whole line instead of
 * cutting it at 200 characters (an LZ catalogue finding lists its regions first
 * and its rule text last, so the cut used to drop the text).
 */
export function wrapDetailLine(line: string, max = DETAIL_ROW_MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = line.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(': '));
    if (cut > 0) cut += 1; // keep the comma or colon on the first row
    else cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export interface ProbeDetailRow { label: string; value: string }

/**
 * #4113: the GuidanceBox detail rows for one probe: status, the probe's own
 * result line when it is not ok (the "what" field shows the probe description,
 * so the result, for example "20 warning(s)", was not shown before), the next
 * action, and every detail line, wrapped so nothing is cut.
 */
export function probeDetailRows(probe: HealthCheckProbe): ProbeDetailRow[] {
  // #4257: the status in the words of the central status map (lower case, Q-05).
  const rows: ProbeDetailRow[] = [{ label: 'Status', value: probe.status.toLowerCase() }];
  // #4295: the TUI shows the TUI path of a CLI remedy (tuiRemedyText).
  if (probe.status !== 'ok' && probe.headMessage) {
    wrapDetailLine(tuiRemedyText(probe.headMessage)).forEach((v, i) => rows.push({ label: i === 0 ? 'Result' : '  ', value: v }));
  }
  wrapDetailLine(probeAction(probe)).forEach((v, i) => rows.push({ label: i === 0 ? 'Action' : '  ', value: v }));
  // #1580: one entry per detail line so maxRows truncates by line count, not chars.
  let first = true;
  for (const line of probe.detailLines) {
    for (const v of wrapDetailLine(tuiRemedyText(line))) {
      rows.push({ label: first ? 'Detail' : '  ', value: v });
      first = false;
    }
  }
  return rows;
}
