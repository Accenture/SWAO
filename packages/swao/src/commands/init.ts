// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI + orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
import { Command } from 'commander';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { scaffoldWorkspaceGateway } from '@swao/module-llm-providers';
import { resolveLzCataloguesDir } from '@swao/module-landing-zone';


const __dirname = dirname(fileURLToPath(import.meta.url));

// #0622: one shared SWAO ASCII header helper so all scaffold placeholder files
// carry the same branding + backlinks. `style='slash'` produces `// ===` blocks
// (Markdown / plain text); `style='hash'` produces `# ===` blocks (YAML).
// #0738: edition label is read from the license state so Enterprise / Consultant
// workspaces get the correct edition in their scaffold file headers.
function swaoFileHeader(purpose: string, style: 'slash' | 'hash' = 'slash'): string {
  const c = style === 'hash' ? '#' : '//';
  return (
    `${c} ================================================================\n` +
    `${c}\n` +
    `${c}                    S  W  A  O\n` +
    `${c}\n` +
    `${c}  Sovereign Workload Assessment and Onboarding\n` +
    `${c}  ${purpose}\n` +
    `${c}\n` +
    `${c}  Free and Open-Source Software (FOSS)\n` +
    `${c}\n` +
    `${c}  Website       :  https://steady-echo-yp4z.here.now/\n` +
    `${c}  Technical Docs:  https://accenture.github.io/SWAO/en/\n` +
    `${c}  Source Code   :  https://github.com/Accenture/SWAO\n` +
    `${c}\n` +
    `${c} ================================================================\n` +
    '\n'
  );
}

// Sprint-039 #0358 Phase 3 -- standard scope retired. The bundled
// `swao/controls/standard/` folder was deleted; every flagship regime
// (GDPR / HIPAA / PCI_DSS / ISO_27001 / SOC_2 / BSI_C5 / DORA) ships as
// a community framework via the bundled `community-frameworks/` tree.
// `scaffoldCatalogs()` now scaffolds `wsp/inputs/catalogs/community/`
// only; the `--reconfigure` flag refreshes the community mirror.

// Bundled community frameworks (sprint-037 #0340; relocated #0572). The
// catalogues now live in the @swao/controls-community leaf content package
// (frameworks/<id>/ -- framework-meta.yaml + controls.yaml [+ evidence/] plus
// an `_registry.yaml` index). The init scaffolder mirrors these into
// `<workspace>/wsp/inputs/catalogs/community/.bundled/<id>/` so `swao assess`
// sees them out of the box. Engagement-authored community catalogues sit
// alongside at `<workspace>/wsp/inputs/catalogs/community/<id>/` and are
// tracked in version control; the bundled mirror is gitignored. The source
// path is owned + resolved by @swao/controls-community (configurable via
// SWAO_COMMUNITY_FRAMEWORKS_DIR), so consultant/enterprise content packages
// can supply their own dir without editing this file.
const BUNDLED_COMMUNITY_DIR = communityFrameworksDir;

// Bundled PowerBI templates (#0231). Same path-probing approach as the
// standard catalogs above -- pkg flattens dist/, so the relative path
// from src/commands/ differs between dev (4 up) and pkg snapshot (3 up).
function resolveBundledPowerBiDir(): string {
  const candidates = [
    resolve(__dirname, '../../../../docs/templates/powerbi'),
    resolve(__dirname, '../../../docs/templates/powerbi'),
    resolve(__dirname, '../../docs/templates/powerbi'),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* try next */ }
  }
  return candidates[0]!;
}
const BUNDLED_POWERBI_DIR = resolveBundledPowerBiDir();

// Bundled landing-zone snapshot samples (#0232). The LZR pass discovers files
// like lz-aws-snapshot.json / lz-azure-snapshot.json / lz-meshstack-snapshot.json under
// each app's imports/ directory; scaffolding one sample gives the operator
// a working starting point + reference format.
function resolveBundledLzStubsDir(): string {
  // Use a known file as the existence probe instead of the directory: pkg's snapshot VFS
  // tracks files, not intermediate directories, so existsSync(dir) returns false inside a
  // pkg binary even when the directory's files are bundled (#1153).
  const probe = 'lz-azure-snapshot.json';
  const candidates = [
    resolve(__dirname, '../../../../../examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp/inputs/terraform'),
    resolve(__dirname, '../../../../examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp/inputs/terraform'),
    resolve(__dirname, '../../../examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp/inputs/terraform'),
    resolve(__dirname, '../../examples/portfolio-workspace/portfolio/apps/ghostfolio/wsp/inputs/terraform'),
  ];
  for (const c of candidates) {
    try { if (existsSync(join(c, probe))) return c; } catch { /* try next */ }
  }
  return candidates[0]!;
}
const BUNDLED_LZ_STUBS_DIR = resolveBundledLzStubsDir();

// App-level .swao.yml shared by `swao init` and TUI AssessScreen. Paths are
// under `wsp/inputs/` so customer inputs and SWAO outputs sit beside each
// other inside the per-app `wsp/` folder (everything-under-wsp restructure,
// #0227). Optional vcs block lets the TUI's new-app flow capture clone
// settings.
export interface AppYamlOptions {
  appId: string;
  appName?: string;
  vcsType?: 'github' | 'gitlab' | 'azure-devops';
  vcsUrl?: string;
  vcsRef?: string;
  vcsSubdir?: string;
  /** #0386 (sprint-040): when set, source.path is written as this absolute
   *  local-filesystem path and no source.vcs block is emitted. Lets the
   *  operator point SWAO at a working tree on disk rather than asking it
   *  to clone a repo. Takes precedence over vcsSubdir derivation. */
  sourcePathOverride?: string;
  regimes?: readonly string[];
  /** #0723: pre-fill assessor: with partnership_lead from workspace .swao.yml */
  assessorEmail?: string;
  /** #1050: optional pass subset written as assessment.pass_profile ([] or omitted = all passes) */
  passProfile?: string[];
}

export function appSwaoYmlTemplate(opts: AppYamlOptions): string {
  const { appId, appName, vcsType, vcsUrl, vcsRef, vcsSubdir, sourcePathOverride, regimes, assessorEmail, passProfile } = opts;
  // #0395 (sprint-040): defence-in-depth. If vcsSubdir is a URL (operator
  // pasted a GitHub tree URL at the subdir prompt before the TUI sanitiser
  // landed, or a hand-edited yaml carries one), strip it to the path-
  // after-tree. Otherwise Windows refuses the source/ folder name and
  // git clone exits 128. Idempotent: bare subdir paths pass through.
  let rawSubdir = vcsSubdir ?? '';
  const treeMatch = rawSubdir.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+)$/i);
  if (treeMatch) rawSubdir = treeMatch[1] ?? '';
  if (/^[a-zA-Z]+:\/\//.test(rawSubdir) || rawSubdir.includes(':')) {
    // Still URL-shaped or contains a colon -> drop it; the operator can
    // fix .swao.yml + re-run.
    rawSubdir = '';
  }
  const cleanSubdir = rawSubdir.replace(/^\/+|\/+$/g, '');
  // #1046: source.path always points to the clone root; subdirectory is
  // expressed in source.vcs.subdir so the clone target is stable regardless
  // of which sub-path is analysed.
  const sourcePath = sourcePathOverride ? sourcePathOverride : 'wsp/inputs/source/';

  const lines: string[] = [
    `# .swao.yml -- SWAO app configuration`,
    `# Per-app config. Inputs live under wsp/inputs/; outputs (runs, exports,`,
    `# reports) land under wsp/runs|exports|reports/.`,
    `wsp_version: "0.9"`,
    `app_id: ${appId}`,
    ...(appName ? [`app_name: "${appName}"`] : [`# app_name: "Human-readable display name"  # optional`]),
    `assessor: ${assessorEmail ? `"${assessorEmail}"` : '~'}`,
    // #1048: imports_dir is the per-app input root; workspace-level imports_dir
    // lives in the workspace .swao.yml and is distinct from this per-app value.
    `imports_dir: wsp/inputs/  # per-app input root; Pass 00 routes ingestion/ files here`,
    ``,
    `source:`,
    `  path: ${sourcePath}`,
  ];

  if (vcsUrl && !sourcePathOverride) {
    lines.push(`  vcs:`);
    lines.push(`    type: ${vcsType ?? 'github'}`);
    lines.push(`    url: ${vcsUrl}`);
    lines.push(`    ref: ${vcsRef || 'main'}`);
    // #1046: emit subdir when set so the clone is of the repo root and
    // analysis is scoped to the subdirectory without baking it into the path.
    if (cleanSubdir) lines.push(`    subdir: ${cleanSubdir}`);
  }


  // #1045: document run_retention so operators know how to control disk usage.
  lines.push(``);
  lines.push(`# run_retention: 5  # optional: keep this many latest runs in wsp/runs/ (default: unlimited)`);

  // #1049: publication block stub so operators know where to add custom output config.
  lines.push(`# publication:`);
  lines.push(`#   template: wsp/templates/html/publication.html.tmpl  # optional custom template`);

  // #1042: only emit explicit regime IDs; 'all' is not a valid framework identifier.
  const validRegimes = (regimes ?? []).filter(r => r !== 'all');
  // #1050: emit pass_profile when the wizard supplied a lens selection.
  const validProfile = (passProfile ?? []).filter(Boolean);
  if (validRegimes.length > 0 || validProfile.length > 0) {
    // #0755: compliance-evaluator reads assessment.regimes_active (since #0748).
    lines.push(``);
    lines.push(`assessment:`);
    if (validRegimes.length > 0) {
      lines.push(`  regimes_active:`);
      for (const r of validRegimes) lines.push(`    - ${r}`);
    }
    if (validProfile.length > 0) {
      lines.push(`  pass_profile:`);
      for (const p of validProfile) lines.push(`    - ${p.toLowerCase()}`);
    } else {
      lines.push(`  # pass_profile: []  # optional: pass subset (run swao lenses list for options)`);
    }
  } else {
    // #1050: no regimes yet -- emit the assessment block as comments so the
    // operator knows how to configure regimes and pass_profile after creation.
    lines.push(``);
    lines.push(`# assessment:         # configure via TUI Regime Selector + Pass Selector, or edit below`);
    lines.push(`#   regimes_active:   # compliance frameworks to evaluate (swao lenses list shows IDs)`);
    lines.push(`#     - GDPR_DEMO`);
    lines.push(`#   pass_profile: []  # pass subset to run (empty = all passes)`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Scaffold the per-app inputs tree: creates `<appDir>/wsp/inputs/` so the
 * directory exists before the first assessment run.
 *
 * All wsp/inputs/ subfolders are created dynamically by Pass 00 (INGEST) as
 * files are routed from ingestion/. No sample files are written -- operators
 * supply their own CMDB / ServiceNow exports and wire them in context_inputs:.
 *
 * Idempotent: calling again on an existing directory is a no-op.
 */
export function scaffoldImports(appDir: string): void {
  mkdirSync(join(appDir, 'wsp', 'inputs'), { recursive: true });
}

const INGESTION_README = `# ingestion/

## Purpose

Drop your files here before running \`swao assess\`. SWAO's Pass 00 (INGEST)
runs automatically before the main assessment passes and routes each file into
\`wsp/inputs/\` using content-based classification, recording a SHA-256
provenance manifest so every finding is traceable to its source.

## Routing rules (content-based, #0963)

| Filename pattern | Routed to |
|---|---|
| \`workshop*.docx\`, \`meeting*.docx\`, any \`.docx\` | \`wsp/inputs/workshops/\` |
| \`*dpa*.pdf\`, \`*agreement*.pdf\`, \`*legal*.pdf\`, \`*soc*.pdf\` | \`wsp/inputs/compliance/\` |
| \`*sbom*\`, \`*bom*\`, \`*bill-of-materials*\` (.xlsx / .csv / .xml / .json / .cdx) | \`wsp/inputs/compliance/\` |
| \`*policy*.pdf\`, \`*procedure*.pdf\` | \`wsp/inputs/architecture/guardrails/\` |
| \`*arch*.md\`, \`*design*.md\`, any \`.md\`, \`*.txt\` | \`wsp/inputs/architecture/\` |
| \`*.pptx\` | \`wsp/inputs/architecture/\` |
| \`*.csv\`, \`*.xlsx\` (no specific pattern) | \`wsp/inputs/operations/\` |
| \`*.yaml\`, \`*.yml\`, \`*.json\` (no IaC keyword) | \`wsp/inputs/structured/\` |
| \`*.tf\`, \`*.hcl\`, \`*terraform*.yaml\` | \`wsp/inputs/terraform/\` |
| JPEG / PNG images | auto-wrapped as PDF -- placed in \`wsp/inputs/docs/\` |
| Other images (.gif, .svg, ...) | rejected with a warning |
| Archives (.zip, .tar, ...) | rejected with a warning -- not copied |
| XPS | copied to \`wsp/inputs/intake/\` with a warning (no text extraction) |
| Anything else | \`wsp/inputs/intake/\` |

## Binary text extraction (#0966)

PDF, DOCX, XLSX, and PPTX files are copied AND their text is extracted into
companion files (\`.extracted.txt\`, \`.extracted.md\`, per-sheet \`.csv\`) so
the CTX LLM can read them. Files larger than 10 MB are copied without extraction.

For large document collections, run \`swao ingest\` first to pre-extract, then
\`swao assess\` will find a fresh manifest and skip re-processing.

## Delta detection and cleanup (#0962)

SWAO tracks SHA-256 hashes in \`ingestion/ingestion-manifest.json\`. On each
run only new or changed files are processed. Files removed from \`ingestion/\`
have their derived copies deleted from \`wsp/inputs/\` automatically.

## Result

After \`swao assess\` (or \`swao ingest\`) you will find:
- Files routed into \`wsp/inputs/<category>/\` (originals stay here).
- Companion extracted-text files alongside each binary.
- \`ingestion/ingestion-manifest.json\` with SHA-256 hashes + routing decisions.
`;

/**
 * Scaffold the per-app ingestion drop folder at \`<appDir>/ingestion/\`.
 *
 * The ingestion/ folder is a flat drop zone for unstructured files.
 * Pass 00 (INGEST) reads it before the main passes, auto-routes files into
 * wsp/inputs/, and writes a SHA-256 provenance manifest.
 *
 * Idempotent: existing files are not overwritten.
 */
export function scaffoldIngestion(appDir: string): void {
  const ingestionDir = join(appDir, 'ingestion');
  mkdirSync(ingestionDir, { recursive: true });

  const gitkeepPath = join(ingestionDir, '.gitkeep');
  if (!existsSync(gitkeepPath)) {
    writeFileSync(gitkeepPath, '', 'utf-8');
  }

  const readmePath = join(ingestionDir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, swaoFileHeader('Ingestion drop folder -- Pass 00 (INGEST)') + INGESTION_README, 'utf-8');
  }
}

const communityReadme = `# Community regime catalogues

This directory holds **engagement-writable** compliance regime catalogues
that extend or supersede the bundled standard regimes in
\`catalogs/standard/\`. Design 029 §11 unifies the previous overlay /
community split into a single scope. Each framework declares its
\`contributor:\` (the SWAO packager) and \`authority:\` (the upstream
issuing body) so a future audit can trace provenance.

## When to author a community framework

- You use a sector-specific framework not in the standard set
  (TISAX automotive, HITRUST healthcare, IT-Grundschutz public sector,
  IRS 1075 federal tax, etc.).
- You have an internal corporate security baseline you want SWAO to
  evaluate alongside the regulatory regimes.
- A regulator-published interpretation tightens or relaxes a standard
  control and the assessment must use the local rule.

## How to author a community framework (worked example: TISAX)

1. **Create the catalogue file** at \`catalogs/community/tisax-controls.yaml\`
   with the same shape as the standard catalogues. Every regime file opens
   with a \`regime_meta:\` block and a \`controls:\` array of at least one
   control:

   \`\`\`yaml
   regime_meta:
     id: TISAX
     name: "Trusted Information Security Assessment Exchange"
     version: "5.1"
     scope: community
     authority: "ENX Association"
     applicability_hints: [automotive, supply_chain]
     description: >
       Industry-standard for information security assessments shared
       across the European automotive supply chain.
     catalogue_version: "1.0.0"

   controls:
     - id: TISAX_1.6.1
       title: "Information security policy"
       description: "Documented and approved information security policy."
       evidence_basis:
         - signal_prefix: TF
   \`\`\`

2. **Register the file** by appending an entry to
   \`catalogs/community/index.yaml\`:

   \`\`\`yaml
   regimes:
     - id: TISAX
       name: "Trusted Information Security Assessment Exchange"
       version: "5.1"
       file: tisax-controls.yaml
       controls_count: 1
       applicability_hints: [automotive, supply_chain]
   \`\`\`

3. **Validate** with \`swao health-check\` -- the
   \`compliance-catalogues\` probe checks that the index entry, the file
   header, and the file contents agree.

4. **Activate** by re-running \`swao init --reconfigure\` (or editing
   \`.swao.yml\` directly) and ticking TISAX in the regime picker.

## Folder-per-framework alternative (design 029 §11)

For bundled community frameworks and any catalogue with its own evidence
files (questionnaires, scanner outputs, source PDFs), use the folder
shape: \`catalogs/community/<id>/{framework-meta.yaml, controls.yaml,
evidence/}\`. The loader auto-enumerates these folders when the legacy
\`index.yaml\` is absent. See \`swao/community-frameworks/\` for the
bundled examples.

## Superseding a standard regime (design 029 §11)

A community catalogue that wants to replace the bundled standard regime
declares \`regime_meta.replaces: [<standard_id>]\` -- for example a
community-authored GDPR with richer controls than the bundled stub:

\`\`\`yaml
regime_meta:
  id: GDPR
  scope: community
  replaces: [GDPR]
  ...
\`\`\`

Without the \`replaces:\` declaration the loader throws on the
id collision, so a misnamed community framework cannot silently shadow
a standard regime.

## Conflict resolution

- **Same regime ID across scopes without \`replaces:\`:** hard error;
  doctor probe surfaces the collision.
- **Same regime ID with \`replaces:\`:** community supersedes standard;
  doctor warns.
- **Same control ID inside one scope:** rejected by the doctor probe.

See the SWAO Technical Docs for the full schema and merge semantics.
`;

const emptyCommunityIndex = `# catalogs/community/index.yaml -- engagement-writable
# Initially empty. Add regime entries as you author community catalogues,
# or drop folder-per-framework catalogues (design 029 §11) into
# catalogs/community/<id>/ and the loader will auto-enumerate them.
# See README.md in this folder for a worked example (TISAX).

schema_version: "1"
scope: community
regimes: []
`;

const gitignoreContent = `# SWAO workspace -- never commit credentials or run-time outputs
.swao.secrets.env

# SWAO binary and launcher placed in the workspace root by swao init (#0968).
# Never commit -- GitHub hard-rejects pushes >100 MB.
swao-enterprise-win.exe
swao-community-win.exe
swao-consultant-win.exe
swao.bat

# Sprint-039 #0358 Phase 3 -- standard scope retired. Bundled community
# frameworks are mirrored by swao init into
# wsp/inputs/catalogs/community/.bundled/; engagement-authored catalogues
# sit alongside at wsp/inputs/catalogs/community/<id>/ and ARE tracked.
wsp/inputs/catalogs/community/.bundled/

# PowerBI templates are scaffolded from the binary on every \`swao export\`
# (#0231); not committed.
wsp/templates/powerbi/*.pbit

# SWAO outputs at both scopes (symmetric dual-wsp, #0230):
# - Portfolio scope: <workspace>/wsp/{runs,exports,reports}/
# - Per-app scope:   apps/<id>/wsp/{runs,exports,reports}/
# Note: wsp/inputs/ IS NOT ignored -- your context files
# (CMDB, FinOps, compliance docs, etc.) live there and should be
# committed alongside .swao.yml so the assessment is reproducible.
wsp/runs/
wsp/exports/
wsp/reports-app/
wsp/reports-lz/
wsp/logs/
wsp/latest.txt
apps/*/wsp/runs/
apps/*/wsp/exports/
apps/*/wsp/reports-app/
apps/*/wsp/reports-lz/
apps/*/wsp/logs/
apps/*/wsp/latest.txt
apps/*/wsp/latest-lz-primary.yaml
apps/*/wsp/inputs/source/

# Dynamic-crawl parity baseline written by the crawler to the app workspace root
# (outside wsp/); not committed (#1504).
apps/*/parity-baseline/

# LLM Assessment run data (call records, comparison JSON, publication model).
llm-assessments/

# LLM prompt traces written per-pass per-run (#1709); customer workspace data.
llm-traces/

# Published HTML reports (single-page, can be large; publish on demand).
apps/*/wsp/publications/

# Legacy paths (pre-#0227 / pre-#0228); kept for forward-running binaries
# against workspaces that have not yet been migrated by \`swao migrate-workspace\`.
catalogs/standard/
apps/*/reports/
apps/*/artifacts/
apps/*/outputs/
apps/*/source/
`;

export interface CatalogsScaffoldResult {
  communityDir: string;
  lzCataloguesDir: string;
  copiedFiles: string[];
  warnings: string[];
}

// resolveCatalogsDir moved to @swao/core (#0552) so the app-assessment
// module's derive-plan library can resolve catalogs without importing from
// @swao/swao. Re-exported here for existing './init.js' call sites (regime
// select, doctor probe, regime picker).
export { resolveCatalogsDir } from '@swao/core';

/**
 * Mirror the bundled community frameworks into
 * `<workspaceDir>/wsp/inputs/catalogs/community/` and create an
 * empty index.yaml + README.md beside them. Sprint-039 #0358 Phase 3
 * retired the legacy `standard` scope; every flagship regime ships
 * via the community channel.
 *
 * The bundled community mirror is gitignored; only engagement-authored
 * community customisations belong in version control. Re-running init
 * leaves existing community folders alone (idempotent); use
 * `--reconfigure` to force a refresh.
 *
 * Location note: catalogs are workspace-level inputs (shared across
 * every app in a portfolio) so they live under the workspace-level
 * `wsp/inputs/`, not under any per-app `apps/<id>/wsp/inputs/`.
 */
export function scaffoldCatalogs(workspaceDir: string): CatalogsScaffoldResult {
  const result: CatalogsScaffoldResult = {
    communityDir: join(workspaceDir, 'wsp', 'inputs', 'catalogs', 'community'),
    lzCataloguesDir: join(workspaceDir, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'),
    copiedFiles: [],
    warnings: [],
  };

  mkdirSync(result.communityDir, { recursive: true });

  const communityIndex = join(result.communityDir, 'index.yaml');
  if (!existsSync(communityIndex)) {
    writeFileSync(communityIndex, swaoFileHeader('Community framework index', 'hash') + emptyCommunityIndex, 'utf-8');
  }
  const communityReadmePath = join(result.communityDir, 'README.md');
  if (!existsSync(communityReadmePath)) {
    writeFileSync(communityReadmePath, swaoFileHeader('Community regime catalogues') + communityReadme, 'utf-8');
  }

  // #0775-B: scaffold four demo-sized frameworks (12-11 controls each) into
  // new workspaces so the regime picker is populated out of the box.
  // Demo variants apply to all tiers -- no tier-gating. COBIT_5 intentionally
  // excluded from default scaffold (#0842); operators install it manually.
  // #1614-A: write a .demo-seeded marker on first seed. Subsequent runs skip
  // demo folders listed in the marker so intentional removal is respected even
  // when no other community frameworks exist (#1777 hasCommunityFrameworks
  // guard only protects against re-seeding when OTHER frameworks are present).
  const SCAFFOLD_FW_FOLDERS = [
    'gdpr-demo',
    'ai-10-pillars-demo',
    'nist-sp-800-66r2-demo',
    'bsi-grundschutz-2023-demo',
  ] as const;

  const demoSeededPath = join(result.communityDir, '.demo-seeded');
  const alreadySeeded: Set<string> = existsSync(demoSeededPath)
    ? new Set(readFileSync(demoSeededPath, 'utf-8').split('\n').filter(Boolean))
    : new Set<string>();

  if (existsSync(BUNDLED_COMMUNITY_DIR)) {
    const toSeed = SCAFFOLD_FW_FOLDERS.filter((fw) => !alreadySeeded.has(fw));
    if (toSeed.length > 0) {
      for (const fw of toSeed) {
        const src = join(BUNDLED_COMMUNITY_DIR, fw);
        const dst = join(result.communityDir, fw);
        if (existsSync(src) && !existsSync(dst)) {
          mkdirSync(dst, { recursive: true });
          copyDirRecursive(src, dst);
          result.copiedFiles.push(`community/${fw}/`);
          alreadySeeded.add(fw);
        } else {
          // dst exists (user kept or added it): still record as seeded so
          // future runs don't try to overwrite it.
          alreadySeeded.add(fw);
        }
      }
      writeFileSync(demoSeededPath, [...alreadySeeded].join('\n') + '\n', 'utf-8');
    }
  } else {
    result.warnings.push(
      `bundled community frameworks not found at ${BUNDLED_COMMUNITY_DIR}; ` +
        'catalogs/community/ left empty (binary build issue?)',
    );
  }

  // #1522: auto-seed LZ catalogue JSON files so users can edit them without
  // needing a Tools menu action. Only seeds when the destination does not exist
  // (fresh workspace); subsequent updates go via "Update LZ Catalogue".
  if (!existsSync(result.lzCataloguesDir)) {
    mkdirSync(result.lzCataloguesDir, { recursive: true });
    const bundledLzDir = resolveLzCataloguesDir();
    if (bundledLzDir) {
      for (const f of readdirSync(bundledLzDir)) {
        if (!f.endsWith('.json')) continue;
        copyFileSync(join(bundledLzDir, f), join(result.lzCataloguesDir, f));
        result.copiedFiles.push(`lz-catalogues/${f}`);
      }
    } else {
      result.warnings.push(
        'bundled LZ catalogues not found; wsp/inputs/catalogs/lz-catalogues/ created empty -- run "swao lz catalogue update" to populate',
      );
    }
  }

  return result;
}

function copyDirRecursive(src: string, dst: string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}

// Landing-zone snapshot scaffolder (#0232). Drops sample lz-*-snapshot.json files
// into <appDir>/wsp/inputs/terraform/ so the operator (a) sees the format
// the LZR pass expects, and (b) has a runnable starting point for Portfolio
// Operations -> Assess (LZR) without authoring anything.
export interface LzStubsScaffoldResult {
  importsDir: string;
  copiedFiles: string[];
  warnings: string[];
}

const LZ_STUB_FILES = ['lz-aws-snapshot.json', 'lz-azure-snapshot.json', 'lz-meshstack-snapshot.json'] as const;

export function scaffoldLandingZoneStubs(appDir: string, appId?: string): LzStubsScaffoldResult {
  const result: LzStubsScaffoldResult = {
    importsDir: join(appDir, 'wsp', 'inputs', 'terraform'),
    copiedFiles: [],
    warnings: [],
  };
  mkdirSync(result.importsDir, { recursive: true });

  if (!existsSync(join(BUNDLED_LZ_STUBS_DIR, 'lz-azure-snapshot.json'))) {
    result.warnings.push(
      `bundled landing-zone stubs not found at ${BUNDLED_LZ_STUBS_DIR}; ` +
        'imports/ left without samples (binary build issue?)',
    );
    return result;
  }

  // #1497: derive appId from the appDir basename when not supplied explicitly.
  const effectiveAppId = appId ?? basename(appDir);
  const nowIso = new Date().toISOString();

  for (const filename of LZ_STUB_FILES) {
    const src = join(BUNDLED_LZ_STUBS_DIR, filename);
    const dst = join(result.importsDir, filename);
    if (!existsSync(src)) {
      result.warnings.push(`bundled LZ snapshot missing: ${filename}`);
      continue;
    }
    // Don't overwrite operator-customised snapshots.
    if (existsSync(dst)) continue;
    // Replace placeholder app-name and date in the template (#1497).
    const content = readFileSync(src, 'utf-8')
      .replace(/ghostfolio/g, effectiveAppId)
      .replace(/2026-01-01T00:00:00Z/g, nowIso);
    writeFileSync(dst, content, 'utf-8');
    result.copiedFiles.push(filename);
  }

  // README explaining what these files are for.
  const readmePath = join(result.importsDir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, swaoFileHeader('Landing-zone snapshot inputs') + LZ_STUBS_README, 'utf-8');
  }

  return result;
}

const LZ_STUBS_README = `# Landing-zone snapshot inputs

The files in this folder (\`wsp/inputs/terraform/\`) are read by
**Pass 23 -- Landing Zone Readiness** (LZR) when you run
\`swao assess --portfolio --lzr <id>\` (or pick
\`Portfolio Operations -> Assess (LZR)\` in the TUI).

## What's here

- \`lz-aws-snapshot.json\`       -- sample AWS landing-zone snapshot
- \`lz-azure-snapshot.json\`     -- sample Azure landing-zone snapshot
- \`lz-meshstack-snapshot.json\` -- sample meshStack landing-zone snapshot

These are **samples** so you can see the format and run a Premium LZR
pass end-to-end. For a real engagement, replace one of these with the
actual landing-zone state for your target environment, or drop a
Terraform state file (\`*.tfstate\`) or plan (\`*.tfplan\`) alongside.

## What the LZR pass does

For each candidate landing zone, it evaluates 30+ checks (service
presence, resource quotas, network egress, compliance posture) and
emits a verdict: \`ready\`, \`advisory\`, \`blocked\`, or \`skipped\`.
Outputs feed the portfolio LZR report and the BI export's landing-zone
dimension.

## How to switch provider

The portfolio LZR adapter auto-detects which provider to evaluate against
based on which snapshot file exists, in priority order:

1. \`lz-meshstack-snapshot.json\` -- meshStack first (default for sovereign engagements)
2. \`lz-aws-snapshot.json\`        -- AWS
3. \`lz-azure-snapshot.json\`      -- Azure
4. \`*.tfstate\` / \`*.tfplan\` -- Terraform fall-through

Delete the snapshots you don't want and keep one of the providers you're
actually targeting.
`;

// PowerBI template scaffolder (#0231). Copies the bundled .pbit files
// into <workspace>/wsp/templates/powerbi/. Called by both `swao init`
// (CLI) and the TUI Setup wizard. Refreshed on every `swao export`.
export interface PowerBiScaffoldResult {
  templatesDir: string;
  copiedFiles: string[];
  warnings: string[];
}

const POWERBI_TEMPLATE_FILES = ['swao-report.pbit', 'swao-portfolio.pbit'] as const;

export function scaffoldPowerBiTemplates(workspaceDir: string): PowerBiScaffoldResult {
  const result: PowerBiScaffoldResult = {
    templatesDir: join(workspaceDir, 'wsp', 'templates', 'powerbi'),
    copiedFiles: [],
    warnings: [],
  };

  mkdirSync(result.templatesDir, { recursive: true });

  if (!existsSync(BUNDLED_POWERBI_DIR)) {
    result.warnings.push(
      `bundled PowerBI templates not found at ${BUNDLED_POWERBI_DIR}; ` +
        'wsp/templates/powerbi/ left empty (binary build issue?)',
    );
    return result;
  }

  for (const filename of POWERBI_TEMPLATE_FILES) {
    const src = join(BUNDLED_POWERBI_DIR, filename);
    if (!existsSync(src)) {
      result.warnings.push(`bundled template missing: ${filename}`);
      continue;
    }
    // #0411 (sprint-040 round-11): EBUSY-tolerant copy. Setup re-runs on
    // an active workspace can race the operator's PowerBI Desktop having
    // the .pbit open. Warn + skip instead of crashing setup.
    try {
      copyFileSync(src, join(result.templatesDir, filename));
      result.copiedFiles.push(filename);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        result.warnings.push(
          `PowerBI template "${filename}" is currently open in another program (likely PowerBI Desktop); ` +
          `kept the existing copy. Close the file and re-run Setup if you need the latest template.`,
        );
      } else {
        throw e;
      }
    }
  }

  return result;
}

/**
 * Write or merge the workspace `.gitignore` with the SWAO baseline rules,
 * including `catalogs/standard/` to keep the bundled mirror out of version
 * control. Existing entries are preserved.
 */
export function ensureGitignore(workspaceDir: string): void {
  const path = join(workspaceDir, '.gitignore');
  if (!existsSync(path)) {
    writeFileSync(path, gitignoreContent, 'utf-8');
    return;
  }
  const existing = readFileSync(path, 'utf-8');
  const lines = existing.split(/\r?\n/);
  const required = [
    // Sprint-039 #0358 Phase 3 -- `wsp/inputs/catalogs/standard/` retired
    // (every flagship regime now ships as a community framework). The
    // bundled `wsp/inputs/catalogs/community/.bundled/` mirror remains
    // gitignored; engagement-authored community catalogues sit alongside
    // and ARE tracked.
    'wsp/inputs/catalogs/community/.bundled/',
    'wsp/templates/powerbi/*.pbit',
    '.swao.secrets.env',
    // #0968 -- binary and launcher (GitHub rejects >100 MB), logs
    'swao-enterprise-win.exe',
    'swao-community-win.exe',
    'swao-consultant-win.exe',
    'swao.bat',
    'wsp/logs/',
    'wsp/runs/',
    'wsp/exports/',
    'wsp/reports-app/',
    'wsp/reports-lz/',
    'wsp/latest.txt',
    'apps/*/wsp/runs/',
    'apps/*/wsp/exports/',
    'apps/*/wsp/reports-app/',
    'apps/*/wsp/reports-lz/',
    'apps/*/wsp/logs/',
    'apps/*/wsp/latest.txt',
    'apps/*/wsp/latest-lz-primary.yaml',
    'apps/*/wsp/inputs/source/',
    // #1709: LLM prompt traces (customer workspace data, both assessment paths)
    'llm-traces/',
  ];
  const additions = required.filter((r) => !lines.some((l) => l.trim() === r));
  if (additions.length > 0) {
    const sep = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(
      path,
      existing + sep + '\n# SWAO workspace additions\n' + additions.join('\n') + '\n',
      'utf-8',
    );
  }
}

// -- Workspace-level .swao.yml builder + scaffold orchestrator (#1092/#1093) --
// These are extracted from SetupWizard.tsx's `writeAndFinish` + `runScaffolders`
// so they can be unit-tested independently of the TUI.

export interface WorkspaceSwaoYmlParams {
  name: string;
  code: string;
  ownerLead: string;
  engLead: string;
  endDate: string;
  redactorType?: 'gitleaks' | 'pattern';
}

export function validateIso8601Date(v: string): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Date must be YYYY-MM-DD (e.g. 2026-12-31)';
}

export function buildWorkspaceSwaoYml(params: WorkspaceSwaoYmlParams): string {
  const { name, code, ownerLead, engLead, endDate, redactorType = 'pattern' } = params;
  const today = new Date().toISOString().slice(0, 10);
  return (
    `# .swao.yml -- SWAO workspace configuration\n` +
    `wsp_version: "0.9"\n\n` +
    `engagement:\n` +
    `  name: "${name}"\n` +
    `  client_code: "${code}"\n` +
    `  start_date: "${today}"\n` +
    (endDate ? `  end_date: "${endDate}"\n` : '') +
    `  partnership_lead: "${ownerLead}"\n` +
    (engLead ? `  engagement_lead: "${engLead}"\n` : '') +
    `\n` +
    `providers:\n` +
    `  llm:\n` +
    `    primary:\n` +
    `      type: ~\n` +
    `      model: ~\n` +
    `  redactor:\n` +
    `    type: ${redactorType}\n` +
    `imports_dir: wsp/inputs/  # workspace-level shared inputs (frameworks, templates)\n` +
    `\n` +
    `# workspace:\n` +
    `#   run_retention:\n` +
    `#     keep_latest: 10  # keep only the 10 most recent assessment runs per app\n` +
    `\n` +
    `# publication:\n` +
    `#   cover_subtitle: "Cloud Sovereignty Assessment"\n` +
    `#   classification_band: "Accenture Internal, Confidential"\n` +
    `#   engagement_lead: "${ownerLead}"\n` +
    `#   logo_name: "SWAO"\n`
  );
}

export function runWorkspaceScaffolders(workspaceDir: string): void {
  scaffoldCatalogs(workspaceDir);
  scaffoldPowerBiTemplates(workspaceDir);
  // #1403 sprint-113: LLM-Gateway connector drop folder (template + README);
  // runs for CLI init AND the SetupWizard, which both route through here.
  try { scaffoldWorkspaceGateway(workspaceDir); } catch { /* best-effort */ }
  ensureGitignore(workspaceDir);
  const appsDir = join(workspaceDir, 'apps');
  if (existsSync(appsDir)) {
    try {
      readdirSync(appsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .forEach(d => scaffoldIngestion(join(appsDir, d.name)));
    } catch { /* best-effort */ }
  }
}

export function registerInit(program: Command): void {
  program
    .command('init [directory]')
    .description('Initialise a new SWAO workspace')
    .option('--name <app-id>', 'Application ID to set in .swao.yml')
    .option('--reconfigure', 'Refresh bundled community-framework mirror under wsp/inputs/catalogs/community/ without overwriting .swao.yml')
    .option('--force', 'Re-scaffold the app directory even when .swao.yml already exists')
    .action((directory: string = '.', options: { name?: string; reconfigure?: boolean; force?: boolean }) => {
      const workspaceDir = resolve(directory);
      const appId = options.name ?? 'my-app';
      const appDir = join(workspaceDir, 'apps', appId);
      const swaoYmlPath = join(appDir, '.swao.yml');

      if (!options.reconfigure && !options.force && existsSync(swaoYmlPath)) {
        console.log(`[ok]  App scaffold already exists, skipped (use --force to re-scaffold): ${swaoYmlPath}`);
        process.exit(0);
      }

      if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
      }
      if (!existsSync(appDir)) {
        mkdirSync(appDir, { recursive: true });
      }

      if (!options.reconfigure) {
        // Install GDPR as the default regime so a fresh workspace is immediately
        // assessable without the empty-framework-picker first-run (#0626).
        // Operators can remove or replace it by editing .swao.yml directly.
        writeFileSync(swaoYmlPath, appSwaoYmlTemplate({ appId, regimes: ['GDPR_DEMO', 'AI_10_PILLARS_DEMO', 'NIST_SP_800_66R2_DEMO', 'BSI_GRUNDSCHUTZ_2023_DEMO'] }), 'utf-8');
      }

      const scaffold = scaffoldCatalogs(workspaceDir);
      const pbi = scaffoldPowerBiTemplates(workspaceDir);
      scaffoldImports(appDir);
      scaffoldIngestion(appDir);
      scaffoldSource(appDir);
      const lz = scaffoldLandingZoneStubs(appDir);
      ensureGitignore(workspaceDir);

      for (const w of scaffold.warnings) {
        console.error(`[warn] ${w}`);
      }
      for (const w of pbi.warnings) {
        console.error(`[warn] ${w}`);
      }
      for (const w of lz.warnings) {
        console.error(`[warn] ${w}`);
      }
      if (scaffold.copiedFiles.length > 0) {
        console.log(`[ok]  Frameworks installed (${scaffold.copiedFiles.length}): GDPR_DEMO, AI_10_PILLARS_DEMO, NIST_SP_800_66R2_DEMO, BSI_GRUNDSCHUTZ_2023_DEMO -> ${scaffold.communityDir}`);
        console.log(`      To add more frameworks: swao framework list  |  swao framework install <id>`);
      }
      if (pbi.copiedFiles.length > 0) {
        console.log(`[ok]  PowerBI templates scaffolded -> ${pbi.templatesDir}`);
      }
      if (lz.copiedFiles.length > 0) {
        console.log(`[ok]  Landing-zone stubs scaffolded -> ${lz.importsDir} (${lz.copiedFiles.length} samples)`);
      }
      console.log(`[ok]  Ingestion drop folder scaffolded -> ${join(appDir, 'ingestion')}`);
      console.log(appDir);
    });
}

/**
 * Create `apps/<appId>/wsp/inputs/source/` with a README explaining
 * how to populate. The directory must exist for `swao assess` to run;
 * otherwise the assess exits with "Source directory not found and no
 * vcs.url configured".
 *
 * #0227: source lives under `wsp/inputs/source/` so customer-provided
 * inputs (code + context) are colocated under one `wsp/` root per app.
 */
export function scaffoldSource(appDir: string): void {
  const sourceDir = join(appDir, 'wsp', 'inputs', 'source');
  mkdirSync(sourceDir, { recursive: true });
  const readmePath = join(sourceDir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, SOURCE_README_CONTENT, 'utf-8');
  }
}

// #1051: source README should not repeat generic placeholder URLs -- the actual
// VCS URL is already in .swao.yml; this README guides the operator on options.
const SOURCE_README_CONTENT = `# Source code -- this app's primary repository

This directory is the clone target for the source code SWAO analyses
during \`swao assess\`. Three ways to populate it:

## 1. Auto-clone via source.vcs in .swao.yml

If \`source.vcs.url\` is configured in \`.swao.yml\`, \`swao assess\`
clones the repository here automatically on its first run. Check
your \`.swao.yml\` to confirm or update the VCS settings:

\`\`\`yaml
source:
  path: wsp/inputs/source/
  vcs:
    type: github          # github | gitlab | azure-devops
    url: https://...      # repository clone URL
    ref: main             # branch, tag, or commit SHA
    # subdir: src/        # optional: subdirectory to analyse
\`\`\`

## 2. Clone manually

\`\`\`
cd wsp/inputs/source
git clone <url> .
\`\`\`

## 3. Copy from elsewhere

If the source is local or on a network share, copy it into this
directory. SWAO does not require a git repository -- a plain
directory tree is fine for read-only static analysis.

## Notes

- This folder is read-only from SWAO's perspective; the analyser
  never writes here.
- The cloned source tree is in \`.gitignore\` so it does not
  accidentally land inside the workspace git history.
`;

