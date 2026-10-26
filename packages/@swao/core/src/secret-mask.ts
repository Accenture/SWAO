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

// #3415: secret-value masking shared by every SWAO output channel.
//
// SWAO detects secrets (Pass 03 LLM data pass, Pass 14 Gitleaks) and must
// never re-publish the value it found. Two layers use this module
// (Design 032 section 11.6):
//
//   1. Mask at source: a pass that knows the literal value replaces it with
//      maskSecretValue() before the signal leaves the pass (maskKnownSecret).
//   2. Output guard (defence in depth): every writer that turns signals or
//      model text into an artefact (run-dir sweep, HTML publication, chat
//      display and NDJSON, MCP tool results, Power BI export) runs
//      guardSecretText() / guardSecretsDeep(), which masks values that LOOK
//      like secrets: a quoted or assigned value after a credential keyword,
//      vendor token shapes, Bearer tokens, URL passwords, Azure account keys,
//      PEM private-key bodies and JWTs.
//
// What a masked value keeps: the first two characters (only when the value
// has at least 8 characters) and the length, e.g. `Ab***(12)`; short values
// keep the length only (`***(5)`). The value itself, its tail and any hash
// of it are never emitted, so the mask cannot be used to confirm a guess
// offline beyond the two leading characters.
//
// ReDoS: every pattern is a literal-led alternation with bounded quantifiers
// and no nested repetition, so matching stays linear in the input length.
// No function here logs its input.

/** Values shorter than this keep no leading characters in the mask. */
const MIN_PREFIX_LEN = 8;

/**
 * Mask a secret value: first two characters + `***` + `(length)` for values
 * of 8 or more characters, otherwise `***(length)`. Length counts Unicode
 * code points.
 */
export function maskSecretValue(value: string): string {
  const chars = Array.from(value);
  const len = chars.length;
  if (len >= MIN_PREFIX_LEN) return `${chars.slice(0, 2).join('')}***(${len})`;
  return `***(${len})`;
}

/** True when `value` already carries a SWAO mask or redaction placeholder. */
function isAlreadyMasked(value: string): boolean {
  return value.includes('***') || value.startsWith('[REDACTED');
}

/**
 * Replace every literal occurrence of a known secret in `text` with its
 * mask. Used by passes that hold the detected value (mask at source).
 * Values shorter than 3 characters are ignored: replacing them would
 * corrupt ordinary prose without protecting anything.
 */
export function maskKnownSecret(text: string, secret: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (typeof secret !== 'string' || secret.length < 3) return text;
  if (!text.includes(secret)) return text;
  return text.split(secret).join(maskSecretValue(secret));
}

// ---------------------------------------------------------------------------
// Credential keyword class (context-aware, #3415 fix item 2)
// ---------------------------------------------------------------------------
//
// Keyword (may be the tail of an identifier: dbPassword, DB_PASSWORD) that is
// NOT followed by another letter or digit (so max_tokens, tokens_in,
// passwordHash and password_policy do not match), an optional closing key
// quote ("password": ...), then either
//   - an assignment separator (=, :, =>, :=) and a quoted or bare value, or
//   - prose whitespace (optionally "is"/"ist") and a QUOTED value only
//     (password 'x'), so plain prose such as "password policy" never matches.
// Mirrors the generic rule of scripts/secret-scan.sh, extended to German
// "passwort", pwd, token and key forms.
const CREDENTIAL_RE = new RegExp(
  '(' +
    // secret_value: the Pass 03 field that carries a detected literal (#3415).
    '(?:password|passwort|passwd|pwd|secret|token|api[_-]?key|secret[_-]?key|secret[_-]?value|access[_-]?key|private[_-]?key|client[_-]?secret)' +
    '(?![A-Za-z0-9])' +
    // #3456: the key's closing quote may be backslash-escaped (\"password\": ...).
    '(?:\\\\{1,3}["\']|["\'])?' +
    '(?:[ \\t]{0,3}(?:=>|:=|[:=])[ \\t]{0,3}|[ \\t]{1,3}(?:(?:is|ist|was|lautet)[ \\t]{1,3})?(?=(?:\\\\{1,3})?["\'`]))' +
  ')' +
  '(?:"([^"\\r\\n]{1,256})"|\'([^\'\\r\\n]{1,256})\'|`([^`\\r\\n]{1,256})`' +
  // #3456: values whose quotes are backslash-escaped (password = \"x\" inside a
  // serialised JSON string, or \'x\'). One to three backslashes cover single
  // and double serialisation. The value is a lazy, bounded run of plain
  // characters or backslash escapes other than an escaped quote (so
  // \"ab\\cd\" keeps its inner escape) and ends at the first escaped closing
  // quote. The two alternatives are disjoint by first character, so the match
  // stays bounded and linear.
  '|(\\\\{1,3})"((?:[^"\\\\\\r\\n]|\\\\[^"\\r\\n]){1,256}?)\\\\{1,3}"' +
  '|(\\\\{1,3})\'((?:[^\'\\\\\\r\\n]|\\\\[^\'\\r\\n]){1,256}?)\\\\{1,3}\'' +
  '|([^\\s"\'`,;(){}\\[\\]<>]{4,256}))',
  'gi',
);

/** A bare value that is a code reference, type or placeholder, not a secret. */
function isBareNonSecret(value: string): boolean {
  if (/^[A-Za-z_]+$/.test(value)) return true; // string, null, true, required, None
  if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(value)) return true; // process.env.X, z.string, req.body.pwd
  if (value.startsWith('$') || value.startsWith('%')) return true; // $VAR, ${VAR}, %VAR%
  return false;
}

/** A quoted value that is empty, a placeholder or a template reference. */
function isQuotedNonSecret(value: string): boolean {
  if (value.trim().length === 0) return true;
  if (/^\$\{[^}]{1,128}\}$/.test(value)) return true; // ${ENV_VAR}
  if (/^\{\{[^}]{1,128}\}\}$/.test(value)) return true; // {{ template }}
  if (/^<[^>]{1,128}>$/.test(value)) return true; // <your-password>
  if (/^\*+$/.test(value)) return true; // ****
  return false;
}

/**
 * The credential values in `text` (the values maskCredentials would mask),
 * at least `minLength` characters long, longest first. Lets a pass that
 * holds the scanned source mask those literals wherever the model repeats
 * them, quoted or not (#3415). Never logs the values.
 */
export function extractCredentialValues(text: string, minLength = 6): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(CREDENTIAL_RE)) {
    const quoted = m[2] ?? m[3] ?? m[4] ?? m[6] ?? m[8];
    const bare = m[9];
    const value = quoted ?? bare;
    if (value === undefined || value.length < minLength || isAlreadyMasked(value)) continue;
    if (quoted !== undefined ? isQuotedNonSecret(quoted) : isBareNonSecret(value)) continue;
    out.add(value);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export interface SecretMaskResult {
  text: string;
  /** Number of values masked. */
  count: number;
}

/**
 * Mask credential values that follow a password / secret / token / API-key
 * keyword. Keeps the keyword, separator and quotes; replaces the value with
 * maskSecretValue(). Idempotent: masked values are not masked again.
 */
export function maskCredentials(text: string): SecretMaskResult {
  if (typeof text !== 'string' || text.length === 0) return { text, count: 0 };
  let count = 0;
  const out = text.replace(
    CREDENTIAL_RE,
    (
      m: string,
      lead: string,
      dq?: string,
      sq?: string,
      bq?: string,
      escDqPrefix?: string,
      escDq?: string,
      escSqPrefix?: string,
      escSq?: string,
      bare?: string,
    ) => {
      const quoted = dq ?? sq ?? bq ?? escDq ?? escSq;
      if (quoted !== undefined) {
        if (isAlreadyMasked(quoted) || isQuotedNonSecret(quoted)) return m;
        // #3456: an escaped quote keeps its backslashes, so serialised JSON
        // stays valid after masking.
        let q: string;
        if (dq !== undefined) q = '"';
        else if (sq !== undefined) q = "'";
        else if (bq !== undefined) q = '`';
        else if (escDq !== undefined) q = `${escDqPrefix ?? ''}"`;
        else q = `${escSqPrefix ?? ''}'`;
        count += 1;
        return `${lead}${q}${maskSecretValue(quoted)}${q}`;
      }
      if (bare === undefined || isAlreadyMasked(bare) || isBareNonSecret(bare)) return m;
      count += 1;
      return `${lead}${maskSecretValue(bare)}`;
    },
  );
  return { text: out, count };
}

// ---------------------------------------------------------------------------
// Secret shapes (vendor tokens, Bearer, URL password, Azure key, PEM, JWT)
// ---------------------------------------------------------------------------
//
// The vendor-token alternation mirrors SECRET_SHAPE_RE in redact-pii.ts and
// the repo secret-detection gate (tests/audit-gates/secret-detection.gate.sh);
// here the value is masked instead of replaced by a placeholder, so outputs
// keep a fingerprint for triage.

const VENDOR_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{20,256}|gh[pousr]_[A-Za-z0-9]{30,256}|AKIA[0-9A-Z]{16}|rk_live_[A-Za-z0-9]{24,256})\b/g;
const BEARER_RE = /\b(Bearer[ \t]{1,3})([A-Za-z0-9._~+/=-]{16,1024})/g;
const URL_PASSWORD_RE = /(\b[A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/[^/@\s:]{1,128}:)([^/@\s]{1,256})@/g;
const AZURE_ACCOUNT_KEY_RE = /(AccountKey=)([^;\s"']{8,512})/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,2048}/g;
const PEM_BODY_RE = /(-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----)[A-Za-z0-9+/=\s\\n]{1,8192}?(-----END [A-Z ]{0,20}PRIVATE KEY-----)/g;

/** Mask secret-shaped tokens (see the list above). Idempotent. */
export function maskSecretShapes(text: string): SecretMaskResult {
  if (typeof text !== 'string' || text.length === 0) return { text, count: 0 };
  let count = 0;
  let s = text.replace(PEM_BODY_RE, (_m: string, begin: string, end: string) => {
    count += 1;
    return `${begin}***${end}`;
  });
  s = s.replace(VENDOR_TOKEN_RE, (m: string) => {
    count += 1;
    return maskSecretValue(m);
  });
  s = s.replace(JWT_RE, (m: string) => {
    count += 1;
    return maskSecretValue(m);
  });
  s = s.replace(BEARER_RE, (m: string, lead: string, tok: string) => {
    if (isAlreadyMasked(tok)) return m;
    count += 1;
    return `${lead}${maskSecretValue(tok)}`;
  });
  s = s.replace(URL_PASSWORD_RE, (m: string, lead: string, pw: string) => {
    if (isAlreadyMasked(pw) || pw.startsWith('[REDACTED')) return m;
    count += 1;
    return `${lead}${maskSecretValue(pw)}@`;
  });
  s = s.replace(AZURE_ACCOUNT_KEY_RE, (m: string, lead: string, key: string) => {
    if (isAlreadyMasked(key)) return m;
    count += 1;
    return `${lead}${maskSecretValue(key)}`;
  });
  return { text: s, count };
}

// Evidence IDs (EVD-<SLUG>) are SWAO-derived catalogue keys; rewriting one
// breaks the evidence joins (#3417), so the guard leaves them verbatim.
// Same split as report-scrub.ts; bounded quantifier, linear.
const EVIDENCE_ID_SPLIT_RE = /(\bEVD-[A-Z0-9_-]{2,64})/;

/**
 * Output guard for one string: masks credential values and secret shapes,
 * leaving evidence-ID tokens untouched. Idempotent.
 */
export function guardSecretText(text: string): SecretMaskResult {
  if (typeof text !== 'string' || text.length === 0) return { text, count: 0 };
  const parts = text.split(EVIDENCE_ID_SPLIT_RE);
  let count = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    if (!seg) continue;
    const shapes = maskSecretShapes(seg);
    const creds = maskCredentials(shapes.text);
    parts[i] = creds.text;
    count += shapes.count + creds.count;
  }
  return { text: parts.join(''), count };
}

/**
 * Output guard for a structured value: applies guardSecretText to every
 * string inside objects and arrays (keys are left as they are). Returns a
 * new value when anything changed and the original reference otherwise.
 */
export function guardSecretsDeep<T>(value: T): { value: T; count: number } {
  let count = 0;
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = guardSecretText(v);
      count += r.count;
      return r.count > 0 ? r.text : v;
    }
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) {
      let changed = false;
      const next = v.map((item) => {
        const n = walk(item);
        if (n !== item) changed = true;
        return n;
      });
      return changed ? next : v;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      const n = walk(item);
      if (n !== item) changed = true;
      out[k] = n;
    }
    return changed ? out : v;
  };
  const result = walk(value) as T;
  return { value: result, count };
}
