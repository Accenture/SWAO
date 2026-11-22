// #4283: the `swao init` workspace template (buildWorkspaceSwaoYml in
// commands/init.ts) with example engagement values, plus the Setup Wizard
// record as setup/workspace-state.ts writes it (one flow-style line each,
// Design 125 section 7). No owner data. init.ts is not imported because it
// pulls in the bundled module packages; lenses.test.ts pins every template
// line against the init.ts source so the fixture cannot drift.

export const INIT_TEMPLATE = [
  '# .swao.yml -- SWAO workspace configuration',
  'wsp_version: "0.9"',
  '',
  'engagement:',
  '  name: "Example"',
  '  client_code: "EX"',
  '  start_date: "2026-11-09"',
  '  partnership_lead: "Lead"',
  '',
  'providers:',
  '  llm:',
  '    primary:',
  '      type: ~',
  '      model: ~',
  '  redactor:',
  '    type: pattern',
  'imports_dir: wsp/inputs/  # workspace-level shared inputs (frameworks, templates)',
  '',
  '# workspace:',
  '#   run_retention:',
  '#     keep_latest: 10  # keep only the 10 most recent assessment runs per app',
  '',
  '# publication:',
  '#   cover_subtitle: "Cloud Sovereignty Assessment"',
  '#   classification_band: "Client Confidential"',
  '#   engagement_lead: "Lead"',
  '#   logo_name: "SWAO"',
  '',
  '# assessment:',
  '#   vision_max_screens: 2  # screenshots sent to LLM vision pass per assessment run',
  '#   test_code:             # #3403: include (default) | tag | exclude; an app .swao.yml overrides',
  '#     mode: include',
  '',
  '# LZ catalogue targets for every app (#3281); nest under assessment: (an app .swao.yml overrides):',
  '#   landing_zone:',
  '#     targets: [stackit:eu01, azure:germanywestcentral]  # <provider>:<region> or <provider>:<geography> (e.g. azure:Europe)',
  '',
].join('\n');

/** The Setup Wizard `workspace:` record appended after a branch was set up. */
export const WIZARD_RECORD = [
  '',
  'workspace:',
  '  assessment_types: [application]',
  "  setup_state: { application: { state: ready, checked_at: '2026-11-09T13:30:00.000Z', fail_count: 0, warn_count: 1 } }",
  '',
].join('\n');

/** The workspace file after `swao init` and one Setup Wizard branch. */
export const INIT_WORKSPACE_YML = `${INIT_TEMPLATE.trimEnd()}\n${WIZARD_RECORD}`;

/** Every line of `before` is still present in `after`, in the same order. */
export function keepsAllLinesInOrder(before: string, after: string): boolean {
  const a = after.split(/\r?\n/);
  let at = 0;
  for (const l of before.split(/\r?\n/)) {
    const idx = a.indexOf(l, at);
    if (idx < 0) return false;
    at = idx + 1;
  }
  return true;
}
