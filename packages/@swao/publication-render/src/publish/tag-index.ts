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

import type { PublicationModel, TagIndex, TagIndexEntry } from './model.js';

function addToIndex(
  idx: TagIndex,
  tag: string,
  entry: TagIndexEntry,
): void {
  if (!tag) return;
  const normalised = tag.toLowerCase().replace(/\s+/g, '-');
  if (!idx[normalised]) idx[normalised] = [];
  // Avoid duplicate anchors
  if (!idx[normalised].some(e => e.anchor === entry.anchor)) {
    idx[normalised].push(entry);
  }
}

export function buildTagIndex(model: PublicationModel): TagIndex {
  const idx: TagIndex = {};

  // Signals: severity, pass prefix (first segment), outcome, explicit tags
  for (const signal of model.signals) {
    const base = { anchor: signal.anchor, type: 'signal' as const, label: signal.id };
    addToIndex(idx, signal.severity, base);
    addToIndex(idx, signal.pass.split('-')[0] ?? signal.pass, base);
    addToIndex(idx, signal.outcome, base);
    for (const tag of signal.tags) addToIndex(idx, tag, base);
  }

  // Controls: framework_id, rag_status
  for (const fw of model.compliance) {
    for (const ctrl of fw.controls) {
      const base = { anchor: ctrl.anchor, type: 'control' as const, label: ctrl.id };
      addToIndex(idx, fw.framework_id, base);
      addToIndex(idx, ctrl.rag_status, base);
    }
  }

  // Risks: status, category
  for (const risk of model.risk_register) {
    const base = { anchor: risk.anchor, type: 'risk' as const, label: risk.risk_id };
    addToIndex(idx, risk.status, base);
    addToIndex(idx, risk.category, base);
  }

  // Evidence: type
  for (const ev of model.evidence) {
    const base = { anchor: `evidence-${ev.id}`, type: 'evidence' as const, label: ev.title };
    addToIndex(idx, ev.type, base);
  }

  // Input files: kind
  for (const f of model.input_files) {
    addToIndex(idx, f.kind, {
      anchor: `input-${f.path.replace(/[^a-z0-9]+/gi, '-')}`,
      type: 'input_file',
      label: f.path,
    });
  }

  return idx;
}

interface SearchDoc {
  id: string;    // anchor
  type: string;  // signal | control | risk | evidence | lzr-check | lzr-region | section
  label: string;
  body: string;  // text to search
  /** Optional real HTML anchor for direct navigation (section docs, #1388). */
  anchor?: string;
}

export function buildSearchIndex(model: PublicationModel): string {
  const docs: SearchDoc[] = [];

  for (const signal of model.signals) {
    docs.push({
      id: signal.anchor,
      type: 'signal',
      label: signal.id,
      body: [signal.id, signal.severity, signal.pass, signal.derivation, signal.tags.join(' ')].join(' '),
    });
  }

  for (const fw of model.compliance) {
    for (const ctrl of fw.controls) {
      docs.push({
        id: ctrl.anchor,
        type: 'control',
        label: ctrl.id,
        body: [ctrl.id, ctrl.title, fw.framework_id, ctrl.rationale].join(' '),
      });
    }
  }

  for (const risk of model.risk_register) {
    docs.push({
      id: risk.anchor,
      type: 'risk',
      label: risk.risk_id,
      body: [risk.risk_id, risk.trigger, risk.category, risk.mitigation].join(' '),
    });
  }

  for (const ev of model.evidence) {
    docs.push({
      id: `evidence-${ev.id}`,
      type: 'evidence',
      label: ev.title,
      body: [ev.title, ev.file, ev.type].join(' '),
    });
  }

  // LZR catalog checks -- indexed so provider/region/capability searches work.
  // passthrough fields (provider, region, detail, remediation, signal_ref) are
  // present for lz-catalog publications but not declared in the Zod schema.
  if (model.lzr) {
    for (const [i, check] of model.lzr.checks.entries()) {
      const raw = check as Record<string, unknown>;
      const provider = String(raw['provider'] ?? '');
      const region = String(raw['region'] ?? '');
      const detail = String(raw['detail'] ?? '');
      const remediation = String(raw['remediation'] ?? '');
      const sovereigntyStatement = String(raw['sovereignty_statement'] ?? '');
      docs.push({
        id: `lzr-check-${String(i + 1).padStart(3, '0')}`,
        type: 'lzr-check',
        label: check.label,
        body: [check.id, check.label, check.result, check.signal_ref ?? '', provider, region, detail, remediation, sovereigntyStatement].join(' '),
      });
    }
    // Per-region summaries (multi-target runs).
    const regions = (model.lzr as Record<string, unknown>)['regions'] as Array<Record<string, unknown>> | undefined;
    if (regions) {
      for (const r of regions) {
        const prov = String(r['provider'] ?? '');
        const reg = String(r['region'] ?? '');
        docs.push({
          id: `lzr-region-${prov}-${reg}`,
          type: 'lzr-region',
          label: `${prov} ${reg}`,
          body: [prov, reg, String(r['overall_verdict'] ?? ''), String(r['sovereignty_statement'] ?? '')].join(' '),
        });
      }
    }
  }

  // Emit the flat docs array (not a Lunr serialised index).
  // swao-pub.js does simple substring search over docs for the search overlay.
  // Lunr serialisation produces an opaque object that getSearchDocs() cannot
  // iterate; a flat array is directly usable without a client-side Lunr bundle.
  return JSON.stringify(docs);
}

// Utility: serialise the tag index for inlining as JSON
export function serialiseTagIndex(tagIndex: TagIndex): string {
  return JSON.stringify(tagIndex);
}

// ---------------------------------------------------------------------------
// Full-text section docs (#1388)
// ---------------------------------------------------------------------------
// The typed docs above cover selected model fields only; whole rendered
// sections (executive summary, LZ narratives, block scorecards, remediation
// texts, provider catalogue details) were unsearchable. These docs are
// extracted from the RENDERED page so any string a reader can see is findable.

const SECTION_RE = /<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
const HEADING_RE = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/;
const MAX_SECTION_BODY = 4000;
const MIN_SECTION_BODY = 40;

function htmlToText(fragment: string): string {
  return fragment
    // End-tag matching tolerates any garbage before '>' -- browsers accept
    // e.g. '</script\t\n bar>' as a closing tag (CodeQL js/bad-tag-filter).
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Decode &amp; LAST so '&amp;lt;' yields the literal '&lt;' instead of '<'
    // (CodeQL js/double-escaping).
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSectionSearchDocs(html: string): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const m of html.matchAll(SECTION_RE)) {
    const anchor = m[1]!;
    const inner = m[2]!;
    const body = htmlToText(inner);
    if (body.length < MIN_SECTION_BODY) continue;
    const heading = HEADING_RE.exec(inner);
    const label = heading ? htmlToText(heading[1]!) : anchor;
    docs.push({
      id: `section-${anchor}`,
      type: 'section',
      label: label || anchor,
      body: body.slice(0, MAX_SECTION_BODY),
      anchor,
    });
  }
  return docs;
}

/** Merge the typed model docs JSON with rendered-section docs (#1388).
 *  Falls back to the typed docs unchanged if the JSON is unparseable. */
export function mergeSearchIndexWithSections(searchIndexJson: string, html: string): string {
  try {
    const typed = JSON.parse(searchIndexJson) as unknown[];
    return JSON.stringify([...typed, ...buildSectionSearchDocs(html)]);
  } catch {
    return searchIndexJson;
  }
}
