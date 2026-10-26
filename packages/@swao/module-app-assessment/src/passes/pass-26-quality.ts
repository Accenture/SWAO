// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3405: Pass 26 CODE HEALTH (key `quality`, prefix QUAL), Design 117.
//
// Deterministic, local, no LLM and no external tool: a file-level quality
// worklist (CAST Highlight "improvement candidates" parity) and four app
// KPIs (complexity, maintainability, duplication, configuration hygiene).
//
// Scope: the central source scope (#3428). Production code only: files the
// scope tags as test code (#3403 decides whether they are listed at all) or
// as generated are counted, never measured. Hard-coded IPs and URLs come
// from the shared endpoint scanner in @swao/core (also used by #3422/#3424).
//
// Output is byte-identical for the same input: files are processed in
// code-unit path order, no clock or locale is read, scores are rounded.
//
// #3487: `.swao.yml` `assessment.code_health` (ctx.codeHealth) sets the
// worklist length (`top_n`), an endpoint allowlist for the hard-coded endpoint
// count, and the opt-in tools (lizard, jscpd). Tool results live under
// `assessment.code_health.tools` with their own signal (QUAL-08); they never
// change the built-in metrics, KPIs, worklist or QUAL-01 to QUAL-07. Without
// the block the output is unchanged and no external process is started.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PassContext, PassResult, Signal, CodeHealthToolName, DetectedCodeHealthTool, ToolRunner } from '@swao/core';
import {
  DEFAULT_CODE_HEALTH_SETTING,
  detectCodeHealthTools,
  fileBackedToolRunner,
  listSourceFiles,
  isEndpointScanCandidate,
  scanEndpoints,
  endpointEvidence,
  type SourceFile,
  type EndpointHit,
} from '@swao/core';
import {
  CODE_LANGUAGES,
  CODE_HEALTH_THRESHOLDS,
  CODE_HEALTH_WEIGHTS,
  DUPLICATION_WINDOW,
  appKpis,
  detectDuplication,
  fileComponents,
  fileScore,
  measureFile,
  ownerOf,
  parseCodeOwners,
  type CodeHealthKpis,
  type CodeOwnersRule,
  type FileComponents,
  type FileMetrics,
} from './code-health-metrics.js';
import { LIZARD_CCN_THRESHOLD, installHint, runCodeHealthTools, type CodeHealthToolsBlock, type JscpdToolResult, type LizardToolResult } from './code-health-tools.js';

export const QUALITY_PASS_ID = 26;
export const QUALITY_PASS_NAME = 'code_health';
export const QUALITY_SIGNAL_PREFIX = 'QUAL';
/** Default worklist length written to the WSP (`assessment.code_health.top_n` overrides it, #3487). */
export const QUALITY_TOP_N = DEFAULT_CODE_HEALTH_SETTING.topN;
/** Files above this size are counted as bulky but not read (content metrics skipped). */
export const QUALITY_MAX_FILE_BYTES = 1024 * 1024;
/** Hard-coded endpoint entries kept in the WSP (all are counted). */
export const QUALITY_MAX_ENDPOINT_ENTRIES = 200;
/** Evidence entries per signal. */
const MAX_EVIDENCE = 10;

/** CODEOWNERS locations GitHub and GitLab read, in their precedence order. */
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'];

export interface WorklistEntry {
  rank: number;
  file: string;
  language: string;
  owner: string | null;
  score: number;
  nloc: number;
  decision_points: number;
  max_nesting: number;
  duplicated_lines: number;
  hardcoded_ips: number;
  hardcoded_urls: number;
  markers: number;
  components: FileComponents;
  /** `file:line` of the most telling line (deepest nesting, first endpoint, first clone or first marker). */
  evidence: string;
}

export interface EndpointEntry {
  evidence: string;
  kind: EndpointHit['kind'];
  host: string;
  classification: EndpointHit['classification'];
}

/** #3487: injectable process plumbing for the opt-in tools (tests pass fakes). */
export interface QualityPassDeps {
  runner?: ToolRunner;
  detect?: (names: readonly CodeHealthToolName[]) => Promise<DetectedCodeHealthTool[]>;
}

interface FileRecord {
  rel: string;
  abs: string;
  language: string;
  metrics: FileMetrics | null;
  ips: EndpointHit[];
  urls: EndpointHit[];
  oversize: boolean;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const IPV4_HOST_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isIpHit(h: EndpointHit): boolean {
  return h.kind === 'ipv4' || IPV4_HOST_RE.test(h.host);
}

function readText(f: SourceFile): string | null {
  try { return readFileSync(f.abs, 'utf-8'); } catch { return null; }
}

function loadCodeOwners(sourcePath: string): { rules: CodeOwnersRule[]; file: string | null } {
  // .github/ and .gitlab/ are dot-directories the source scope never lists,
  // so the known CODEOWNERS locations are read directly (no walk).
  for (const rel of CODEOWNERS_PATHS) {
    const abs = join(sourcePath, rel);
    if (!existsSync(abs)) continue;
    try { return { rules: parseCodeOwners(readFileSync(abs, 'utf-8')), file: rel }; } catch { /* unreadable */ }
  }
  return { rules: [], file: null };
}

function skipResult(ctx: PassContext, reason: string): PassResult {
  return {
    pass: { id: QUALITY_PASS_ID, name: QUALITY_PASS_NAME, signal_prefix: QUALITY_SIGNAL_PREFIX, status: 'not_applicable', iter: ctx.iter, assessed_at: ctx.assessedAt },
    signals: [{
      id: 'QUAL-00',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `Code health not measured: ${reason}`,
      evidence: [],
      confidence: 'high',
    }],
    assessment: { code_health: { status: 'not_applicable', reason } },
  };
}

function bestEvidence(r: FileRecord, firstDup: number | undefined): string {
  const m = r.metrics;
  if (m && m.maxNesting > CODE_HEALTH_THRESHOLDS.nestingStart && m.maxNestingLine > 0) return `${r.rel}:${m.maxNestingLine}`;
  const ep = [...r.ips, ...r.urls].sort((a, b) => a.line - b.line)[0];
  if (ep) return endpointEvidence(r.rel, ep);
  if (firstDup !== undefined) return `${r.rel}:${firstDup}`;
  if (m && m.firstMarkerLine > 0) return `${r.rel}:${m.firstMarkerLine}`;
  if (m && m.maxNestingLine > 0) return `${r.rel}:${m.maxNestingLine}`;
  return `${r.rel}:1`;
}

export async function runQualityPass(ctx: PassContext, deps: QualityPassDeps = {}): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  const setting = ctx.codeHealth ?? DEFAULT_CODE_HEALTH_SETTING;
  const topN = setting.topN;
  const allowHosts = setting.endpointAllowlist;
  let allowlistedHits = 0;
  if (!sourcePath || !existsSync(sourcePath)) return skipResult(ctx, 'no source tree for this app.');

  // #3428: one listing for code and config; dot-files are included for `.env`.
  const all = listSourceFiles(sourcePath, { purpose: 'code', includeHidden: true })
    .slice()
    .sort((a, b) => cmp(a.rel, b.rel));

  let testFiles = 0;
  let generatedFiles = 0;
  const records: FileRecord[] = [];
  const languages: Record<string, { files: number; nloc: number }> = {};
  for (const f of all) {
    // Dot-files (`.env`, `.eslintrc.js`) feed the endpoint scan only.
    const lang = f.isHidden ? undefined : CODE_LANGUAGES[f.ext];
    const endpointCandidate = isEndpointScanCandidate(f);
    if (!lang && !endpointCandidate) continue;
    if (f.isTest) { if (lang) testFiles++; continue; }
    if (f.isGenerated) { if (lang) generatedFiles++; continue; }
    const oversize = f.sizeBytes > QUALITY_MAX_FILE_BYTES;
    const text = oversize ? null : readText(f);
    const metrics = lang && text !== null ? measureFile(text, lang) : null;
    const allHits = text !== null && endpointCandidate ? scanEndpoints(text, allowHosts.length > 0 ? { allowHosts } : {}) : [];
    if (allowHosts.length > 0) allowlistedHits += allHits.filter((h) => h.classification === 'allowlisted').length;
    const hits = allHits.filter((h) => h.reportable);
    const rec: FileRecord = {
      rel: f.rel,
      abs: f.abs,
      language: lang ? lang.language : 'Configuration',
      metrics,
      // A URL whose host is an IPv4 literal counts as a hard-coded IP address.
      ips: hits.filter(isIpHit),
      urls: hits.filter((h) => !isIpHit(h)),
      oversize: oversize && lang !== undefined,
    };
    if (!metrics && rec.ips.length === 0 && rec.urls.length === 0 && !rec.oversize) continue;
    records.push(rec);
    if (lang) {
      const l = languages[lang.language] ?? { files: 0, nloc: 0 };
      l.files += 1;
      l.nloc += metrics?.nloc ?? 0;
      languages[lang.language] = l;
    }
  }

  const codeRecords = records.filter((r) => r.metrics !== null);
  if (codeRecords.length === 0 && records.every((r) => r.ips.length === 0 && r.urls.length === 0)) {
    const why = testFiles > 0
      ? `only test code found (${testFiles} test file(s)); production code is required.`
      : 'no source code in a supported language found in the source scope.';
    return skipResult(ctx, why);
  }

  const dup = detectDuplication(codeRecords.map((r) => ({ rel: r.rel, significant: (r.metrics as FileMetrics).significant })));
  const owners = loadCodeOwners(sourcePath);

  const totals = { nloc: 0, decisionPoints: 0, duplicatedLines: 0, ips: 0, urls: 0, markers: 0, hotspotNloc: 0 };
  const scored = records.map((r) => {
    const m = r.metrics;
    const duplicatedLines = dup.duplicatedLines.get(r.rel) ?? 0;
    // An oversize code file is bulky by definition: full size component.
    const nloc = m?.nloc ?? (r.oversize ? CODE_HEALTH_THRESHOLDS.sizeFullNloc + 1 : 0);
    const components = fileComponents({
      nloc,
      decisionPoints: m?.decisionPoints ?? 0,
      maxNesting: m?.maxNesting ?? 0,
      duplicatedLines,
      ips: r.ips.length,
      urls: r.urls.length,
      markers: m?.markers ?? 0,
    });
    const score = fileScore(components);
    if (m) {
      totals.nloc += m.nloc;
      totals.decisionPoints += m.decisionPoints;
      totals.markers += m.markers;
      totals.duplicatedLines += duplicatedLines;
      if (score >= CODE_HEALTH_THRESHOLDS.hotspotScore || m.nloc > CODE_HEALTH_THRESHOLDS.bulkyNloc) totals.hotspotNloc += m.nloc;
    }
    totals.ips += r.ips.length;
    totals.urls += r.urls.length;
    return { r, nloc, duplicatedLines, components, score, evidence: bestEvidence(r, dup.firstDuplicateLine.get(r.rel)) };
  });

  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || cmp(a.r.rel, b.r.rel));
  const worklist: WorklistEntry[] = ranked.slice(0, topN).map((s, i) => ({
    rank: i + 1,
    file: s.r.rel,
    language: s.r.language,
    owner: ownerOf(s.r.rel, owners.rules),
    score: s.score,
    nloc: s.r.metrics?.nloc ?? 0,
    decision_points: s.r.metrics?.decisionPoints ?? 0,
    max_nesting: s.r.metrics?.maxNesting ?? 0,
    duplicated_lines: s.duplicatedLines,
    hardcoded_ips: s.r.ips.length,
    hardcoded_urls: s.r.urls.length,
    markers: s.r.metrics?.markers ?? 0,
    components: s.components,
    evidence: s.evidence,
  }));

  const kpis: CodeHealthKpis | null = appKpis(totals);

  const endpointEntries: EndpointEntry[] = [];
  for (const r of records) {
    for (const h of [...r.ips, ...r.urls].sort((a, b) => a.line - b.line || a.column - b.column)) {
      if (endpointEntries.length >= QUALITY_MAX_ENDPOINT_ENTRIES) break;
      endpointEntries.push({ evidence: endpointEvidence(r.rel, h), kind: h.kind, host: h.host, classification: h.classification });
    }
  }

  // ---- signals (aggregate, fixed IDs, severity at most medium) ----
  const signals: Signal[] = [];
  const langList = Object.keys(languages).sort(cmp);
  const kpiText = kpis
    ? `complexity ${kpis.complexity}, maintainability ${kpis.maintainability}, duplication ${kpis.duplication}, configuration hygiene ${kpis.configuration_hygiene} (overall ${kpis.overall}, 0 to 100, higher is healthier)`
    : 'not computable (no production code lines)';
  signals.push({
    id: 'QUAL-01',
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation: `Code health KPIs: ${kpiText}. Measured ${codeRecords.length} production code file(s), ${totals.nloc} NLOC, languages: ${langList.join(', ') || 'none'}. Test files counted but not measured: ${testFiles}; generated files skipped: ${generatedFiles}. Deterministic built-in metrics (Design 117).`,
    evidence: worklist.slice(0, 5).map((w) => w.evidence),
    confidence: 'high',
  });

  const top = (pred: (s: (typeof scored)[number]) => boolean, ev: (s: (typeof scored)[number]) => string): string[] =>
    scored.filter(pred).sort((a, b) => b.score - a.score || cmp(a.r.rel, b.r.rel)).slice(0, MAX_EVIDENCE).map(ev);

  const complexFiles = scored.filter((s) => s.components.complexity >= CODE_HEALTH_THRESHOLDS.complexityHotspot);
  if (complexFiles.length > 0) {
    signals.push({
      id: 'QUAL-02',
      source: 'static_analysis',
      category: 'application',
      severity: complexFiles.length >= 5 ? 'medium' : 'low',
      derivation: `${complexFiles.length} complexity hotspot file(s): complexity component >= ${CODE_HEALTH_THRESHOLDS.complexityHotspot} (more than ${Math.round(CODE_HEALTH_THRESHOLDS.complexityFullDecisions * CODE_HEALTH_THRESHOLDS.complexityHotspot / 100)} decision points or nesting depth of ${CODE_HEALTH_THRESHOLDS.nestingStart + 4} or more). Split the logic before re-platforming; complex files drive refactoring effort.`,
      evidence: top((s) => s.components.complexity >= CODE_HEALTH_THRESHOLDS.complexityHotspot, (s) => s.evidence),
      confidence: 'medium',
    });
  }

  const bulky = scored.filter((s) => s.nloc > CODE_HEALTH_THRESHOLDS.bulkyNloc && (s.r.metrics !== null || s.r.oversize));
  if (bulky.length > 0) {
    signals.push({
      id: 'QUAL-03',
      source: 'static_analysis',
      category: 'application',
      severity: 'low',
      derivation: `${bulky.length} bulky file(s) above ${CODE_HEALTH_THRESHOLDS.bulkyNloc} NLOC (or above ${QUALITY_MAX_FILE_BYTES / 1024 / 1024} MiB, not read). Bulky files concentrate change risk and slow reviews.`,
      evidence: top((s) => s.nloc > CODE_HEALTH_THRESHOLDS.bulkyNloc && (s.r.metrics !== null || s.r.oversize), (s) => `${s.r.rel}:1`),
      confidence: 'high',
    });
  }

  const dupPct = totals.nloc > 0 ? Math.round((totals.duplicatedLines * 1000) / totals.nloc) / 10 : 0;
  if (dupPct >= 5) {
    signals.push({
      id: 'QUAL-04',
      source: 'static_analysis',
      category: 'application',
      severity: dupPct >= 15 ? 'medium' : 'low',
      derivation: `${dupPct}% of production code lines sit in ${dup.cloneGroups} duplicated block(s) of ${DUPLICATION_WINDOW} or more normalised lines (clone-detection proxy). Duplicated logic multiplies migration and fix effort.`,
      evidence: top((s) => s.duplicatedLines > 0, (s) => `${s.r.rel}:${dup.firstDuplicateLine.get(s.r.rel) ?? 1}`),
      confidence: 'medium',
    });
  }

  const ipHits = records.flatMap((r) => r.ips.map((h) => ({ r, h })));
  if (ipHits.length > 0) {
    const publicIps = ipHits.filter((x) => x.h.classification === 'public').length;
    signals.push({
      id: 'QUAL-05',
      source: 'static_analysis',
      category: 'application',
      severity: publicIps > 0 ? 'medium' : 'low',
      derivation: `${ipHits.length} hard-coded IP address(es) in ${new Set(ipHits.map((x) => x.r.rel)).size} production file(s) (${publicIps} public, ${ipHits.length - publicIps} private). Hard-coded addresses break when the workload moves to another network; externalise them into configuration. Loopback, documentation ranges and version numbers are excluded.`,
      evidence: ipHits.slice(0, MAX_EVIDENCE).map((x) => endpointEvidence(x.r.rel, x.h)),
      confidence: 'high',
    });
  }

  const urlHits = records.flatMap((r) => r.urls.map((h) => ({ r, h })));
  if (urlHits.length > 0) {
    signals.push({
      id: 'QUAL-06',
      source: 'static_analysis',
      category: 'application',
      severity: 'low',
      derivation: `${urlHits.length} hard-coded URL(s) in ${new Set(urlHits.map((x) => x.r.rel)).size} production file(s) (${new Set(urlHits.map((x) => x.h.host)).size} distinct host(s)). Externalise endpoints so each environment can set its own. Localhost, example and namespace hosts and templated values are excluded.`,
      evidence: urlHits.slice(0, MAX_EVIDENCE).map((x) => endpointEvidence(x.r.rel, x.h)),
      confidence: 'high',
    });
  }

  if (totals.markers > 0) {
    signals.push({
      id: 'QUAL-07',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `${totals.markers} TODO / FIXME / HACK / XXX marker(s) in production code comments. Open markers point at known, unfinished work to resolve or ticket before migration.`,
      evidence: top((s) => (s.r.metrics?.markers ?? 0) > 0, (s) => `${s.r.rel}:${s.r.metrics?.firstMarkerLine ?? 1}`),
      confidence: 'high',
    });
  }

  // #3487: opt-in tool enrichment, recorded apart from the built-in block.
  let tools: CodeHealthToolsBlock | undefined;
  if (setting.tools.length > 0) {
    const runner = deps.runner ?? fileBackedToolRunner;
    tools = await runCodeHealthTools({
      sourcePath,
      files: codeRecords.map((r) => ({ rel: r.rel, abs: r.abs })),
      requested: setting.tools,
      topN,
      timeoutMs: setting.toolTimeoutSeconds * 1000,
      runner,
      detect: deps.detect ?? ((names) => detectCodeHealthTools(runner, names)),
    });
    signals.push(toolSignal(tools));
  }

  return {
    pass: {
      id: QUALITY_PASS_ID,
      name: QUALITY_PASS_NAME,
      signal_prefix: QUALITY_SIGNAL_PREFIX,
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      code_health: {
        status: 'complete',
        method: 'built-in deterministic metrics (Design 117)',
        kpis,
        totals: {
          files_measured: codeRecords.length,
          files_with_endpoints: records.filter((r) => r.ips.length + r.urls.length > 0).length,
          nloc: totals.nloc,
          decision_points: totals.decisionPoints,
          duplicated_lines: totals.duplicatedLines,
          duplication_pct: dupPct,
          clone_groups: dup.cloneGroups,
          hardcoded_ips: totals.ips,
          hardcoded_urls: totals.urls,
          markers: totals.markers,
          test_files_not_measured: testFiles,
          generated_files_skipped: generatedFiles,
        },
        languages: Object.fromEntries(langList.map((l) => [l, languages[l]])),
        owner_source: owners.file,
        weights: { ...CODE_HEALTH_WEIGHTS },
        top_n: topN,
        worklist,
        hardcoded_endpoints: endpointEntries,
        // #3487: present only when configured, so default runs are unchanged.
        ...(allowHosts.length > 0 ? { endpoint_allowlist: { hosts: [...allowHosts], allowlisted_hits: allowlistedHits } } : {}),
        ...(tools ? { tools } : {}),
      },
    },
  };
}

/**
 * #3487: QUAL-08, the opt-in tool enrichment summary. Informational: a tool
 * result never changes a severity, a KPI or the worklist. Names the tools that
 * are missing, unsupported, failed or timed out, so the operator knows what to
 * install or fix.
 */
export function toolSignal(tools: CodeHealthToolsBlock): Signal {
  const parts: string[] = [];
  const evidence: string[] = [];
  const missing: string[] = [];
  for (const name of tools.requested) {
    const t = tools[name];
    if (!t) continue;
    if (t.status === 'complete') {
      switch (name) {
        case 'lizard': {
          const l: Partial<LizardToolResult> = tools.lizard ?? {};
          const threshold = l.ccn_threshold ?? LIZARD_CCN_THRESHOLD;
          parts.push(`lizard ${l.version ?? ''}: ${l.functions_analysed ?? 0} function(s) in ${l.files_analysed ?? 0} file(s), ${l.functions_over_threshold ?? 0} above CCN ${threshold} (max ${l.max_ccn ?? 0}, average ${l.average_ccn ?? 0})`);
          for (const f of l.top_functions ?? []) if (f.ccn > threshold) evidence.push(f.evidence);
          break;
        }
        case 'jscpd': {
          const j: Partial<JscpdToolResult> = tools.jscpd ?? {};
          parts.push(`jscpd ${j.version ?? ''}: ${j.clone_pairs ?? 0} clone pair(s), ${j.duplicated_lines ?? 0} duplicated line(s) of ${j.lines_analysed ?? 0} (${j.duplication_pct ?? 0}%)`);
          // `file:start-end` to the `file:line` evidence form.
          for (const c of j.top_clones ?? []) evidence.push(c.first.replace(/-\d+$/, ''));
          break;
        }
        default: {
          const never: never = name;
          throw new Error(`unknown code health tool: ${String(never)}`);
        }
      }
    } else {
      parts.push(`${name}: ${(t.reason ?? t.status).replace(/\.$/, '')}`);
      if (t.status === 'absent') missing.push(`${name} (${installHint(name)})`);
    }
  }
  const missingText = missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '';
  return {
    id: 'QUAL-08',
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation: `Code health tool enrichment (opt-in, assessment.code_health.tools): ${parts.join('; ')}.${missingText} Tool results are recorded under assessment.code_health.tools and do not change the built-in scores (Design 117).`,
    evidence: evidence.slice(0, MAX_EVIDENCE),
    confidence: 'high',
  };
}
