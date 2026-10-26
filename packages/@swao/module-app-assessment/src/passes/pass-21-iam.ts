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

import { existsSync } from 'fs';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { listSourceFiles } from '@swao/core';
import {
  loadPassCatalog,
  parseCatalogueDetection,
  compileTokenMatcher,
  compileRegexMatcher,
  scanCatalogueRules,
  productionFirst,
  occurrenceSummary,
  hitRef,
  DEFAULT_MAX_HITS_PER_KEY,
  MAX_EVIDENCE_HITS,
  type CatalogueHit,
  type ClassCounts,
  type CatalogueToken,
  type MatchDefaults,
  type PassCatalogEntry,
  type ScanFile,
  type ScanRule,
} from './pass-catalog-loader.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.java', '.py', '.cs', '.go', '.kt', '.yaml', '.yml', '.json', '.env', '.example', '.properties']);
const ENV_EXTENSIONS = new Set(['.env', '.example', '.properties', '.cfg', '.ini']);

interface IamProviderPosture {
  data_residency: string[];
  sovereignty: string;
  schrems_ii_risk: string;
  eidas_trust_level: string;
  operator: string;
}

interface IamProviderEntry {
  id: string;
  name: string;
  posture: IamProviderPosture;
  cross_reference_frameworks: string[];
}

interface DetectedProvider {
  provider: IamProviderEntry;
  matchedTokens: string[];
  /** #3411: stored hits (production first, capped) and the full counts. */
  hits: CatalogueHit[];
  total: number;
  byClass: ClassCounts;
}

/** #3411: token and env scans merged per provider (each capped separately, then re-capped). */
function mergeCounts(a: ClassCounts | undefined, b: ClassCounts | undefined): ClassCounts {
  return {
    prod: (a?.prod ?? 0) + (b?.prod ?? 0),
    test: (a?.test ?? 0) + (b?.test ?? 0),
    unknown: (a?.unknown ?? 0) + (b?.unknown ?? 0),
  };
}

// #3428: source files through the central source scope (canonical skips,
// dot-entries hidden as before).
function sourceScanFiles(dir: string): ScanFile[] {
  if (!existsSync(dir)) return [];
  return listSourceFiles(dir, { purpose: 'code' }).filter((f) => SOURCE_EXTENSIONS.has(f.ext));
}

// Env / config files, plus the root .env.example / .env.template / .env.sample
// (dot-files are otherwise hidden), same set as before #3410.
const ROOT_ENV_FILES = new Set(['.env.example', '.env.template', '.env.sample']);
function envScanFiles(dir: string): ScanFile[] {
  if (!existsSync(dir)) return [];
  return listSourceFiles(dir, { purpose: 'config', includeHidden: true }).filter((f) =>
    (!f.isHidden && ENV_EXTENSIONS.has(f.ext)) || (f.depth === 0 && ROOT_ENV_FILES.has(f.name)),
  );
}

interface ProviderRules {
  /** imports + config_keys, run on source files. */
  tokenRules: ScanRule<string>[];
  /** env_vars, run on env files. */
  envRules: ScanRule<string>[];
  /** Per provider: catalogue tokens (for naming the matched token) and env patterns. */
  tokens: Map<string, string[]>;
  errors: string[];
}

/**
 * #3410: shared catalogue matcher. `imports` + `config_keys` are literal
 * tokens (catalogue default `segment`: `eric` matches `ericClient` and
 * `ELSTER_ERIC`, not `generic`); `env_vars` are regexes with identifier
 * boundaries (`KC_.*` no longer matches inside `ACK_TIMEOUT`).
 */
function buildProviderRules(providers: readonly PassCatalogEntry[], defaults: MatchDefaults): ProviderRules {
  const tokenRules: ScanRule<string>[] = [];
  const envRules: ScanRule<string>[] = [];
  const tokens = new Map<string, string[]>();
  const errors: string[] = [];
  for (const p of providers) {
    const id = String(p.id);
    const parsed = parseCatalogueDetection(p);
    if ('error' in parsed) { errors.push(parsed.error); continue; }
    const d = parsed.detection;
    const all: CatalogueToken[] = [...d.imports, ...d.config_keys];
    tokens.set(id, all.map((t) => (typeof t === 'string' ? t : t.token)));
    const tokenMatcher = compileTokenMatcher(all, {
      match: d.match ?? defaults.match ?? 'segment',
      caseSensitive: d.case_sensitive ?? defaults.case_sensitive,
    });
    if (tokenMatcher) tokenRules.push({ key: id, matcher: tokenMatcher, via: 'token' });
    // One rule per env pattern so the hit names the pattern; the matched
    // text (which may carry a value from an env file) is never recorded.
    const envVars = Array.isArray(d['env_vars']) ? (d['env_vars'] as unknown[]).map(String) : [];
    for (const src of envVars) {
      const c = compileRegexMatcher(src, { match: 'identifier' });
      if (!c.ok) { errors.push(`${id}: env_vars "${src}" rejected (${c.reason})`); continue; }
      envRules.push({ key: id, matcher: c.matcher, via: `${ENV_VIA}${src}`, recordMatch: false });
    }
  }
  return { tokenRules, envRules, tokens, errors };
}

const ENV_VIA = 'env_var:';

/** Name the catalogue token behind a matched text (the matcher folds case). */
function tokenFor(matchText: string, tokens: readonly string[]): string {
  const lower = matchText.toLowerCase();
  return tokens.find((t) => t.toLowerCase() === lower) ?? matchText;
}

export async function runIamPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];

  const catalogue = loadPassCatalog(workspacePath, 'pass-21-iam-providers.yaml');
  if (!catalogue || catalogue.entries.length === 0) {
    signals.push({
      id: 'IAM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'IAM provider catalogue not found or empty. Install the pass-catalogs bundle and re-run.',
      evidence: [],
      confidence: 'low',
    });
    return {
      pass: { id: 21, name: 'iam_assessment', signal_prefix: 'IAM', status: 'complete', iter, assessed_at: assessedAt },
      signals,
      assessment: { providers_detected: [], catalogue_available: false },
    };
  }

  const providers = catalogue.entries as unknown as IamProviderEntry[];
  const detected: DetectedProvider[] = [];

  // #3410: one scan of the source files and one of the env files, each for
  // every provider at once. #3411: every hit is kept (capped per provider)
  // with its production/test class.
  const ruleSet = buildProviderRules(catalogue.entries, catalogue.match_defaults ?? {});
  const tokenScan = scanCatalogueRules(sourceScanFiles(sourcePath), ruleSet.tokenRules);
  const envScan = scanCatalogueRules(envScanFiles(sourcePath), ruleSet.envRules);
  for (const provider of providers) {
    const id = String(provider.id);
    const all = [...(tokenScan.hits.get(id) ?? []), ...(envScan.hits.get(id) ?? [])];
    if (all.length === 0) continue;
    const hits = productionFirst(all).slice(0, DEFAULT_MAX_HITS_PER_KEY);
    const matchedTokens: string[] = [];
    for (const h of all) {
      const tok = h.via.startsWith(ENV_VIA)
        ? h.via.slice(ENV_VIA.length)
        : tokenFor(h.match, ruleSet.tokens.get(id) ?? []);
      if (!matchedTokens.includes(tok)) matchedTokens.push(tok);
    }
    detected.push({
      provider,
      matchedTokens,
      hits,
      total: (tokenScan.totals.get(id) ?? 0) + (envScan.totals.get(id) ?? 0),
      byClass: mergeCounts(tokenScan.totalsByClass.get(id), envScan.totalsByClass.get(id)),
    });
  }

  let sigNum = 1;
  const detectedIds: string[] = [];

  if (detected.length === 0) {
    signals.push({
      id: 'IAM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'No IAM provider integration detected in static analysis. If an IAM provider is in use, verify import and env-var naming matches catalogue entries.',
      evidence: [],
      confidence: 'low',
    });
  } else {
    for (const hit of detected) {
      const p = hit.provider;
      const posture = p.posture;
      const eidasLevel = posture.eidas_trust_level;
      const sovereignty = posture.sovereignty;
      const schremsRisk = posture.schrems_ii_risk;

      const isSovereign = sovereignty === 'de_sovereign' || sovereignty === 'eu_sovereign';
      const hasEidas = eidasLevel !== 'none' && eidasLevel !== '';
      // #3411: a provider referenced only from test code (mocks, fixtures)
      // keeps its severity with low confidence; down-weighting test-code
      // evidence is the #3403 marker's job in `assessment.test_code: tag` mode.
      const inProduction = hit.byClass.prod + hit.byClass.unknown > 0;
      const severity: Signal['severity'] = isSovereign && hasEidas ? 'positive' : isSovereign ? 'low' : 'medium';

      signals.push({
        id: `IAM-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'application',
        severity,
        derivation: `IAM provider detected: ${p.name}. Sovereignty: ${sovereignty}. eIDAS trust level: ${eidasLevel}. Schrems II risk: ${schremsRisk}. Operator: ${posture.operator}. Matched tokens: ${hit.matchedTokens.slice(0, 3).join(', ')}. ${occurrenceSummary(hit.total, hit.byClass, hit.hits.length)}${inProduction ? '' : ' Referenced from test code only.'}`,
        evidence: hit.hits.slice(0, MAX_EVIDENCE_HITS).map(hitRef),
        confidence: inProduction ? 'medium' : 'low',
      });
      sigNum++;
      detectedIds.push(String(p.id));
    }
  }

  return {
    pass: { id: 21, name: 'iam_assessment', signal_prefix: 'IAM', status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment: {
      providers_detected: detectedIds,
      catalogue_available: true,
      catalogue_entry_count: providers.length,
      // #3411: full (capped) hit list per detected provider, production first.
      ...(detected.length > 0
        ? { hits: Object.fromEntries(detected.map((d) => [String(d.provider.id), {
          total: d.total,
          production: d.byClass.prod,
          test: d.byClass.test,
          unclassified: d.byClass.unknown,
          truncated: d.hits.length < d.total,
          locations: d.hits.map((h) => ({ file: h.file, line: h.line, path_class: h.path_class, via: h.via.startsWith(ENV_VIA) ? 'env_var' : h.via })),
        }])) }
        : {}),
      ...(ruleSet.errors.length > 0 ? { catalogue_errors: ruleSet.errors } : {}),
    },
  };
}
