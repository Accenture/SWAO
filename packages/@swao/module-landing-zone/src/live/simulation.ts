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

// #3596: simulated-run provenance (Design 121 section 10). Provenance is
// derived from evidence, never from a user-set flag (Design 115 section 2).
// The driver HTTP layer observes every response of a scope run; any of three
// marks makes the run simulated:
//   1. the `X-SWAO-Mock-CSP: <provider>/<scenario>/<fidelity>` response header
//      (ops/mock-csp/core/server.ts MOCK_HEADER),
//   2. the `swao_mock` claim in a token response (the OTC mock sets
//      `token.swao_mock = true`, ops/mock-csp/providers/otc/auth.ts),
//   3. an endpoint override to a loopback host (endpoints.ts).
// The result is `LzLiveScan.meta.simulated`. The evidence is recorded at run
// time because response headers and token bodies are never written to the
// WSP; the run folder is the only place it can be derived from later.
//
// Consumers: the publication banner (publication-render), the refusal of
// simulated runs as a catalogue source (assertLzLiveRunNotSimulated, used by
// `swao lz catalogue update --source live`, #3582) and the portfolio merge
// (splitSimulatedScopes, `--include-simulated`, #3584).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LZ_LIVE_SIMULATION_FIDELITIES, LzLiveScanSchema, LzLiveSimulatedSchema } from '@swao/core';
import type { LzLiveSimulated, LzLiveSimulationEvidence } from '@swao/core';
import type { FetchLike } from './types.js';

/** A simulated run offered where only real evidence is allowed (exit code 1). */
export class SimulatedRunError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(`[lz live] ${message}`);
    this.name = 'SimulatedRunError';
  }
}

/** Response header every mock CSP response carries (Design 121 section 10, item 1). */
export const MOCK_CSP_RESPONSE_HEADER = 'X-SWAO-Mock-CSP';

const SCENARIO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const EVIDENCE_ORDER: readonly LzLiveSimulationEvidence[] = ['header', 'token_claim', 'endpoint_override'];

/** Parse `<provider>/<scenario>/<fidelity>`; unknown parts are dropped, the mark stays. */
export function parseMockCspHeader(value: string): { scenario?: string; fidelity?: LzLiveSimulated['fidelity'] } {
  const parts = value.trim().split('/');
  if (parts.length !== 3) return {};
  const [, scenario, fidelity] = parts;
  return {
    ...(scenario !== undefined && SCENARIO_RE.test(scenario) ? { scenario } : {}),
    ...(fidelity !== undefined && (LZ_LIVE_SIMULATION_FIDELITIES as readonly string[]).includes(fidelity)
      ? { fidelity: fidelity as NonNullable<LzLiveSimulated['fidelity']> }
      : {}),
  };
}

function jwtHasMockClaim(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[1] === undefined) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as unknown;
    return typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>)['swao_mock'] === true;
  } catch {
    return false;
  }
}

/**
 * True when a response body carries the `swao_mock` claim: at the root, in
 * the OTC-style `token` object, or in the payload of a JWT `access_token` /
 * `id_token` (OAuth token responses). Parsed as JSON; a substring is never
 * enough, so a resource named "swao_mock" does not mark a run.
 */
export function hasSwaoMockClaim(body: string): boolean {
  const t = body.trimStart();
  if (!t.startsWith('{')) return false;
  let doc: unknown;
  try {
    doc = JSON.parse(t);
  } catch {
    return false;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return false;
  const rec = doc as Record<string, unknown>;
  if (rec['swao_mock'] === true) return true;
  const token = rec['token'];
  if (typeof token === 'object' && token !== null && (token as Record<string, unknown>)['swao_mock'] === true) return true;
  return jwtHasMockClaim(rec['access_token']) || jwtHasMockClaim(rec['id_token']);
}

/** Collects the simulation evidence of one scope run. */
export class SimulationEvidence {
  private readonly kinds = new Set<LzLiveSimulationEvidence>();
  private scenario: string | undefined;
  private fidelity: LzLiveSimulated['fidelity'];

  observeHeader(value: string | null): void {
    if (value === null || value.trim() === '') return;
    this.kinds.add('header');
    const parsed = parseMockCspHeader(value);
    this.scenario ??= parsed.scenario;
    this.fidelity ??= parsed.fidelity;
  }

  observeBody(body: string): void {
    if (!this.kinds.has('token_claim') && hasSwaoMockClaim(body)) this.kinds.add('token_claim');
  }

  markEndpointOverride(): void {
    this.kinds.add('endpoint_override');
  }

  /** `meta.simulated`, or undefined for a run with no evidence. */
  result(): LzLiveSimulated | undefined {
    if (this.kinds.size === 0) return undefined;
    return LzLiveSimulatedSchema.parse({
      ...(this.scenario !== undefined ? { scenario: this.scenario } : {}),
      ...(this.fidelity !== undefined ? { fidelity: this.fidelity } : {}),
      evidence: EVIDENCE_ORDER.filter((k) => this.kinds.has(k)),
    });
  }
}

/**
 * Transport wrapper that feeds `evidence` from every response: the mock
 * header at once, the token claim when the driver reads the body. The body is
 * read once and cached, so the wrapper never consumes it twice.
 */
export function createSimulationEvidenceFetch(inner: FetchLike, evidence: SimulationEvidence): FetchLike {
  return async (url, init) => {
    const res = await inner(url, init);
    evidence.observeHeader(res.headers.get(MOCK_CSP_RESPONSE_HEADER));
    let cached: Promise<string> | undefined;
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      text: () => {
        cached ??= res.text().then((body) => {
          evidence.observeBody(body);
          return body;
        });
        return cached;
      },
    };
  };
}

/** One output line for CLI and TUI progress: `simulated environment (mock CSP ...)`. */
export function describeSimulation(sim: LzLiveSimulated): string {
  const parts = [
    ...(sim.scenario !== undefined ? [`scenario ${sim.scenario}`] : []),
    ...(sim.fidelity !== undefined ? [`fidelity ${sim.fidelity}`] : []),
    `evidence ${sim.evidence.join(', ').replace(/_/g, ' ')}`,
  ];
  return `simulated environment (mock CSP; ${parts.join('; ')})`;
}

// ---------------------------------------------------------------------------
// Consumers
// ---------------------------------------------------------------------------

export interface SimulatedScopeRef {
  scope_id: string;
  simulated: LzLiveSimulated;
}

/**
 * Simulated scopes of a live run folder: from every
 * `<lz-id>.<scope>.lz-live-scan.json` and from the `scopes[].simulated`
 * entries of `manifest.json`. Unreadable files are skipped here; the caller
 * validates the run for its own purpose.
 */
export function simulatedScopesOfRun(runDir: string): SimulatedScopeRef[] {
  const out = new Map<string, LzLiveSimulated>();
  const names = existsSync(runDir) ? readdirSync(runDir) : [];
  for (const name of names.sort()) {
    if (!name.endsWith('.lz-live-scan.json')) continue;
    try {
      const r = LzLiveScanSchema.safeParse(JSON.parse(readFileSync(join(runDir, name), 'utf-8')));
      if (r.success && r.data.meta.simulated) out.set(r.data.meta.scope_id, r.data.meta.simulated);
    } catch { /* unreadable scan: not evidence either way */ }
  }
  const manifest = join(runDir, 'manifest.json');
  if (existsSync(manifest)) {
    try {
      const doc = JSON.parse(readFileSync(manifest, 'utf-8')) as { scopes?: Array<Record<string, unknown>> };
      for (const s of Array.isArray(doc.scopes) ? doc.scopes : []) {
        const sim = LzLiveSimulatedSchema.safeParse(s['simulated']);
        if (sim.success && typeof s['scope_id'] === 'string' && !out.has(s['scope_id'])) out.set(s['scope_id'], sim.data);
      }
    } catch { /* unreadable manifest */ }
  }
  return [...out.entries()].map(([scope_id, simulated]) => ({ scope_id, simulated }));
}

function describeSimulated(s: SimulatedScopeRef): string {
  const what = [s.simulated.scenario, s.simulated.fidelity].filter((x) => x !== undefined).join(', ');
  return `${s.scope_id}${what ? ` (${what})` : ''}`;
}

/**
 * Design 121 section 10, item 4: simulated data never reaches a catalogue
 * file. Throws SimulatedRunError (exit 1) when any scope of the run was simulated;
 * call it before anything is written.
 */
export function assertLzLiveRunNotSimulated(runDir: string): void {
  const sim = simulatedScopesOfRun(runDir);
  if (sim.length === 0) return;
  throw new SimulatedRunError(
    `run ${runDir} was served by a mock CSP (simulated scope(s): ${sim.map(describeSimulated).join(', ')}); `
    + 'simulated data never updates an LZ catalogue. Run against the real landing zone, without SWAO_LZ_MOCK_ENDPOINTS.',
  );
}

/**
 * Design 121 section 10, item 5: the portfolio merge includes simulated
 * scopes only with `--include-simulated`. Returns the scopes to merge and the
 * simulated ones left out (to be listed, never dropped silently).
 */
export function splitSimulatedScopes<T extends { simulated?: LzLiveSimulated | undefined }>(
  scopes: readonly T[],
  includeSimulated: boolean,
): { included: T[]; excluded: T[] } {
  if (includeSimulated) return { included: [...scopes], excluded: [] };
  return {
    included: scopes.filter((s) => s.simulated === undefined),
    excluded: scopes.filter((s) => s.simulated !== undefined),
  };
}
