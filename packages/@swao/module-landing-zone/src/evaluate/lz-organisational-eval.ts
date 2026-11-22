// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- document-only evaluation of organisational
//  controls (Design 120 section 8.4, #4050)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// A Landing Zone Live Assessment runs no Pass 04 or Pass 11, so the
// organisational controls (`layer: governance`) of a framework are decided
// here from the documents of the landing zone ingestion folder
// `landing-zones/<lz-id>/ingestion/` (owner decision 2026-11-07 on #3964,
// option B). Pure: the host routes the folder through Pass 00 and passes the
// document list in, so this module stays free of module-app-assessment.
//
// Rule (deterministic, no LLM; Design 120 section 8.4):
//   N_A        applies_when does not match the workspace framework_context (#3425)
//   SATISFIED  every expected document (`context_input`) is present and readable
//   PARTIAL    some, not all, expected documents are present and readable
//   UNKNOWN    no document in the folder, none named after an expected input,
//              only unreadable matches, or the control names no expected input
// A missing document is never GAP (#3426: missing input is not
// non-compliance) and never a pass. SATISFIED means "documented": SWAO checks
// the document names (the app rule of citesDocumentEvidence) and that text
// could be extracted, not the content, and says so in the rationale.

import { appliesWhenMatches, documentNameMatchesInput, lzOrganisationalCounts, LZ_ORGANISATIONAL_RESULT_SCHEMA } from '@swao/core';
import type { LzOrganisationalControl, LzOrganisationalOutcome, LzOrganisationalReason, LzOrganisationalResult } from '@swao/core';

/** One document of the landing zone ingestion folder, as Pass 00 routed it. */
export interface LzOrganisationalDocument {
  /** Path relative to the ingestion folder, forward slashes (client content: never published). */
  source: string;
  /** Pass 00 category (wsp/inputs/<category>/). */
  category: string;
  /** True when the document or its extracted companion holds text. */
  readable: boolean;
}

/** The catalogue fields the evaluator reads (RegimeControlSchema of @swao/core satisfies it). */
export interface LzOrganisationalCatalogControl {
  id: string;
  title: string;
  severity_default?: LzOrganisationalControl['severity'];
  layer?: string;
  assessment_type_scope?: readonly string[];
  applies_when?: Readonly<Record<string, string>>;
  evidence_basis?: readonly Record<string, unknown>[];
}

export interface LzOrganisationalFrameworkInput {
  id: string;
  version: string;
  controls: readonly LzOrganisationalCatalogControl[];
}

export interface LzOrganisationalEvalInput {
  frameworks: readonly LzOrganisationalFrameworkInput[];
  documents: readonly LzOrganisationalDocument[];
  /** Workspace `.swao.yml` framework_context (applies_when keys). */
  frameworkContext?: Readonly<Record<string, unknown>>;
  /** Workspace-relative folder, for the rationale (`landing-zones/<lz-id>/ingestion`). */
  folder: string;
}

/** An evaluated control with the paths of its matching documents (local only; replaced by references on output). */
export type LzOrganisationalEvaluatedControl = Omit<LzOrganisationalControl, 'evidence_refs'> & { sources: string[] };

export interface LzOrganisationalEvaluation {
  folder: string;
  documents: { total: number; readable: number; matched: number };
  frameworks: { id: string; version: string; controls: LzOrganisationalEvaluatedControl[]; out_of_scope: number }[];
}

/** Organisational controls of a catalogue that a landing zone run evaluates: `layer: governance`, scoped to `lz` (or unscoped). */
export function lzOrganisationalControls<T extends LzOrganisationalCatalogControl>(controls: readonly T[]): T[] {
  return controls.filter((c) => c.layer === 'governance' && ((c.assessment_type_scope ?? []).length === 0 || (c.assessment_type_scope ?? []).includes('lz')));
}

/**
 * #4346: the document names the organisational controls of a catalogue expect
 * (their `context_input` evidence), sorted; the Org Evidence setup step lists
 * them as the file names to use in the ingestion folder.
 */
export function lzOrganisationalExpectedInputs(controls: readonly LzOrganisationalCatalogControl[]): string[] {
  return [...new Set(lzOrganisationalControls(controls).flatMap((c) => contextInputs(c)))].sort();
}

function contextInputs(c: LzOrganisationalCatalogControl): string[] {
  return [...new Set((c.evidence_basis ?? [])
    .map((e) => (typeof e['context_input'] === 'string' ? e['context_input'] : ''))
    .filter((x) => x !== ''))];
}

function decide(c: LzOrganisationalCatalogControl, input: LzOrganisationalEvalInput): LzOrganisationalEvaluatedControl {
  const expected = contextInputs(c);
  const base = { id: c.id, title: c.title, ...(c.severity_default ? { severity: c.severity_default } : {}), expected_inputs: expected };
  const out = (outcome: LzOrganisationalOutcome, reason: LzOrganisationalReason, found: string[], missing: string[], sources: string[], rationale: string): LzOrganisationalEvaluatedControl =>
    ({ ...base, outcome, reason, found_inputs: found, missing_input: missing, sources, rationale });

  if (!appliesWhenMatches(c.applies_when, input.frameworkContext)) {
    const keys = Object.keys(c.applies_when ?? {});
    const cond = keys.map((k) => `${k}: ${c.applies_when?.[k] ?? ''}`).join(', ');
    return out('N_A', 'not_applicable', [], [], [], `Not applicable: the control applies when ${cond}; framework_context in the workspace .swao.yml does not match. Decided by rule.`);
  }
  if (expected.length === 0) {
    return out('UNKNOWN', 'no_expected_input', [], [], [], 'Not evaluated: the control names no expected document (context_input), so a document-only evaluation cannot decide it; a reviewer decides it.');
  }
  if (input.documents.length === 0) {
    return out('UNKNOWN', 'no_documents', [], expected, [],
      `Not evaluated (no organisational documents): ${input.folder}/ holds no document; put documents named after ${expected.join(', ')} there and re-run. Missing evidence is never a pass.`);
  }
  const found: string[] = [];
  const unreadable: string[] = [];
  const sources = new Set<string>();
  for (const name of expected) {
    const matches = input.documents.filter((d) => documentNameMatchesInput(d.source, name));
    const readable = matches.filter((d) => d.readable);
    if (readable.length > 0) {
      found.push(name);
      for (const d of readable) sources.add(d.source);
    } else if (matches.length > 0) {
      unreadable.push(name);
    }
  }
  const missing = expected.filter((n) => !found.includes(n));
  const src = [...sources].sort();
  if (found.length === expected.length) {
    return out('SATISFIED', 'all_documents', found, [], src,
      `Documented: every expected document (${found.join(', ')}) is in ${input.folder}/ and has text. Decided from the document names and readability, not their content; a reviewer confirms the content.`);
  }
  if (found.length > 0) {
    return out('PARTIAL', 'some_documents', found, missing, src,
      `Partly documented: ${found.join(', ')} present in ${input.folder}/; missing input: ${missing.join(', ')}. Decided from the document names and readability, not their content.`);
  }
  if (unreadable.length > 0) {
    return out('UNKNOWN', 'unreadable_document', [], missing, [],
      `Not evaluated: the document(s) named after ${unreadable.join(', ')} have no extractable text (scanned image or protected file); supply a text PDF, DOCX or Markdown file and re-run.`);
  }
  return out('UNKNOWN', 'no_matching_document', [], missing, [],
    `Not evaluated (insufficient evidence; missing input: ${missing.join(', ')}): no document in ${input.folder}/ is named after an expected input. A file counts when its name contains the input name, ignoring case and separators.`);
}

/** Evaluate the organisational controls of every framework from the folder's documents. */
export function evaluateLzOrganisationalControls(input: LzOrganisationalEvalInput): LzOrganisationalEvaluation {
  const frameworks = input.frameworks.map((fw) => ({
    id: fw.id,
    version: fw.version,
    controls: lzOrganisationalControls(fw.controls).map((c) => decide(c, input)),
    // Governance controls the catalogue scopes to other assessment types (app, aud): counted, not decided here.
    out_of_scope: fw.controls.filter((c) => c.layer === 'governance').length - lzOrganisationalControls(fw.controls).length,
  }));
  const matched = new Set(frameworks.flatMap((f) => f.controls.flatMap((c) => c.sources)));
  return {
    folder: input.folder,
    documents: { total: input.documents.length, readable: input.documents.filter((d) => d.readable).length, matched: matched.size },
    frameworks,
  };
}

/**
 * The persisted result: document paths are replaced by their evidence
 * references (`refOf`, from the run's evidence map); a path without a
 * reference is dropped, never written.
 */
export function toLzOrganisationalResult(
  e: LzOrganisationalEvaluation,
  meta: { lzId: string; runId: string; generatedAt: string; refOf: (source: string) => string | undefined },
): LzOrganisationalResult {
  return {
    schema: LZ_ORGANISATIONAL_RESULT_SCHEMA,
    lz_id: meta.lzId,
    run_id: meta.runId,
    generated_at: meta.generatedAt,
    folder: e.folder,
    documents: e.documents,
    frameworks: e.frameworks.map((f) => {
      const controls: LzOrganisationalControl[] = f.controls.map(({ sources, ...c }) => ({
        ...c,
        evidence_refs: sources.map(meta.refOf).filter((r): r is string => r !== undefined),
      }));
      return { id: f.id, version: f.version, controls, counts: lzOrganisationalCounts(controls), out_of_scope: f.out_of_scope };
    }),
  };
}
