// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4050 (Design 120 section 8.4, Design 123 section 9.1): result of the
// document-only evaluation of organisational controls (`layer: governance`) in
// a Landing Zone Live Assessment. The documents come from the landing zone
// ingestion folder `landing-zones/<lz-id>/ingestion/`, routed by Pass 00; one
// `lz-organisational.json` per run folder (documents belong to the landing
// zone, not to a scope). The file carries input names (the catalogue's
// `context_input` values) and evidence references only, never a document
// file name: a file name is client content, so it lives only in the local
// evidence map (`evidence-refs.json`, kind `document`). Read by the
// publication, the portfolio merge and the MCP tools.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const LZ_ORGANISATIONAL_RESULT_SCHEMA = 'lz-organisational-result/1';
export const LZ_ORGANISATIONAL_RESULT_FILE = 'lz-organisational.json';

/** Outcomes reuse the compliance vocabulary; GAP is never decided from missing documents (#3426). */
export const LZ_ORGANISATIONAL_OUTCOMES = ['SATISFIED', 'PARTIAL', 'UNKNOWN', 'N_A'] as const;
export const LzOrganisationalOutcomeSchema = z.enum(LZ_ORGANISATIONAL_OUTCOMES);
export type LzOrganisationalOutcome = z.infer<typeof LzOrganisationalOutcomeSchema>;

/**
 * Why a control got its outcome:
 *   all_documents         every expected document is present and readable (SATISFIED)
 *   some_documents        at least one, not every expected document (PARTIAL)
 *   no_documents          the ingestion folder holds no document (UNKNOWN)
 *   no_matching_document  documents exist, none is named after an expected input (UNKNOWN)
 *   unreadable_document   a matching document has no extractable text (UNKNOWN)
 *   no_expected_input     the control names no expected document (UNKNOWN; needs a reviewer)
 *   not_applicable        applies_when does not match framework_context (N_A)
 */
export const LZ_ORGANISATIONAL_REASONS = [
  'all_documents', 'some_documents', 'no_documents', 'no_matching_document', 'unreadable_document', 'no_expected_input', 'not_applicable',
] as const;
export const LzOrganisationalReasonSchema = z.enum(LZ_ORGANISATIONAL_REASONS);
export type LzOrganisationalReason = z.infer<typeof LzOrganisationalReasonSchema>;

const EvidenceRefSchema = z.string().regex(/^ev:[A-Za-z0-9][A-Za-z0-9_.-]{0,80}:.+:Ref-[0-9a-f]{10}$/);

export const LzOrganisationalControlSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
  outcome: LzOrganisationalOutcomeSchema,
  reason: LzOrganisationalReasonSchema,
  /** The control's `context_input` names (catalogue words, never client content). */
  expected_inputs: z.array(z.string().min(1)),
  /** Expected inputs a readable document is named after. */
  found_inputs: z.array(z.string().min(1)),
  /** Expected inputs without a readable document. */
  missing_input: z.array(z.string().min(1)),
  /** References of the matching documents (`ev:<run>:document:Ref-<hex>`); resolved only locally. */
  evidence_refs: z.array(EvidenceRefSchema),
  /** Fixed sentence plus input names; never a file name. */
  rationale: z.string().min(1),
}).strict();
export type LzOrganisationalControl = z.infer<typeof LzOrganisationalControlSchema>;

export const LzOrganisationalCountsSchema = z.object({
  satisfied: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  n_a: z.number().int().nonnegative(),
}).strict();
export type LzOrganisationalCounts = z.infer<typeof LzOrganisationalCountsSchema>;

export const LzOrganisationalFrameworkSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  controls: z.array(LzOrganisationalControlSchema),
  counts: LzOrganisationalCountsSchema,
  /** Organisational controls of the framework not scoped to `lz` (assessment_type_scope without lz): decided in application or audit assessments, not listed in `controls`. */
  out_of_scope: z.number().int().nonnegative().default(0),
}).strict();
export type LzOrganisationalFramework = z.infer<typeof LzOrganisationalFrameworkSchema>;

export const LzOrganisationalResultSchema = z.object({
  schema: z.literal(LZ_ORGANISATIONAL_RESULT_SCHEMA),
  lz_id: z.string().min(1),
  run_id: z.string().min(1),
  generated_at: z.string().min(1),
  /** Workspace-relative folder the documents were read from. */
  folder: z.string().min(1),
  documents: z.object({
    /** Documents Pass 00 routed from the folder. */
    total: z.number().int().nonnegative(),
    /** Documents with extractable text. */
    readable: z.number().int().nonnegative(),
    /** Readable documents named after an expected input of an evaluated control. */
    matched: z.number().int().nonnegative(),
  }).strict(),
  frameworks: z.array(LzOrganisationalFrameworkSchema),
}).strict();
export type LzOrganisationalResult = z.infer<typeof LzOrganisationalResultSchema>;

/** Outcome counts of a control list. */
export function lzOrganisationalCounts(controls: readonly Pick<LzOrganisationalControl, 'outcome'>[]): LzOrganisationalCounts {
  const counts: LzOrganisationalCounts = { satisfied: 0, partial: 0, unknown: 0, n_a: 0 };
  for (const c of controls) {
    switch (c.outcome) {
      case 'SATISFIED': counts.satisfied++; break;
      case 'PARTIAL': counts.partial++; break;
      case 'UNKNOWN': counts.unknown++; break;
      case 'N_A': counts.n_a++; break;
      default: {
        const never: never = c.outcome;
        return never;
      }
    }
  }
  return counts;
}

/** Controls decided from documents (SATISFIED or PARTIAL) across every framework of a result. */
export function lzOrganisationalDecided(r: Pick<LzOrganisationalResult, 'frameworks'>): number {
  return r.frameworks.reduce((n, f) => n + f.counts.satisfied + f.counts.partial, 0);
}

/** Read and validate the organisational result of one run folder; null when absent or invalid. */
export function readLzOrganisationalResult(runDir: string): LzOrganisationalResult | null {
  const p = join(runDir, LZ_ORGANISATIONAL_RESULT_FILE);
  if (!existsSync(p)) return null;
  try {
    const r = LzOrganisationalResultSchema.safeParse(JSON.parse(readFileSync(p, 'utf-8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
