// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3866 (Design 123 section 5.4 AWS, D-16; closes Q-3574-1 of #3574): the
// per-service deny evaluation of service control policies, done in SWAO from
// the SCP documents (`organizations:DescribePolicy` `Content`), never with a
// policy simulator. Pure functions; the reads are in aws-driver.ts.
//
// Only what an SCP certainly denies is claimed (Design 120 section 5.3:
// `restricted` needs policy evidence, a guess is `unknown`):
//   - a `Deny` statement without `Condition` whose `Resource` is `*` (or
//     absent) and whose `Action` names a whole service (`<prefix>:*`) or every
//     action (`*`) restricts that service;
//   - an unconditional `Deny` with `NotAction` restricts every service none of
//     whose actions is listed in `NotAction` (`<prefix>:*` or `<prefix>:Op`);
//   - everything else is not evaluated and counted in `skipped`: statements
//     with a `Condition` (the region-deny pattern `aws:RequestedRegion` with
//     `NotAction` exemptions is region dependent), a single action such as
//     `bedrock:InvokeModel` (the service stays partly usable), a resource
//     scope narrower than `*`, and allow lists (an SCP set without
//     `FullAWSAccess` denies by omission; not claimed).
// SCPs do not apply to the management account (AWS Organizations user guide,
// "Service control policies"); the driver skips the evaluation there.

export interface ScpDenyResult {
  /** Action prefix -> ids of the policies that deny it. */
  denied: Map<string, string[]>;
  /** NotAction denies: every prefix not in the set is denied (policy id -> exempt prefixes). */
  deniedExcept: { policy: string; exempt: Set<string> }[];
  /** Statements that were not evaluated (see the header). */
  skipped: number;
}

type Doc = Record<string, unknown>;
const list = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Prefix of an IAM action (`ec2:RunInstances` -> `ec2`), lower case; null for `*` or a malformed action. */
function prefixOf(action: string): string | null {
  const i = action.indexOf(':');
  return i > 0 ? action.slice(0, i).toLowerCase() : null;
}

/**
 * Evaluate the SCP documents attached to an account and its ancestors.
 * `docs`: policy id -> `Content` (the JSON text). A document that does not
 * parse counts as one skipped statement.
 */
export function evaluateScpDenies(docs: ReadonlyMap<string, string>): ScpDenyResult {
  const out: ScpDenyResult = { denied: new Map(), deniedExcept: [], skipped: 0 };
  const deny = (prefix: string, policy: string): void => {
    const ids = out.denied.get(prefix) ?? [];
    if (!ids.includes(policy)) ids.push(policy);
    out.denied.set(prefix, ids);
  };
  for (const [policy, content] of docs) {
    let doc: Doc;
    try {
      doc = JSON.parse(content) as Doc;
    } catch {
      out.skipped++;
      continue;
    }
    const statements = Array.isArray(doc['Statement']) ? doc['Statement'] : doc['Statement'] !== undefined ? [doc['Statement']] : [];
    for (const raw of statements) {
      const st = (raw !== null && typeof raw === 'object' ? raw : {}) as Doc;
      if (st['Effect'] !== 'Deny') continue;
      const resources = list(st['Resource']);
      const whole = st['Condition'] === undefined && st['NotResource'] === undefined && (resources.length === 0 || resources.every((r) => r === '*'));
      if (!whole) { out.skipped++; continue; }
      if (st['NotAction'] !== undefined) {
        const exempt = new Set(list(st['NotAction']).map(prefixOf).filter((p): p is string => p !== null));
        if (list(st['NotAction']).includes('*')) continue; // denies nothing
        out.deniedExcept.push({ policy, exempt });
        continue;
      }
      let partial = false;
      for (const a of list(st['Action'])) {
        if (a === '*') { deny('*', policy); continue; }
        const p = prefixOf(a);
        if (p !== null && a.slice(p.length + 1) === '*') deny(p, policy);
        else partial = true;
      }
      if (partial) out.skipped++;
    }
  }
  return out;
}

/**
 * IAM action prefixes of a catalogue service code where they differ
 * (Service Authorization Reference vs botocore endpoint prefix). A code not
 * listed uses itself as the prefix.
 */
export const AWS_ACTION_PREFIX_OF: Readonly<Record<string, string>> = {
  monitoring: 'cloudwatch',
  email: 'ses',
  tagging: 'tag',
  'api.ecr': 'ecr',
  'api.sagemaker': 'sagemaker',
  'runtime.sagemaker': 'sagemaker',
  'edge.sagemaker': 'sagemaker',
  'metrics.sagemaker': 'sagemaker',
  'api.detective': 'detective',
  'api.pricing': 'pricing',
  'portal.sso': 'sso',
  'data.iot': 'iot',
  'runtime.lex': 'lex',
  'runtime-v2-lex': 'lex',
  'models.lex': 'lex',
  'streams.dynamodb': 'dynamodb',
};

/** Whether the action prefix of a code is known: listed above, or a code without a dot (endpoint prefix = action prefix). */
const prefixKnown = (code: string): boolean => AWS_ACTION_PREFIX_OF[code] !== undefined || /^[a-z0-9-]+$/.test(code);

/** Ids of the policies that deny a whole service; empty when the SCPs do not certainly deny it. */
export function scpDeniesService(result: ScpDenyResult, serviceCode: string): string[] {
  const prefix = (AWS_ACTION_PREFIX_OF[serviceCode] ?? serviceCode).toLowerCase();
  const ids = [...(result.denied.get('*') ?? []), ...(result.denied.get(prefix) ?? [])];
  // A NotAction deny is claimed only where the prefix is known, so an
  // unmapped code is never restricted by omission from the exemption list.
  if (prefixKnown(serviceCode)) for (const d of result.deniedExcept) if (!d.exempt.has(prefix)) ids.push(d.policy);
  return [...new Set(ids)];
}
