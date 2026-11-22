// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Community frameworks -- cross-map checker (#4058)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4058: the rules of tests/audit-gates/framework-cross-map.gate.mjs, kept
// pure (no imports) so the gate loads this file through Node's type
// stripping and the vitest suite tests it on inline fixtures.
//
// - A `maps_to` id is IN THE LIBRARY when it starts with a framework id or
//   with the stem of a shipped control id (the part before the first `.`,
//   for example `HIPAA_DEMO`), followed by `_`, `.` or `-`, or with the
//   common id prefix of a framework whose ids do not carry its framework id
//   (`BSI_` of IT-Grundschutz, `ECCSF_`, `HIPAA-`; cut back to the last
//   separator, at least four characters). The longest prefix wins. An in-library id
//   must name an existing control; an id named only in a control's
//   `replaces:` list does not count (the reference must move to the new id).
// - Any other id is EXTERNAL (a standard SWAO does not ship, for example the
//   NIST CSF or the HIPAA rule sections): counted, never an error.
// - A known miss is an exact `source -> target` pair listed with a reason;
//   it is reported, not failed. Any other in-library miss fails.
// - Asymmetry: A maps_to B while B does not map back to A. Reported only;
//   one-way relations are legitimate (a narrower scope on one side).
// - An id shipped by several frameworks (a `-demo` variant repeats the ids of
//   its full framework) resolves to all of them: the pair is symmetric when
//   one of them maps back, and the full framework is named as the owner.

export interface CrossMapControl {
  id: string;
  maps_to?: readonly string[];
  replaces?: readonly string[];
}

export interface CrossMapFramework {
  /** Folder name, for example `dora`. */
  dir: string;
  /** `framework.id` of framework-meta.yaml, for example `DORA`. */
  frameworkId: string;
  controls: readonly CrossMapControl[];
}

export interface CrossMapRef {
  from: string;
  fromDir: string;
  to: string;
}

export interface CrossMapMiss extends CrossMapRef {
  /** The in-library framework the target id belongs to (folder name), when known. */
  toDir?: string;
  /** The control that replaced the target id, when the target is a replaced id. */
  replacedBy?: string;
}

export interface CrossMapAsymmetry extends CrossMapRef {
  toDir: string;
}

export interface CrossMapReport {
  frameworks: number;
  controls: number;
  refs: number;
  resolved: number;
  errors: CrossMapMiss[];
  knownMisses: CrossMapMiss[];
  /** External ids by leading segment (`NIST`, `HIPAA`, ...). */
  external: Record<string, number>;
  asymmetric: CrossMapAsymmetry[];
}

/** `source -> target` key of a known miss. */
export const crossMapKey = (from: string, to: string): string => `${from} -> ${to}`;

const SEPARATORS = ['_', '.', '-'];

/** The longest common prefix of `ids`, cut back to and including its last separator ('' when none). */
export function commonIdPrefix(ids: readonly string[]): string {
  if (ids.length === 0) return '';
  let p = ids[0] ?? '';
  for (const id of ids) while (!id.startsWith(p)) p = p.slice(0, -1);
  let cut = -1;
  for (const sep of SEPARATORS) cut = Math.max(cut, p.lastIndexOf(sep));
  return cut < 0 ? '' : p.slice(0, cut + 1);
}

export function checkCrossMaps(frameworks: readonly CrossMapFramework[], knownMisses: ReadonlySet<string> = new Set()): CrossMapReport {
  const byId = new Map<string, { dir: string; control: CrossMapControl }[]>();
  const replacedBy = new Map<string, string>();
  /** Prefixes including their separator, with the owning folder. */
  const prefixes = new Map<string, string>();
  const put = (p: string, dir: string): void => { if (!prefixes.has(p)) prefixes.set(p, dir); };
  for (const f of frameworks) {
    for (const sep of SEPARATORS) put(f.frameworkId + sep, f.dir);
    for (const c of f.controls) {
      const list = byId.get(c.id) ?? [];
      list.push({ dir: f.dir, control: c });
      byId.set(c.id, list);
      for (const r of c.replaces ?? []) replacedBy.set(r, c.id);
      const dot = c.id.indexOf('.');
      if (dot > 0) for (const sep of SEPARATORS) put(c.id.slice(0, dot) + sep, f.dir);
    }
    const common = commonIdPrefix(f.controls.map((c) => c.id));
    if (common.length >= 4) put(common, f.dir);
  }
  /** The owning folder of an id: the full framework before a `-demo` variant. */
  const owner = (id: string): string | undefined => {
    const list = byId.get(id) ?? [];
    return (list.find((x) => !x.dir.endsWith('-demo')) ?? list[0])?.dir;
  };
  const ordered = [...prefixes.entries()].sort((a, b) => b[0].length - a[0].length);
  const libraryOwner = (id: string): string | undefined => ordered.find(([p]) => id.startsWith(p))?.[1];

  const report: CrossMapReport = { frameworks: frameworks.length, controls: byId.size, refs: 0, resolved: 0, errors: [], knownMisses: [], external: {}, asymmetric: [] };
  for (const f of frameworks) {
    for (const c of f.controls) {
      for (const to of c.maps_to ?? []) {
        report.refs++;
        const targets = byId.get(to);
        if (targets) {
          report.resolved++;
          if (!targets.some((t) => (t.control.maps_to ?? []).includes(c.id))) report.asymmetric.push({ from: c.id, fromDir: f.dir, to, toDir: owner(to) ?? '' });
          continue;
        }
        const toDir = libraryOwner(to) ?? (replacedBy.has(to) ? owner(replacedBy.get(to) ?? '') : undefined);
        if (toDir === undefined) {
          const head = to.split(/[_.-]/)[0] ?? to;
          report.external[head] = (report.external[head] ?? 0) + 1;
          continue;
        }
        const miss: CrossMapMiss = { from: c.id, fromDir: f.dir, to, toDir, ...(replacedBy.has(to) ? { replacedBy: replacedBy.get(to) } : {}) };
        if (knownMisses.has(crossMapKey(c.id, to))) report.knownMisses.push(miss);
        else report.errors.push(miss);
      }
    }
  }
  return report;
}

/** Asymmetric references counted per `fromDir -> toDir` pair, largest first. */
export function asymmetryByPair(report: CrossMapReport): [string, number][] {
  const n = new Map<string, number>();
  for (const a of report.asymmetric) {
    const k = `${a.fromDir} -> ${a.toDir}`;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
