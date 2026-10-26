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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { PassContext, PassResult, TestCodeSetting } from '@swao/core';
import type { Signal } from '@swao/core';
import { NO_LLM_REASON } from './llm-skip.js';

// LLM-driven block assessments (#0236).
//
// #3487: when the run has a Pass 26 result (`26-quality.yaml`,
// `assessment.code_health` with status complete), its KPIs, totals and top
// worklist files are added to the prompt as evidence for
// `architecture_assessment` and `testing_maturity`, and both blocks carry a
// deterministic `code_health_evidence` object (with or without an LLM).
// Without a Pass 26 result the prompt and the blocks are unchanged.
//
// Fills the Auditor PowerBI tab. Today derive-plan does not emit the
// eight operational block-level assessment objects, so fact_assessments
// is empty. This pass produces them in a single LLM call against the
// assessment signals + synth context, then derive-plan spreads each
// block as a top-level key on wsp-plan.yaml so star.ts finds them at
// plan.observability, plan.licence_compliance, etc.
//
// The ninth block, landing_zone_readiness, is owned by Pass 23 (LZR);
// this pass does not produce it.

const BlockEvaluationSchema = z.object({
  overall_outcome: z.enum(['SATISFIED', 'PARTIAL', 'GAP', 'UNKNOWN', 'N_A']),
  overall_rationale: z.string(),
  score: z.number().min(0).max(1),
  // #3152: optional; the stored threshold always comes from BLOCK_SPECS.
  threshold: z.number().min(0).max(1).optional(),
  status: z.enum(['low', 'medium', 'high', 'critical']),
  key_signals: z.array(z.string()).optional().default([]),
});

const BlocksResponseSchema = z.object({
  blocks: z.record(z.string(), BlockEvaluationSchema),
});

const BLOCK_NAMES = [
  'observability',
  'licence_compliance',
  'testing_maturity',
  'architecture_assessment',
  'database_assessment',
  'integration_assessment',
  'iam_assessment',
  'dr_assessment',
] as const;
type BlockName = typeof BLOCK_NAMES[number];

interface BlockSpec {
  name: BlockName;
  description: string;
  axes: string;
  threshold: number;
}

const BLOCK_SPECS: BlockSpec[] = [
  {
    name: 'observability',
    description: 'Logging, metrics, tracing, alerting, SLO maturity.',
    axes: 'structured logs present; metrics exported; distributed tracing; SLO defined; alerting rules; on-call runbooks.',
    threshold: 0.7,
  },
  {
    name: 'licence_compliance',
    description: 'Open-source licence health across the dependency tree.',
    axes: 'SBOM completeness; GPL/AGPL exposure; attribution coverage; commercial-incompatible dependencies; EOL/abandoned packages.',
    threshold: 0.8,
  },
  {
    name: 'testing_maturity',
    description: 'Test coverage and CI gating across the build pipeline.',
    axes: 'unit test presence; integration tests; E2E coverage; CI required for merge; performance/load testing; mutation testing.',
    threshold: 0.6,
  },
  {
    name: 'architecture_assessment',
    description: 'Architecture quality: coupling, cohesion, deployment topology.',
    axes: 'service boundaries clear; coupling low; dependency direction acyclic; deployment topology simple; scalability path documented.',
    threshold: 0.65,
  },
  {
    name: 'database_assessment',
    description: 'Persistence design, replication, backup, encryption, retention.',
    axes: 'schema versioned; replication configured; backups verified; encryption at rest; retention policy; right-to-erasure support.',
    threshold: 0.7,
  },
  {
    name: 'integration_assessment',
    description: 'External-system integration robustness.',
    axes: 'retry with backoff; idempotency keys; contract testing; circuit breakers; egress allow-list documented; webhook signatures verified.',
    threshold: 0.65,
  },
  {
    name: 'iam_assessment',
    description: 'Identity, authentication, authorisation, secrets, audit.',
    axes: 'AuthN strong (no plain passwords); MFA for admin; RBAC enforced; secrets in KMS/vault (not env files); audit log of access; session expiry.',
    threshold: 0.8,
  },
  {
    name: 'dr_assessment',
    description: 'Business continuity: RTO/RPO, backups, failover, runbooks.',
    axes: 'RTO/RPO defined; backup verified; multi-AZ or multi-region; DR runbook current; last DR test < 6 months; failover automation.',
    threshold: 0.6,
  },
];

interface SynthContext {
  seven_r_label?: string;
  coverage_score?: number;
  migration_rationale?: string;
}

function loadSynth(workspacePath: string, passesDirOverride?: string): SynthContext | null {
  const passesDir = passesDirOverride ?? resolvePassesDir(workspacePath);
  const synthFile = join(passesDir, '09-synth.yaml');
  if (!existsSync(synthFile)) return null;
  try {
    const parsed = load(readFileSync(synthFile, 'utf-8')) as { assessment?: SynthContext } | null;
    return parsed?.assessment ?? null;
  } catch { return null; }
}

function resolvePassesDir(workspacePath: string): string {
  const wspDir = join(workspacePath, 'wsp');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const candidate = join(wspDir, rel, 'passes');
      if (existsSync(candidate)) return candidate;
    } catch { /* fall through */ }
  }
  return join(wspDir, 'passes');
}

// ---------------------------------------------------------------------------
// #3487: Pass 26 code health as block evidence
// ---------------------------------------------------------------------------

export interface CodeHealthEvidence {
  kpis: { complexity: number; maintainability: number; duplication: number; configuration_hygiene: number; overall: number } | null;
  files_measured: number;
  nloc: number;
  duplication_pct: number;
  hardcoded_ips: number;
  hardcoded_urls: number;
  test_files_not_measured: number;
  /** Top worklist entries `file (score)`, at most 3. */
  hotspots: string[];
  /** lizard functions above the CCN threshold, when the opt-in tool ran. */
  functions_over_ccn_threshold?: number;
  /** jscpd duplication %, when the opt-in tool ran. */
  jscpd_duplication_pct?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The Pass 26 block of the run as block evidence; null without a complete Pass 26 result. */
export function loadCodeHealthEvidence(workspacePath: string, passesDirOverride?: string): CodeHealthEvidence | null {
  const passesDir = passesDirOverride ?? resolvePassesDir(workspacePath);
  const file = join(passesDir, '26-quality.yaml');
  if (!existsSync(file)) return null;
  try {
    const doc = load(readFileSync(file, 'utf-8')) as { assessment?: { code_health?: Record<string, unknown> } } | null;
    const ch = doc?.assessment?.code_health;
    if (!ch || ch['status'] !== 'complete') return null;
    const totals = (ch['totals'] ?? {}) as Record<string, unknown>;
    const k = ch['kpis'] as Record<string, unknown> | null | undefined;
    const worklist = Array.isArray(ch['worklist']) ? (ch['worklist'] as Array<Record<string, unknown>>) : [];
    const tools = (ch['tools'] ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const ev: CodeHealthEvidence = {
      kpis: k && typeof k === 'object'
        ? { complexity: num(k['complexity']), maintainability: num(k['maintainability']), duplication: num(k['duplication']), configuration_hygiene: num(k['configuration_hygiene']), overall: num(k['overall']) }
        : null,
      files_measured: num(totals['files_measured']),
      nloc: num(totals['nloc']),
      duplication_pct: num(totals['duplication_pct']),
      hardcoded_ips: num(totals['hardcoded_ips']),
      hardcoded_urls: num(totals['hardcoded_urls']),
      test_files_not_measured: num(totals['test_files_not_measured']),
      hotspots: worklist.slice(0, 3).map((w) => `${String(w['file'] ?? '')} (${num(w['score'])})`),
    };
    const lizard = tools['lizard'];
    const jscpd = tools['jscpd'];
    if (lizard?.['status'] === 'complete') ev.functions_over_ccn_threshold = num(lizard['functions_over_threshold']);
    if (jscpd?.['status'] === 'complete') ev.jscpd_duplication_pct = num(jscpd['duplication_pct']);
    return ev;
  } catch {
    return null;
  }
}

/** Prompt section for the code health evidence (only called when Pass 26 completed). */
export function codeHealthPromptLines(ev: CodeHealthEvidence, testCode: TestCodeSetting | undefined): string[] {
  const k = ev.kpis;
  const testLine = testCode === 'exclude'
    ? '  Test code: excluded from this run by assessment.test_code (mode exclude), so test files were not listed; do not read the count as missing tests.'
    : `  Test files found (counted, not measured): ${ev.test_files_not_measured}, next to ${ev.files_measured} production code file(s).`;
  const tools: string[] = [];
  if (ev.functions_over_ccn_threshold !== undefined) tools.push(`lizard: ${ev.functions_over_ccn_threshold} function(s) above CCN 15`);
  if (ev.jscpd_duplication_pct !== undefined) tools.push(`jscpd: ${ev.jscpd_duplication_pct}% duplicated lines`);
  return [
    'CODE_HEALTH_CONTEXT (Pass 26, deterministic metrics; evidence for architecture_assessment and testing_maturity; cite QUAL-01 when you use it):',
    k
      ? `  KPIs (0 to 100, higher is healthier): overall ${k.overall}, complexity ${k.complexity}, maintainability ${k.maintainability}, duplication ${k.duplication}, configuration hygiene ${k.configuration_hygiene}.`
      : '  KPIs: not computable (no production code lines).',
    `  Production code: ${ev.files_measured} file(s), ${ev.nloc} NLOC, ${ev.duplication_pct}% duplicated lines, ${ev.hardcoded_ips} hard-coded IP(s), ${ev.hardcoded_urls} hard-coded URL(s).`,
    testLine,
    `  Top worklist files: ${ev.hotspots.join(', ') || 'none'}.`,
    ...(tools.length > 0 ? [`  Tool enrichment: ${tools.join('; ')}.`] : []),
    '',
  ];
}

/** Deterministic evidence object written on the two blocks the code health metrics inform. */
function blockCodeHealthEvidence(name: BlockName, ev: CodeHealthEvidence, testCode: TestCodeSetting | undefined): Record<string, unknown> | undefined {
  switch (name) {
    case 'architecture_assessment':
      return {
        source: 'assessment.code_health (Pass 26)',
        kpis: ev.kpis,
        duplication_pct: ev.duplication_pct,
        hotspots: ev.hotspots,
        ...(ev.functions_over_ccn_threshold !== undefined ? { functions_over_ccn_threshold: ev.functions_over_ccn_threshold } : {}),
        ...(ev.jscpd_duplication_pct !== undefined ? { jscpd_duplication_pct: ev.jscpd_duplication_pct } : {}),
      };
    case 'testing_maturity':
      return {
        source: 'assessment.code_health (Pass 26)',
        production_files_measured: ev.files_measured,
        // In exclude mode the test files were never listed: the count says nothing.
        test_files_found: testCode === 'exclude' ? null : ev.test_files_not_measured,
        test_code_mode: testCode ?? 'include',
      };
    case 'observability':
    case 'licence_compliance':
    case 'database_assessment':
    case 'integration_assessment':
    case 'iam_assessment':
    case 'dr_assessment':
      return undefined;
    default: {
      const never: never = name;
      throw new Error(`unknown block: ${String(never)}`);
    }
  }
}

// #1282: accept ctx.passesDir override (current run, before latest.txt is written).
function loadAllSignals(workspacePath: string, passesDirOverride?: string): Signal[] {
  const passesDir = passesDirOverride ?? resolvePassesDir(workspacePath);
  if (!existsSync(passesDir)) return [];
  const signals: Signal[] = [];
  for (const file of readdirSync(passesDir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    if (file.startsWith('12-')) continue; // skip our own output on re-run
    try {
      const parsed = load(readFileSync(join(passesDir, file), 'utf-8')) as { signals?: Signal[] } | null;
      if (parsed?.signals) signals.push(...parsed.signals);
    } catch { /* skip */ }
  }
  return signals;
}

function summariseSignals(signals: Signal[]): string {
  if (signals.length === 0) return '(no signals emitted in this run)';
  return signals.map((s) => {
    const sev = s.severity ?? 'informational';
    const d = (s.derivation ?? '').replace(/\s+/g, ' ').slice(0, 240);
    return `  - ${s.id} [${sev}]: ${d}`;
  }).join('\n');
}

function buildPrompt(specs: BlockSpec[], signals: Signal[], synth: SynthContext | null, codeHealth: string[] = []): string {
  return [
    'BLOCK_ASSESSMENT_PASS',
    '',
    'You are an auditor scoring an application across eight operational',
    'assessment blocks. For each block, return an outcome, score (0-1),',
    'status, and rationale based ONLY on the signals in ASSESSMENT_SIGNALS.',
    'If signals neither support nor contradict a block, return',
    'overall_outcome: UNKNOWN with score: 0.0 and explain that signals are',
    'insufficient. Do not invent facts.',
    '',
    'Outcomes:',
    '  - SATISFIED: block is mature; score >= threshold.',
    '  - PARTIAL:   some elements present, gaps remain; 0.4 <= score < threshold.',
    '  - GAP:       block largely absent; score < 0.4.',
    '  - N_A:       block does not apply to this workload (rare; justify).',
    '  - UNKNOWN:   no signals address this block either way.',
    '',
    'Status maps to risk:',
    '  - low / medium / high / critical (from the operator\'s viewpoint).',
    '',
    'Cite signal IDs in key_signals (only IDs that appear in ASSESSMENT_SIGNALS;',
    'do not invent). Provide a 2-3 sentence rationale.',
    '',
    'Output JSON ONLY, no prose, matching this shape (one entry per block):',
    '  { "blocks": {',
    '      "<block_name>": {',
    '        "overall_outcome": "SATISFIED|PARTIAL|GAP|UNKNOWN|N_A",',
    '        "overall_rationale": "<2-3 sentences>",',
    '        "score": <0.0-1.0>,',
    '        "threshold": <use the threshold provided in BLOCK_SPECS>,',
    '        "status": "low|medium|high|critical",',
    '        "key_signals": ["<signal_id>", ...]',
    '      },',
    '      ... (all blocks listed in BLOCK_SPECS)',
    '    } }',
    '',
    'SYNTH_CONTEXT (overall 7R recommendation from Pass 09):',
    synth
      ? `  seven_r_label: ${synth.seven_r_label ?? 'unknown'}, coverage_score: ${synth.coverage_score ?? 'unknown'}.\n  Migration rationale: ${(synth.migration_rationale ?? '').slice(0, 280)}`
      : '  (synth pass output unavailable)',
    '',
    ...codeHealth,
    'BLOCK_SPECS:',
    specs.map((s) => `  - ${s.name} (threshold ${s.threshold}): ${s.description} Axes: ${s.axes}`).join('\n'),
    '',
    'ASSESSMENT_SIGNALS:',
    summariseSignals(signals),
    '',
  ].join('\n');
}

interface EvaluatedBlock {
  overall_outcome: string;
  overall_rationale: string;
  score: number;
  threshold: number;
  status: string;
  key_signals: string[];
  sovereign_migration_risk: string;
  assessor: string;
  assessed_at: string;
  /** #3487: Pass 26 evidence (architecture_assessment, testing_maturity) when the run has it. */
  code_health_evidence?: Record<string, unknown>;
}

function fallbackBlock(spec: BlockSpec, assessedAt: string, reason: string): EvaluatedBlock {
  return {
    overall_outcome: 'UNKNOWN',
    overall_rationale: reason,
    score: 0,
    threshold: spec.threshold,
    status: 'medium',
    key_signals: [],
    sovereign_migration_risk: 'medium',
    assessor: 'rule_engine',
    assessed_at: assessedAt,
  };
}

function safeJsonParse(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = fenced ? fenced[1]! : raw;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last < 0) return null;
  try { return JSON.parse(candidate.slice(first, last + 1)); }
  catch { return null; }
}

export async function runBlocksPass(ctx: PassContext): Promise<PassResult> {
  const { workspacePath, iter, assessedAt, llm, passesDir, testCode } = ctx;

  const signals = loadAllSignals(workspacePath, passesDir);
  const synth = loadSynth(workspacePath, passesDir);
  const codeHealth = loadCodeHealthEvidence(workspacePath, passesDir); // #3487
  const validSignalIds = new Set(signals.map((s) => s.id));

  let llmBlocks: Record<string, z.infer<typeof BlockEvaluationSchema>> = {};
  if (llm) {
    try {
      const prompt = buildPrompt(BLOCK_SPECS, signals, synth, codeHealth ? codeHealthPromptLines(codeHealth, testCode) : []);
      const raw = await llm.complete(prompt);
      const parsed = safeJsonParse(raw);
      if (parsed !== null) {
        const validation = BlocksResponseSchema.safeParse(parsed);
        if (validation.success) llmBlocks = validation.data.blocks;
      }
    } catch { /* fall through to per-block UNKNOWN fallback */ }
  }

  const reason = llm
    ? 'LLM returned no evaluation for this block; falling back to UNKNOWN.'
    : 'No LLM provider configured; block marked UNKNOWN. Re-run with a real LLM for evaluation.';

  const blocks: Record<BlockName, EvaluatedBlock> = {} as Record<BlockName, EvaluatedBlock>;
  for (const spec of BLOCK_SPECS) {
    const evaluation = llmBlocks[spec.name];
    if (!evaluation) {
      blocks[spec.name] = fallbackBlock(spec, assessedAt, reason);
      continue;
    }
    const cleanKeySignals = (evaluation.key_signals ?? []).filter((id) => validSignalIds.has(id));
    blocks[spec.name] = {
      overall_outcome: evaluation.overall_outcome,
      overall_rationale: evaluation.overall_rationale,
      score: evaluation.score,
      // #3152: the threshold is SWAO's block specification, not whatever the
      // LLM echoed back; the prompt shows it for scoring guidance only.
      threshold: spec.threshold,
      status: evaluation.status,
      key_signals: cleanKeySignals,
      sovereign_migration_risk: evaluation.status,
      assessor: 'llm',
      assessed_at: assessedAt,
    };
  }

  // #3487: deterministic Pass 26 evidence on the blocks it informs.
  if (codeHealth) {
    for (const spec of BLOCK_SPECS) {
      const ev = blockCodeHealthEvidence(spec.name, codeHealth, testCode);
      if (ev) blocks[spec.name] = { ...blocks[spec.name], code_health_evidence: ev };
    }
  }

  // #2393: record evaluation status so operators and tooling can distinguish
  // "evaluated, no blocking services found" from a silent pass failure.
  const allOutcomes = Object.values(blocks).map(b => b.overall_outcome);
  const anyGap = allOutcomes.some(o => o === 'GAP' || o === 'PARTIAL');

  return {
    pass: {
      id: 12,
      name: 'block_assessments',
      // #3152: own namespace. The pass used to declare Pass 11's COMP prefix
      // while emitting no signals; the result lives in assessment.blocks.
      signal_prefix: 'BLOCKS',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals: [],
    assessment: {
      blocks,
      blocks_evaluated: BLOCK_NAMES.length,
      // LLM-optional alignment (#0550): uniform marker so doctor + HTML can
      // detect that this pass degraded to UNKNOWN for want of an LLM.
      ...(llm ? {} : { skipped_reason: NO_LLM_REASON }),
      // #2393: explicit evaluation status so zero signals is not ambiguous.
      evaluated: true,
      evaluation_mode: llm ? 'llm' : 'rule_engine',
      any_gap_found: anyGap,
      evaluation_note: anyGap
        ? 'One or more blocks returned GAP or PARTIAL -- review assessment.blocks for details.'
        : 'All blocks evaluated. No blocking or partial-blocking services detected in this run.',
    },
  };
}
