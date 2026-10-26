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

// #3418: findings integrity for the chat (Design 011 "Findings integrity", Design 080 section 4.4).
//
// The chat must never present a finding stronger than the signal carries. This
// module is the single source both sides share:
//
//   - the MCP server (swao_signals / swao_signal_detail) describes every signal
//     with its evidence kind and detection method and emits one compact index
//     line per signal (`[signal] ...`);
//   - the TUI chat keeps those index lines when it truncates the pre-fetched
//     context, parses them back into entries and runs the post-check on every
//     answer: an answer that cites a signal and escalates its severity, omits
//     that the evidence is test code, or omits the confidence of a
//     pattern-based or low / medium confidence finding gets a deterministic
//     integrity note appended (the model's prose is annotated, never rewritten).

import { z } from 'zod';
import { isTestPath } from './source-scope.js';
import { evidencePaths } from './test-code.js';

/** Where a signal's evidence lives, as the chat states it. */
export type EvidenceKind = 'test-code' | 'production' | 'mixed' | 'document' | 'none';
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ['test-code', 'production', 'mixed', 'document', 'none'];

/** How a signal was detected. */
export type DetectionMethod = 'pattern-match' | 'llm' | 'deterministic' | 'human' | 'unknown';
export const DETECTION_METHODS: readonly DetectionMethod[] = ['pattern-match', 'llm', 'deterministic', 'human', 'unknown'];

export type IntegritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'positive';
const SEVERITY_LADDER: readonly IntegritySeverity[] = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];

/** The fields of a raw pass / service signal the integrity description reads (YAML, so unknown-typed). */
export interface IntegritySignalInput {
  id?: unknown;
  code?: unknown;
  severity?: unknown;
  severity_original?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  test_code?: unknown;
  assessor?: unknown;
  source?: unknown;
  provenance?: unknown;
}

/**
 * Rule-engine passes whose signals come from text pattern matching rather than
 * from parsed structure: Pass 08 crypto (regex over source), Pass 14 malware /
 * secret scan (YARA, Gitleaks rules) and Pass 21 IAM (env-var patterns). Every
 * other rule-engine signal (INV, STATE, SBOM, TF, EGR dependency rules, ...)
 * is deterministic.
 */
export const PATTERN_MATCH_PREFIXES: ReadonlySet<string> = new Set(['CRYPTO', 'MAL', 'IAM']);

/** Signal sources that are documents or records, not code (workshop notes, CMDB, FinOps, runbooks). */
const DOCUMENT_SOURCES: ReadonlySet<string> = new Set([
  'workshop', 'cmdb', 'cmdb_export', 'finops', 'incident', 'ops_runbook', 'ops_runbooks',
]);

const DOCUMENT_EXT_RE = /\.(md|markdown|pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp|html?)$/i;
const SWAO_ARTEFACT_RE = /^(?:apps\/[^/]+\/)?(?:wsp|signals)\//i;

function asSeverity(v: unknown): IntegritySeverity | undefined {
  return typeof v === 'string' && (SEVERITY_LADDER as readonly string[]).includes(v) ? (v as IntegritySeverity) : undefined;
}

function evidenceStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((e) => String(e)) : [];
}

function signalPrefix(s: IntegritySignalInput): string {
  const id = typeof s.id === 'string' ? s.id : typeof s.code === 'string' ? s.code : '';
  return (id.split(/[-.]/)[0] ?? '').toUpperCase();
}

/**
 * Evidence kind of a signal.
 *   - `test-code` when #3403 marked it (`test_code: true`: full scope rules incl.
 *     build files and operator patterns) or every code path it cites is test code
 *     by the built-in rules (isTestPath; the default `include` mode sets no marker);
 *   - `mixed` when it cites test and production code;
 *   - `production` when it cites code outside test folders;
 *   - `document` when it cites only documents (.md, .pdf, .docx, .xlsx, ...) or
 *     has no file path but a document source (workshop, CMDB, FinOps, runbook);
 *   - `none` when it cites no file at all.
 * `sourceRoot` makes absolute evidence paths relative before classification, so
 * a test folder above the workspace never flips the result.
 */
export function signalEvidenceKind(s: IntegritySignalInput, sourceRoot?: string): EvidenceKind {
  if (s.test_code === true) return 'test-code';
  const paths = evidenceStrings(s.evidence).flatMap((e) => evidencePaths(e, sourceRoot));
  // SWAO's own artefacts (service-app signal files under signals/ or wsp/) are records, not code.
  const codePaths = paths.filter((p) => !DOCUMENT_EXT_RE.test(p) && !SWAO_ARTEFACT_RE.test(p));
  if (codePaths.length === 0) {
    if (paths.length > 0) return 'document';
    return typeof s.source === 'string' && DOCUMENT_SOURCES.has(s.source) ? 'document' : 'none';
  }
  const test = codePaths.filter((p) => isTestPath(p)).length;
  if (test === 0) return 'production';
  if (test === codePaths.length) return 'test-code';
  return 'mixed';
}

/**
 * Detection method of a signal: the assessor (#0172) and provenance (#0478)
 * first, then the pattern-match pass table, then `unknown` (legacy signal
 * without assessor or provenance, never guessed as deterministic).
 */
export function signalDetectionMethod(s: IntegritySignalInput): DetectionMethod {
  const prov = s.provenance !== null && typeof s.provenance === 'object' ? (s.provenance as Record<string, unknown>)['source'] : undefined;
  if (s.assessor === 'human' || s.assessor === 'human_override') return 'human';
  if (s.assessor === 'llm' || s.source === 'llm_inference') return 'llm';
  if (typeof prov === 'string' && prov.length > 0 && prov !== 'rule_engine') return 'llm';
  const ruleEngine = s.assessor === 'rule_engine' || prov === 'rule_engine';
  if (PATTERN_MATCH_PREFIXES.has(signalPrefix(s)) && (ruleEngine || s.assessor === undefined)) return 'pattern-match';
  return ruleEngine ? 'deterministic' : 'unknown';
}

/** Confidence as text: 'high' | 'medium' | 'low' (v0.10+) or a legacy 0-1 number; '--' when missing. */
export function signalConfidenceLabel(s: IntegritySignalInput): string {
  if (typeof s.confidence === 'number') return s.confidence.toFixed(2);
  return typeof s.confidence === 'string' && s.confidence.length > 0 ? s.confidence : '--';
}

/**
 * Severity as the signal carries it. A #3403 `tag`-mode signal shows the
 * lowered severity first and the assessed one in brackets, so the model does
 * not "restore" the higher value.
 */
export function signalSeverityLabel(s: IntegritySignalInput): string {
  const sev = typeof s.severity === 'string' && s.severity.length > 0 ? s.severity : '--';
  const orig = asSeverity(s.severity_original);
  if (orig && orig !== s.severity) return `${sev} (assessed ${orig}, lowered one step: test code only)`;
  return sev;
}

// ---------------------------------------------------------------------------
// Compact index lines (survive context truncation)
// ---------------------------------------------------------------------------

export const SIGNAL_INDEX_PREFIX = '[signal] ';

export const SignalIndexEntrySchema = z.object({
  id: z.string().min(1),
  app: z.string().optional(),
  severity: z.string().min(1),
  severityOriginal: z.string().optional(),
  confidence: z.string().min(1),
  evidenceKind: z.enum(['test-code', 'production', 'mixed', 'document', 'none']),
  detection: z.enum(['pattern-match', 'llm', 'deterministic', 'human', 'unknown']),
  firstEvidence: z.string(),
});
export type SignalIndexEntry = z.infer<typeof SignalIndexEntrySchema>;

/** Index entry of a raw signal (id falls back to the service-signal code). */
export function signalIndexEntry(s: IntegritySignalInput, opts: { app?: string; sourceRoot?: string } = {}): SignalIndexEntry {
  const id = typeof s.id === 'string' && s.id ? s.id : typeof s.code === 'string' && s.code ? s.code : '?';
  const orig = asSeverity(s.severity_original);
  const sev = typeof s.severity === 'string' && s.severity.length > 0 ? s.severity : '--';
  const first = evidenceStrings(s.evidence)[0]?.trim() ?? '';
  return {
    id,
    ...(opts.app ? { app: opts.app } : {}),
    severity: sev,
    ...(orig && orig !== sev ? { severityOriginal: orig } : {}),
    confidence: signalConfidenceLabel(s),
    evidenceKind: signalEvidenceKind(s, opts.sourceRoot),
    detection: signalDetectionMethod(s),
    firstEvidence: first.replace(/\s+/g, ' ').slice(0, 200),
  };
}

/** `[signal] CRYPTO-01 | app: x | severity: medium (assessed high) | confidence: low | evidence: test-code | detection: pattern-match | first evidence: src/test/A.java:12` */
export function formatSignalIndexLine(e: SignalIndexEntry): string {
  const sev = e.severityOriginal ? `${e.severity} (assessed ${e.severityOriginal})` : e.severity;
  const parts = [
    `${SIGNAL_INDEX_PREFIX}${e.id}`,
    ...(e.app ? [`app: ${e.app}`] : []),
    `severity: ${sev}`,
    `confidence: ${e.confidence}`,
    `evidence: ${e.evidenceKind}`,
    `detection: ${e.detection}`,
    `first evidence: ${e.firstEvidence || '(none)'}`,
  ];
  return parts.join(' | ');
}

/** True for a compact index line (leading whitespace tolerated). */
export function isSignalIndexLine(line: string): boolean {
  return line.trimStart().startsWith(SIGNAL_INDEX_PREFIX);
}

/** Parse every compact index line in a text (context or tool output); malformed lines are skipped. */
export function parseSignalIndexLines(text: string): SignalIndexEntry[] {
  const out: SignalIndexEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!isSignalIndexLine(raw)) continue;
    const line = raw.trimStart().slice(SIGNAL_INDEX_PREFIX.length);
    const firstIdx = line.indexOf(' | first evidence: ');
    const head = firstIdx >= 0 ? line.slice(0, firstIdx) : line;
    const firstEvidence = firstIdx >= 0 ? line.slice(firstIdx + ' | first evidence: '.length).trim() : '';
    const [id, ...fields] = head.split(' | ');
    const kv: Record<string, string> = {};
    for (const f of fields) {
      const c = f.indexOf(': ');
      if (c > 0) kv[f.slice(0, c).trim()] = f.slice(c + 2).trim();
    }
    const sevMatch = /^(\S+)(?:\s+\(assessed\s+(\S+?)\))?$/.exec(kv['severity'] ?? '');
    const parsed = SignalIndexEntrySchema.safeParse({
      id: (id ?? '').trim(),
      ...(kv['app'] ? { app: kv['app'] } : {}),
      severity: sevMatch?.[1],
      ...(sevMatch?.[2] ? { severityOriginal: sevMatch[2] } : {}),
      confidence: kv['confidence'],
      evidenceKind: kv['evidence'],
      detection: kv['detection'],
      firstEvidence: firstEvidence === '(none)' ? '' : firstEvidence,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Merge index entries, the newer entry wins per app + id. */
export function mergeSignalIndex(base: readonly SignalIndexEntry[], add: readonly SignalIndexEntry[]): SignalIndexEntry[] {
  const map = new Map<string, SignalIndexEntry>();
  for (const e of [...base, ...add]) map.set(`${e.app ?? ''}\u0000${e.id.toUpperCase()}`, e);
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Answer post-check
// ---------------------------------------------------------------------------

export type IntegrityIssueKind = 'severity-escalation' | 'urgency-escalation' | 'test-code-unstated' | 'confidence-unstated';

export interface IntegrityIssue {
  signalId: string;
  kind: IntegrityIssueKind;
  /** The wording that triggered the issue (escalations only). */
  wording?: string;
}

/** Severity words in English and German mapped to the ladder (stronger first). */
const SEVERITY_WORDS: ReadonlyArray<{ re: RegExp; sev: IntegritySeverity; needsContext: boolean }> = [
  { re: /\b(critical|kritisch\w*)\b/gi, sev: 'critical', needsContext: false },
  { re: /\b(high|hoch|hohe[nmrs]?)\b/gi, sev: 'high', needsContext: true },
  { re: /\b(medium|moderate|mittel\w*)\b/gi, sev: 'medium', needsContext: true },
];

/** 'high' / 'medium' count as a severity claim only next to one of these ("high availability" does not). */
const SEVERITY_CONTEXT_RE = /severity|risk|priority|finding|issue|schwere|risiko|priorit|befund/i;

/** A severity word directly after ("confidence: high", "Konfidenz hoch") or before ("high confidence") one of these describes confidence, not severity. */
const CONFIDENCE_BEFORE_RE = /(confiden\w*|konfidenz|vertrauen|certainty|gewissheit)\W{0,3}(?:(?:is|ist|of)\s+)?$/i;
const CONFIDENCE_AFTER_RE = /^[\s-]{0,2}(confiden|konfidenz|vertrauen|certainty|gewissheit)/i;

/** Remediation demands that overstate a test-code or low-severity finding. */
const URGENCY_RE = /\b(must be (?:replaced|fixed|removed|remediated|rotated)|immediately|urgent(?:ly)?|sofort|dringend|muss\s+\S+(?:\s+\S+)?\s+(?:ersetzt|behoben|entfernt)\s+werden)\b/i;

const TEST_MENTION_RE = /\btest/i;
const CONFIDENCE_MENTION_RE = /confiden|konfidenz|vertrauen|verif|prüf|pruef|confiance|confianza/i;

function rank(sev: string | undefined): number {
  const i = SEVERITY_LADDER.indexOf((sev ?? '') as IntegritySeverity);
  return i >= 0 ? i : 99;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/**
 * Integrity issues of one chat answer against the signal index. A signal
 * counts as cited when its id appears as a word. Escalation is judged per
 * sentence that cites the signal; a sentence citing several signals is judged
 * against the strongest of them, so a correct summary is never flagged.
 */
export function checkFindingsIntegrity(answer: string, index: readonly SignalIndexEntry[]): IntegrityIssue[] {
  const byId = new Map<string, SignalIndexEntry[]>();
  for (const e of index) {
    const k = e.id.toUpperCase();
    byId.set(k, [...(byId.get(k) ?? []), e]);
  }
  const cited = [...byId.keys()].filter((id) => new RegExp(`(^|[^A-Za-z0-9.-])${escapeRe(id)}(?![A-Za-z0-9])`, 'i').test(answer));
  if (cited.length === 0) return [];
  const sentences = sentencesOf(answer);
  const idRe = (id: string): RegExp => new RegExp(`(^|[^A-Za-z0-9.-])${escapeRe(id)}(?![A-Za-z0-9])`, 'i');
  const issues: IntegrityIssue[] = [];

  for (const id of cited) {
    const entries = byId.get(id) ?? [];
    // Strongest carried severity across apps with the same id (lenient).
    const carried = Math.min(...entries.map((e) => rank(e.severity)));
    const allTest = entries.every((e) => e.evidenceKind === 'test-code');
    const anyTest = entries.some((e) => e.evidenceKind === 'test-code' || e.evidenceKind === 'mixed');
    const weakConfidence = entries.some((e) => e.confidence === 'low' || e.confidence === 'medium' || e.detection === 'pattern-match');

    let escalated = false;
    let urgency = false;
    for (const sentence of sentences.filter((s) => idRe(id).test(s))) {
      const sentenceCarried = Math.min(carried, ...cited.filter((o) => o !== id && idRe(o).test(sentence))
        .flatMap((o) => (byId.get(o) ?? []).map((e) => rank(e.severity))));
      for (const { re, sev, needsContext } of SEVERITY_WORDS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sentence)) !== null) {
          const before = sentence.slice(Math.max(0, m.index - 20), m.index);
          const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 16);
          if (CONFIDENCE_BEFORE_RE.test(before) || CONFIDENCE_AFTER_RE.test(after)) continue;
          const around = sentence.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24);
          if (needsContext && !SEVERITY_CONTEXT_RE.test(around)) continue;
          if (rank(sev) < sentenceCarried && !escalated) {
            issues.push({ signalId: id, kind: 'severity-escalation', wording: m[0] });
            escalated = true;
          }
        }
      }
      const u = URGENCY_RE.exec(sentence);
      if (u && !urgency && (allTest || carried >= rank('low'))) {
        issues.push({ signalId: id, kind: 'urgency-escalation', wording: u[0] });
        urgency = true;
      }
    }
    // Test code and confidence must be stated near the citation: in a sentence
    // citing the signal or in the sentence right after it, so an unrelated
    // "test" elsewhere in the answer does not cover every cited signal.
    const near = sentences
      .flatMap((s, i) => (idRe(id).test(s) ? [s, sentences[i + 1] ?? ''] : []))
      .join(' ');
    if (anyTest && !TEST_MENTION_RE.test(near)) issues.push({ signalId: id, kind: 'test-code-unstated' });
    if (weakConfidence && !CONFIDENCE_MENTION_RE.test(near)) issues.push({ signalId: id, kind: 'confidence-unstated' });
  }
  return issues;
}

function issueText(issue: IntegrityIssue): string {
  switch (issue.kind) {
    case 'severity-escalation': return `the wording "${issue.wording ?? ''}" is stronger than the assessed severity`;
    case 'urgency-escalation': return `the demand "${issue.wording ?? ''}" overstates a finding of this severity or origin`;
    case 'test-code-unstated': return 'the evidence is in test code, not production code';
    case 'confidence-unstated': return 'pattern-based or not high confidence: verify the evidence before acting';
    default: {
      const never: never = issue.kind;
      return String(never);
    }
  }
}

function factsOf(e: SignalIndexEntry): string {
  const sev = e.severityOriginal ? `${e.severity} (assessed ${e.severityOriginal}, lowered: test code only)` : e.severity;
  const evidence = e.evidenceKind === 'test-code' ? 'in test code' : e.evidenceKind;
  return `severity ${sev}, confidence ${e.confidence}, detection ${e.detection}, evidence ${evidence}${e.firstEvidence ? ` (${e.firstEvidence})` : ''}`;
}

/**
 * The answer with a deterministic integrity note appended when the post-check
 * finds issues; unchanged otherwise. The note restates the signal as SWAO
 * carries it; the model's prose is never rewritten.
 */
export function applyFindingsIntegrity(answer: string, index: readonly SignalIndexEntry[]): { text: string; issues: IntegrityIssue[] } {
  const issues = checkFindingsIntegrity(answer, index);
  if (issues.length === 0) return { text: answer, issues };
  const lines: string[] = [];
  for (const id of [...new Set(issues.map((i) => i.signalId))]) {
    const entry = index.find((e) => e.id.toUpperCase() === id);
    const reasons = issues.filter((i) => i.signalId === id).map(issueText).join('; ');
    lines.push(`- ${entry?.id ?? id}${entry?.app ? ` (${entry.app})` : ''}: ${entry ? factsOf(entry) : ''}. ${reasons}.`);
  }
  return {
    text: `${answer.trimEnd()}\n\n[Findings integrity check] As assessed by SWAO:\n${lines.join('\n')}`,
    issues,
  };
}
