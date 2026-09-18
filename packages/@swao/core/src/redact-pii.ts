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

// PII redaction helpers for #0327 Part D -- `swao log export --for-feedback`.
//
// Patterns chosen for the log-export use case:
//   - emails           -> [REDACTED-EMAIL]
//   - IPv4 addresses   -> [REDACTED-IPV4]
//   - IPv6 addresses   -> [REDACTED-IPV6]
//   - URL userinfo     -> https://[REDACTED-USERINFO]@host/path (already at
//                         write time per util/log.ts; re-applied here for safety)
//   - secret-shaped    -> sk-... / ghp_... / gho_... / ghs_... / ghu_... / ghr_...
//   - Bearer tokens    -> Authorization: Bearer [REDACTED-TOKEN]
//   - Windows usernames in paths  C:\Users\<name>\... -> C:\Users\[REDACTED-USER]\...
//   - POSIX home paths            /home/<name>/...    -> /home/[REDACTED-USER]/...
//   - macOS home paths            /Users/<name>/...   -> /Users/[REDACTED-USER]/...
//
// Counts each redaction class for the export's redaction-report.json.

export interface RedactionCounts {
  email: number;
  ipv4: number;
  ipv6: number;
  url_userinfo: number;
  secret_shape: number;
  bearer_token: number;
  user_path: number;
}

export function emptyCounts(): RedactionCounts {
  return {
    email: 0,
    ipv4: 0,
    ipv6: 0,
    url_userinfo: 0,
    secret_shape: 0,
    bearer_token: 0,
    user_path: 0,
  };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// IPv6 (loose; covers full 8-group, the most common ::-collapsed forms, and
// addresses with embedded :: like 2001:db8::1:1). Anchored on hex+colon
// patterns that include at least one colon; `\b` boundaries avoid catching
// time strings like "10:30:45".
const IPV6_RE = /(?:[A-F0-9]{1,4}:){1,7}(?::[A-F0-9]{1,4})+|(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}/gi;
const URL_USERINFO_RE = /(\bhttps?:\/\/)[^/@\s]*@/gi;
// GitHub PAT shapes (classic + fine-grained) + OpenAI sk- + AWS access key id pattern
const SECRET_SHAPE_RE = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|ghu_[A-Za-z0-9]{30,}|ghr_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/g;
const BEARER_RE = /\b(Bearer|Token|Authorization:\s*Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const WIN_USER_PATH_RE = /([Cc]:\\Users\\)([^\\/\r\n\s]+)/g;
const POSIX_HOME_RE = /(\/(?:home|Users)\/)([^/\s]+)/g;

/**
 * Redact known PII shapes in a single string. Increments `counts` for each
 * pattern that matched. Returns the redacted string.
 *
 * @param allowlist Optional set of literal strings that survive
 *                  redaction unchanged. Sprint-038 #0354: lets the
 *                  pre-LLM redactor pass through operator-furnished
 *                  known-public strings (named consultants, public
 *                  IPs) without modifying this function's existing
 *                  log-export callers (they pass no allowlist).
 */
export function redactPiiString(input: string, counts: RedactionCounts, allowlist?: ReadonlySet<string>): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let s = input;
  const onList = (m: string): boolean => allowlist?.has(m) ?? false;

  // URL userinfo must run BEFORE email -- "https://user:ghp_xxx@github.com"
  // contains an @ that the email regex would otherwise eat as
  // "ghp_xxx@github.com", stripping the token AND the host together.
  s = s.replace(URL_USERINFO_RE, (m, scheme) => {
    if (onList(m)) return m;
    counts.url_userinfo += 1;
    return `${scheme}[REDACTED-USERINFO]@`;
  });

  s = s.replace(EMAIL_RE, (m) => {
    if (onList(m)) return m;
    counts.email += 1;
    return '[REDACTED-EMAIL]';
  });

  s = s.replace(SECRET_SHAPE_RE, (m) => {
    if (onList(m)) return m;
    counts.secret_shape += 1;
    return '[REDACTED-SECRET]';
  });

  s = s.replace(BEARER_RE, (m, kind) => {
    if (onList(m)) return m;
    counts.bearer_token += 1;
    return `${kind} [REDACTED-TOKEN]`;
  });

  // User-path redaction runs BEFORE IPv4/IPv6 to avoid the IPv4 RE eating
  // path segments that look like dotted-quad (unlikely but cheap to be safe).
  s = s.replace(WIN_USER_PATH_RE, (m, prefix) => {
    if (onList(m)) return m;
    counts.user_path += 1;
    return `${prefix}[REDACTED-USER]`;
  });

  s = s.replace(POSIX_HOME_RE, (m, prefix) => {
    if (onList(m)) return m;
    counts.user_path += 1;
    return `${prefix}[REDACTED-USER]`;
  });

  s = s.replace(IPV4_RE, (m) => {
    // Skip the 0.0.0.0, 127.0.0.1 loopback and version-like 1.2.3 strings
    // are not handled because IPV4_RE already matches only \b ... \b 4-octet.
    // Also skip if the match looks like a version (e.g., "1.2.3.4" -- looks
    // like an IP, could be a version). For log redaction, we prefer false
    // positives (over-redact a version that looks like an IP) over false
    // negatives (leak a real IP).
    if (m === '0.0.0.0' || m === '127.0.0.1') return m;
    if (onList(m)) return m;
    counts.ipv4 += 1;
    return '[REDACTED-IPV4]';
  });

  s = s.replace(IPV6_RE, (m) => {
    // Skip the loopback ::1 and unspecified ::
    if (m === '::1' || m === '::') return m;
    if (onList(m)) return m;
    // Skip time / date shapes: 2-7 colon-separated all-numeric groups
    // (e.g. "13:00:00", "2026:05:09:14:00:00"). Real IPv6 has 8 groups
    // when fully written; collapsed forms include "::" which the
    // all-numeric check below tolerates. Sprint-038 #0354: ISO 8601
    // timestamps in YAML / JSON were being corrupted by the prior
    // regex which accepted `13:00:00` as an IPv6 address.
    const groups = m.split(':');
    if (groups.length < 8 && !m.includes('::') && groups.every((g) => /^\d{1,4}$/.test(g))) {
      return m;
    }
    counts.ipv6 += 1;
    return '[REDACTED-IPV6]';
  });

  return s;
}

/**
 * Redact known PII shapes in any value (string / object / array / primitive).
 * Recurses into objects + arrays. Increments `counts` per pattern matched.
 */
export function redactPiiValue(value: unknown, counts: RedactionCounts): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactPiiString(value, counts);
  if (Array.isArray(value)) {
    return value.map((v) => redactPiiValue(v, counts));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPiiValue(v, counts);
    }
    return out;
  }
  return value;
}
