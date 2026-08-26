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
 * Assessment blocks: cover, exec-summary, coverage-bar, seven-r-card, signal-list.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import type { PublicationModel, PubSignal, LZRSummary, BlockAssessmentItem } from '../model.js';
import {
  esc,
  sevBadge,
  pubCfg,
  linkifySignalRefs,
  swaoTableScript,
  renderChartDonut,
  renderChartSeverityBar,
  SEVEN_R_DESCRIPTIONS,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Block: cover
// ---------------------------------------------------------------------------

export function renderCover(model: PublicationModel): string {
  const meta = model.meta;
  const cfg = pubCfg(model);
  const engLeadLabel = cfg.engagement_lead_label ?? 'Engagement Lead';
  const sevenRLabel = model.summary.seven_r_label || '';
  const lzr = model.lzr as LZRSummary;
  const blockerCount = model.summary.blocker_count;

  const sevenRBadge = sevenRLabel
    ? `<span class="badge badge-7r pub-text-xs">${esc(sevenRLabel)}</span>`
    : '';

  // 3-state LZR badge from regions when available (#1299)
  type LZRRegionMin = { overall_verdict: string };
  const lzrRegions = (lzr as { regions?: LZRRegionMin[] }).regions;
  let lzrBadgeLabel = lzr.overall;
  if (lzrRegions && lzrRegions.length > 1) {
    const readyCount = lzrRegions.filter(
      r => r.overall_verdict === 'READY' || r.overall_verdict === 'READY_WITH_CHANGES',
    ).length;
    if (readyCount > 0 && readyCount < lzrRegions.length) {
      lzrBadgeLabel = `${readyCount} of ${lzrRegions.length} regions ready`;
    }
  }
  const lzrBadge = lzrBadgeLabel
    ? `<span class="lzr-conditional pub-text-2xs">${esc('LZR: ' + lzrBadgeLabel)}</span>`
    : '';

  const blockerBadge = blockerCount > 0
    ? `<a href="#signal-list" onclick="event.preventDefault();window.swaoScrollTo&&window.swaoScrollTo('signal-list');setTimeout(function(){var c=document.getElementById('signals-container');var chip=c&&c.querySelector('.filter-chip[data-filter-key=severity][data-filter-val=critical]');if(chip&&chip.getAttribute('aria-pressed')!=='true')chip.click();},400);return false;" class="pub-no-underline"><span class="blocker-pill" title="Click to view critical signals">${esc(blockerCount + ' blocker' + (blockerCount !== 1 ? 's' : ''))}</span></a>`
    : '';

  return `<section id="cover" class="swao-block swao-block--cover">
  <h2 id="cover-h" class="sr-only pub-sr-only" data-i18n-key="block.cover.sidebar_label">Overview</h2>
  <div class="pub-flex-row-tags">
    <h1 class="pub-m-0">${esc(meta.app_name)}</h1>
    ${sevenRBadge}${lzrBadge}${blockerBadge}
  </div>
  <p class="pub-text-sm-secondary-mb">
    <code>app_id: ${esc(meta.app_id)}</code> &nbsp;&middot;&nbsp;
    Assessed: <strong>${esc(meta.assessed_at)}</strong> &nbsp;&middot;&nbsp;
    Run: <strong>${esc(meta.run_id)}</strong> &nbsp;&middot;&nbsp;
    SWAO ${esc(meta.swao_version)}${meta.engagement.engagement_name ? ` &nbsp;&middot;&nbsp; Engagement: ${esc(meta.engagement.engagement_name)}` : ''}${(() => { const lead = (meta.engagement as { engagement_lead?: string }).engagement_lead || meta.engagement.partnership_lead; return lead ? ` &nbsp;&middot;&nbsp; ${esc(engLeadLabel)}: ${esc(lead)}` : ''; })()}${(meta.engagement as { account_executive?: string }).account_executive ? ` &nbsp;&middot;&nbsp; Account Executive: ${esc((meta.engagement as { account_executive?: string }).account_executive)}` : ''}
  </p>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: exec-summary
// ---------------------------------------------------------------------------

export function renderExecSummary(model: PublicationModel): string {
  const { blocker_count, top_findings, signal_counts, seven_r_label, coverage_score } = model.summary;
  const counts = signal_counts as Record<string, number>;
  const critCount = counts.critical ?? 0;
  const highCount = counts.high ?? 0;
  const mediumCount = counts.medium ?? 0;
  const totalFindings = critCount + highCount + mediumCount;

  // #1025: DEMO frameworks caveat -- surface sovereignty notice from LZR regions
  const lzrForExec = model.lzr as LZRSummary;
  const demoCaveatStatement = lzrForExec.regions?.find(
    r => r.sovereignty_statement && /demo/i.test(r.sovereignty_statement),
  )?.sovereignty_statement;
  const demoCaveatNotice = demoCaveatStatement
    ? `<div class="callout callout-warning pub-mb-3">
    <strong>Demonstration assessment notice:</strong> ${esc(demoCaveatStatement)}
  </div>`
    : '';

  // #1015: incomplete-assessment guard
  const isIncomplete = !seven_r_label || coverage_score === 0;
  const incompleteNotice = isIncomplete
    ? `<div class="callout callout-warning pub-mb-3">
    <strong>Assessment incomplete</strong> -- LLM analysis passes have not yet run.
    Run <code>swao assess</code> with a full pass profile to generate the migration disposition and coverage score.
  </div>`
    : '';

  // Narrative paragraph -- full SYNTH-01 derivation with signal ID hyperlinks (#1038)
  const sevenRLabel = seven_r_label || '';
  const sevenRDesc = sevenRLabel ? (SEVEN_R_DESCRIPTIONS[sevenRLabel] ?? '') : '';
  const synthVerdict = (model.signals as PubSignal[]).find((s: PubSignal) => s.id === 'SYNTH-01');
  const narrativeParts: string[] = [];
  if (sevenRLabel) {
    narrativeParts.push(`Recommended migration path: <strong>${esc(sevenRLabel)}</strong>${sevenRDesc ? ` -- ${esc(sevenRDesc)}` : '.'}`);
  } else if (!isIncomplete) {
    narrativeParts.push('Migration disposition has not yet been determined.');
  }
  if (synthVerdict?.derivation) {
    // Full text; linkify signal IDs (#1038)
    narrativeParts.push(linkifySignalRefs(synthVerdict.derivation, model));
  }
  const narrativeHtml = narrativeParts.length > 0
    ? `<p class="exec-narrative pub-lh-7 pub-mb-3">${narrativeParts.join(' ')}</p>`
    : '';

  // Severity donut (#1038): static SVG -- Critical/High/Medium segments
  function buildDonutSvg(): string {
    if (totalFindings === 0) return '';
    const r = 40;
    const cx = 50;
    const cy = 50;
    const circ = 2 * Math.PI * r;
    const segs: Array<{ pct: number; colour: string; label: string; count: number }> = [
      { pct: critCount / totalFindings, colour: 'var(--sev-critical,#dc2626)', label: 'Critical', count: critCount },
      { pct: highCount / totalFindings, colour: 'var(--sev-high,#f97316)', label: 'High', count: highCount },
      { pct: mediumCount / totalFindings, colour: 'var(--sev-medium,#d97706)', label: 'Medium', count: mediumCount },
    ];
    let offset = 0;
    const arcs = segs.filter(s => s.count > 0).map(s => {
      const dash = (s.pct * circ).toFixed(2);
      const gap = (circ - s.pct * circ).toFixed(2);
      const arc = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${s.colour}" stroke-width="18" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset * circ}" transform="rotate(-90,${cx},${cy})">
  <title>${s.label}: ${s.count}</title></circle>`;
      offset += s.pct;
      return arc;
    }).join('\n');
    const legend = segs.filter(s => s.count > 0).map(s =>
      `<span class="exec-donut-leg"><span style="background:${s.colour}" class="exec-donut-dot"></span>${esc(s.label)}: <strong>${s.count}</strong></span>`
    ).join('');
    return `<div class="exec-donut-wrap">
  <svg viewBox="0 0 100 100" width="100" height="100" aria-label="Severity distribution" role="img">
    <circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="var(--bg-dark,#f1f5f9)" stroke-width="18"/>
    ${arcs}
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="var(--text-primary,#111827)">${totalFindings}</text>
  </svg>
  <div class="exec-donut-legend">${legend}</div>
</div>`;
  }

  // Top-5 blockers list (#1038) with "View all" expand
  const TOP_N = 5;
  const topBlockers = top_findings.slice(0, TOP_N);
  const remainingCount = top_findings.length - TOP_N;
  const blockerItems = topBlockers.map((f: PubSignal, i: number) => {
    const tooltip = esc(f.derivation.substring(0, 150));
    return `  <li class="exec-blocker-item">
    <span class="exec-blocker-rank">${i + 1}</span>
    ${sevBadge(f.severity)}
    <a href="#signal-${esc(f.id)}" class="pub-mono-bold-base exec-blocker-id" title="${tooltip}">${esc(f.id)}</a>
    <span class="exec-blocker-desc">${esc(f.derivation.substring(0, 120))}${f.derivation.length > 120 ? '...' : ''}</span>
  </li>`;
  }).join('\n');

  const remainingItems = top_findings.slice(TOP_N).map((f: PubSignal) => {
    return `  <li class="exec-blocker-item exec-blocker-item--hidden">
    ${sevBadge(f.severity)}
    <a href="#signal-${esc(f.id)}" class="pub-mono-bold-base exec-blocker-id">${esc(f.id)}</a>
    <span class="exec-blocker-desc">${esc(f.derivation.substring(0, 120))}${f.derivation.length > 120 ? '...' : ''}</span>
  </li>`;
  }).join('\n');

  const viewAllToggle = remainingCount > 0
    ? `<details class="exec-blocker-more">
  <summary class="exec-blocker-more-toggle">View all ${top_findings.length} blockers</summary>
  <ol class="exec-blocker-list exec-blocker-list--extra" start="${TOP_N + 1}">
${remainingItems}
  </ol>
</details>`
    : '';

  const blockerSection = top_findings.length > 0 ? `
<div class="exec-blockers-section">
  <h3 class="exec-blockers-title">Top priority items</h3>
  <ol class="exec-blocker-list">
${blockerItems}
  </ol>
  ${viewAllToggle}
</div>` : '';

  // #0521: blocker count links to critical severity filter in signal-list
  const blockerOnclick = `event.preventDefault();window.swaoScrollTo&&window.swaoScrollTo('signal-list');setTimeout(function(){var c=document.getElementById('signals-container');var chip=c&&c.querySelector('.filter-chip[data-filter-key=severity][data-filter-val=critical]');if(chip&&chip.getAttribute('aria-pressed')!=='true')chip.click();},400);return false;`;
  const blockerCallout = blocker_count > 0
    ? `<div class="callout callout-critical pub-mb-3">
    <strong><span data-i18n-key="block.exec_summary.callout_critical" data-i18n-count="${blocker_count}"><a href="#signal-list" onclick="${blockerOnclick}" class="pub-color-inherit">${esc(String(blocker_count))} critical finding${blocker_count !== 1 ? 's' : ''}</a> require resolution before migration.</span></strong>
  </div>` : '';

  const donutHtml = totalFindings > 0 ? buildDonutSvg() : '';

  return `<section id="exec-summary" class="swao-block swao-block--exec-summary">
  <h2 id="exec-summary-h" data-i18n-key="block.exec_summary.title">Executive Summary</h2>
  ${demoCaveatNotice}
  ${incompleteNotice}
  ${narrativeHtml}
  ${blockerCallout}
  <div class="exec-summary-body">
    ${donutHtml}
    ${blockerSection}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: coverage-bar
// ---------------------------------------------------------------------------

export function renderCoverageBar(model: PublicationModel, donutOpts?: Record<string, string>, sevBarOpts?: Record<string, string>): string {
  const score = model.summary.coverage_score;
  const pct = Math.round(score * 100);
  const counts = model.summary.signal_counts;

  const donutHtml = renderChartDonut(pct, score, donutOpts);
  const sevBarHtml = renderChartSeverityBar(counts as Record<string, number>, sevBarOpts);

  return `<section id="coverage-bar" class="swao-block swao-block--coverage-bar">
  <h2 id="coverage-bar-h" data-i18n-key="block.coverage_bar.title">Coverage</h2>
  <div class="coverage-widget">
    ${donutHtml}
    <div class="coverage-details">
      <div class="coverage-percent">${pct}%</div>
      <div class="coverage-label" data-i18n-key="block.coverage_bar.score_label">Assessment Coverage Score</div>
      <div class="coverage-subtext">
        ${pct}% of assessment passes returned signals.
        <span data-i18n-key="block.coverage_bar.score_desc">Low coverage may indicate missing import artefacts.</span>
      </div>
    </div>
  </div>
  ${sevBarHtml}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: seven-r-card
// ---------------------------------------------------------------------------

export function renderSevenRCard(model: PublicationModel): string {
  const label = model.summary.seven_r_label;
  const description =
    SEVEN_R_DESCRIPTIONS[label] ??
    'Migration strategy derived from assessment findings.';

  // Collect rationale from SYNTH signals (LLM synthesis pass)
  const synthSignals = model.signals.filter((s: PubSignal) => s.id.startsWith('SYNTH-'));
  const synthVerdict   = synthSignals.find((s: PubSignal) => s.id === 'SYNTH-01');
  const synthConstraint = synthSignals.find((s: PubSignal) => s.id === 'SYNTH-03');

  // Key signals driving the decision (highest severity non-positive)
  const drivingSignals = model.signals
    .filter((s: PubSignal) => s.outcome === 'negative' && ['critical','high'].includes(s.severity ?? ''))
    .slice(0, 5);

  const rationale = synthVerdict?.derivation ?? '';
  const constraints = synthConstraint?.derivation ?? '';

  const drivingHtml = drivingSignals.length > 0
    ? `<div class="pub-mt-4">
        <p class="pub-section-label" data-i18n-key="block.seven_r_card.key_findings">Key findings driving this classification</p>
        <ul class="pub-list-tight">
          ${drivingSignals.map((s: PubSignal) =>
            `<li><strong>${esc(s.id)}</strong> [${esc(s.severity ?? '')}] -- ${esc(s.derivation.slice(0, 120))}${s.derivation.length > 120 ? '...' : ''}
             <a href="#signal-${esc(s.id)}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(s.id)}');return false;" class="pub-text-accent-sm">View signal</a></li>`
          ).join('')}
        </ul>
      </div>`
    : '';

  const rationaleHtml = rationale
    ? `<div class="pub-panel-note-mt">${linkifySignalRefs(rationale, model)}</div>`
    : '';

  const constraintHtml = constraints
    ? `<div class="pub-subtext-lg-mt"><strong data-i18n-key="block.seven_r_card.key_constraint">Key constraint:</strong> ${linkifySignalRefs(constraints, model)}</div>`
    : '';

  const scoreHtml = model.summary.coverage_score != null
    ? `<div class="pub-subtext-lg-mt">
         <span data-i18n-key="block.seven_r_card.coverage">Coverage score</span>: <strong>${Math.round((model.summary.coverage_score as number) * 100)}%</strong>
         &nbsp;&middot;&nbsp;
         <span data-i18n-key="block.seven_r_card.confidence">Confidence</span>: <strong>${esc(model.summary.confidence ?? 'unknown')}</strong>
       </div>` : '';

  return `<section id="seven-r-card" class="swao-block swao-block--seven-r-card">
  <h2 id="seven-r-card-h" data-i18n-key="block.seven_r_card.title">Migration Strategy</h2>
  <div class="seven-r-card pub-card">
    <div class="pub-flex-row-gap">
      <span class="badge badge-7r pub-badge-7r-lg">${esc(label)}</span>
      <span class="pub-text-base-bold">${esc(description)}</span>
    </div>
    ${scoreHtml}
    ${rationaleHtml}
    ${constraintHtml}
    ${drivingHtml}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: signal-list
// ---------------------------------------------------------------------------

export function renderSignalList(model: PublicationModel, params: Record<string, string>, tableOpts?: Record<string, string>): string {
  // Optional server-side severity filter: params.filter = "critical" | "high" | "critical,high"
  const filterSevs = params.filter
    ? params.filter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const signals = filterSevs
    ? model.signals.filter((s: PubSignal) => filterSevs.includes(s.severity?.toLowerCase() ?? ''))
    : model.signals;
  const rows = signals.map((s: PubSignal) => ({
    id: s.id,
    severity: s.severity,
    outcome: s.outcome,
    pass: s.pass,
    derivation: s.derivation.substring(0, 300),
    tags: s.tags.join(', '),
    evidence: s.evidence_refs.join(', '),
    // #0819: pre-built HTML pill links for evidence items in the expand panel.
    evidence_html: s.evidence_refs.length > 0
      ? s.evidence_refs.map(evId =>
          `<a href="#evidence-${esc(evId)}" class="pub-ctrl-tag">${esc(evId)}</a>`
        ).join(' ')
      : '<span class="pub-text-xs-muted">none</span>',
    anchor: s.anchor,
    implies: s.implies.join('; '),
    full_derivation: s.derivation,
    implies_hint: [
      s.implies.length > 0 ? `Implies: ${s.implies.join(', ')}` : '',
      s.tags.length > 0 ? `Tags: ${s.tags.join(', ')}` : '',
    ].filter(Boolean).join('  |  '),
  }));

  const severityValues = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];

  return `<section id="signal-list" class="swao-block swao-block--signal-list">
  <h2 id="signal-list-h" data-i18n-key="block.signal_list.title">Signals</h2>
  ${swaoTableScript('signals', {
    caption: 'Assessment signals',
    rowIdField: 'id', rowIdPrefix: 'signal-',
    exportCsv: true,
    columns: [
      { id: 'id', label: 'ID', field: 'id', type: 'text', render: 'signal-id-cell', sortable: true },
      {
        id: 'severity', label: 'Severity', field: 'severity', type: 'text',
        render: 'severity-badge', sortable: true,
        filterable: true, filterType: 'chips', filterValues: severityValues,
        labelI18nKey: 'block.signal_list.col_severity',
        filterValueI18nPrefix: 'severity',
      },
      {
        id: 'outcome', label: 'Outcome', field: 'outcome', type: 'text',
        render: 'outcome-icon', sortable: true,
        filterable: true, filterType: 'chips', filterValues: ['positive', 'negative', 'informational'],
        labelI18nKey: 'block.signal_list.col_outcome',
        filterValueI18nPrefix: 'outcome',
      },
      { id: 'pass', label: 'Pass', field: 'pass', type: 'text', sortable: true },
      { id: 'derivation', label: 'Derivation', field: 'derivation', type: 'text', sortable: false },
      { id: 'tags', label: 'Tags', field: 'tags', type: 'text', render: 'tag-chips', sortable: false },
      { id: 'evidence', label: 'Evidence', field: 'evidence', type: 'text', sortable: false },
    ],
    rows,
    expandTemplate:
      '<div class="pub-section-text">' +
      '<div><span class="pub-label-bold">Full Derivation:</span> {{full_derivation}}</div>' +
      '<div class="pub-text-xs-secondary-mt3">{{implies_hint}}</div>' +
      '<div class="pub-mt-2"><span class="pub-label-bold">Evidence:</span> {{{evidence_html}}}</div>' +
      '</div>',
    defaultSort: [{ field: 'severity', dir: 'asc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: quick-nav (#1034)
// ---------------------------------------------------------------------------

const QUICK_NAV_CARDS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'exec-summary', label: 'Executive Summary', icon: '&#9733;' },
  { id: 'signal-list', label: 'Signals', icon: '&#9888;' },
  { id: 'compliance-regime', label: 'Compliance', icon: '&#10003;' },
  { id: 'risk-register', label: 'Risk Register', icon: '&#9760;' },
  { id: 'evidence-gallery', label: 'Evidence', icon: '&#128196;' },
  { id: 'lzr-summary', label: 'Landing Zones', icon: '&#9881;' },
];

export function renderQuickNav(model: PublicationModel): string {
  const critCount = (model.summary.signal_counts as Record<string, number>).critical ?? 0;
  const highCount = (model.summary.signal_counts as Record<string, number>).high ?? 0;
  const blockerBadge = (critCount + highCount) > 0
    ? ` <span class="pub-badge-sm sev-critical">${critCount + highCount}</span>`
    : '';
  const cards = QUICK_NAV_CARDS.map(c => {
    const badge = c.id === 'signal-list' ? blockerBadge : '';
    return `<a href="#${c.id}" class="pub-qnav-card">
  <span class="pub-qnav-icon" aria-hidden="true">${c.icon}</span>
  <span class="pub-qnav-label">${esc(c.label)}${badge}</span>
</a>`;
  }).join('\n');
  void model;
  return `<section id="quick-nav" class="swao-block swao-block--quick-nav" aria-label="Quick navigation" data-sidebar-exclude="true">
  <div class="pub-grid-quick-nav">
${cards}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: block-scorecard (#1359)
// ---------------------------------------------------------------------------

const BLOCK_DISPLAY_NAMES: Record<string, string> = {
  observability:         'Observability',
  licence_compliance:    'Licence Compliance',
  testing_maturity:      'Testing Maturity',
  architecture_assessment: 'Architecture',
  database_assessment:   'Database',
  integration_assessment: 'Integration',
  iam_assessment:        'IAM',
  dr_assessment:         'Disaster Recovery',
};

function blockOutcomeBadge(outcome: BlockAssessmentItem['overall_outcome']): string {
  const map: Record<string, string> = {
    SATISFIED: '<span class="pub-badge-sm" style="background:var(--colour-positive-bg,#d4edda);color:var(--colour-positive-fg,#155724)">SATISFIED</span>',
    PARTIAL:   '<span class="pub-badge-sm sev-medium">PARTIAL</span>',
    GAP:       '<span class="pub-badge-sm sev-high">GAP</span>',
    UNKNOWN:   '<span class="pub-badge-sm sev-informational">UNKNOWN</span>',
    N_A:       '<span class="pub-badge-sm sev-informational">N/A</span>',
  };
  return map[outcome] ?? `<span class="pub-badge-sm">${esc(outcome)}</span>`;
}

export function renderBlockScorecard(model: PublicationModel): string {
  const blocks = (model as unknown as { blocks?: BlockAssessmentItem[] }).blocks;
  if (!blocks || blocks.length === 0) {
    return `<section id="block-scorecard" class="swao-block swao-block--block-scorecard">
  <h2 id="block-scorecard-h">Block Assessment Scorecard</h2>
  <p class="pub-text-secondary-faded">Block assessment data not available. Run pass 12 (block assessments) to generate scores.</p>
</section>`;
  }

  const rows = blocks.map(b => {
    const displayName = BLOCK_DISPLAY_NAMES[b.name] ?? b.name.replace(/_/g, ' ');
    const scorePct = Math.round(b.score * 100);
    const threshPct = Math.round(b.threshold * 100);
    const signalChips = b.key_signals.length > 0
      ? b.key_signals.map(s => `<code class="pub-inline-code">${esc(s)}</code>`).join(' ')
      : '<span class="pub-text-secondary-faded">none</span>';
    const scoreBar = `<div class="swao-progress" role="progressbar" aria-valuenow="${scorePct}" aria-valuemax="100" aria-label="${scorePct}% (threshold ${threshPct}%)">
        <div class="swao-progress__fill" style="width:${scorePct}%"></div>
      </div>
      <span class="pub-text-xs pub-text-secondary-faded">${scorePct}% / ${threshPct}% threshold</span>`;
    return `<tr>
      <td class="pub-td-mid-left"><strong>${esc(displayName)}</strong></td>
      <td class="pub-td-mid-left">${blockOutcomeBadge(b.overall_outcome)}</td>
      <td class="pub-td-mid-left" style="min-width:160px">${scoreBar}</td>
      <td class="pub-td-mid-left pub-text-sm">${esc(b.overall_rationale)}</td>
      <td class="pub-td-mid-left">${signalChips}</td>
    </tr>`;
  }).join('\n');

  const satisfiedCount = blocks.filter(b => b.overall_outcome === 'SATISFIED').length;
  const gapCount = blocks.filter(b => b.overall_outcome === 'GAP').length;
  const partialCount = blocks.filter(b => b.overall_outcome === 'PARTIAL').length;

  return `<section id="block-scorecard" class="swao-block swao-block--block-scorecard">
  <h2 id="block-scorecard-h">Block Assessment Scorecard</h2>
  <p class="pub-meta-text-sm">${esc(String(satisfiedCount))} satisfied &nbsp;&middot;&nbsp; ${esc(String(partialCount))} partial &nbsp;&middot;&nbsp; ${esc(String(gapCount))} gap${gapCount !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; ${esc(String(blocks.length))} blocks assessed</p>
  <div style="overflow-x:auto">
    <table class="pub-table">
      <thead>
        <tr class="pub-tr-primary">
          <th class="pub-td-mid-left">Block</th>
          <th class="pub-td-mid-left">Outcome</th>
          <th class="pub-td-mid-left">Score</th>
          <th class="pub-td-mid-left">Rationale</th>
          <th class="pub-td-mid-left">Key Signals</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
}
