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
        status: (m[4] as ProbeStatus) ?? 'INFO',
        headMessage: (m[5] ?? '').trim(),
        detailLines: [],
      };
    } else if (current) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // Epilogue lines we don't want attached to the last probe.
      if (/^All probes passed/.test(trimmed)) continue;
      if (/^Press Enter/.test(trimmed)) continue;
      if (/^Machine fingerprint:/.test(trimmed)) continue;
      current.detailLines.push(trimmed);
    }
  }
  if (current) probes.push(current);
  return probes;
}

// Per-probe business-user-readable action text. Maps the probe name (from the
// `[N/10] <Name>` header) to an action paragraph the operator can act on
// without engineer jargon. Falls back to a generic line when unknown.
export function probeAction(probe: HealthCheckProbe): string {
  switch (probe.status) {
    case 'ok':
      return 'No action required. This check is healthy.';
    case 'INFO':
      return 'No action required. Information only -- the run continues.';
    case 'WARN':
      if (probe.name === 'Prerequisites') {
        const isMalware = probe.headMessage.includes('Pass 14') ||
          /gitleaks|osv-scanner|clamav|yara/i.test(probe.headMessage);
        if (isMalware) {
          return 'One or more optional malware scan tools are not on PATH. Install them to enable Pass 14: gitleaks, osv-scanner, clamscan, yara. Proceed without them -- the other passes run normally.';
        }
      }
      return PROBE_WARN_HINT[probe.name] ?? 'Optional fix recommended. The assessment can still run.';
    case 'FAIL':
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
  'IaC toolchain':         'Detects whether at least one supported IaC toolchain (Terraform, OpenTofu, Pulumi, or Checkov) is installed on the host. SWAO uses these tools during Pass 06 (IaC static analysis). A missing toolchain downgrades the IaC pass to rule-engine-only mode.',
  'LLM gateway':           'Discovers and validates SWAO LLM-Gateway connector files (bundled seeds plus wsp/inputs/llm-gateway/). Reports the connector count and flags files that fail schema validation or contain secret-shaped values (Design 090).',
  'Engagement':            'Checks that the workspace .swao.yml engagement.name and client_code fields have been updated from their scaffold placeholder values. A placeholder name blocks publication.',
};

const PROBE_WARN_HINT: Record<string, string> = {
  'License':                'Use a Community-tier limit or request a paid licence at https://accenture.github.io/SWAO/en/.',
  'Playwright / Chromium':  'Install Chromium to enable the dynamic UI crawler pass (Pass 10): `swao install-playwright`. The other 9 static passes work without it.',
  'SWAO-MCP':               'Re-run Setup to wire the MCP entry into Claude Desktop, or add it manually via the JSON shape in docs/runbooks/mcp-client.md.',
  'Community frameworks':  'A community framework folder under wsp/inputs/catalogs/community/ has an integrity issue. Open the named framework folder and verify framework-meta.yaml + controls.yaml parse cleanly.',
  'Import templates':       'No import templates registered yet. Drop CMDB / ServiceNow / FinOps exports into wsp/inputs/ to enrich Pass 4 (context ingestion).',
  'Traceability':           'One or more apps fall below the traceability target. Open the per-app .swao.yml and confirm regimes_active + source_path are set.',
  'BI export':              'No BI bundle emitted yet. Run an assessment, then choose "Export BI bundle" to populate wsp/exports/.',
  'Scope':                  'Pass 13 scope_coverage signal missing on one or more apps. Re-run assessment; Pass 13 ships by default in v0.0.37+.',
  'Prerequisites':          'A non-blocking host tool is missing (e.g. `ssh`). Install the named tool, or proceed (HTTPS+PAT paths still work).',
  'VCS auth':               'One or more apps skipped VCS authentication (no token, or non-HTTPS URL). Add a token via Credentials, or convert SSH URLs to HTTPS.',
  'Engagement':             'Update engagement.name and client_code in .swao.yml to the real engagement details before running `swao publish`.',
};

const PROBE_FAIL_HINT: Record<string, string> = {
  'License':                'No valid licence detected. Request one from https://accenture.github.io/SWAO/en/ or paste a license key via main menu -> License.',
  'Community frameworks':  'One or more catalogues failed to load. Open the named folder under wsp/inputs/catalogs/community/ and check framework-meta.yaml + controls.yaml for YAML syntax errors.',
  'Playwright / Chromium':  'Chromium download failed. Re-run `swao install-playwright`; if it still fails check outbound HTTPS to playwright.azureedge.net.',
  'Import templates':       'A registered context_inputs file is missing. Options: (1) drop the file into ingestion/ and run swao assess --passes INGEST to route it to wsp/inputs/; or (2) remove the stale context_inputs: entry from apps/<id>/.swao.yml if you no longer need it.',
};
