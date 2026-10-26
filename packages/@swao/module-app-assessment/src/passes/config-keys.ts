// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3485: the one line-based configuration key tracker for YAML (block style)
// and Java `.properties` files. It replaces the two trackers sprint 153
// introduced: `keyValueLines` (#3424, Pass 06 TF-01 evidence) and
// `configKeysPerLine` (#3422, Pass 02 state and Pass 07 egress). Both remain
// as thin views over `configKeyLines` so their callers are unchanged.
//
// Line-based on purpose: `file:line` evidence needs the position, which a
// YAML parser drops, and the tracker must also read files a YAML parser would
// reject (Helm templates, partial overlays). One linear pass over the lines;
// every regex has bounded quantifiers and no nesting.
//
// The caller chooses the format: TF-01 reads every non-`.properties` file it
// selected as YAML (including `.tpl` ConfigMaps), while the JVM scans give
// non-configuration files no key context at all.

/** Line format of a configuration file. */
export type ConfigKeyFormat = 'yaml' | 'properties';

/**
 * How a line relates to its key:
 *   pair      -- the line declares a key with an inline value;
 *   section   -- the line declares a key without an inline value (a YAML
 *                parent, or a block scalar indicator `|` / `>`);
 *   inherited -- the line has no key of its own and belongs to the closest
 *                parent key (a YAML list item such as `- broker1:9092`, a
 *                folded continuation, a `.properties` continuation line).
 */
export type ConfigKeyLineKind = 'pair' | 'section' | 'inherited';

export interface ConfigKeyLine {
  /** 1-based line number. */
  line: number;
  /** Dotted key path (YAML parents joined with `.`). */
  key: string;
  /** Inline value (trailing ` # comment` removed, trimmed); '' for section and inherited lines. */
  value: string;
  kind: ConfigKeyLineKind;
  /** The line is a YAML list item (`- ...`). */
  listItem: boolean;
}

// Optional list dash (`- `), optional quotes around the key, then `:` followed
// by whitespace or the end of the line (`http://x` is not a key).
const YAML_KEY_RE = /^( *)(- {1,8})?["']?([A-Za-z0-9_.@$/-]{1,120})["']?[ \t]*:(?:[ \t]+(.*))?$/;
const PROPERTIES_KEY_RE = /^[ \t]*([^=:\s]{1,200})[ \t]*[=:][ \t]*(.*)$/;

/** Strip a trailing ` # comment` from a YAML value. */
function stripTrailingComment(v: string): string {
  const i = v.indexOf(' #');
  return i >= 0 ? v.slice(0, i) : v;
}

/** True when a `.properties` line continues on the next line (odd number of trailing backslashes). */
function continuesLine(l: string): boolean {
  let n = 0;
  for (let i = l.length - 1; i >= 0 && l.charCodeAt(i) === 92; i--) n++;
  return n % 2 === 1;
}

function propertiesKeyLines(lines: readonly string[]): Array<ConfigKeyLine | null> {
  const out: Array<ConfigKeyLine | null> = new Array<ConfigKeyLine | null>(lines.length).fill(null);
  let continuedKey: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? '').replace(/\r$/, '');
    if (continuedKey !== null) {
      // A continuation line belongs to the key it continues, whatever it looks like.
      out[i] = { line: i + 1, key: continuedKey, value: '', kind: 'inherited', listItem: false };
      if (!continuesLine(l)) continuedKey = null;
      continue;
    }
    const t = l.trim();
    if (t.length === 0 || t.startsWith('#') || t.startsWith('!')) continue;
    const m = PROPERTIES_KEY_RE.exec(l);
    if (!m) continue;
    const key = m[1] ?? '';
    out[i] = { line: i + 1, key, value: (m[2] ?? '').trim(), kind: 'pair', listItem: false };
    if (continuesLine(l)) continuedKey = key;
  }
  return out;
}

function yamlKeyLines(lines: readonly string[]): Array<ConfigKeyLine | null> {
  const out: Array<ConfigKeyLine | null> = new Array<ConfigKeyLine | null>(lines.length).fill(null);
  const stack: Array<{ indent: number; key: string }> = [];
  const path = (): string => stack.map((s) => s.key).join('.');
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? '').replace(/\r$/, '');
    // A new YAML document starts without parents.
    if (/^---/.test(l)) { stack.length = 0; continue; }
    const trimmed = l.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const m = YAML_KEY_RE.exec(l);
    if (m) {
      const indent = (m[1] ?? '').length + (m[2] ?? '').length;
      while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
      stack.push({ indent, key: m[3] ?? '' });
      const value = stripTrailingComment(m[4] ?? '').trim();
      const kind: ConfigKeyLineKind = value === '' || value === '|' || value === '>' ? 'section' : 'pair';
      out[i] = { line: i + 1, key: path(), value: kind === 'pair' ? value : '', kind, listItem: m[2] !== undefined };
      continue;
    }
    // A key-less line (list item, continuation) belongs to the closest parent
    // with a smaller indent. Kafka bootstrap lists depend on this (#3422).
    const indent = l.length - l.trimStart().length;
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
    if (stack.length > 0) out[i] = { line: i + 1, key: path(), value: '', kind: 'inherited', listItem: trimmed.startsWith('-') };
  }
  return out;
}

/**
 * #3485: per-line key context of a YAML or `.properties` file. Index i
 * describes line i + 1; null for blank lines, comments, document markers and
 * lines outside any key. The input lines may carry a trailing `\r`.
 */
export function configKeyLines(format: ConfigKeyFormat, lines: readonly string[]): Array<ConfigKeyLine | null> {
  switch (format) {
    case 'properties': return propertiesKeyLines(lines);
    case 'yaml': return yamlKeyLines(lines);
    default: {
      const never: never = format;
      throw new Error(`unknown configuration format ${String(never)}`);
    }
  }
}

interface NamedFile { name: string; ext: string }

/**
 * #3422 view: dotted configuration key per line (index i is line i + 1), or
 * null for a line without a key context. `.properties`: the key of the line
 * (continuation lines keep it). YAML: the full path from the indentation
 * (`spring:` / `  kafka:` / `    bootstrap-servers: x` gives
 * `spring.kafka.bootstrap-servers`); a list item without its own key
 * (`    - broker:9092`) inherits the path of its parent key. Other files: all
 * null.
 */
export function configKeysPerLine(f: NamedFile, lines: readonly string[]): Array<string | null> {
  const ext = f.ext.toLowerCase();
  const format: ConfigKeyFormat | null = ext === '.properties' ? 'properties' : ext === '.yml' || ext === '.yaml' ? 'yaml' : null;
  if (format === null) return new Array<string | null>(lines.length).fill(null);
  return configKeyLines(format, lines).map((e) => e?.key ?? null);
}

export interface KeyValueLine {
  /** Dotted key (YAML parents joined with `.`). */
  key: string;
  value: string;
  line: number;
}

/**
 * #3424 view: line-numbered `key: value` pairs of a YAML (block style) or
 * properties file, chosen by the file name (`.properties`, otherwise YAML).
 * Keys inside YAML list items (`- name: x`) are not reported: TF-01 reads
 * mapping keys only.
 */
export function keyValueLines(name: string, content: string): KeyValueLine[] {
  const format: ConfigKeyFormat = /\.properties$/i.test(name) ? 'properties' : 'yaml';
  const out: KeyValueLine[] = [];
  for (const e of configKeyLines(format, content.split(/\r?\n/))) {
    if (e !== null && e.kind === 'pair' && !e.listItem) out.push({ key: e.key, value: e.value, line: e.line });
  }
  return out;
}
