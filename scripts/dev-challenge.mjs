#!/usr/bin/env node
/**
 * Dev bypass for the challenge interactive session.
 * Calls runChallengeSession() directly, skipping the Premium licence gate.
 *
 * Usage:
 *   node scripts/dev-challenge.mjs [agent-id] [app-id]
 *
 * Defaults:
 *   agent-id  grc-compliance-officer
 *   app-id    sovereign-health
 *
 * Agent IDs:
 *   application-architect
 *   business-owner
 *   grc-compliance-officer
 *   finops-lead
 *   programme-manager
 *
 * Set SWAO_LLM_PROVIDER=stub (default) for offline demo with fixture responses.
 * Set SWAO_LLM_PROVIDER=anthropic + SWAO_ANTHROPIC_API_KEY for live LLM.
 */

import { createInterface } from 'readline';
import { resolve, join, dirname } from 'path';
import { existsSync, cpSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const SWAO_DIST = join(REPO_ROOT, 'packages', 'swao', 'dist');
const SWAO_SRC  = join(REPO_ROOT, 'packages', 'swao', 'src');

// Ensure fixture files are present in dist (tsc does not copy JSON)
const srcFixtures  = join(SWAO_SRC,  'passes', 'fixtures');
const distFixtures = join(SWAO_DIST, 'passes', 'fixtures');
if (existsSync(srcFixtures) && !existsSync(distFixtures)) {
  cpSync(srcFixtures, distFixtures, { recursive: true });
} else if (existsSync(srcFixtures)) {
  // Always sync so new stubs are picked up without a rebuild
  cpSync(srcFixtures, distFixtures, { recursive: true });
}

// --- Parse CLI args ---
const args = process.argv.slice(2);
const VALID_AGENTS = [
  'application-architect',
  'business-owner',
  'grc-compliance-officer',
  'finops-lead',
  'programme-manager',
];

let agentId = args[0] ?? 'grc-compliance-officer';
let appId   = args[1] ?? 'sovereign-health';

if (!VALID_AGENTS.includes(agentId)) {
  console.error(`[dev-challenge] Unknown agent "${agentId}"`);
  console.error(`Valid agents: ${VALID_AGENTS.join(', ')}`);
  process.exit(1);
}

// Default workspace: examples/portfolio-workspace/portfolio
const WORKSPACE = join(REPO_ROOT, 'examples', 'portfolio-workspace', 'portfolio');
const appDir = join(WORKSPACE, 'apps', appId);

if (!existsSync(appDir)) {
  console.error(`[dev-challenge] App directory not found: ${appDir}`);
  process.exit(1);
}

// --- Default to stub provider ---
process.env['SWAO_LLM_PROVIDER'] ??= 'stub';

// --- Dynamic imports from compiled dist (file:// required on Windows) ---
const { runChallengeSession, AGENT_IDS } = await import(
  pathToFileURL(join(SWAO_DIST, 'commands', 'challenge.js')).href
);
const { buildWspSummary } = await import(
  pathToFileURL(join(SWAO_DIST, 'challenge', 'loader.js')).href
);
const { createLlmProvider } = await import(
  pathToFileURL(join(SWAO_DIST, 'providers', 'llm', 'index.js')).href
);

const roleName = AGENT_IDS[agentId];
const wsp      = buildWspSummary(appDir);
const llm      = createLlmProvider(appId, `challenge-${agentId}`);

console.log('');
console.log('='.repeat(72));
console.log(`  SWAO Challenge Session  --  ${roleName}`);
console.log(`  App: ${appId}   Provider: ${process.env['SWAO_LLM_PROVIDER']}`);
console.log('='.repeat(72));
console.log('  Type your response and press Enter. Type "exit" to end.');
console.log('='.repeat(72));
console.log('');

const rl = createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: '> ',
});

const { transcript } = await runChallengeSession(
  agentId,
  wsp,
  llm,
  rl,
  line => {
    console.log('');
    console.log(`${roleName}:`);
    console.log(line);
    console.log('');
    if (!rl.closed) rl.prompt();
  },
  {
    onContextWarning: (turnsUsed, limit) => {
      console.log(
        `\n[challenge] Approaching context limit (${turnsUsed}/${limit} turns).\n`,
      );
    },
  },
);

console.log('');
console.log(`[dev-challenge] Session ended. ${transcript.length} turns recorded.`);
