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

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// #0261 -- CLI vs TUI parity gate. Sprint 028's audit Phase 1 found
// five drift items (PortfolioScreen not wired, AssessScreen missing
// --source-path/--iter/--stats, ExportBiScreen missing --output/--no-bom/
// --crlf, RegimeSelector missing non-interactive route, install-playwright
// has no UI). This test PINS the current parity matrix so any future drift
// fails fast.
//
// When #0259 closes the drift items, update the expected sets below to
// reflect the new state. The test does NOT fail on todays known drifts --
// it pins them as "known". A future regression that drops a CLI command
// or accidentally creates a screen that wraps the wrong command WILL fail.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../../');
const COMMANDS_DIR = join(REPO_ROOT, 'packages', 'swao', 'src', 'commands');
// #0552: accept + migrate-workspace command register fns relocated to the
// app-assessment module; scan its commands dir too so the parity gate still
// sees them (they remain wired into the CLI via swao's index.ts bootstrap).
const MODULE_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-app-assessment', 'src', 'commands',
);
// #1434: the audit module (and its `audit` command group) was removed.
// #0567: the `lz` command group lives in the landing-zone module.
const MODULE_LZ_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-landing-zone', 'src', 'commands',
);
// #0573: the `doctor` command group (doctor / doctor pii / doctor tags) lives in
// the doctor module; it remains wired into the CLI via swao's index.ts bootstrap.
const MODULE_DOCTOR_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-health-check', 'src', 'commands',
);
// #0574: the `mcp` command lives in the mcp module; it remains wired into the
// CLI via swao's index.ts bootstrap (registerMcp with injected McpHostDeps).
const MODULE_MCP_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-mcp', 'src', 'commands',
);
// #0575: the `publish` command lives in the html-report module; it remains wired
// into the CLI via swao's index.ts bootstrap (registerPublish with injected
// { swaoVersion }).
const MODULE_HTML_REPORT_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-html-report', 'src', 'commands',
);
// #0578: the `generate-tf` command lives in the terraform module; it remains
// wired into the CLI via swao's index.ts bootstrap (registerGenerateTf, which
// imports only @swao/core). The register fn is at the module's src root, not a
// commands/ subdir, so the scan points at src.
const MODULE_TERRAFORM_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-terraform', 'src',
);
// #0580: the `challenge` command lives in the challenge module; it remains wired
// into the CLI via swao's index.ts bootstrap (registerChallenge with injected
// { createLlmProvider }). The register fn is at the module's src root, not a
// commands/ subdir, so the scan points at src.
const MODULE_CHALLENGE_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-challenge', 'src',
);
// #0577: the `export` command lives in the powerbi module; it remains wired into
// the CLI via swao's index.ts bootstrap (registerExport, which imports only
// @swao/core + leaf deps). The register fn is at the module's src root, not a
// commands/ subdir, so the scan points at src.
const MODULE_POWERBI_COMMANDS_DIR = join(
  REPO_ROOT, 'packages', '@swao', 'module-powerbi', 'src',
);
const TUI_SCREENS_DIR = join(REPO_ROOT, 'packages', 'swao', 'src', 'tui', 'screens');
// #0553: assessment TUI screens relocated to @swao/module-app-assessment/src/tui/.
// #0573: HealthCheckScreen (formerly DoctorScreen) relocated to @swao/module-health-check/src/tui/.
// #0575: PublishScreen + ServeScreen relocated to @swao/module-html-report/src/tui/.
// Scan them too so a moved screen is still "seen" by the parity gate.
const MODULE_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-app-assessment', 'src', 'tui');
const MODULE_DOCTOR_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-health-check', 'src', 'tui');
const MODULE_HTML_REPORT_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-html-report', 'src', 'tui');
// #0578: GenerateTfScreen relocated to @swao/module-terraform/src/tui/.
const MODULE_TERRAFORM_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-terraform', 'src', 'tui');
// #0580: ChallengeScreen relocated to @swao/module-challenge/src/tui/.
const MODULE_CHALLENGE_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-challenge', 'src', 'tui');
// #0577: ExportBiScreen relocated to @swao/module-powerbi/src/tui/.
const MODULE_POWERBI_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-powerbi', 'src', 'tui');
// #0579: PortfolioScreen relocated to @swao/module-portfolio/src/tui/.
const MODULE_PORTFOLIO_TUI_DIR = join(REPO_ROOT, 'packages', '@swao', 'module-portfolio', 'src', 'tui');
const INDEX_TS = join(REPO_ROOT, 'packages', 'swao', 'src', 'index.ts');
// #0673: MCP parity -- server.ts lists MCP tool names that must mirror CLI commands.
const MCP_SERVER_SRC = join(REPO_ROOT, 'packages', '@swao', 'module-mcp', 'src', 'server.ts');

// Top-level commander commands registered in index.ts (or commands/*.ts).
// Order does not matter; this is a set comparison.
const EXPECTED_CLI_COMMANDS = new Set([
  'init',
  'setup',
  'health-check',
  'assess',
  'report',
  'export',
  'license',
  'credential',
  'mcp',
  'menu',
  'challenge',
  'install-playwright',
  'migrate-workspace',
  'regime-select',
  'generate-tf',
  'log',                          // #0327 -- WSP-scoped event log; CLI-only (no TUI screen, see CLI_ONLY)
  'framework',                    // #0324 sprint-036 -- Community Frameworks management; CLI-only (no TUI screen yet)
  'publish',                      // #0432 -- Mode A/B publication; TUI: PublishScreen (item 5 on main menu)
  'lenses',                       // #0455 -- SWAO Prism lens management; TUI: LensesScreen (Tools submenu)
  'normalize',                    // #0442 -- Input Normalizer; CLI-only (batch file processing, no TUI yet)
  'diff',                         // #0477 sprint-053 -- assessment run comparison; CLI-only
  'accept',                       // #0477 sprint-053 -- accepted-run lock; CLI-only
  // 'audit' removed at #1434 with the audit assessment surface.
  'lz',                           // #0567 -- landing-zone command group (catalogue/fit); CLI-only (TUI carries to #0553)
  'ingest',                       // #0967 -- pre-process ingestion/ folder; TUI: IngestScreen (Tools submenu)
  'support-bundle',               // #1477 sprint-116 -- PII-free diagnostic archive; TUI: SupportBundleScreen (Tools submenu)
  'unipipe',                      // #1652 sprint-121 -- meshcloud UniPipe integration stub; CLI-only (TUI deferred)
]);

// TUI screen files (under src/tui/screens/) that wrap a CLI command.
// Each screen file's basename minus 'Screen.tsx' is the canonical name.
// Intentionally CLI-only: 'mcp' (stdio server), 'menu' (TUI entry point itself).
const EXPECTED_TUI_SCREENS = new Set([
  // Screens that wrap a CLI command
  'AssessScreen',
  'ChallengeScreen',          // #0259.C4 -- Enterprise-gated, reached via Tools submenu
  'CredentialScreen',
  'HealthCheckScreen',
  'ExportBiScreen',
  'GenerateTfScreen',
  'LicenseScreen',
  'PortfolioScreen',
  'RegimeSelectorScreen',
  'ReportScreen',
  'SetupWizard',
  'PublishScreen',            // #0432 -- swao publish; item 5 on main menu
  'LensesScreen',             // #0455 -- swao lenses; Tools submenu
  'LzCatalogueUpdateScreen',  // #0872 -- swao lz catalogue update; Tools submenu
  'LzCatalogueManageScreen',  // #1436 -- swao lz catalogue copy/new/list; Tools submenu (Community+)
  'ServeScreen',              // #0438 -- swao publish --serve; launched from PublishScreen
  'IngestScreen',             // #0967 -- swao ingest; Tools submenu (key 5)
  'SupportBundleScreen',      // #1477 sprint-116 -- swao support-bundle; Tools submenu
  'LlmAssessmentScreen',      // #1427 -- LLM Assessment TUI flow; reached via AssessmentTypeScreen 'llm'
  // Navigation / help screens (TUI-only, no CLI counterpart)
  'HelpScreen',
  'MainMenu',
  'ToolsMenu',
  'AssessmentTypeScreen',      // L0 entry screen: Source Code vs Human Assessment type selector
  // CatalogDraftScreen reserved for #0234 (deferred to backlog); not yet present
]);

// CLI commands intentionally without a TUI screen. Flag with rationale.
const CLI_ONLY = new Map<string, string>([
  ['mcp', 'stdio server -- spawned by Claude Desktop, no interactive UI'],
  ['menu', 'TUI entry point itself; routed via App.tsx, not its own screen'],
  ['init', 'workspace bootstrap; SetupWizard absorbs the equivalent flow'],
  ['challenge', 'TODO #0259 -- file an issue if challenge needs a TUI surface'],
  ['install-playwright', 'TODO #0259 -- DoctorScreen should offer an Install button'],
  ['migrate-workspace', 'one-shot operator helper; not on the daily-driver path'],
  ['log', '#0327 -- diagnostic log reader; expert operator path, not TUI-surfaced'],
  ['framework', '#0324 sprint-036 -- Community Frameworks command surface; TUI screen carries to #0339 follow-up'],
  ['normalize', '#0442 -- Input Normalizer; batch file processing; no TUI screen in v1 (sprint-047)'],
  ['diff', '#0477 sprint-053 -- assessment run comparison; operator expert path; no TUI surface yet'],
  ['accept', '#0477 sprint-053 -- accepted-run lock management; CLI-only workflow'],
  ['lz', '#0567 -- landing-zone command group (catalogue list/show, fit); TUI: LandingZoneAssessScreen carries to #0553'],
  ['lenses', '#0455 -- SWAO Prism lens management; TUI: LensesScreen (Tools submenu)'],
  ['regime-select', 'interactive selector; runs as a subprocess from other commands'],
  ['generate-tf', '#0018 -- Terraform HCL generator; GenerateTfScreen exists but is CLI-also'],
  ['unipipe', '#1652 sprint-121 -- meshcloud UniPipe integration stub; TUI screen deferred post-v0.11.0'],
]);

function listCliCommandsFromIndex(): Set<string> {
  const src = readFileSync(INDEX_TS, 'utf-8');
  // Match either .command('name') or program.command('name'); commander pattern.
  const re = /\.command\(\s*['"]([a-z][a-z0-9-]*)/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  return found;
}

function listCliCommandsFromCommandsDir(): Set<string> {
  // Each registerXXX(program) call in commands/*.ts adds a top-level command.
  // We pick this up via a directory scan + file inspection so commands wired
  // OUTSIDE index.ts (rare today, possible tomorrow) still register. #0552
  // also scans the app-assessment module's commands dir (accept,
  // migrate-workspace moved there but remain wired via swao's bootstrap).
  const out = new Set<string>();
  const re = /program\s*\n?\s*\.command\(\s*['"]([a-z][a-z0-9-]*)/g;
  for (const dir of [COMMANDS_DIR, MODULE_COMMANDS_DIR, MODULE_LZ_COMMANDS_DIR, MODULE_DOCTOR_COMMANDS_DIR, MODULE_MCP_COMMANDS_DIR, MODULE_HTML_REPORT_COMMANDS_DIR, MODULE_TERRAFORM_COMMANDS_DIR, MODULE_CHALLENGE_COMMANDS_DIR, MODULE_POWERBI_COMMANDS_DIR]) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = readFileSync(join(dir, file), 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.add(m[1]);
    }
  }
  return out;
}

function listTuiScreens(): Set<string> {
  const out = new Set<string>();
  for (const dir of [TUI_SCREENS_DIR, MODULE_TUI_DIR, MODULE_DOCTOR_TUI_DIR, MODULE_HTML_REPORT_TUI_DIR, MODULE_TERRAFORM_TUI_DIR, MODULE_CHALLENGE_TUI_DIR, MODULE_POWERBI_TUI_DIR, MODULE_PORTFOLIO_TUI_DIR]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
      out.add(file.replace(/\.tsx$/, ''));
    }
  }
  return out;
}

describe('CLI/TUI parity gate (#0261)', () => {
  it('CLI command set matches the expected list (catches accidental adds/removes)', () => {
    const fromIndex = listCliCommandsFromIndex();
    const fromCmdsDir = listCliCommandsFromCommandsDir();
    const found = new Set([...fromIndex, ...fromCmdsDir]);
    expect(found).toEqual(EXPECTED_CLI_COMMANDS);
  });

  it('TUI screen set matches the expected list (catches accidental adds/removes)', () => {
    const found = listTuiScreens();
    expect(found).toEqual(EXPECTED_TUI_SCREENS);
  });

  it('every CLI command either has a TUI screen or is on the intentionally-CLI-only list', () => {
    const screens = listTuiScreens();
    // Map a CLI command name to its expected TUI screen name. Loose-match:
    // 'assess' -> 'AssessScreen', 'regime-select' -> 'RegimeSelectorScreen', etc.
    const screenByCommand: Record<string, string> = {
      assess: 'AssessScreen',
      credential: 'CredentialScreen',
      'health-check': 'HealthCheckScreen',
      export: 'ExportBiScreen',
      'generate-tf': 'GenerateTfScreen',
      license: 'LicenseScreen',
      report: 'ReportScreen',
      setup: 'SetupWizard',
      'regime-select': 'RegimeSelectorScreen',
      publish: 'PublishScreen',
      lenses: 'LensesScreen',
      ingest: 'IngestScreen',           // #0967 -- pre-process ingestion/; Tools submenu
      'support-bundle': 'SupportBundleScreen', // #1477 sprint-116 -- PII-free diagnostic archive
    };
    for (const cmd of EXPECTED_CLI_COMMANDS) {
      if (CLI_ONLY.has(cmd)) continue;
      const expectedScreen = screenByCommand[cmd];
      expect(expectedScreen, `CLI command "${cmd}" has no expected TUI screen mapping`).toBeDefined();
      expect(screens.has(expectedScreen), `TUI screen "${expectedScreen}" missing for CLI "${cmd}"`).toBe(true);
    }
  });

  it('challenge is in CLI_ONLY but ChallengeScreen still exists (known intentional drift)', () => {
    // challenge is listed in CLI_ONLY with a TODO note, but ChallengeScreen
    // does exist. The CLI_ONLY entry means the parity loop skips the TUI check
    // for it -- the screen's existence is still asserted here as a guard.
    expect(listTuiScreens().has('ChallengeScreen')).toBe(true);
  });

  it('PortfolioScreen exists alongside assess --portfolio CLI flag (#0259 drift item)', () => {
    // Sprint 028 audit flagged PortfolioScreen as "partially wired -- assess
    // mode shows a placeholder". The screen file exists; #0259 tracks the
    // wiring. This assertion guards against the screen being deleted by
    // accident while the CLI flag remains.
    expect(listTuiScreens().has('PortfolioScreen')).toBe(true);
    const assessSrc = readFileSync(join(COMMANDS_DIR, 'assess.ts'), 'utf-8');
    expect(assessSrc).toContain('--portfolio');
  });
});

// ── MCP tool parity gate (#0673) ─────────────────────────────────────────────
// The MCP server exposes tool names that must stay in sync with CLI commands.
// This gate pins the complete tool list so accidental renames or deletions fail
// fast -- the same lesson as the CLI/TUI gate above.

function listMcpTools(): Set<string> {
  const src = readFileSync(MCP_SERVER_SRC, 'utf-8');
  // Match `name: 'swao_xxx'` lines in the SWAO_MCP_TOOLS array definition.
  // The regex also picks up the switch cases -- deduplicated via Set.
  const re = /name:\s*['"]([a-z][a-z0-9_]+)['"]/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  return found;
}

// Complete MCP tool list. Update when adding or renaming a tool.
// #0673: swao_doctor renamed to swao_health_check for CLI/MCP parity.
const EXPECTED_MCP_TOOLS = new Set([
  'swao',
  'swao_assess',
  'swao_report',
  'swao_health_check',
  'swao_hub',
  'swao_challenge',
  'swao_import',
  'swao_signal_detail',
  'swao_signals',
  'swao_explain_landing_zone',
  'swao_control_detail',
  'swao_costs',
  'swao_risks',
  'swao_portfolio_summary',
  'swao_lzr_weights',
  'swao_publish',
  'swao_publish_site',
  'swao_lenses',
  'swao_normalize',
  'swao_portal_query',
  'swao_lz_catalogue',
  // #0596 (sprint-073) -- separate list/show/fit tools for CLI/MCP parity.
  'swao_lz_catalogue_list',
  'swao_lz_catalogue_show',
  'swao_lz_fit',
  // Sprint-104 M32 MCP Integration tools (#1172-#1194).
  'swao_annotate',
  'swao_cloud_provider_catalogue',
  'swao_control_catalogue',
  'swao_evidence_capture',
  'swao_feedback_add',
  'swao_feedback_list',
  'swao_framework_detail',
  'swao_frameworks_list',
  'swao_ingest',
  'swao_passes',
  'swao_portfolio_lz',
  'swao_portfolio_query',
  'swao_portfolio_risks',
  'swao_portfolio_stats',
  'swao_risk_import',
  // #1214 (sprint-105) -- workspace inventory tool.
  'swao_workspace_inventory',
  // Sprint-104 prompt name + argument names (picked up by the name-regex scanner
  // from the swao_evidence_interview prompt definition in server.ts).
  'swao_evidence_interview',
  'app_id',
  'control_filter',
  'min_severity',
  'signal_filter',
]);

// CLI commands that have a direct MCP tool counterpart.
// Not every CLI command needs an MCP tool (e.g. init, menu, install-playwright
// are interactive/setup-time and have no MCP analogue).
const MCP_CLI_MAP: Record<string, string> = {
  swao_assess:              'assess',
  swao_report:              'report',
  swao_health_check:        'health-check',
  swao_challenge:           'challenge',
  swao_publish:             'publish',
  swao_lenses:              'lenses',
  swao_normalize:           'normalize',
  swao_lz_catalogue:        'lz',
  swao_lz_catalogue_list:   'lz',
  swao_lz_catalogue_show:   'lz',
  swao_lz_fit:              'lz',
};

describe('CLI/MCP parity gate (#0673)', () => {
  it('MCP tool set matches the expected list (catches accidental adds/removes/renames)', () => {
    const found = listMcpTools();
    expect(found).toEqual(EXPECTED_MCP_TOOLS);
  });

  it('swao_health_check is in MCP tools (not the old swao_doctor name)', () => {
    const found = listMcpTools();
    expect(found.has('swao_health_check')).toBe(true);
    expect(found.has('swao_doctor')).toBe(false);
  });

  it('every MCP tool with a CLI counterpart maps to a registered CLI command', () => {
    const cliCommands = new Set([...listCliCommandsFromIndex(), ...listCliCommandsFromCommandsDir()]);
    for (const [mcpTool, cliCmd] of Object.entries(MCP_CLI_MAP)) {
      expect(
        cliCommands.has(cliCmd),
        `MCP tool "${mcpTool}" maps to CLI command "${cliCmd}" which is not registered`,
      ).toBe(true);
    }
  });
});
