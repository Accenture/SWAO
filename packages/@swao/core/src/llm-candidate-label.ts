// #4372: short labels for LLM Assessment candidates (result table, run
// screen, publication). The full connector and model ids stay in a legend.
//
// Rules: the vendor prefix (`mistralai/`, `~vendor/`) and the date suffix
// (`-20251001`, `-2025-10-01`) are dropped, the `claude-` family prefix is
// dropped, version digits are joined (`4-5` becomes `4.5`), words are
// capitalised, and the label is cut to at most 14 characters. Labels that
// collide (same model through two connectors) get the connector id.
// No regular expressions: plain string scans only.

export const CANDIDATE_LABEL_MAX = 14;

const isDigits = (t: string): boolean => t.length > 0 && [...t].every((c) => c >= '0' && c <= '9');

function cut(label: string, max: number): string {
  return label.length <= max ? label : label.slice(0, max).trimEnd();
}

/** Short label of one model id, at most `max` characters. */
export function candidateLabel(model: string, max: number = CANDIDATE_LABEL_MAX): string {
  let id = model.trim();
  const slash = id.lastIndexOf('/');
  if (slash >= 0) id = id.slice(slash + 1);
  const colon = id.indexOf(':');
  if (colon > 0) id = id.slice(0, colon);
  let tokens = id.split('-').filter((t) => t.length > 0);
  // Date suffix: one 8-digit token, or YYYY MM DD as three tokens.
  const last = tokens[tokens.length - 1];
  if (last !== undefined && last.length === 8 && isDigits(last)) {
    tokens = tokens.slice(0, -1);
  } else if (tokens.length >= 3) {
    const [y, m, d] = tokens.slice(-3);
    if (y!.length === 4 && isDigits(y!) && m!.length === 2 && isDigits(m!) && d!.length === 2 && isDigits(d!)) tokens = tokens.slice(0, -3);
  }
  if (tokens.length > 1 && tokens[0]!.toLowerCase() === 'claude') tokens = tokens.slice(1);
  // Join runs of short numeric tokens into a version (4, 5 -> 4.5).
  const words: string[] = [];
  for (const t of tokens) {
    const prev = words[words.length - 1];
    if (prev !== undefined && isDigits(t) && t.length <= 2 && [...prev].every((c) => (c >= '0' && c <= '9') || c === '.') && isDigits(prev.slice(-1))) {
      words[words.length - 1] = `${prev}.${t}`;
    } else {
      words.push(t);
    }
  }
  const label = words.map((w) => (w[0] && w[0] >= 'a' && w[0] <= 'z' ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return cut(label === '' ? model : label, max);
}

/**
 * Labels for every candidate, keyed by leg id; unique within the run.
 * A collision gets the connector id appended (cut to `max`), then a number.
 */
export function candidateLabels(
  legs: ReadonlyArray<{ id: string; connector: string; model: string }>,
  max: number = CANDIDATE_LABEL_MAX,
): Record<string, string> {
  const base = legs.map((l) => candidateLabel(l.model, max));
  const count = (s: string, arr: string[]): number => arr.filter((x) => x === s).length;
  let labels = legs.map((l, i) => {
    if (count(base[i]!, base) === 1) return base[i]!;
    const suffix = ` ${l.connector}`;
    const room = Math.max(1, max - suffix.length);
    return cut(`${cut(base[i]!, room)}${suffix}`, max);
  });
  labels = labels.map((lab, i) => {
    if (count(lab, labels) === 1) return lab;
    const n = ` ${labels.slice(0, i + 1).filter((x) => x === lab).length}`;
    return `${cut(lab, Math.max(1, max - n.length))}${n}`;
  });
  return Object.fromEntries(legs.map((l, i) => [l.id, labels[i]!]));
}
