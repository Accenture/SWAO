// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * LLM Assessment publication blocks -- Design 092 s8, L5 (#1428).
 *
 * Seven block renderers for the LLM Assessment HTML publication:
 *   llm.header          -- app, run timestamp, LLM model summary
 *   llm.final-ranking   -- compact ranked list of LLM models
 *   llm.group-breakdown -- spec-compliant matrix: models as columns, dimensions as rows
 *   llm.pass-table      -- supplementary per-pass detail table
 *   llm.findings        -- operational findings from the run
 *   llm.methodology     -- scoring methodology note
 *   llm.narrative       -- LLM-generated executive summary
 *
 * The LlmPubData payload is attached to PublicationModel at runtime by
 * renderModeALlm (module-html-report) via the extra-field cast pattern,
 * mirroring hub.ts.
 */

import type { PublicationModel } from '../model.js';
import { esc } from './helpers.js';
import type { LlmPubData, LlmPassLegAggregate } from '../llm-pub-data.js';

// Runtime extension type (same cast pattern as HubExtension in hub.ts)
type LlmExtension = {
  llm_assessment?: LlmPubData;
};

function llm(model: PublicationModel): LlmPubData | undefined {
  return (model as unknown as LlmExtension).llm_assessment;
}

// ---------------------------------------------------------------------------
// Weight-to-group mapping -- mirrors WEIGHT_KEY_GROUPS in comparison-engine.ts.
// This is the authoritative display-side mapping so the weights header and the
// group section labels use identical weight key names.
// ---------------------------------------------------------------------------

const WEIGHT_KEY_TO_GROUPS: Record<string, string[]> = {
  quality:     ['quality-content', 'quality-structural'],
  reliability: ['reliability'],
  performance: ['performance'],
  cost:        ['cost'],
  security:    ['security'],
};

// Canonical display order for weight key sections in the matrix.
const WEIGHT_KEY_ORDER: readonly string[] = ['quality', 'performance', 'cost', 'reliability', 'security'];

// ---------------------------------------------------------------------------
// Property definitions for expandable per-pass rows within each dimension group.
// 'agg' controls how the aggregate summary value is computed from passGroups:
//   sum  -- total across all passes (e.g. total cost)
//   mean -- average across passes (e.g. average parse rate)
//   p50  -- median of the per-pass p50 values (e.g. latency)
// ---------------------------------------------------------------------------

type PropDef = {
  key: keyof LlmPassLegAggregate;
  label: string;
  agg: 'sum' | 'mean' | 'p50';
  fmt: (v: number) => string;
  /** Raw HTML cell content (not escaped). Overrides fmt when present. */
  fmtHtml?: (v: number) => string;
  /** Short explanation shown below the label in the expandable property row. */
  description?: string;
};

const GROUP_PROP_DEFS: Record<string, PropDef[]> = {
  'performance': [
    {
      key: 'latency_p50_ms',
      label: 'Latency P50',
      agg: 'p50',
      fmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 's' : v.toFixed(0) + 'ms',
      description: 'Median response latency across successful calls for this provider. Lower is better.',
    },
  ],
  'cost': [
    {
      key: 'cost_usd',
      label: 'Total cost (USD)',
      agg: 'sum',
      fmt: (v) => '$' + v.toFixed(4),
      description: 'Cumulative USD cost across all passes in this run. Based on token pricing reported by the provider.',
    },
  ],
  'quality-structural': [
    {
      key: 'parse_valid_rate',
      label: 'Parse valid rate',
      agg: 'mean',
      fmt: (v) => v.toFixed(0) + '%',
      description: 'Percentage of API calls where the response contained parseable JSON. 100% = all calls parsed successfully; 0% = no calls returned valid JSON; -- = no data collected for this pass.',
    },
    {
      key: 'schema_conform_rate',
      label: 'Schema conform rate',
      agg: 'mean',
      fmt: (v) => v.toFixed(0) + '%',
      description: 'Of the calls that returned parseable JSON, the percentage whose structure matched the expected schema. 100% = all parsed responses conformed; 0% = no responses matched the schema.',
    },
  ],
  'quality-content': [],
  'reliability': [
    {
      key: 'dnf',
      label: 'DNF count',
      agg: 'sum',
      fmt: (v) => String(v),
      fmtHtml: (v) => v === 0
        ? `<span class="pub-badge pub-badge--ok" title="No calls failed to complete -- best result">0</span>`
        : `<span class="pub-badge pub-badge--red" title="${v} call(s) timed out or encountered a provider error">${v}</span>`,
      description: 'Number of API calls that did not finish (timeout, network error, or provider refusal). 0 means no failures -- the best possible result.',
    },
  ],
  'security': [
    {
      key: 'refusal_count',
      label: 'Refusals',
      agg: 'sum',
      fmt: (v) => String(v),
      fmtHtml: (v) => v === 0
        ? `<span class="pub-badge pub-badge--ok" title="No refusals detected">0</span>`
        : `<span class="pub-badge pub-badge--warn" title="${v} refusal(s) detected">${v}</span>`,
      description: 'Calls where the model refused to answer. SWAO prompts contain only redacted workspace content; refusals indicate over-triggering safety filters on legitimate consulting material.',
    },
    {
      key: 'redaction_marker_altered_count',
      label: 'Redaction markers altered',
      agg: 'sum',
      fmt: (v) => String(v),
      fmtHtml: (v) => v === 0
        ? `<span class="pub-badge pub-badge--ok" title="No redaction markers altered">0</span>`
        : `<span class="pub-badge pub-badge--red" title="${v} call(s) altered a redaction marker">${v}</span>`,
      description: 'Calls where the model changed a [REDACTED...] placeholder instead of quoting it verbatim. Alteration suggests attempted reconstruction of redacted content -- a sovereignty red flag.',
    },
    {
      key: 'pii_reproduction_count',
      label: 'PII reproduction attempts',
      agg: 'sum',
      fmt: (v) => String(v),
      fmtHtml: (v) => v === 0
        ? `<span class="pub-badge pub-badge--ok" title="No PII reproduction detected">0</span>`
        : `<span class="pub-badge pub-badge--red" title="${v} call(s) attempted to infer or state a redacted value">${v}</span>`,
      description: 'Calls where the model attempted to infer or state the value hidden behind a redaction marker. A safe model treats redacted tokens as opaque and works around them.',
    },
    {
      key: 'prompt_injection_count',
      label: 'Prompt injection signals',
      agg: 'sum',
      fmt: (v) => String(v),
      fmtHtml: (v) => v === 0
        ? `<span class="pub-badge pub-badge--ok" title="No prompt injection signals detected">0</span>`
        : `<span class="pub-badge pub-badge--warn" title="${v} call(s) showed possible injection signals">${v}</span>`,
      description: 'Calls where the response contained signals suggesting injected instructions were followed (heuristic; silent injection is not detected). Zero is expected under normal workspace content.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Per-pass colour palette -- cycled by position so the same pass always gets
// the same tint in both the matrix detail rows and the Pass Deep-Dive section.
// ---------------------------------------------------------------------------
const PASS_COLORS: readonly string[] = [
  '#dbeafe', // blue
  '#dcfce7', // green
  '#fef9c3', // yellow
  '#fce7f3', // pink
  '#ede9fe', // violet
  '#ffedd5', // orange
  '#ccfbf1', // teal
  '#fae8ff', // fuchsia
];

// Short + long descriptions per SWAO assessment pass.
// `short` feeds the tooltip; `detail` feeds the Pass Deep-Dive prose.
// Keys match the actual pass_id values produced by the orchestrator.
// Older recording IDs (01-inventory style) are retained for replay compatibility.
const PASS_DESCRIPTIONS: Record<string, { short: string; detail: string }> = {
  // --- current runtime pass IDs (from wsp/passes/*.yaml pass.name) ---
  '03-data': {
    short: 'Data classification and sensitivity labelling.',
    detail: 'Detects personal, financial, regulated, and high-classification data handled by the workload. The LLM applies a sensitivity taxonomy to inferred data flows and storage patterns. Critical for data sovereignty constraints and cross-border transfer risk assessment.',
  },
  '04-ctx': {
    short: 'Context ingestion: understanding the workload scope.',
    detail: 'Ingests workspace context signals -- README files, configuration, IaC, and manifests -- and builds a structured workload model. The LLM synthesises disparate artefacts into a coherent picture of component relationships and deployment topology. Required foundation for all downstream analysis passes.',
  },
  '09-synth': {
    short: '7R migration strategy synthesis and final recommendation.',
    detail: 'Synthesises all upstream pass outputs into a single 7R migration recommendation: Retain, Retire, Rehost, Replatform, Refactor, Re-Architect, or Repurchase. The LLM weighs complexity signals, cost exposure, and sovereignty constraints to produce a justified, evidence-backed recommendation.',
  },
  '11-comp': {
    short: 'Compliance evaluation against applicable control frameworks.',
    detail: 'Evaluates the workload against the compliance controls defined in the active ruleset (GDPR, NIST, AI 10 Pillars, or custom). The LLM maps observed workload signals to control requirements and produces a structured gap assessment. Drives the compliance coverage score shown in the executive summary.',
  },
  '12-blocks': {
    short: 'Block-level runbook: actionable migration task assessment.',
    detail: 'Generates and assesses a structured set of migration action blocks (tasks, dependencies, effort estimates) for the recommended migration path. The LLM reasons over the upstream 7R decision and compliance gaps to produce a prioritised, executable runbook. Feeds the remediation planner.',
  },
  '10-dynamic': {
    short: 'Dynamic vision analysis: Playwright screenshot review via LLM.',
    detail: 'Captures and analyses Playwright screenshots of the running application against a parity baseline. The LLM compares screenshots pixel-semantically, identifying UI regressions, layout shifts, and functional deviations from the approved baseline. Each screenshot comparison is a separate LLM call recorded in the call log.',
  },
  // --- security pass IDs (sprint-115 #1463) ---
  'security-pii-redaction': {
    short: 'PII redaction: model does not reproduce sensitive placeholders.',
    detail: 'Submits prompts containing PII placeholder patterns and verifies the LLM neither reproduces, explains, nor amplifies them in its response. Measures the model\'s adherence to data minimisation principles when operating on privacy-sensitive workload context. Feeds the security dimension score.',
  },
  'security-prompt-injection': {
    short: 'Prompt injection: model follows SWAO schema despite adversarial input.',
    detail: 'Embeds adversarial instructions inside the assessment prompt and verifies the LLM follows the SWAO pass schema rather than the injected instruction. Measures resilience to indirect prompt injection attacks -- a critical risk when the LLM processes untrusted workload artefacts. Feeds the security dimension score.',
  },
  'security-schema-boundary': {
    short: 'Schema boundary: model does not leak extra fields outside the schema.',
    detail: 'Verifies the model\'s response strictly conforms to the expected JSON schema and does not return extra keys. Unexpected fields can signal data leakage or model hallucination of sensitive internal state. Feeds the security dimension score.',
  },
  // --- legacy IDs retained for replay compatibility ---
  '01-inventory': {
    short: 'Component inventory and cloud service mapping.',
    detail: 'Catalogues all services, libraries, and infrastructure components in the workload. The LLM extracts structured component lists from README files, IaC templates, and manifests. Required for downstream passes that need to reason over what is deployed.',
  },
  '02-statefulness': {
    short: 'Persistent state analysis across services.',
    detail: 'Identifies databases, message queues, file shares, and other stateful volumes in the workload. The LLM classifies each component as stateful or stateless based on service type and configuration signals. Drives the migration complexity estimate used in the 7R synthesis.',
  },
  '04-egress': {
    short: 'Network egress paths and third-party data flow analysis.',
    detail: 'Maps outbound connections to external APIs, SaaS services, and content delivery networks. The LLM identifies potential data exfiltration paths and cross-border transfer risks from configuration and code signals. Feeds the sovereignty boundary assessment.',
  },
  '05-sbom': {
    short: 'Software bill of materials: OSS licence and vulnerability exposure.',
    detail: 'Enumerates open-source dependencies and maps them to known vulnerabilities and licence obligations. The LLM reasons over package manifests and lock files to identify risky or non-compliant components. Enables compliance gate checking against approved OSS policies.',
  },
  '06-cryptography': {
    short: 'Cryptographic posture and key management review.',
    detail: 'Identifies encryption algorithms, TLS versions, key storage patterns, and certificate management practices across the workload. The LLM flags weak ciphers and missing encryption at rest or in transit. Supports regulatory controls on approved cryptographic standards.',
  },
  '07-12factor': {
    short: '12-factor application principles compliance check.',
    detail: 'Evaluates adherence to the 12-factor methodology (config externalisation, statelessness, port binding, and similar). The LLM assesses codebase structure and configuration patterns against each factor. High 12-factor compliance correlates with easier and lower-risk cloud-native migration.',
  },
  '08-7r-synthesis': {
    short: '7R migration strategy synthesis and final recommendation.',
    detail: 'Synthesises all upstream pass outputs into a single 7R migration recommendation: Retain, Retire, Rehost, Replatform, Refactor, Re-Architect, or Repurchase. The LLM weighs complexity signals, cost exposure, and sovereignty constraints to produce a justified, evidence-backed recommendation.',
  },
};

// Five-step rank color palette. Index 0 = rank 1 (best), index 4 = rank 5 (last).
// Colors chosen for legibility on both light and dark backgrounds as border/text accents.
const RANK_ACCENT_COLORS = [
  '#15803d', // rank 1: green-700
  '#1d4ed8', // rank 2: blue-700
  '#b45309', // rank 3: amber-700
  '#c2410c', // rank 4: orange-700
  '#b91c1c', // rank 5: red-700
];

function rankAccentColor(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return '#6b7280';
  const idx = Math.min(rank - 1, RANK_ACCENT_COLORS.length - 1);
  return RANK_ACCENT_COLORS[Math.max(0, idx)];
}

// Compute aggregate of a single metric across all passGroups for one leg.
function aggMetric(
  passGroups: LlmPubData['passGroups'],
  legId: string,
  key: keyof LlmPassLegAggregate,
  agg: PropDef['agg'],
): number | null {
  const vals: number[] = [];
  for (const pg of passGroups) {
    const m = pg.legs[legId];
    if (!m) continue;
    const v = m[key];
    if (typeof v === 'number') vals.push(v);
  }
  if (vals.length === 0) return null;
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length;
  // p50: median of already-aggregated p50 values
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Ordinal suffix helper.
function ordinal(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return '--';
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

// Truncate a model id string for display in narrow columns.
function truncModel(s: string, maxLen = 40): string {
  return s.length > maxLen ? s.slice(0, maxLen - 2) + '..' : s;
}

// ---------------------------------------------------------------------------
// Block: llm.header
// ---------------------------------------------------------------------------

export function renderLlmHeader(model: PublicationModel): string {
  const data = llm(model);
  const appId = model.meta.app_id;
  const created = data?.created ? data.created.replace('T', ' ').slice(0, 16) : '';
  const mode = data?.analysis_mode ?? '';
  const legCount = data?.legs?.length ?? 0;

  // Top-ranked model summary for the header card
  const headerLegs = data?.legs ?? [];
  const headerFinal = data?.final;
  const sortedByRank = [...headerLegs].sort(
    (a, b) => ((headerFinal?.rank[a.id] as number | null) ?? Infinity) - ((headerFinal?.rank[b.id] as number | null) ?? Infinity),
  );
  const topLeg = sortedByRank[0];
  const topRankBadge = topLeg
    ? `<span style="color:${esc(rankAccentColor(1))};font-weight:700;font-size:0.9rem;margin-left:0.75rem" title="${esc(topLeg.connector + ' / ' + topLeg.model)}">1st: ${esc(topLeg.model.split('/').pop() ?? topLeg.model)}</span>`
    : '';

  const metaBadges = [
    mode ? `<span class="pub-badge" style="background:var(--bg-alt,#f1f5f9);color:var(--text-secondary,#666);font-size:0.78rem">${esc(mode)}</span>` : '',
    legCount > 0 ? `<span class="pub-badge" style="background:var(--bg-alt,#f1f5f9);color:var(--text-secondary,#666);font-size:0.78rem">${legCount} model${legCount !== 1 ? 's' : ''}</span>` : '',
    created ? `<span class="pub-badge" style="background:var(--bg-alt,#f1f5f9);color:var(--text-secondary,#666);font-size:0.78rem">${esc(created)}</span>` : '',
  ].filter(Boolean).join(' ');

  return `<section id="llm-header" class="swao-block swao-block--llm-header">
  <div class="pub-card swao-card" style="border-left:4px solid var(--brand-accent,#7c3aed);padding:1rem 1.25rem;margin-bottom:1rem">
    <div class="pub-flex-row-gap pub-mb-2" style="align-items:center;flex-wrap:wrap;gap:0.5rem">
      <h1 style="margin:0;font-size:1.35rem;font-weight:700">LLM Assessment</h1>
      <span class="pub-badge" style="background:var(--brand-accent,#7c3aed);color:#fff;font-size:0.82rem;padding:0.2rem 0.6rem">Assessed ${legCount} Model${legCount !== 1 ? 's' : ''}</span>
      ${topRankBadge}
    </div>
    <p class="pub-text-secondary" style="margin:0 0 0.5rem">
      Application: <strong>${esc(appId)}</strong>
    </p>
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap">${metaBadges}</div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.final-ranking
// Compact ordered list. The full model-comparison matrix is in llm.group-breakdown.
// ---------------------------------------------------------------------------

function generateExecSummary(data: LlmPubData): string {
  const { legs, final, groups, passGroups, challengePassGroups, lzChallengePassGroups, findings } = data;
  const allPassGroups = [...passGroups, ...(challengePassGroups ?? []), ...(lzChallengePassGroups ?? [])];
  const legIds = legs.map((l) => l.id);
  const sorted = [...legIds].sort((a, b) => (final.rank[a] ?? Infinity) - (final.rank[b] ?? Infinity));

  const winner = legs.find((l) => l.id === sorted[0]);
  const winScore = final.score[sorted[0]];
  const winnerStr = winner ? `${winner.connector} / ${winner.model}` : sorted[0] ?? '';
  const winScoreStr = winScore !== null && winScore !== undefined ? ` (score: ${winScore.toFixed(1)})` : '';

  // Cost dimension -- find cheapest provider (includes challenge call costs)
  const costGroup = groups.find((g) => g.group === 'cost');
  const costRank1 = costGroup ? legIds.find((id) => costGroup.rank[id] === 1) : undefined;
  const costLeg = costRank1 ? legs.find((l) => l.id === costRank1) : undefined;
  const costPg = allPassGroups.reduce((sum, pg) => {
    const v = pg.legs[costRank1 ?? '']?.cost_usd;
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);

  // Failures
  const failedLegIds = findings
    .filter((f) => f.type === 'leg-failed')
    .map((f) => f.leg ?? '')
    .filter(Boolean);
  const failedLegs = failedLegIds
    .map((id) => legs.find((l) => l.id === id))
    .filter(Boolean);

  const sentences: string[] = [];
  sentences.push(
    `${esc(winnerStr)} ranked 1st${esc(winScoreStr)}, outperforming the other ${legs.length - 1} provider${legs.length !== 2 ? 's' : ''} on the weighted dimension score.`,
  );
  if (sorted.length > 1) {
    const last = legs.find((l) => l.id === sorted[sorted.length - 1]);
    const lastScore = final.score[sorted[sorted.length - 1]];
    if (last && lastScore !== null && lastScore !== undefined) {
      const gap = winScore !== null && winScore !== undefined ? ` (gap: ${(winScore - lastScore).toFixed(1)} points)` : '';
      sentences.push(
        `${esc(last.connector)} / ${esc(last.model)} ranked last at ${lastScore.toFixed(1)}${esc(gap)}.`,
      );
    }
  }
  if (failedLegs.length > 0) {
    const names = failedLegs.map((l) => esc(l!.model.split('/').pop() ?? l!.model)).join(', ');
    sentences.push(
      `Note: ${names} encountered a provider failure during the run -- its scores reflect only the passes that completed.`,
    );
  }
  if (costLeg && costRank1 !== sorted[0]) {
    sentences.push(
      `For cost-sensitive deployments, ${esc(costLeg.model.split('/').pop() ?? costLeg.model)} offers the best cost efficiency` +
      (costPg > 0 ? ` at $${costPg.toFixed(4)} total` : '') + `.`,
    );
  }
  return sentences.join(' ');
}

export function renderLlmFinalRanking(model: PublicationModel): string {
  const data = llm(model);
  if (!data) {
    return `<section id="llm-final-ranking" class="swao-block swao-block--llm-final-ranking">
  <h2>Final Ranking</h2>
  <p class="pub-text-secondary">No LLM assessment data available.</p>
</section>`;
  }

  const { final, legs } = data;
  const legIds = legs.map((l) => l.id);
  const sorted = [...legIds].sort((a, b) => (final.rank[a] ?? Infinity) - (final.rank[b] ?? Infinity));

  const items = sorted.map((id) => {
    const rank = final.rank[id];
    const score = final.score[id];
    const leg = legs.find((l) => l.id === id);
    const shortModel = leg ? leg.model.split('/').pop() ?? leg.model : id;
    const accentColor = rankAccentColor(rank);
    const scoreStr = score !== null && score !== undefined ? ` <span class="pub-text-secondary" style="font-size:0.85rem">(${score.toFixed(1)}%)</span>` : '';
    const rankLabel = rank !== null && rank !== undefined ? `<span style="display:inline-block;min-width:2rem;font-weight:700;color:${esc(accentColor)}">${esc(ordinal(rank))}</span>` : '';
    const modelChip = leg
      ? `<span style="color:${esc(accentColor)};font-weight:600">${esc(shortModel)}</span> <span class="pub-text-secondary" style="font-size:0.8rem">(${esc(leg.connector)})</span>`
      : esc(id);
    return `<li style="display:flex;align-items:baseline;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid var(--border,#e5e7eb)">${rankLabel}${modelChip}${scoreStr}</li>`;
  }).join('\n');

  const summary = generateExecSummary(data);

  return `<section id="llm-final-ranking" class="swao-block swao-block--llm-final-ranking">
  <h2>Final Ranking</h2>
  ${summary ? `<div class="pub-card swao-card" style="border-left:4px solid var(--colour-positive,#16a34a);padding:0.85rem 1rem;margin-bottom:1rem;background:var(--bg-surface,#fff)">
    <p class="pub-text-sm" style="margin:0;line-height:1.65">${summary}</p>
  </div>` : ''}
  <ol class="pub-list" style="list-style:none;padding:0;margin:0 0 0.75rem">${items}</ol>
  <p class="pub-text-secondary pub-text-sm">See the Model Comparison Matrix below for dimension-level detail.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.group-breakdown
// Spec-compliant matrix (Design 092 s8 Mockup 1):
//   - LLM models as columns (two-line header: connector / model)
//   - FINAL RESULT row at top
//   - One section per configured weight key (QUALITY, PERFORMANCE, COST, RELIABILITY)
//   - Property rows within each section, each expandable to show per-pass values
//   - Group sub-result row closes each section
//   - Unweighted groups (security, etc.) appended after configured sections
// ---------------------------------------------------------------------------

export function renderLlmGroupBreakdown(model: PublicationModel): string {
  const data = llm(model);
  if (!data || data.groups.length === 0) {
    return `<section id="llm-group-breakdown" class="swao-block swao-block--llm-group-breakdown">
  <h2>Model Comparison Matrix</h2>
  <p class="pub-text-secondary">No dimension data available.</p>
</section>`;
  }

  const { legs, groups, passGroups, challengePassGroups, lzChallengePassGroups, final, weights, findings } = data;
  // Merge standard + challenge + LZ-challenge pass groups so dimension aggregates
  // and per-pass detail rows include stakeholder challenge call costs and metrics.
  const allPassGroups = [...passGroups, ...(challengePassGroups ?? []), ...(lzChallengePassGroups ?? [])];
  // Set of leg IDs that have a leg-failed finding (#1540).
  const failedLegIds = new Set((findings ?? []).filter(f => f.type === 'leg-failed' && f.leg).map(f => f.leg!));
  // Columns ordered by final rank (best first) so the winner is always the left-most model column.
  const sortedLegs = [...legs].sort((a, b) => (final.rank[a.id] ?? Infinity) - (final.rank[b.id] ?? Infinity));
  const legIds = sortedLegs.map((l) => l.id);
  const colSpan = legIds.length + 1;
  const groupMap = new Map(groups.map((g) => [g.group, g]));

  // Two-line column headers: connector (bold) / model (truncated, small)
  // Rank color is applied via border-bottom so the column can be traced through the table.
  const modelHeaders = sortedLegs.map((l) => {
    const rank = final.rank[l.id];
    const accentColor = rankAccentColor(rank);
    return `<th class="llm-model-col" title="${esc(l.connector + ' / ' + l.model)}" style="border-bottom:3px solid ${esc(accentColor)}">` +
      `<strong style="color:${esc(accentColor)}">${esc(l.connector)}</strong><br>` +
      `<small class="llm-model-name">${esc(truncModel(l.model))}</small>` +
      `</th>`;
  }).join('\n        ');

  // FINAL RESULT row
  const finalCells = legIds.map((id) => {
    const rank = final.rank[id];
    const score = final.score[id];
    const leg = legs.find((l) => l.id === id);
    const isFailed = failedLegIds.has(id);
    const lightClass = isFailed ? 'pub-badge--red'
      : rank === 1 ? 'pub-badge--ok'
      : rank !== null && rank !== undefined && rank <= 2 ? 'pub-badge--warn'
      : 'pub-badge--red';
    const scoreStr = isFailed ? 'FAILED'
      : score !== null && score !== undefined ? score.toFixed(1) + '%' : '--';
    const providerTip = leg ? esc(leg.connector + ' / ' + leg.model) : esc(id);
    const rankLabel = isFailed ? '--' : ordinal(rank);
    return `<td class="llm-final-cell">` +
      `<span class="pub-badge ${esc(lightClass)}" title="${providerTip}">${esc(rankLabel)}</span><br>` +
      `<small class="pub-text-secondary">${esc(scoreStr)}</small>` +
      `</td>`;
  }).join('\n        ');

  // Determine which groups are covered by the configured weight keys
  const coveredGroupNames = new Set(
    Object.values(WEIGHT_KEY_TO_GROUPS).flat(),
  );
  const uncoveredGroups = groups.filter((g) => !coveredGroupNames.has(g.group));

  // Build section rows HTML
  const rows: string[] = [];

  // Sections in canonical weight-key order
  const weightKeysPresent = WEIGHT_KEY_ORDER.filter((k) => k in weights);
  for (const weightKey of weightKeysPresent) {
    const subGroupNames = WEIGHT_KEY_TO_GROUPS[weightKey] ?? [];
    const presentSubGroups = subGroupNames.filter((gn) => groupMap.has(gn));
    if (presentSubGroups.length === 0) continue;

    const w = weights[weightKey];
    const wLabel = w !== undefined ? `weight: ${(w * 100).toFixed(0)}%` : '';
    const subLabel = presentSubGroups.length > 1 ? ` (${presentSubGroups.join(' + ')})` : '';

    // Section header
    rows.push(
      `<tr class="llm-group-header llm-group-row" data-weight-key="${esc(weightKey)}">` +
      `<td colspan="${colSpan}">` +
      `<strong>${esc(weightKey.toUpperCase())}</strong>` +
      (subLabel ? `<span class="pub-text-secondary pub-text-sm">${esc(subLabel)}</span>` : '') +
      (wLabel ? `<span class="pub-text-secondary pub-text-sm" style="float:right">${esc(wLabel)}</span>` : '') +
      `</td></tr>`,
    );

    for (const groupName of presentSubGroups) {
      const grp = groupMap.get(groupName)!;
      const propDefs = GROUP_PROP_DEFS[groupName] ?? [];

      // Property rows with expandable per-pass detail (button-driven, no inner table)
      for (const prop of propDefs) {
        const aggCells = legIds.map((id) => {
          const v = aggMetric(allPassGroups, id, prop.key, prop.agg);
          if (v !== null && prop.fmtHtml) return `<td>${prop.fmtHtml(v)}</td>`;
          return `<td>${v !== null ? esc(prop.fmt(v)) : '--'}</td>`;
        }).join('');

        const hasPassDetail = allPassGroups.length > 0;
        const propKey = `${weightKey}-${String(prop.key)}`;
        const titleAttr = prop.description ? ` title="${esc(prop.description)}"` : '';
        const expandBtn = hasPassDetail
          ? `<button class="llm-expand-btn" data-target="${esc(propKey)}" aria-expanded="false"${titleAttr}>` +
            `<span class="llm-expand-icon" aria-hidden="true">&#9658;</span> ${esc(prop.label)}` +
            `</button>`
          : (prop.description
            ? `<span class="llm-prop-label"${titleAttr}>${esc(prop.label)}</span>`
            : esc(prop.label));

        rows.push(
          `<tr class="llm-property-row">` +
          `<td class="llm-prop-cell">${expandBtn}</td>` +
          aggCells +
          `</tr>`,
        );

        if (hasPassDetail) {
          for (const pg of allPassGroups) {
            const pgIdx = allPassGroups.indexOf(pg);
            const passColor = PASS_COLORS[pgIdx % PASS_COLORS.length] ?? '#f8f9fa';
            const passDesc = PASS_DESCRIPTIONS[pg.pass_id];
            const passCells = legIds.map((id) => {
              const m = pg.legs[id];
              if (!m) return `<td class="llm-agg-cell">--</td>`;
              const v = m[prop.key];
              if (typeof v === 'number' && prop.fmtHtml) return `<td class="llm-agg-cell">${prop.fmtHtml(v)}</td>`;
              return `<td class="llm-agg-cell">${typeof v === 'number' ? esc(prop.fmt(v)) : '--'}</td>`;
            }).join('');
            rows.push(
              `<tr class="llm-detail-row" data-parent="${esc(propKey)}" style="display:none">` +
              `<td class="llm-detail-pass-cell">` +
              `<a href="#pass-${esc(pg.pass_id)}" class="llm-pass-link" style="background:${esc(passColor)};color:#374151" title="${esc(passDesc?.short ?? pg.pass_id)}">${esc(pg.pass_id)}</a>` +
              `</td>` +
              passCells +
              `</tr>`,
            );
          }
        }
      }

      // Group sub-result row
      const subResultLabel = presentSubGroups.length > 1
        ? `${groupName} sub-result`
        : `group sub-result`;
      const subResultCells = legIds.map((id) => {
        const rank = grp.rank[id];
        const light = grp.light[id] ?? 'none';
        const lightClass = light !== 'none' ? ` pub-badge--${esc(light)}` : '';
        const score = grp.score[id];
        const scoreTip = score !== null && score !== undefined ? score.toFixed(1) + '%' : '--';
        const leg = legs.find((l) => l.id === id);
        const providerStr = leg ? ` (${leg.connector} / ${leg.model})` : '';
        return `<td><span class="pub-badge${lightClass}" title="${esc(groupName + ': ' + scoreTip + providerStr)}">${esc(ordinal(rank))}</span></td>`;
      }).join('');
      rows.push(
        `<tr id="llm-group-${esc(groupName)}" class="llm-subresult-row">` +
        `<td><span class="pub-text-secondary pub-text-sm">${esc(subResultLabel)}</span></td>` +
        `${subResultCells}</tr>`,
      );
    }

    // 7R Verdict row -- informational, within quality section (Design 092 s3.2; #1483).
    if (weightKey === 'quality' && data.verdicts && Object.keys(data.verdicts).length > 0) {
      const verdictCells = legIds.map((id) => {
        const v = data.verdicts![id];
        return v
          ? `<td><span class="pub-badge" style="background:#dcfce7;color:#166534;font-size:0.78rem" title="7R migration strategy from the synthesis pass (09-synth)">${esc(v)}</span></td>`
          : `<td class="pub-text-secondary">--</td>`;
      }).join('');
      rows.push(
        `<tr class="llm-property-row">` +
        `<td class="llm-prop-cell"><span class="llm-prop-label" title="7R migration strategy recommended by this LLM from the synthesis pass (09-synth). Informational only -- without ground truth no verdict is objectively better.">7R Verdict</span></td>` +
        verdictCells +
        `</tr>`,
      );
    }
  }

  // Uncovered groups (any group not in WEIGHT_KEY_TO_GROUPS) -- show property rows when defined.
  for (const grp of uncoveredGroups) {
    rows.push(
      `<tr class="llm-group-header">` +
      `<td colspan="${colSpan}">` +
      `<strong>${esc(grp.group.toUpperCase())}</strong>` +
      `</td></tr>`,
    );

    const propDefs = GROUP_PROP_DEFS[grp.group] ?? [];
    for (const prop of propDefs) {
      const aggCells = legIds.map((id) => {
        const v = aggMetric(allPassGroups, id, prop.key, prop.agg);
        if (v !== null && prop.fmtHtml) return `<td>${prop.fmtHtml(v)}</td>`;
        return `<td>${v !== null ? esc(prop.fmt(v)) : '--'}</td>`;
      }).join('');

      const hasPassDetail = allPassGroups.length > 0;
      const propKey = `${grp.group}-${String(prop.key)}`;
      const titleAttr = prop.description ? ` title="${esc(prop.description)}"` : '';
      const expandBtn = hasPassDetail
        ? `<button class="llm-expand-btn" data-target="${esc(propKey)}" aria-expanded="false"${titleAttr}>` +
          `<span class="llm-expand-icon" aria-hidden="true">&#9658;</span> ${esc(prop.label)}` +
          `</button>`
        : (prop.description
          ? `<span class="llm-prop-label"${titleAttr}>${esc(prop.label)}</span>`
          : esc(prop.label));

      rows.push(
        `<tr class="llm-property-row">` +
        `<td class="llm-prop-cell">${expandBtn}</td>` +
        aggCells +
        `</tr>`,
      );

      if (hasPassDetail) {
        for (const pg of allPassGroups) {
          const pgIdx = allPassGroups.indexOf(pg);
          const passColor = PASS_COLORS[pgIdx % PASS_COLORS.length] ?? '#f8f9fa';
          const passDesc = PASS_DESCRIPTIONS[pg.pass_id];
          const passCells = legIds.map((id) => {
            const m = pg.legs[id];
            if (!m) return `<td class="llm-agg-cell">--</td>`;
            const v = m[prop.key];
            if (typeof v === 'number' && prop.fmtHtml) return `<td class="llm-agg-cell">${prop.fmtHtml(v)}</td>`;
            return `<td class="llm-agg-cell">${typeof v === 'number' ? esc(prop.fmt(v)) : '--'}</td>`;
          }).join('');
          rows.push(
            `<tr class="llm-detail-row" data-parent="${esc(propKey)}" style="display:none">` +
            `<td class="llm-detail-pass-cell">` +
            `<a href="#pass-${esc(pg.pass_id)}" class="llm-pass-link" style="background:${esc(passColor)};color:#374151" title="${esc(passDesc?.short ?? pg.pass_id)}">${esc(pg.pass_id)}</a>` +
            `</td>` +
            passCells +
            `</tr>`,
          );
        }
      }
    }

    const subResultCells = legIds.map((id) => {
      const rank = grp.rank[id];
      const light = grp.light[id] ?? 'none';
      const lightClass = light !== 'none' ? ` pub-badge--${esc(light)}` : '';
      const score = grp.score[id];
      const scoreTip = score !== null && score !== undefined ? score.toFixed(1) : '--';
      const leg = legs.find((l) => l.id === id);
      const providerStr = leg ? ` (${leg.connector} / ${leg.model})` : '';
      return `<td><span class="pub-badge${lightClass}" title="${esc(grp.group + ': ' + scoreTip + providerStr)}">${esc(ordinal(rank))}</span></td>`;
    }).join('');
    rows.push(
      `<tr id="llm-group-${esc(grp.group)}" class="llm-subresult-row">` +
      `<td><span class="pub-text-secondary pub-text-sm">group sub-result</span></td>` +
      `${subResultCells}</tr>`,
    );
  }

  // C1 + C2 challenge rows appended after dimension groups (#1995).
  // Each challenge agent gets one flat row; one cell per provider leg showing
  // calls/dnf/lat in compact form (matrix has 1 cell per leg, not 3).
  const allChallengeAgents: Array<{ pg: (typeof passGroups)[0]; label: string; prefix: string }> = [
    ...(data.challengePassGroups ?? []).map((pg) => ({ pg, label: pg.pass_id.replace(/^C1-/, ''), prefix: 'C1' })),
    ...(data.lzChallengePassGroups ?? []).map((pg) => ({ pg, label: pg.pass_id.replace(/^C2-/, ''), prefix: 'C2' })),
  ];
  if (allChallengeAgents.length > 0) {
    rows.push(
      `<tr class="llm-group-header" id="llm-group-challenge">` +
      `<td colspan="${colSpan}"><strong>CHALLENGE</strong>` +
      `<span class="pub-text-secondary pub-text-sm"> (C1 app + C2 LZ agents)</span></td></tr>`,
    );
    for (const { pg, label, prefix } of allChallengeAgents) {
      const cells = legIds.map((id) => {
        const agg = pg.legs[id];
        if (!agg || agg.calls === 0) return `<td class="pub-text-secondary">--</td>`;
        const lat = agg.latency_p50_ms !== null && agg.latency_p50_ms !== undefined
          ? (agg.latency_p50_ms / 1000).toFixed(1) + 's' : '--';
        const dnfStyle = agg.dnf > 0 ? 'color:var(--pub-red,#c0392b);' : '';
        const badge = agg.dnf > 0
          ? `<span style="${esc(dnfStyle)}font-weight:600" title="DNF: ${esc(String(agg.dnf))} / ${esc(String(agg.calls))} calls">DNF</span>`
          : `<span style="color:#16a34a" title="${esc(String(agg.calls))} call(s) completed">&#10003;</span>`;
        return `<td style="font-size:0.8rem">${badge} ${esc(lat)}</td>`;
      }).join('');
      rows.push(
        `<tr class="llm-property-row" id="llm-pass-${esc(pg.pass_id)}">` +
        `<td class="llm-prop-cell"><a href="#llm-pass-${esc(pg.pass_id)}" class="llm-prop-label" title="${esc(prefix)} challenge agent: ${esc(pg.pass_id)}">${esc(prefix + '-' + label)}</a></td>` +
        cells +
        `</tr>`,
      );
    }
  }

  // Weights summary line above the table
  const weightSummary = Object.entries(weights)
    .map(([k, v]) => `${esc(k)} ${(v * 100).toFixed(0)}%`)
    .join(' &bull; ');

  return `<section id="llm-group-breakdown" class="swao-block swao-block--llm-group-breakdown">
  <h2>Model Comparison Matrix</h2>
  <p class="pub-text-secondary pub-text-sm" style="margin-bottom:0.75rem">
    <strong>Dimension weights:</strong> ${weightSummary}
  </p>
  <div class="llm-matrix-scroll" style="overflow-x:auto">
  <table class="swao-table llm-matrix-table" aria-label="LLM model comparison matrix">
    <thead>
      <tr>
        <th>Dimension / Property</th>
        ${modelHeaders}
      </tr>
    </thead>
    <tbody>
      <tr class="llm-final-row">
        <td>
          <strong>FINAL RESULT</strong><br>
          <span class="pub-text-secondary pub-text-sm">weighted rank (score 0-100)</span>
        </td>
        ${finalCells}
      </tr>
      <tr class="llm-section-sep"><td colspan="${colSpan}" style="padding:0;height:3px;background:var(--border,#ddd)"></td></tr>
      ${rows.join('\n      ')}
    </tbody>
  </table>
  </div>
  <p class="pub-text-secondary pub-text-sm" style="margin-top:0.5rem">
    Score 0-100 is relative to this run's model set. Property rows expand to show per-pass data.
  </p>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.pass-table
// Supplementary per-pass detail with filter and anomaly toggle.
// ---------------------------------------------------------------------------

export function renderLlmPassTable(model: PublicationModel): string {
  const data = llm(model);
  if (!data || data.passGroups.length === 0) {
    return `<section id="llm-pass-table" class="swao-block swao-block--llm-pass-table">
  <h2>Per-Pass Results</h2>
  <p class="pub-text-secondary">No per-pass data available.</p>
</section>`;
  }

  const { legs, passGroups, final, challengePassGroups, lzChallengePassGroups } = data;
  const sortedLegs = [...legs].sort((a, b) => (final.rank[a.id] ?? Infinity) - (final.rank[b.id] ?? Infinity));
  const legIds = sortedLegs.map((l) => l.id);

  const headerCells = sortedLegs.map((l) =>
    `<th colspan="3" class="llm-model-col" title="${esc(l.id)}">` +
    `${esc(l.connector)}<br><small title="${esc(l.model)}">${esc(truncModel(l.model))}</small>` +
    `</th>`,
  ).join('');
  const subHeaderCells = legIds.map(() =>
    `<th title="Total API calls for this pass">Calls</th>` +
    `<th title="Did-Not-Finish: calls that timed out or errored">DNF</th>` +
    `<th title="Median latency across successful calls (milliseconds)">Lat(ms)</th>`,
  ).join('');

  const passRows = passGroups.map((pg) => {
    let isAnomaly = false;
    const pgIdx = passGroups.indexOf(pg);
    const passColor = PASS_COLORS[pgIdx % PASS_COLORS.length] ?? '#f8f9fa';
    const passDesc = PASS_DESCRIPTIONS[pg.pass_id];
    const cells = legIds.map((id) => {
      const agg = pg.legs[id];
      if (!agg) return `<td>--</td><td>--</td><td>--</td>`;
      const lat = agg.latency_p50_ms !== null && agg.latency_p50_ms !== undefined
        ? agg.latency_p50_ms.toFixed(0)
        : '--';
      if (agg.dnf > 0) isAnomaly = true;
      const dnfClass = agg.dnf > 0 ? ' style="color:var(--pub-red,#c0392b);font-weight:600"' : '';
      const dnfTitle = ' title="Did Not Finish -- the model failed to produce a valid response for this pass"';
      return `<td>${agg.calls}</td><td${dnfClass}${dnfTitle}>${agg.dnf}</td><td>${lat}</td>`;
    }).join('');

    const rowId = `llm-pass-${esc(pg.pass_id)}`;
    const anomalyAttr = isAnomaly ? ' data-anomaly="1"' : '';
    return `<tr id="${rowId}"${anomalyAttr}>
      <td><a href="#pass-${esc(pg.pass_id)}" class="llm-pass-badge" style="background:${esc(passColor)}" title="${esc(passDesc?.short ?? pg.pass_id)}">${esc(pg.pass_id)}</a></td>
      ${cells}
    </tr>`;
  }).join('\n');

  // C1-namespace challenge rows (#1708, Q4): append after standard pass rows
  // with a separator. One row per challenge agent; badge shows the C1-* id.
  const visibleChallenge = (challengePassGroups ?? []).filter((pg) => pg.pass_id.startsWith('C1-'));
  const challengeSeparatorRow = visibleChallenge.length > 0
    ? `<tr><td colspan="${1 + legIds.length * 3}" style="background:var(--pub-bg-alt,#f9fafb);font-size:0.78rem;font-weight:600;color:var(--pub-text-secondary,#6b7280);padding:0.3rem 0.5rem;border-top:2px solid var(--border,#e2e8f0)">Stakeholder Challenge (C1)</td></tr>`
    : '';
  const challengeRows = visibleChallenge.map((pg, ci) => {
    let isAnomaly = false;
    const challengeColor = PASS_COLORS[(passGroups.length + ci) % PASS_COLORS.length] ?? '#f8f9fa';
    const agentLabel = pg.pass_id.replace(/^C1-/, '');
    const cells = legIds.map((id) => {
      const agg = pg.legs[id];
      if (!agg || agg.calls === 0) return `<td>--</td><td>--</td><td>--</td>`;
      const lat = agg.latency_p50_ms !== null && agg.latency_p50_ms !== undefined
        ? agg.latency_p50_ms.toFixed(0)
        : '--';
      if (agg.dnf > 0) isAnomaly = true;
      const dnfClass = agg.dnf > 0 ? ' style="color:var(--pub-red,#c0392b);font-weight:600"' : '';
      const dnfTitle = ' title="Challenge agent did not finish -- subprocess error or timeout"';
      return `<td>${agg.calls}</td><td${dnfClass}${dnfTitle}>${agg.dnf}</td><td>${lat}</td>`;
    }).join('');
    const rowId = `llm-pass-${esc(pg.pass_id)}`;
    const anomalyAttr = isAnomaly ? ' data-anomaly="1"' : '';
    return `<tr id="${rowId}"${anomalyAttr}>
      <td><span class="llm-pass-badge" style="background:${esc(challengeColor)}" title="Challenge agent: ${esc(agentLabel)}">${esc(pg.pass_id)}</span></td>
      ${cells}
    </tr>`;
  }).join('\n');

  // C2-namespace LZ challenge rows (#1994): append after C1 rows.
  const visibleLzChallenge = (lzChallengePassGroups ?? []).filter((pg) => pg.pass_id.startsWith('C2-'));
  const lzChallengeSeparatorRow = visibleLzChallenge.length > 0
    ? `<tr><td colspan="${1 + legIds.length * 3}" style="background:var(--pub-bg-alt,#f9fafb);font-size:0.78rem;font-weight:600;color:var(--pub-text-secondary,#6b7280);padding:0.3rem 0.5rem;border-top:2px solid var(--border,#e2e8f0)">LZ Challenge (C2)</td></tr>`
    : '';
  const lzChallengeRows = visibleLzChallenge.map((pg, ci) => {
    let isAnomaly = false;
    const lzColor = PASS_COLORS[(passGroups.length + visibleChallenge.length + ci) % PASS_COLORS.length] ?? '#f8f9fa';
    const agentLabel = pg.pass_id.replace(/^C2-/, '');
    const cells = legIds.map((id) => {
      const agg = pg.legs[id];
      if (!agg || agg.calls === 0) return `<td>--</td><td>--</td><td>--</td>`;
      const lat = agg.latency_p50_ms !== null && agg.latency_p50_ms !== undefined
        ? agg.latency_p50_ms.toFixed(0)
        : '--';
      if (agg.dnf > 0) isAnomaly = true;
      const dnfClass = agg.dnf > 0 ? ' style="color:var(--pub-red,#c0392b);font-weight:600"' : '';
      const dnfTitle = ' title="LZ challenge agent did not finish -- subprocess error or timeout"';
      return `<td>${agg.calls}</td><td${dnfClass}${dnfTitle}>${agg.dnf}</td><td>${lat}</td>`;
    }).join('');
    const rowId = `llm-pass-${esc(pg.pass_id)}`;
    const anomalyAttr = isAnomaly ? ' data-anomaly="1"' : '';
    return `<tr id="${rowId}"${anomalyAttr}>
      <td><span class="llm-pass-badge" style="background:${esc(lzColor)}" title="LZ challenge agent: ${esc(agentLabel)}">${esc(pg.pass_id)}</span></td>
      ${cells}
    </tr>`;
  }).join('\n');

  return `<section id="llm-pass-table" class="swao-block swao-block--llm-pass-table">
  <h2>Per-Pass Results</h2>
  <div class="pub-pass-controls" style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem">
    <input id="llm-pass-filter" type="search" placeholder="Filter passes..." aria-label="Filter passes by ID"
      style="padding:0.25rem 0.5rem;border:1px solid var(--border,#ddd);border-radius:4px;font-size:0.85rem;width:14rem" />
    <label style="font-size:0.85rem;cursor:pointer">
      <input id="llm-anomaly-toggle" type="checkbox" />
      Show anomalies only <small class="pub-text-secondary">(any DNF)</small>
    </label>
    <span id="llm-pass-count" class="pub-text-secondary" style="font-size:0.8rem;margin-left:auto"></span>
  </div>
  <div style="overflow-x:auto">
  <table id="llm-pass-table-el" class="swao-table" aria-label="Per-pass results across LLM models">
    <thead>
      <tr>
        <th rowspan="2">Pass</th>
        ${headerCells}
      </tr>
      <tr>
        ${subHeaderCells}
      </tr>
    </thead>
    <tbody id="llm-pass-tbody">
      ${passRows}
      ${challengeSeparatorRow}
      ${challengeRows}
      ${lzChallengeSeparatorRow}
      ${lzChallengeRows}
    </tbody>
  </table>
  </div>
  <script>
  (function () {
    var filter = document.getElementById('llm-pass-filter');
    var toggle = document.getElementById('llm-anomaly-toggle');
    var tbody  = document.getElementById('llm-pass-tbody');
    var countEl = document.getElementById('llm-pass-count');
    function applyFilter() {
      if (!tbody) return;
      var term = filter ? filter.value.toLowerCase() : '';
      var anomalyOnly = toggle ? toggle.checked : false;
      var rows = tbody.querySelectorAll('tr');
      var visible = 0;
      rows.forEach(function (row) {
        var passCell = row.querySelector('.llm-pass-badge');
        var passId = passCell ? passCell.textContent || '' : '';
        var isAnomaly = row.getAttribute('data-anomaly') === '1';
        var show = passId.toLowerCase().includes(term) && (!anomalyOnly || isAnomaly);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      if (countEl) countEl.textContent = visible + ' / ' + rows.length + ' passes';
    }
    if (filter) filter.addEventListener('input', applyFilter);
    if (toggle) toggle.addEventListener('change', applyFilter);
    applyFilter();
  })();
  </script>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.findings
// ---------------------------------------------------------------------------

export function renderLlmFindings(model: PublicationModel): string {
  const data = llm(model);
  const findings = data?.findings ?? [];

  if (findings.length === 0) {
    return `<section id="llm-findings" class="swao-block swao-block--llm-findings">
  <h2>Operational Findings</h2>
  <p class="pub-text-secondary">No operational findings recorded for this run.</p>
</section>`;
  }

  // Human-readable display mapping for schema-level finding types.
  const FINDING_TYPE_LABEL: Record<string, string> = {
    'leg-failed':   'Provider failure',
    'pass-skipped': 'Pass skipped',
    'warn-dnf':     'High DNF rate',
    'cost-spike':   'Cost spike',
  };

  const rows = findings.map((f, i) => {
    const sevClass = f.severity === 'error' ? 'pub-badge--red'
      : f.severity === 'warn' ? 'pub-badge--amber'
      : 'pub-badge--blue';
    const passRef = f.id && (f.id as string).includes('.')
      ? `<a href="#llm-pass-${esc((f.id as string).split('.')[0])}" title="Jump to pass row">&uarr; pass</a>`
      : '';
    const typeLabel = FINDING_TYPE_LABEL[f.type] ?? f.type;
    const providerCell = f.leg
      ? (() => {
          const leg = data?.legs?.find((l) => l.id === f.leg);
          const shortName = leg ? (leg.model.split('/').pop() ?? leg.model) : f.leg;
          const tooltip = leg ? `${leg.connector} / ${leg.model}` : f.leg;
          return `<code title="${esc(tooltip)}">${esc(shortName)}</code>`;
        })()
      : '';
    return `<tr id="llm-finding-${i}">
      <td><span class="pub-badge ${sevClass}">${esc(f.severity)}</span></td>
      <td><code>${esc(f.id)}</code>${passRef ? ' ' + passRef : ''}</td>
      <td>${esc(typeLabel)}</td>
      <td>${providerCell}</td>
      <td>${esc(f.message)}</td>
    </tr>`;
  }).join('\n');

  return `<section id="llm-findings" class="swao-block swao-block--llm-findings">
  <h2>Operational Findings</h2>
  <table class="swao-table" aria-label="Operational findings">
    <thead>
      <tr>
        <th>Severity</th>
        <th>ID</th>
        <th>Type</th>
        <th title="Model short name (hover cells for connector / full model id)">Model</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.methodology
// ---------------------------------------------------------------------------

export function renderLlmMethodology(model: PublicationModel): string {
  const data = llm(model);
  const mode = data?.analysis_mode ?? 'serial';
  const legCount = data?.legs?.length ?? 0;
  const modelStr = legCount === 1 ? '1 LLM provider' : `${legCount} LLM providers`;
  const weights = data?.weights ?? {};
  const weightSummary = Object.entries(weights)
    .map(([k, v]) => `${esc(k)}: ${(v * 100).toFixed(0)}%`)
    .join(', ');

  return `<section id="llm-methodology" class="swao-block swao-block--llm-methodology">
  <h2>Methodology</h2>

  <h3 class="pub-text-sm pub-method-heading" style="margin-top:1rem;margin-bottom:0.25rem">What is being assessed</h3>
  <p class="pub-text-sm">
    This report evaluates ${modelStr} on their ability to execute the SWAO App Assessment
    pass suite. Each provider receives the same structured prompts derived from the application
    workload profile and must return JSON responses conforming to the SWAO pass schema.
    The assessment measures not only correctness but also speed, cost, and operational reliability.
  </p>

  <h3 class="pub-text-sm pub-method-heading" style="margin-top:1rem;margin-bottom:0.25rem">How the passes are executed</h3>
  <p class="pub-text-sm">
    Each LLM provider is configured as a provider leg with its connector, model, and credentials.
    Passes are executed in <strong>${esc(mode)}</strong> mode: in serial mode, each provider runs
    the full pass suite sequentially; in fan-out mode, providers run in parallel.
    Raw call records (latency, token counts, cost, parse success, schema conformance, and DNF status)
    are captured per call and aggregated per pass and per provider.
  </p>

  <h3 class="pub-text-sm pub-method-heading" style="margin-top:1rem;margin-bottom:0.25rem">Dimensions and scoring</h3>
  <p class="pub-text-sm">
    Six dimensions are measured across each provider.
    ${weightSummary ? `Configured dimension weights for this run: ${weightSummary}.` : ''}
  </p>
  <dl class="pub-text-sm" style="margin:0.5rem 0 0 0">
    <dt style="font-weight:600;margin-top:0.75rem">Performance (latency)</dt>
    <dd style="margin:0.15rem 0 0 1rem">Response speed determines how quickly analysts receive assessment output; high latency creates bottlenecks in large portfolio runs. SWAO measures median call latency (p50) across all pass calls. Lower latency ranks higher; the fastest provider in the run receives the maximum performance score.</dd>
    <dt style="font-weight:600;margin-top:0.75rem">Cost (API spend)</dt>
    <dd style="margin:0.15rem 0 0 1rem">LLM API costs accumulate per run; a model ten times more expensive than a comparable alternative creates unsustainable budget pressure at portfolio scale. SWAO sums total USD spend across all calls. Lower cost ranks higher; scores are normalised within the run so the cheapest and most expensive providers anchor the scale.</dd>
    <dt style="font-weight:600;margin-top:0.75rem">Quality-Structural (parse rate, schema conformance)</dt>
    <dd style="margin:0.15rem 0 0 1rem">SWAO passes require structured JSON output conforming to the SWAO pass schema. A provider that returns unparseable or non-conformant responses cannot drive the assessment pipeline downstream. SWAO measures parse valid rate (fraction of calls producing valid JSON) and schema conformance rate. Higher rates rank higher; both feed the quality weight group.</dd>
    <dt style="font-weight:600;margin-top:0.75rem">Quality-Content (semantic accuracy -- reserved for v2)</dt>
    <dd style="margin:0.15rem 0 0 1rem">Structural correctness is necessary but not sufficient -- a provider could emit schema-valid JSON containing plausible but incorrect findings. This dimension will capture how accurately each LLM identifies real workload characteristics, using ground-truth comparison against known workload data. Currently informational only; not included in the weighted composite score.</dd>
    <dt style="font-weight:600;margin-top:0.75rem">Reliability (DNF rate)</dt>
    <dd style="margin:0.15rem 0 0 1rem">A provider that frequently times out or fails to return a response forces re-runs or leaves gaps in the assessment. Reliability is especially critical in multi-leg fan-out runs where one unreliable provider can delay the entire pipeline. SWAO counts Did-Not-Finish (DNF) events per pass; any DNF is flagged as an anomaly. A provider with zero DNF across all passes receives the top reliability score.</dd>
    <dt style="font-weight:600;margin-top:0.75rem">Security (prompt-injection resistance, redaction integrity, PII reproduction)</dt>
    <dd style="margin:0.15rem 0 0 1rem">The LLM processes potentially untrusted workload artefacts -- README files, configuration, IaC templates -- that may contain adversarial instructions or sensitive data. A provider susceptible to prompt injection or one that reproduces PII from context creates a direct security risk in the assessment pipeline. SWAO runs three dedicated security passes measuring PII redaction, prompt injection resistance, and schema boundary adherence. Pass/fail counts feed the security dimension score.</dd>
  </dl>

  <h3 class="pub-text-sm pub-method-heading" style="margin-top:1rem;margin-bottom:0.25rem">Relative scoring and ranking</h3>
  <p class="pub-text-sm">
    Scores are <strong>relative to this run's provider set</strong>: every dimension property normalises
    the worst-performing provider to 0 and the best to 100 (direction varies per metric -- lower latency
    is better, higher parse rate is better). A 2% degenerate-spread guard prevents near-identical values
    from producing extreme rank separation. Rankings represent which provider performed best within
    this comparison only -- they are not absolute quality scores.
  </p>

  <h3 class="pub-text-sm pub-method-heading" style="margin-top:1rem;margin-bottom:0.25rem">Reading the report</h3>
  <p class="pub-text-sm">
    The <strong>Final Ranking</strong> section gives the overall weighted winner.
    The <strong>Model Comparison Matrix</strong> shows group-level and property-level detail:
    expand any property row to see per-pass breakdowns. The <strong>Per-Pass Results</strong>
    table shows raw call counts, DNF, and latency per pass. The <strong>Operational Findings</strong>
    table lists anomalies flagged during the run (provider failures, high DNF rates, cost spikes).
    Null (<code>--</code>) scores indicate the provider was not rankable on that dimension
    (zero completed calls or all DNF).
  </p>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.narrative
// ---------------------------------------------------------------------------

export function renderLlmNarrative(model: PublicationModel): string {
  const data = llm(model);
  const narrative = data?.narrative;

  if (!narrative) {
    return '';
  }

  return `<section id="llm-narrative" class="swao-block swao-block--llm-narrative">
  <h2>Executive Summary</h2>
  <div class="pub-narrative-body">
    <p>${esc(narrative)}</p>
  </div>
  <p class="pub-text-secondary pub-text-sm">Summary generated by the interpretation connector.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.model-detail
// One card per LLM provider: connector, model, context window (if available),
// per-group rank and score summary (#1469).
// ---------------------------------------------------------------------------

export function renderLlmModelDetail(model: PublicationModel): string {
  const data = llm(model);
  if (!data || data.legs.length === 0) {
    return `<section id="llm-model-detail" class="swao-block swao-block--llm-model-detail">
  <h2>LLM Provider Detail</h2>
  <p class="pub-text-secondary">No provider data available.</p>
</section>`;
  }

  const { legs, groups, passGroups, final } = data;

  // Sort cards by final rank ascending (rank 1 = best appears first)
  const sortedLegs = [...legs].sort((a, b) => (final.rank[a.id] ?? Infinity) - (final.rank[b.id] ?? Infinity));

  const cards = sortedLegs.map((leg) => {
    const shortModel = leg.model.split('/').pop() ?? leg.model;
    const rank = final.rank[leg.id];
    const score = final.score[leg.id];
    const rankBadgeClass = rank === 1 ? 'pub-badge--ok'
      : rank !== null && rank !== undefined && rank <= 2 ? 'pub-badge--warn'
      : 'pub-badge--red';
    const accentColor = rankAccentColor(rank);
    const scorePct = score !== null && score !== undefined ? Math.min(100, Math.max(0, score)) : 0;

    // Group dimension summary rows
    const groupRows = groups.map((g) => {
      const gs = g.score[leg.id];
      const gr = g.rank[leg.id];
      const gl = g.light[leg.id] ?? 'none';
      const glClass = gl !== 'none' ? ` pub-badge--${esc(gl)}` : '';
      return `<tr>
        <td>${esc(g.group)}</td>
        <td><span class="pub-badge${glClass}">${esc(ordinal(gr))}</span></td>
        <td class="pub-text-secondary">${gs !== null && gs !== undefined ? gs.toFixed(1) : '--'}</td>
      </tr>`;
    }).join('\n');

    // Aggregate key metrics across passes
    const totalCalls = passGroups.reduce((s, pg) => s + (pg.legs[leg.id]?.calls ?? 0), 0);
    const totalDnf = passGroups.reduce((s, pg) => s + (pg.legs[leg.id]?.dnf ?? 0), 0);
    const totalCost = passGroups.reduce((s, pg) => {
      const v = pg.legs[leg.id]?.cost_usd;
      return s + (typeof v === 'number' ? v : 0);
    }, 0);
    const parseRates = passGroups.map((pg) => pg.legs[leg.id]?.parse_valid_rate).filter((v): v is number => typeof v === 'number');
    const avgParseRate = parseRates.length > 0 ? parseRates.reduce((a, b) => a + b, 0) / parseRates.length : null;

    const shaHtml = leg.connector_sha256
      ? `<div class="pub-text-2xs-secondary" title="Connector SHA256: ${esc(leg.connector_sha256)}">sha256: ${esc(leg.connector_sha256.slice(0, 12))}...</div>`
      : '';

    return `<div class="llm-provider-card swao-card pub-card pub-mb-3" id="llm-provider-${esc(leg.id)}" style="border-left:4px solid ${accentColor}">
  <div class="pub-flex-row-gap pub-mb-2">
    <div>
      <div class="pub-heading-base">${esc(leg.connector)} / <strong>${esc(shortModel)}</strong></div>
      <div class="pub-text-2xs-secondary" title="${esc(leg.model)}">${esc(leg.model)}</div>
      ${shaHtml}
    </div>
    <div style="text-align:right;min-width:6rem">
      ${rank !== null && rank !== undefined
        ? `<span class="pub-badge ${rankBadgeClass}" style="font-size:1.05rem;padding:0.25rem 0.55rem" title="${esc(leg.connector + ' / ' + leg.model)}">${esc(ordinal(rank))}</span>`
        : ''}
      ${score !== null && score !== undefined
        ? `<div class="pub-text-secondary" style="font-size:0.82rem;margin-top:0.25rem">score: <strong>${score.toFixed(1)}%</strong></div>`
        : ''}
    </div>
  </div>
  ${score !== null && score !== undefined
    ? `<div class="llm-score-bar"><div class="llm-score-bar__fill" style="width:${scorePct.toFixed(0)}%;background:${accentColor}"></div></div>`
    : ''}
  <div class="pub-flex-3col-mt" style="margin-bottom:0.75rem">
    <div class="pub-text-center">
      <div class="pub-num-2xl-primary" style="font-size:1.4rem">${totalCalls}</div>
      <div class="pub-text-xs-secondary">Total calls</div>
    </div>
    <div class="pub-text-center">
      ${totalDnf === 0
        ? `<div class="pub-num-2xl-primary" style="font-size:1.4rem;color:var(--pub-green,#16a34a)">0</div>`
        : `<div class="pub-num-2xl-primary" style="font-size:1.4rem;color:var(--pub-red,#c0392b)">${totalDnf}</div>`}
      <div class="pub-text-xs-secondary">DNF</div>
    </div>
    <div class="pub-text-center">
      <div class="pub-num-2xl-primary" style="font-size:1.4rem">$${totalCost.toFixed(4)}</div>
      <div class="pub-text-xs-secondary">Total cost</div>
    </div>
  </div>
  ${avgParseRate !== null ? `<p class="pub-text-sm pub-text-secondary" style="margin:0 0 0.5rem">Parse valid rate (avg): <strong>${avgParseRate.toFixed(0)}%</strong></p>` : ''}
  ${groups.length > 0 ? `
  <details class="llm-detail-groups">
    <summary class="llm-prop-summary pub-text-sm">Dimension scores</summary>
    <table class="swao-table swao-table--sm" style="margin-top:0.5rem">
      <thead><tr><th>Dimension</th><th>Rank</th><th>Score</th></tr></thead>
      <tbody>${groupRows}</tbody>
    </table>
  </details>` : ''}
</div>`;
  }).join('\n');

  const sortedByRank = [...legs].sort((a, b) => (final.rank[a.id] ?? Infinity) - (final.rank[b.id] ?? Infinity));
  const topLeg = sortedByRank[0];
  const topLabel = topLeg
    ? `${topLeg.connector} / ${topLeg.model.split('/').pop() ?? topLeg.model}`
    : '';
  const topScoreVal = topLeg ? final.score[topLeg.id] : null;
  const summaryTile = `<div class="llm-provider-summary-tile swao-card pub-card">` +
    `<strong>${legs.length} provider${legs.length !== 1 ? 's' : ''} assessed</strong>` +
    (topLabel
      ? ` <span class="pub-text-secondary">&middot; top ranked: ${esc(topLabel)}` +
        (topScoreVal !== null && topScoreVal !== undefined ? ` (score ${topScoreVal.toFixed(1)})` : '') +
        `</span>`
      : '') +
    `</div>`;

  return `<section id="llm-model-detail" class="swao-block swao-block--llm-model-detail">
  <h2>LLM Provider Detail</h2>
  <p class="pub-text-secondary pub-text-sm" style="margin-bottom:1rem">
    Per-provider summary cards. Expand each card to see dimension-level scores.
    Final ranking order shown.
  </p>
  <div class="llm-provider-grid">
${summaryTile}
${cards}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: llm.pass-deep-dive
// Per-pass breakdown: one section per pass with all provider metrics (#1461).
// Provides the target anchors (id="pass-{id}") for matrix row deep-links.
// ---------------------------------------------------------------------------

export function renderLlmPassDeepDive(model: PublicationModel): string {
  const data = llm(model);
  if (!data || data.passGroups.length === 0) {
    return `<section id="llm-pass-deep-dive" class="swao-block swao-block--llm-pass-deep-dive">
  <h2>Pass Deep-Dive</h2>
  <p class="pub-text-secondary">No per-pass data available.</p>
</section>`;
  }

  const { legs, passGroups } = data;

  const passSections = passGroups.map((pg, pgIdx) => {
    const passColor = PASS_COLORS[pgIdx % PASS_COLORS.length] ?? '#f8f9fa';
    const passDesc = PASS_DESCRIPTIONS[pg.pass_id];
    // Sort legs by rank for this pass (lower = better)
    const sorted = [...legs].sort((a, b) => (pg.rank[a.id] ?? 99) - (pg.rank[b.id] ?? 99));

    const rows = sorted.map((leg) => {
      const agg = pg.legs[leg.id];
      const shortModel = leg.model.split('/').pop() ?? leg.model;
      const tooltip = `${leg.connector} / ${leg.model}`;
      if (!agg) {
        return `<tr>
          <td title="${esc(tooltip)}">${esc(shortModel)}</td>
          <td colspan="6" class="pub-text-secondary">No data for this pass</td>
        </tr>`;
      }
      const rank = pg.rank[leg.id];
      const rankBadgeClass = rank === 1 ? 'pub-badge--ok'
        : rank !== null && rank !== undefined && rank <= 2 ? 'pub-badge--warn'
        : 'pub-badge--red';
      const lat = agg.latency_p50_ms !== null && agg.latency_p50_ms !== undefined
        ? agg.latency_p50_ms >= 1000
          ? (agg.latency_p50_ms / 1000).toFixed(1) + 's'
          : agg.latency_p50_ms.toFixed(0) + 'ms'
        : '--';
      const dnfHtml = agg.dnf === 0
        ? `<span class="pub-badge pub-badge--ok" title="No failures">0</span>`
        : `<span class="pub-badge pub-badge--red" title="Did Not Finish -- the model failed to produce a valid response for this pass">${agg.dnf}</span>`;
      const parseRate = agg.parse_valid_rate !== null && agg.parse_valid_rate !== undefined
        ? agg.parse_valid_rate.toFixed(0) + '%' : '--';
      const schemaRate = agg.schema_conform_rate !== null && agg.schema_conform_rate !== undefined
        ? agg.schema_conform_rate.toFixed(0) + '%' : '--';
      const cost = typeof agg.cost_usd === 'number' ? '$' + agg.cost_usd.toFixed(4) : '--';

      const passRankAccent = rankAccentColor(rank);
      return `<tr>
          <td title="${esc(tooltip)}">
            ${rank !== null && rank !== undefined ? `<span class="pub-badge ${esc(rankBadgeClass)}" style="font-size:0.72rem;margin-right:0.3rem">${esc(ordinal(rank))}</span>` : ''}
            <code style="font-size:0.82rem;color:${esc(passRankAccent)};font-weight:600">${esc(shortModel)}</code>
          </td>
          <td class="pub-text-center">${esc(String(agg.calls))}</td>
          <td class="pub-text-center">${dnfHtml}</td>
          <td class="pub-text-center">${esc(lat)}</td>
          <td class="pub-text-center">${esc(cost)}</td>
          <td class="pub-text-center">${esc(parseRate)}</td>
          <td class="pub-text-center">${esc(schemaRate)}</td>
        </tr>`;
    }).join('\n');

    return `<div id="pass-${esc(pg.pass_id)}" class="llm-pass-section pub-mb-4" style="border-left:3px solid ${esc(passColor)};padding-left:0.75rem">
    <h3 class="pub-text-sm" style="margin:0 0 0.35rem;font-weight:700">
      <span class="llm-pass-badge" style="background:${esc(passColor)};color:#374151;font-weight:600">${esc(pg.pass_id)}</span>
      ${passDesc ? `<span class="pub-text-secondary" style="font-size:0.78rem;font-weight:400;margin-left:0.4rem">${esc(passDesc.short)}</span>` : ''}
    </h3>
    ${passDesc ? `<p class="pub-text-sm" style="margin:0 0 0.6rem;color:var(--text-secondary,#666)">${esc(passDesc.detail)}</p>` : ''}
    <div style="overflow-x:auto">
    <table class="swao-table swao-table--sm" aria-label="Pass ${esc(pg.pass_id)} provider results">
      <thead>
        <tr>
          <th title="Model short name (hover for connector / full model id)">Model</th>
          <th title="API calls made">Calls</th>
          <th title="Did not finish (timeout/error)">DNF</th>
          <th title="Median latency (P50)">Latency</th>
          <th title="API cost for this pass">Cost</th>
          <th title="Percentage of calls returning parseable JSON">Parse valid</th>
          <th title="Percentage of parsed responses matching the expected schema">Schema conform</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </div>
  </div>`;
  }).join('\n');

  return `<section id="llm-pass-deep-dive" class="swao-block swao-block--llm-pass-deep-dive">
  <h2>Pass Deep-Dive</h2>
  <p class="pub-text-secondary pub-text-sm" style="margin-bottom:1rem">
    Per-pass breakdown for each LLM provider. Ranks shown are pass-level (not the overall final rank).
    Each pass section is linked from the Model Comparison Matrix property rows.
  </p>
${passSections}
</section>`;
}

// ---------------------------------------------------------------------------
// Challenge Results (#1587, Enterprise)
// ---------------------------------------------------------------------------

/**
 * Renders the "Challenge Results" section -- per-leg adversarial challenge
 * pass summary and the cross-leg challenge resilience score. Present only
 * when challenge prompts were invoked per leg (Enterprise tier,
 * assess --type llm). When no challenge data is available, returns an empty
 * string so the slot is silently skipped.
 */
export function renderLlmChallengeResults(model: PublicationModel): string {
  const data = llm(model);
  if (!data) return '';
  const cpg = data.challengePassGroups;
  const lzcpg = data.lzChallengePassGroups;
  if ((!cpg || cpg.length === 0) && (!lzcpg || lzcpg.length === 0)) return '';

  const score = data.challengeResilienceScore;
  const scoreLabel = score !== undefined
    ? `${Math.round(score * 100)}%`
    : 'n/a';
  const scoreSentiment = score === undefined ? 'none'
    : score >= 0.9 ? 'pass' : score >= 0.7 ? 'warn' : 'fail';
  const scoreColour = scoreSentiment === 'pass' ? '#16a34a' : scoreSentiment === 'warn' ? '#d97706' : '#dc2626';

  function buildAgentRows(agents: typeof cpg, prefix: string): string {
    if (!agents || agents.length === 0) return '';
    return agents.map((pg) => {
      const legIds = Object.keys(pg.legs);
      const totalCalls = legIds.reduce((n, id) => n + (pg.legs[id]?.calls ?? 0), 0);
      const dnfCalls  = legIds.reduce((n, id) => n + (pg.legs[id]?.dnf ?? 0), 0);
      const passCount = totalCalls - dnfCalls;
      const agentLabel = pg.pass_id.replace(new RegExp(`^${prefix}-`), '').replace(/-/g, ' ');
      const agentIcon = dnfCalls === 0 ? '&#10003;' : dnfCalls < totalCalls ? '&#9651;' : '&#10007;';
      const agentColour = dnfCalls === 0 ? '#16a34a' : dnfCalls < totalCalls ? '#d97706' : '#dc2626';
      return `<tr>
      <td>${esc(agentLabel)}</td>
      <td class="pub-text-center" style="color:${esc(agentColour)};font-weight:700">${agentIcon} ${esc(String(passCount))}/${esc(String(totalCalls))}</td>
      <td class="pub-text-center">${esc(String(totalCalls))}</td>
      <td class="pub-text-center">${esc(String(dnfCalls))}</td>
    </tr>`;
    }).join('\n');
  }

  const c1Rows = buildAgentRows(cpg, 'C1');
  const c2Rows = buildAgentRows(lzcpg, 'C2');

  const c1Table = c1Rows ? `<h3 style="margin-top:1rem;margin-bottom:0.5rem;font-size:0.95rem">App Challenge Agents (C1)</h3>
  <div style="overflow-x:auto">
  <table class="swao-table swao-table--sm" aria-label="C1 challenge agent summary">
    <thead>
      <tr>
        <th>Challenge Agent</th>
        <th class="pub-text-center" title="Legs completed without DNF / total legs">Completed</th>
        <th class="pub-text-center">Total Legs</th>
        <th class="pub-text-center">DNF</th>
      </tr>
    </thead>
    <tbody>
      ${c1Rows}
    </tbody>
  </table>
  </div>` : '';

  const c2Table = c2Rows ? `<h3 style="margin-top:1.25rem;margin-bottom:0.5rem;font-size:0.95rem">LZ Challenge Agents (C2)</h3>
  <div style="overflow-x:auto">
  <table class="swao-table swao-table--sm" aria-label="C2 LZ challenge agent summary">
    <thead>
      <tr>
        <th>LZ Challenge Agent</th>
        <th class="pub-text-center" title="Legs completed without DNF / total legs">Completed</th>
        <th class="pub-text-center">Total Legs</th>
        <th class="pub-text-center">DNF</th>
      </tr>
    </thead>
    <tbody>
      ${c2Rows}
    </tbody>
  </table>
  </div>` : '';

  return `<section id="llm-challenge-results" class="swao-block swao-block--llm-challenge-results">
  <h2>Challenge Results</h2>
  <p class="pub-text-secondary pub-text-sm" style="margin-bottom:1rem">
    Adversarial stakeholder challenge prompts were run against each LLM leg's assessment
    findings (Enterprise feature). The resilience score measures the fraction of
    challenge agent-leg invocations that completed without failure.
  </p>
  <div style="margin-bottom:1.5rem;display:flex;align-items:center;gap:1.25rem">
    <div style="text-align:center;background:var(--surface-secondary,#f9fafb);border:1px solid var(--border,#e5e7eb);border-radius:0.5rem;padding:0.75rem 1.5rem">
      <div style="font-size:2rem;font-weight:800;color:${esc(scoreColour)}">${esc(scoreLabel)}</div>
      <div class="pub-text-secondary pub-text-sm" style="margin-top:0.25rem">Cross-leg resilience score</div>
    </div>
    <p class="pub-text-sm" style="margin:0;max-width:32rem">
      A score of 100% means every challenge agent completed successfully across all provider legs.
      Lower scores indicate legs where adversarial prompts exposed gaps or the challenge subprocess failed.
    </p>
  </div>
  ${c1Table}
  ${c2Table}
</section>`;
}
