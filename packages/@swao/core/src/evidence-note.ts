/**
 * #4455, #4445: an evidence entry that is an observation, not a file
 * reference: a prose sentence (`Chunks available: 4, all terraform/ snapshots`),
 * a `key=value` record (`msi_skipped_reason=no_msi_inputs`), a `key: k=v`
 * record (`topics: eol-status=high, others=null`) or a text that names a URL
 * inside a sentence. Pass 04 keeps such an entry on the signal as a note and
 * does not resolve it against the workspace; the publication renders it as a
 * muted note, not as an unresolved reference. A path shape (a path separator
 * before the first blank, colon or equals sign, or a known file extension
 * anywhere) is never a note. A bare http(s) URL is checked by the caller first.
 */
const PATH_SEPARATOR_RE = /[\/]/;
const KNOWN_EVIDENCE_EXT_RE = /\.(md|txt|yaml|yml|json|csv|xlsx?|pdf|docx?|tf|tfstate|hcl)\b/i;

export function isEvidenceNote(ref: string): boolean {
  const v = ref.trim();
  if (v === '') return false;
  if (v.includes('://')) return true;
  // #4455: a sentence that starts with a path and goes on in prose
  // ('wsp/inputs/ directory listing shows only terraform/lz-*-snapshot.json and README.md').
  if (isPathLedSentence(v)) return true;
  // A cited file name with blanks ('Architecture Overview v2.docx') stays a reference.
  if (KNOWN_EVIDENCE_EXT_RE.test(v)) return false;
  const firstBreak = v.search(/[\s:=]/);
  const head = firstBreak === -1 ? v : v.slice(0, firstBreak);
  if (PATH_SEPARATOR_RE.test(head)) return false;
  // key=value, the part before the first '=' has no path separator.
  const eq = v.indexOf('=');
  if (eq > 0 && !PATH_SEPARATOR_RE.test(v.slice(0, eq))) return true;
  // #4465: a label before one path-shaped token ('generic-api-key: api/x.rs:12', the
  // secret-scan shape) is a reference to that file.
  const labelled = /^[^\s:]{1,120}:\s+(\S{1,1000})$/.exec(v);
  if (labelled && /\/|\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?$/.test(labelled[1]!)) return false;
  // A colon followed by a blank after a head that is no path ('Chunks available: 4').
  if (/:\s/.test(v)) return true;
  // Several words and no path separator before the first blank.
  return v.split(/\s+/).length >= 3;
}

/** A word of plain prose: letters only, at least two. */
const PROSE_WORD_RE = /^[A-Za-z]{2,}$/;

/**
 * #4455: a path token followed by a blank and a sentence, which no file name
 * is. It is a note when the rest holds a glob (`*`, `?`: names no single
 * file), or at least three prose words after a folder (`wsp/inputs/ directory
 * listing shows ...`) or around a further path (`terraform/ has only
 * lz-snapshot.json files`). A location or description after a file
 * (`other/doc.md section 1 & 11`, `path (image: x)`, `path: columns`) stays a
 * reference; so does a file name with blanks (no further path in the rest).
 */
function isPathLedSentence(v: string): boolean {
  const blank = v.search(/\s/);
  if (blank <= 0) return false;
  const head = v.slice(0, blank);
  const rest = v.slice(blank).trim();
  if (!PATH_SEPARATOR_RE.test(head) || head.endsWith(':') || rest === '' || rest.startsWith('(') || rest.startsWith(':')) return false;
  const words = rest.split(/\s+/);
  if (/[*?]/.test(head) || words.some(w => /[*?]/.test(w))) return true;
  const prose = words.filter(w => PROSE_WORD_RE.test(w)).length;
  if (prose < 3) return false;
  return head.endsWith('/') || words.some(w => PATH_SEPARATOR_RE.test(w));
}
