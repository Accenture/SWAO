// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * PII guardrail at scaffold time (Design 103 §18.2 G-06, §18.3, #3081).
 *
 * Declared PII columns are read only to compute a presence boolean; the value
 * is dropped immediately. A mapped vendor name that looks like a person's name
 * (rather than a company) is replaced with REDACTED_CONTACT_NAME.
 */

export const REDACTED_CONTACT_NAME = '[contact-name-redacted]';

const CORPORATE_KEYWORDS = /\b(gmbh|ag|se|kg|kgaa|ohg|ug|e\.?v|inc|ltd|llc|plc|corp|corporation|co|company|group|holding|s\.?a|b\.?v|n\.?v|oy|ab|as|srl|spa|healthcare|health|medical|systems?|software|solutions?|technolog(y|ies)|services?|consulting|it|digital|labs?|networks?|international)\b/i;
const TITLE = /^(dr\.?|prof\.?|herr|frau|mr\.?|mrs\.?|ms\.?|dipl\.?[-\w.]*)\s/i;
const WHITESPACE = /\s/;
const isAsciiLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * True when `v` contains an email-like token. Same result as
 * `/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)`: a non-whitespace, non-@ character
 * right before an '@', and in the non-whitespace, non-@ run after it a '.'
 * (not first) followed by two ASCII letters. A scan, because that regex
 * backtracks polynomially on long runs without an '@' (CodeQL js/polynomial-redos).
 * Each character is visited a bounded number of times. Exported for tests.
 */
export function containsEmail(v: string): boolean {
  const isPart = (i: number): boolean => i >= 0 && i < v.length && v[i] !== '@' && !WHITESPACE.test(v[i] as string);
  for (let at = v.indexOf('@'); at >= 0; at = v.indexOf('@', at + 1)) {
    if (!isPart(at - 1) || !isPart(at + 1)) continue;
    for (let i = at + 2; isPart(i); i++) {
      if (v[i] === '.' && isAsciiLetter(v.charCodeAt(i + 1)) && isAsciiLetter(v.charCodeAt(i + 2))) return true;
    }
  }
  return false;
}

const PHONE = /(\+|\b00)\d[\d\s/().-]{6,}\d|\b\d{3,}[\s/-]\d{3,}/;
const NAME_WORD = /^[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?\.?$/;

/**
 * True when `value` looks like a person rather than a company:
 * contains an email or phone number, starts with a personal title, is
 * "Lastname, Firstname", or is 2-3 capitalised words with no corporate keyword.
 * `knownVendors` (INFRA-CAT vendor_patterns) are never treated as personal names.
 */
export function looksLikePersonalName(value: string, knownVendors: readonly string[] = []): boolean {
  const v = value.trim();
  if (!v) return false;
  if (containsEmail(v) || PHONE.test(v)) return true;
  const lower = v.toLowerCase();
  if (knownVendors.some((k) => lower.includes(k.toLowerCase()))) return false;
  if (TITLE.test(v)) return true;
  if (CORPORATE_KEYWORDS.test(v)) return false;
  if (/^[A-ZÄÖÜ][a-zäöüß]+,\s*[A-ZÄÖÜ][a-zäöüß]+$/.test(v)) return true;
  const words = v.split(/\s+/);
  return words.length >= 2 && words.length <= 3 && words.every((w) => NAME_WORD.test(w));
}

/** Presence flags written in place of PII values. */
export interface PiiPresence {
  support_contact_present: boolean;
  support_phone_present: boolean;
  support_email_present: boolean;
}

export function emptyPresence(): PiiPresence {
  return { support_contact_present: false, support_phone_present: false, support_email_present: false };
}
