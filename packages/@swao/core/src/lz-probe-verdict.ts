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

// #4399: the `swao lz probe` scope line printed the verdict after the identity
// ("identity groups: read-only admin, admin, read-only refused"), so with an
// identity that is itself a comma list the verdict read as one more group, and
// "refused" was printed for a login the operator had just accepted for the run.
// The scope line now carries only the verdict, in the words of the TUI
// (tui-kit StatusLabel WRITE_CAPABLE_ACCEPTED), and the identity goes on its own
// indented line. The TUI parsers (Connections step, LZ Live screen, Setup Wizard
// probe step) read the line back with parseLzProbeScopeLine.

export type LzProbeReadOnly = 'verified' | 'refused' | 'unverifiable';

/** The TUI text of an accepted write-capable login (tui-kit WRITE_CAPABLE_ACCEPTED.text). */
export const LZ_PROBE_WRITE_CAPABLE_ACCEPTED = 'write-capable, accepted for this run; SWAO only reads';

/** The verdict words of a probe result: what the gate decided for this run, never the raw state alone. */
export function lzProbeVerdictText(readOnly: LzProbeReadOnly, proceed: boolean): string {
  switch (readOnly) {
    case 'verified':
      return 'read-only';
    case 'refused':
      return proceed ? LZ_PROBE_WRITE_CAPABLE_ACCEPTED : 'write-capable, refused (not accepted for this run)';
    case 'unverifiable':
      return proceed ? 'not verifiable, accepted for this run' : 'not verifiable, refused (not accepted for this run)';
    default: {
      const never: never = readOnly;
      return never;
    }
  }
}

/** The read-only state behind a verdict text, or null when the text is no verdict. */
export function lzProbeVerdictState(verdict: string): LzProbeReadOnly | null {
  const v = verdict.trim();
  if (v === 'read-only') return 'verified';
  if (v.startsWith('write-capable')) return 'refused';
  if (v.startsWith('not verifiable')) return 'unverifiable';
  return null;
}

/** The scope line: `scope <id>: read-only check: <verdict>`. */
export function formatLzProbeScopeLine(scopeId: string, readOnly: LzProbeReadOnly, proceed: boolean): string {
  return `scope ${scopeId}: read-only check: ${lzProbeVerdictText(readOnly, proceed)}`;
}

/** The identity line under the scope line. */
export function formatLzProbeIdentityLine(identity: string): string {
  return `  identity: ${identity}`;
}

export interface LzProbeScopeLine {
  scopeId: string;
  readOnly: LzProbeReadOnly;
  /** True when the verdict says the run proceeds (accepted or verified); null for the old line format. */
  accepted: boolean | null;
  /** Identity from the old one-line format; the new format carries it on the `identity:` line. */
  identity?: string;
}

/**
 * Parse one scope line of `swao lz probe` output: the current format
 * (`scope <id>: read-only check: <verdict>`) and the one before #4399
 * (`scope <id>: identity <x>, read-only <state>`). Null for any other line.
 */
export function parseLzProbeScopeLine(raw: string): LzProbeScopeLine | null {
  // No lazy group before a trailing whitespace run (CodeQL js/polynomial-redos): trim instead.
  const cur = /^scope (\S+): read-only check: (.+)$/.exec(raw.trimEnd());
  if (cur) {
    const state = lzProbeVerdictState(cur[2]!);
    if (!state) return null;
    return { scopeId: cur[1]!, readOnly: state, accepted: state === 'verified' || !cur[2]!.includes('refused') };
  }
  const old = /^scope (\S+): identity (.*), read-only (verified|refused|unverifiable)\s*$/.exec(raw);
  if (old) return { scopeId: old[1]!, readOnly: old[3] as LzProbeReadOnly, accepted: null, identity: old[2]! };
  return null;
}

/** The identity of an `identity:` detail line, or null. */
export function parseLzProbeIdentityLine(raw: string): string | null {
  const m = /^\s+identity: (.*)$/.exec(raw);
  return m ? m[1]! : null;
}
