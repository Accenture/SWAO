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
 * Risk blocks: risk-register, evidence-gallery.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import type { PublicationModel, RiskRegisterItem, PubEvidence } from '../model.js';
import { esc, swaoTableScript, linkifySignalRefs } from './helpers.js';

// ---------------------------------------------------------------------------
// Internal helper: file type CSS class for evidence-gallery
// ---------------------------------------------------------------------------

function fileTypeClass(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const typeMap: Record<string, string> = {
    prisma: 'type-prisma',
    rs: 'type-rust',
    json: 'type-json',
    md: 'type-md',
    csv: 'type-csv',
    yaml: 'type-yaml',
    yml: 'type-yaml',
    ts: 'type-typescript',
    js: 'type-javascript',
  };
  if (!filePath.includes('.')) return 'type-dir';
  return typeMap[ext] ?? 'type-file';
}

// ---------------------------------------------------------------------------
// Block: risk-register
// ---------------------------------------------------------------------------

export function renderRiskRegister(model: PublicationModel, tableOpts?: Record<string, string>): string {
  const today = new Date();

  const rows = (model.risk_register as RiskRegisterItem[]).map(item => {
    let targetDateDisplay = item.target_date ?? '';
    if (item.target_date) {
      const d = new Date(item.target_date);
      const isOverdue = !isNaN(d.getTime()) && d < today && item.status !== 'resolved';
      if (isOverdue) {
        targetDateDisplay = `${item.target_date} OVERDUE`;
      }
    }
    return {
      risk_id: item.risk_id,
      signal_ref: item.signal_ref ?? '',
      trigger: item.trigger,
      category: item.category,
      severity: item.severity ?? '',
      likelihood: item.likelihood,
      impact: item.impact,
      migration_phase: item.migration_phase ?? '',
      effort: item.effort ?? '',
      owner: item.owner,
      status: item.status,
      target_date: targetDateDisplay,
      anchor: item.anchor,
      mitigation: item.mitigation,
      mitigation_html: linkifySignalRefs(item.mitigation, model),
      platform_impact: item.platform_impact ?? '',
      machine_outcome: item.machine_outcome ?? '',
      override_author: item.override?.author ?? '',
      override_role: item.override?.role ?? '',
      override_timestamp: item.override?.timestamp ?? '',
      override_rationale: item.override?.rationale ?? '',
      // #1297: pre-compute override block as HTML to avoid nested {{#if}} template issue
      override_block: (() => {
        const oa = item.override?.author ?? '';
        if (!oa) return '';
        const role = esc(item.override?.role ?? '');
        const ts = esc(item.override?.timestamp ?? '');
        const mo = esc((item.machine_outcome ?? '').trim());
        const rat = esc((item.override?.rationale ?? '').trim());
        return '<div class="pub-mt-2 override-audit-block">' +
          '<span class="row-detail__label pub-label-bold">Human Override:</span> ' +
          esc(oa) + (role ? ' (' + role + ')' : '') + ' at ' + ts +
          (mo ? ' -- machine verdict: ' + mo : '') +
          (rat ? ' -- ' + rat : '') +
          '</div>';
      })(),
    };
  });

  // Callout for immediate-phase risks
  const immediateRisks = (model.risk_register as RiskRegisterItem[])
    .filter(r => r.migration_phase?.toLowerCase() === 'immediate' && r.status !== 'resolved');
  const immediateCallout = immediateRisks.length > 0
    ? `<div class="callout callout-warning pub-mb-4">
    <strong>${immediateRisks.length} risk${immediateRisks.length !== 1 ? 's' : ''} have an Immediate phase:</strong>
    ${immediateRisks.map(r => esc(r.risk_id)).join(', ')} require action before the next sprint.
  </div>` : '';

  return `<section id="risk-register" class="swao-block swao-block--risk-register">
  <h2 id="risk-register-h" data-i18n-key="block.risk_register.title">Risk Register</h2>
  ${immediateCallout}
  ${swaoTableScript('risks', {
    caption: 'Risk register',
    exportCsv: true,
    rowIdField: 'risk_id', rowIdPrefix: 'risk-',
    columns: [
      { id: 'risk_id', label: 'ID', field: 'risk_id', type: 'text', sortable: true },
      { id: 'signal_ref', label: 'Signal', field: 'signal_ref', type: 'text', sortable: true },
      { id: 'trigger', label: 'Risk Title', field: 'trigger', type: 'text', sortable: true },
      { id: 'severity', label: 'Severity', field: 'severity', type: 'text', render: 'severity-badge', sortable: true },
      {
        id: 'migration_phase', label: 'Phase', field: 'migration_phase', type: 'text',
        render: 'migration-phase', sortable: true,
        filterable: true, filterType: 'chips', filterValues: ['Immediate', 'Pre-Migration', 'Post-Migration'],
      },
      { id: 'owner', label: 'Owner', field: 'owner', type: 'text', sortable: true },
      {
        id: 'status', label: 'Status', field: 'status', type: 'text',
        render: 'status-chip', sortable: true,
        filterable: true, filterType: 'chips', filterValues: ['open', 'in_progress', 'resolved'],
      },
      { id: 'target_date', label: 'Target Date', field: 'target_date', type: 'text', sortable: true },
    ],
    rows,
    expandTemplate:
      '<div class="row-detail__grid pub-section-body">' +
      '<div><span class="row-detail__label pub-label-bold">Risk Title:</span> {{trigger}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Remediation:</span> {{{mitigation_html}}}</div>' +
      '{{#if platform_impact}}<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Platform Impact:</span> {{platform_impact}}</div>{{/if}}' +
      '{{#if signal_ref}}<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Source Signal:</span> ' +
      '<span data-signal-xref="{{signal_ref}}"></span></div>{{/if}}' +
      '{{{override_block}}}' +
      '</div>',
    defaultFilter: { status: ['open', 'in_progress'] },
    defaultSort: [{ field: 'severity', dir: 'asc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: evidence-gallery
// ---------------------------------------------------------------------------

export function renderEvidenceGallery(model: PublicationModel, tableOpts?: Record<string, string>): string {
  const evidenceBaseUrl = (model.meta.publication_config as { evidence_base_url?: string }).evidence_base_url ?? '';
  const rows = (model.evidence as PubEvidence[]).map(e => {
    const cls = fileTypeClass(e.file);
    const srcPath = e.source_path ?? '';
    // srcPath is WSP-root-relative (e.g. wsp/inputs/source/Cargo.toml).
    // When evidence_base_url is set, strip wsp/inputs/ and prepend the base URL.
    // Otherwise fall back to the relative ../inputs/ path (co-located deployment).
    const relPath = srcPath.replace(/^wsp\/inputs\//, '');
    const href = evidenceBaseUrl
      ? `${evidenceBaseUrl.replace(/\/$/, '')}/${relPath}`
      : `../inputs/${relPath}`;
    // #1612: when source_path is absent but e.link is present (e.g. cert attestation
    // URLs from the cloud provider catalogue), render a clickable anchor so the
    // Evidence Gallery entry is usable, not a dead span.
    const sourceLink = srcPath
      ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="evidence-link ${esc(cls)} pub-text-accent">${esc(srcPath)}</a>`
      : e.link
        ? `<a href="${esc(e.link)}" target="_blank" rel="noopener" class="evidence-link ${esc(cls)} pub-text-accent">${esc(e.link)}</a>`
        : `<span class="evidence-link ${esc(cls)}">${esc(e.file)}</span>`;
    const refsHtml = Array.isArray(e.refs) && e.refs.length > 0
      ? `<div class="pub-mt-2"><span class="pub-label-bold">References:</span> ${esc(e.refs.join('; '))}</div>`
      : '';
    const ghLink = e.github_url
      ? `<div class="pub-mt-2"><a href="${esc(e.github_url)}" target="_blank" rel="noopener" class="pub-text-accent-sm2">View on GitHub</a></div>`
      : '';
    return {
      id: e.id,
      type: e.type,
      display_file: e.summary ?? (srcPath || e.file),
      file: e.file,
      date: e.date,
      used_by: e.used_by.join(', '),
      source_link: sourceLink,
      refs_html: refsHtml,
      gh_link: ghLink,
    };
  });

  const evidenceTypes = [...new Set((model.evidence as PubEvidence[]).map(e => e.type))];

  return `<section id="evidence-gallery" class="swao-block swao-block--evidence-gallery">
  <h2 id="evidence-gallery-h" data-i18n-key="block.evidence_gallery.title">Evidence Gallery</h2>
  <p class="pub-text-sm-secondary-mb2">
    ${evidenceBaseUrl
      ? `File links point to <code>${esc(evidenceBaseUrl)}</code>. Ensure that URL is accessible to report readers.`
      : `File links are relative to this publication. They resolve when <code>wsp/inputs/</code> is present alongside the HTML file. Use <code>swao publish --evidence-base-url &lt;url&gt;</code> to embed a portable base path.`
    }
  </p>
  ${swaoTableScript('evidence', {
    rowIdField: 'id', rowIdPrefix: 'evidence-',
    caption: 'Evidence artefacts',
    exportCsv: true,
    columns: [
      { id: 'id', label: 'ID', field: 'id', type: 'text', sortable: true },
      {
        id: 'type', label: 'Type', field: 'type', type: 'text', sortable: true,
        filterable: true, filterType: 'chips', filterValues: evidenceTypes,
      },
      { id: 'display_file', label: 'File', field: 'display_file', type: 'text', sortable: true },
      { id: 'date', label: 'Date', field: 'date', type: 'text', sortable: true },
      { id: 'used_by', label: 'Used By', field: 'used_by', type: 'text', sortable: false },
    ],
    rows,
    expandTemplate:
      '<div class="row-detail__grid pub-section-body">' +
      '<div><span class="row-detail__label pub-label-bold">File Path:</span> {{{source_link}}}</div>' +
      '{{{refs_html}}}' +
      '{{{gh_link}}}' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Type:</span> {{type}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Date:</span> {{date}}</div>' +
      '<div class="pub-mt-2"><span class="row-detail__label pub-label-bold">Used By:</span> {{used_by}}</div>' +
      '</div>',
    defaultSort: [{ field: 'date', dir: 'desc' }],
  }, tableOpts)}
</section>`;
}
