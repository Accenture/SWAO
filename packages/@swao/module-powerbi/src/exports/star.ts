// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI export module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
// #0577: the data-quality contract (evaluateDataQuality + buildDataQualityFlagsString)
// relocated to @swao/core so this module does not import a sibling module
// (@swao/module-html-report owns the HTML banner renderer, not the shared data
// contract). ADR-0048 sibling-import ban.
import { evaluateDataQuality, buildDataQualityFlagsString } from '@swao/core';
import { basename, dirname, join } from 'path';
import { dump, load } from 'js-yaml';
import * as excelJsModule from 'exceljs';
// #0577: compliance registry loaders + the RegimeCatalogue / RunManifest types
// were already in @swao/core (the host schema/* + compliance/registry modules
// re-export them); the moved star writer imports them from core directly.
import { loadRegimeRegistry, loadRegimeCatalogue } from '@swao/core';
import type { RegimeCatalogue, RunManifest } from '@swao/core';

const BOM = '﻿';
// 1.1.0 (#0265, Sprint 030): adds fact_scope_coverage + scope_coverage row
// in fact_assessments so PowerBI Scope Coverage page (#0263 Phase 3) can bind.
// #0361 (sprint-039) -- additive bump from 1.1.0 to 1.2.0: new
// `link_control_tag.{csv,ndjson}` table for the PowerBI tag slicer.
// Per ADR-0012 additive changes are a minor bump; older readers that
// don't know about link_control_tag simply ignore the file.
const SCHEMA_VERSION = '1.3.0';

export interface ExportContext {
  /** Per-app workspace directory containing `wsp/`. */
  workspaceAppDir: string;
  /** App identifier; populates `app_id` columns. */
  appId: string;
  /** ISO-8601 timestamp; folder name under `wsp/exports/`. */
  timestamp: string;
  /** Use CRLF line endings (Windows export default). */
  crlf?: boolean;
  /** Suppress UTF-8 BOM for Excel-unfriendly downstream tools. */
  noBom?: boolean;
}

export interface ManifestFile {
  path: string;
  rows: number;
  sha256: string;
  bytes: number;
  /** Human-readable note explaining why a table is empty (e.g. COMP produced no mappings). */
  note?: string;
}

export interface ExportManifest {
  bundle_schema_version: string;
  source_wsp_run: string;
  app_id: string;
  generated_at: string;
  files: ManifestFile[];
  /** NDJSON mirror and XLSX rollup files produced alongside the star CSV bundle (#1258). */
  companion_outputs?: {
    ndjson?: ManifestFile[];
    xlsx?: ManifestFile[];
  };
}

// --------------------------------------------------------------------
// Compliance catalogue lookup (#0263)
// --------------------------------------------------------------------

// workspaceAppDir is `<workspace>/apps/<id>/`. Catalogues live at
// `<workspace>/wsp/inputs/catalogs/{standard,community}/`. Walk up two
// levels to reach the workspace root. Returns an empty Map silently
// when the catalogs dir doesn't exist (in-tree examples, isolated tests).
function loadCatalogueByRegimeId(workspaceAppDir: string): Map<string, RegimeCatalogue> {
  const out = new Map<string, RegimeCatalogue>();
  try {
    const appsDir = dirname(workspaceAppDir);
    const workspaceRoot = dirname(appsDir);
    const catalogsDir = join(workspaceRoot, 'wsp', 'inputs', 'catalogs');
    if (!existsSync(catalogsDir)) return out;
    const registry = loadRegimeRegistry(catalogsDir);
    for (const [regimeId, resolved] of registry.byId.entries()) {
      if (!existsSync(resolved.catalogueFile)) continue;
      try {
        out.set(regimeId, loadRegimeCatalogue(resolved.catalogueFile));
      } catch { /* swallow: malformed catalogue surfaces as empty enrichment, not a fatal export */ }
    }
  } catch { /* ditto */ }
  return out;
}

// --------------------------------------------------------------------
// CSV writer (RFC 4180)
// --------------------------------------------------------------------

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(values: unknown[], lineSep: string): string {
  return values.map(csvEscape).join(',') + lineSep;
}

function writeCsvFile(
  path: string,
  header: string[],
  rows: unknown[][],
  ctx: ExportContext,
): { rows: number; bytes: number; sha256: string } {
  const sep = ctx.crlf ? '\r\n' : '\n';
  const bom = ctx.noBom ? '' : BOM;
  let body = bom + csvRow(header, sep);
  for (const row of rows) body += csvRow(row, sep);
  writeFileSync(path, body, 'utf-8');
  const buf = Buffer.from(body, 'utf-8');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { rows: rows.length, bytes: buf.byteLength, sha256 };
}

// --------------------------------------------------------------------
// WSP loaders -- pure reads
// --------------------------------------------------------------------

interface RawSignal {
  id?: string;
  source?: string;
  category?: string;
  severity?: string;
  outcome?: string;
  derivation?: string;
  evidence?: string[];
  signal_ref?: string;
  derivation_chain?: string[];
  false_positive_considered?: boolean;
  false_positive_ruled_out?: string;
  assessor?: string;
  assessed_at?: string;
  confidence?: string;
}

interface RawControl {
  id?: string;
  title?: string;
  description?: string;
  outcome?: string;
  status?: string;
  severity?: string;
  rationale?: string;
  signal_refs?: string[];
  evidence_ids?: string[];
  evidence?: string[];
  assessor?: string;
  assessed_at?: string;
  remediation?: string;
  // #0361 -- tag taxonomy carried forward from catalogue by Pass 11
  // (#0360 plumbing). One row per (control_id, tag) emitted into
  // link_control_tag for PowerBI slicer use.
  tags?: string[];
  machine_outcome?: string;
  override?: OverrideBlock;
}

interface RawSecurityFinding {
  id?: string;
  category?: string;
  severity?: string;
  description?: string;
  remediation?: string;
  blocks_migration?: boolean;
  signal_ref?: string;
}

interface OverrideBlock {
  author?: string;
  role?: string;
  timestamp?: string;
  rationale?: string;
}

interface RawRiskItem {
  risk_id?: string;
  category?: string;
  likelihood?: string;
  impact?: string;
  trigger?: string;
  mitigation?: string;
  owner?: string;
  status?: string;
  evidence_ids?: string | string[];
  closed_by?: string;
  closed_at?: string;
  machine_outcome?: string;
  override?: OverrideBlock;
}

interface RawEvidenceItem {
  type?: string;
  file?: string;
  summary?: string;
  collected_at?: string;
  reliability_weight?: number;
  context_input?: string;
}

interface RawSpine {
  app?: { id?: string; name?: string; business_domain?: string; business_criticality?: string; regulatory_class?: string };
  workload?: { id?: string; name?: string; business_domain?: string; business_criticality?: string; regulatory_class?: string };
  overall?: {
    seven_r_label?: string;
    modernization_position?: string;
    coverage_score?: number;
    confidence?: number | string;
    portability_score?: number;
  };
  landing_zone?: { primary?: string; note?: string };
  assessed_at?: string;
  // #0228: engagement metadata from workspace .swao.yml, propagated via
  // derive-plan into wsp.yaml so the BI export's dim_app surfaces it.
  engagement?: {
    name?: string;
    client_code?: string;
    partnership_lead?: string;
    start_date?: string;
  };
}

interface RawRunManifest {
  schema_version?: string;
  run_id?: string;
  app?: string;
  iter?: number;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  passes_executed?: string[];
  total_signals_emitted?: number;
  pass_stats?: Array<{
    pass?: string;
    num?: string;
    wall_clock_ms?: number;
    signals_emitted?: number;
    tokens_in?: number;
    tokens_out?: number;
    cost_usd?: number;
  }>;
  llm?: {
    provider?: string;
    model?: string;
    total_tokens_in?: number;
    total_tokens_out?: number;
    total_cost_usd?: number;
    call_count?: number;
  };
  files_assessed?: {
    inventory_count?: number;
    source_files_total?: number;
    imports_files_total?: number;
  };
  landing_zone_weights?: {
    sovereign_score?: number;
    service_coverage?: number;
    portability?: number;
    cost_tier?: number;
  };
}

function safeReadYaml<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return load(readFileSync(path, 'utf-8')) as T; }
  catch { return null; }
}

function safeReadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T; }
  catch { return null; }
}

function resolveSourceWspRun(workspaceAppDir: string): {
  passesDir: string;
  planPath: string;
  spinePath: string;
  evidencePath: string;
  runManifestPath: string;
  runId: string;
} {
  const wspDir = join(workspaceAppDir, 'wsp');
  // Prefer latest-application.txt (type-aware pointer written by sprint-076
  // assess.ts #0782). Fall back to latest.txt for pre-sprint-076 workspaces
  // that have no type-specific pointers. This prevents a LZ catalog run
  // (which updates latest.txt) from silently shadowing the application run
  // that the star schema needs (#0786).
  const appLatestFile = join(wspDir, 'latest-application.txt');
  const latestFile    = join(wspDir, 'latest.txt');
  const pointerFile   = existsSync(appLatestFile) ? appLatestFile : latestFile;
  let runDir = wspDir;
  let runId = 'flat';
  if (existsSync(pointerFile)) {
    try {
      const latestPath = readFileSync(pointerFile, 'utf-8').trim();
      if (latestPath && latestPath !== '.') {
        runDir = join(wspDir, latestPath);
        runId = latestPath.replace(/^runs\//, '');
      }
    } catch { /* keep flat */ }
  }
  const passesDir = existsSync(join(runDir, 'passes')) ? join(runDir, 'passes') : join(wspDir, 'passes');
  const planPath = existsSync(join(runDir, 'wsp-plan.yaml')) ? join(runDir, 'wsp-plan.yaml') : join(wspDir, 'wsp-plan.yaml');
  const spinePath = existsSync(join(runDir, 'wsp.yaml')) ? join(runDir, 'wsp.yaml') : join(wspDir, 'wsp.yaml');
  const evidencePath = existsSync(join(runDir, 'wsp-evidence.yaml')) ? join(runDir, 'wsp-evidence.yaml') : join(wspDir, 'wsp-evidence.yaml');
  const runManifestPath = existsSync(join(runDir, 'run-manifest.json')) ? join(runDir, 'run-manifest.json') : join(wspDir, 'run-manifest.json');
  return { passesDir, planPath, spinePath, evidencePath, runManifestPath, runId };
}

// --------------------------------------------------------------------
// Star-schema row builders
// --------------------------------------------------------------------

function joinChain(chain: string[] | undefined): string {
  if (!chain || chain.length === 0) return '';
  return chain.join(';');
}

interface StarTables {
  fact_signals: { header: string[]; rows: unknown[][] };
  fact_controls: { header: string[]; rows: unknown[][] };
  fact_findings: { header: string[]; rows: unknown[][] };
  fact_risks: { header: string[]; rows: unknown[][] };
  fact_assessments: { header: string[]; rows: unknown[][] };
  fact_scope_coverage: { header: string[]; rows: unknown[][] };
  fact_runs: { header: string[]; rows: unknown[][] };
  fact_pass_runs: { header: string[]; rows: unknown[][] };
  dim_app: { header: string[]; rows: unknown[][] };
  dim_pass: { header: string[]; rows: unknown[][] };
  dim_regime: { header: string[]; rows: unknown[][] };
  dim_control: { header: string[]; rows: unknown[][] };
  dim_evidence: { header: string[]; rows: unknown[][] };
  dim_severity: { header: string[]; rows: unknown[][] };
  dim_wave: { header: string[]; rows: unknown[][] };
  link_signal_evidence: { header: string[]; rows: unknown[][] };
  link_control_signal: { header: string[]; rows: unknown[][] };
  link_control_evidence: { header: string[]; rows: unknown[][] };
  // #0361 -- per-(control, tag) link table for PowerBI tag slicer.
  // One row per element of `controls[].tags`; falls back to the
  // catalogue's tags array when the plan does not carry them (older
  // pre-#0360 runs).
  link_control_tag: { header: string[]; rows: unknown[][] };
  dim_override: { header: string[]; rows: unknown[][] };
  // #0412/#0413 -- per-app aggregate tables (heatmap + summary). Kept inside
  // StarTables so both writeStarExport and writeNdjsonExport emit them (#1255).
  fact_app_heatmap: { header: string[]; rows: unknown[][] };
  fact_app_summary: { header: string[]; rows: unknown[][] };
  // #1259 -- LZ catalog assessment tables (populated from lz-fit-*.yaml pass files).
  fact_lz_assessment: { header: string[]; rows: unknown[][] };
  dim_landing_zone: { header: string[]; rows: unknown[][] };
  link_lz_gap: { header: string[]; rows: unknown[][] };
}

function buildStarTables(ctx: ExportContext): StarTables {
  const { passesDir, planPath, spinePath, evidencePath, runManifestPath } = resolveSourceWspRun(ctx.workspaceAppDir);

  const spine = safeReadYaml<RawSpine>(spinePath) ?? {};
  const plan = safeReadYaml<{
    compliance?: { regimes?: Array<{ id?: string; name?: string; version?: string; controls?: RawControl[] }> };
    risk_register?: RawRiskItem[];
    security_findings?: RawSecurityFinding[];
    observability?: Record<string, unknown>;
    licence_compliance?: Record<string, unknown>;
    testing_maturity?: Record<string, unknown>;
    architecture_assessment?: Record<string, unknown>;
    database_assessment?: Record<string, unknown>;
    integration_assessment?: Record<string, unknown>;
    iam_assessment?: Record<string, unknown>;
    dr_assessment?: Record<string, unknown>;
    landing_zone_readiness?: Record<string, unknown>;
    scope_coverage?: {
      catalogue_version?: string;
      total_blind_spots?: number;
      closed?: number;
      partial?: number;
      open?: number;
      coverage_ratio?: number;
      blind_spots?: Array<{
        id?: string;
        name?: string;
        category?: string;
        coverage?: 'closed' | 'partial' | 'open';
        severity?: string;
        input_required?: string;
        input_provided?: string;
        related_regimes?: string[];
        assessor?: string;
        assessed_at?: string;
      }>;
    };
  }>(planPath) ?? {};
  // #0256 + #0257: evidence_catalogue keys are opaque EVD-* slugs; the
  // sibling `evidence_index` maps original refs to those slugs so we can
  // rewrite link table foreign keys. Older runs without evidence_index
  // fall through with identity mapping (each ref maps to itself).
  const evidenceRoot = safeReadYaml<{
    evidence_catalogue?: Record<string, RawEvidenceItem>;
    evidence_index?: Record<string, string>;
  }>(evidencePath) ?? {};
  const evidenceIndex = evidenceRoot.evidence_index ?? {};
  function resolveEvidenceId(ref: string): string | null {
    if (typeof ref !== 'string' || ref.length === 0) return null;
    const mapped = evidenceIndex[ref];
    if (mapped) return mapped;
    // Back-compat: pre-#0257 catalogues key by the ref directly.
    if (evidenceRoot.evidence_catalogue && evidenceRoot.evidence_catalogue[ref]) return ref;
    // Absence sentinel / unmapped ref -> drop from link tables.
    return null;
  }
  const runManifest = safeReadJson<RawRunManifest>(runManifestPath);

  const appBlock = spine.app ?? spine.workload ?? {};
  const appId = ctx.appId;

  // ---- fact_signals + link_signal_evidence ----
  const factSignalsHeader = [
    'signal_id', 'app_id', 'pass_num', 'severity', 'outcome', 'confidence',
    'assessor', 'assessed_at', 'source', 'category', 'synthesis', 'legacy_tier',
    'signal_ref', 'derivation', 'derivation_chain',
    'false_positive_considered', 'false_positive_ruled_out',
    'signal_source',
  ];
  const factSignalsRows: unknown[][] = [];
  const linkSignalEvidenceRows: unknown[][] = [];

  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
    for (const file of files) {
      const passNumMatch = file.match(/^(\d+)/);
      const passNum = passNumMatch ? passNumMatch[1] : (file.replace(/\.ya?ml$/, ''));
      const parsed = safeReadYaml<{ signals?: RawSignal[] }>(join(passesDir, file));
      if (!parsed?.signals) continue;
      for (const s of parsed.signals) {
        if (!s.id) continue;
        // #0250: emit literal JS booleans (not 'true' / 'false' strings) for
        // synthesis + false_positive_considered. CSV bytes look the same
        // (csvEscape uses String()), but NDJSON / XLSX writers preserve the
        // boolean type, and the PowerBI Power Query template can now cast
        // these columns to `type logical` consistently across single-app and
        // portfolio dashboards.
        const synthesisRaw = (s as Record<string, unknown>).synthesis;
        const synthesisCell: boolean = synthesisRaw === true ? true : false;
        const fpCell: boolean | '' =
          s.false_positive_considered === true ? true :
          s.false_positive_considered === false ? false : '';
        factSignalsRows.push([
          s.id, appId, passNum,
          s.severity ?? '', s.outcome ?? '', s.confidence ?? '',
          s.assessor ?? '', s.assessed_at ?? '',
          s.source ?? '', s.category ?? '',
          synthesisCell,
          (s as Record<string, unknown>).legacy_tier ?? '',
          s.signal_ref ?? '',
          s.derivation ?? '', joinChain(s.derivation_chain),
          fpCell,
          s.false_positive_ruled_out ?? '',
          (s as Record<string, unknown>).provenance
            ? ((s as Record<string, unknown>).provenance as Record<string, unknown>).source ?? ''
            : '',
        ]);
        for (const ev of s.evidence ?? []) {
          const evId = resolveEvidenceId(ev);
          if (evId !== null) linkSignalEvidenceRows.push([s.id, evId, appId]);
        }
      }
    }
  }

  // ---- fact_controls + link_control_signal + link_control_evidence + dim_regime + dim_control ----
  const factControlsHeader = [
    'control_id', 'regime_id', 'app_id', 'outcome', 'status', 'severity',
    'rationale', 'assessor', 'assessed_at', 'remediation',
  ];
  const factControlsRows: unknown[][] = [];
  const linkControlSignalRows: unknown[][] = [];
  const linkControlEvidenceRows: unknown[][] = [];
  const linkControlTagRows: unknown[][] = [];
  // #0263: enrich dim_regime + dim_control from the compliance catalogue
  // YAML so the catalogue metadata (authority, catalogue_version, title,
  // description, severity_default) flows into PowerBI dashboards instead of
  // empty cells. Falls back to assessment-side data when the catalogue is
  // unreachable (in-tree examples, ad-hoc workspaces).
  const catalogueByRegime = loadCatalogueByRegimeId(ctx.workspaceAppDir);

  const dimRegimeMap = new Map<string, {
    name: string;
    version: string;
    authority: string;
    catalogueVersion: string;
    controlsCount: number;
  }>();
  const dimControlMap = new Map<string, {
    regime: string;
    title: string;
    description: string;
    severityDefault: string;
    catalogueVersion: string;
  }>();

  for (const regime of plan.compliance?.regimes ?? []) {
    const regimeId = regime.id ?? regime.name ?? '?';
    const controls = regime.controls ?? [];
    const cat = catalogueByRegime.get(regimeId);
    const catControlById = new Map((cat?.controls ?? []).map((c) => [c.id, c]));
    // Read authority and catalogue_version from catalogue (richer) or plan regime fields
    const planAuthority = (regime as Record<string, unknown>)['authority'] as string | undefined;
    const planCatalogueVersion = (regime as Record<string, unknown>)['catalogue_version'] as string | undefined;
    dimRegimeMap.set(regimeId, {
      name: cat?.regime_meta.name ?? regime.name ?? regimeId,
      version: cat?.regime_meta.version ?? regime.version ?? '',
      authority: cat?.regime_meta.authority ?? planAuthority ?? '',
      catalogueVersion: cat?.regime_meta.catalogue_version ?? planCatalogueVersion ?? '',
      controlsCount: controls.length,
    });
    for (const c of controls) {
      const cid = c.id ?? '?';
      factControlsRows.push([
        cid, regimeId, appId,
        c.outcome ?? '', c.status ?? '', c.severity ?? '',
        c.rationale ?? '', c.assessor ?? '', c.assessed_at ?? '',
        c.remediation ?? '',
      ]);
      const catControl = catControlById.get(cid);
      // Title priority: catalogue (richer, human-authored) > plan control's own title
      // (from Pass 11 which copies from catalogue) > bare id as last resort.
      // This ensures dim_control.title is populated even when loadRegimeRegistry
      // cannot find the catalogue (e.g. community/ structure mismatch).
      const planTitle = (c as Record<string, unknown>)['title'] as string | undefined;
      const planDesc  = (c as Record<string, unknown>)['description'] as string | undefined;
      dimControlMap.set(cid, {
        regime: regimeId,
        title: catControl?.title ?? planTitle ?? cid,
        description: (catControl?.description ?? planDesc ?? '').trim(),
        severityDefault: catControl?.severity_default ?? (c as Record<string, unknown>)['severity'] as string ?? '',
        catalogueVersion: cat?.regime_meta.catalogue_version ?? planCatalogueVersion ?? '',
      });
      for (const sigRef of c.signal_refs ?? []) {
        linkControlSignalRows.push([cid, sigRef, regimeId, appId]);
      }
      const evIds = c.evidence_ids ?? c.evidence ?? [];
      for (const ev of evIds) {
        const evId = resolveEvidenceId(ev);
        if (evId !== null) linkControlEvidenceRows.push([cid, evId, regimeId, appId]);
      }
      // #0361 -- tag link rows. Prefer the plan's tags (Pass 11 #0360
      // plumbing) so post-evaluation overrides win; fall back to the
      // catalogue's tags for legacy pre-#0360 plans. Tag-kind derived
      // from the prefix: `applies-to.*` -> "applies-to"; everything
      // else is the per-framework `axis.value` form.
      const planTags = Array.isArray(c.tags) ? c.tags : [];
      const catTags = catControl?.tags ?? [];
      const tagsForLink = planTags.length > 0 ? planTags : catTags;
      for (const tag of tagsForLink) {
        if (typeof tag !== 'string' || tag.length === 0) continue;
        const tagKind = tag.startsWith('applies-to.') ? 'applies-to' : 'axis';
        linkControlTagRows.push([cid, tag, tagKind, regimeId, appId]);
      }
    }
  }

  // ---- #0823: per-control rows from pass assessment.regimes (rich path) ----
  // Pass 11 (compliance_evaluation) writes a full assessment.regimes[].controls[]
  // block with per-control outcome, rationale, signal_refs, and remediation.
  // wsp-plan.yaml does NOT carry compliance.regimes for LLM-based passes, so the
  // primary export path above (plan.compliance?.regimes) produces nothing.
  // Read the pass files directly and prefer the rich per-control data; fall back
  // to expanding the derivation summary ("N SATISFIED, N PARTIAL...") as synthetic
  // rows only when no assessment.regimes block is present.
  // Only adds rows for regimes that have NO entries from the primary path.
  interface RawPassRegime {
    id?: string;
    name?: string;
    version?: string;
    controls?: RawControl[];
  }
  interface RawPassFile {
    signals?: RawSignal[];
    assessment?: { regimes?: RawPassRegime[] };
  }
  const DEMO_DERIV_RE = /^([A-Z0-9_]+):\s+(\d+)\s+SATISFIED,\s*(\d+)\s+PARTIAL,\s*(\d+)\s+GAP,\s*(\d+)\s+UNKNOWN/i;
  const regimesWithRealControls = new Set(factControlsRows.map(r => r[1] as string));
  if (existsSync(passesDir)) {
    const passFiles = readdirSync(passesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
    for (const pf of passFiles) {
      const pp = safeReadYaml<RawPassFile>(join(passesDir, pf));
      if (!pp) continue;

      // Rich path: assessment.regimes[].controls[] present in this pass file.
      const passRegimes = pp.assessment?.regimes ?? [];
      if (passRegimes.length > 0) {
        for (const regime of passRegimes) {
          const regimeId = (regime.id ?? '').toUpperCase();
          if (!regimeId || regimesWithRealControls.has(regimeId)) continue;
          regimesWithRealControls.add(regimeId);
          const controls = regime.controls ?? [];
          if (!dimRegimeMap.has(regimeId)) {
            dimRegimeMap.set(regimeId, {
              name: regime.name ?? regimeId.replace(/_DEMO$/, '').replace(/_/g, ' '),
              version: regime.version ?? '',
              authority: '',
              catalogueVersion: '',
              controlsCount: controls.length,
            });
          }
          for (const c of controls) {
            const cid = c.id ?? '?';
            factControlsRows.push([
              cid, regimeId, appId,
              c.outcome ?? '', c.status ?? '', c.severity ?? '',
              c.rationale ?? '', c.assessor ?? '', c.assessed_at ?? '', c.remediation ?? '',
            ]);
            if (!dimControlMap.has(cid)) {
              dimControlMap.set(cid, {
                regime: regimeId,
                title: c.title ?? '',
                description: c.description ?? '',
                severityDefault: c.severity ?? '',
                catalogueVersion: '',
              });
            }
            for (const sr of c.signal_refs ?? []) {
              linkControlSignalRows.push([cid, sr, regimeId, appId]);
            }
            for (const ev of c.evidence_ids ?? []) {
              linkControlEvidenceRows.push([cid, ev, regimeId, appId]);
            }
            for (const tag of c.tags ?? []) {
              const tagKind = tag.startsWith('applies-to.') ? 'applies-to' : 'axis';
              linkControlTagRows.push([cid, tag, tagKind, regimeId, appId]);
            }
          }
        }
        continue; // rich path handled; skip signal-derivation fallback for this file
      }

      // Fallback: no assessment.regimes -- expand the COMP signal derivation summary
      // into synthetic rows so COUNTROWS-based DAX measures return non-zero values.
      if (!pp.signals) continue;
      for (const sig of pp.signals) {
        if (typeof sig.derivation !== 'string') continue;
        const m = DEMO_DERIV_RE.exec(sig.derivation);
        if (!m) continue;
        const regimeId = m[1]!.toUpperCase();
        if (regimesWithRealControls.has(regimeId)) continue;
        regimesWithRealControls.add(regimeId);
        const counts: [string, number][] = [
          ['SATISFIED', parseInt(m[2]!, 10)],
          ['PARTIAL',   parseInt(m[3]!, 10)],
          ['GAP',       parseInt(m[4]!, 10)],
          ['UNKNOWN',   parseInt(m[5]!, 10)],
        ];
        if (!dimRegimeMap.has(regimeId)) {
          const totalControls = counts.reduce((s, [, n]) => s + n, 0);
          dimRegimeMap.set(regimeId, {
            name: regimeId.replace(/_DEMO$/, '').replace(/_/g, ' '),
            version: 'demo',
            authority: '',
            catalogueVersion: '',
            controlsCount: totalControls,
          });
        }
        let seq = 0;
        for (const [outcome, count] of counts) {
          const status = outcome === 'SATISFIED' ? 'closed' : outcome === 'PARTIAL' ? 'partial' : outcome === 'GAP' ? 'open' : 'unknown';
          for (let i = 0; i < count; i++) {
            seq += 1;
            factControlsRows.push([
              `${regimeId}-SYN-${String(seq).padStart(3, '0')}`,
              regimeId, appId,
              outcome, status, '',
              '', sig.assessor ?? '', sig.assessed_at ?? '', '',
            ]);
          }
        }
      }
    }
  }

  // ---- fact_findings ----
  const factFindingsHeader = [
    'finding_id', 'app_id', 'category', 'severity', 'description', 'remediation', 'blocks_migration', 'signal_ref',
  ];
  const factFindingsRows: unknown[][] = (plan.security_findings ?? []).map((f) => [
    f.id ?? '?', appId, f.category ?? '', f.severity ?? '',
    f.description ?? '', f.remediation ?? '',
    f.blocks_migration ? 'true' : 'false', f.signal_ref ?? '',
  ]);

  // ---- fact_risks ----
  const factRisksHeader = ['risk_id', 'app_id', 'category', 'likelihood', 'impact', 'trigger', 'mitigation', 'owner', 'status', 'evidence_ids', 'closed_by', 'closed_at'];
  const factRisksRows: unknown[][] = (plan.risk_register ?? []).map((r) => [
    r.risk_id ?? '?', appId, r.category ?? '', r.likelihood ?? '', r.impact ?? '',
    r.trigger ?? '', r.mitigation ?? '', r.owner ?? '',
    r.status ?? '', Array.isArray(r.evidence_ids) ? r.evidence_ids.join(';') : (r.evidence_ids ?? ''),
    (r as Record<string, unknown>)['closed_by'] ?? '', r.closed_at ?? '',
  ]);

  // ---- fact_assessments ----
  const factAssessmentsHeader = [
    'assessment_id', 'app_id', 'block_name', 'overall_outcome', 'overall_rationale',
    'score', 'threshold', 'status', 'assessor', 'assessed_at',
  ];
  const factAssessmentsRows: unknown[][] = [];
  const blockNames: Array<keyof typeof plan> = [
    'observability', 'licence_compliance', 'testing_maturity', 'architecture_assessment',
    'database_assessment', 'integration_assessment', 'iam_assessment', 'dr_assessment',
    'landing_zone_readiness',
  ];
  for (const blockName of blockNames) {
    const block = plan[blockName] as Record<string, unknown> | undefined;
    if (!block) continue;
    factAssessmentsRows.push([
      `${appId}::${blockName}`, appId, blockName,
      block.overall_outcome ?? '', block.overall_rationale ?? '',
      typeof block.score === 'number' ? block.score : '',
      typeof block.threshold === 'number' ? block.threshold : '',
      block.sovereign_migration_risk ?? block.overall_risk ?? '',
      block.assessor ?? '', block.assessed_at ?? '',
    ]);
  }

  // ---- fact_assessments: scope_coverage row (#0265, Sprint 030) ----
  // Distinct field shape from the 9 plan blocks above (no overall_outcome /
  // overall_rationale; counts + ratio instead). Mapped to the existing
  // header for symmetry: score = coverage_ratio, threshold = 0.5 (mirrors
  // doctor [8/8] Scope WARN threshold), status = PASS / WARN / EMPTY.
  const SCOPE_THRESHOLD = 0.5;
  const scope = plan.scope_coverage;
  if (scope) {
    const total = typeof scope.total_blind_spots === 'number' ? scope.total_blind_spots : 0;
    const closed = typeof scope.closed === 'number' ? scope.closed : 0;
    const partial = typeof scope.partial === 'number' ? scope.partial : 0;
    const open = typeof scope.open === 'number' ? scope.open : 0;
    const ratio = typeof scope.coverage_ratio === 'number' ? scope.coverage_ratio : 0;
    const status = total === 0 ? 'EMPTY' : ratio >= SCOPE_THRESHOLD ? 'PASS' : 'WARN';
    const overallOutcome = `${closed}/${total} closed`;
    // Use ` / ` (no comma) so the column survives the audit-gate test's
    // permissive CSV split helper, which does not honour quoted fields.
    const overallRationale = `${partial} partial / ${open} open (catalogue ${scope.catalogue_version ?? 'unknown'})`;
    factAssessmentsRows.push([
      `${appId}::scope_coverage`, appId, 'scope_coverage',
      overallOutcome, overallRationale,
      ratio, SCOPE_THRESHOLD, status,
      'rule_engine', spine.assessed_at ?? '',
    ]);
  }

  // ---- fact_scope_coverage: per-blind-spot rows (#0265, #0263 Phase 3) ----
  // One row per catalogue entry, carrying coverage status + severity +
  // input hints + related regimes. Powers the Scope Coverage page matrix
  // (category -> blind_spot_id -> related_regimes) and the open-spots
  // table (filtered by coverage='open', sorted by severity, showing
  // input_required so the consultant knows what to ask the customer for).
  const factScopeCoverageHeader = [
    'blind_spot_id', 'app_id', 'name', 'category', 'coverage', 'severity',
    'input_required', 'input_provided', 'related_regimes', 'assessor', 'assessed_at',
  ];
  const factScopeCoverageRows: unknown[][] = [];
  for (const bs of scope?.blind_spots ?? []) {
    if (!bs.id) continue;
    factScopeCoverageRows.push([
      bs.id, appId, bs.name ?? '', bs.category ?? '',
      bs.coverage ?? '', bs.severity ?? '',
      bs.input_required ?? '', bs.input_provided ?? '',
      (bs.related_regimes ?? []).join(';'),
      bs.assessor ?? 'rule_engine', bs.assessed_at ?? '',
    ]);
  }

  // ---- fact_runs ----
  const factRunsHeader = [
    'run_id', 'app_id', 'started_at', 'finished_at', 'duration_ms', 'duration_minutes',
    'iter', 'assessed_at', 'total_signals_emitted', 'passes_executed_count',
    'llm_provider', 'llm_model', 'llm_total_tokens_in', 'llm_total_tokens_out',
    'llm_total_cost_usd', 'llm_call_count',
    'files_inventory_count', 'files_source_total', 'files_imports_total',
    'lz_weight_sovereign_score', 'lz_weight_service_coverage',
    'lz_weight_portability', 'lz_weight_cost_tier',
    'data_quality_flags',
  ];
  const factRunsRows: unknown[][] = [];
  if (runManifest && runManifest.run_id) {
    const dqConditions = evaluateDataQuality(runManifest as unknown as RunManifest);
    factRunsRows.push([
      runManifest.run_id, appId,
      runManifest.started_at ?? '', runManifest.finished_at ?? '',
      runManifest.duration_ms ?? '', typeof runManifest.duration_ms === 'number' ? (runManifest.duration_ms / 60000).toFixed(2) : '',
      runManifest.iter ?? '', spine.assessed_at ?? '',
      runManifest.total_signals_emitted ?? '', runManifest.passes_executed?.length ?? '',
      runManifest.llm?.provider ?? '', runManifest.llm?.model ?? '',
      runManifest.llm?.total_tokens_in ?? '', runManifest.llm?.total_tokens_out ?? '',
      runManifest.llm?.total_cost_usd ?? '', runManifest.llm?.call_count ?? '',
      runManifest.files_assessed?.inventory_count ?? '',
      runManifest.files_assessed?.source_files_total ?? '',
      runManifest.files_assessed?.imports_files_total ?? '',
      runManifest.landing_zone_weights?.sovereign_score ?? '',
      runManifest.landing_zone_weights?.service_coverage ?? '',
      runManifest.landing_zone_weights?.portability ?? '',
      runManifest.landing_zone_weights?.cost_tier ?? '',
      buildDataQualityFlagsString(dqConditions),
    ]);
  }

  // ---- fact_pass_runs ----
  const factPassRunsHeader = [
    'run_id', 'app_id', 'pass_num', 'pass_name', 'wall_clock_ms', 'signals_emitted',
    'tokens_in', 'tokens_out', 'cost_usd',
  ];
  // Deduplicate by pass_num: audit sub-passes (audit_ingestion / audit_evidence /
  // audit_synthesis) all map to pass_num='00', producing three rows with the same
  // key. The PBI template uses fact_pass_runs.pass_num as the "one" side of a
  // relationship, so duplicates cause a load error. Aggregate numeric metrics
  // across rows that share a pass_num; join pass_names with '+'.
  const factPassRunsRows: unknown[][] = (() => {
    type Bucket = { runId: string; passName: string; wallMs: number; signals: number; tokIn: number; tokOut: number; cost: number };
    const byNum = new Map<string, Bucket>();
    const runId = runManifest?.run_id ?? '';
    for (const p of (runManifest?.pass_stats ?? [])) {
      const key = String(p.num ?? '');
      const b = byNum.get(key);
      if (b) {
        if (p.pass) b.passName += '+' + String(p.pass);
        b.wallMs   += Number(p.wall_clock_ms)   || 0;
        b.signals  += Number(p.signals_emitted)  || 0;
        b.tokIn    += Number(p.tokens_in)        || 0;
        b.tokOut   += Number(p.tokens_out)       || 0;
        b.cost     += Number(p.cost_usd)         || 0;
      } else {
        byNum.set(key, {
          runId, passName: String(p.pass ?? ''),
          wallMs:   Number(p.wall_clock_ms)   || 0,
          signals:  Number(p.signals_emitted)  || 0,
          tokIn:    Number(p.tokens_in)        || 0,
          tokOut:   Number(p.tokens_out)       || 0,
          cost:     Number(p.cost_usd)         || 0,
        });
      }
    }
    return Array.from(byNum.entries()).map(([num, b]) => [
      b.runId, appId, num, b.passName,
      b.wallMs, b.signals,
      b.tokIn, b.tokOut, b.cost,
    ]);
  })();

  // ---- dim_app ----
  // #0228: engagement_name / client_code / partnership_lead / start_date
  // appended at end so existing PowerBI visuals continue to work; new
  // columns can be added to Dashboard cards on next refresh.
  const dimAppHeader = [
    'app_id', 'name', 'business_domain', 'business_criticality', 'regulatory_class',
    'seven_r_label', 'modernization_position', 'coverage_score', 'confidence',
    'portability_score', 'landing_zone',
    'engagement_name', 'client_code', 'partnership_lead', 'engagement_start_date',
  ];
  const dimAppRows: unknown[][] = [[
    appId, appBlock.name ?? appId,
    appBlock.business_domain ?? '', appBlock.business_criticality ?? '',
    appBlock.regulatory_class ?? '',
    spine.overall?.seven_r_label ?? '', spine.overall?.modernization_position ?? '',
    spine.overall?.coverage_score ?? 0, spine.overall?.confidence ?? '',
    spine.overall?.portability_score ?? 0, spine.landing_zone?.primary ?? '',
    spine.engagement?.name ?? '', spine.engagement?.client_code ?? '',
    // partnership_lead: read raw from spine; if it's an array ([REDACTED-EMAIL] YAML parse),
    // take the first element. The leading/trailing bracket from YAML array syntax is stripped.
    ((): string => {
      const raw = spine.engagement?.partnership_lead;
      if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : '';
      if (typeof raw === 'string') return raw;
      return '';
    })(), spine.engagement?.start_date ?? '',
  ]];

  // ---- dim_pass ----
  // #0241: include pass 11 (compliance_evaluation) and pass 12
  // (block_assessments). Without these rows, fact_pass_runs entries for
  // pass_num=11/12 do not join to dim_pass, so any PowerBI visual that
  // groups cost / wall-clock by dim_pass[name] silently drops them.
  const dimPassRows: unknown[][] = [
    ['00', 'pre_assessment', 'PRE', ''],
    ['01', 'inventory', 'INV', ''],
    ['02', 'state_analysis', 'STATE', ''],
    ['03', 'data_classification', 'DATA', ''],
    ['04', 'context_ingestion', 'CTX', ''],
    ['05', 'sbom_cve', 'SBOM', ''],
    ['06', 'twelve_factor', 'TF', ''],
    ['07', 'egress', 'EGR', ''],
    ['08', 'crypto_posture', 'CRYPTO', ''],
    ['09', 'synthesis', 'SYNTH', ''],
    ['10', 'dynamic_analysis', 'DYN', ''],
    ['11', 'compliance_evaluation', 'COMP', ''],
    // Pass 12 emits 0 signals (assessment.blocks is spread into wsp-plan
    // by derive-plan.ts; it does not produce fact_signals rows), so
    // sharing pass 11's COMP prefix is unambiguous. Keeps dim_pass in
    // lockstep with pass-12-blocks.ts::pass.signal_prefix.
    ['12', 'block_assessments', 'COMP', ''],
    ['15', 'observability', 'OBS', 'observability'],
    ['16', 'licence_compliance', 'LIC', 'licence_compliance'],
    ['17', 'testing_maturity', 'QA', 'testing_maturity'],
    ['18', 'architecture_pattern', 'PAT', 'architecture_assessment'],
    ['19', 'database_migration', 'DBA', 'database_assessment'],
    ['20', 'integration_pattern', 'INT', 'integration_assessment'],
    ['21', 'iam', 'IAM', 'iam_assessment'],
    ['22', 'dr_backup', 'DR', 'dr_assessment'],
    ['23', 'lzr', 'LZR', 'landing_zone_readiness'],
  ];

  // ---- dim_regime ----
  // #0393 (sprint-040): scope column now reads 'community' for every row.
  // ADR-0035 (sprint-039 #0358 Phase 3) retired the standard scope; every
  // framework ships as community. The 'standard' literal here was a
  // leftover that gave operators the wrong mental model in PowerBI.
  const dimRegimeRows: unknown[][] = Array.from(dimRegimeMap.entries()).map(([id, r]) => [
    id, r.name, r.version, 'community', r.authority, r.catalogueVersion, r.controlsCount,
  ]);

  // ---- dim_control ----
  const dimControlRows: unknown[][] = Array.from(dimControlMap.entries()).map(([id, c]) => [
    id, c.regime, c.title, c.description, c.severityDefault, c.catalogueVersion,
  ]);

  // ---- dim_evidence ----
  const dimEvidenceHeader = [
    'evidence_id', 'evidence_type', 'source_path', 'summary', 'context_input',
    'collected_at', 'reliability_weight',
  ];
  // #0256: catalogue carries source_path (new) + file (back-compat) for
  // the source-path column; collected_at (new) + date (back-compat) for
  // the date column.
  const dimEvidenceRows: unknown[][] = Object.entries(evidenceRoot.evidence_catalogue ?? {}).map(([id, ev]) => [
    id, ev.type ?? '',
    (ev as { source_path?: string }).source_path ?? ev.file ?? '',
    ev.summary ?? '',
    ev.context_input ?? '',
    ev.collected_at ?? (ev as { date?: string }).date ?? '',
    ev.reliability_weight ?? '',
  ]);

  // ---- dim_severity ----
  const dimSeverityRows: unknown[][] = [
    ['critical', 5, 'severity'],
    ['high', 4, 'severity'],
    ['medium', 3, 'severity'],
    ['low', 2, 'severity'],
    ['informational', 1, 'severity'],
    ['positive', 0, 'severity'],
    ['SATISFIED', 1, 'control_outcome'],
    ['PARTIAL', 2, 'control_outcome'],
    ['GAP', 3, 'control_outcome'],
    ['UNKNOWN', 4, 'control_outcome'],
    ['N_A', 5, 'control_outcome'],
    ['positive', 1, 'signal_outcome'],
    ['neutral', 2, 'signal_outcome'],
    ['indeterminate', 3, 'signal_outcome'],
    ['negative', 4, 'signal_outcome'],
  ];

  // ---- dim_wave (Sprint 021 Tier 2 stub; rows populated by post-PoC #0068) ----
  const dimWaveHeader = ['wave_number', 'name', 'target_quarter', 'selection_criteria'];
  const dimWaveRows: unknown[][] = [];

  // ---- dim_override (Design 080 §7.3): attributed override audit trail (#1188) ----
  const dimOverrideHeader = [
    'override_id', 'target_kind', 'target_id', 'app_id',
    'author', 'role', 'timestamp', 'machine_value', 'override_value', 'rationale',
  ];
  const dimOverrideRows: unknown[][] = [];
  // Controls with overrides
  for (const regime of (plan.compliance?.regimes ?? [])) {
    for (const ctrl of (regime.controls ?? [])) {
      if (ctrl.override) {
        const ov = ctrl.override;
        dimOverrideRows.push([
          `ov-ctrl-${String(ctrl.id ?? '?')}`,
          'control', ctrl.id ?? '?', appId,
          ov.author ?? '', ov.role ?? '', ov.timestamp ?? '',
          ctrl.machine_outcome ?? '', ctrl.outcome ?? '', ov.rationale ?? '',
        ]);
      }
    }
  }
  // Risks with overrides
  for (const r of (plan.risk_register ?? [])) {
    if (r.override) {
      const ov = r.override;
      dimOverrideRows.push([
        `ov-risk-${String(r.risk_id ?? '?')}`,
        'risk', r.risk_id ?? '?', appId,
        ov.author ?? '', ov.role ?? '', ov.timestamp ?? '',
        r.machine_outcome ?? '', r.status ?? '', ov.rationale ?? '',
      ]);
    }
  }

  // ---- fact_app_heatmap (#0412/#0413) -- one row per (app, regime) ----
  const heatmapHeader = [
    'app_id', 'regime_id', 'satisfied_count', 'partial_count',
    'gap_count', 'unknown_count', 'n_a_count', 'gap_score',
  ];
  const heatmapBuckets = new Map<string, { satisfied: number; partial: number; gap: number; unknown: number; n_a: number; weighted_gap: number }>();
  {
    const outcomeIdx = factControlsHeader.indexOf('outcome');
    const regimeIdx = factControlsHeader.indexOf('regime_id');
    const severityIdx = factControlsHeader.indexOf('severity');
    for (const row of factControlsRows) {
      const regime = String(row[regimeIdx] ?? '?');
      const outcome = String(row[outcomeIdx] ?? '');
      const severity = String(row[severityIdx] ?? '');
      if (!heatmapBuckets.has(regime)) {
        heatmapBuckets.set(regime, { satisfied: 0, partial: 0, gap: 0, unknown: 0, n_a: 0, weighted_gap: 0 });
      }
      const b = heatmapBuckets.get(regime)!;
      if (outcome === 'SATISFIED') b.satisfied += 1;
      else if (outcome === 'PARTIAL') b.partial += 1;
      else if (outcome === 'GAP') b.gap += 1;
      else if (outcome === 'UNKNOWN') b.unknown += 1;
      else if (outcome === 'N_A') b.n_a += 1;
      if (outcome === 'GAP' || outcome === 'PARTIAL') b.weighted_gap += severityRank(severity);
    }
  }
  const heatmapRows: unknown[][] = [];
  for (const [regime, b] of heatmapBuckets) {
    heatmapRows.push([appId, regime, b.satisfied, b.partial, b.gap, b.unknown, b.n_a, b.weighted_gap]);
  }

  // ---- fact_app_summary (#0412/#0413) -- one row per app ----
  const summaryHeader = [
    'app_id', 'seven_r_label', 'modernization_position',
    'portability_score', 'coverage_score',
    'total_negative_signals', 'weighted_risk_score',
  ];
  const dimAppRow = dimAppRows[0] ?? [];
  const sevenRIdx = dimAppHeader.indexOf('seven_r_label');
  const modIdx = dimAppHeader.indexOf('modernization_position');
  const portIdx = dimAppHeader.indexOf('portability_score');
  const covIdx = dimAppHeader.indexOf('coverage_score');
  const factOutcomeIdx = factSignalsHeader.indexOf('outcome');
  const factSevIdx = factSignalsHeader.indexOf('severity');
  let totalNegSignals = 0;
  let weightedRisk = 0;
  for (const row of factSignalsRows) {
    const outcome = String(row[factOutcomeIdx] ?? '');
    const severity = String(row[factSevIdx] ?? '');
    if (outcome === 'negative') { totalNegSignals += 1; weightedRisk += severityRank(severity); }
  }
  const summaryRows: unknown[][] = [[
    appId,
    dimAppRow[sevenRIdx] ?? '',
    dimAppRow[modIdx] ?? '',
    dimAppRow[portIdx] ?? '',
    dimAppRow[covIdx] ?? '',
    totalNegSignals,
    weightedRisk,
  ]];

  // ---- fact_lz_assessment + dim_landing_zone + link_lz_gap (#1259 #1527) ----
  // Read lz-catalogue-fit-*.yaml files from the latest LZ run directory.
  // The LZ run pointer is wsp/latest-landing-zone-catalog.txt; the per-region
  // fit files live directly in that run directory (not in passes/).
  // Also checks passesDir for older lz-fit-*.yaml format for backward compat.
  interface RawLzFitFile {
    pass?: { id?: string; assessed_at?: string };
    assessment?: {
      provider?: string;
      region?: string;
      overall?: string;
      assessment_mode?: string;
      generated_at?: string;
      items?: Array<{ framework?: string; requirement?: string; status?: string }>;
    };
  }
  const factLzHeader = ['lz_run_id', 'app_id', 'provider', 'region_id', 'verdict', 'gap_count', 'assessment_mode', 'assessed_at'];
  const factLzRows: unknown[][] = [];
  const dimLzHeader = ['lz_id', 'provider', 'region_id'];
  const dimLzRows: unknown[][] = [];
  const linkLzGapHeader = ['lz_run_id', 'app_id', 'gap_code', 'gap_type'];
  const linkLzGapRows: unknown[][] = [];

  // #1527: resolve the latest LZ run directory via the standard pointer file.
  const wspDir = join(ctx.workspaceAppDir, 'wsp');
  const lzPtrPath = join(wspDir, 'latest-landing-zone-catalog.txt');
  let lzRunDir: string | null = null;
  if (existsSync(lzPtrPath)) {
    try {
      const ptr = readFileSync(lzPtrPath, 'utf-8').trim();
      if (ptr) {
        const candidate = join(wspDir, ptr);
        if (existsSync(candidate)) lzRunDir = candidate;
      }
    } catch { /* best-effort */ }
  }

  const lzSearchDirs: Array<{ dir: string; prefix: string }> = [];
  if (lzRunDir) {
    lzSearchDirs.push({ dir: lzRunDir, prefix: 'lz-catalogue-fit-' });
  }
  // Backward compat: lz-fit-*.yaml in passes/ (pre-sprint-116 format)
  if (existsSync(passesDir)) {
    lzSearchDirs.push({ dir: passesDir, prefix: 'lz-fit-' });
  }

  for (const { dir, prefix } of lzSearchDirs) {
    const lzFiles = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && (f.endsWith('.yaml') || f.endsWith('.yml')))
      .sort();
    for (const lzf of lzFiles) {
      const lz = safeReadYaml<RawLzFitFile>(join(dir, lzf));
      const a = lz?.assessment;
      if (!a) continue;
      const provider = a.provider ?? '';
      const region = a.region ?? '';
      const lzId = `${provider}/${region}`;
      const verdict = a.overall ?? '';
      const assessedAt = lz?.pass?.assessed_at ?? a.generated_at ?? '';
      const notMetItems = (a.items ?? []).filter((it) => it.status === 'NOT_MET');
      const gapCount = notMetItems.length;
      factLzRows.push([lzId, appId, provider, region, verdict, gapCount, a.assessment_mode ?? '', assessedAt]);
      // dim_landing_zone: deduplicate by lzId
      if (!dimLzRows.some((r) => r[0] === lzId)) {
        dimLzRows.push([lzId, provider, region]);
      }
      for (const item of notMetItems) {
        const gapCode = `${item.framework ?? ''}/${item.requirement ?? ''}`;
        linkLzGapRows.push([lzId, appId, gapCode, 'certification']);
      }
    }
  }

  return {
    fact_signals: { header: factSignalsHeader, rows: factSignalsRows },
    fact_controls: { header: factControlsHeader, rows: factControlsRows },
    fact_findings: { header: factFindingsHeader, rows: factFindingsRows },
    fact_risks: { header: factRisksHeader, rows: factRisksRows },
    fact_assessments: { header: factAssessmentsHeader, rows: factAssessmentsRows },
    fact_scope_coverage: { header: factScopeCoverageHeader, rows: factScopeCoverageRows },
    fact_runs: { header: factRunsHeader, rows: factRunsRows },
    fact_pass_runs: { header: factPassRunsHeader, rows: factPassRunsRows },
    dim_app: { header: dimAppHeader, rows: dimAppRows },
    dim_pass: { header: ['pass_num', 'name', 'signal_prefix', 'assessment_block_name'], rows: dimPassRows },
    dim_regime: { header: ['regime_id', 'name', 'version', 'scope', 'authority', 'catalogue_version', 'controls_count'], rows: dimRegimeRows },
    dim_control: { header: ['control_id', 'regime_id', 'title', 'description', 'severity_default', 'catalogue_version'], rows: dimControlRows },
    dim_evidence: { header: dimEvidenceHeader, rows: dimEvidenceRows },
    dim_severity: { header: ['severity', 'rank', 'category'], rows: dimSeverityRows },
    dim_wave: { header: dimWaveHeader, rows: dimWaveRows },
    link_signal_evidence: { header: ['signal_id', 'evidence_id', 'app_id'], rows: linkSignalEvidenceRows },
    link_control_signal: { header: ['control_id', 'signal_id', 'regime_id', 'app_id'], rows: linkControlSignalRows },
    link_control_evidence: { header: ['control_id', 'evidence_id', 'regime_id', 'app_id'], rows: linkControlEvidenceRows },
    link_control_tag: { header: ['control_id', 'tag', 'tag_kind', 'regime_id', 'app_id'], rows: linkControlTagRows },
    dim_override: { header: dimOverrideHeader, rows: dimOverrideRows },
    fact_app_heatmap: { header: heatmapHeader, rows: heatmapRows },
    fact_app_summary: { header: summaryHeader, rows: summaryRows },
    fact_lz_assessment: { header: factLzHeader, rows: factLzRows },
    dim_landing_zone: { header: dimLzHeader, rows: dimLzRows },
    link_lz_gap: { header: linkLzGapHeader, rows: linkLzGapRows },
  };
}

// --------------------------------------------------------------------
// NDJSON mirror (#0178)
// --------------------------------------------------------------------

// Columns that hold semicolon-joined arrays in CSV form. The NDJSON
// writer splits these back into JSON arrays so consumers (PowerBI Get
// Data > JSON, dbt, custom ETL) get typed nested arrays.
const NDJSON_ARRAY_COLUMNS: Record<string, string[]> = {
  fact_signals: ['derivation_chain'],
  fact_scope_coverage: ['related_regimes'],
};

function rowToObject(header: string[], row: unknown[], tableName: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const arrayCols = new Set(NDJSON_ARRAY_COLUMNS[tableName] ?? []);
  for (let i = 0; i < header.length; i++) {
    const key = header[i]!;
    const val = row[i];
    if (arrayCols.has(key) && typeof val === 'string') {
      obj[key] = val.length === 0 ? [] : val.split(';');
    } else if (val === '') {
      obj[key] = null;
    } else if (typeof val === 'string' && /^[+-]?\d+(\.\d+)?$/.test(val)) {
      obj[key] = Number(val);
    } else if (val === 'true' || val === 'false') {
      obj[key] = val === 'true';
    } else {
      obj[key] = val ?? null;
    }
  }
  return obj;
}

function writeNdjsonFile(
  path: string,
  header: string[],
  rows: unknown[][],
  tableName: string,
  ctx: ExportContext,
): { rows: number; bytes: number; sha256: string } {
  const sep = ctx.crlf ? '\r\n' : '\n';
  let body = '';
  for (const row of rows) {
    body += JSON.stringify(rowToObject(header, row, tableName)) + sep;
  }
  writeFileSync(path, body, 'utf-8');
  const buf = Buffer.from(body, 'utf-8');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { rows: rows.length, bytes: buf.byteLength, sha256 };
}

export function writeNdjsonExport(ctx: ExportContext): WriteStarResult {
  const exportsRoot = join(ctx.workspaceAppDir, 'wsp', 'exports', ctx.timestamp);
  const ndjsonDir = join(exportsRoot, 'ndjson');
  mkdirSync(ndjsonDir, { recursive: true });

  const tables = buildStarTables(ctx);
  const manifestFiles: ManifestFile[] = [];

  for (const [name, table] of Object.entries(tables)) {
    const path = join(ndjsonDir, `${name}.ndjson`);
    const stat = writeNdjsonFile(path, table.header, table.rows, name, ctx);
    manifestFiles.push({
      path: `ndjson/${name}.ndjson`,
      rows: stat.rows,
      sha256: stat.sha256,
      bytes: stat.bytes,
    });
  }

  const { runId } = resolveSourceWspRun(ctx.workspaceAppDir);
  const manifest: ExportManifest = {
    bundle_schema_version: SCHEMA_VERSION,
    source_wsp_run: runId,
    app_id: ctx.appId,
    generated_at: new Date().toISOString(),
    files: manifestFiles,
  };
  return { bundleDir: exportsRoot, manifest };
}

// --------------------------------------------------------------------
// XLSX rollup (#0179)
// --------------------------------------------------------------------

interface XlsxConfig {
  /** Optionally suppress the pre-pivoted Auditor sheet (faster). */
  noAuditorSheet?: boolean;
}

const XLSX_HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E79' } };
const XLSX_HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function applyXlsxHeader<TWorksheet extends { columns: { width?: number }[]; getRow: (n: number) => { fill?: unknown; font?: unknown; height?: number; values?: unknown } }>(
  ws: TWorksheet,
  header: string[],
): void {
  ws.columns = header.map((h) => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 4)) }));
  const headerRow = ws.getRow(1);
  headerRow.fill = XLSX_HEADER_FILL;
  headerRow.font = XLSX_HEADER_FONT;
  headerRow.height = 22;
}

function buildAuditorSheetRows(tables: StarTables): { header: string[]; rows: unknown[][] } {
  // Pre-pivoted: one row per control with rationale, signal_refs joined,
  // evidence_ids joined, plus the regime + outcome + severity for slicing.
  const factControls = tables.fact_controls;
  const linkCtrlSig = tables.link_control_signal;
  const linkCtrlEv = tables.link_control_evidence;
  const cIdIdx = factControls.header.indexOf('control_id');
  const regimeIdx = factControls.header.indexOf('regime_id');
  const outcomeIdx = factControls.header.indexOf('outcome');
  const sevIdx = factControls.header.indexOf('severity');
  const ratIdx = factControls.header.indexOf('rationale');
  const remIdx = factControls.header.indexOf('remediation');
  const assessorIdx = factControls.header.indexOf('assessor');
  const assessedAtIdx = factControls.header.indexOf('assessed_at');

  const sigByCtrl = new Map<string, string[]>();
  for (const row of linkCtrlSig.rows) {
    const cid = String(row[0] ?? '');
    const sid = String(row[1] ?? '');
    if (!sigByCtrl.has(cid)) sigByCtrl.set(cid, []);
    sigByCtrl.get(cid)!.push(sid);
  }
  const evByCtrl = new Map<string, string[]>();
  for (const row of linkCtrlEv.rows) {
    const cid = String(row[0] ?? '');
    const eid = String(row[1] ?? '');
    if (!evByCtrl.has(cid)) evByCtrl.set(cid, []);
    evByCtrl.get(cid)!.push(eid);
  }

  const header = [
    'regime_id', 'control_id', 'outcome', 'severity',
    'rationale', 'signal_refs', 'evidence_ids',
    'assessor', 'assessed_at', 'remediation',
  ];
  const rows: unknown[][] = factControls.rows.map((row) => {
    const cid = String(row[cIdIdx] ?? '');
    return [
      row[regimeIdx] ?? '',
      cid,
      row[outcomeIdx] ?? '',
      row[sevIdx] ?? '',
      row[ratIdx] ?? '',
      (sigByCtrl.get(cid) ?? []).join(', '),
      (evByCtrl.get(cid) ?? []).join(', '),
      row[assessorIdx] ?? '',
      row[assessedAtIdx] ?? '',
      row[remIdx] ?? '',
    ];
  });
  return { header, rows };
}

export async function writeXlsxExport(
  ctx: ExportContext,
  config: XlsxConfig = {},
): Promise<WriteStarResult> {
  // Top-level import -- pkg snapshot binaries don't supply Node's
  // dynamic-import callback (#0231/Pass11 follow-up), so await import()
  // inside commander actions throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING.
  const ExcelJS = excelJsModule;
  const Workbook = ExcelJS.default?.Workbook ?? (ExcelJS as unknown as { Workbook: typeof import('exceljs').Workbook }).Workbook;

  const exportsRoot = join(ctx.workspaceAppDir, 'wsp', 'exports', ctx.timestamp);
  const xlsxDir = join(exportsRoot, 'xlsx');
  mkdirSync(xlsxDir, { recursive: true });

  const tables = buildStarTables(ctx);
  const wb = new Workbook();
  wb.creator = 'SWAO';
  wb.created = new Date();

  // Pre-pivoted Auditor sheet first (so it lands at the top of the tab list).
  if (!config.noAuditorSheet) {
    const auditor = buildAuditorSheetRows(tables);
    const ws = wb.addWorksheet('Auditor view', { views: [{ state: 'frozen', ySplit: 1 }] });
    applyXlsxHeader(ws, auditor.header);
    for (const row of auditor.rows) ws.addRow(row);
    ws.autoFilter = { from: 'A1', to: { row: 1, column: auditor.header.length } };
  }

  // One sheet per fact + dim + link table.
  for (const [name, table] of Object.entries(tables)) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    applyXlsxHeader(ws, table.header);
    for (const row of table.rows) ws.addRow(row);
    ws.autoFilter = { from: 'A1', to: { row: 1, column: table.header.length } };
  }

  const xlsxPath = join(xlsxDir, 'swao-export.xlsx');
  await wb.xlsx.writeFile(xlsxPath);

  // Manifest (single XLSX file, plus row counts the consumer can verify).
  const buf = readFileSync(xlsxPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const manifestFiles: ManifestFile[] = [{
    path: 'xlsx/swao-export.xlsx',
    rows: Object.values(tables).reduce((sum, t) => sum + t.rows.length, 0),
    sha256,
    bytes: buf.byteLength,
  }];

  const { runId } = resolveSourceWspRun(ctx.workspaceAppDir);
  const manifest: ExportManifest = {
    bundle_schema_version: SCHEMA_VERSION,
    source_wsp_run: runId,
    app_id: ctx.appId,
    generated_at: new Date().toISOString(),
    files: manifestFiles,
  };
  return { bundleDir: exportsRoot, manifest };
}

// --------------------------------------------------------------------
// Portfolio bundle (#0186) -- Tier 1 facts
// --------------------------------------------------------------------

export interface PortfolioExportContext {
  /** Workspace root containing `apps/<id>/` subdirectories. */
  workspaceRoot: string;
  /** ISO-8601 timestamp; folder name under `<workspace>/wsp/exports/` (#0230). */
  timestamp: string;
  crlf?: boolean;
  noBom?: boolean;
}

export interface PortfolioApp {
  appId: string;
  workspaceAppDir: string;
}

export function discoverPortfolioApps(workspaceRoot: string): PortfolioApp[] {
  const appsRoot = join(workspaceRoot, 'apps');
  if (!existsSync(appsRoot)) return [];
  const out: PortfolioApp[] = [];
  for (const name of readdirSync(appsRoot)) {
    const dir = join(appsRoot, name);
    try {
      if (existsSync(join(dir, 'wsp'))) out.push({ appId: name, workspaceAppDir: dir });
    } catch { /* skip non-dir entries */ }
  }
  return out.sort((a, b) => a.appId.localeCompare(b.appId));
}

export interface PortfolioStarTables {
  fact_signals: { header: string[]; rows: unknown[][] };
  fact_controls: { header: string[]; rows: unknown[][] };
  fact_findings: { header: string[]; rows: unknown[][] };
  fact_risks: { header: string[]; rows: unknown[][] };
  fact_assessments: { header: string[]; rows: unknown[][] };
  fact_scope_coverage: { header: string[]; rows: unknown[][] };
  fact_runs: { header: string[]; rows: unknown[][] };
  fact_pass_runs: { header: string[]; rows: unknown[][] };
  fact_app_heatmap: { header: string[]; rows: unknown[][] };
  fact_app_summary: { header: string[]; rows: unknown[][] };
  dim_app: { header: string[]; rows: unknown[][] };
  dim_pass: { header: string[]; rows: unknown[][] };
  dim_regime: { header: string[]; rows: unknown[][] };
  dim_control: { header: string[]; rows: unknown[][] };
  dim_evidence: { header: string[]; rows: unknown[][] };
  dim_severity: { header: string[]; rows: unknown[][] };
  dim_wave: { header: string[]; rows: unknown[][] };
  link_signal_evidence: { header: string[]; rows: unknown[][] };
  link_control_signal: { header: string[]; rows: unknown[][] };
  link_control_evidence: { header: string[]; rows: unknown[][] };
  // #0361 -- portfolio-aggregated link_control_tag merged from per-app
  // bundles. Same shape as the per-app version.
  link_control_tag: { header: string[]; rows: unknown[][] };
  dim_override: { header: string[]; rows: unknown[][] };
  // #1259 -- LZ catalog assessment tables (aggregated from per-app lz-fit pass files).
  fact_lz_assessment: { header: string[]; rows: unknown[][] };
  dim_landing_zone: { header: string[]; rows: unknown[][] };
  link_lz_gap: { header: string[]; rows: unknown[][] };
}

function severityRank(s: string): number {
  switch (s) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    case 'informational': return 1;
    default: return 0;
  }
}

export function buildPortfolioStarTables(ctx: PortfolioExportContext, apps: PortfolioApp[]): PortfolioStarTables {
  // Concatenate per-app star tables. Reuses buildStarTables for each app
  // so the column shapes stay identical between single-app and portfolio
  // bundles.
  const merged: Record<string, { header: string[]; rows: unknown[][] }> = {};
  const perAppHeatmap = new Map<string, Map<string, { satisfied: number; partial: number; gap: number; unknown: number; n_a: number; weighted_gap: number }>>();
  const perAppSummary: Array<Record<string, unknown>> = [];

  for (const app of apps) {
    const tables = buildStarTables({
      workspaceAppDir: app.workspaceAppDir,
      appId: app.appId,
      timestamp: ctx.timestamp,
      crlf: ctx.crlf,
      noBom: ctx.noBom,
    });
    for (const [name, table] of Object.entries(tables)) {
      if (!merged[name]) merged[name] = { header: table.header, rows: [] };
      merged[name].rows.push(...table.rows);
    }

    // Heatmap: counts per (app, regime) from fact_controls.
    const factControls = tables.fact_controls;
    const outcomeIdx = factControls.header.indexOf('outcome');
    const regimeIdx = factControls.header.indexOf('regime_id');
    const severityIdx = factControls.header.indexOf('severity');
    if (outcomeIdx >= 0 && regimeIdx >= 0) {
      const buckets = new Map<string, { satisfied: number; partial: number; gap: number; unknown: number; n_a: number; weighted_gap: number }>();
      for (const row of factControls.rows) {
        const regime = String(row[regimeIdx] ?? '?');
        const outcome = String(row[outcomeIdx] ?? '');
        const severity = String(row[severityIdx] ?? '');
        if (!buckets.has(regime)) {
          buckets.set(regime, { satisfied: 0, partial: 0, gap: 0, unknown: 0, n_a: 0, weighted_gap: 0 });
        }
        const b = buckets.get(regime)!;
        if (outcome === 'SATISFIED') b.satisfied += 1;
        else if (outcome === 'PARTIAL') b.partial += 1;
        else if (outcome === 'GAP') b.gap += 1;
        else if (outcome === 'UNKNOWN') b.unknown += 1;
        else if (outcome === 'N_A') b.n_a += 1;
        if (outcome === 'GAP' || outcome === 'PARTIAL') {
          b.weighted_gap += severityRank(severity);
        }
      }
      perAppHeatmap.set(app.appId, buckets);
    }

    // Summary: one row per app keyed off dim_app.
    const dimApp = tables.dim_app;
    const sevenRIdx = dimApp.header.indexOf('seven_r_label');
    const portIdx = dimApp.header.indexOf('portability_score');
    const covIdx = dimApp.header.indexOf('coverage_score');
    const modIdx = dimApp.header.indexOf('modernization_position');
    const dimAppRow = dimApp.rows[0] ?? [];
    const factSignals = tables.fact_signals;
    const factOutcomeIdx = factSignals.header.indexOf('outcome');
    const factSevIdx = factSignals.header.indexOf('severity');
    let totalNeg = 0;
    let weighted = 0;
    for (const row of factSignals.rows) {
      const outcome = String(row[factOutcomeIdx] ?? '');
      const severity = String(row[factSevIdx] ?? '');
      if (outcome === 'negative') {
        totalNeg += 1;
        weighted += severityRank(severity);
      }
    }
    perAppSummary.push({
      app_id: app.appId,
      seven_r_label: dimAppRow[sevenRIdx] ?? '',
      modernization_position: dimAppRow[modIdx] ?? '',
      portability_score: dimAppRow[portIdx] ?? '',
      coverage_score: dimAppRow[covIdx] ?? '',
      total_negative_signals: totalNeg,
      weighted_risk_score: weighted,
    });
  }

  // Build fact_app_heatmap rows
  const heatmapHeader = [
    'app_id', 'regime_id', 'satisfied_count', 'partial_count',
    'gap_count', 'unknown_count', 'n_a_count', 'gap_score',
  ];
  const heatmapRows: unknown[][] = [];
  for (const [appId, buckets] of perAppHeatmap) {
    for (const [regime, b] of buckets) {
      heatmapRows.push([
        appId, regime, b.satisfied, b.partial, b.gap, b.unknown, b.n_a, b.weighted_gap,
      ]);
    }
  }

  // Build fact_app_summary rows
  const summaryHeader = [
    'app_id', 'seven_r_label', 'modernization_position',
    'portability_score', 'coverage_score',
    'total_negative_signals', 'weighted_risk_score',
  ];
  const summaryRows: unknown[][] = perAppSummary.map((s) => [
    s.app_id, s.seven_r_label, s.modernization_position,
    s.portability_score, s.coverage_score,
    s.total_negative_signals, s.weighted_risk_score,
  ]);

  // dim_wave header (Tier 2 stub).
  const dimWaveHeader = ['wave_number', 'name', 'target_quarter', 'selection_criteria'];

  // Helper to fall back to the per-app tables when the merged shape is needed
  const getFromMerged = (name: keyof PortfolioStarTables, fallbackHeader: string[]): { header: string[]; rows: unknown[][] } => {
    return merged[name] ?? { header: fallbackHeader, rows: [] };
  };

  return {
    fact_signals: getFromMerged('fact_signals', []),
    fact_controls: getFromMerged('fact_controls', []),
    fact_findings: getFromMerged('fact_findings', []),
    fact_risks: getFromMerged('fact_risks', []),
    fact_assessments: getFromMerged('fact_assessments', []),
    fact_scope_coverage: getFromMerged('fact_scope_coverage', []),
    fact_runs: getFromMerged('fact_runs', []),
    fact_pass_runs: getFromMerged('fact_pass_runs', []),
    fact_app_heatmap: { header: heatmapHeader, rows: heatmapRows },
    fact_app_summary: { header: summaryHeader, rows: summaryRows },
    dim_app: getFromMerged('dim_app', []),
    dim_pass: getFromMerged('dim_pass', []),
    dim_regime: getFromMerged('dim_regime', []),
    dim_control: getFromMerged('dim_control', []),
    dim_evidence: getFromMerged('dim_evidence', []),
    dim_severity: getFromMerged('dim_severity', []),
    dim_wave: { header: dimWaveHeader, rows: [] },
    link_signal_evidence: getFromMerged('link_signal_evidence', []),
    link_control_signal: getFromMerged('link_control_signal', []),
    link_control_evidence: getFromMerged('link_control_evidence', []),
    link_control_tag: getFromMerged('link_control_tag', []),
    dim_override: getFromMerged('dim_override', []),
    fact_lz_assessment: getFromMerged('fact_lz_assessment', []),
    dim_landing_zone: getFromMerged('dim_landing_zone', []),
    link_lz_gap: getFromMerged('link_lz_gap', []),
  };
}

// ---------------------------------------------------------------------------
// Portfolio index (Design 080 §6.1, #1190)
// ---------------------------------------------------------------------------

export interface PortfolioIndexApp {
  app_id: string;
  seven_r_label: string;
  modernization_position: string;
  portability_score: number;
  coverage_score: number;
  total_negative_signals: number;
  weighted_risk_score: number;
  per_regime_coverage: Record<string, { satisfied: number; partial: number; gap: number; weighted_gap: number }>;
  risk_rollup: { open: number; mitigated: number; closed: number; high_count: number };
  lz_verdict: string | null;
}

export interface PortfolioIndex {
  built_at: string;
  schema_version: string;
  apps: PortfolioIndexApp[];
}

export function buildPortfolioIndex(
  tables: PortfolioStarTables,
  builtAt: string,
  lzrSummaryPath?: string,
): PortfolioIndex {
  // Column indices for fact_app_summary
  const sumHdr = tables.fact_app_summary.header;
  const sumIdx = {
    app_id: sumHdr.indexOf('app_id'),
    seven_r_label: sumHdr.indexOf('seven_r_label'),
    modernization_position: sumHdr.indexOf('modernization_position'),
    portability_score: sumHdr.indexOf('portability_score'),
    coverage_score: sumHdr.indexOf('coverage_score'),
    total_negative_signals: sumHdr.indexOf('total_negative_signals'),
    weighted_risk_score: sumHdr.indexOf('weighted_risk_score'),
  };

  // Column indices for fact_app_heatmap
  const hmHdr = tables.fact_app_heatmap.header;
  const hmIdx = {
    app_id: hmHdr.indexOf('app_id'),
    regime: hmHdr.indexOf('regime'),
    satisfied: hmHdr.indexOf('satisfied'),
    partial: hmHdr.indexOf('partial'),
    gap: hmHdr.indexOf('gap'),
    weighted_gap: hmHdr.indexOf('weighted_gap'),
  };

  // Column indices for fact_risks
  const rkHdr = tables.fact_risks.header;
  const rkIdx = {
    app_id: rkHdr.indexOf('app_id'),
    impact: rkHdr.indexOf('impact'),
    status: rkHdr.indexOf('status'),
  };

  // Per-app base stats from fact_app_summary
  const appMap = new Map<string, PortfolioIndexApp>();
  for (const row of tables.fact_app_summary.rows) {
    const appId = String(row[sumIdx.app_id] ?? '');
    if (!appId) continue;
    appMap.set(appId, {
      app_id: appId,
      seven_r_label: String(row[sumIdx.seven_r_label] ?? ''),
      modernization_position: String(row[sumIdx.modernization_position] ?? ''),
      portability_score: Number(row[sumIdx.portability_score] ?? 0),
      coverage_score: Number(row[sumIdx.coverage_score] ?? 0),
      total_negative_signals: Number(row[sumIdx.total_negative_signals] ?? 0),
      weighted_risk_score: Number(row[sumIdx.weighted_risk_score] ?? 0),
      per_regime_coverage: {},
      risk_rollup: { open: 0, mitigated: 0, closed: 0, high_count: 0 },
      lz_verdict: null,
    });
  }

  // Per-regime coverage from fact_app_heatmap
  for (const row of tables.fact_app_heatmap.rows) {
    const appId = String(row[hmIdx.app_id] ?? '');
    const regime = String(row[hmIdx.regime] ?? '');
    if (!appId || !regime) continue;
    const entry = appMap.get(appId);
    if (!entry) continue;
    entry.per_regime_coverage[regime] = {
      satisfied: Number(row[hmIdx.satisfied] ?? 0),
      partial: Number(row[hmIdx.partial] ?? 0),
      gap: Number(row[hmIdx.gap] ?? 0),
      weighted_gap: Number(row[hmIdx.weighted_gap] ?? 0),
    };
  }

  // Risk rollup from fact_risks
  for (const row of tables.fact_risks.rows) {
    const appId = String(row[rkIdx.app_id] ?? '');
    if (!appId) continue;
    const entry = appMap.get(appId);
    if (!entry) continue;
    const status = String(row[rkIdx.status] ?? 'open').toLowerCase();
    const impact = String(row[rkIdx.impact] ?? '').toLowerCase();
    if (status === 'closed' || status === 'mitigated') {
      entry.risk_rollup.closed += 1;
    } else if (status === 'mitigated') {
      entry.risk_rollup.mitigated += 1;
    } else {
      entry.risk_rollup.open += 1;
    }
    if (impact === 'high' || impact === 'critical') entry.risk_rollup.high_count += 1;
  }

  // LZ verdict from lzr-summary.json
  if (lzrSummaryPath && existsSync(lzrSummaryPath)) {
    try {
      const raw = JSON.parse(readFileSync(lzrSummaryPath, 'utf-8')) as {
        apps?: Array<{ app_id: string; verdict?: string }>;
      };
      for (const a of raw.apps ?? []) {
        const entry = appMap.get(a.app_id);
        if (entry && a.verdict) entry.lz_verdict = a.verdict;
      }
    } catch { /* lzr-summary absent or malformed; lz_verdict stays null */ }
  }

  return {
    built_at: builtAt,
    schema_version: '1.0',
    apps: [...appMap.values()],
  };
}

export interface WritePortfolioStarResult {
  bundleDir: string;
  manifest: ExportManifest;
  apps: string[];
  indexPath: string;
}

export function writePortfolioStarExport(ctx: PortfolioExportContext): WritePortfolioStarResult {
  const apps = discoverPortfolioApps(ctx.workspaceRoot);
  // Symmetric dual-wsp (#0230): portfolio outputs live under
  // <workspace>/wsp/exports/<ts>/, matching the per-app convention
  // <app>/wsp/exports/<ts>/.
  const exportsRoot = join(ctx.workspaceRoot, 'wsp', 'exports', ctx.timestamp);
  const starDir = join(exportsRoot, 'star');
  mkdirSync(starDir, { recursive: true });

  const tables = buildPortfolioStarTables(ctx, apps);
  const manifestFiles: ManifestFile[] = [];

  const writeCtx: ExportContext = {
    workspaceAppDir: ctx.workspaceRoot, // unused by writeCsvFile
    appId: 'portfolio',
    timestamp: ctx.timestamp,
    crlf: ctx.crlf,
    noBom: ctx.noBom,
  };

  const portfolioControlCount = tables.fact_controls.rows.length;
  const PORTFOLIO_BRIDGE_NOTE = 'empty -- COMP produced no control-signal mappings in this run (all controls UNKNOWN)';

  for (const [name, table] of Object.entries(tables)) {
    const path = join(starDir, `${name}.csv`);
    const stat = writeCsvFile(path, table.header, table.rows, writeCtx);
    const isBridgeEmpty = (name === 'link_control_signal' || name === 'link_control_evidence')
      && stat.rows === 0 && portfolioControlCount > 0;
    manifestFiles.push({
      path: `star/${name}.csv`,
      rows: stat.rows,
      sha256: stat.sha256,
      bytes: stat.bytes,
      ...(isBridgeEmpty ? { note: PORTFOLIO_BRIDGE_NOTE } : {}),
    });
  }

  // NDJSON mirror (#1254)
  const ndjsonDir = join(exportsRoot, 'ndjson');
  mkdirSync(ndjsonDir, { recursive: true });
  for (const [name, table] of Object.entries(tables)) {
    const ndjsonPath = join(ndjsonDir, `${name}.ndjson`);
    const stat = writeNdjsonFile(ndjsonPath, table.header, table.rows, name, writeCtx);
    manifestFiles.push({ path: `ndjson/${name}.ndjson`, rows: stat.rows, sha256: stat.sha256, bytes: stat.bytes });
  }

  const manifest: ExportManifest = {
    bundle_schema_version: SCHEMA_VERSION,
    source_wsp_run: 'portfolio',
    app_id: `portfolio (${apps.length} apps)`,
    generated_at: new Date().toISOString(),
    files: manifestFiles,
  };

  writeFileSync(
    join(exportsRoot, 'manifest.yaml'),
    dump(manifest, { lineWidth: 160 }),
    'utf-8',
  );

  const portfolioExportHeader =
    '// ================================================================\n' +
    '//\n' +
    '//                    S  W  A  O\n' +
    '//\n' +
    '//  Sovereign Workload Assessment and Onboarding\n' +
    '//  Portfolio BI export bundle\n' +
    '//\n' +
    '//  Free and Open-Source Software (FOSS)\n' +
    '//\n' +
    '//  Website       :  https://steady-echo-yp4z.here.now/\n' +
    '//  Technical Docs:  https://accenture.github.io/SWAO/en/\n' +
    '//  Source Code   :  https://github.com/Accenture/SWAO\n' +
    '//\n' +
    '// ================================================================\n' +
    '\n';
  writeFileSync(
    join(exportsRoot, 'README.md'),
    portfolioExportHeader + [
      `# SWAO portfolio BI export bundle`,
      '',
      `Generated: ${manifest.generated_at}`,
      `Apps included: ${apps.length}`,
      apps.map((a) => `  - ${a.appId}`).join('\n'),
      '',
      '## Tier 1 facts (this bundle)',
      '',
      '- denormalised per-app: `fact_signals`, `fact_controls`, `fact_findings`,',
      '  `fact_risks`, `fact_assessments`, `fact_runs`, `fact_pass_runs`',
      '- aggregates: `fact_app_heatmap` (one row per (app, regime) with',
      '  outcome counts and gap_score), `fact_app_summary` (one row per app',
      '  with 7R, scores, totals)',
      '',
      '## Tier 2 facts (post-PoC)',
      '',
      '`fact_wave_sequence`, `fact_app_dependencies`, richer',
      '`fact_portfolio_summary` land when #0068 closes. The Wave Sequencing',
      'PowerBI page renders an empty-state notice until then.',
      '',
      '## How to load',
      '',
      '- **PowerBI Desktop:** open `templates/swao-portfolio.pbit`,',
      '  point `SWAOPortfolioExportPath` at this `star/` directory.',
      '- **Tableau:** point a CSV connection at `star/`; relationships',
      '  auto-detect on shared FK column names.',
      '',
      'See design 019 §13.',
      '',
    ].join('\n'),
    'utf-8',
  );

  // Mirror all portfolio star CSVs to a fixed wsp/exports/latest/star/ path so
  // the PowerBI SWAOWorkspaceRoot parameter can be set once and stays current.
  const latestStarDir = join(ctx.workspaceRoot, 'wsp', 'exports', 'latest', 'star');
  mkdirSync(latestStarDir, { recursive: true });
  for (const f of manifestFiles) {
    copyFileSync(join(exportsRoot, f.path), join(latestStarDir, basename(f.path)));
  }

  // Build and write the portfolio-index.json (Design 080 §6.1, #1190).
  // Reads lzr-summary.json from the workspace's latest run if present.
  const portfolioWspDir = join(ctx.workspaceRoot, 'wsp');
  const latestTxt = join(portfolioWspDir, 'latest.txt');
  let lzrSummaryPath: string | undefined;
  if (existsSync(latestTxt)) {
    try {
      const latestRel = readFileSync(latestTxt, 'utf-8').trim();
      const candidate = join(portfolioWspDir, latestRel, 'lzr-summary.json');
      if (existsSync(candidate)) lzrSummaryPath = candidate;
    } catch { /* skip */ }
  }
  const index = buildPortfolioIndex(tables, manifest.generated_at, lzrSummaryPath);
  const indexPath = join(portfolioWspDir, 'portfolio-index.json');
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  return {
    bundleDir: exportsRoot,
    manifest,
    apps: apps.map((a) => a.appId),
    indexPath,
  };
}

// XLSX rollup for portfolio (#1254) -- one sheet per star table, same ExcelJS
// static-import pattern as writeXlsxExport to avoid ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING.
export async function writePortfolioXlsxExport(ctx: PortfolioExportContext): Promise<void> {
  const ExcelJS = excelJsModule;
  const Workbook = ExcelJS.default?.Workbook ?? (ExcelJS as unknown as { Workbook: typeof import('exceljs').Workbook }).Workbook;

  const apps = discoverPortfolioApps(ctx.workspaceRoot);
  const tables = buildPortfolioStarTables(ctx, apps);
  const exportsRoot = join(ctx.workspaceRoot, 'wsp', 'exports', ctx.timestamp);
  const xlsxDir = join(exportsRoot, 'xlsx');
  mkdirSync(xlsxDir, { recursive: true });

  const wb = new Workbook();
  wb.creator = 'SWAO';
  wb.created = new Date();

  for (const [name, table] of Object.entries(tables)) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    applyXlsxHeader(ws, table.header);
    for (const row of table.rows) ws.addRow(row);
    ws.autoFilter = { from: 'A1', to: { row: 1, column: table.header.length } };
  }

  await wb.xlsx.writeFile(join(xlsxDir, 'swao-portfolio-export.xlsx'));
}

// --------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------

export interface WriteStarResult {
  bundleDir: string;
  manifest: ExportManifest;
}

/**
 * Write the star-schema CSV bundle for one app under
 * `<workspaceAppDir>/wsp/exports/<timestamp>/star/`. Returns the bundle
 * directory and the manifest. ADR-0026; design 019 §2.
 */
export function writeStarExport(ctx: ExportContext): WriteStarResult {
  const exportsRoot = join(ctx.workspaceAppDir, 'wsp', 'exports', ctx.timestamp);
  const starDir = join(exportsRoot, 'star');
  mkdirSync(starDir, { recursive: true });

  const tables = buildStarTables(ctx);
  const manifestFiles: ManifestFile[] = [];

  // Bridge tables (#1257): detect empty-but-controls-exist so the manifest can carry a note.
  const controlCount = tables.fact_controls.rows.length;
  const BRIDGE_NOTE = 'empty -- COMP produced no control-signal mappings in this run (all controls UNKNOWN)';

  for (const [name, table] of Object.entries(tables)) {
    const path = join(starDir, `${name}.csv`);
    const stat = writeCsvFile(path, table.header, table.rows, ctx);
    const isBridgeEmpty = (name === 'link_control_signal' || name === 'link_control_evidence')
      && stat.rows === 0 && controlCount > 0;
    manifestFiles.push({
      path: `star/${name}.csv`,
      rows: stat.rows,
      sha256: stat.sha256,
      bytes: stat.bytes,
      ...(isBridgeEmpty ? { note: BRIDGE_NOTE } : {}),
    });
  }

  const { runId } = resolveSourceWspRun(ctx.workspaceAppDir);
  const manifest: ExportManifest = {
    bundle_schema_version: SCHEMA_VERSION,
    source_wsp_run: runId,
    app_id: ctx.appId,
    generated_at: new Date().toISOString(),
    files: manifestFiles,
  };

  writeFileSync(
    join(exportsRoot, 'manifest.yaml'),
    dump(manifest, { lineWidth: 160 }),
    'utf-8',
  );

  // Write a brief README explaining the bundle.
  const biExportHeader =
    '// ================================================================\n' +
    '//\n' +
    '//                    S  W  A  O\n' +
    '//\n' +
    '//  Sovereign Workload Assessment and Onboarding\n' +
    `//  BI export bundle -- ${ctx.appId}\n` +
    '//\n' +
    '//  Free and Open-Source Software (FOSS)\n' +
    '//\n' +
    '//  Website       :  https://steady-echo-yp4z.here.now/\n' +
    '//  Technical Docs:  https://accenture.github.io/SWAO/en/\n' +
    '//  Source Code   :  https://github.com/Accenture/SWAO\n' +
    '//\n' +
    '// ================================================================\n' +
    '\n';
  writeFileSync(
    join(exportsRoot, 'README.md'),
    biExportHeader + [
      `# SWAO BI export bundle -- ${ctx.appId}`,
      '',
      `Generated: ${manifest.generated_at}`,
      `Source WSP run: ${runId}`,
      `Bundle schema: ${SCHEMA_VERSION}`,
      '',
      '## Star-schema CSV files (`star/`)',
      '',
      manifestFiles.map((f) => `- ${f.path}  ${f.rows} row(s)`).join('\n'),
      '',
      '## How to load',
      '',
      '- **PowerBI Desktop:** open `templates/swao-report.pbit`, set ',
      '  `SWAOExportPath` parameter to the `latest/star/` sibling directory ',
      '  (same parent, always current -- no path update needed after each export).',
      '- **Tableau:** point a CSV connection at this `star/` directory; ',
      '  relationships auto-detect on shared FK column names.',
      '- **Excel:** open `xlsx/swao-export.xlsx` (separate file).',
      '- **Custom ETL:** consume `ndjson/*.ndjson` for typed JSON input.',
      '',
      '## Schema reference',
      '',
      'See design 019 (`swao-premium/docs/design/019-bi-export-and-templates.md`).',
      '',
    ].join('\n'),
    'utf-8',
  );

  // Mirror all star CSVs to a fixed wsp/exports/latest/star/ path so the
  // PowerBI SWAOExportPath parameter can be set once and stays current after
  // every export -- no manual path update required.
  const latestStarDir = join(ctx.workspaceAppDir, 'wsp', 'exports', 'latest', 'star');
  mkdirSync(latestStarDir, { recursive: true });
  for (const f of manifestFiles) {
    copyFileSync(join(exportsRoot, f.path), join(latestStarDir, basename(f.path)));
  }

  return { bundleDir: exportsRoot, manifest };
}
