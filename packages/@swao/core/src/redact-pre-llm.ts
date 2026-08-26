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

// Pre-LLM egress redactor (#0354, sprint-038).
//
// Wraps every prompt before it leaves the SWAO process for an LLM provider.
// See `docs/design/032-pii-egress-control.md` for the full architecture
// (provider-boundary wrap, class list, allowlist file format, audit gate).
//
// This module:
//   - reuses the seven log-export classes from `redact-pii.ts` (email,
//     ipv4, ipv6, url_userinfo, secret_shape, bearer_token, user_path)
//   - adds three pre-LLM classes: business_id, api_key_shape, person_name
//   - reads `.swao-pii-allowlist.txt` (set via setAllowlist) so the
//     operator can pass known-public strings through unredacted
//   - reads the `privacy.scrub_person_name` opt-in flag (set via
//     setScrubPersonName) for sprint-038; person_name is OFF by default
//
// person_name detection is a capitalised-word-pair regex with high
// false-positive rate (would otherwise redact "Active Directory",
// "Sprint Plan", etc.); sprint-039 will replace it with a real NER pass.
// The allowlist file format is stable across the regex / NER switchover.

import { redactPiiString, type RedactionCounts } from './redact-pii.js';

export interface PreLlmRedactionCounts extends RedactionCounts {
  business_id: number;
  api_key_shape: number;
  person_name: number;
}

export function emptyPreLlmCounts(): PreLlmRedactionCounts {
  return {
    email: 0,
    ipv4: 0,
    ipv6: 0,
    url_userinfo: 0,
    secret_shape: 0,
    bearer_token: 0,
    user_path: 0,
    business_id: 0,
    api_key_shape: 0,
    person_name: 0,
  };
}

// US SSN: 3-2-4 digit groups separated by hyphens (avoids matching all
// 9-digit runs which catch ZIP+4 codes, phone numbers, etc.).
const SSN_RE = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

// EU VAT IDs: ISO 2-letter country code + 8-12 alphanumeric. Tightened to
// the common shapes so it does not match arbitrary uppercase strings.
const VAT_RE = /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z]{8,12}\b/g;

// UK National Insurance number: 2 letters + 6 digits + 1 letter (the
// terminal letter is A/B/C/D in the canonical form).
const UK_NI_RE = /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g;

// Passport-shape: 1-2 letters + 6-9 digits (common across many issuers).
// Loose; allowlist suppresses known false positives.
const PASSPORT_RE = /\b[A-Z]{1,2}\d{6,9}\b/g;

// GCP service-account JSON envelope: detects the canonical "type" field value.
// String is split to prevent secret scanners from flagging the detector itself.
// eslint-disable-next-line no-useless-concat
const GCP_SA_RE = new RegExp('"type"\\s*:\\s*"service' + '_account"', 'g');

// Azure connection-string shape: DefaultEndpointsProtocol=...;AccountKey=...
// Quantifiers are bounded (not unbounded `+`) to avoid polynomial-ReDoS on
// untrusted prompt input (CodeQL js/polynomial-redos). The bounds comfortably
// exceed real Azure component lengths (protocol http|https; AccountName <= 24;
// AccountKey base64 ~88), so genuine connection strings still match.
const AZURE_CONN_RE = /DefaultEndpointsProtocol=[^;]{1,32};AccountName=[^;]{1,128};AccountKey=[^;\s]{1,512}/g;

// Person-name candidate: two consecutive Capitalised words. High false
// positive rate; off by default. Sprint-039 replaces with NER.
const PERSON_NAME_RE = /\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/g;

let allowlist: Set<string> = new Set();
let scrubPersonName = false;

/**
 * Replace the in-memory allowlist. Called once at assess-runner startup
 * after reading `.swao-pii-allowlist.txt`. Whitespace-trimmed; empty
 * lines + `#`-prefixed comments are skipped by the caller before
 * passing the array.
 */
export function setAllowlist(entries: readonly string[]): void {
  allowlist = new Set(entries);
}

/**
 * Toggle person_name detection. Default off; opt-in via
 * `.swao.yml -> privacy.scrub_person_name: true`.
 */
export function setScrubPersonName(enabled: boolean): void {
  scrubPersonName = enabled;
}

/**
 * Reset module-level state. Test-only; not for production code paths.
 */
export function _resetForTests(): void {
  allowlist = new Set();
  scrubPersonName = false;
}

/**
 * Apply a regex redactor that respects the allowlist: matches whose
 * substring equals an allowlist entry are restored.
 */
function redactClass(
  input: string,
  re: RegExp,
  replacement: string,
  counts: PreLlmRedactionCounts,
  countKey: keyof PreLlmRedactionCounts,
): string {
  return input.replace(re, (match) => {
    if (allowlist.has(match)) return match;
    counts[countKey] += 1;
    return replacement;
  });
}

/**
 * Apply all ten redactor classes to a string. Shared by redactPreLlm
 * (egress-bound) and redactForReport (write-bound). The two callers
 * differ only in WHERE they apply this -- the scrubbing logic is
 * identical so behaviour cannot drift between LLM-egress and
 * report-output paths.
 */
function scrubAllClasses(input: string): {
  text: string;
  counts: PreLlmRedactionCounts;
} {
  const counts = emptyPreLlmCounts();
  if (typeof input !== 'string' || input.length === 0) {
    return { text: input, counts };
  }

  // Apply the inherited seven classes first; redactPiiString fills in
  // its own RedactionCounts subset which we copy into our extended one.
  // The allowlist is threaded through so operator-furnished known-public
  // strings (e.g. the operator's own email in fixture headers) pass
  // through unredacted even on the inherited classes (sprint-038 #0354
  // post-advisor-review fix).
  const baseCounts: RedactionCounts = {
    email: 0, ipv4: 0, ipv6: 0, url_userinfo: 0,
    secret_shape: 0, bearer_token: 0, user_path: 0,
  };
  let text = redactPiiString(input, baseCounts, allowlist);
  counts.email = baseCounts.email;
  counts.ipv4 = baseCounts.ipv4;
  counts.ipv6 = baseCounts.ipv6;
  counts.url_userinfo = baseCounts.url_userinfo;
  counts.secret_shape = baseCounts.secret_shape;
  counts.bearer_token = baseCounts.bearer_token;
  counts.user_path = baseCounts.user_path;

  // New classes -- allowlist-aware.
  text = redactClass(text, GCP_SA_RE, '[REDACTED-GCP-SA-KEY]', counts, 'api_key_shape');
  text = redactClass(text, AZURE_CONN_RE, '[REDACTED-AZURE-CONN]', counts, 'api_key_shape');
  text = redactClass(text, SSN_RE, '[REDACTED-SSN]', counts, 'business_id');
  text = redactClass(text, VAT_RE, '[REDACTED-VAT]', counts, 'business_id');
  text = redactClass(text, UK_NI_RE, '[REDACTED-UK-NI]', counts, 'business_id');
  text = redactClass(text, PASSPORT_RE, '[REDACTED-PASSPORT]', counts, 'business_id');

  if (scrubPersonName) {
    text = redactClass(text, PERSON_NAME_RE, '[REDACTED-NAME]', counts, 'person_name');
  }

  return { text, counts };
}

/**
 * Redact a prompt destined for an LLM provider. Returns the scrubbed
 * text + per-class counts. The provider records the counts via
 * `recordRedaction` from `redaction-report.ts`; this module does NOT
 * itself write to disk.
 */
export function redactPreLlm(prompt: string): {
  text: string;
  counts: PreLlmRedactionCounts;
} {
  return scrubAllClasses(prompt);
}

/**
 * Redact a string destined for a report output file or terminal
 * display. Identical scrubbing logic to redactPreLlm; exposed as a
 * separate function so the call-site intent is visible at the
 * boundary, and so future divergence (e.g. report-only classes) has
 * a clean seam. See design 032 §13.
 */
export function redactForReport(input: string): {
  text: string;
  counts: PreLlmRedactionCounts;
} {
  return scrubAllClasses(input);
}
