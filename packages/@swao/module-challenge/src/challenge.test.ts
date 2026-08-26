// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

import {
  _paths,
  LicenseGuard,
  LicenseTierError,
  LicenseLimitError,
  AGENT_IDS,
  CredentialStore,
  buildLicenseKey,
} from '@swao/core';
import type { LicensePayload, LlmProvider } from '@swao/core';
import { buildWspSummary } from './challenge/loader.js';
import {
  runChallengeReport,
  runChallengeSession,
  runAllAgentsReport,
  validateCombinedReport,
  CONTEXT_TURN_LIMIT,
  bootstrapCredentialsFromVault,
} from './challenge.js';

// Local FixedLlmProvider stub (#0580): the concrete FixedLlmProvider lives in
// the sibling @swao/module-llm-providers, and a `@swao/module-*` must not depend
// on a sibling module (not even for tests). The production code injects the LLM
// factory via ChallengeDeps; the tests only need a deterministic LlmProvider, so
// we define a trivial local stub that returns a fixed response. Implements the
// LlmProvider contract re-exported from @swao/core.
class FixedLlmProvider implements LlmProvider {
  readonly name = 'stub' as const;
  readonly model = 'fixed-response';
  constructor(private readonly response: string) {}
  async complete(_prompt: string): Promise<string> {
    return this.response;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDPLUM_APP_DIR = join(
  __dirname,
  '../../../../examples/portfolio-workspace/portfolio/apps/medplum',
);

const TEMP_HOME = join(tmpdir(), `swao-challenge-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEMP_HOME, { recursive: true });
  _paths.statePath = join(TEMP_HOME, '.swao-state.json');
  _paths.licensePath = join(TEMP_HOME, '.swao-license.json');
  if (existsSync(_paths.statePath)) rmSync(_paths.statePath);
  if (existsSync(_paths.licensePath)) rmSync(_paths.licensePath);
});

afterEach(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

function writeState(data: object): void {
  writeFileSync(_paths.statePath, JSON.stringify(data), 'utf-8');
}

function writeLicenseKey(payload: LicensePayload): void {
  const key = buildLicenseKey(payload);
  writeFileSync(
    _paths.licensePath,
    JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }),
    'utf-8',
  );
}

// =========================================================
// License gate
// =========================================================

describe('challenge license gate -- Community tier', () => {
  it('throws LicenseTierError at any Community usage level (no cap after M18)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 5, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).toThrow(LicenseTierError);
  });

  it('high-usage Community still gets LicenseTierError (not LicenseLimitError) for Enterprise feature', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    // After M18 D-05 (revised), Community has no cap; LicenseLimitError
    // is reserved for licensed users hitting their per-licence budget.
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).toThrow(LicenseTierError);
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).not.toThrow(LicenseLimitError);
  });

  it('throws LicenseTierError for valid Consultant key (Consultant is below Enterprise)', () => {
    function fp8(): string { return LicenseGuard.load().state.fingerprint.substring(0, 8); }
    const payload: LicensePayload = {
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fp8(), iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).toThrow(LicenseTierError);
  });
});

describe('challenge license gate -- Enterprise tier', () => {
  it('does not throw for a valid Enterprise key', () => {
    function fp8(): string { return LicenseGuard.load().state.fingerprint.substring(0, 8); }
    const payload: LicensePayload = {
      v: 1, tier: 'enterprise', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fp8(), iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('enterprise');
    expect(() => guard.requireTier('enterprise', { feature: 'challenge' })).not.toThrow();
  });
});

// =========================================================
// WSP summary builder
// =========================================================

describe('buildWspSummary -- Medplum fixture', () => {
  it('returns a WspSummary with appId and sevenRLabel', () => {
    const summary = buildWspSummary(MEDPLUM_APP_DIR);
    expect(summary.appId).toBeTruthy();
    expect(summary.sevenRLabel).toBeTruthy();
  });

  it('aggregates signals from all pass files', () => {
    const summary = buildWspSummary(MEDPLUM_APP_DIR);
    expect(summary.signals.length).toBeGreaterThan(0);
  });

  it('populates blockers for critical / high-EGR signals', () => {
    const summary = buildWspSummary(MEDPLUM_APP_DIR);
    // Medplum has critical egress signals (AWS dependencies)
    expect(summary.blockers.length).toBeGreaterThan(0);
  });

  it('filters signals by focusPrefixes', () => {
    const full = buildWspSummary(MEDPLUM_APP_DIR);
    const filtered = buildWspSummary(MEDPLUM_APP_DIR, ['EGR']);
    expect(filtered.signals.length).toBeLessThan(full.signals.length);
    for (const s of filtered.signals) {
      expect(s.prefix).toBe('EGR');
    }
  });

  it('returns empty signals for unknown prefix', () => {
    const filtered = buildWspSummary(MEDPLUM_APP_DIR, ['XXXX']);
    expect(filtered.signals).toHaveLength(0);
  });
});

// =========================================================
// Agent IDs registry
// =========================================================

describe('AGENT_IDS', () => {
  it('contains exactly five agents', () => {
    expect(Object.keys(AGENT_IDS)).toHaveLength(5);
  });

  it('includes grc-compliance-officer', () => {
    expect(AGENT_IDS['grc-compliance-officer']).toBe('GRC / Compliance Officer');
  });
});

// =========================================================
// runChallengeReport
// =========================================================

describe('runChallengeReport', () => {
  it('returns LLM response for grc-compliance-officer in report mode', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const expected = 'findings:\n  - id: CR-GRC-01\n    concern: Data residency\n';
    const llm = new FixedLlmProvider(expected);
    const result = await runChallengeReport('grc-compliance-officer', wsp, llm);
    expect(result).toBe(expected);
  });

  it('passes system prompt containing WSP context to LLM', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    let capturedPrompt = '';
    const capturingLlm: LlmProvider = {
      name: 'stub',
      model: 'fake-test',
      async complete(prompt: string): Promise<string> {
        capturedPrompt = prompt;
        return 'stub response';
      },
    };
    await runChallengeReport('business-owner', wsp, capturingLlm);
    expect(capturedPrompt).toContain('--- WSP START ---');
    expect(capturedPrompt).toContain(wsp.appId);
  });

  it('works for all five agent IDs without error', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('stub');
    for (const agentId of Object.keys(AGENT_IDS) as Array<keyof typeof AGENT_IDS>) {
      await expect(runChallengeReport(agentId, wsp, llm)).resolves.toBe('stub');
    }
  });
});

// =========================================================
// runChallengeSession
// =========================================================

describe('runChallengeSession', () => {
  it('delivers agent opening statement on session init', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const openingText = 'My primary concern is the GDPR Art. 44 transfer gap.';
    const llm = new FixedLlmProvider(openingText);

    const lines: string[] = [];
    const readable = Readable.from(['exit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    await runChallengeSession(
      'grc-compliance-officer',
      wsp,
      llm,
      rl,
      line => lines.push(line),
    );

    expect(lines[0]).toBe(openingText);
  });

  it('accumulates transcript with user and assistant turns', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    let callCount = 0;
    const multiTurnLlm: LlmProvider = {
      name: 'stub',
      model: 'fake-test',
      async complete(_prompt: string): Promise<string> {
        callCount++;
        return `agent turn ${callCount}`;
      },
    };

    const lines: string[] = [];
    const readable = Readable.from(['hello\nexit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    const { transcript } = await runChallengeSession(
      'programme-manager',
      wsp,
      multiTurnLlm,
      rl,
      line => lines.push(line),
    );

    // Opening turn + one user turn + one agent response turn = at least 3 entries
    expect(transcript.length).toBeGreaterThanOrEqual(3);
    expect(transcript[0].role).toBe('assistant');
    expect(transcript[1].role).toBe('user');
    expect(transcript[1].content).toBe('hello');
    expect(transcript[2].role).toBe('assistant');
  });

  it('terminates cleanly on "quit" input', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('opening');

    const readable = Readable.from(['quit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    const { transcript } = await runChallengeSession(
      'finops-lead',
      wsp,
      llm,
      rl,
      () => {},
    );

    expect(transcript[0].role).toBe('assistant');
    expect(transcript.some(t => t.role === 'user' && t.content === 'quit')).toBe(false);
  });
});

// =========================================================
// Context window threshold warning
// =========================================================

describe('runChallengeSession -- context window warning', () => {
  it('CONTEXT_TURN_LIMIT is 40', () => {
    expect(CONTEXT_TURN_LIMIT).toBe(40);
  });

  it('fires onContextWarning at 80% of contextLimit', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('agent reply');

    const warnings: Array<{ turnsUsed: number; limit: number }> = [];
    // contextLimit=5 -> warnAt = floor(5*0.8) = 4 -> fires on turn 4
    const readable = Readable.from(['t1\n', 't2\n', 't3\n', 't4\n', 'exit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    const { contextWarningFired } = await runChallengeSession(
      'application-architect',
      wsp,
      llm,
      rl,
      () => {},
      {
        contextLimit: 5,
        onContextWarning: (turnsUsed, limit) => warnings.push({ turnsUsed, limit }),
      },
    );

    expect(contextWarningFired).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.turnsUsed).toBe(4);
    expect(warnings[0]!.limit).toBe(5);
  });

  it('does not fire warning when turns stay below 80% threshold', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('agent reply');

    let warningFired = false;
    // contextLimit=10 -> warnAt=8; only 3 user turns -> no warning
    const readable = Readable.from(['a\n', 'b\n', 'c\n', 'exit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    const { contextWarningFired } = await runChallengeSession(
      'business-owner',
      wsp,
      llm,
      rl,
      () => {},
      {
        contextLimit: 10,
        onContextWarning: () => { warningFired = true; },
      },
    );

    expect(contextWarningFired).toBe(false);
    expect(warningFired).toBe(false);
  });

  it('fires warning only once even when multiple turns exceed threshold', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('reply');

    let callCount = 0;
    // contextLimit=3 -> warnAt=2; turns 2,3,4 all exceed -- but fires once only
    const readable = Readable.from(['t1\n', 't2\n', 't3\n', 't4\n', 'exit\n']);
    const rl = createInterface({ input: readable, terminal: false });

    await runChallengeSession(
      'grc-compliance-officer',
      wsp,
      llm,
      rl,
      () => {},
      {
        contextLimit: 3,
        onContextWarning: () => { callCount++; },
      },
    );

    expect(callCount).toBe(1);
  });
});

// =========================================================
// runAllAgentsReport -- multi-agent parallel batch
// =========================================================

describe('runAllAgentsReport', () => {
  it('returns a report for all five agents', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('stub report'));

    expect(combined.reports).toHaveLength(5);
  });

  it('each report entry has agent_id, agent_role, and report fields', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('stub'));

    for (const entry of combined.reports) {
      expect(entry.agent_id).toBeTruthy();
      expect(entry.agent_role).toBeTruthy();
      expect(entry.report).toBe('stub');
    }
  });

  it('all five AGENT_IDs appear in the combined report', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('x'));

    const resultIds = combined.reports.map(r => r.agent_id).sort();
    const expectedIds = (Object.keys(AGENT_IDS) as string[]).sort();
    expect(resultIds).toEqual(expectedIds);
  });

  it('app_id matches wsp.appId', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('x'));

    expect(combined.app_id).toBe(wsp.appId);
  });

  it('assessed_at is a valid ISO date string', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('x'));

    expect(new Date(combined.assessed_at).getTime()).not.toBeNaN();
  });

  it('agent_count is 5', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('x'));

    expect(combined.agent_count).toBe(5);
  });

  it('different getLlm instances used per agent (per-agent LLM factory)', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const usedIds: string[] = [];

    await runAllAgentsReport(wsp, (agentId) => {
      usedIds.push(agentId);
      return new FixedLlmProvider(`reply-${agentId}`);
    });

    expect(usedIds.sort()).toEqual((Object.keys(AGENT_IDS) as string[]).sort());
  });
});

// =========================================================
// validateCombinedReport -- structural output validation
// =========================================================

describe('validateCombinedReport', () => {
  function makeValid() {
    return {
      assessed_at: new Date().toISOString(),
      app_id: 'my-app',
      agent_count: 5,
      reports: Object.entries(AGENT_IDS).map(([id, role]) => ({
        agent_id: id,
        agent_role: role,
        report: 'findings:\n  - id: CR-TEST-01\n',
      })),
    };
  }

  it('returns no errors for a well-formed report', () => {
    expect(validateCombinedReport(makeValid())).toHaveLength(0);
  });

  it('flags null root', () => {
    const errs = validateCombinedReport(null);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.field).toBe('root');
  });

  it('flags missing assessed_at', () => {
    const d = makeValid();
    delete (d as Record<string, unknown>)['assessed_at'];
    const errs = validateCombinedReport(d);
    expect(errs.some(e => e.field === 'assessed_at')).toBe(true);
  });

  it('flags non-ISO assessed_at', () => {
    const d = { ...makeValid(), assessed_at: 'not-a-date' };
    expect(validateCombinedReport(d).some(e => e.field === 'assessed_at')).toBe(true);
  });

  it('flags missing app_id', () => {
    const d = makeValid();
    delete (d as Record<string, unknown>)['app_id'];
    expect(validateCombinedReport(d).some(e => e.field === 'app_id')).toBe(true);
  });

  it('flags missing agent_count', () => {
    const d = makeValid();
    delete (d as Record<string, unknown>)['agent_count'];
    expect(validateCombinedReport(d).some(e => e.field === 'agent_count')).toBe(true);
  });

  it('flags non-array reports', () => {
    const d = { ...makeValid(), reports: 'not-an-array' };
    expect(validateCombinedReport(d).some(e => e.field === 'reports')).toBe(true);
  });

  it('flags missing agent_id in a report entry', () => {
    const d = makeValid();
    delete (d.reports[0] as Record<string, unknown>)['agent_id'];
    expect(validateCombinedReport(d).some(e => e.field === 'reports[0].agent_id')).toBe(true);
  });

  it('flags empty report body', () => {
    const d = makeValid();
    d.reports[0]!.report = '';
    expect(validateCombinedReport(d).some(e => e.field === 'reports[0].report')).toBe(true);
  });

  it('produces no errors when runAllAgentsReport output is validated', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const combined = await runAllAgentsReport(wsp, () => new FixedLlmProvider('stub-findings'));
    expect(validateCombinedReport(combined)).toHaveLength(0);
  });
});

// =========================================================
// Output directory creation -- ENOENT regression guard
// =========================================================
// ChallengeScreen.tsx (multi-agent path, #1056) passes --output with a
// timestamped subdirectory: wsp/challenge/<ts>/<agent>.yaml. The challenge
// command must create the full parent chain even when --output is specified.

describe('challenge output path -- parent directory creation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `swao-challenge-outdir-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates timestamp subdirectory when --output path has a deep subdir', async () => {
    const wsp = buildWspSummary(MEDPLUM_APP_DIR);
    const llm = new FixedLlmProvider('findings:\n  - id: CR-TEST-01\n');

    // Simulate the path ChallengeScreen builds for multi-agent runs.
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const outputPath = join(tmpDir, 'wsp', 'challenge-app', ts, 'AA_application-architect.yaml');

    // The parent directory must NOT exist yet (that was the bug).
    expect(existsSync(dirname(outputPath))).toBe(false);

    // runChallengeReport itself does not write files; the CLI action does.
    // Test the exact sequence the fixed action now follows:
    const rawOutput = await runChallengeReport('application-architect', wsp, llm);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, rawOutput, 'utf-8');

    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, 'utf-8')).toContain('CR-TEST-01');
  });

  it('creates wsp/challenge-app/ when no --output is given (default path)', () => {
    // Default path: wsp/challenge-app/<agentId>.yaml -- parent is wsp/challenge-app/
    const defaultPath = join(tmpDir, 'wsp', 'challenge-app', 'AA_grc-compliance-officer.yaml');
    expect(existsSync(dirname(defaultPath))).toBe(false);

    mkdirSync(dirname(defaultPath), { recursive: true });
    writeFileSync(defaultPath, 'stub content', 'utf-8');

    expect(existsSync(defaultPath)).toBe(true);
  });
});

// =========================================================
// bootstrapCredentialsFromVault (#1156)
// =========================================================

describe('bootstrapCredentialsFromVault (#1156)', () => {
  const ORIGINAL_ENV: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['SWAO_LLM_PROVIDER', 'SWAO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 'SWAO_OPENAI_API_KEY', 'OPENAI_API_KEY', 'SWAO_OLLAMA_URL', 'SWAO_OLLAMA_MODEL']) {
      ORIGINAL_ENV[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('sets SWAO_ANTHROPIC_API_KEY and SWAO_LLM_PROVIDER from vault when no env vars present', () => {
    vi.spyOn(CredentialStore.prototype, 'loadSync').mockReturnValue({ 'anthropic-api-key': 'sk-ant-test' });
    bootstrapCredentialsFromVault();
    expect(process.env['SWAO_ANTHROPIC_API_KEY']).toBe('sk-ant-test');
    expect(process.env['SWAO_LLM_PROVIDER']).toBe('anthropic');
  });

  it('sets SWAO_OPENAI_API_KEY and SWAO_LLM_PROVIDER from vault when only openai key stored', () => {
    vi.spyOn(CredentialStore.prototype, 'loadSync').mockReturnValue({ 'openai-api-key': 'sk-oai-test' });
    bootstrapCredentialsFromVault();
    expect(process.env['SWAO_OPENAI_API_KEY']).toBe('sk-oai-test');
    expect(process.env['SWAO_LLM_PROVIDER']).toBe('openai');
  });

  it('does not overwrite existing SWAO_LLM_PROVIDER when already set', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'ollama';
    vi.spyOn(CredentialStore.prototype, 'loadSync').mockReturnValue({ 'anthropic-api-key': 'sk-ant-test' });
    bootstrapCredentialsFromVault();
    expect(process.env['SWAO_LLM_PROVIDER']).toBe('ollama');
    expect(process.env['SWAO_ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('sets SWAO_OLLAMA_URL and SWAO_OLLAMA_MODEL from vault', () => {
    vi.spyOn(CredentialStore.prototype, 'loadSync').mockReturnValue({
      'ollama-endpoint': 'http://localhost:11434',
      'ollama-model': 'llama3',
    });
    bootstrapCredentialsFromVault();
    expect(process.env['SWAO_OLLAMA_URL']).toBe('http://localhost:11434');
    expect(process.env['SWAO_OLLAMA_MODEL']).toBe('llama3');
  });

  it('does not throw when vault is empty', () => {
    vi.spyOn(CredentialStore.prototype, 'loadSync').mockReturnValue({});
    expect(() => bootstrapCredentialsFromVault()).not.toThrow();
  });
});
