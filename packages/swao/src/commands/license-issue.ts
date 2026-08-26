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
//
// license-issue.ts -- pure signing logic for `swao license issue`.
//
// This module is intentionally NOT imported by any production entry point.
// It is imported only by license.test.ts for unit testing.  esbuild therefore
// excludes it from all compiled binaries (no production tree-path reaches it),
// which satisfies the isolation requirement in #1227 / Design 062 section 10.
//
// Signing in production uses swao-premium/lib/license-admin.mjs on the
// operator-side admin machine; this file mirrors the validation logic so
// tests can exercise it without spawning a separate process.

import { buildLicenseKey, normalizeTier } from '@swao/core';
import type { LicenseTier, LicensePayload } from '@swao/core';

export interface IssueOptions {
  // Accepts the canonical `consultant` | `enterprise` and, for backward
  // compatibility, the legacy `standard` | `premium` aliases (normalised at
  // the top of issueLicense). Community cannot be issued.
  tier: LicenseTier | 'standard' | 'premium';
  licensee: string;
  email: string;
  fp: string;                       // 8-char lowercase hex
  organisation?: string;
  exp?: string;                     // YYYY-MM-DD; Consultant default = today+365; Enterprise required
  assessmentLimit?: number | null;  // undefined applies tier default; null = unlimited
}

export interface IssueResult {
  key: string;
  payload: LicensePayload;
}

const CONSULTANT_DEFAULT_DAYS = 365;
export const CONSULTANT_DEFAULT_BUDGET = 500;
export const ENTERPRISE_DEFAULT_BUDGET = 2000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build and sign a licence payload from operator input. Throws Error with
 * a human-readable message on any validation failure.
 */
export function issueLicense(opts: IssueOptions): IssueResult {
  // --- tier ---
  // Accept the canonical names plus the legacy aliases (ADR-0049). Reject
  // anything else (notably `community`, which cannot be issued). The
  // normalised value drives every downstream branch AND the signed payload,
  // so issuance always writes the new canonical name even when an operator
  // passes a legacy alias.
  if (
    opts.tier !== 'consultant' &&
    opts.tier !== 'enterprise' &&
    opts.tier !== 'standard' &&
    opts.tier !== 'premium'
  ) {
    throw new Error(`Invalid --tier "${opts.tier}". Valid values: consultant, enterprise.`);
  }
  const tier = normalizeTier(opts.tier);

  // --- fp ---
  if (!/^[0-9a-f]{8}$/.test(opts.fp)) {
    throw new Error(`Invalid --fp "${opts.fp}". Expected 8 lowercase hex characters.`);
  }

  // --- licensee / email ---
  if (!opts.licensee || opts.licensee.trim() === '') {
    throw new Error('--licensee is required.');
  }
  if (!opts.email || opts.email.trim() === '') {
    throw new Error('--email is required.');
  }

  // --- exp (tier-specific default) ---
  let exp = opts.exp;
  if (!exp) {
    if (tier === 'enterprise') {
      throw new Error('Enterprise licences require an explicit --exp (engagement duration varies, no sensible default).');
    }
    exp = addDaysIso(todayIso(), CONSULTANT_DEFAULT_DAYS);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    throw new Error(`Invalid --exp "${exp}". Expected YYYY-MM-DD.`);
  }
  // Real-calendar-date check. Cannot rely on `new Date(exp)` alone:
  // JavaScript silently overflows out-of-range values (June 31 -> July 1,
  // February 30 -> March 2). We construct the Date with the parsed
  // components and confirm round-trip equality.
  const parts = exp.split('-').map(Number);
  const [yy, mm, dd] = [parts[0]!, parts[1]!, parts[2]!];
  const checkDate = new Date(yy, mm - 1, dd);
  if (
    Number.isNaN(checkDate.getTime()) ||
    checkDate.getFullYear() !== yy ||
    checkDate.getMonth() !== mm - 1 ||
    checkDate.getDate() !== dd
  ) {
    throw new Error(`Invalid --exp "${exp}". Not a real calendar date (e.g. June has 30 days, not 31).`);
  }
  const expDate = new Date(exp);
  const todayDate = new Date(todayIso());
  if (expDate.getTime() <= todayDate.getTime()) {
    throw new Error(`--exp "${exp}" must be in the future (today: ${todayIso()}).`);
  }

  // --- assessment-limit (tier-specific default) ---
  let assessmentLimit: number | null;
  if (opts.assessmentLimit === undefined) {
    assessmentLimit = tier === 'consultant' ? CONSULTANT_DEFAULT_BUDGET : ENTERPRISE_DEFAULT_BUDGET;
  } else {
    assessmentLimit = opts.assessmentLimit;
  }
  if (assessmentLimit !== null) {
    if (!Number.isInteger(assessmentLimit) || assessmentLimit <= 0) {
      throw new Error(`Invalid --assessment-limit "${assessmentLimit}". Expected a positive integer or "unlimited".`);
    }
  }

  // --- build + sign ---
  const payload: LicensePayload = {
    v: 1,
    tier,
    licensee: opts.licensee.trim(),
    email: opts.email.trim(),
    ...(opts.organisation && opts.organisation.trim() !== '' ? { organisation: opts.organisation.trim() } : {}),
    exp,
    assessment_limit: assessmentLimit,
    fp: opts.fp,
    iat: todayIso(),
  };

  // Isolate the signing call (which reads SWAO_LICENSE_SECRET via
  // LicenseGuard.signingSeed). If signing fails, re-throw with a fixed
  // string so CodeQL dataflow does NOT trace process.env to the outer
  // catch's console.error sink. Validation errors above already pass
  // through unchanged because they have no env dependency.
  let key: string;
  try {
    key = buildLicenseKey(payload);
  } catch {
    throw new Error(
      'Licence signing failed. Verify SWAO_LICENSE_SECRET is set and decodes ' +
      'to a 32-byte Ed25519 seed (see swao-premium/secrets/README.md).',
    );
  }
  return { key, payload };
}
