#!/usr/bin/env node
// verify-surface-sync.mjs (#0574, Sprint-062 Phase 4)
//
// Three-surface sync gate: for every CLI command shipped by SWAO, confirm it
// either has the matching TUI screen + MCP tool, or is on an explicit, rationalised
// exception list for the surface it omits. Catches the failure mode where a new
// command lands on one surface (say the CLI) but silently misses the TUI or the
// MCP tool that AI-assistant users depend on.
//
// This complements the in-suite cli-tui-parity gate (CLI<->TUI). It adds the
// third axis (CLI<->MCP) and runs standalone in CI without vitest:
//   node swao/scripts/verify-surface-sync.mjs
// Exit 0 = all commands accounted for; exit 1 = an un-rationalised gap.
//
// The TUI exception set (CLI_ONLY) is kept in lockstep with
// packages/swao/src/__tests__/cli-tui-parity.test.ts -- that test remains the
// source of truth for the CLI<->TUI axis; if you change it, change this too.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SWAO_ROOT = join(__dirname, '..'); // .../swao
const PKG = join(SWAO_ROOT, 'packages');

const INDEX_TS = join(PKG, 'swao', 'src', 'index.ts');
const COMMAND_DIRS = [
  join(PKG, 'swao', 'src', 'commands'),
  join(PKG, '@swao', 'module-app-assessment', 'src', 'commands'),
  // #1434: the audit module (and its command group) was removed.
  join(PKG, '@swao', 'module-landing-zone', 'src', 'commands'),
  join(PKG, '@swao', 'module-health-check', 'src', 'commands'),
  join(PKG, '@swao', 'module-mcp', 'src', 'commands'),
  // #0578: generate-tf relocated to the terraform module; its register fn lives
  // at the module's src root (no commands/ subdir), so scan src directly.
  join(PKG, '@swao', 'module-terraform', 'src'),
  // #0580: challenge relocated to the challenge module; its register fn lives at
  // the module's src root (no commands/ subdir), so scan src directly.
  join(PKG, '@swao', 'module-challenge', 'src'),
  // #0577: export relocated to the powerbi module; its register fn lives at the
  // module's src root (no commands/ subdir), so scan src directly.
  join(PKG, '@swao', 'module-powerbi', 'src'),
];
const SCREEN_DIRS = [
  join(PKG, 'swao', 'src', 'tui', 'screens'),
  join(PKG, '@swao', 'module-app-assessment', 'src', 'tui'),
  join(PKG, '@swao', 'module-health-check', 'src', 'tui'),
  // #0578: GenerateTfScreen relocated to the terraform module.
  join(PKG, '@swao', 'module-terraform', 'src', 'tui'),
  // #0580: ChallengeScreen relocated to the challenge module.
  join(PKG, '@swao', 'module-challenge', 'src', 'tui'),
  // #0577: ExportBiScreen relocated to the powerbi module.
  join(PKG, '@swao', 'module-powerbi', 'src', 'tui'),
  // #0579: PortfolioScreen relocated to the portfolio module.
  join(PKG, '@swao', 'module-portfolio', 'src', 'tui'),
];
const MCP_SERVER_TS = join(PKG, '@swao', 'module-mcp', 'src', 'server.ts');

// --- surface scanners -------------------------------------------------------

function scanCliCommands() {
  const out = new Set();
  const idx = readFileSync(INDEX_TS, 'utf-8');
  for (const m of idx.matchAll(/\.command\(\s*['"]([a-z][a-z0-9-]*)/g)) out.add(m[1]);
  const re = /program\s*\n?\s*\.command\(\s*['"]([a-z][a-z0-9-]*)/g;
  for (const dir of COMMAND_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = readFileSync(join(dir, file), 'utf-8');
      for (const m of src.matchAll(re)) out.add(m[1]);
    }
  }
  return out;
}

function scanTuiScreens() {
  const out = new Set();
  for (const dir of SCREEN_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
      out.add(file.replace(/\.tsx$/, ''));
    }
  }
  return out;
}

function scanMcpTools() {
  const out = new Set();
  const src = readFileSync(MCP_SERVER_TS, 'utf-8');
  for (const m of src.matchAll(/name:\s*'(swao_[a-z_]+)'/g)) out.add(m[1]);
  return out;
}

// --- expectation maps -------------------------------------------------------

// CLI command -> TUI screen basename (the command's interactive surface).
const TUI_BY_COMMAND = {
  assess: 'AssessScreen',
  credential: 'CredentialScreen',
  doctor: 'HealthCheckScreen',
  export: 'ExportBiScreen',
  'generate-tf': 'GenerateTfScreen',
  license: 'LicenseScreen',
  report: 'ReportScreen',
  setup: 'SetupWizard',
  'regime-select': 'RegimeSelectorScreen',
  publish: 'PublishScreen',
  lenses: 'LensesScreen',
};

// Commands intentionally without a TUI screen. Kept in lockstep with the
// CLI_ONLY map in cli-tui-parity.test.ts (the CLI<->TUI source of truth).
const TUI_ABSENT = new Map([
  ['mcp', 'stdio/http server -- no interactive UI'],
  ['menu', 'TUI entry point itself; routed via App.tsx'],
  ['init', 'workspace bootstrap; SetupWizard absorbs the flow'],
  ['challenge', 'ChallengeScreen exists but command is CLI-driven (#0259)'],
  ['install-playwright', 'install helper (#0259 -- DoctorScreen Install button TODO)'],
  ['migrate-workspace', 'one-shot operator helper; not on the daily path'],
  ['log', 'diagnostic log reader; expert operator path'],
  ['framework', 'Community Frameworks management; TUI carries to a follow-up'],
  ['normalize', 'batch input normaliser; no TUI in v1'],
  ['diff', 'assessment run comparison; operator expert path'],
  ['accept', 'accepted-run lock management; CLI-only workflow'],
  ['lz', 'landing-zone command group; TUI carries to #0553'],
  ['lenses', 'LensesScreen exists (Tools submenu); command is CLI-also'],
  ['regime-select', 'interactive selector; runs as a subprocess'],
  ['generate-tf', 'GenerateTfScreen exists; command is CLI-also'],
]);

// CLI command -> the MCP tool that exposes it to AI-assistant users.
const MCP_BY_COMMAND = {
  assess: 'swao_assess',
  report: 'swao_report',
  doctor: 'swao_doctor',
  challenge: 'swao_challenge',
  publish: 'swao_publish',
  lenses: 'swao_lenses',
  normalize: 'swao_normalize',
  lz: 'swao_lz_catalogue',
};

// Commands intentionally without an MCP tool. The MCP surface targets the
// assess -> read -> report loop an AI assistant drives; local setup / licence /
// credential / file-producing utilities are deliberately out of scope.
const MCP_ABSENT = new Map([
  ['init', 'local workspace bootstrap; not an assistant-driven action'],
  ['setup', 'interactive setup wizard; local-only'],
  ['credential', 'OS keychain management; local-only, security-sensitive'],
  ['license', 'licence key install/inspect; local-only'],
  ['menu', 'TUI entry point; not an MCP action'],
  ['mcp', 'the MCP server itself; cannot expose a tool to run itself'],
  ['install-playwright', 'downloads a browser; local environment action'],
  ['migrate-workspace', 'one-shot on-disk migration; local-only'],
  ['regime-select', 'interactive selector; subprocess helper'],
  ['generate-tf', 'Terraform HCL generator; file-producing local op'],
  ['log', 'diagnostic log reader; local operator path'],
  ['framework', 'Community Frameworks management; local catalogue op'],
  ['export', 'BI bundle file producer; assistants read via swao_signals et al.'],
  ['diff', 'run comparison; operator expert path'],
  ['accept', 'accepted-run lock; local workflow'],
]);

// --- gate -------------------------------------------------------------------

const cli = scanCliCommands();
const screens = scanTuiScreens();
const tools = scanMcpTools();

const violations = [];
const matrix = [];

for (const cmd of [...cli].sort()) {
  // TUI axis
  let tui;
  if (TUI_BY_COMMAND[cmd]) {
    tui = screens.has(TUI_BY_COMMAND[cmd]) ? TUI_BY_COMMAND[cmd] : null;
    if (!tui) violations.push(`CLI "${cmd}" expects TUI screen ${TUI_BY_COMMAND[cmd]} but it is missing`);
  } else if (TUI_ABSENT.has(cmd)) {
    tui = `(none -- ${TUI_ABSENT.get(cmd)})`;
  } else {
    tui = null;
    violations.push(`CLI "${cmd}" has no TUI screen and no TUI-absent rationale (add to TUI_BY_COMMAND or TUI_ABSENT)`);
  }
  // MCP axis
  let mcp;
  if (MCP_BY_COMMAND[cmd]) {
    mcp = tools.has(MCP_BY_COMMAND[cmd]) ? MCP_BY_COMMAND[cmd] : null;
    if (!mcp) violations.push(`CLI "${cmd}" expects MCP tool ${MCP_BY_COMMAND[cmd]} but it is missing`);
  } else if (MCP_ABSENT.has(cmd)) {
    mcp = `(none -- ${MCP_ABSENT.get(cmd)})`;
  } else {
    mcp = null;
    violations.push(`CLI "${cmd}" has no MCP tool and no MCP-absent rationale (add to MCP_BY_COMMAND or MCP_ABSENT)`);
  }
  matrix.push({ cmd, tui, mcp });
}

// --- assessment-type parity (within the assess command) -----------------------
// Source of truth: AssessmentTypeScreen.tsx (TUI) vs assess-router.ts (CLI).
// MCP gap: swao_assess does not expose --type; tracked in child issue #0643.
// The unit test (AssessmentTypeScreen.test.ts) is the primary gate for flag
// correctness; this check guards against the flag being silently reverted.
const SCREEN_SRC = readFileSync(
  join(PKG, '@swao', 'module-app-assessment', 'src', 'tui', 'AssessmentTypeScreen.tsx'),
  'utf-8',
);
// #1434: 'audit' removed from the runnable set with the audit assessment surface.
const RUNNABLE_TYPES = ['application', 'landing-zone'];
for (const t of RUNNABLE_TYPES) {
  // Confirm type: '<t>' appears within ~200 chars before available: true in same block.
  if (!new RegExp(`type:\\s*'${t}'[\\s\\S]{0,200}?available:\\s*true`).test(SCREEN_SRC)) {
    violations.push(`TUI AssessmentTypeScreen: type "${t}" is runnable on CLI but not marked available:true (recheck after #0638 fix)`);
  }
}

// Informational: MCP tools that map to no CLI command (read-only conveniences
// over a produced WSP -- expected; not a failure).
const mappedTools = new Set(Object.values(MCP_BY_COMMAND).concat(['swao_publish_site']));
const orphanTools = [...tools].filter((t) => !mappedTools.has(t)).sort();

console.log('SWAO three-surface sync (CLI -> TUI + MCP)\n');
for (const { cmd, tui, mcp } of matrix) {
  console.log(`  ${cmd.padEnd(20)} TUI: ${String(tui).padEnd(40)} MCP: ${mcp}`);
}
if (orphanTools.length) {
  console.log(`\n  MCP read-only tools (no CLI command, expected): ${orphanTools.join(', ')}`);
}

if (violations.length) {
  console.error(`\nSURFACE SYNC FAILED -- ${violations.length} gap(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`\nOK -- all ${matrix.length} CLI commands have their expected surfaces (or a rationalised exception).`);
process.exit(0);
