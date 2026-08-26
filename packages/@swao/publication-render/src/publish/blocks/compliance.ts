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
 * Compliance blocks: compliance-regime, compliance-matrix, compliance-framework-detail,
 * compliance-requirements, controls.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import type {
  PublicationModel,
  FrameworkResult,
  ControlResult,
  PubSignal,
  PubEvidence,
} from '../model.js';
import { esc, ragChip, swaoTableScript, renderComplianceTileGrid, linkifySignalRefs } from './helpers.js';

// ---------------------------------------------------------------------------
// Block: compliance-matrix -- cross-regime signal overlap table (#0484)
// ---------------------------------------------------------------------------

export function renderComplianceMatrix(model: PublicationModel): string {
  if (model.compliance.length < 2) return ''; // only meaningful with 2+ regimes

  // Build signal → frameworks map
  const sigToFrameworks = new Map<string, string[]>();
  for (const fw of model.compliance as FrameworkResult[]) {
    for (const ctrl of fw.controls as ControlResult[]) {
      for (const sigId of ctrl.signals) {
        if (!sigToFrameworks.has(sigId)) sigToFrameworks.set(sigId, []);
        const existing = sigToFrameworks.get(sigId)!;
        if (!existing.includes(fw.framework_id)) existing.push(fw.framework_id);
      }
    }
  }

  // Only show signals that appear in 2+ regimes (overlap signals)
  const overlapSigs = [...sigToFrameworks.entries()].filter(([, fws]) => fws.length >= 2);
  if (overlapSigs.length === 0) {
    return `<section id="compliance-matrix" class="swao-block swao-block--compliance-matrix">
  <h2 id="compliance-matrix-h" data-i18n-key="block.compliance_matrix.title">Cross-Regime Coverage</h2>
  <div class="callout callout-info">No signals contribute to controls across multiple regimes in this assessment.</div>
</section>`;
  }

  const fwIds = (model.compliance as FrameworkResult[]).map(fw => fw.framework_id);
  const headerCells = fwIds.map(id => `<th class="pub-th-bold-hdr">${esc(id)}</th>`).join('');

  const rows = overlapSigs.map(([sigId, fws]) => {
    const cells = fwIds.map(fwId => {
      if (!fws.includes(fwId)) return `<td class="pub-td-muted-sq">--</td>`;
      const fw = (model.compliance as FrameworkResult[]).find(f => f.framework_id === fwId);
      const matchingCtrls = (fw?.controls as ControlResult[] ?? []).filter(c => c.signals.includes(sigId));
      const ctrlIds = matchingCtrls.map(c => {
        const display = esc(c.id.split('_').slice(-2).join(' '));
        const safeAnchor = esc(c.anchor ?? '');
        const safeFwId = esc(fwId);
        const safeCtrlId = esc(c.id);
        const safeCtrlTitle = esc(c.title ?? '');
        const safeOutcome = esc(c.rag_status ?? '');
        // #0508: add article_text to data attribute for hover tooltip
        const safeArticle = esc((c.article_text ?? '').slice(0, 200));
        return `<a href="#${safeAnchor}"
           class="ctrl-chip"
           data-regime="${safeFwId}"
           data-control-id="${safeCtrlId}"
           data-control-title="${safeCtrlTitle}"
           data-control-outcome="${safeOutcome}"
           data-control-article="${safeArticle}"
           onclick="event.preventDefault();window.swaoFilterByFramework&&window.swaoFilterByFramework('${safeFwId}');setTimeout(function(){var el=document.getElementById('${safeAnchor}');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},500);return false;"
           class="pub-ctrl-id-tag-link">${display}</a>`;
      }).join(' ');
      return `<td class="pub-td-sm-sq">${ctrlIds}</td>`;
    }).join('');
    const signalObj = model.signals.find((s: PubSignal) => s.id === sigId);
    const sigTitle = esc((signalObj?.derivation ?? '').slice(0, 200));
    const sigLink = `<a href="#signal-${esc(sigId)}" title="${sigTitle}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(sigId)}');return false;" class="pub-text-accent">${esc(sigId)}</a>`;
    return `<tr><td class="pub-td-nowrap">${sigLink}${signalObj ? ` <span class="pub-text-em-xs-secondary">[${esc(signalObj.severity ?? '')}]</span>` : ''}</td>${cells}</tr>`;
  }).join('');

  return `<section id="compliance-matrix" class="swao-block swao-block--compliance-matrix">
  <h2 id="compliance-matrix-h" data-i18n-key="block.compliance_matrix.title">Cross-Regime Coverage</h2>
  <p class="pub-text-md-secondary-mb">${overlapSigs.length} signal${overlapSigs.length !== 1 ? 's' : ''} contribute to controls across multiple compliance regimes simultaneously. Addressing these signals achieves the broadest compliance coverage per remediation effort.</p>
  <div class="pub-overflow-x">
  <table class="pub-table-sm-rounded">
    <thead><tr class="pub-bg-muted">
      <th class="pub-th-bold-hdr">Signal</th>
      ${headerCells}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: compliance-regime
// ---------------------------------------------------------------------------

export function renderComplianceRegime(model: PublicationModel, tableOpts?: Record<string, string>, tileOpts?: Record<string, string>): string {
  const rows: Array<{
    framework: string;
    control: string;
    title: string;
    rag_status: string;
    worst_severity: string;
    signals: string;
    anchor: string;
    rationale: string;
    article_text: string;
    evidence: string;
  }> = [];

  for (const fw of model.compliance as FrameworkResult[]) {
    for (const ctrl of fw.controls as ControlResult[]) {
      rows.push({
        framework: fw.framework_id,
        control: ctrl.id,
        title: ctrl.title,
        rag_status: ctrl.rag_status,
        worst_severity: ctrl.worst_severity ?? '',
        signals: ctrl.signals.join(', '),
        anchor: ctrl.anchor,
        rationale: ctrl.rationale,
        article_text: ctrl.article_text ?? '',
        evidence: ctrl.evidence.join(', '),
      });
    }
  }

  // Compliance regime tiles -- delegated to swao-tiles-compliance component (Step 2 #0946).
  const ragBar = model.compliance.length > 0
    ? renderComplianceTileGrid(model.compliance as FrameworkResult[], tileOpts) : '';

  const frameworkIds = (model.compliance as FrameworkResult[]).map(fw => fw.framework_id);

  return `<section id="compliance-regime" class="swao-block swao-block--compliance-regime">
  <h2 id="compliance-regime-h" data-i18n-key="block.compliance_regime.title">Compliance</h2>
  ${ragBar}
  ${swaoTableScript('compliance', {
    caption: 'Control compliance status',
    exportCsv: true,
    rowIdField: 'anchor', rowIdPrefix: '',
    columns: [
      {
        id: 'framework', label: 'Framework', field: 'framework', type: 'text', sortable: true,
        filterable: true, filterType: 'chips', filterValues: frameworkIds,
      },
      { id: 'control', label: 'Control', field: 'control', type: 'text', sortable: true },
      { id: 'title', label: 'Title', field: 'title', type: 'text', sortable: true },
      {
        id: 'rag_status', label: 'Status', field: 'rag_status', type: 'text',
        render: 'rag-status', sortable: true,
        filterable: true, filterType: 'chips', filterValues: ['fail', 'partial', 'pass', 'not-assessed'],
      },
      {
        id: 'worst_severity', label: 'Worst Signal', field: 'worst_severity', type: 'text',
        render: 'severity-badge', sortable: true,
      },
      { id: 'signals', label: 'Contributing Signals', field: 'signals', type: 'text', sortable: false },
    ],
    rows,
    expandTemplate:
      '<div class="row-detail__grid pub-section-body">' +
      '<p class="pub-blockquote">{{article_text}}</p>' +
      '<div><span class="row-detail__label pub-label-bold">SWAO Rationale:</span> {{rationale}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Signals:</span> {{signals}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Evidence:</span> {{evidence}}</div>' +
      '</div>',
    defaultSort: [{ field: 'rag_status', dir: 'asc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: controls -- dedicated controls table across all compliance regimes
// ---------------------------------------------------------------------------

export function renderControls(model: PublicationModel, tableOpts?: Record<string, string>): string {
  if (model.compliance.length === 0) {
    return `<section id="controls" class="swao-block swao-block--controls">
  <h2 id="controls-h" data-i18n-key="block.controls.title">Controls</h2>
  <div class="callout callout-info">No compliance regimes assessed.</div>
</section>`;
  }

  const frameworkIds = (model.compliance as FrameworkResult[]).map(fw => fw.framework_id);
  const rows: Array<Record<string, string>> = [];
  for (const fw of model.compliance as FrameworkResult[]) {
    for (const ctrl of fw.controls as ControlResult[]) {
      const signalIds = ctrl.signals.slice(0, 4).join(', ');
      rows.push({
        framework: fw.framework_id,
        control_id: ctrl.id,
        title: ctrl.title,
        rag_status: ctrl.rag_status,
        severity: ctrl.worst_severity ?? '',
        signals: signalIds,
        signals_html: linkifySignalRefs(signalIds, model),
        rationale: ctrl.rationale,
        anchor: ctrl.anchor,
      });
    }
  }

  return `<section id="controls" class="swao-block swao-block--controls">
  <h2 id="controls-h" data-i18n-key="block.controls.title">Controls</h2>
  <p class="pub-text-secondary-mb">${rows.length} controls across ${frameworkIds.length} compliance regime${frameworkIds.length !== 1 ? 's' : ''}.</p>
  ${swaoTableScript('controls', {
    caption: 'Control compliance status',
    exportCsv: true,
    rowIdField: 'anchor', rowIdPrefix: '',
    columns: [
      {
        id: 'framework', label: 'Framework', field: 'framework', type: 'text', sortable: true,
        filterable: true, filterType: 'chips', filterValues: frameworkIds,
      },
      { id: 'control_id', label: 'Control ID', field: 'control_id', type: 'text', sortable: true },
      { id: 'title', label: 'Title', field: 'title', type: 'text', sortable: true },
      {
        id: 'rag_status', label: 'Status', field: 'rag_status', type: 'text',
        render: 'rag-status', sortable: true,
        filterable: true, filterType: 'chips', filterValues: ['fail', 'partial', 'pass', 'not-assessed'],
      },
      { id: 'severity', label: 'Severity', field: 'severity', type: 'text', render: 'severity-badge', sortable: true },
      { id: 'signals', label: 'Signals', field: 'signals_html', type: 'html', sortable: false },
    ],
    rows,
    expandTemplate:
      '<div class="row-detail__grid pub-section-body">' +
      '<div><span class="row-detail__label pub-label-bold">Rationale:</span> {{rationale}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Contributing signals:</span> {{signals}}</div>' +
      '</div>',
    defaultSort: [{ field: 'rag_status', dir: 'asc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: compliance-framework-detail
// ---------------------------------------------------------------------------

export function renderComplianceFrameworkDetail(
  model: PublicationModel,
  params: Record<string, string>,
): string {
  const targetId = params['frameworkId'] ?? '';

  const signalMap = new Map<string, PubSignal>();
  for (const s of model.signals) signalMap.set(s.id, s);

  const evidenceMap = new Map<string, PubEvidence>();
  for (const e of model.evidence) evidenceMap.set(e.id, e);

  const frameworks = targetId
    ? (model.compliance as FrameworkResult[]).filter(fw => fw.framework_id === targetId)
    : (model.compliance as FrameworkResult[]);

  if (frameworks.length === 0) {
    const msg = targetId
      ? `<p class="pub-text-secondary">No framework matching <code>${esc(targetId)}</code> found in this assessment.</p>`
      : '<p class="pub-text-secondary">No frameworks assessed.</p>';
    return `<section id="compliance-framework-detail" class="swao-block swao-block--compliance-framework-detail">
  <h2 id="compliance-framework-detail-h" data-i18n-key="block.compliance_framework_detail.title">Framework Compliance Detail</h2>
${msg}
</section>`;
  }

  // Jump-nav: pill links to each framework section, shown only when >1 framework
  const jumpNav = frameworks.length > 1
    ? `<div class="pub-tag-cloud-light">
    <span class="pub-label-sm-right">Jump to:</span>
    ${frameworks.map(fw => {
      const chip = ragChip(fw.fail_count > 0 ? 'fail' : fw.partial_count > 0 ? 'partial' : 'pass');
      return `<a href="#fw-detail-${esc(fw.framework_id)}" class="pub-pill-tag">${chip} ${esc(fw.framework_id)}</a>`;
    }).join('\n    ')}
  </div>`
    : '';

  const sections = frameworks.map(fw => {
    // Only render fail/partial controls to bound output size. Pass/not-assessed
    // controls are summarised as a count. This prevents OOM on large multi-framework
    // assessments (9 fw x 50 controls x signal rows = megabytes before size guards).
    const allControls = fw.controls as ControlResult[];
    const actionableControls = allControls.filter(
      ctrl => ctrl.rag_status === 'fail' || ctrl.rag_status === 'partial',
    );
    const passCount = allControls.filter(ctrl => ctrl.rag_status === 'pass').length;
    const notAssessedCount = allControls.filter(ctrl => ctrl.rag_status === 'not-assessed').length;

    const controls = actionableControls.map(ctrl => {
      const articleHtml = ctrl.article_text
        ? `<p class="fw-ctrl-desc pub-text-md-secondary-line">${esc(ctrl.article_text)}</p>`
        : '';
      const rationaleHtml = ctrl.rationale
        ? `<details class="fw-ctrl-assessment-details">` +
          `<summary class="fw-ctrl-assessment-summary"><strong class="pub-label-uppercase">Assessment</strong></summary>` +
          `<p class="fw-ctrl-rationale pub-text-sm-secondary-line">${esc(ctrl.rationale)}</p>` +
          `</details>`
        : '';

      const linkedSignals = ctrl.signals.filter((sid: string) => signalMap.has(sid));
      const sigPills = linkedSignals.map(sid => {
        const s = signalMap.get(sid)!;
        const deriv = esc((s.derivation ?? '').slice(0, 120));
        return `<a href="#signal-${esc(sid)}" data-signal-id="${esc(sid)}" data-signal-severity="${esc(s.severity)}" data-signal-outcome="${esc(s.outcome)}" data-signal-derivation="${deriv}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(sid)}');return false;" class="pub-ctrl-tag">${esc(sid)}</a>`;
      }).join('');
      const viewAllLink = linkedSignals.length > 1
        ? ` <a href="#signal-list" onclick="event.preventDefault();window.swaoHighlightSignals&&window.swaoHighlightSignals('${linkedSignals.map(s => esc(s)).join(',')}');return false;" class="pub-link-xxs">view all ${linkedSignals.length}</a>`
        : '';
      const signalsLine = linkedSignals.length > 0
        ? `<div class="pub-subtext-mt">${linkedSignals.length} signal(s) linked: ${sigPills}${viewAllLink}</div>`
        : '';

      return `
      <div id="${esc(ctrl.anchor)}-detail" class="fw-ctrl-entry pub-panel-alt">
        <div class="fw-ctrl-header pub-flex-row-sm">
          <span class="pub-mono-bold">${esc(ctrl.id)}</span>
          ${ragChip(ctrl.rag_status)}
          <span class="pub-text-lg-bold">${esc(ctrl.title)}</span>
        </div>
        ${articleHtml}${rationaleHtml}${signalsLine}
      </div>`;
    }).join('');

    const passedLine = (passCount + notAssessedCount) > 0
      ? `<p class="pub-text-xs-secondary-mt">${passCount > 0 ? `${passCount} control(s) satisfied` : ''}${passCount > 0 && notAssessedCount > 0 ? '; ' : ''}${notAssessedCount > 0 ? `${notAssessedCount} not assessed` : ''}.</p>`
      : '';

    const emptyMsg = actionableControls.length === 0
      ? `<p class="pub-text-secondary-md">All assessed controls satisfied.</p>`
      : '';

    // Audit-coverage: catalogue_version + last_reviewed (#1371).
    const extFw2 = fw as FrameworkResult & { catalogue_version?: string; last_reviewed?: string };
    const fwCatalogueMeta = [
      extFw2.catalogue_version ? `Catalogue v${esc(extFw2.catalogue_version)}` : '',
      extFw2.last_reviewed ? `Last reviewed: ${esc(extFw2.last_reviewed)}` : '',
    ].filter(Boolean).join(' &middot; ');

    return `
  <div id="fw-detail-${esc(fw.framework_id)}" class="fw-detail-section pub-section-anchor">
    <h3 class="pub-flex-title">
      ${esc(fw.framework_name)}
      <small class="pub-text-normal-xxs">${esc(fw.framework_id)}</small>
    </h3>
    <div class="pub-flex-meta-sm">
      <span>${ragChip('fail')} ${esc(String(fw.fail_count))} fail</span>
      <span>${ragChip('partial')} ${esc(String(fw.partial_count))} partial</span>
      <span>${ragChip('pass')} ${esc(String(fw.pass_count))} pass</span>
      ${fw.not_assessed_count > 0 ? `<span>${ragChip('not-assessed')} ${esc(String(fw.not_assessed_count))} not assessed</span>` : ''}
      ${fwCatalogueMeta ? `<span class="pub-text-xxs-secondary">${fwCatalogueMeta}</span>` : ''}
    </div>
    ${emptyMsg}${controls}${passedLine}
  </div>`;
  }).join('');

  return `<section id="compliance-framework-detail" class="swao-block swao-block--compliance-framework-detail">
  <h2 id="compliance-framework-detail-h" data-i18n-key="block.compliance_framework_detail.title">Framework Compliance Detail</h2>
${jumpNav}
${sections}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: compliance-requirements (#0509) -- all controls, expandable per framework
// ---------------------------------------------------------------------------

export function renderComplianceRequirements(model: PublicationModel): string {
  const frameworks = model.compliance as FrameworkResult[];
  if (frameworks.length === 0) {
    return `<section id="compliance-requirements" class="swao-block swao-block--compliance-requirements">
  <h2 id="compliance-requirements-h">Compliance Requirements</h2>
  <p class="pub-text-secondary">No compliance frameworks assessed.</p>
</section>`;
  }

  const signalMap = new Map<string, PubSignal>();
  for (const s of model.signals) signalMap.set(s.id, s);

  // Cap visible controls per framework to avoid V8 string-rope crash when
  // many large frameworks are active simultaneously (#0929).
  const MAX_VISIBLE_CONTROLS = 50;

  const fwSections = frameworks.map(fw => {
    const allControls = fw.controls as ControlResult[];
    const total = allControls.length;
    const passCount = allControls.filter(c => c.rag_status === 'pass').length;
    const overallRag = fw.fail_count > 0 ? 'fail' : fw.partial_count > 0 ? 'partial' : fw.pass_count > 0 ? 'pass' : 'not-assessed';
    const summaryLine = `${fw.fail_count} fail &middot; ${fw.partial_count} partial &middot; ${fw.pass_count} pass${fw.not_assessed_count > 0 ? ` &middot; ${fw.not_assessed_count} not assessed` : ''} (${total} total)`;

    function renderCtrl(ctrl: ControlResult): string {
      const ragBorderVar = ctrl.rag_status === 'fail' ? 'var(--rag-fail)' : ctrl.rag_status === 'partial' ? 'var(--rag-partial)' : ctrl.rag_status === 'not-assessed' ? 'var(--colour-muted,#9ca3af)' : 'var(--rag-pass)';
      const articleRaw = ctrl.article_text && ctrl.article_text.length > 500
        ? ctrl.article_text.slice(0, 497) + '...'
        : ctrl.article_text;
      const articleHtml = articleRaw
        ? `<p class="pub-text-sm-secondary-narrow">${esc(articleRaw)}</p>`
        : '';
      const rationaleRaw = ctrl.rationale && ctrl.rationale.length > 400
        ? ctrl.rationale.slice(0, 397) + '...'
        : ctrl.rationale;
      const rationaleHtml = rationaleRaw
        ? `<p class="pub-text-sm-secondary-tight"><strong class="pub-text-uppercase-mini">Assessment:</strong> ${esc(rationaleRaw)}</p>`
        : '';

      const linkedSignals = ctrl.signals.filter(sid => signalMap.has(sid));
      const sigPills = linkedSignals.map(sid => {
        const s = signalMap.get(sid)!;
        return `<a href="#signal-${esc(sid)}"
          data-signal-id="${esc(sid)}"
          data-signal-severity="${esc(s.severity)}"
          data-signal-outcome="${esc(s.outcome ?? '')}"
          data-signal-derivation="${esc((s.derivation ?? '').slice(0, 120))}"
          onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(sid)}');return false;"
          class="pub-ctrl-tag">${esc(sid)}</a>`;
      }).join('');
      const viewAllLink = linkedSignals.length > 1
        ? ` <a href="#signal-list" onclick="event.preventDefault();window.swaoHighlightSignals&&window.swaoHighlightSignals('${linkedSignals.map(s => esc(s)).join(',')}');return false;" class="pub-link-xxs">view all ${linkedSignals.length}</a>`
        : '';
      const signalsHtml = linkedSignals.length > 0
        ? `<div class="pub-subtext-mt2">${linkedSignals.length} signal(s) linked: ${sigPills}${viewAllLink}</div>`
        : '';
      const evidenceHtml = ctrl.evidence.length > 0
        ? `<div class="pub-text-mini-secondary-mt"><strong>Evidence:</strong> ${ctrl.evidence.map(e => `<code class="pub-mono-small">${esc(e)}</code>`).join(' ')}</div>`
        : '';
      const derivedFromHtml = ctrl.derived_from
        ? `<div class="pub-text-mini-secondary-mt"><strong>Human input / audit:</strong> <span class="pub-mono-small">${esc(ctrl.derived_from)}</span></div>`
        : '';

      // Audit-coverage metadata (#1365-#1370).
      const extCtrl = ctrl as ControlResult & {
        pillar?: string; tags?: string[]; severity_default?: string;
        evidence_basis?: string[]; maps_to?: string[]; references?: string[];
      };
      const pillarHtml = extCtrl.pillar
        ? `<span class="pub-tag-pill lz-meta-chip pub-text-xs" title="Framework pillar">${esc(extCtrl.pillar)}</span>`
        : '';
      const sevDefaultHtml = extCtrl.severity_default && ctrl.rag_status === 'not-assessed'
        ? `<span class="pub-text-mini-secondary-mt"> Expected severity: <strong>${esc(extCtrl.severity_default)}</strong></span>`
        : '';
      const evidBasisHtml = extCtrl.evidence_basis && extCtrl.evidence_basis.length > 0
        ? `<div class="pub-text-mini-secondary-mt"><strong>Scope of automated check:</strong> ${extCtrl.evidence_basis.map(e => `<code class="pub-mono-small">${esc(e)}</code>`).join(', ')}</div>`
        : '';
      const mapsToHtml = extCtrl.maps_to && extCtrl.maps_to.length > 0
        ? `<div class="pub-text-mini-secondary-mt"><strong>Also maps to:</strong> ${extCtrl.maps_to.map(m => `<span class="pub-ctrl-tag-sm">${esc(m)}</span>`).join(' ')}</div>`
        : '';
      const refsHtml = extCtrl.references && extCtrl.references.length > 0
        ? `<div class="pub-text-mini-secondary-mt"><strong>References:</strong> ${extCtrl.references.map(r => `<a class="pub-link-xs" href="${esc(r)}" target="_blank" rel="noopener">${esc(r)}</a>`).join(' ')}</div>`
        : '';
      const tagsHtml = extCtrl.tags && extCtrl.tags.length > 0
        ? `<div class="pub-text-mini-secondary-mt ctrl-tags">${extCtrl.tags.map(t => `<span class="pub-tag-mini">${esc(t)}</span>`).join(' ')}</div>`
        : '';

      return `<details id="${esc(ctrl.anchor)}" class="req-ctrl-row" style="--rag-border:${ragBorderVar}" class="pub-rag-bar-item-anchor">
        <summary class="pub-ctrl-row">
          <span class="pub-mono-bold">${esc(ctrl.id)}</span>
          ${ragChip(ctrl.rag_status)}${sevDefaultHtml}
          <span class="pub-ctrl-label">${esc(ctrl.title)}</span>
          ${pillarHtml}
          ${linkedSignals.length > 0 ? `<span class="pub-text-mini-secondary">${linkedSignals.length} signal(s)</span>` : ''}
        </summary>
        <div class="pub-p-tight">
          ${articleHtml}${rationaleHtml}${signalsHtml}${evidenceHtml}${derivedFromHtml}${evidBasisHtml}${mapsToHtml}${refsHtml}${tagsHtml}
        </div>
      </details>`;
    }

    const visibleControls = allControls.slice(0, MAX_VISIBLE_CONTROLS);
    const hiddenControls  = allControls.slice(MAX_VISIBLE_CONTROLS);
    const visibleHtml = visibleControls.map(renderCtrl).join('');
    const hiddenHtml = hiddenControls.length > 0
      ? `<details class="req-ctrl-overflow pub-mt-1b">
          <summary class="pub-ctrl-item">
            Show ${hiddenControls.length} more control(s) (${visibleControls.length} of ${total} shown above)
          </summary>
          <div class="pub-mt-1">${hiddenControls.map(renderCtrl).join('')}</div>
        </details>`
      : '';
    const controlRows = visibleHtml + hiddenHtml;

    const fwBorderVar = overallRag === 'fail' ? 'var(--rag-fail)' : overallRag === 'partial' ? 'var(--rag-partial)' : overallRag === 'not-assessed' ? 'var(--colour-muted,#9ca3af)' : 'var(--rag-pass)';
    const passedSummary = passCount > 0 && passCount === total
      ? `<p class="pub-text-xs-secondary-mt2">All ${passCount} control(s) satisfied.</p>`
      : '';

    // Audit-coverage: catalogue_version + last_reviewed (#1371).
    const extFw = fw as FrameworkResult & { catalogue_version?: string; last_reviewed?: string };
    const catalogueMeta = [
      extFw.catalogue_version ? `v${esc(extFw.catalogue_version)}` : '',
      extFw.last_reviewed ? `reviewed ${esc(extFw.last_reviewed)}` : '',
    ].filter(Boolean).join(' -- ');
    const catalogueMetaHtml = catalogueMeta
      ? `<span class="pub-text-xxs-secondary-ml">${catalogueMeta}</span>`
      : '';

    return `<details id="req-fw-${esc(fw.framework_id)}" class="req-fw-section pub-fw-card-anchor" style="--fw-border:${fwBorderVar}">
      <summary class="pub-ctrl-row-sm">
        <strong class="pub-text-base">${esc(fw.framework_name)}</strong>
        <small class="pub-text-xxs-secondary">${esc(fw.framework_id)}</small>
        ${ragChip(overallRag)}
        <span class="pub-text-2xs-right">${summaryLine}</span>
        ${catalogueMetaHtml}
      </summary>
      <div class="pub-mt-3">
        ${passedSummary}
        ${controlRows}
      </div>
    </details>`;
  }).join('');

  const fwJumpNav = frameworks.length > 1
    ? `<div class="pub-flex-tags-lg">
      <span class="pub-label-sm-right">Jump to:</span>
      ${frameworks.map(fw => {
        const rag = fw.fail_count > 0 ? 'fail' : fw.partial_count > 0 ? 'partial' : 'pass';
        return `<a href="#req-fw-${esc(fw.framework_id)}" class="pub-pill-tag">${ragChip(rag)} ${esc(fw.framework_id)}</a>`;
      }).join('\n      ')}
    </div>`
    : '';

  return `<section id="compliance-requirements" class="swao-block swao-block--compliance-requirements">
  <h2 id="compliance-requirements-h">Compliance Requirements</h2>
  <p class="pub-text-md-secondary-mb">All compliance controls across ${frameworks.length} framework(s). Click a control row to expand requirement text and linked signals. Stable anchor links allow deep-linking to individual controls.</p>
  ${fwJumpNav}
  ${fwSections}
</section>`;
}
