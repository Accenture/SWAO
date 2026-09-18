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

import * as crypto from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { LicenseGuard, LicenseInvalidError, normalizeTier, _paths, logPortfolio } from '@swao/core';
import type { LicenseState } from '@swao/core';

const LICENSE_TO_EMAIL = 'swao-tool@accenture.com';

export interface RequestTokenExtras {
  /** Requested licence duration in days. Advisory -- the operator may
   *  override at issuance time. */
  durationDays?: number;
  /** Requested assessment budget. Positive integer or null (unlimited).
   *  Advisory -- the operator may override. */
  assessmentLimit?: number | null;
  // #0744: user-supplied fields embedded in the token so the operator
  // can decode and auto-populate the issuance form without re-typing them.
  licensee?: string;
  email?: string;
  orgName?: string;
  orgId?: string;
  evbItOrderRef?: string;
}

export function buildRequestToken(fp: string, tier: string, extras: RequestTokenExtras = {}): string {
  const token: Record<string, unknown> = {
    v: 1,
    type: 'license_request',
    fp: fp,
    requested_tier: tier,
    iat: new Date().toISOString().slice(0, 10),
  };
  if (extras.durationDays !== undefined) {
    token['requested_duration_days'] = extras.durationDays;
  }
  if (extras.assessmentLimit !== undefined) {
    // Preserve `null` (= unlimited) explicitly in the payload.
    token['requested_assessment_limit'] = extras.assessmentLimit;
  }
  // #0744: embed user-supplied fields so the operator tool can pre-fill without re-typing.
  if (extras.licensee) token['licensee'] = extras.licensee;
  if (extras.email)    token['email']    = extras.email;
  if (extras.orgName)  token['org_name'] = extras.orgName;
  if (extras.orgId)    token['org_id']   = extras.orgId;
  if (extras.evbItOrderRef) token['evb_it_order_ref'] = extras.evbItOrderRef;
  return Buffer.from(JSON.stringify(token)).toString('base64url');
}

export function buildRequestLines(token: string, fp: string, tier: string, extras: RequestTokenExtras = {}): string[] {
  const tierLabel = normalizeTier(tier) === 'enterprise' ? 'Enterprise' : 'Consultant';
  const lines: string[] = [
    'License Request Token',
    '=====================',
    `Request token: ${token}`,
    '',
    'To request a license, send the following email:',
    '',
    `  To:      ${LICENSE_TO_EMAIL}`,
    `  Subject: SWAO License Request -- ${tier}`,
    '',
    '  Hello,',
    '',
    `  Please issue a ${tierLabel} license for:`,
    '',
    `  Organisation:      ${extras.orgName ?? '(fill in)'}`,
    `  Contact email:     ${extras.email ?? '(fill in)'}`,
    `  Org ID:            ${extras.orgId ?? '(fill in if enterprise)'}`,
    `  Requested tier:    ${tier}`,
    `  Machine fingerprint: ${fp}`,
    ...(extras.licensee ? [`  Licensee name:     ${extras.licensee}`] : []),
  ];

  if (extras.durationDays !== undefined) {
    lines.push(`  Requested duration: ${extras.durationDays} days`);
  }
  if (extras.assessmentLimit !== undefined) {
    const label = extras.assessmentLimit === null ? 'unlimited' : `${extras.assessmentLimit} assessments`;
    lines.push(`  Requested budget: ${label}`);
  }

  lines.push(
    `  Request token: ${token}`,
    '',
    '  Thank you.',
    '',
    'A license key will be returned to your contact email within 2 business days.',
    'When you receive it, run: swao license activate <key>',
    '',
    'NOTE: The request token above is NOT the activation key.',
    'Send it to the operator and wait for their signed key reply.',
    '',
    'Documentation and discussions: https://github.com/Accenture/SWAO',
  );
  return lines;
}

export interface RemovalTokenPayload {
  v: 1;
  type: 'license_removal';
  fp: string;       // first 8 chars of fingerprint
  tier: string;     // 'consultant' | 'enterprise'
  licensee: string;
  removed_at: string; // ISO-8601 date
  sig: string;      // first 16 hex chars of HMAC-SHA256
}

/**
 * Build a cryptographically-attributed removal token.
 * The HMAC key is derived from the raw decrypted licence bytes so only
 * a process holding the genuine credential can produce a valid token.
 * rawLicenceBytes = Buffer of the decrypted licence JSON string.
 */
export function buildRemovalToken(
  fp: string,
  tier: string,
  licensee: string,
  rawLicenceBytes: Buffer,
): string {
  const removed_at = new Date().toISOString().slice(0, 10);
  const hmacKey = crypto.createHash('sha256').update(rawLicenceBytes).digest();
  const sig = crypto.createHmac('sha256', hmacKey)
    .update(`${fp}|${tier}|${removed_at}`)
    .digest('hex')
    .slice(0, 16);
  const payload: RemovalTokenPayload = { v: 1, type: 'license_removal', fp, tier, licensee, removed_at, sig };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Build the email template lines for a licence removal notification.
 */
export function buildRemovalLines(token: string, tier: string): string[] {
  const tierLabel = normalizeTier(tier) === 'enterprise' ? 'Enterprise' : 'Consultant';
  return [
    'License Removal Token',
    '=====================',
    `Removal token: ${token}`,
    '',
    'Your license has been removed from this machine.',
    'To notify the operator, send the following email:',
    '',
    `  To:      ${LICENSE_TO_EMAIL}`,
    `  Subject: SWAO License Removal -- ${tierLabel}`,
    '',
    '  Hello,',
    '',
    `  I have removed my ${tierLabel} license from this machine.`,
    `  Removal token: ${token}`,
    '',
    '  Please update your records accordingly.',
    '',
    '  Thank you.',
    '',
    'The removal token is cryptographically attributed and can be verified',
    'by the operator using the swao-premium verify-removal script.',
  ];
}

function daysRemaining(exp: string): number {
  return Math.max(0, Math.floor((new Date(exp).getTime() - Date.now()) / 86_400_000));
}

export function communityStatusText(state: LicenseState): string[] {
  // After M18 D-05 (revised 2026-05-17): Community is unlimited.
  // Counters are informational only -- no "remaining" language, no
  // expiry date, no exhaustion branch.
  const lines = [
    'SWAO License Status',
    '===================',
    `Tier:                Community (free, unlimited)`,
    `First run:           ${state.firstRun}`,
    `Assessments run:     ${state.assessmentCount} (lifetime; no limit)`,
    `Days since first run: ${state.daysElapsed}`,
    `Machine fingerprint: ${state.fingerprint.substring(0, 16)}  (provide this when requesting a license)`,
    '',
  ];
  if (state.exp) {
    const isActuallyExpired = new Date(state.exp).getTime() < Date.now();
    if (isActuallyExpired) {
      // Licence genuinely expired in the past.
      lines.push(`Previous licence expired: ${state.exp}${state.licensee ? ` (${state.licensee})` : ''}`);
    } else {
      // Valid higher-tier licence on file, but capped to Community by this binary.
      lines.push(`Higher-tier licence on file (expires ${state.exp}${state.licensee ? `, ${state.licensee}` : ''})`);
      lines.push('Use the Enterprise or Consultant binary to activate it.');
    }
    lines.push('');
  }
  lines.push(
    'To unlock PDF reports, branded headers, BI templates, portfolio',
    'mode, or `swao challenge`, request a Consultant or Enterprise licence:',
    '  swao license request',
  );
  return lines;
}

function licensedStatusText(state: LicenseState): string[] {
  const tierLabel = state.tier === 'enterprise' ? 'Enterprise' : 'Consultant';
  const expDaysLeft = state.exp ? daysRemaining(state.exp) : 0;
  const limit = state.assessmentLimit;
  const budgetLine =
    limit == null
      ? `Assessments:         ${state.assessmentCount} run (unlimited)`
      : `Assessments:         ${state.assessmentCount} / ${limit} used  (${Math.max(0, limit - state.assessmentCount)} remaining)`;
  return [
    'SWAO License Status',
    '===================',
    `Tier:                ${tierLabel}`,
    ...(state.licensee ? [`Licensee:            ${state.licensee}`] : []),
    ...(state.email ? [`Email:               ${state.email}`] : []),
    ...(state.exp ? [`Expires:             ${state.exp} (${expDaysLeft} days remaining)`] : []),
    budgetLine,
    `Machine fingerprint: ${state.fingerprint.substring(0, 16)} (matched)`,
    '',
    'License is valid.',
  ];
}

export interface LicenseStatusJson {
  tier: string;
  firstRun: string;
  /** Lifetime counter. Increments on every successful `swao assess`. */
  assessmentCount: number;
  /** Per-licence budget. `null` means unlimited; absent for Community. */
  assessmentLimit?: number | null;
  daysElapsed: number;
  exp?: string;
  licensee?: string;
  email?: string;
  /** True when no enforceable condition would block a fresh `swao assess`.
   *  Always true for Community (no cap since M18 D-05 revised). False
   *  for licensed users who have reached `assessment_limit`. */
  valid: boolean;
}

// swao license issue was removed from the binary by #1227 (2026-07-26).
// issueLicense() and its helpers live in license-issue.ts, which is imported
// only by license.test.ts.  esbuild does not reach license-issue.ts from any
// production entry point, so buildKey / signingPrivateSeed are excluded from
// all compiled bundles.  The audit gate
// tests/audit-gates/license-generation-isolation.gate.mjs verifies this.
// Issuance: use `node swao-premium/scripts/issue-license.mjs` on the
// air-gapped admin machine (signs via swao-premium/lib/license-admin.mjs).

export function licenseStateToJson(state: LicenseState): LicenseStatusJson {
  const limit = state.assessmentLimit;
  const budgetExhausted = limit != null && state.assessmentCount >= limit;
  return {
    tier: state.tier,
    firstRun: state.firstRun,
    assessmentCount: state.assessmentCount,
    ...(limit !== undefined ? { assessmentLimit: limit } : {}),
    daysElapsed: state.daysElapsed,
    ...(state.exp ? { exp: state.exp } : {}),
    ...(state.licensee ? { licensee: state.licensee } : {}),
    ...(state.email ? { email: state.email } : {}),
    valid: !budgetExhausted,
  };
}

/**
 * Register the `swao license remove` subcommand on an existing license Command.
 * Only registered when SWAO_BINARY_TIER is 'consultant' or 'enterprise' -- the
 * Community binary does not carry this command.
 */
export function registerLicenseRemoveCommand(licenseCmd: Command): void {
  const binaryTier = process.env['SWAO_BINARY_TIER'];
  if (binaryTier !== 'consultant' && binaryTier !== 'enterprise') return;

  licenseCmd
    .command('remove')
    .description('Remove the active license from this machine and generate a removal token')
    .option('--json', 'Output removal result as JSON (skips confirmation prompt)', false)
    .action(async (opts: { json: boolean }) => {
      // Load state -- determines whether a licence is present.
      let state;
      try {
        state = LicenseGuard.load().state;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.error(`[LICENSE] ${msg}`);
        }
        process.exit(3);
        return;
      }

      if (state.tier === 'community') {
        if (opts.json) {
          console.log(JSON.stringify({ message: 'No active license found on this machine. Nothing to remove.' }, null, 2));
        } else {
          console.log('No active license found on this machine. Nothing to remove.');
        }
        process.exit(0);
        return;
      }

      // Read raw licence bytes before deleting -- HMAC key derivation requires
      // the exact bytes that were written to the licence file on activation.
      let rawLicenceBytes: Buffer;
      try {
        rawLicenceBytes = readFileSync(_paths.licensePath);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (opts.json) {
          console.log(JSON.stringify({ error: `Could not read licence file: ${msg}` }, null, 2));
        } else {
          console.error(`[LICENSE] Could not read licence file: ${msg}`);
        }
        process.exit(3);
        return;
      }

      const fp       = state.fingerprint;
      const tier     = state.tier;
      const licensee = state.licensee ?? '';

      if (!opts.json) {
        // Show current licence info and require explicit confirmation.
        const tierLabel = tier === 'enterprise' ? 'Enterprise' : 'Consultant';
        console.log('Current license:');
        console.log(`  Tier:        ${tierLabel}`);
        if (state.licensee) console.log(`  Licensee:    ${state.licensee}`);
        if (state.exp)      console.log(`  Expires:     ${state.exp}`);
        console.log(`  Fingerprint: ${fp.substring(0, 16)}`);
        console.log('');
        console.log('WARNING: This will permanently remove the license from this machine.');
        console.log('A removal token will be generated for your records.');
        console.log('');

        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question('Type "remove" to confirm, or press Enter to cancel: ', (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'remove');
          });
        });

        if (!confirmed) {
          console.log('Cancelled. License not removed.');
          process.exit(0);
          return;
        }
      }

      const token = buildRemovalToken(fp, tier, licensee, rawLicenceBytes);

      // Delete the licence file -- this commits the removal.
      try {
        unlinkSync(_paths.licensePath);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        try { logPortfolio('error', 'licence.remove.error', 'Licence removal failed -- could not delete licence file', { context: { err: msg } }); } catch { /* best-effort */ }
        if (opts.json) {
          console.log(JSON.stringify({ error: `Could not remove licence file: ${msg}` }, null, 2));
        } else {
          console.error(`[LICENSE] Could not remove licence file: ${msg}`);
        }
        process.exit(3);
        return;
      }

      // #2652: also clear the legacy per-user home path so the migration shim
      // in LicenseGuard.load() does not copy it back on the next call.
      try {
        if (existsSync(_paths.legacyLicencePath)) unlinkSync(_paths.legacyLicencePath);
      } catch { /* best-effort */ }

      try { logPortfolio('info', 'licence.remove', 'Licence removed via CLI', { context: { tier, fingerprint: fp.substring(0, 8) } }); } catch { /* best-effort */ }

      if (opts.json) {
        console.log(JSON.stringify({
          removed: true,
          removal_token: token,
          tier,
          fingerprint: fp.substring(0, 8),
          ...(state.licensee ? { licensee: state.licensee } : {}),
        }, null, 2));
        return;
      }

      const lines = buildRemovalLines(token, tier);
      console.log(lines.join('\n'));
    });
}

export function registerLicense(program: Command): void {
  const licenseCmd = program
    .command('license')
    .description('Licence management: show tier (Community/Consultant/Enterprise), request an upgrade, or activate a licence key.');

  licenseCmd
    .command('status')
    .description('Show current license tier and usage')
    .option('--json', 'Output machine-readable JSON', false)
    .action((opts: { json: boolean }) => {
      let state;
      try {
        state = LicenseGuard.load().state;
      } catch (e) {
        if (e instanceof LicenseInvalidError) {
          if (opts.json) {
            console.log(JSON.stringify({ error: e.message, code: e.code }, null, 2));
          } else {
            console.error(e.message);
          }
          process.exit(3);
        }
        // Generic Error (e.g. SWAO_LICENSE_SECRET unset after M18 #0271)
        // -- catch so we print a clean message instead of a stack trace.
        const msg = (e as Error).message ?? String(e);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg, code: 'secret_unset_or_environment_error' }, null, 2));
        } else {
          console.error(`[LICENSE] ${msg}`);
          console.error('');
          console.error('Hint: on PowerShell, load the rotated secret with:');
          console.error('  Get-Content C:\\Projects\\accenture\\swao-premium\\secrets\\.env | ForEach-Object {');
          console.error('    if ($_ -match "^SWAO_LICENSE_SECRET=(.+)$") { $env:SWAO_LICENSE_SECRET = $matches[1] }');
          console.error('  }');
        }
        process.exit(3);
      }

      // After M18 D-05 (revised): a licensed user is "exhausted" only
      // when they have reached `assessment_limit`. Community is never
      // exhausted. Exit code 2 still signals "stop and contact us".
      const limit = state.assessmentLimit;
      const budgetExhausted = limit != null && state.assessmentCount >= limit;

      if (opts.json) {
        console.log(JSON.stringify(licenseStateToJson(state), null, 2));
        process.exit(budgetExhausted ? 2 : 0);
        return;
      }

      const isLicensed = state.tier !== 'community';
      const lines = isLicensed ? licensedStatusText(state) : communityStatusText(state);
      console.log(lines.join('\n'));
      process.exit(budgetExhausted ? 2 : 0);
    });

  licenseCmd
    .command('request')
    .description('Generate a license request email template')
    .option('--tier <tier>', 'License tier to request', 'consultant')
    .option('--duration-days <int>', 'Requested licence duration in days (advisory; operator may override)')
    .option('--assessment-limit <value>', 'Requested budget: positive integer or "unlimited" (advisory; operator may override)')
    .option('--licensee <name>', 'Your full name (embedded in the request token for the operator)')
    .option('--email <email>', 'Your contact email (embedded in the request token)')
    .option('--org-name <name>', 'Your organisation name (embedded in the request token)')
    .option('--org-id <slug>', 'Your organisation ID slug for enterprise seat grouping (embedded in the request token)')
    .option('--evb-it-order-ref <ref>', 'EVB-IT contract reference, if applicable (optional; embedded in the request token)')
    .option('--json', 'Output request token as JSON', false)
    .action((opts: {
      tier: string;
      durationDays?: string;
      assessmentLimit?: string;
      licensee?: string;
      email?: string;
      orgName?: string;
      orgId?: string;
      evbItOrderRef?: string;
      json: boolean;
    }) => {
      // Accept the canonical names plus the legacy aliases (ADR-0049); the
      // request token carries the normalised canonical name.
      if (
        opts.tier !== 'consultant' &&
        opts.tier !== 'enterprise' &&
        opts.tier !== 'standard' &&
        opts.tier !== 'premium'
      ) {
        console.error(`[error] Invalid tier "${opts.tier}". Valid values: consultant, enterprise`);
        process.exit(1);
      }
      const tier = normalizeTier(opts.tier);

      // Parse the optional extras. All are advisory and may be omitted.
      const extras: RequestTokenExtras = {};
      if (opts.durationDays !== undefined) {
        const n = Number(opts.durationDays);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          console.error(`[error] Invalid --duration-days "${opts.durationDays}". Expected a positive integer.`);
          process.exit(1);
        }
        extras.durationDays = n;
      }
      if (opts.assessmentLimit !== undefined) {
        if (opts.assessmentLimit === 'unlimited') {
          extras.assessmentLimit = null;
        } else {
          const n = Number(opts.assessmentLimit);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
            console.error(`[error] Invalid --assessment-limit "${opts.assessmentLimit}". Expected a positive integer or "unlimited".`);
            process.exit(1);
          }
          extras.assessmentLimit = n;
        }
      }
      // #0744: embed user-supplied identity fields in the token.
      if (opts.licensee) extras.licensee = opts.licensee;
      if (opts.email) extras.email = opts.email;
      if (opts.orgName) extras.orgName = opts.orgName;
      if (opts.orgId) extras.orgId = opts.orgId;
      if (opts.evbItOrderRef) extras.evbItOrderRef = opts.evbItOrderRef;

      // Use fingerprint() rather than load(): the request flow does NOT
      // need to verify any existing licence file (which would require
      // SWAO_LICENSE_SECRET). The fingerprint comes from hostname +
      // platform + first-run and is always available.
      let fingerprint: string;
      try {
        fingerprint = LicenseGuard.fingerprint();
      } catch (e) {
        // The state file is essentially always creatable; if it isn't
        // (filesystem error, etc.), surface the actual problem rather
        // than masking it with placeholder zeros.
        console.error(`[error] Could not read or create the machine state file: ${(e as Error).message}`);
        process.exit(1);
      }

      const token = buildRequestToken(fingerprint, tier, extras);

      if (opts.json) {
        console.log(JSON.stringify({
          request_token: token,
          requested_tier: tier,
          fingerprint: fingerprint.substring(0, 8),
          ...(extras.durationDays !== undefined ? { requested_duration_days: extras.durationDays } : {}),
          ...(extras.assessmentLimit !== undefined ? { requested_assessment_limit: extras.assessmentLimit } : {}),
        }, null, 2));
        return;
      }

      const lines = buildRequestLines(token, fingerprint, tier, extras);
      console.log(lines.join('\n'));
    });

  licenseCmd
    .command('activate <key>')
    .description('Activate a license key received by email')
    .action((key: string) => {
      let payload;
      try {
        payload = LicenseGuard.activate(key);
      } catch (e) {
        if (e instanceof LicenseInvalidError) {
          try { logPortfolio('error', 'licence.activate.error', 'Licence activation failed', { context: { code: e.code, licence_id_suffix: key.slice(-8) } }); } catch { /* best-effort */ }
          console.error(e.message);
          process.exit(e.code === 'expired' ? 2 : 3);
        }
        // Generic Error (e.g. SWAO_LICENSE_SECRET unset).
        const msg = (e as Error).message ?? String(e);
        try { logPortfolio('error', 'licence.activate.error', 'Licence activation failed (generic)', { context: { err: msg } }); } catch { /* best-effort */ }
        console.error(`[LICENSE] ${msg}`);
        process.exit(3);
      }

      // payload.tier is read straight from the (verified) licence payload, so
      // it can still hold a legacy name; normalise before labelling (ADR-0049).
      const tierLabel = normalizeTier(payload.tier) === 'enterprise' ? 'Enterprise' : 'Consultant';
      const fp8 = payload.fp;
      try { logPortfolio('info', 'licence.activate', 'Licence activated via CLI', { context: { tier: normalizeTier(payload.tier), exp: payload.exp, licence_id_suffix: key.slice(-8) } }); } catch { /* best-effort */ }
      console.log('License activated.');
      console.log(`Tier:          ${tierLabel}`);
      if (payload.licensee) console.log(`Licensee:      ${payload.licensee}`);
      console.log(`Expires:       ${payload.exp}`);
      console.log(`Machine fingerprint: ${fp8} (matched)`);
    });

  // swao license issue was removed from the binary by #1227 (2026-07-26).
  // Signing code (`buildKey`, `signingPrivateSeed`) remains in @swao/core for
  // test use; esbuild tree-shaking prunes it from the compiled bundles because
  // no production entry point calls it. The audit gate
  // `tests/audit-gates/license-generation-isolation.gate.mjs` verifies the
  // compiled bundle does not reference the signing env var.
  // Issuance: use `node swao-premium/scripts/issue-license.mjs` on the
  // air-gapped admin machine (signs via swao-premium/lib/license-admin.mjs).

  // swao license remove -- conditionally registered for consultant/enterprise binaries.
  registerLicenseRemoveCommand(licenseCmd);
}
