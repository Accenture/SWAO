// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer -- shared helper utilities
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Shared helper utilities for publication block rendering.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import type { PublicationModel, PubSignal, FrameworkResult } from '../model.js';

// ---------------------------------------------------------------------------
// PublicationConfig -- assumed added by parallel agent; accessed via narrow cast
// ---------------------------------------------------------------------------

export interface PublicationConfig {
  classification_band?: string;
  logo_name?: string;
  logo_sub?: string;
  footer_note?: string;
  engagement_lead_label?: string;
  github_url?: string;
  docs_url?: string;
}

/** Safe accessor -- compiles whether or not the parallel agent has landed yet */
export function pubCfg(model: PublicationModel): Partial<PublicationConfig> {
  return (
    (model.meta as unknown as { publication_config?: Partial<PublicationConfig> })
      .publication_config ?? {}
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sevBadge(severity: string): string {
  const cls =
    ({
      critical: 'badge-critical',
      high: 'badge-high',
      medium: 'badge-medium',
      low: 'badge-low',
      informational: 'badge-info',
      positive: 'badge-positive',
    } as Record<string, string>)[severity] ?? 'badge-neutral';
  const label = severity
    ? severity.charAt(0).toUpperCase() + severity.slice(1)
    : '';
  return `<span class="badge ${cls}" data-i18n-key="severity.${esc(severity)}">${esc(label)}</span>`;
}

export function ragChip(status: string): string {
  const cls =
    ({ pass: 'rag-pass', partial: 'rag-partial', fail: 'rag-fail', 'not-assessed': 'rag-not-assessed' } as Record<
      string,
      string
    >)[status] ?? '';
  const label = status === 'not-assessed' ? 'Not assessed' : (status ? status.charAt(0).toUpperCase() + status.slice(1) : '');
  return `<span class="rag ${cls}" data-i18n-key="rag.${esc(status)}">${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Component: swao-rag-badge (Design 068 §20.9 Step 6)
// Formalised alias for ragChip. opts.show_text=false suppresses verdict label.
// ---------------------------------------------------------------------------

export function swaoRagBadge(verdict: string, opts?: Record<string, string>): string {
  const showText = opts?.show_text !== 'false';
  const cls =
    ({ pass: 'rag-pass', partial: 'rag-partial', fail: 'rag-fail', 'not-assessed': 'rag-not-assessed' } as Record<string, string>)[verdict] ?? '';
  const label = verdict === 'not-assessed' ? 'Not assessed' : (verdict ? verdict.charAt(0).toUpperCase() + verdict.slice(1) : '');
  return `<span class="rag ${cls}" data-i18n-key="rag.${esc(verdict)}">${showText ? esc(label) : ''}</span>`;
}

// ---------------------------------------------------------------------------
// Component: swao-progress-bar (Design 068 §20.9 Step 6)
// ---------------------------------------------------------------------------

export function swaoProgressBar(value: number, max: number, _opts?: Record<string, string>): string {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<div class="swao-progress" role="progressbar" aria-valuenow="${value}" aria-valuemax="${max}" aria-label="${value} of ${max}"><div class="swao-progress__fill" style="width:${pct}%"></div></div>`;
}

// ---------------------------------------------------------------------------
// Component: swao-tooltip (Design 068 §20.9 Step 5)
// ---------------------------------------------------------------------------

export function swaoTooltip(trigger: string, content: string): string {
  return `<span class="swao-tooltip" role="tooltip" tabindex="0">${trigger}<span class="swao-tooltip__body">${content}</span></span>`;
}

// ---------------------------------------------------------------------------
// Component: swao-tiles-compliance (Design 068 §20.9 Step 2)
// Extracted from renderComplianceRegime. columns opt: 2-4 (default 3).
// show_controls opt: toggle control count link per tile.
// ---------------------------------------------------------------------------

export function renderComplianceTileGrid(
  frameworks: FrameworkResult[],
  opts?: Record<string, string>,
): string {
  const cols = Math.min(4, Math.max(2, parseInt(opts?.columns ?? '3', 10) || 3));
  const showControls = opts?.show_controls !== 'false';
  const gridClass = `pub-grid-${cols}col-mb`;

  const tiles = frameworks.map(fw => {
    const notAssessedCount = fw.not_assessed_count ?? 0;
    const assessedTotal = fw.fail_count + fw.partial_count + fw.pass_count;
    const total = assessedTotal + notAssessedCount;
    const pctFail        = total > 0 ? Math.round((fw.fail_count / total) * 100) : 0;
    const pctPartial     = total > 0 ? Math.round((fw.partial_count / total) * 100) : 0;
    const pctPass        = total > 0 ? Math.round((fw.pass_count / total) * 100) : 0;
    const pctNotAssessed = total > 0 ? 100 - pctFail - pctPartial - pctPass : 0;
    const dominant = fw.fail_count > 0 ? 'fail' : fw.partial_count > 0 ? 'partial' : fw.pass_count > 0 ? 'pass' : 'not-assessed';
    const borderVar = dominant === 'fail' ? 'var(--rag-fail)' : dominant === 'partial' ? 'var(--rag-partial)' : dominant === 'not-assessed' ? 'var(--colour-muted,#9ca3af)' : 'var(--rag-pass)';
    return `<div class="compliance-tile pub-compliance-tile-inner" role="button" tabindex="0"
      data-fw-id="${esc(fw.framework_id)}"
      onclick="window.swaoFilterByFramework&&window.swaoFilterByFramework(this.dataset.fwId)"
      style="--tile-border:${borderVar}">
      <div class="pub-heading-base-mb">${esc(fw.framework_id)}</div>
      <div class="pub-text-xs-secondary-mb">${esc(fw.framework_name)}</div>
      <div class="pub-flex-rag-row">
        <div class="pub-flex-chip">${ragChip('fail')}<span><strong>${fw.fail_count}</strong> <span data-i18n-key="rag.fail">Fail</span></span></div>
        <div class="pub-flex-chip">${ragChip('partial')}<span><strong>${fw.partial_count}</strong> <span data-i18n-key="rag.partial">Partial</span></span></div>
        <div class="pub-flex-chip">${ragChip('pass')}<span><strong>${fw.pass_count}</strong> <span data-i18n-key="rag.pass">Pass</span></span></div>
        ${notAssessedCount > 0 ? `<div class="pub-flex-chip">${ragChip('not-assessed')}<span><strong>${notAssessedCount}</strong> <span data-i18n-key="rag.not-assessed">Not assessed</span></span></div>` : ''}
      </div>
      <div class="pub-rag-bar">
        ${pctFail > 0        ? `<div style="--bar-flex:${pctFail}" class="pub-bar-seg-fail"></div>` : ''}
        ${pctPartial > 0     ? `<div style="--bar-flex:${pctPartial}" class="pub-bar-seg-partial"></div>` : ''}
        ${pctPass > 0        ? `<div style="--bar-flex:${pctPass}" class="pub-bar-seg-pass"></div>` : ''}
        ${pctNotAssessed > 0 ? `<div style="--bar-flex:${pctNotAssessed}" class="pub-bar-seg-na"></div>` : ''}
      </div>
      ${showControls ? `<div class="pub-footnote-mt"><a href="#controls" onclick="event.preventDefault();window.swaoFilterControls&&window.swaoFilterControls('${esc(fw.framework_id)}');return false;" class="pub-link-accent-xxs">${total} controls</a></div>` : ''}
    </div>`;
  }).join('');

  return `<div class="${gridClass}">${tiles}</div>`;
}

// ---------------------------------------------------------------------------
// Component: swao-chart-donut (Design 068 §20.9 Step 3)
// Extracted from renderCoverageBar. size opt: small/medium/large.
// animation opt: false to suppress stroke-dasharray transition.
// ---------------------------------------------------------------------------

export function renderChartDonut(pct: number, score: number, opts?: Record<string, string>): string {
  const circumference = 251.33;
  const dash = (score * circumference).toFixed(2);
  const size = opts?.size ?? 'medium';
  const dim = size === 'small' ? 60 : size === 'large' ? 140 : 100;
  const r = Math.round(dim * 0.4);
  const cx = Math.round(dim / 2);
  const animate = opts?.animation !== 'false';
  const transition = animate ? ' style="transition:stroke-dasharray 0.6s ease"' : '';
  return `<div class="donut-container" aria-hidden="true">
      <svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" aria-label="Coverage donut ${pct}%" role="img">
        <title>Assessment coverage: ${pct}%</title>
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--border)" stroke-width="12"/>
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none"
          stroke="#f97316"
          stroke-width="12"
          stroke-dasharray="${dash} ${circumference}"
          stroke-linecap="round"
          transform="rotate(-90 ${cx} ${cx})"${transition}/>
        <text x="${cx}" y="${cx + 4}" text-anchor="middle" font-size="${Math.round(dim * 0.18)}" font-weight="800" fill="var(--text-primary)">${pct}%</text>
      </svg>
    </div>`;
}

// ---------------------------------------------------------------------------
// Component: swao-chart-severity-bar (Design 068 §20.9 Step 4)
// Extracted from renderCoverageBar. show_labels opt. orientation opt.
// ---------------------------------------------------------------------------

export function renderChartSeverityBar(
  counts: Record<string, number>,
  opts?: Record<string, string>,
): string {
  const showLabels = opts?.show_labels !== 'false';
  const orientation = opts?.orientation ?? 'horizontal';
  const flexClass = orientation === 'vertical' ? 'pub-flex-col' : '';

  const sevOrder = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];
  const colourMap: Record<string, string> = {
    critical: '#dc2626', high: '#f97316', medium: '#d97706',
    low: '#2563eb', informational: '#0891b2', positive: '#16a34a',
  };

  const sevOnclick = (sev: string) =>
    `event.preventDefault();window.swaoScrollTo&&window.swaoScrollTo('signal-list');setTimeout(function(){var c=document.getElementById('signals-container');var chip=c&&c.querySelector('.filter-chip[data-filter-key=severity][data-filter-val=${sev}]');if(chip&&chip.getAttribute('aria-pressed')!=='true')chip.click();},400);return false;`;

  const activeSevs = sevOrder.filter(s => (counts[s] ?? 0) > 0);

  const barSegs = activeSevs.map((sev, i) => {
    const count = counts[sev] ?? 0;
    const colour = colourMap[sev] ?? '#6b7280';
    const isFirst = i === 0;
    const isLast = i === activeSevs.length - 1;
    const radius = `${isFirst ? 'var(--radius-sm)' : '0'} ${isLast ? 'var(--radius-sm)' : '0'} ${isLast ? 'var(--radius-sm)' : '0'} ${isFirst ? 'var(--radius-sm)' : '0'}`;
    return `<a href="#signal-list" onclick="${sevOnclick(sev)}" style="--seg-flex:${count}" class="pub-seg-link"><div class="sev-seg pub-seg-bar-item" style="--seg-colour:${colour};--seg-radius:${radius}" title="Click to filter: ${count} ${sev}">
      ${showLabels ? `<span>${count} ${esc(sev.toUpperCase())}</span>` : ''}
    </div></a>`;
  }).join('');

  const legendItems = sevOrder
    .filter(s => (counts[s] ?? 0) > 0)
    .map(sev => {
      const colour = colourMap[sev] ?? '#6b7280';
      const label = sev.charAt(0).toUpperCase() + sev.slice(1);
      return `<a href="#signal-list" onclick="${sevOnclick(sev)}" class="pub-link-plain"><div class="legend-item pub-pointer" title="Click to filter by ${sev}"><div class="legend-dot" style="--dot-color:${colour}" class="pub-dot-sm"></div><span data-i18n-key="severity.${sev}">${label}</span> (${counts[sev]})</div></a>`;
    })
    .join('\n      ');

  return `<div class="severity-bar-area ${flexClass}">
    <div class="severity-bar" role="img" aria-label="Severity distribution">
      ${barSegs || '<div class="sev-seg pub-flex-border-fill"><span>No signals</span></div>'}
    </div>
    <div class="severity-legend pub-flex-meta">
      ${legendItems}
    </div>
  </div>`;
}

/**
 * Emit SwaoTable config as JSON inside a container div + init script.
 * The JS engine expects:
 *   - container element id = tableId + '-container'
 *   - config.id = tableId
 *   - column shape: { id, label, field, type, sortable, filterable, filterType, filterValues, render }
 *
 * tableOpts are component-level overrides from the profile YAML (e.g. density, search).
 * They are spread last so the profile can override any static config field.
 */
export function swaoTableScript(
  tableId: string,
  config: Record<string, unknown>,
  tableOpts?: Record<string, string>,
): string {
  const fullConfig = { id: tableId, ...config, ...(tableOpts ?? {}) };
  const json = JSON.stringify(fullConfig);
  return `<div id="${tableId}-container" class="swao-table-wrapper"></div>
<script>
(function(){var c=${json};
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){window.initSwaoTable&&window.initSwaoTable(c);});}else{window.initSwaoTable&&window.initSwaoTable(c);}
})();
</script>`;
}

// ---------------------------------------------------------------------------
// Inline signal linkifier (#0703)
// ---------------------------------------------------------------------------

export const SIGNAL_ID_RE = /\b((?:INV|DATA|CTX|SBOM|TF|EGR|CRYPTO|IAM|OBS|LZ|SYNTH)-\d+)\b/g;

export function linkifySignalRefs(text: string, model: PublicationModel): string {
  const signalMap = new Map((model.signals as PubSignal[]).map(s => [s.id, s]));
  const resolvedSet = new Set(
    Array.isArray(model.delta?.resolved_signals) ? model.delta!.resolved_signals as string[] : []
  );
  return esc(text).replace(SIGNAL_ID_RE, (id) => {
    const sig = signalMap.get(id);
    if (sig) {
      const deriv = esc((sig.derivation ?? '').slice(0, 120));
      return `<span class="inline-ref inline-ref-signal inline-ref-active" data-signal-id="${esc(id)}" data-signal-severity="${esc(sig.severity)}" data-signal-outcome="${esc(sig.outcome)}" data-signal-derivation="${deriv}" onclick="event.stopPropagation();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(id)}');" class="pub-pointer">${esc(id)}</span>`;
    }
    if (resolvedSet.has(id)) {
      const runId = typeof model.delta?.run_a === 'string' ? model.delta!.run_a : '';
      return `<span class="inline-ref inline-ref-signal inline-ref-resolved" data-signal-id="${esc(id)}" data-signal-run="${esc(runId)}" onclick="event.stopPropagation();window.swaoNavigateToResolvedSignal&&window.swaoNavigateToResolvedSignal('${esc(id)}','${esc(runId)}');" class="pub-pointer">${esc(id)}</span>`;
    }
    return esc(id);
  });
}

// ---------------------------------------------------------------------------
// Seven-R strategy descriptions (shared constant)
// ---------------------------------------------------------------------------

export const SEVEN_R_DESCRIPTIONS: Record<string, string> = {
  Retire: 'The application will be decommissioned and removed from the portfolio.',
  Retain: 'The application remains on-premises or in its current environment with no change.',
  Rehost: 'The application is lifted-and-shifted to the sovereign cloud with minimal modification.',
  Replatform: 'Minor optimisations for cloud; some code changes required.',
  'Re-platform': 'Minor optimisations for cloud; some code changes required.',
  Repurchase: 'The application is replaced by a SaaS product available on the sovereign platform.',
  Refactor: 'The application is re-architected to be cloud-native and sovereign-compliant.',
  Relocate: 'The application is moved to a different cloud region or sovereignty boundary.',
};

// #0983: LZ verdict descriptions for the Methodology section guide table.
export const LZ_VERDICT_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  READY: {
    label: 'Ready',
    description: 'All sovereign requirements met. Migration can proceed to this region without restrictions.',
  },
  READY_WITH_CHANGES: {
    label: 'Ready with Changes',
    description: 'Service available but not yet enabled or requires configuration. Apply recommended changes before migrating.',
  },
  SOVEREIGNTY_BLOCKED: {
    label: 'Sovereignty Blocked',
    description: 'This region or provider fails the active sovereignty framework requirements. Migration would violate the compliance framework in place.',
  },
  BLOCKED: {
    label: 'Blocked',
    description: 'A required service is not available in this region or from this provider. Migration cannot proceed until the dependency is resolved.',
  },
};
