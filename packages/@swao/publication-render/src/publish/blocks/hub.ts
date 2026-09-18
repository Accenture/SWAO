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
 * Hub and portfolio blocks: hub.header, hub.app_list, hub.cross_links,
 * hub.workspace_summary, stakeholder-challenge, portfolio-grid.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import type { PublicationModel, FrameworkResult } from '../model.js';
import { esc, sevBadge } from './helpers.js';

// ---------------------------------------------------------------------------
// Hub types
// ---------------------------------------------------------------------------

export interface HubEntry {
  app_id: string;
  app_name: string;
  assessment_types: string[];
  pub_links: Record<string, string>; // type -> relative href
}

// Human-readable labels for assessment type keys used in pub_links and assessment_types.
const ASSESSMENT_TYPE_LABEL: Record<string, string> = {
  'application':    'Application Assessment',
  'lz':             'Landing Zone Assessment',
  'llm-assessment': 'LLM Assessment',
  'llm':            'LLM Assessment',
};

type HubExtension = {
  hub?: {
    entries?: HubEntry[];
    workspace_path?: string;
    last_updated?: string;
  };
};

// ---------------------------------------------------------------------------
// Block: hub.header
// ---------------------------------------------------------------------------

export function renderHubHeader(model: PublicationModel): string {
  const hub = (model as unknown as HubExtension).hub;
  const appName = model.meta.app_name;
  const assessedAt = model.meta.assessed_at ?? '';
  const wsPath = hub?.workspace_path ?? '';
  const subtitle = [
    appName && appName !== 'Workspace' ? appName : '',
    wsPath,
    assessedAt ? `Last updated: ${assessedAt.split('T')[0] ?? assessedAt}` : '',
  ].filter(Boolean).join(' &middot; ');
  return `<section id="hub-header" class="swao-block swao-block--hub-header">
  <h1 class="pub-text-xxl-mb">Engagement Hub</h1>
  ${subtitle ? `<p class="pub-text-secondary-no-margin">${subtitle}</p>` : ''}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: hub.app_list
// ---------------------------------------------------------------------------

export function renderHubAppList(model: PublicationModel): string {
  const hub = (model as unknown as HubExtension).hub;
  const entries = hub?.entries ?? [];
  if (entries.length === 0) {
    return `<section id="hub-app-list" class="swao-block swao-block--hub-app-list">
  <h2>Applications</h2>
  <p class="pub-text-secondary">No assessed applications found in this workspace.</p>
</section>`;
  }
  const cards = entries.map(e => {
    const typesJoined = e.assessment_types.join(',');
    const typeLabels = e.assessment_types.map(t => ASSESSMENT_TYPE_LABEL[t] ?? t).join(',');
    const typeBadges = e.assessment_types
      .map(t => {
        const href = e.pub_links[t];
        const label = ASSESSMENT_TYPE_LABEL[t] ?? t;
        return href
          ? `<a href="${esc(href)}" class="pub-tag-pill" title="${esc('Open ' + label)}">${esc(label)}</a>`
          : `<span class="pub-tag-pill pub-tag-pill--pending" title="${esc('Publish ' + label + ' report to view')}">${esc(label)}</span>`;
      })
      .join('');
    return `<div class="swao-card pub-card hub-app-card" data-name="${esc(e.app_name || e.app_id)}" data-appid="${esc(e.app_id)}" data-types="${esc(typesJoined)}" data-labels="${esc(typeLabels)}">
    <div class="hub-app-card__header pub-mb-2">
      <div class="app-card__name pub-heading-base">${esc(e.app_name || e.app_id)}</div>
      <div class="pub-text-2xs-secondary">app_id: <code>${esc(e.app_id)}</code></div>
    </div>
    <div class="pub-ctrl-tags pub-mb-2">${typeBadges}</div>
  </div>`;
  }).join('\n');

  const searchScript = `<script>
(function(){
  var input = document.getElementById('hub-app-search');
  if (!input) return;
  input.addEventListener('input', function() {
    var q = input.value.trim().toLowerCase();
    var cards = document.querySelectorAll('.hub-app-card');
    cards.forEach(function(c) {
      var name = (c.getAttribute('data-name') || '').toLowerCase();
      var appid = (c.getAttribute('data-appid') || '').toLowerCase();
      var types = (c.getAttribute('data-types') || '').toLowerCase();
      var labels = (c.getAttribute('data-labels') || '').toLowerCase();
      c.style.display = (!q || name.includes(q) || appid.includes(q) || types.includes(q) || labels.includes(q)) ? '' : 'none';
    });
    var visible = Array.from(cards).filter(c => c.style.display !== 'none').length;
    var counter = document.getElementById('hub-search-count');
    if (counter) counter.textContent = q ? visible + ' of ' + cards.length + ' shown' : '';
  });
})();
</script>`;

  return `<section id="hub-app-list" class="swao-block swao-block--hub-app-list">
  <h2>Applications</h2>
  <div class="hub-search-row pub-mb-3">
    <input id="hub-app-search" type="search" class="hub-search-input" placeholder="Filter by name, app-id, or assessment type..." aria-label="Filter applications">
    <span id="hub-search-count" class="pub-text-2xs-secondary hub-search-count" aria-live="polite"></span>
  </div>
  <div class="hub-app-list__grid">
${cards}
  </div>
  ${searchScript}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: hub.cross_links
// ---------------------------------------------------------------------------

export function renderHubCrossLinks(_model: PublicationModel): string {
  return '';
}

// ---------------------------------------------------------------------------
// Block: hub.workspace_summary
// ---------------------------------------------------------------------------

export function renderHubWorkspaceSummary(model: PublicationModel): string {
  const hub = (model as unknown as HubExtension).hub;
  const entries = hub?.entries ?? [];
  const totalApps = entries.length;
  const allTypes = new Set<string>();
  entries.forEach(e => e.assessment_types.forEach(t => allTypes.add(t)));
  const totalPubLinks = entries.reduce((sum, e) => sum + Object.keys(e.pub_links).length, 0);
  const lastUpdated = hub?.last_updated
    ? hub.last_updated.split('T')[0] ?? hub.last_updated
    : null;
  return `<section id="hub-workspace-summary" class="swao-block swao-block--hub-workspace-summary">
  <h2>Workspace Summary</h2>
  ${lastUpdated ? `<p class="pub-text-secondary-no-margin pub-mb-3">Last updated: ${esc(lastUpdated)}</p>` : ''}
  <div class="pub-flex-3col-mt">
    <div class="pub-text-center">
      <div class="pub-num-2xl-primary">${totalApps}</div>
      <div class="pub-text-xs-secondary">Applications</div>
    </div>
    <div class="pub-text-center">
      <div class="pub-num-2xl-primary">${allTypes.size}</div>
      <div class="pub-text-xs-secondary">Assessment Types</div>
    </div>
    <div class="pub-text-center">
      <div class="pub-num-2xl-primary">${totalPubLinks}</div>
      <div class="pub-text-xs-secondary">Publications</div>
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: stakeholder-challenge (#0920)
// ---------------------------------------------------------------------------

export function renderChallengeBlock(model: PublicationModel): string {
  const reports = model.challenge;
  if (!reports || reports.length === 0) {
    return `<section id="stakeholder-challenge" class="pub-block">
  <h2>Stakeholder Challenge</h2>
  <p class="empty-state">No challenge reports found. Run <code>swao challenge --all-agents --report</code> to generate them.</p>
</section>`;
  }

  const AGENT_LABELS: Record<string, string> = {
    'application-architect': 'Application Architect',
    'business-owner': 'Business Owner',
    'grc-compliance-officer': 'GRC / Compliance Officer',
    'finops-lead': 'FinOps Lead',
    'programme-manager': 'Programme / Migration Manager',
  };

  const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  const panels = reports.map((rpt, idx) => {
    const agentLabel = AGENT_LABELS[rpt.agent_id] ?? rpt.agent_id;
    const overallSev = (rpt.severity_overall ?? '').toUpperCase();
    const sevCls = ({ CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' } as Record<string,string>)[overallSev] ?? 'badge-neutral';
    const sevBadgeHtml = overallSev
      ? `<span class="badge ${sevCls}">${esc(overallSev)}</span>`
      : '';
    const reviewedAt = rpt.reviewed_at ? ` - ${esc(rpt.reviewed_at.slice(0, 10))}` : '';
    const stripDashes = (s: string) => s.replace(/—/g, ' - ').replace(/–/g, ' - ');
    const opening = rpt.opening_statement ? `<p class="challenge-opening">${esc(stripDashes(rpt.opening_statement))}</p>` : '';

    const findings = [...(rpt.findings ?? [])]
      .sort((a, b) => (SEV_ORDER[a.severity?.toUpperCase() ?? ''] ?? 99) - (SEV_ORDER[b.severity?.toUpperCase() ?? ''] ?? 99));

    const findingRows = findings.map(f => {
      const fSevCls = ({ CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' } as Record<string,string>)[f.severity?.toUpperCase() ?? ''] ?? 'badge-neutral';
      return `<tr>
        <td class="pub-nowrap"><code>${esc(f.id)}</code></td>
        <td><span class="badge ${fSevCls}">${esc((f.severity ?? '').toUpperCase())}</span></td>
        <td>${esc(f.concern)}</td>
        <td>${esc(f.evidence_gap)}</td>
        <td class="pub-italic">${esc(f.recommended_question)}</td>
      </tr>`;
    }).join('\n');

    const findingsTable = findings.length > 0 ? `
<table class="swao-table pub-mt-3">
  <thead>
    <tr>
      <th>ID</th><th>Severity</th><th>Concern</th><th>Evidence Gap</th><th>Recommended Question</th>
    </tr>
  </thead>
  <tbody>${findingRows}</tbody>
</table>` : '<p class="empty-state">No findings recorded.</p>';

    const nextStep = rpt.next_step ? `<p class="challenge-next-step"><strong>Next step:</strong> ${esc(stripDashes(rpt.next_step))}</p>` : '';
    const panelId = `challenge-panel-${idx}`;

    return `<details class="challenge-panel" id="challenge-${esc(rpt.agent_id)}">
  <summary class="challenge-summary">
    <span class="challenge-agent-label">${esc(agentLabel)}</span>
    ${sevBadgeHtml}
    <span class="challenge-meta">${esc(String(findings.length))} finding${findings.length !== 1 ? 's' : ''}${reviewedAt}</span>
  </summary>
  <div class="challenge-body" id="${panelId}">
    ${opening}
    ${findingsTable}
    ${nextStep}
  </div>
</details>`;
  });

  return `<section id="stakeholder-challenge" class="pub-block">
  <h2>Stakeholder Challenge</h2>
  <p class="pub-text-secondary-mb2">
    Each agent reviewed the Workload Sovereignty Profile from their stakeholder perspective.
    Use the recommended questions as a pre-flight checklist before the client review meeting.
  </p>
  ${panels.join('\n  ')}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: portfolio-grid + renderAppCard (exported for portal use)
// ---------------------------------------------------------------------------

/**
 * Render a single app card for the portfolio grid. Extracted from
 * renderPortfolioGrid (#0582) so the HTML Portal index can compose N cards in
 * one grid while the single-app portfolio-grid block stays byte-identical (it
 * calls this once). The card markup + classes are unchanged, so portal cards
 * match the publication's card styling exactly (Design 058 D-PORTAL-4).
 */
export function renderAppCard(model: PublicationModel, viewHref: string): string {
  const { app_name, app_id } = model.meta;
  const { seven_r_label, signal_counts, coverage_score } = model.summary;

  const _pct = Math.round(coverage_score * 100);
  const donutCircumference = 2 * Math.PI * 28;
  const donutDash = (coverage_score * donutCircumference).toFixed(2);

  // Donut SVG (70x70, r=28)
  const donutSvg = `<svg width="70" height="70" viewBox="0 0 70 70" aria-hidden="true">
        <circle cx="35" cy="35" r="28" fill="none" stroke="var(--border)" stroke-width="9"/>
        <circle cx="35" cy="35" r="28" fill="none"
          stroke="#f97316" stroke-width="9"
          stroke-dasharray="${donutDash} ${donutCircumference.toFixed(2)}"
          stroke-linecap="round"
          transform="rotate(-90 35 35)"/>
        <text x="35" y="39" text-anchor="middle" font-size="13" font-weight="800" fill="var(--text-primary)">${_pct}%</text>
      </svg>`;

  const sevBadges = Object.entries(signal_counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${sevBadge(k)} ${esc(v)}`)
    .join(' ');

  // Mini RAG bar
  const totalFail = (model.compliance as FrameworkResult[]).reduce((a, f) => a + f.fail_count, 0);
  const totalPartial = (model.compliance as FrameworkResult[]).reduce((a, f) => a + f.partial_count, 0);
  const totalPass = (model.compliance as FrameworkResult[]).reduce((a, f) => a + f.pass_count, 0);
  const totalControls = totalFail + totalPartial + totalPass;

  const miniRagBar = totalControls > 0
    ? `<div class="mini-rag-bar pub-rag-bar-mt">
        ${totalFail > 0 ? `<div class="mini-rag-bar__seg seg-fail" style="--bar-flex:${totalFail}" class="pub-bar-seg-fail"></div>` : ''}
        ${totalPartial > 0 ? `<div class="mini-rag-bar__seg seg-partial" style="--bar-flex:${totalPartial}" class="pub-bar-seg-partial"></div>` : ''}
        ${totalPass > 0 ? `<div class="mini-rag-bar__seg seg-pass" style="--bar-flex:${totalPass}" class="pub-bar-seg-pass"></div>` : ''}
      </div>` : '';

  return `<div class="swao-card pub-card">
      <div class="app-card__meta pub-flex-row-gap">
        ${donutSvg}
        <div>
          <div class="app-card__name pub-heading-base">${esc(app_name)}</div>
          <div class="pub-text-2xs-secondary">app_id: <code>${esc(app_id)}</code></div>
          <span class="badge badge-7r pub-text-xxs-mt">${esc(seven_r_label)}</span>
        </div>
      </div>
      <div class="pub-ctrl-tags">${sevBadges}</div>
      ${miniRagBar}
      <div class="app-card__link pub-mt-3">
        <a href="${viewHref}" data-i18n-key="block.portfolio_grid.view_app">View Assessment</a>
      </div>
    </div>`;
}

export function renderPortfolioGrid(model: PublicationModel, params: Record<string, string>): string {
  const viewHref = params.siteAppHref || '#exec-summary';

  return `<section id="portfolio-grid" class="swao-block swao-block--portfolio-grid">
  <h2 id="portfolio-grid-h" data-i18n-key="block.portfolio_grid.title">Portfolio</h2>
  <div class="card-grid pub-grid-280">
    ${renderAppCard(model, viewHref)}
  </div>
</section>`;
}
