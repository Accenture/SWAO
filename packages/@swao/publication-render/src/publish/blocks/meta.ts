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
 * Meta blocks: methodology, glossary, tag-taxonomy, pass-explainer,
 * framework-explainer, run-history, assessment-scope, toc, footer,
 * runbook, delta-view, appendix-raw-wsp, persona-portal.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';
import { RunManifestSchema, type RunManifest } from '@swao/core';
import type {
  PublicationModel,
  PubSignal,
  FrameworkResult,
  TagIndex,
  RunSummary,
} from '../model.js';
import { esc, sevBadge, ragChip, swaoTableScript, pubCfg, LZ_VERDICT_DESCRIPTIONS, SEVEN_R_DESCRIPTIONS } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Block: run-history
// ---------------------------------------------------------------------------

export function renderRunHistory(model: PublicationModel, tableOpts?: Record<string, string>): string {
  if (model.run_history.length === 0) {
    return `<section id="run-history" class="swao-block swao-block--run-history">
  <h2 id="run-history-h" data-i18n-key="block.run_history.title">Assessment History</h2>
  <div class="callout callout-info"><span data-i18n-key="block.run_history.no_history">No prior runs recorded.</span></div>
</section>`;
  }

  // #0518: for the run that was compared in delta, embed new/resolved signal tables inline
  const deltaRunA = model.delta?.run_a ?? '';
  const deltaNewIds = (model.delta?.new_signals ?? []) as string[];
  const deltaResolvedIds = (model.delta?.resolved_signals ?? []) as string[];

  function buildInlineDiffHtml(runId: string): string {
    if (!deltaRunA || runId !== deltaRunA) return '';
    if (deltaNewIds.length === 0 && deltaResolvedIds.length === 0) return '';
    const newChips = deltaNewIds.map(id =>
      `<a href="#signal-${esc(id)}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(id)}');return false;" class="pub-chip-critical">${esc(id)}</a>`,
    ).join('');
    const resolvedChips = deltaResolvedIds.map(id =>
      `<span class="pub-chip-positive">${esc(id)}</span>`,
    ).join('');
    return `<div class="pub-panel-accent-mt">` +
      `<div class="pub-label-xs-mb">Comparison with current run:</div>` +
      (deltaNewIds.length > 0 ? `<div class="pub-mb-2"><span class="pub-text-critical-badge">New in current (${deltaNewIds.length}):</span><br>${newChips}</div>` : '') +
      (deltaResolvedIds.length > 0 ? `<div><span class="pub-text-positive-sm">Resolved since this run (${deltaResolvedIds.length}):</span><br>${resolvedChips}</div>` : '') +
      `</div>`;
  }

  const rows = (model.run_history as RunSummary[]).map(r => {
    // #1711: signal_counts may be empty (manifest-only history runs); prefer r.total_signals.
    const countsSum = Object.values(r.signal_counts).reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0);
    const totalSig = countsSum > 0 ? countsSum : (r.total_signals ?? 0);
    const sev = r.signal_counts as Record<string, number>;
    const breakdown = ['critical','high','medium','low','informational']
      .filter(s => sev[s])
      .map(s => `${s}: ${sev[s]}`)
      .join(', ') || 'none';
    return {
      run_id: r.run_id,
      assessed_at: r.assessed_at,
      swao_version: r.swao_version,
      signals: totalSig.toString(),
      signals_breakdown: breakdown,
      diff_cmd: `swao diff --app ${esc(model.meta.app_id)} --run2 ${esc(r.run_id)}`,
      publication_href: r.publication_href ?? '',
      // #0518: pre-computed inline diff HTML (raw, for {{{field}}} substitution)
      inline_diff: buildInlineDiffHtml(r.run_id),
    };
  });

  return `<section id="run-history" class="swao-block swao-block--run-history">
  <h2 id="run-history-h" data-i18n-key="block.run_history.title">Assessment History</h2>
  ${swaoTableScript('run-history', {
    rowIdField: 'run_id', rowIdPrefix: 'history-run-',
    caption: 'Prior assessment runs',
    exportCsv: true,
    columns: [
      { id: 'run_id', label: 'Run ID', field: 'run_id', type: 'text', sortable: true },
      { id: 'assessed_at', label: 'Date', field: 'assessed_at', type: 'text', sortable: true },
      { id: 'swao_version', label: 'SWAO Version', field: 'swao_version', type: 'text', sortable: false },
      { id: 'signals', label: 'Signals', field: 'signals', type: 'text', sortable: true },
    ],
    rows,
    expandTemplate:
      '<div class="row-detail__grid pub-section-body">' +
      '<div><span class="row-detail__label pub-label-bold">Signal breakdown:</span> {{signals_breakdown}}</div>' +
      '{{{inline_diff}}}' +
      '<div class="pub-flex-row-mt">' +
      '<button data-cmd="{{diff_cmd}}" onclick="(function(b){navigator.clipboard.writeText(b.dataset.cmd).then(function(){var t=b.textContent;b.textContent=\'Copied!\';setTimeout(function(){b.textContent=t;},1200);})})(this)" class="pub-copy-btn-muted">Copy diff command</button>' +
      '<code class="pub-text-2xs-secondary">{{diff_cmd}}</code>' +
      '</div>' +
      '<div class="pub-footnote">Run in your workspace terminal to compare with the current assessment.</div>' +
      '</div>',
    defaultSort: [{ field: 'assessed_at', dir: 'desc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: tag-taxonomy
// ---------------------------------------------------------------------------

export function renderTagTaxonomy(model: PublicationModel): string {
  const tags = model.tags as TagIndex;
  const entries = Object.entries(tags);

  if (entries.length === 0) {
    return `<section id="tag-taxonomy" class="swao-block swao-block--tag-taxonomy">
  <h2 id="tag-taxonomy-h" data-i18n-key="block.tag_taxonomy.title">Tag Index</h2>
  <p class="pub-text-secondary">No tags defined for this assessment.</p>
</section>`;
  }

  const tagCloud = entries
    .map(([tag, items]) => {
      const count = items.length;
      return `<span class="badge badge-tag pub-pointer" title="${esc(count)} item(s)">${esc(tag)}: ${count}</span>`;
    })
    .join('\n      ');

  const dlItems = entries
    .map(([tag, items]) => {
      const count = items.length;
      const sample = items.slice(0, 5);
      const links = sample
        .map(
          it =>
            `<a href="#${esc(it.anchor)}" class="pub-text-sm">${esc(it.label)}</a>`,
        )
        .join(' ');
      const more = count > 5 ? ` <span class="pub-text-secondary">(+${count - 5} more)</span>` : '';
      return `  <dt class="pub-bold-mt">${esc(tag)}</dt>
  <dd class="pub-text-secondary-indent">${count} item(s): ${links}${more}</dd>`;
    })
    .join('\n');

  return `<section id="tag-taxonomy" class="swao-block swao-block--tag-taxonomy">
  <h2 id="tag-taxonomy-h" data-i18n-key="block.tag_taxonomy.title">Tag Index</h2>
  <div class="tag-cloud pub-flex-tags-lg">
    ${tagCloud}
  </div>
  <dl>
${dlItems}
  </dl>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: glossary
// ---------------------------------------------------------------------------

export function renderGlossary(tableOpts?: Record<string, string>): string {
  // Multi-candidate resolution (#0575): controls/glossary.yaml lives at
  // <workspace>/swao/controls/glossary.yaml. blocks.ts moved into
  // @swao/module-html-report/src/publish/, so the dev path is now 5 levels up;
  // dist/publish/ sits at the same depth, so one string covers dev + module-dist.
  // The original 4-up string is PRESERVED for the pkg binary (controls bundled at
  // ../../controls/** relative to the bundled dist/, __dirname-independent of source).
  // Use try/catch instead of existsSync: existsSync returns false for pkg snapshot
  // paths even when readFileSync succeeds (known @yao-pkg/pkg quirk).
  const glossaryCandidates = [
    join(__dirname, '../../../../../../controls/glossary.yaml'),  // dev + module dist: 6-up from blocks/ (= orig 5-up)
    join(__dirname, '../../../../../controls/glossary.yaml'),     // 5-up from blocks/ (= orig 4-up legacy)
    join(__dirname, '../../../../controls/glossary.yaml'),        // 4-up from blocks/ (= orig 3-up pkg binary)
    join(__dirname, '../../../controls/glossary.yaml'),           // 3-up safety fallback
  ];

  interface GlossaryTerm {
    term?: string;
    definition?: string;
  }

  let terms: Array<{ term: string; definition: string }> | null = null;
  for (const glossaryPath of glossaryCandidates) {
    try {
      const raw = loadYaml(readFileSync(glossaryPath, 'utf-8')) as {
        terms?: GlossaryTerm[];
      } | null;
      terms = (raw?.terms ?? [])
        .filter(
          (t): t is { term: string; definition: string } =>
            typeof t.term === 'string' && typeof t.definition === 'string',
        )
        .map(t => ({ term: t.term, definition: t.definition }));
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (terms === null) {
    return `<section id="glossary" class="swao-block swao-block--glossary">
  <h2 id="glossary-h" data-i18n-key="block.glossary.title">Glossary</h2>
  <p class="pub-text-secondary">Glossary file could not be located. Run <code>swao health-check</code> to verify your installation paths.</p>
</section>`;
  }

  if (terms.length === 0) {
    return `<section id="glossary" class="swao-block swao-block--glossary">
  <h2 id="glossary-h" data-i18n-key="block.glossary.title">Glossary</h2>
  <p class="pub-text-secondary">Glossary is empty.</p>
</section>`;
  }

  // #0511: replace definition-list with sortable/searchable SwaoTable
  const glossaryRows = terms.map(t => ({
    term: t.term,
    definition: t.definition,
  }));

  return `<section id="glossary" class="swao-block swao-block--glossary">
  <h2 id="glossary-h" data-i18n-key="block.glossary.title">Glossary</h2>
  ${swaoTableScript('glossary', {
    rowIdField: 'term', rowIdPrefix: 'glossary-term-',
    caption: 'SWAO Glossary',
    exportCsv: true,
    columns: [
      { id: 'term', label: 'Term', field: 'term', type: 'text', sortable: true },
      { id: 'definition', label: 'Definition', field: 'definition', type: 'text', sortable: false },
    ],
    rows: glossaryRows,
    defaultSort: [{ field: 'term', dir: 'asc' }],
  }, tableOpts)}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: pass-explainer
// ---------------------------------------------------------------------------

export function renderPassExplainer(model: PublicationModel): string {
  const byPass = new Map<string, Array<{ id: string; severity: string; implies: string[] }>>();
  for (const s of model.signals as PubSignal[]) {
    const list = byPass.get(s.pass) ?? [];
    list.push({ id: s.id, severity: s.severity, implies: s.implies ?? [] });
    byPass.set(s.pass, list);
  }

  // #0512: scope coverage legend -- extract closed/partial/open from SCOPE signal implies[]
  const scopeLegendHtml = (() => {
    const scopeSigs = (model.signals as PubSignal[]).filter(s => s.id.startsWith('SCOPE-'));
    if (scopeSigs.length === 0) return '';
    const coverageMap: Record<string, { id: string; name: string; coverage: string; derivation: string }[]> = { closed: [], partial: [], open: [] };
    for (const s of scopeSigs) {
      for (const impl of (s.implies ?? [])) {
        const m = impl.match(/^blind_spot_(closed|partial|open):(.+)$/);
        if (m) {
          const [, cov, bsId] = m;
          coverageMap[cov]?.push({ id: s.id, name: bsId, coverage: cov, derivation: s.derivation });
        }
      }
    }
    const legendItems = [
      { key: 'closed', label: 'Closed', desc: 'Evidence provided and evaluated -- blind spot is covered', color: 'var(--colour-positive)' },
      { key: 'partial', label: 'Partial', desc: 'Some evidence available but coverage incomplete -- supply additional inputs to close fully', color: 'var(--colour-medium)' },
      { key: 'open', label: 'Open', desc: 'Missing evidence -- this blind spot is out of scope for this assessment', color: 'var(--colour-critical)' },
    ];
    const legend = legendItems.map(item =>
      `<span class="pub-legend-item">` +
      `<span style="--dot-color:${item.color}" class="pub-legend-dot"></span>` +
      `<strong>${esc(item.label)}</strong>: ${esc(item.desc)}</span>`,
    ).join('');
    const rows = Object.entries(coverageMap)
      .flatMap(([cov, items]) => items.map(i => ({ ...i, coverage: cov })))
      .map(item => {
        const covColor = item.coverage === 'closed' ? 'var(--colour-positive)' : item.coverage === 'partial' ? 'var(--colour-medium)' : 'var(--colour-critical)';
        return `<tr>
          <td class="pub-td-xs"><a href="#signal-${esc(item.id)}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(item.id)}');return false;" class="pub-mono-accent">${esc(item.id)}</a></td>
          <td class="pub-td-xs-mono">${esc(item.name)}</td>
          <td class="pub-td-xs"><span class="badge" style="--cov-bg:${covColor}" class="pub-cov-badge" title="${esc(item.coverage === 'closed' ? 'Evidence provided and evaluated' : item.coverage === 'partial' ? 'Partial coverage -- supply additional inputs' : 'Missing evidence -- out of scope')}">${esc(item.coverage.toUpperCase())}</span></td>
          <td class="pub-td-xs-muted pub-td-wrap">${esc(item.derivation)}</td>
        </tr>`;
      }).join('');
    if (!rows) return '';
    return `<div class="pub-panel-note2">
      <strong class="pub-text-md">Scope Coverage -- Blind Spot Status Legend</strong>
      <div class="pub-tag-list-mt">${legend}</div>
      <div class="pub-overflow-x-mt">
        <table class="pub-table-xs">
          <thead><tr class="pub-bg-surface">
            <th class="pub-th-sm">Signal</th>
            <th class="pub-th-sm">Blind Spot ID</th>
            <th class="pub-th-sm">Status</th>
            <th class="pub-th-sm">Detail</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  })();

  const details = Array.from(byPass.entries())
    .map(([pass, sigs]) => {
      const items = sigs
        .map(
          s =>
            `      <li class="pub-mb-1"><a href="#signal-${esc(s.id)}">${esc(s.id)}</a> ${sevBadge(s.severity)}</li>`,
        )
        .join('\n');
      return `  <details class="swao-accordion pub-panel-mb-xs">
    <summary class="pub-accordion-toggle">Pass: ${esc(pass)} (${sigs.length} <span data-i18n-key="block.pass_explainer.signals">signal(s)</span>)</summary>
    <div class="swao-accordion__body pub-section-footer">
      <ul class="pub-list-indent">
${items}
      </ul>
    </div>
  </details>`;
    })
    .join('\n');

  const fallback =
    details.length === 0
      ? '<p class="pub-text-secondary">No signals recorded.</p>'
      : details;

  return `<section id="pass-explainer" class="swao-block swao-block--pass-explainer">
  <h2 id="pass-explainer-h" data-i18n-key="block.pass_explainer.title">Assessment Passes</h2>
${scopeLegendHtml}
${fallback}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: framework-explainer
// ---------------------------------------------------------------------------

export function renderFrameworkExplainer(model: PublicationModel): string {
  const cards = (model.compliance as FrameworkResult[])
    .map(fw => {
      const miniBar = `
    <div class="framework-bar pub-rag-bar-fw">
      ${fw.fail_count > 0 ? `<div class="mini-rag-bar__seg seg-fail" style="--bar-flex:${fw.fail_count}" class="pub-fw-bar-fail"></div>` : ''}
      ${fw.partial_count > 0 ? `<div class="mini-rag-bar__seg seg-partial" style="--bar-flex:${fw.partial_count}" class="pub-fw-bar-partial"></div>` : ''}
      ${fw.pass_count > 0 ? `<div class="mini-rag-bar__seg seg-pass" style="--bar-flex:${fw.pass_count}" class="pub-fw-bar-pass"></div>` : ''}
    </div>`;
      return `
  <div class="framework-card pub-card-sm-mb">
    <h3 class="pub-m-bottom-2">${esc(fw.framework_name)} <small class="pub-text-normal-secondary">(${esc(fw.framework_id)})</small></h3>
    <div class="pub-flex-gap-lg">
      <span>${ragChip('fail')} ${esc(fw.fail_count)} <span data-i18n-key="rag.fail">Fail</span></span>
      <span>${ragChip('partial')} ${esc(fw.partial_count)} <span data-i18n-key="rag.partial">Partial</span></span>
      <span>${ragChip('pass')} ${esc(fw.pass_count)} <span data-i18n-key="rag.pass">Pass</span></span>
    </div>
    ${miniBar}
    <p class="pub-m-top-2"><a href="#compliance-regime">View all controls</a></p>
  </div>`;
    })
    .join('');

  const fallback =
    cards.trim().length === 0
      ? '<p class="pub-text-secondary">No frameworks assessed.</p>'
      : cards;

  return `<section id="framework-explainer" class="swao-block swao-block--framework-explainer">
  <h2 id="framework-explainer-h" data-i18n-key="block.framework_explainer.title">Frameworks</h2>
${fallback}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: assessment-scope (#0517) -- files scanned, pass stats, duration
// ---------------------------------------------------------------------------

export function renderAssessmentScope(params: Record<string, string>, model: PublicationModel): string {
  // Read run-manifest when wspRunDir is available (injected by renderer-core for this block)
  let manifest: RunManifest | null = null;
  const wspRunDir = params['_wspRunDir'] ?? '';
  if (wspRunDir) {
    const mPath = join(wspRunDir, 'run-manifest.json');
    try {
      if (existsSync(mPath)) {
        const raw = JSON.parse(readFileSync(mPath, 'utf-8')) as unknown;
        const parsed = RunManifestSchema.safeParse(raw);
        if (parsed.success) manifest = parsed.data;
      }
    } catch { /* graceful degradation */ }
  }

  const meta = model.meta;
  const durationMs = manifest?.duration_ms;
  const durationStr = durationMs !== undefined
    ? durationMs >= 60000
      ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
      : `${(durationMs / 1000).toFixed(1)}s`
    : null;

  const filesAssessed = manifest?.files_assessed;
  const inventoryCount = filesAssessed?.inventory_count;
  const sourceFilesTotal = filesAssessed?.source_files_total;
  const importsFilesTotal = filesAssessed?.imports_files_total;
  const inputFilesCount = model.input_files.length;

  // Pass stats: split by iteration (#1007). If iter field is present group by it;
  // otherwise fall back to detecting the first repeated pass num as the split point.
  const passStats = manifest?.pass_stats ?? [];
  const totalSignals = manifest?.total_signals_emitted ?? model.signals.length;

  function groupPassStatsByIter(stats: typeof passStats): Map<number, typeof passStats> {
    const hasIterField = stats.some(ps => ps.iter !== undefined);
    if (hasIterField) {
      const groups = new Map<number, typeof passStats>();
      for (const ps of stats) {
        const key = ps.iter ?? 1;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(ps);
      }
      return groups;
    }
    // Fallback: split on first repeated num value (assessment then challenge).
    const seen = new Set<string>();
    const group1: typeof passStats = [];
    const group2: typeof passStats = [];
    let inGroup2 = false;
    for (const ps of stats) {
      if (!inGroup2 && seen.has(ps.num)) inGroup2 = true;
      seen.add(ps.num);
      (inGroup2 ? group2 : group1).push(ps);
    }
    const result = new Map<number, typeof passStats>();
    result.set(1, group1);
    if (group2.length > 0) result.set(2, group2);
    return result;
  }

  const ITER_LABELS: Record<number, string> = { 1: 'Assessment Run', 2: 'Challenge Run' };

  function renderPassTableSection(stats: typeof passStats, label: string): string {
    const sorted = [...stats].sort((a, b) => b.wall_clock_ms - a.wall_clock_ms);
    const rows = sorted.slice(0, 20).map(ps => {
      const wallSec = (ps.wall_clock_ms / 1000).toFixed(2);
      const costStr = ps.cost_usd !== undefined ? `$${ps.cost_usd.toFixed(4)}` : '--';
      const tokStr = ps.tokens_in !== undefined && ps.tokens_out !== undefined
        ? `${ps.tokens_in.toLocaleString()} in / ${ps.tokens_out.toLocaleString()} out`
        : '--';
      return `<tr class="pub-tr-border">
        <td class="pub-td-mono-xs">${esc(ps.num)}</td>
        <td class="pub-td-xs-text">${esc(ps.pass)}</td>
        <td class="pub-td-right-xs">${esc(wallSec)}s</td>
        <td class="pub-td-right-xs">${esc(String(ps.signals_emitted))}</td>
        <td class="pub-td-right-xs-muted">${esc(tokStr)}</td>
        <td class="pub-td-right-xs-muted">${esc(costStr)}</td>
      </tr>`;
    }).join('');
    const totalCost = stats.reduce((s, ps) => s + (ps.cost_usd ?? 0), 0);
    const totalCostStr = totalCost > 0 ? `$${totalCost.toFixed(4)}` : '--';
    const totalRow = `<tr class="pub-tr-border pub-bg-muted">
      <td colspan="5" class="pub-td-xs-text"><strong>Total</strong></td>
      <td class="pub-td-right-xs-muted"><strong>${esc(totalCostStr)}</strong></td>
    </tr>`;
    return `<h3 class="pub-section-title">${esc(label)}</h3>
    <div class="pub-overflow-x">
    <table class="pub-table-xs-rounded">
      <thead><tr class="pub-bg-muted">
        <th class="pub-th-left-hdr">#</th>
        <th class="pub-th-left-hdr">Pass</th>
        <th class="pub-th-right-hdr">Duration</th>
        <th class="pub-th-right-hdr">Signals</th>
        <th class="pub-th-right-hdr">Tokens</th>
        <th class="pub-th-right-hdr">Cost</th>
      </thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>
    </div>`;
  }

  const iterGroups = groupPassStatsByIter(passStats);
  const passTable = passStats.length > 0
    ? `<h3 class="pub-section-title">Pass Execution</h3>` +
      [...iterGroups.entries()].sort(([a], [b]) => a - b).map(([iter, stats]) => {
        const sectionLabel = iterGroups.size > 1
          ? (ITER_LABELS[iter] ?? `Iteration ${iter}`)
          : 'Pass Statistics';
        return renderPassTableSection(stats, sectionLabel);
      }).join('')
    : '';

  const metaRow = (label: string, value: string) =>
    `<tr><th scope="row" class="pub-th-label-wide">${esc(label)}</th><td class="pub-cell-text">${value}</td></tr>`;

  const metaRows = [
    metaRow('Application', esc(meta.app_name) + ` <code class="pub-text-2xs-secondary">${esc(meta.app_id)}</code>`),
    metaRow('Assessment date', esc(meta.assessed_at)),
    metaRow('Run ID', `<code>${esc(meta.run_id)}</code>`),
    metaRow('SWAO version', esc(meta.swao_version)),
    ...(durationStr ? [metaRow('Total duration', esc(durationStr))] : []),
    metaRow('Total signals emitted', esc(String(totalSignals))),
    ...(inventoryCount !== undefined ? [metaRow('Inventory items', esc(String(inventoryCount)))] : []),
    ...(sourceFilesTotal !== undefined ? [metaRow('Source files', esc(String(sourceFilesTotal)))] : []),
    ...(importsFilesTotal !== undefined ? [metaRow('Imports files', esc(String(importsFilesTotal)))] : []),
    ...(inputFilesCount > 0 ? [metaRow('Evidence inputs', esc(String(inputFilesCount)))] : []),
  ].join('');

  return `<section id="assessment-scope" class="swao-block swao-block--assessment-scope">
  <h2 id="assessment-scope-h">Assessment Scope</h2>
  <table class="pub-table-mb">
    <tbody>${metaRows}</tbody>
  </table>
  ${passTable}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: methodology
// ---------------------------------------------------------------------------

export function renderMethodology(): string {
  return `<section id="methodology" class="swao-block swao-block--methodology">
  <h2 id="methodology-h" data-i18n-key="block.methodology.title">Methodology</h2>

  <h3 id="methodology-about" data-i18n-key="block.methodology.about_title">About This Assessment</h3>
  <p data-i18n-key="block.methodology.about_body" class="pub-lh-7">SWAO (Sovereign Workload Assessment and Onboarding) is an automated tool
  developed by Accenture to assess whether applications are ready for
  migration to sovereign cloud platforms.</p>

  <h3 id="methodology-how" data-i18n-key="block.methodology.how_to_read">How to Read This Report</h3>
  <ol class="pub-lh-8">
    <li>Start with the <a href="#exec-summary">Executive Summary</a> for the overall risk posture.</li>
    <li>Review <a href="#signal-list">Signals</a> filtered by severity for immediate action items.</li>
    <li>Check <a href="#compliance-regime">Compliance</a> for framework-specific control gaps.</li>
    <li>Use the <a href="#risk-register">Risk Register</a> to track remediation ownership and timelines.</li>
    <li>Consult the <a href="#lzr-summary">Landing Zone Readiness</a> section for blockers before migration.</li>
  </ol>

  <h3 id="methodology-severity" data-i18n-key="block.methodology.severity_title">Severity Levels Explained</h3>
  <table class="severity-legend-table pub-table-base">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-th-wide-left" data-i18n-key="block.signal_list.col_severity">Severity</th>
        <th class="pub-th-wide-left">Description</th>
      </tr>
    </thead>
    <tbody>
      <tr class="pub-tr-border">
        <td class="pub-td-wide">${sevBadge('critical')}</td>
        <td class="pub-td-wide" data-i18n-key="severity.critical_description">Immediate risk to compliance or platform onboarding. Likely an LZR blocker.</td>
      </tr>
      <tr class="pub-tr-alt">
        <td class="pub-td-wide">${sevBadge('high')}</td>
        <td class="pub-td-wide" data-i18n-key="severity.high_description">Significant risk -- action required within 30 days.</td>
      </tr>
      <tr class="pub-tr-border">
        <td class="pub-td-wide">${sevBadge('medium')}</td>
        <td class="pub-td-wide" data-i18n-key="severity.medium_description">Moderate risk -- address within 90 days.</td>
      </tr>
      <tr class="pub-tr-alt">
        <td class="pub-td-wide">${sevBadge('low')}</td>
        <td class="pub-td-wide" data-i18n-key="severity.low_description">Minor gap -- address within the next quarter.</td>
      </tr>
      <tr class="pub-tr-border">
        <td class="pub-td-wide">${sevBadge('informational')}</td>
        <td class="pub-td-wide">Observation only. No immediate action required.</td>
      </tr>
      <tr>
        <td class="pub-td-wide">${sevBadge('positive')}</td>
        <td class="pub-td-wide" data-i18n-key="severity.positive_description">Good practice confirmed. No action needed.</td>
      </tr>
    </tbody>
  </table>

  <h3 id="methodology-lz-verdicts" data-i18n-key="block.methodology.lz_verdict_title">Landing Zone Verdict Guide</h3>
  <p class="pub-lh-7">Landing zone verdicts appear in the LZ Readiness section and indicate whether a target region or provider meets the active sovereignty requirements.</p>
  <table class="severity-legend-table pub-table-base">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-th-wide-left">Verdict</th>
        <th class="pub-th-wide-left">Meaning</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(LZ_VERDICT_DESCRIPTIONS).map(([id, v], i) => {
        const ragClass = id === 'READY' ? 'pass' : id === 'READY_WITH_CHANGES' ? 'partial' : 'fail';
        const rowCls = i % 2 === 0 ? 'pub-tr-border' : 'pub-tr-alt';
        return `<tr class="${rowCls}">
        <td class="pub-td-wide pub-nowrap"><span class="rag rag-${ragClass} pub-text-xs-nowrap">${esc(v.label)}</span></td>
        <td class="pub-td-wide">${esc(v.description)}</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h3 id="methodology-7r" data-i18n-key="block.methodology.7r_title">Migration Strategy Guide (7R)</h3>
  <p class="pub-lh-7">The 7R migration strategy is derived from the assessment findings by the SYNTH pass. It summarises the recommended approach for migrating this application to the sovereign cloud.</p>
  <table class="severity-legend-table pub-table-base">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-th-wide-left">Strategy</th>
        <th class="pub-th-wide-left">Description</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(SEVEN_R_DESCRIPTIONS).filter(([k]) => k !== 'Re-platform').map(([strategy, desc], i) => {
        const rowCls = i % 2 === 0 ? 'pub-tr-border' : 'pub-tr-alt';
        return `<tr class="${rowCls}">
        <td class="pub-td-wide pub-nowrap"><span class="badge badge-7r pub-text-xxs-mt">${esc(strategy)}</span></td>
        <td class="pub-td-wide">${esc(desc)}</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: persona-portal
// ---------------------------------------------------------------------------

export function renderPersonaPortal(
  model: PublicationModel,
  params: Record<string, string>,
): string {
  const personaId = params['persona'] ?? 'data-governance';

  // Auto-detect DPO when GDPR is in frameworks
  const hasGdpr = (model.compliance as FrameworkResult[]).some(
    f => f.framework_id.toUpperCase() === 'GDPR',
  );
  const effectivePersona =
    personaId === 'data-governance' && hasGdpr ? 'data-governance' : personaId;

  const PERSONAS: Record<string, {
    name: string;
    badge: string;
    primaryFrameworks: string[];
    prefixes: string[];
  }> = {
    'data-governance': {
      name: 'Data Governance Officer',
      badge: 'DPO View',
      primaryFrameworks: ['GDPR'],
      prefixes: ['DATA'],
    },
    security: {
      name: 'CISO / Security Lead',
      badge: 'Security View',
      primaryFrameworks: ['KRITIS', 'NIS2'],
      prefixes: ['SBOM', 'CRYPTO', 'EGR'],
    },
    'platform-lead': {
      name: 'Platform Lead',
      badge: 'Platform Lead View',
      primaryFrameworks: [],
      prefixes: ['TF', 'EGR'],
    },
    'dev-lead': {
      name: 'Dev Lead / Tech Lead',
      badge: 'Dev Lead View',
      primaryFrameworks: [],
      prefixes: ['SBOM', 'TF'],
    },
  };

  const persona = PERSONAS[effectivePersona] ?? PERSONAS['data-governance'];

  // Stats strip -- filter by primary frameworks
  const relevantFrameworks = (model.compliance as FrameworkResult[]).filter(
    f => persona.primaryFrameworks.includes(f.framework_id.toUpperCase()),
  );
  const totalFail = relevantFrameworks.reduce((a, f) => a + f.fail_count, 0);
  const totalPartial = relevantFrameworks.reduce((a, f) => a + f.partial_count, 0);
  const totalPass = relevantFrameworks.reduce((a, f) => a + f.pass_count, 0);
  const criticalCount = model.summary.signal_counts['critical'] ?? 0;
  const lzrBlockers = model.lzr.blockers;
  const fwLabel = persona.primaryFrameworks.length > 0 ? persona.primaryFrameworks.join('/') : 'All';

  const statsStrip = `<div class="stats-strip pub-meta-panel-light">
    <div class="stat-item stat-critical pub-text-center">
      <div class="stat-item__value pub-num-critical">${totalFail}</div>
      <div class="stat-item__label pub-text-xxs-secondary">${esc(fwLabel)} <span data-i18n-key="rag.fail">Fail</span></div>
    </div>
    <div class="stat-item pub-text-center">
      <div class="stat-item__value pub-num-medium">${totalPartial}</div>
      <div class="stat-item__label pub-text-xxs-secondary">${esc(fwLabel)} <span data-i18n-key="rag.partial">Partial</span></div>
    </div>
    <div class="stat-item pub-text-center">
      <div class="stat-item__value pub-num-positive">${totalPass}</div>
      <div class="stat-item__label pub-text-xxs-secondary">${esc(fwLabel)} <span data-i18n-key="rag.pass">Pass</span></div>
    </div>
    <div class="stat-item pub-text-center">
      <div class="stat-item__value pub-num-critical">${criticalCount}</div>
      <div class="stat-item__label pub-text-xxs-secondary"><span data-i18n-key="severity.critical">Critical</span></div>
    </div>
    <div class="stat-item pub-text-center">
      <div class="stat-item__value pub-num-neutral">${lzrBlockers}</div>
      <div class="stat-item__label pub-text-xxs-secondary">LZR Blockers</div>
    </div>
  </div>`;

  // Action list -- top 3 signals matching persona prefixes
  const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4, positive: 5 };
  const relevantSignals = (model.signals as PubSignal[])
    .filter(s =>
      persona.prefixes.length === 0 ||
      persona.prefixes.some(p => s.id.startsWith(p)),
    )
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
    .slice(0, 3);

  const actionItems = relevantSignals
    .map(s => {
      const iconColour =
        s.severity === 'critical' ? 'var(--colour-critical)' :
          s.severity === 'high' ? 'var(--colour-high)' :
            s.severity === 'medium' ? 'var(--colour-medium)' : 'var(--colour-low)';
      return `    <li class="action-item pub-action-item">
      <span class="action-item__icon" style="--icon-color:${iconColour}" class="pub-action-icon">&#11044;</span>
      <div class="action-item__body pub-flex-1">
        <div class="pub-bold">${esc(s.derivation.substring(0, 120))}</div>
        <div class="pub-text-sm-mt2">
          <a href="#signal-${esc(s.id)}">${esc(s.id)}</a>
          ${sevBadge(s.severity)}
        </div>
      </div>
    </li>`;
    })
    .join('\n');

  const actionList = relevantSignals.length > 0
    ? `<h3 data-i18n-key="block.persona_portal.your_actions_title" class="pub-mt-5">Your Top Actions</h3>
  <ul class="action-list pub-list-reset">
${actionItems}
  </ul>` : '';

  // Quicknav grid -- 6 cards
  const quicknavItems = [
    { href: '#compliance-regime', icon: '&#9878;', title: relevantFrameworks.length > 0 ? (relevantFrameworks[0]?.framework_id ?? 'Compliance') : 'Compliance', desc: 'View compliance controls' },
    { href: '#signal-list', icon: '&#9888;', title: 'Signals', desc: 'Review all assessment signals' },
    { href: '#risk-register', icon: '&#128203;', title: 'Risks', desc: 'View risk register' },
    { href: '#evidence-gallery', icon: '&#128193;', title: 'Evidence', desc: 'Browse evidence artefacts' },
    { href: '#lzr-summary', icon: '&#127981;', title: 'LZR', desc: 'Landing zone readiness' },
    { href: '#exec-summary', icon: '&#9776;', title: 'Summary', desc: 'Executive summary' },
  ];

  const quicknavHtml = quicknavItems
    .map(card => `    <a href="${esc(card.href)}" class="quicknav-card pub-quicknav-card">
      <div class="quicknav-card__icon pub-text-xl-mb">${card.icon}</div>
      <div class="quicknav-card__title pub-text-md-bold2">${esc(card.title)}</div>
      <div class="quicknav-card__desc pub-subtext-mt">${esc(card.desc)}</div>
    </a>`)
    .join('\n');

  // Context callout
  const contextCallout = totalFail > 0
    ? `<div class="callout callout-critical pub-mb-4">
    <strong data-i18n-key="block.persona_portal.context_heading">What this means for you:</strong>
    ${totalFail} compliance control(s) have failed for frameworks relevant to this role. Review the action list below.
  </div>` : '';

  return `<section id="persona-portal" class="swao-block swao-block--persona-portal">
  <h2 id="persona-portal-h" data-i18n-key="block.persona_portal.title">Stakeholder View</h2>
  <div class="pub-flex-row-tags">
    <h3 class="pub-m-0">${esc(persona.name)}</h3>
    <span class="badge badge-neutral">${esc(persona.badge)}</span>
  </div>
  <p class="pub-text-sm-secondary-mb">
    ${esc(model.meta.app_name)} &middot; ${esc(model.meta.engagement.engagement_name)} &middot; ${esc(model.meta.assessed_at)}
  </p>
  ${contextCallout}
  ${statsStrip}
  ${actionList}
  <h3 data-i18n-key="block.persona_portal.quick_nav_title" class="pub-mt-5">Quick Navigation</h3>
  <div class="quicknav-grid pub-grid-140">
${quicknavHtml}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: footer
// ---------------------------------------------------------------------------

export function renderFooter(model: PublicationModel): string {
  const { swao_version, licensee, run_id } = model.meta;
  const cfg = pubCfg(model);
  const classificationBand = cfg.classification_band ?? 'SWAO - Sovereign Workload Assessment & Onboarding';
  const footerNote = cfg.footer_note ?? '';
  const date = new Date().toISOString().split('T')[0];
  const githubUrl = cfg.github_url ?? 'https://github.com/Accenture/SWAO';

  return `<footer id="footer" class="swao-block swao-block--footer pub-mt-12">
  <p class="pub-panel-empty">
    <span data-i18n-key="block.footer.generated_by">Generated by</span> <a href="${esc(githubUrl)}" target="_blank" rel="noopener" class="pub-text-accent">SWAO</a> ${esc(swao_version)} on ${esc(date)}.
    <span data-i18n-key="block.footer.run">Run</span>: ${esc(run_id)}.
    <span data-i18n-key="block.footer.licensee">Licensee</span>: ${esc(licensee)}.${footerNote ? ` ${esc(footerNote)}` : ''}
  </p>
  <div class="band band-bottom" role="contentinfo" aria-label="Classification">${esc(classificationBand)}</div>
</footer>`;
}

// ---------------------------------------------------------------------------
// Block: toc
// ---------------------------------------------------------------------------

export function renderToc(params: Record<string, string>): string {
  const slots = (params['slots'] ?? '').split(',').filter(Boolean);

  const items = slots
    .map(
      s =>
        `  <li><a href="#${esc(s)}">${esc(s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</a></li>`,
    )
    .join('\n');

  return `<section id="toc" class="swao-block swao-block--toc">
  <h2 id="toc-h" data-i18n-key="block.toc.title">Contents</h2>
  <ol>
${items}
  </ol>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: runbook
// ---------------------------------------------------------------------------

export function renderRunbook(model: PublicationModel): string {
  if (model.runbook.length === 0) {
    return `<section id="runbook" class="swao-block swao-block--runbook">
  <h2 id="runbook-h" data-i18n-key="block.runbook.title">Remediation Runbook</h2>
  <div class="callout callout-info"><span data-i18n-key="block.runbook.no_steps">No runbook steps generated for this run.</span></div>
</section>`;
  }

  const steps = model.runbook
    .map(step => {
      const sigIds = (step as { signals?: string[] }).signals ?? [];
      const sigPills = sigIds.map(sid => {
        const s = (model.signals as PubSignal[]).find(sig => sig.id === sid);
        const sev = esc(s?.severity ?? '');
        const deriv = esc((s?.derivation ?? '').slice(0, 120));
        return `<a href="#signal-${esc(sid)}" data-signal-id="${esc(sid)}" data-signal-severity="${sev}" data-signal-derivation="${deriv}" onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(sid)}');return false;" class="pub-ctrl-tag">${esc(sid)}</a>`;
      }).join(' ');
      const signalsRow = sigPills ? `<div class="pub-subtext-mt2"><span class="pub-label-bold">Addresses:</span> ${sigPills}</div>` : '';
      return `  <li class="pub-panel-full-mb">
    <strong>${esc(step.title)}</strong>
    <p class="pub-text-base-secondary-mt">${esc(step.description)}</p>
    ${signalsRow}
  </li>`;
    })
    .join('\n');

  return `<section id="runbook" class="swao-block swao-block--runbook">
  <h2 id="runbook-h" data-i18n-key="block.runbook.title">Remediation Runbook</h2>
  <ol class="pub-list-none">
${steps}
  </ol>
</section>`;
}

// ---------------------------------------------------------------------------
// Block: delta-view
// ---------------------------------------------------------------------------

export function renderDeltaView(model: PublicationModel): string {
  if (!model.delta) {
    return `<section id="delta-view" class="swao-block swao-block--delta-view">
  <h2 id="delta-view-h" data-i18n-key="block.delta_view.title">Assessment Delta</h2>
  <div class="callout callout-info"><span data-i18n-key="block.delta_view.no_delta">No prior run available for comparison.</span></div>
</section>`;
  }

  const { new_signals, resolved_signals, changed_signals, run_a, run_b } =
    model.delta;

  // Build expandable signal lists for each delta category
  function deltaSignalList(ids: string[], color: string, label: string, panelId: string, kind: 'new' | 'resolved' | 'changed', priorRunId?: string): string {
    if (ids.length === 0) {
      return `<div id="${panelId}" class="pub-hidden"></div>`;
    }
    const links = ids.map(id => {
      const sig = kind !== 'resolved' ? model.signals.find((s: PubSignal) => s.id === id) : undefined;
      const sev = sig?.severity ?? '';
      const outcome = sig?.outcome ?? '';
      if (kind === 'resolved') {
        const runData = priorRunId ? ` data-signal-run="${esc(priorRunId)}"` : '';
        return `<a href="#run-history" class="chip-resolved"
           data-signal-id="${esc(id)}"${runData}
           onclick="event.preventDefault();window.swaoNavigateToResolvedSignal&&window.swaoNavigateToResolvedSignal('${esc(id)}','${esc(priorRunId ?? '')}');return false;"
           class="pub-chip-resolved">${esc(id)}</a>`;
      }
      const derivation = esc((sig?.derivation ?? '').slice(0, 120));
      return `<a href="#signal-${esc(id)}" class="chip-active"
           data-signal-id="${esc(id)}" data-signal-severity="${esc(sev)}" data-signal-outcome="${esc(outcome)}" data-signal-derivation="${derivation}"
           onclick="event.preventDefault();window.swaoNavigateToSignal&&window.swaoNavigateToSignal('${esc(id)}');return false;"
           class="pub-chip-active">${esc(id)}</a>`;
    }).join('');
    return `<div id="${panelId}" style="display:none;--delta-border:${color}" class="pub-delta-panel">
      <p class="pub-label-xs-mb">${label} (${ids.length})</p>
      <div class="pub-flex-chips">${links}</div>
    </div>`;
  }

  // new_signals/resolved_signals/changed_signals are string[] (signal IDs directly)
  // per publication-model.schema.json delta section.
  const extractIds = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map(s => (typeof s === 'string' ? s : (s as Record<string,string>).id ?? (s as Record<string,string>).signal_id ?? '')).filter(Boolean);
  };
  const newIds = extractIds(new_signals);
  const resolvedIds = extractIds(resolved_signals);
  const changedIds = extractIds(changed_signals);

  // #0505: build comma-separated ID strings for swaoHighlightSignals calls
  const newIdsJoined = newIds.join(',');
  const changedIdsJoined = changedIds.join(',');

  return `<section id="delta-view" class="swao-block swao-block--delta-view">
  <h2 id="delta-view-h" data-i18n-key="block.delta_view.title">Assessment Delta</h2>
  <p class="pub-text-md-secondary">Comparing run <code>${esc(run_a)}</code> to <code>${esc(run_b)}</code>.</p>
  <div class="stats-strip pub-flex-gap-lg">
    <div class="stat-item" role="button" tabindex="0"
      onclick="var p=document.getElementById('delta-new');p.style.display=p.style.display==='none'?'block':'none';${newIds.length > 0 ? `window.swaoHighlightSignals&&window.swaoHighlightSignals('${esc(newIdsJoined)}');` : ''}"
      class="pub-card-click">
      <div class="stat-item__value pub-num-xl-critical">${esc(String(new_signals.length))}</div>
      <div class="stat-item__label pub-text-xs-secondary">NEW SIGNALS</div>
      ${new_signals.length > 0 ? '<div class="pub-text-mini-accent">click to highlight in signal list</div>' : ''}
    </div>
    <div class="stat-item" role="button" tabindex="0"
      onclick="var p=document.getElementById('delta-resolved');p.style.display=p.style.display==='none'?'block':'none';${resolvedIds.length > 0 ? `window.swaoScrollTo&&window.swaoScrollTo('run-history');` : ''}"
      class="pub-card-click">
      <div class="stat-item__value pub-num-xl-positive">${esc(String(resolved_signals.length))}</div>
      <div class="stat-item__label pub-text-xs-secondary">RESOLVED</div>
      ${resolved_signals.length > 0 ? '<div class="pub-text-mini-accent">click to view in run history</div>' : ''}
    </div>
    <div class="stat-item" role="button" tabindex="0"
      onclick="var p=document.getElementById('delta-changed');p.style.display=p.style.display==='none'?'block':'none';${changedIds.length > 0 ? `window.swaoHighlightSignals&&window.swaoHighlightSignals('${esc(changedIdsJoined)}');` : ''}"
      class="pub-card-click">
      <div class="stat-item__value pub-num-xl-medium">${esc(String(changed_signals.length))}</div>
      <div class="stat-item__label pub-text-xs-secondary">CHANGED</div>
      ${changed_signals.length > 0 ? '<div class="pub-text-mini-accent">click to highlight in signal list</div>' : ''}
    </div>
  </div>
  ${deltaSignalList(newIds, 'var(--colour-critical)', 'New signals in this run', 'delta-new', 'new')}
  ${deltaSignalList(resolvedIds, 'var(--colour-positive)', 'Signals resolved since last run', 'delta-resolved', 'resolved', run_a)}
  ${deltaSignalList(changedIds, 'var(--colour-medium)', 'Signals with changed severity or outcome', 'delta-changed', 'changed')}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: appendix-raw-wsp
// ---------------------------------------------------------------------------

export function renderAppendixRawWsp(
  params: Record<string, string>,
  model: PublicationModel,
): string {
  if (params['enabled'] !== 'true') return '';

  return `<section id="appendix-raw-wsp" class="swao-block swao-block--appendix-raw-wsp">
  <h2 id="appendix-raw-wsp-h" data-i18n-key="block.appendix_raw_wsp.title">Raw WSP Metadata</h2>
  <details>
    <summary>Raw WSP metadata</summary>
    <pre class="pub-card-overflow">${esc(JSON.stringify(model.meta, null, 2))}</pre>
  </details>
</section>`;
}
