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

// #3571: `swao lz connect` and `swao lz probe` (Design 120 section 13.2). Both
// are non-interactive: every input is a flag, every failure a non-zero exit
// code (1 refused / invalid; 2 a tier refusal with the [LICENSE] block, ADR-0055
// and #3844, or an expired token or refused endpoint / recording location). The actions take their dependencies as arguments so the tests
// drive them with a temporary vault, workspace and transport.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dump as yamlDump } from 'js-yaml';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { CredentialStore, LicenseGuard, providerLabel, LZ_EVIDENCE_MAP_FILE, LZ_LIVE_STALENESS_DAYS, LZ_SCOPE_PURPOSES, LzEvidenceRefError, LzLiveScanSchema, findWorkspace, formatLzProbeIdentityLine, formatLzProbeScopeLine, lzExpiredSessionLine, lzTokenRefreshHint } from '@swao/core';
import type { LzLiveScan, LzScopePurpose, LzServiceCatalogue } from '@swao/core';
import { readLandingZones, runLzConnect, runLzProbe } from './session.js';
import { describeLandingZones, formatLandingZones, runLzRemove } from './connections.js';
import { formatLzDiff, runLzDiff } from './run-diff.js';
import { formatLzHierarchy, runLzHierarchy } from './hierarchy-view.js';
import { formatLzBaselineImpact, parseBaselineImpactChanges, runLzBaselineImpact } from './baseline-impact.js';
import { formatLzEvidence, formatLzEvidenceList, listLzEvidence, lzEvidenceRunIdOf, openLzConsoleLink, resolveLzEvidence, writeLzEvidenceMap } from './evidence.js';
import { LZ_LIVE_MERGED_FILE, mergeLzLiveScopes } from './merge.js';
import type { ProbeOutcome, ReadOnlyFlags, ScopeCtxOptions } from './session.js';
import { runLzLiveAssessment } from './assess.js';
import type { LzLiveAssessOptions } from './assess.js';
import type { LzLiveCheckDefinition } from '../evaluate/lz-live-eval.js';
import type { LzRequiredService } from '../fit/lz-fit.js';
import { lzLiveFailure, requireLzLiveFeature } from './tier.js';
import { DEFAULT_ACTIVITY_DAYS, runLzLiveScan } from './scan.js';
import { describeSimulation } from './simulation.js';
import { registerBuiltInLiveLzDrivers } from './builtin.js';
import { buildLzLiveCatalogue, LZ_LIVE_CATALOGUE_FILE } from './live-catalogue.js';
import { formatLzLivePortfolio, runLzLivePortfolio } from './portfolio.js';
import { isLzCatalogueLookupDir, resolveProviderCatalogue } from '../catalogue/loader.js';
import { LZ_SOVEREIGNTY_PINS } from '../catalogue/sovereignty-pins.js';
import { parseCredentialsFrom } from './credential-reuse.js';
import { openAwsSignInUrl, refreshAwsSsoScope, storeScopeAwsProfile } from './aws/aws-sso-scope.js';
import type { AwsSsoScopeOptions } from './aws/aws-sso-scope.js';

export interface LzLiveCliDeps extends ScopeCtxOptions {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Licence gate (#3590); the CLI passes the loaded LicenseGuard. */
  guard: Pick<LicenseGuard, 'requireFeature'>;
  /** #3589: reads all of stdin (--credentials-stdin); injected by tests. */
  readStdin?: () => Promise<string>;
}

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks).toString('utf-8');
}

/** #3844: print the failure (the `[LICENSE]` block for a tier refusal) and return its exit code. */
function fail(err: unknown, deps: { err: (line: string) => void }): number {
  const f = lzLiveFailure(err);
  deps.err(f.message);
  return f.code;
}

function workspaceOf(deps: LzLiveCliDeps): string {
  const ws = findWorkspace(deps.cwd);
  if (!ws) throw Object.assign(new Error('[lz live] not inside a SWAO workspace (no .swao.yml found); run swao init first'), { exitCode: 1 });
  return ws;
}

function printProbe(outcome: ProbeOutcome, deps: LzLiveCliDeps): void {
  for (const r of outcome.results) {
    // #4399: the verdict on the scope line (the words of the TUI), the identity on its own line:
    // an identity that is a comma list no longer swallows the verdict.
    deps.out(formatLzProbeScopeLine(r.scopeId, r.probe.read_only, r.gate.proceed));
    deps.out(formatLzProbeIdentityLine(r.probe.identity));
    deps.out(`  coverage: ${r.probe.coverage.readable.length} readable${r.probe.coverage.unreadable.length > 0 ? `, not readable: ${r.probe.coverage.unreadable.join(', ')}` : ''}`);
    for (const o of r.endpointOverrides) deps.out(`  endpoint override: ${o.api} -> ${o.url}`);
    if (r.recordingDir) deps.out(`  recording: ${r.recordingDir}`);
    (r.gate.proceed ? deps.out : deps.err)(`  ${r.gate.message}`);
  }
}

export interface ConnectCliOptions {
  provider: string;
  scope: string;
  kind: string;
  auth: string;
  region?: string[];
  target?: string[];
  app?: string;
  purpose?: string;
  /** #4459: SSO profile name of the AWS config file (aws_profile of the scope). */
  awsProfile?: string;
  credentialsFile?: string;
  credentialsStdin?: boolean;
  /** #4232: `<lz-id>:<scope-id>` of a stored credential set to copy. */
  credentialsFrom?: string;
  display?: string;
  moveLegacyCredentials?: boolean;
  probe?: boolean;
  acceptUnverifiedReadOnly?: boolean;
  acceptWriteCapableCredentials?: boolean;
  identityLabel?: string;
}

export async function lzConnectAction(lzId: string, o: ConnectCliOptions, deps: LzLiveCliDeps): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'connect');
    if (o.kind !== 'platform' && o.kind !== 'application') {
      deps.err(`[lz live] --kind must be platform or application, not ${o.kind}`);
      return 1;
    }
    // #3975: the landing zone's log archive scope (an application scope).
    if (o.purpose !== undefined && !(LZ_SCOPE_PURPOSES as readonly string[]).includes(o.purpose)) {
      deps.err(`[lz live] --purpose must be ${LZ_SCOPE_PURPOSES.join(' or ')}, not ${o.purpose}`);
      return 1;
    }
    const target: Record<string, string> = {};
    for (const t of o.target ?? []) {
      const eq = t.indexOf('=');
      if (eq <= 0) {
        deps.err(`[lz live] --target expects <key>=<value> (project, subscription, account, resource_group, folder), got ${t}`);
        return 1;
      }
      target[t.slice(0, eq)] = t.slice(eq + 1);
    }
    if (o.credentialsStdin === true && o.credentialsFile !== undefined) {
      deps.err('[lz live] pass the credentials either in a file (--credentials-file) or on stdin (--credentials-stdin), not both');
      return 1;
    }
    const credentialsFrom = o.credentialsFrom !== undefined ? parseCredentialsFrom(o.credentialsFrom) : undefined;
    if (credentialsFrom === null) {
      deps.err(`[lz live] --credentials-from expects <lz-id>:<scope-id>, for example otc-test:platform, got ${o.credentialsFrom}`);
      return 1;
    }
    if (credentialsFrom !== undefined && (o.credentialsStdin === true || o.credentialsFile !== undefined)) {
      deps.err('[lz live] pass the credentials one way only: --credentials-from, --credentials-file or --credentials-stdin');
      return 1;
    }
    const credentialsText = o.credentialsStdin === true ? await (deps.readStdin ?? readProcessStdin)() : undefined;
    const r = await runLzConnect({
      ...deps,
      workspaceRoot: workspaceOf(deps),
      lzId,
      provider: o.provider,
      scopeId: o.scope,
      kind: o.kind,
      auth: o.auth,
      regions: o.region,
      target,
      app: o.app,
      ...(o.purpose !== undefined ? { purpose: o.purpose as LzScopePurpose } : {}),
      ...(o.awsProfile !== undefined ? { awsProfile: o.awsProfile } : {}),
      credentialsFile: o.credentialsFile,
      ...(credentialsText !== undefined ? { credentialsText } : {}),
      ...(o.display !== undefined ? { display: o.display } : {}),
      ...(credentialsFrom !== undefined ? { credentialsFrom } : {}),
      moveLegacyCredentials: o.moveLegacyCredentials,
      probe: o.probe,
      acceptUnverifiedReadOnly: o.acceptUnverifiedReadOnly,
      acceptWriteCapableCredentials: o.acceptWriteCapableCredentials,
      identityLabel: o.identityLabel,
    });
    deps.out(`landing zone ${lzId}, scope ${o.scope}: ${r.registration.replace(/-/g, ' ')} in .swao.yml`);
    if (credentialsFrom !== undefined) deps.out(`copied the stored credentials of ${credentialsFrom.lzId} / ${credentialsFrom.scopeId} to lz:${lzId}:${o.scope}:* (names only; the source keys stay)`);
    if (r.storedFields.length > 0) deps.out(`stored ${r.storedFields.length} credential field(s): ${r.storedFields.map((f) => `lz:${lzId}:${o.scope}:${f}`).join(', ')}`);
    if (r.movedLegacyKeys.length > 0) deps.out(`moved ${r.movedLegacyKeys.length} legacy credential(s) to lz:${lzId}:${o.scope}:*`);
    if (r.legacyKeysFound > 0) deps.out(`found ${r.legacyKeysFound} legacy ${o.provider} credential(s) (Pass 23 keys, no longer read); re-run with --move-legacy-credentials to move them to this scope`);
    if (r.expiredSessionAt !== undefined) {
      deps.out(lzExpiredSessionLine(r.expiredSessionAt));
      deps.out(`  ${lzTokenRefreshHint(lzId, o.scope)}`);
      if (o.probe !== false) deps.out('  the read-only probe was skipped: it would refuse the expired token');
    }
    if (r.probe) printProbe(r.probe, deps);
    return r.exitCode;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface ProbeCliOptions {
  scope?: string;
  acceptUnverifiedReadOnly?: boolean;
  acceptWriteCapableCredentials?: boolean;
  identityLabel?: string;
  /** #4265: logged as `caller` on lz.live.probe (default `lz.probe`). */
  caller?: string;
}

export async function lzProbeAction(lzId: string, o: ProbeCliOptions, deps: LzLiveCliDeps): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'connect');
    const outcome = await runLzProbe({ ...deps, workspaceRoot: workspaceOf(deps), lzId, scopeId: o.scope, ...o });
    printProbe(outcome, deps);
    return outcome.exitCode;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface CredentialsRefreshCliOptions {
  profile?: string;
  /** #4496: sign in with this profile and, after a successful refresh, store it as aws_profile of the scope. */
  awsProfile?: string;
  /** #4496: commander's --no-browser (false): print the URL only. */
  browser?: boolean;
}

/**
 * #4459: test seams of the SSO refresh (a mock server, a temporary home, no waiting).
 * #4496: `openUrl` opens the sign-in URL; without it nothing is opened (the
 * command registration passes the browser opener, tests do not).
 */
export type CredentialsRefreshSeams = Partial<Pick<AwsSsoScopeOptions, 'home' | 'oidcBaseUrl' | 'portalBaseUrl' | 'sleep' | 'now'>> & { openUrl?: (url: string) => boolean };

/** #4496: the prefix of the code line; the URL line holds the URL only (the TUI shows both on full-width lines of their own). */
export const AWS_SSO_CODE_LINE_PREFIX = 'code: ';

/**
 * #4459 (Design 120 section 6.2): `swao lz credentials refresh <lz-id> <scope-id>`.
 * Signs in to AWS IAM Identity Center with the device authorisation flow and
 * stores the new short-term keys of an AWS session-keys scope. Prints the
 * verification URL and the user code only; never a token or key. The calls
 * are sign-in calls; nothing is written to the tenant.
 */
export async function lzCredentialsRefreshAction(lzId: string, scopeId: string, o: CredentialsRefreshCliOptions, deps: LzLiveCliDeps, seams: CredentialsRefreshSeams = {}): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'connect');
    let waitingShown = false;
    const { openUrl, ...flowSeams } = seams;
    const workspaceRoot = workspaceOf(deps);
    const profileName = o.awsProfile !== undefined && o.awsProfile !== '' ? o.awsProfile : o.profile;
    const r = await refreshAwsSsoScope({
      ...flowSeams,
      workspaceRoot,
      lzId,
      scopeId,
      store: deps.store,
      ...(profileName !== undefined ? { profileName } : {}),
      env: deps.env ?? process.env,
      ...(deps.fetchImpl ? { transport: deps.fetchImpl } : {}),
      onPrompt: (p) => {
        // #4496: the URL and the code each on a line of their own, nothing else on it, so the URL copies as one piece.
        const url = p.verificationUriComplete ?? p.verificationUri;
        deps.out(`AWS SSO sign-in for ${lzId} / ${scopeId}: open this URL in a browser and confirm the code (the code expires in ${Math.round(p.expiresInS / 60)} min):`);
        deps.out(url);
        deps.out(`${AWS_SSO_CODE_LINE_PREFIX}${p.userCode}`);
        if (o.browser !== false && openUrl) {
          deps.out(openUrl(url) ? '  opened in the default browser; if no window appears, open the URL above' : '  no browser could be started; open the URL above');
        }
      },
      onWaiting: () => {
        if (waitingShown) return;
        waitingShown = true;
        deps.out('  waiting for the sign-in in the browser ...');
      },
    });
    deps.out(`stored 4 credential field(s) for ${lzId} / ${scopeId} from the AWS profile ${r.profile}: ${r.storedKeys.join(', ')}`);
    deps.out(`  the session expires at ${r.expiresAt}; run this command again after that`);
    // #4496: --aws-profile stores the profile for the next refresh (minimal-patch writer).
    if (o.awsProfile !== undefined && o.awsProfile !== '') {
      deps.out(storeScopeAwsProfile(workspaceRoot, lzId, scopeId, r.profile)
        ? `  aws_profile ${r.profile} stored for ${lzId} / ${scopeId} in .swao.yml`
        : `  aws_profile of ${lzId} / ${scopeId} is ${r.profile} already`);
    }
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

/**
 * #3589: `swao lz list`: registered landing zones and scopes with the offline
 * connection state (driver in this build, credential fields stored, missing
 * or expired). Field names only; values are never printed. Exit 0; 1 when
 * `.swao.yml` is missing or invalid.
 */
export async function lzListAction(deps: LzLiveCliDeps): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'connect');
    for (const line of formatLandingZones(await describeLandingZones(workspaceOf(deps), deps.store))) deps.out(line);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface RemoveCliOptions {
  scope?: string;
}

/**
 * #3589: `swao lz remove <lz-id> [--scope <id>]`: remove a scope, or the
 * landing zone, from `.swao.yml` and delete its scoped vault keys. Run data
 * under landing-zones/<lz-id>/ is kept. Exit 0 removed; 1 not registered.
 */
export async function lzRemoveAction(lzId: string, o: RemoveCliOptions, deps: LzLiveCliDeps): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'connect');
    const r = await runLzRemove({ workspaceRoot: workspaceOf(deps), store: deps.store, lzId, ...(o.scope !== undefined ? { scopeId: o.scope } : {}) });
    deps.out(r.outcome === 'landing-zone-removed'
      ? `landing zone ${lzId} removed from .swao.yml (scopes: ${r.removedScopes.join(', ')})`
      : `landing zone ${lzId}: scope ${r.removedScopes.join(', ')} removed from .swao.yml`);
    deps.out(`deleted ${r.deletedKeys} credential field(s) from the vault; run data under landing-zones/${lzId}/ is kept`);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface DiffCliOptions {
  from?: string;
  to?: string;
  scope?: string;
}

/**
 * #3830: `swao lz diff <lz-id> [--from <ts>] [--to <ts>] [--scope <id>]`
 * (Design 120 section 13.2): new and removed regions, services and resource
 * counts and status changes per scope between two runs. Exit 0 compared; 1
 * no run, unknown run or scope, or nothing to compare; 2 tier (the [LICENSE]
 * block, ADR-0055, #3844).
 */
export function lzDiffAction(lzId: string, o: DiffCliOptions, deps: Pick<LzLiveCliDeps, 'cwd' | 'out' | 'err' | 'guard'>): number {
  try {
    requireLzLiveFeature(deps.guard, 'assess');
    const r = runLzDiff({ workspaceRoot: workspaceOf(deps as LzLiveCliDeps), lzId, ...(o.from ? { from: o.from } : {}), ...(o.to ? { to: o.to } : {}), ...(o.scope ? { scopeId: o.scope } : {}) });
    for (const line of formatLzDiff(r)) deps.out(line);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface HierarchyCliOptions {
  run?: string;
}

/**
 * #3885: `swao lz hierarchy <lz-id> [--run <ts>]` (Design 123 sections 5.6,
 * 9.4): the tenant tree of the latest (or the named) live run with
 * pseudonymised labels, normalised and native kinds, unknown nodes marked and
 * baseline fail and unverified counts rolled up per node. Never a native id.
 * Exit 0 shown (also when the run has no tree); 1 no run or unknown run; 2 tier.
 */
export function lzHierarchyAction(lzId: string, o: HierarchyCliOptions, deps: Pick<LzLiveCliDeps, 'cwd' | 'out' | 'err' | 'guard'>): number {
  try {
    requireLzLiveFeature(deps.guard, 'assess');
    const r = runLzHierarchy({ workspaceRoot: workspaceOf(deps as LzLiveCliDeps), lzId, ...(o.run ? { run: o.run } : {}) });
    for (const line of formatLzHierarchy(r)) deps.out(line);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface BaselineImpactCliOptions {
  framework: string;
  changes: string;
  run?: string;
  json?: boolean;
}

/**
 * #4128 BC-03: hidden `swao lz baseline-impact <lz-id> --framework <id>
 * --changes <json> [--run <ts>] [--json]` (Design 123 section 17.3.1), spawned
 * by the MCP tool swao_baseline_impact. Re-evaluates the stored scans of one
 * run with the current and the candidate baseline values; no network call,
 * nothing written; counts and statuses only. Gated like `swao lz scan`.
 */
export function lzBaselineImpactAction(lzId: string, o: BaselineImpactCliOptions, deps: Pick<LzLiveCliDeps, 'cwd' | 'out' | 'err' | 'guard'>): number {
  try {
    requireLzLiveFeature(deps.guard, 'assess');
    const r = runLzBaselineImpact({
      workspaceRoot: workspaceOf(deps as LzLiveCliDeps),
      lzId,
      framework: o.framework,
      changes: parseBaselineImpactChanges(o.changes),
      ...(o.run ? { run: o.run } : {}),
    });
    if (o.json) deps.out(JSON.stringify(r));
    else for (const line of formatLzBaselineImpact(r)) deps.out(line);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

export interface EvidenceCliOptions {
  lz?: string;
  run?: string;
  runDir?: string;
  open?: boolean;
  /** Injected by tests: the browser opener. */
  openLink?: (url: string) => boolean;
}

/**
 * #3956 (Design 123 section 9.5): `swao lz evidence <ref> [--open]` resolves an
 * evidence reference from the local evidence map of its run and prints the
 * native reference and the console link; without a reference it lists the
 * references of a run (`--lz <lz-id> [--run <ts>]`, no native id). Exit 0
 * resolved or listed; 1 missing input; 2 a malformed, unknown or foreign-run
 * reference, no evidence map, or a tier refusal.
 */
export function lzEvidenceAction(ref: string | undefined, o: EvidenceCliOptions, deps: Pick<LzLiveCliDeps, 'cwd' | 'out' | 'err' | 'guard'>): number {
  try {
    requireLzLiveFeature(deps.guard, 'assess');
    const workspaceRoot = o.runDir !== undefined ? (findWorkspace(deps.cwd) ?? deps.cwd) : workspaceOf(deps as LzLiveCliDeps);
    if (ref === undefined) {
      if (!o.lz) {
        deps.err('[lz live] name a reference (swao lz evidence <ref>) or a landing zone to list (swao lz evidence --lz <lz-id>)');
        return 1;
      }
      for (const line of formatLzEvidenceList(listLzEvidence({ workspaceRoot, lzId: o.lz, ...(o.run ? { run: o.run } : {}) }))) deps.out(line);
      return 0;
    }
    const r = resolveLzEvidence({ workspaceRoot, ref, ...(o.lz ? { lzId: o.lz } : {}), ...(o.runDir !== undefined ? { runDir: resolve(deps.cwd, o.runDir) } : {}) });
    for (const line of formatLzEvidence(r)) deps.out(line);
    if (o.open) {
      if (!r.entry.console) {
        deps.err('[lz live] --open: this reference has no documented console link');
        return 2;
      }
      const opened = (o.openLink ?? openLzConsoleLink)(r.entry.console.url);
      (opened ? deps.out : deps.err)(opened ? `  opened ${r.entry.console.url}; the console login decides access` : '[lz live] --open: the browser could not be started; open the console link above');
    }
    return 0;
  } catch (err) {
    if (err instanceof LzEvidenceRefError) {
      deps.err(`[lz live] ${err.message}`);
      return err.exitCode;
    }
    return fail(err, deps);
  }
}

export interface ScanCliOptions extends ProbeCliOptions {
  mode: string;
  out: string;
  days?: string;
  staleDays?: string;
}

/**
 * #3572: `swao lz scan <lz-id> --mode live --out <dir>` (Design 120 section
 * 13.2). Writes one `<lz-id>.<scope-id>.lz-live-scan.json` per scope and
 * the live LZ catalogue `lz-live-catalogue.json` (#3581) and the scope
 * merge `lz-live-merged.yaml` (#3583) into the named directory, which may
 * not be an LZ catalogue folder; the run directory layout of section 7.4 belongs to the
 * run writer and is not part of this run. `iac` and `export` stay on their
 * existing commands.
 */
export async function lzScanAction(lzId: string, o: ScanCliOptions, deps: LzLiveCliDeps): Promise<number> {
  try {
    if (o.mode !== 'live') {
      deps.err(`[lz live] --mode ${o.mode} is not served by this command; only --mode live is (iac and export use the existing LZ scan inputs)`);
      return 1;
    }
    requireLzLiveFeature(deps.guard, 'assess');
    const days = o.days === undefined ? DEFAULT_ACTIVITY_DAYS : Number(o.days);
    if (!Number.isInteger(days) || days < 1) {
      deps.err(`[lz live] --days must be a positive whole number, not ${o.days}`);
      return 1;
    }
    const staleDays = o.staleDays === undefined ? LZ_LIVE_STALENESS_DAYS : Number(o.staleDays);
    if (!Number.isInteger(staleDays) || staleDays < 1) {
      deps.err(`[lz live] --stale-days must be a positive whole number, not ${o.staleDays}`);
      return 1;
    }
    const workspaceRoot = workspaceOf(deps);
    const outDir = resolve(deps.cwd, o.out);
    // #3581 (Q-03): the live LZ catalogue never lands in a catalogue lookup path.
    if (isLzCatalogueLookupDir(outDir, workspaceRoot)) {
      deps.err(`[lz live] --out ${outDir} is an LZ catalogue folder; the live LZ catalogue is never written where catalogues are looked up. Choose a run folder instead.`);
      return 1;
    }
    const outcome = await runLzLiveScan({ ...deps, workspaceRoot, lzId, scopeId: o.scope, activityDays: days, ...o });
    mkdirSync(outDir, { recursive: true });
    printProbe({ results: outcome.results.map((r) => ({ ...r })), exitCode: outcome.exitCode }, deps);
    const scans: LzLiveScan[] = [];
    for (const r of outcome.results) {
      if (!r.scan) continue;
      scans.push(r.scan);
      const file = join(outDir, `${lzId}.${r.scopeId}.lz-live-scan.json`);
      writeFileSync(file, JSON.stringify(r.scan, null, 2) + '\n');
      const missing = r.scan.meta.sources.filter((s) => s.status === 'not_collected').map((s) => s.name);
      const services = r.scan.offering.services;
      deps.out(`  scan: ${services.length} services, ${r.scan.estate.resources.length} resources, ${missing.length} source(s) not collected${missing.length > 0 ? ` (${missing.join(', ')})` : ''}`);
      if (r.scan.meta.simulated) deps.out(`  ${describeSimulation(r.scan.meta.simulated)}`);
      deps.out(`  written: ${file}`);
    }
    if (scans.length > 0) {
      const file = join(outDir, LZ_LIVE_CATALOGUE_FILE);
      writeFileSync(file, JSON.stringify(liveCatalogueFor(scans, workspaceRoot), null, 2) + '\n');
      deps.out(`  live LZ catalogue: ${file}`);
    }
    writeMergedScopes(lzId, outDir, workspaceRoot, staleDays, deps);
    // #3956: the local evidence map of this folder (run id = folder name; resolve with --run-dir).
    if (scans.length > 0) {
      const ev = await writeLzEvidenceMap({ runDir: outDir, runId: lzEvidenceRunIdOf(outDir), lzId, provider: scans[0]!.meta.provider, scans, store: deps.store });
      deps.out(ev.ok ? `  evidence references: ${ev.entries} in ${join(outDir, LZ_EVIDENCE_MAP_FILE)} (local only, never published)` : `  evidence map not written: ${ev.reason}`);
    }
    return outcome.exitCode;
  } catch (err) {
    return fail(err, deps);
  }
}

/**
 * #3581: the live LZ catalogue of this run. Sovereignty facts come from the
 * pins and the resolved static catalogue of the provider (Q-25); a provider
 * without a static catalogue still gets the artefact, with UNKNOWN facts.
 */
function liveCatalogueFor(scans: readonly LzLiveScan[], workspaceRoot: string): LzServiceCatalogue {
  const provider = scans[0]!.meta.provider;
  let staticCatalogue: LzServiceCatalogue | null = null;
  try {
    staticCatalogue = resolveProviderCatalogue(provider, workspaceRoot).catalogue;
  } catch {
    staticCatalogue = null;
  }
  return buildLzLiveCatalogue({ scans, staticCatalogue, pins: LZ_SOVEREIGNTY_PINS[provider] });
}

/**
 * #3583: merge the scopes of the landing zone (Design 120 section 11.1) from
 * every `<lz-id>.<scope-id>.lz-live-scan.json` in the run folder, so a scope
 * scanned in an earlier run joins the merge while it is inside the staleness
 * window. Registered scopes without a scan are listed as missing. A file that
 * is not a valid LzLiveScan is reported and left out of the merge.
 */
function writeMergedScopes(lzId: string, outDir: string, workspaceRoot: string, staleDays: number, deps: LzLiveCliDeps): void {
  const lz = readLandingZones(workspaceRoot).find((l) => l.id === lzId);
  if (!lz) return;
  const suffix = '.lz-live-scan.json';
  const scans: LzLiveScan[] = [];
  for (const name of readdirSync(outDir).sort()) {
    if (!name.startsWith(`${lzId}.`) || !name.endsWith(suffix)) continue;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(outDir, name), 'utf-8')); } catch { raw = undefined; }
    const r = LzLiveScanSchema.safeParse(raw);
    if (!r.success || r.data.meta.lz_id !== lzId || r.data.meta.provider !== lz.provider) {
      deps.err(`[lz live] ${name} is not a valid LzLiveScan of ${lzId}; left out of the merge`);
      continue;
    }
    scans.push(r.data);
  }
  const merged = mergeLzLiveScopes({ lzId, provider: lz.provider, scans, registeredScopes: lz.scopes, windowDays: staleDays });
  const file = join(outDir, LZ_LIVE_MERGED_FILE);
  writeFileSync(file, yamlDump(merged, { noRefs: true, lineWidth: 120 }));
  const listed = merged.scopes.filter((sc) => sc.status !== 'merged').map((sc) => `${sc.scope_id} ${sc.status}`);
  deps.out(`  merged: ${merged.scopes.filter((sc) => sc.status === 'merged').length} scope(s)${listed.length > 0 ? `, not merged: ${listed.join(', ')}` : ''}`);
  deps.out(`  written: ${file}`);
}

function defaultDeps(): LzLiveCliDeps {
  return {
    cwd: process.cwd(),
    store: new CredentialStore(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    guard: { requireFeature: (k) => LicenseGuard.load().requireFeature(k) },
  };
}

const collect = (v: string, prev: string[] = []): string[] => [...prev, v];

export function registerLzLive(lz: Command): void {
  // #3572 (Q-21): only live-verified drivers (otc, aws, stackit since #3831),
  // plus the ones named in SWAO_LZ_UNVERIFIED_DRIVERS (azure) for development runs.
  registerBuiltInLiveLzDrivers();
  lz
    .command('connect <lz-id>')
    .description('Register a live landing zone scope in .swao.yml, store its credentials in the vault and run the read-only probe (Design 120 section 13.2).')
    .requiredOption('--provider <provider>', 'catalogue provider id, for example otc')
    .requiredOption('--scope <scope-id>', 'short name for this scope, used in file names and reports; lower case letters, digits and hyphens, for example platform (#4229)')
    .requiredOption('--kind <kind>', 'platform or application')
    .requiredOption('--auth <method>', 'driver auth method, for example iam-password-token')
    .option('--region <region>', 'region id (repeatable)', collect)
    .option('--target <key=value>', 'scope locator: project, subscription, account, resource_group or folder (repeatable)', collect)
    .option('--app <app-id>', 'link the scope to apps/<app-id>')
    .option('--purpose <purpose>', 'log-archive: the log archive account of the landing zone (an application scope); other scopes read their audit log store through it')
    .option('--aws-profile <name>', 'AWS only: the SSO profile of the AWS config file that swao lz credentials refresh signs in with (stored as aws_profile, a name only; "" removes it)')
    .option('--display <name>', `display name of the landing zone, for example "${providerLabel('otc', 'full')} production"`)
    .option('--credentials-file <path>', 'file with <field>=<value> lines, stored as lz:<lz-id>:<scope-id>:<field>; values are never printed')
    .option('--credentials-stdin', 'read <field>=<value> lines from stdin instead of a file (values never on the command line)')
    .option('--credentials-from <lz-id:scope-id>', 'copy the stored credentials of another landing zone and scope of the same provider and auth method (the vault is per user, keyed by landing zone and scope)')
    .option('--move-legacy-credentials', 'move the Pass 23 AWS / Azure keys (aws-access-key-id, ...) to this scope')
    .option('--no-probe', 'register and store only; skip the read-only probe')
    .option('--accept-unverified-read-only', 'continue when read-only cannot be verified (this run only; stamped into the manifest)')
    .option('--accept-write-capable-credentials', 'continue with a write-capable credential (this run only; stamped into the manifest; SWAO still only reads)')
    .option('--identity-label <label>', 'recording label (SWAO_LZ_RECORD), for example operator or low-privilege', 'operator')
    .action(async (lzId: string, o: ConnectCliOptions) => {
      process.exitCode = await lzConnectAction(lzId, o, defaultDeps());
    });

  lz
    .command('probe <lz-id>')
    .description('Probe a registered landing zone: identity, read-only result and coverage per scope (Design 120 section 6.3).')
    .option('--scope <scope-id>', 'probe one scope only')
    .option('--accept-unverified-read-only', 'treat an unverifiable result as accepted for this run')
    .option('--accept-write-capable-credentials', 'treat a write-capable credential as accepted for this run')
    .option('--identity-label <label>', 'recording label (SWAO_LZ_RECORD)', 'operator')
    .option('--caller <name>', 'who asked for the probe, logged on the lz.live.probe event (default lz.probe)')
    .action(async (lzId: string, o: ProbeCliOptions) => {
      process.exitCode = await lzProbeAction(lzId, o, defaultDeps());
    });

  // #4459: refresh the short-term keys of an AWS session-keys scope (device sign-in, no AWS CLI).
  const credentials = lz
    .command('credentials')
    .description('Landing zone credentials in the SWAO vault (Design 120 section 6.2).');
  credentials
    .command('refresh <lz-id> <scope-id>')
    .description('Refresh the AWS SSO session of an AWS session-keys scope: sign in in the browser (device code), then the new short-term keys and their expiry are stored in the vault. Shows only the URL and the code; SWAO stays read-only towards the cloud.')
    .option('--profile <aws-profile>', 'SSO profile of the AWS config file (default: aws_profile of the scope in .swao.yml, else the profile of the scope target account)')
    .option('--aws-profile <aws-profile>', 'sign in with this SSO profile and store it as aws_profile of the scope after a successful refresh')
    .option('--no-browser', 'print the sign-in URL only; do not open the default browser')
    .action(async (lzId: string, scopeId: string, o: CredentialsRefreshCliOptions) => {
      process.exitCode = await lzCredentialsRefreshAction(lzId, scopeId, o, defaultDeps(), { openUrl: (url) => openAwsSignInUrl(url) });
    });

  lz
    .command('list')
    .description('List the registered landing zones and scopes with their connection state; credential field names only, never values (Design 120 section 14.2).')
    .action(async () => {
      process.exitCode = await lzListAction(defaultDeps());
    });

  lz
    .command('remove <lz-id>')
    .description('Remove a scope (--scope) or the whole landing zone from .swao.yml and delete its lz:<lz-id>:<scope-id>:* vault keys; run data is kept (Design 120 section 14.2).')
    .option('--scope <scope-id>', 'remove one scope only (the last scope removes the landing zone)')
    .action(async (lzId: string, o: RemoveCliOptions) => {
      process.exitCode = await lzRemoveAction(lzId, o, defaultDeps());
    });

  lz
    .command('diff <lz-id>')
    .description('Compare two live runs of a landing zone per scope: new and removed regions, services and resource counts, status changes (Design 120 section 13.2).')
    .option('--from <ts>', 'earlier run (default: for each scope, the newest earlier run with a scan of it)')
    .option('--to <ts>', 'later run (default: latest-lz-live.txt, else the newest run)')
    .option('--scope <scope-id>', 'compare one scope only')
    .action((lzId: string, o: DiffCliOptions) => {
      process.exitCode = lzDiffAction(lzId, o, defaultDeps());
    });

  lz
    .command('hierarchy <lz-id>')
    .description('Show the tenant tree of a live landing zone run: pseudonymised labels, kinds, unknown nodes, baseline fail and unverified counts per node; never native ids (Design 123 section 9.4).')
    .option('--run <ts>', 'run to show (default: latest-lz-live.txt, else the newest run)')
    .action((lzId: string, o: HierarchyCliOptions) => {
      process.exitCode = lzHierarchyAction(lzId, o, defaultDeps());
    });

  // #4128 BC-03 (Design 123 section 17.3.1, O-5 provisional: hidden; the TUI path is SWAO Chat).
  lz
    .command('baseline-impact <lz-id>', { hidden: true })
    .description('Internal (MCP swao_baseline_impact): re-evaluate the stored scans of a live run with candidate Client LZ Policy Baseline values; counts only, nothing written.')
    .requiredOption('--framework <id>', 'baseline framework id or folder in wsp/inputs/catalogs/community/')
    .requiredOption('--changes <json>', 'JSON array of changes: [{"policy_id":"CPB-LOG-02","params":{"min_days":365}}]')
    .option('--run <ts>', 'run to re-evaluate (default: latest-lz-live.txt, else the newest run)')
    .option('--json', 'print the lz-baseline-impact/1 JSON document')
    .action((lzId: string, o: BaselineImpactCliOptions) => {
      process.exitCode = lzBaselineImpactAction(lzId, o, defaultDeps());
    });

  lz
    .command('evidence [ref]')
    .description('Resolve an evidence reference (ev:<run>:<check or block>:Ref-<hex>) from the local evidence map of its run: native id, scope, region, setting and the console link; without a reference, list the references of a run (Design 123 section 9.5).')
    .option('--lz <lz-id>', 'landing zone (list mode; narrows the lookup when resolving)')
    .option('--run <ts>', 'run to list (default: latest-lz-live.txt, else the newest run with an evidence map)')
    .option('--run-dir <dir>', 'resolve from this run folder (a swao lz scan --out folder)')
    .option('--open', 'open the console link in the default browser; the console login decides access')
    .action((ref: string | undefined, o: EvidenceCliOptions) => {
      process.exitCode = lzEvidenceAction(ref, o, defaultDeps());
    });

  lz
    .command('scan <lz-id>')
    .description('Run a read-only live scan of a registered landing zone and write one LzLiveScan per scope plus the live LZ catalogue (Design 120 sections 7.3, 10.1, 13.2).')
    .requiredOption('--mode <mode>', 'live (iac and export use the existing LZ scan inputs)')
    .requiredOption('--out <dir>', 'run folder for <lz-id>.<scope-id>.lz-live-scan.json and lz-live-catalogue.json (never an LZ catalogue folder)')
    .option('--scope <scope-id>', 'scan one scope only')
    .option('--days <n>', `activity window in days (default ${DEFAULT_ACTIVITY_DAYS})`)
    .option('--stale-days <n>', `scope merge staleness window in days (default ${LZ_LIVE_STALENESS_DAYS}); older scans in --out are listed as stale`)
    .option('--accept-unverified-read-only', 'continue when read-only cannot be verified (this run only; stamped into the scan)')
    .option('--accept-write-capable-credentials', 'continue with a write-capable credential (this run only; stamped into the scan; SWAO still only reads)')
    .option('--identity-label <label>', 'recording label (SWAO_LZ_RECORD)', 'operator')
    .action(async (lzId: string, o: ScanCliOptions) => {
      process.exitCode = await lzScanAction(lzId, o, defaultDeps());
    });
}

export interface LzLiveAssessCliOptions extends ReadOnlyFlags {
  scope?: string[];
  frameworks?: string;
  days?: string;
  staleDays?: string;
  identityLabel?: string;
}

/**
 * #3766: `swao assess --type landing-zone-live --lz <lz-id> [--scope <id>...]
 * --frameworks <id,...>` (Design 120 section 13.2). The host passes the
 * baseline checks of the LZ checks catalogue. Exit 0 complete; 1 partial,
 * failed, refused or invalid input; 2 tier (the [LICENSE] block, ADR-0055, #3844).
 */
export async function lzLiveAssessAction(
  lzId: string,
  o: LzLiveAssessCliOptions,
  deps: LzLiveCliDeps & { checks: readonly LzLiveCheckDefinition[]; swaoVersion?: string; ingestOrganisationalDocuments?: LzLiveAssessOptions['ingestOrganisationalDocuments'] },
): Promise<number> {
  try {
    requireLzLiveFeature(deps.guard, 'assess');
    const days = o.days === undefined ? DEFAULT_ACTIVITY_DAYS : Number(o.days);
    const staleDays = o.staleDays === undefined ? LZ_LIVE_STALENESS_DAYS : Number(o.staleDays);
    for (const [flag, v, raw] of [['--days', days, o.days], ['--stale-days', staleDays, o.staleDays]] as const) {
      if (!Number.isInteger(v) || v < 1) {
        deps.err(`[lz live] ${flag} must be a positive whole number, not ${raw}`);
        return 1;
      }
    }
    const outcome = await runLzLiveAssessment({
      ...deps,
      workspaceRoot: workspaceOf(deps),
      lzId,
      scopeIds: o.scope,
      frameworks: o.frameworks,
      checks: deps.checks,
      activityDays: days,
      staleDays,
      acceptUnverifiedReadOnly: o.acceptUnverifiedReadOnly,
      acceptWriteCapableCredentials: o.acceptWriteCapableCredentials,
      identityLabel: o.identityLabel,
      progress: deps.out,
    });
    for (const s of outcome.scopes) (s.status === 'complete' ? deps.out : deps.err)(`  scope ${s.scope_id}: ${s.status}${s.message ? ` (${s.message})` : ''}`);
    deps.out(`[lz live] run ${outcome.runId}: ${outcome.status} -> ${outcome.runDir}`);
    if (outcome.status !== 'failed') deps.out(`[lz live] publish with: swao publish --lz-live ${lzId}`);
    return outcome.exitCode;
  } catch (err) {
    return fail(err, deps);
  }
}

/**
 * #3766: host entry for `swao assess --type landing-zone-live`: registers the
 * built-in drivers (same Q-21 gate as `swao lz`) and runs the action with the
 * process defaults (vault, licence, console).
 */
export async function runLzLiveAssessCli(
  lzId: string,
  o: LzLiveAssessCliOptions,
  host: { checks: readonly LzLiveCheckDefinition[]; swaoVersion?: string; cwd?: string; ingestOrganisationalDocuments?: LzLiveAssessOptions['ingestOrganisationalDocuments'] },
): Promise<number> {
  registerBuiltInLiveLzDrivers();
  return lzLiveAssessAction(lzId, o, {
    ...defaultDeps(), ...(host.cwd ? { cwd: host.cwd } : {}), checks: host.checks, swaoVersion: host.swaoVersion,
    // #4050: the host routes landing-zones/<lz-id>/ingestion/ through Pass 00.
    ...(host.ingestOrganisationalDocuments ? { ingestOrganisationalDocuments: host.ingestOrganisationalDocuments } : {}),
  });
}

export interface LzLivePortfolioCliOptions {
  includeSimulated?: boolean;
}

export interface LzLivePortfolioCliDeps {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  guard: Pick<LicenseGuard, 'requireFeature'>;
  /** Rebuilds `wsp/portfolio-summary.json` (the single aggregator, 114 section 5.3); injected by the host. */
  rebuildSummary?: (workspaceRoot: string) => void;
  now?: () => Date;
  /** #3822: required services of an app (its latest assessment), injected by the host. */
  requiredServicesFor?: (workspaceRoot: string, appId: string) => LzRequiredService[] | undefined;
}

/**
 * #3584: `swao assess --portfolio --type landing-zone-live [--include-simulated]`
 * (Design 120 sections 11.2, 13.2; Enterprise, Q-07). Merges the latest run of
 * every registered landing zone, writes `wsp/lz-live-portfolio/runs/<ts>/`,
 * then rebuilds the portfolio summary. Exit 0 when at least one landing zone
 * was merged; 1 when none was; 2 tier (the [LICENSE] block, ADR-0055, #3844).
 */
export function lzLivePortfolioAction(o: LzLivePortfolioCliOptions, deps: LzLivePortfolioCliDeps): number {
  try {
    requireLzLiveFeature(deps.guard, 'portfolio');
    const workspaceRoot = workspaceOf(deps as LzLiveCliDeps);
    const requiredFor = deps.requiredServicesFor;
    const outcome = runLzLivePortfolio({
      workspaceRoot,
      ...(o.includeSimulated !== undefined ? { includeSimulated: o.includeSimulated } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(requiredFor ? { requiredServicesFor: (appId: string) => requiredFor(workspaceRoot, appId) } : {}),
    });
    for (const line of formatLzLivePortfolio(outcome.portfolio)) deps.out(`  ${line}`);
    if (outcome.portfolio.landing_zones.length === 0) {
      deps.err('[lz live] portfolio: no landing zone could be merged; run swao assess --type landing-zone-live --lz <lz-id> first');
      return 1;
    }
    deps.rebuildSummary?.(workspaceRoot);
    deps.out(`[lz live] portfolio ${outcome.runId}: ${outcome.portfolio.landing_zones.length} landing zone(s) merged -> ${outcome.file}`);
    return 0;
  } catch (err) {
    return fail(err, deps);
  }
}

/** #3584: host entry with the process defaults (licence, console). */
export function runLzLivePortfolioCli(o: LzLivePortfolioCliOptions, host: { cwd?: string; rebuildSummary?: (workspaceRoot: string) => void; requiredServicesFor?: LzLivePortfolioCliDeps['requiredServicesFor'] }): number {
  const d = defaultDeps();
  return lzLivePortfolioAction(o, { cwd: host.cwd ?? d.cwd, out: d.out, err: d.err, guard: d.guard, ...(host.rebuildSummary ? { rebuildSummary: host.rebuildSummary } : {}), ...(host.requiredServicesFor ? { requiredServicesFor: host.requiredServicesFor } : {}) });
}
