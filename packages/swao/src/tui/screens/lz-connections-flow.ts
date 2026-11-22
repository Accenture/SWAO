// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3589: pure logic of the Landing Zone Connections screen (Design 120
// section 14.2: the Landing Zone Live setup step, #4127), kept
// apart from the Ink component so every step is unit tested. The screen
// drives the CLI, so TUI and CLI stay in parity:
//   Add landing zone / Add scope -> swao lz connect <lz-id> --provider --scope
//                                   --kind --auth [--region] [--target] [--display]
//                                   --credentials-stdin --no-probe
//                                   (values on stdin only, never in argv or a file)
//   Probe read-only + coverage   -> swao lz probe <lz-id> [--scope <id>]
//                                   (never with an accept flag: the write-capable
//                                   confirmation belongs to a run, section 6.3)
//   Migrate legacy credentials   -> swao lz connect ... --move-legacy-credentials
//   Remove scope / landing zone  -> swao lz remove <lz-id> [--scope <id>]
//   List                         -> swao lz list (the screen's list view)

import { LZ_CREDENTIAL_FIELDS, LZ_PROVIDER_ID_PATTERN, LZ_REGISTRATION_ID_PATTERN, LZ_SCOPE_KIND_DEFINITIONS, LZ_SCOPE_KIND_LABELS, lzScopeKindLabel, parseLzProbeIdentityLine, parseLzProbeScopeLine } from '@swao/core';
import type { LzCredentialField } from '@swao/core';
import { LZ_EXPIRED_SESSION_LINE_PREFIX, listWorkspaceApps, appDisplayName } from '@swao/core';
import type { AppKind } from '@swao/core';
import { probeDisplayLevel } from '@swao/module-landing-zone';
import { WRITE_CAPABLE_ACCEPTED } from '@swao/tui-kit';

export const LZ_TARGET_KEYS = ['project', 'subscription', 'account', 'resource_group', 'folder'] as const;
export type LzTargetKey = (typeof LZ_TARGET_KEYS)[number];

/**
 * #4299 (Design 120 section 5.2, Design 126 section 5): the two scope kinds by
 * their full names, with a one-line definition each (central in @swao/core);
 * the same words in the menu, the scope form, the list rows and the guidance.
 */
export const SCOPE_KIND_LABELS = LZ_SCOPE_KIND_LABELS;
export const SCOPE_KIND_DEFINITIONS = LZ_SCOPE_KIND_DEFINITIONS;
export const scopeKindLabel = lzScopeKindLabel;

/**
 * Menu of the list view; `migrate` is shown only when legacy keys exist.
 * #4299: numbered by position (1 to n without gaps), no "0" item; the
 * Setup Wizard adds "Continue the setup" as the last item.
 */
export const CONNECTION_ACTIONS = [
  { id: 'add-lz', label: 'Add landing zone' },
  { id: 'add-scope', label: 'Add scope: Platform (PLZ) or Application landing zone (ALZ)' },
  { id: 'probe', label: 'Probe read-only access and coverage' },
  { id: 'migrate', label: 'Migrate legacy LZR credentials' },
  { id: 'remove', label: 'Remove scope or landing zone' },
  // #4459: shown only while an AWS session-keys scope is registered.
  { id: 'refresh-sso', label: 'Refresh the AWS SSO session' },
] as const;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[number]['id'];

/** The menu label of an action. */
export function actionLabel(id: ConnectionAction): string {
  return CONNECTION_ACTIONS.find((a) => a.id === id)?.label ?? id;
}

export function visibleActions(legacy: { aws: number; azure: number }, awsSessionScopes = 0): (typeof CONNECTION_ACTIONS)[number][] {
  return CONNECTION_ACTIONS.filter((a) => (a.id !== 'migrate' || legacy.aws + legacy.azure > 0) && (a.id !== 'refresh-sso' || awsSessionScopes > 0));
}

/**
 * #4111: why an action cannot run yet, or null when it can. Actions that need
 * a landing zone stay in the menu (dimmed with this reason) instead of being
 * hidden, so the list shows the same items on every frame.
 */
export function actionDisabledReason(id: ConnectionAction, landingZoneCount: number): string | null {
  switch (id) {
    case 'add-scope':
    case 'probe':
    case 'remove':
      return landingZoneCount === 0 ? 'needs a landing zone first' : null;
    case 'add-lz':
    case 'migrate':
    case 'refresh-sso':
      return null;
    default: {
      const never: never = id;
      return never;
    }
  }
}

/** #4299: the guidance of each menu item (and of "Continue the setup"). */
export const LZ_CONNECTIONS_ACTION_GUIDANCE: Record<ConnectionAction | 'continue', LzConnectionsGuidanceEntry> = {
  'add-lz': {
    title: 'Add landing zone',
    what: 'Registers a landing zone: the provider and a short name used in file names and reports, then its first scope. The registration is written to .swao.yml.',
    sections: [{ label: 'Next', text: 'Add its Platform landing zone (PLZ) and any Application landing zones (ALZ) as scopes.' }],
  },
  'add-scope': {
    title: 'Add scope',
    what: 'Adds a scope to a registered landing zone, with its auth method and login. The read-only probe runs right after.',
    sections: [
      { label: 'PLZ', text: `Platform landing zone: ${SCOPE_KIND_DEFINITIONS.platform}` },
      { label: 'ALZ', text: `Application landing zone: ${SCOPE_KIND_DEFINITIONS.application}` },
      { label: 'Credentials', text: 'Entered masked and stored in the SWAO credential vault under the landing zone and scope; stored credentials of the same provider can be reused.' },
    ],
  },
  probe: {
    title: 'Probe',
    what: 'Signs in to every scope of a landing zone and reports whether the login is read-only and which API routes it can read (the coverage). SWAO sends read requests only.',
    sections: [{ label: 'Write-capable', text: 'Shown as warn: SWAO only reads, and every run asks for confirmation.' }],
  },
  migrate: {
    title: 'Migrate legacy credentials',
    what: 'Moves vault keys of the old LZR passes (no longer read) to a registered AWS or Azure scope, so the run can use them. The registration itself is unchanged.',
  },
  remove: {
    title: 'Remove',
    what: 'Removes a scope, or the whole landing zone, from .swao.yml and deletes its keys from the SWAO credential vault. Run data under landing-zones/<id>/ is kept.',
  },
  'refresh-sso': {
    title: 'Refresh the AWS SSO session',
    what: 'Gets new short-term keys for an AWS scope that uses session keys: SWAO shows a sign-in URL and a code, you confirm them in the browser with your AWS IAM Identity Center login, and the new keys and their expiry are stored in the SWAO credential vault.',
    sections: [
      { label: 'AWS profile', text: 'The SSO profile of your AWS config file (aws configure sso) for the account of the scope; SWAO reads the start URL, region, account and role from it and writes nothing there.' },
      { label: 'Read-only', text: 'The calls are sign-in calls; nothing is changed in the tenant. No key or token is shown.' },
      { label: 'CLI', text: 'swao lz credentials refresh <lz-id> <scope-id> [--profile <aws-profile>]' },
    ],
  },
  continue: {
    title: 'Continue the setup',
    what: 'Leaves Landing Zone Connections and goes on with the Probe step of the Landing Zone Live setup. Landing zones can be added later from the setup again or from step 1 of the Landing Zone Live Assessment.',
  },
};

/** #4111: guidance sections of the Landing Zone Connections screen (plain text, all shown via paging). */
export const LZ_CONNECTIONS_GUIDANCE: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Steps', value: 'Add a landing zone first (1): pick the provider and give it a short name. Then add a scope (2): the Platform landing zone (PLZ) or an Application landing zone (ALZ), its auth method and its credentials. The read-only probe (3) runs after every registration.' },
  { label: 'Credentials', value: 'Each credential field is entered masked and stored in the SWAO vault under the landing zone and scope id. Nothing is written to .swao.yml or shown on screen.' },
  { label: 'Stored credentials', value: 'The SWAO vault is per user (shared by every workspace) and keyed by landing zone and scope. When it holds credentials of the same provider and auth method under another landing zone or scope, Add scope lists them by name to confirm one (it is copied to the new scope) or to enter new credentials.' },
  { label: 'Read-only', value: 'The probe reports the identity, whether the credential is read-only, and the coverage. SWAO only reads; a write-capable credential needs a confirmation per run in Landing Zone Live Assessment.' },
  { label: 'Leaving', value: 'In the setup, Continue the setup (the last menu item) goes on; elsewhere Esc goes back. Landing zones can also be added later from the Landing Zone Live setup or step 1 of the Landing Zone Live Assessment.' },
];

/** A guidance entry of the screen: a title, the explanation and inline sections. */
export interface LzConnectionsGuidanceEntry { title: string; what: string; sections?: ReadonlyArray<{ label: string; text: string }> }

/** #4230: the sub-steps (phases) of the Landing Zone Connections screen. */
export type LzConnectionsPhase =
  | 'list'
  | 'provider' | 'lz-id' | 'display'
  | 'pick-lz' | 'scope-id' | 'kind' | 'auth' | 'regions' | 'target' | 'app' | 'reuse' | 'cred' | 'confirm'
  | 'pick-migrate' | 'pick-remove' | 'confirm-remove'
  | 'pick-refresh' | 'pick-sso-profile' | 'refreshing' | 'confirm-profile'
  | 'working' | 'result';

/** #4496: a line of the refresh output that holds the sign-in URL only (shown on a full-width line of its own). */
export function isSignInUrlLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('https://') && !t.includes(' ');
}

/** #4496: the code line of the refresh output (`code: ABCD-EFGH`). */
export function isSignInCodeLine(line: string): boolean {
  return line.trim().startsWith('code: ');
}

/**
 * #4229 / #4230: the guidance of each sub-step of the screen. A picker
 * sub-step also passes an entry per highlighted row (the builders below);
 * this entry is the one of the sub-step itself. The list, the stored
 * credential choice, the credential input and the result build their entry
 * from the screen state, so they return undefined here.
 */
export function lzConnectionsPhaseGuidance(phase: LzConnectionsPhase): LzConnectionsGuidanceEntry | undefined {
  switch (phase) {
    case 'list':
    case 'reuse':
    case 'cred':
    case 'result':
      return undefined;
    case 'provider':
      return {
        title: 'Provider',
        what: 'The cloud provider of the landing zone. Only providers with a live driver in this build are listed; each one names the auth methods it accepts.',
      };
    case 'lz-id':
      return {
        title: 'Landing zone id',
        what: 'A short name for the landing zone, for example otc-prod: lower case letters, digits and hyphens. To change it later, remove the landing zone and register it again.',
        sections: [{ label: 'Where it appears', text: 'In .swao.yml, in the vault keys of its credentials, in the folder landing-zones/<id>/ and in the publications.' }],
      };
    case 'display':
      return {
        title: 'Display name',
        what: 'The readable name of the landing zone in reports and publications, for example the full provider name. Clear it to use the landing zone id instead.',
      };
    case 'pick-lz':
      return {
        title: 'Landing zone',
        what: 'The registered landing zone this action applies to.',
      };
    case 'scope-id':
      return {
        title: 'Scope id',
        what: 'A short name for this scope, proposed from your choices. Confirm it with Enter or change it.',
        sections: [
          { label: 'Proposed', text: 'platform for the Platform landing zone (PLZ); for an Application landing zone (ALZ) the linked app, else the project or account of the locator, else app-1.' },
          { label: 'Where it appears', text: 'In .swao.yml, in the vault keys of the scope credentials, in the run file names and in the publications.' },
        ],
      };
    case 'kind':
      return {
        title: 'Scope kind',
        what: 'Whether this scope is the Platform landing zone (PLZ) or an Application landing zone (ALZ). Each highlighted kind explains what SWAO reads in it.',
        sections: [
          { label: 'PLZ', text: SCOPE_KIND_DEFINITIONS.platform },
          { label: 'ALZ', text: SCOPE_KIND_DEFINITIONS.application },
          { label: 'Rule', text: 'Each landing zone has at most one platform scope and any number of application scopes.' },
        ],
      };
    case 'auth':
      return {
        title: 'Auth method',
        what: 'How SWAO signs in to this scope. The methods come from the provider driver; each needs its own credential fields, entered masked and kept in the SWAO credential vault.',
        sections: [{ label: 'Read-only', text: 'Prefer a read-only identity. SWAO only reads either way; a write-capable login is accepted per run.' }],
      };
    case 'regions':
      return {
        title: 'Regions',
        what: 'The regions SWAO reads for this scope, comma separated, for example eu-de, eu-nl. Enter without a value reads every region the login can see.',
        sections: [{ label: 'When to limit', text: 'Limit the regions when the workload runs in only a few of them, or when the other regions are outside the engagement; the run is then shorter.' }],
      };
    case 'target':
      return {
        title: 'Scope locator',
        what: 'Names the project, subscription or account this scope reads, as key=value: project=eu-de_payments reads the OTC project eu-de_payments. Leave it empty to read everything the login can see.',
        sections: [
          { label: 'When to set it', text: 'For an Application landing zone (ALZ) whose login sees more than its own project or account. Leave it empty for a platform scope or a login limited to one project.' },
          { label: 'Keys', text: LZ_TARGET_KEYS.join(', ') },
        ],
      };
    case 'app':
      return {
        title: 'App link',
        what: 'Links this scope to an app of the workspace. The Landing Zone Live Assessment then fits that app against what the scope observed: an observed landing zone fit of the app.',
        sections: [{ label: 'No app link', text: 'The scope is still assessed; its findings are not tied to an app.' }],
      };
    case 'confirm':
      return {
        title: 'Register this scope',
        what: 'Writes the scope to .swao.yml, stores the credentials in the SWAO credential vault and runs the read-only probe. SWAO never writes to the tenant.',
      };
    case 'pick-migrate':
      return LZ_CONNECTIONS_ACTION_GUIDANCE.migrate;
    case 'pick-remove':
      return {
        title: 'Remove',
        what: 'Choose the whole landing zone or one of its scopes. The next step asks for a confirmation before anything is removed.',
      };
    case 'confirm-remove':
      return {
        title: 'Confirm the removal',
        what: 'Removes the registration from .swao.yml and deletes its keys from the SWAO credential vault. Run data under landing-zones/<id>/ is kept.',
      };
    case 'pick-refresh':
      return LZ_CONNECTIONS_ACTION_GUIDANCE['refresh-sso'];
    case 'pick-sso-profile':
      return {
        title: 'AWS profile',
        what: 'The SSO profiles of your AWS config file; the ones of the scope account come first. SWAO signs in with the start URL, account and role of the chosen profile.',
      };
    case 'confirm-profile':
      return {
        title: 'Keep the AWS profile',
        what: 'Yes stores the profile name as aws_profile of the scope in .swao.yml (a name only, no credential), so the next refresh signs in with it without asking. No keeps the file as it is.',
      };
    case 'refreshing':
      return {
        title: 'Sign in in the browser',
        what: 'Open the URL shown, check that the code matches and confirm the sign-in. SWAO waits until the sign-in is confirmed or the code expires, then stores the new keys. Esc stops waiting; nothing is stored then.',
      };
    case 'working':
      return { title: 'Working', what: 'SWAO runs the command; the result follows.' };
    default: {
      const never: never = phase;
      return never;
    }
  }
}

/**
 * #4230: what each auth method of the live drivers does and when to choose
 * it (sources: the ROLES.md of each driver in @swao/module-landing-zone
 * src/live/<provider>/).
 */
const AUTH_METHOD_TEXT: Readonly<Record<string, { what: string; when: string }>> = {
  'iam-password-token': {
    what: 'Signs in with an IAM user name, password and domain name, and takes a short-lived token for each run.',
    when: 'For an IAM user of the domain, for example a user created for the assessment with read-only roles.',
  },
  aksk: {
    what: 'Signs every request with an access key and secret key (AK/SK); no token is requested. A temporary key also needs its session token.',
    when: 'When the login is an access key rather than a password. With a temporary key the probe cannot name the user, so read-only is reported as not verifiable.',
  },
  'session-keys': {
    what: 'Uses an access key id and secret access key, plus the session token of short-lived keys, for example the keys of a read-only IAM Identity Center permission set.',
    when: 'For AWS. Short-lived keys expire, so store fresh keys before a run.',
  },
  'service-principal-secret': {
    what: 'Signs in as an Entra ID service principal with its tenant id, client id and client secret.',
    when: 'When the service principal has a client secret. Give it the Reader and Resource Graph Reader roles.',
  },
  'service-principal-certificate': {
    what: 'Signs in as an Entra ID service principal with its tenant id, client id and the private key of its certificate (PEM).',
    when: 'When the service principal uses a certificate instead of a secret. Give it the Reader and Resource Graph Reader roles.',
  },
  'key-flow': {
    what: 'Signs in as a service account with its service account key; the key is exchanged for a short-lived access token.',
    when: 'For a STACKIT service account, for example one with the project role Reader.',
  },
};

/** #4230: the guidance of one highlighted auth method; a method without text of its own is described by its fields. */
export function lzAuthMethodGuidance(method: { id: string; required: readonly string[]; optional: readonly string[] }): LzConnectionsGuidanceEntry {
  const known = AUTH_METHOD_TEXT[method.id];
  return {
    title: `Auth method ${method.id}`,
    what: known?.what ?? `Signs in with the fields ${method.required.join(', ')}.`,
    sections: [
      ...(known ? [{ label: 'When', text: known.when }] : []),
      { label: 'Fields', text: `${method.required.join(', ')}${method.optional.length > 0 ? `; optional ${method.optional.join(', ')}` : ''}` },
      { label: 'Read-only', text: 'SWAO only reads with any method; a write-capable login is accepted per run.' },
    ],
  };
}

/** #4230: the guidance of one scope kind, the Platform or an Application landing zone in plain words (Design 120 section 4). */
export function lzScopeKindGuidance(kind: 'platform' | 'application'): LzConnectionsGuidanceEntry {
  switch (kind) {
    case 'platform':
      return {
        title: SCOPE_KIND_LABELS.platform,
        what: SCOPE_KIND_DEFINITIONS.platform,
        sections: [
          { label: 'Reads', text: 'The governance of the landing zone: organisation policies, IAM structure, audit trail, all regions.' },
          { label: 'When', text: 'For the central domain, management account or organisation that the platform team runs.' },
          { label: 'Reported', text: 'Guardrails, identity and logging of the landing zone come from this scope and apply to its application scopes.' },
        ],
      };
    case 'application':
      return {
        title: SCOPE_KIND_LABELS.application,
        what: SCOPE_KIND_DEFINITIONS.application,
        sections: [
          { label: 'Reads', text: 'Only that project or account, but in depth: its resources and their settings.' },
          { label: 'When', text: 'For each workload project, subscription or account; a landing zone can have any number.' },
          { label: 'Reported', text: 'Findings per scope; linked to an app, the scope also gives that app an observed landing zone fit.' },
        ],
      };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** #4230: the guidance of one highlighted provider of Add landing zone. */
export function lzProviderGuidance(provider: string, providerName: string, methods: readonly { id: string }[]): LzConnectionsGuidanceEntry {
  return {
    title: providerName,
    what: `Registers a landing zone of ${providerName}. The next steps ask for a short name, then the first scope with its auth method and login.`,
    sections: [
      { label: 'Auth methods', text: methods.map((m) => m.id).join(', ') || 'none in this build' },
      { label: 'Provider id', text: `${provider}, the key in .swao.yml` },
    ],
  };
}

/** #4230: the guidance of one highlighted landing zone, for the action that opened the list. */
export function lzPickLandingZoneGuidance(lz: { id: string; scopes: readonly { id: string; kind: string }[] }, providerName: string, action: ConnectionAction): LzConnectionsGuidanceEntry {
  const does = action === 'probe' ? 'Probes every scope of this landing zone with its stored login.'
    : action === 'remove' ? 'Next you choose this whole landing zone or one of its scopes.'
      : 'Adds a scope to this landing zone: its kind, auth method and login.';
  return {
    title: `Landing zone ${lz.id}`,
    what: `${providerName}, ${lz.scopes.length} scope(s). ${does}`,
    sections: [{ label: 'Scopes', text: lz.scopes.map((sc) => `${sc.id} (${scopeKindLabel(sc.kind)})`).join(', ') || 'none yet' }],
  };
}

/** #4230: the guidance of one entry of the app link list (undefined: no app link). */
export function lzAppLinkGuidance(app: string | undefined): LzConnectionsGuidanceEntry {
  if (app === undefined) {
    return {
      title: 'No app link',
      what: 'The scope is assessed on its own; its findings are not tied to an app of the workspace. Choose it for a platform scope or a shared project.',
    };
  }
  return {
    title: `Link to ${app}`,
    what: `The Landing Zone Live Assessment fits the app ${app} against what this scope observed and shows it as an observed landing zone fit of the app.`,
    sections: [{ label: 'Scope id', text: `proposed as ${app} in the next step` }],
  };
}

/** #4230: the guidance of one migration target of the legacy credentials. */
export function lzMigrateTargetGuidance(m: { lzId: string; scopeId: string }, keys: number): LzConnectionsGuidanceEntry {
  return {
    title: `${m.lzId} / ${m.scopeId}`,
    what: `Moves ${keys} legacy key(s) to scope ${m.scopeId} of ${m.lzId} in the SWAO credential vault, so the Landing Zone Live Assessment can use them. The registration is unchanged.`,
    sections: [{ label: 'Vault keys', text: `lz:${m.lzId}:${m.scopeId}:*` }],
  };
}

/** #4230: the guidance of one entry of the remove list (undefined: the whole landing zone). */
export function lzRemoveTargetGuidance(lzId: string, scopeId: string | undefined): LzConnectionsGuidanceEntry {
  if (scopeId === undefined) {
    return {
      title: `The whole landing zone ${lzId}`,
      what: 'Removes the landing zone and all its scopes from .swao.yml and deletes their keys from the SWAO credential vault. Run data is kept.',
    };
  }
  return {
    title: `Scope ${scopeId}`,
    what: `Removes only the scope ${scopeId} of ${lzId} and its vault keys; the other scopes stay registered. Run data is kept.`,
  };
}

/** null when valid, else the message to show. */
export function validateRegistrationId(value: string, what: string): string | null {
  // #4229: plain words, no developer jargon.
  if (!LZ_REGISTRATION_ID_PATTERN.test(value)) return `${what}: use lower case letters, digits and single hyphens only, for example otc-prod`;
  return null;
}

export function validateProvider(value: string): string | null {
  return LZ_PROVIDER_ID_PATTERN.test(value) ? null : 'provider must be a catalogue provider id, for example otc';
}

/** Comma or space separated region ids; empty input means no region filter. */
export function parseRegions(text: string): { regions: string[] } | { error: string } {
  const regions = text.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean);
  const bad = regions.filter((r) => !/^[a-z0-9-]+$/.test(r));
  if (bad.length > 0) return { error: `not a region id: ${bad.join(', ')} (lowercase letters, digits and hyphens, for example eu-de)` };
  return { regions };
}

/** `key=value` pairs separated by commas or spaces; keys from LZ_TARGET_KEYS. */
export function parseTargets(text: string): { target: Partial<Record<LzTargetKey, string>> } | { error: string } {
  const target: Partial<Record<LzTargetKey, string>> = {};
  for (const part of text.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    const key = eq > 0 ? part.slice(0, eq) : '';
    if (!(LZ_TARGET_KEYS as readonly string[]).includes(key) || eq === part.length - 1) {
      return { error: `expected <key>=<value> with key ${LZ_TARGET_KEYS.join(', ')}, got ${part}` };
    }
    target[key as LzTargetKey] = part.slice(eq + 1);
  }
  return { target };
}

/**
 * One credential value as a stdin line. A JSON value (the STACKIT key JSON)
 * is compacted to one line; any other value with a line break is refused,
 * because the stdin format is one `<field>=<value>` per line.
 */
export function credentialLine(field: LzCredentialField, value: string): { line: string } | { error: string } {
  let v = value.trim();
  if (/^[{[]/.test(v)) {
    try { v = JSON.stringify(JSON.parse(v)); } catch { /* not JSON, checked below */ }
  }
  if (/[\r\n]/.test(v)) return { error: `${field}: the value has a line break; paste it as one line` };
  return { line: `${field}=${v}` };
}

/** The stdin text of `lz connect --credentials-stdin`; blank values are left out. */
export function buildCredentialsStdin(values: Partial<Record<LzCredentialField, string>>): { text: string; fields: LzCredentialField[] } | { error: string } {
  const lines: string[] = [];
  const fields: LzCredentialField[] = [];
  for (const field of LZ_CREDENTIAL_FIELDS) {
    const v = values[field];
    if (v === undefined || v.trim() === '') continue;
    const r = credentialLine(field, v);
    if ('error' in r) return r;
    lines.push(r.line);
    fields.push(field);
  }
  return { text: lines.length > 0 ? lines.join('\n') + '\n' : '', fields };
}

export interface ConnectChoice {
  lzId: string;
  provider: string;
  display?: string;
  scopeId: string;
  kind: 'platform' | 'application';
  auth: string;
  regions?: readonly string[];
  target?: Partial<Record<LzTargetKey, string>>;
  app?: string;
  /** Credentials follow on stdin (--credentials-stdin). */
  credentialsOnStdin: boolean;
  /** #4232: copy the stored set of `<lz-id>:<scope-id>` (--credentials-from); never with stdin. */
  credentialsFrom?: string;
  moveLegacyCredentials?: boolean;
}

/** argv of `swao lz connect`; never carries a credential value or an accept flag. */
export function buildConnectArgs(c: ConnectChoice): string[] {
  const args = ['lz', 'connect', c.lzId, '--provider', c.provider, '--scope', c.scopeId, '--kind', c.kind, '--auth', c.auth];
  for (const r of c.regions ?? []) args.push('--region', r);
  for (const k of LZ_TARGET_KEYS) {
    const v = c.target?.[k];
    if (v !== undefined) args.push('--target', `${k}=${v}`);
  }
  if (c.app) args.push('--app', c.app);
  if (c.display) args.push('--display', c.display);
  if (c.credentialsOnStdin) args.push('--credentials-stdin');
  else if (c.credentialsFrom) args.push('--credentials-from', c.credentialsFrom);
  if (c.moveLegacyCredentials) args.push('--move-legacy-credentials');
  // The probe runs as its own step, so a refused probe never reads as a failed connect.
  args.push('--no-probe');
  return args;
}

export function buildConnectionProbeArgs(lzId: string, scopeId?: string): string[] {
  return scopeId === undefined ? ['lz', 'probe', lzId] : ['lz', 'probe', lzId, '--scope', scopeId];
}

/** #4459: `swao lz credentials refresh <lz-id> <scope-id> [--profile <p>]` (CLI parity of the TUI action). */
export function buildRefreshArgs(lzId: string, scopeId: string, profile?: string): string[] {
  return ['lz', 'credentials', 'refresh', lzId, scopeId, ...(profile !== undefined ? ['--profile', profile] : [])];
}

/** #4459: the AWS session-keys scopes the refresh action offers, expired ones first. */
export function awsSessionKeyScopes(lzs: ReadonlyArray<{ id: string; provider: string; scopes: ReadonlyArray<{ id: string; auth: string; credentials: string }> }>): Array<{ lzId: string; scopeId: string; expired: boolean }> {
  const out = lzs.flatMap((l) => (l.provider === 'aws' ? l.scopes.filter((sc) => sc.auth === 'session-keys').map((sc) => ({ lzId: l.id, scopeId: sc.id, expired: sc.credentials === 'expired' })) : []));
  return out.sort((a, b) => Number(b.expired) - Number(a.expired));
}

export function buildRemoveArgs(lzId: string, scopeId?: string): string[] {
  return scopeId === undefined ? ['lz', 'remove', lzId] : ['lz', 'remove', lzId, '--scope', scopeId];
}

/** Scope ids offered by default: `platform` while the landing zone has none, else `app-<n>`. */
export function suggestScopeId(existing: readonly { id: string; kind: string }[]): string {
  if (!existing.some((s) => s.kind === 'platform') && !existing.some((s) => s.id === 'platform')) return 'platform';
  for (let n = 1; ; n++) if (!existing.some((s) => s.id === `app-${n}`)) return `app-${n}`;
}

/** #4229: a value made into a scope id: lower case letters, digits and single hyphens, at most 40 characters (no regular expression on input). */
export function toScopeId(value: string): string {
  let out = '';
  for (const ch of value.toLowerCase()) {
    const ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (ok) out += ch;
    else if (out.length > 0 && !out.endsWith('-')) out += '-';
    if (out.length >= 40) break;
  }
  while (out.endsWith('-')) out = out.slice(0, -1);
  return out;
}

/**
 * #4229: the proposed scope id, from what the operator chose already: the
 * Platform landing zone is `platform`; an Application landing zone takes the
 * linked app, else the project, account, subscription, resource group or
 * folder of the locator, else app-1, app-2. A taken id gets a number suffix.
 */
export function proposeScopeId(
  kind: 'platform' | 'application',
  target: Partial<Record<LzTargetKey, string>>,
  app: string | undefined,
  existing: readonly { id: string; kind: string }[],
): string {
  const taken = (id: string): boolean => existing.some((s) => s.id === id);
  const unique = (base: string): string => {
    if (!taken(base)) return base;
    for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  };
  if (kind === 'platform') return unique('platform');
  const fromTarget = LZ_TARGET_KEYS.map((k) => target[k]).find((v) => v !== undefined && toScopeId(v) !== '');
  const base = toScopeId(app ?? '') || toScopeId(fromTarget ?? '');
  if (base && LZ_REGISTRATION_ID_PATTERN.test(base)) return unique(base);
  for (let n = 1; ; n++) if (!taken(`app-${n}`)) return `app-${n}`;
}

/** Kinds still possible: at most one platform scope per landing zone. */
export function availableKinds(existing: readonly { kind: string }[]): ('platform' | 'application')[] {
  return existing.some((s) => s.kind === 'platform') ? ['application'] : ['platform', 'application'];
}

/** Providers with legacy keys that also have a registered landing zone to move them to. */
export function migrationTargets(
  legacy: { aws: number; azure: number },
  lzs: readonly { id: string; provider: string; scopes: readonly { id: string }[] }[],
): { lzId: string; provider: 'aws' | 'azure'; scopeId: string }[] {
  const out: { lzId: string; provider: 'aws' | 'azure'; scopeId: string }[] = [];
  for (const provider of ['aws', 'azure'] as const) {
    if (legacy[provider] === 0) continue;
    for (const lz of lzs.filter((l) => l.provider === provider)) for (const s of lz.scopes) out.push({ lzId: lz.id, provider, scopeId: s.id });
  }
  return out;
}

export interface ProbeSummaryLine {
  scopeId: string;
  readOnly: 'verified' | 'refused' | 'unverifiable';
  identity: string;
  detail: string[];
}

/**
 * Parse `swao lz probe` output: `scope <id>: read-only check: <verdict>` with an
 * `identity:` line under it (#4399), or the older `scope <id>: identity <x>,
 * read-only <state>`, plus indented lines.
 */
export function parseConnectionProbe(text: string): ProbeSummaryLine[] {
  const out: ProbeSummaryLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = parseLzProbeScopeLine(raw);
    if (m) {
      out.push({ scopeId: m.scopeId, identity: m.identity ?? '', readOnly: m.readOnly, detail: [] });
      continue;
    }
    const last = out[out.length - 1];
    const identity = parseLzProbeIdentityLine(raw);
    if (identity !== null) { if (last) last.identity = identity; continue; }
    if (last && /^\s+\S/.test(raw)) last.detail.push(raw.trim());
  }
  return out;
}

/** The readable route count of a probe coverage text ("56 readable, not readable: x"), or undefined. */
export function readableCount(coverage: string | undefined): number | undefined {
  if (!coverage) return undefined;
  const m = /^(\d+) readable/.exec(coverage.trim());
  return m ? Number(m[1]) : undefined;
}

/**
 * #4298 (Design 126 F-01, section 6, Q-13): one probed scope as a status row,
 * the same on the Setup Probe step and on Landing Zone Connections. A verified
 * read-only login is `ok`; a write-capable login is `warn` with the words of
 * WRITE_CAPABLE_ACCEPTED (owner decision Q-13 / D-4, Design 126 section 17,
 * the same constant as the health check and the Ready step); an unverified one is `warn`; a login that reads
 * nothing is `fail` (probeDisplayLevel). The coverage goes on line 2.
 */
export function probeRow(readOnly: string, coverage: string | undefined): { level: 'ok' | 'warn' | 'fail'; summary: string; detail?: string } {
  const detail = coverage ? `coverage ${coverage}` : undefined;
  const state = readOnly === 'verified' || readOnly === 'refused' || readOnly === 'unverifiable' ? readOnly : 'unverifiable';
  const level = probeDisplayLevel(state, readableCount(coverage));
  if (level === 'fail') return { level, summary: 'signs in but reads nothing', detail };
  switch (state) {
    case 'verified': return { level, summary: 'read-only verified', detail };
    case 'refused': return { level, summary: WRITE_CAPABLE_ACCEPTED.text, detail };
    case 'unverifiable': return { level, summary: 'read-only not verifiable; every run asks to accept the login', detail };
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** The coverage text of a parsed probe ("56 readable"), without its label. */
export function coverageOf(p: ProbeSummaryLine): string | undefined {
  const line = p.detail.find((d) => d.startsWith('coverage:'));
  return line ? line.slice('coverage:'.length).trim() : undefined;
}

/** #4298: a probe detail line without the CLI flag remedy (the TUI asks for the confirmation in the run instead). */
export function withoutFlagRemedy(line: string): string {
  const cut = line.indexOf(' Use a read-only role');
  const base = cut >= 0 ? line.slice(0, cut) : line;
  return base.indexOf('--accept-') >= 0 ? '' : base;
}

/**
 * #4298 / #4299: the guidance of a result: the role list of a write-capable
 * login and the ROLES.md pointer, the vault key names of the registration and
 * the connect output; none of it is in the screen body.
 */
export function resultGuidance(probe: readonly ProbeSummaryLine[], lines: readonly string[]): LzConnectionsGuidanceEntry {
  const sections: { label: string; text: string }[] = [];
  for (const p of probe) {
    const roles = p.detail.filter((d) => !d.startsWith('coverage:') && !d.startsWith('recording:') && !d.startsWith('endpoint override:')).map(withoutFlagRemedy).filter(Boolean);
    if (roles.length > 0) sections.push({ label: `Scope ${p.scopeId}`, text: roles.join(' ') });
  }
  if (probe.some((p) => p.readOnly === 'refused')) {
    sections.push({ label: 'Write-capable', text: 'The login could also change resources. SWAO only reads; the Landing Zone Live Assessment asks you to confirm the login at the start of every run. For a read-only login, use the roles listed in ROLES.md of the provider driver.' });
  }
  if (probe.some((p) => p.readOnly === 'unverifiable')) {
    sections.push({ label: 'Not verifiable', text: 'The provider did not let SWAO confirm the read-only state; every run asks you to accept the login.' });
  }
  // #4496: the sign-in URL and code stay out of the box (a wrapped URL does not copy); they are on lines of their own.
  const details = lines.filter((l) => !isSignInUrlLine(l) && !isSignInCodeLine(l));
  if (details.length > 0) sections.push({ label: 'Details', text: details.slice(-8).join('; ') });
  return {
    title: 'Result',
    what: 'One status per scope: ok for a read-only login, warn for a write-capable or unverified login that a run accepts with a confirmation, fail for a login that cannot sign in or reads nothing. The coverage counts the API routes the login can read.',
    sections,
  };
}

// ---------------------------------------------------------------------------
// #4458: the app link rows (id, name, type)
// ---------------------------------------------------------------------------

/** One app a scope can link to: the workspace app id, its name from `.swao.yml` and its kind. */
export interface LzAppLinkApp {
  id: string;
  /** `app_name` (service apps) or `app.name` (application apps); absent when the file names none. */
  name?: string;
  kind: AppKind;
}

/** App ids a scope can link to (`--app`, the registration id pattern of `swao lz connect`). */
const APP_LINK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Longest name in the name column; a longer one is cut with "...". */
export const LZ_APP_LINK_NAME_MAX = 36;

/** #4458: kept as an alias; the rule lives in core (appDisplayName). */
export const readAppDisplayName = appDisplayName;

/** The apps of the app link step: applications first, then service apps, each sorted by id (listWorkspaceApps). */
export function readLzAppLinkApps(workspace: string | undefined): LzAppLinkApp[] {
  if (!workspace) return [];
  return listWorkspaceApps(workspace)
    .filter((a) => APP_LINK_ID.test(a.id))
    .map((a) => {
      return { id: a.id, kind: a.kind, ...(a.name ? { name: a.name } : {}) };
    });
}

/**
 * The picker rows of every LZ Live app picker: the id as label, then the name
 * (padded to one column) and the type as detail, `app0034  Kaspersky  service`.
 * An app without a name shows its id and type. Type-to-filter matches the
 * label and the detail, so the id and the name.
 */
export function lzAppLinkRows(apps: readonly LzAppLinkApp[]): Array<{ label: string; detail: string }> {
  const clip = (s: string): string => (s.length > LZ_APP_LINK_NAME_MAX ? `${s.slice(0, LZ_APP_LINK_NAME_MAX - 3)}...` : s);
  const names = apps.map((a) => (a.name ? clip(a.name) : ''));
  const width = Math.max(0, ...names.map((n) => n.length));
  return apps.map((a, i) => ({
    label: a.id,
    detail: width === 0 ? a.kind : `${names[i]!.padEnd(width)}  ${a.kind}`,
  }));
}

/**
 * #4459: the expiry time of the warning line `swao lz connect` prints when the
 * stored session token of the scope has expired (lzExpiredSessionLine); null
 * when the output has no such line.
 */
export function expiredSessionAt(lines: readonly string[]): string | null {
  const marker = `${LZ_EXPIRED_SESSION_LINE_PREFIX} expired at `;
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith(marker)) continue;
    const rest = t.slice(marker.length);
    const end = rest.indexOf(';');
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  }
  return null;
}
