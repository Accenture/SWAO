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

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { runInvPass } from '../passes/index.js';
import { runStatePass } from '../passes/index.js';
import { runDataPass } from '../passes/index.js';
import { runCtxPass } from '../passes/index.js';
import { runSbomPass } from '../passes/index.js';
import { runTfPass } from '../passes/index.js';
import { runEgrPass } from '../passes/index.js';
import { runCryptoPass } from '../passes/index.js';
import { runSynthPass } from '../passes/index.js';
import { FixedLlmProvider } from '@swao/module-llm-providers';
import type { LlmProvider } from '@swao/module-llm-providers';
import { PassFileSchema } from '../schema/index.js';

// Inline LLM stub for synth-pass rejection tests (#0249): lets a test
// supply an arbitrary JSON string in place of the canonical fixture so
// validation paths in runSynthPass can be exercised directly.
class InlineLlmStub implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'inline-rejection-test';
  constructor(private readonly response: string) {}
  async complete(): Promise<string> { return this.response; }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(__dirname, '../passes/fixtures/source');
const FIXTURES_WORKSPACE = join(__dirname, '../passes/fixtures/workspace');
const FIXTURES_LLM_STUBS = join(__dirname, '../passes/fixtures/llm-stubs');

// #0320 (sprint-039) -- the `fixtures/source/` directory has never existed
// in this repo. Tests that exercise signal-detection logic over real
// source files (package.json, Prisma schema, docker-compose.yml, etc.)
// are auto-skipped when the directory is absent. Schema-validity tests
// pass with empty fixtures (the pass engines return well-shaped output
// even with nothing to analyse). When sprint-040+ #0366 restores the
// minimal fixture trees, every skipped test auto-enables -- no second
// edit required. The 26 AC-J1-NN assertions catalogue exactly what each
// fixture must contain.
const SOURCE_FIXTURES_EXIST = existsSync(FIXTURES_SOURCE);

const NOW = '2026-04-28';
const ITER = 1;

function sourceCtx(appId: string) {
  return {
    appId,
    sourcePath: join(FIXTURES_SOURCE, appId),
    workspacePath: join(FIXTURES_WORKSPACE, appId),
    iter: ITER,
    assessedAt: NOW,
  };
}

function withStub(appId: string, passName: string) {
  const fixturePath = join(FIXTURES_LLM_STUBS, appId, `${passName}.json`);
  const content = existsSync(fixturePath) ? readFileSync(fixturePath, 'utf-8') : '{"signals":[],"assessment":{}}';
  return { llm: new FixedLlmProvider(content) };
}

// ---- helpers ----
function assertSchemaValid(result: unknown, label: string): void {
  const r = PassFileSchema.safeParse(result);
  if (!r.success) {
    console.error(`Schema validation failed for ${label}:`, JSON.stringify(r.error.issues, null, 2));
  }
  expect(r.success, `${label} must validate against PassFileSchema`).toBe(true);
}

function findSignal(result: { signals: Array<{ id: string }> }, prefix: string) {
  return result.signals.filter((s) => s.id.startsWith(prefix));
}

// =====================================================================
// Pass 1 -- Inventory
// =====================================================================

describe('Pass 1 -- INV (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio INV');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-08: emits INV-01 with typescript language and NestJS framework', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    const inv01 = result.signals.find((s) => s.id === 'INV-01');
    expect(inv01, 'INV-01 must be emitted').toBeDefined();
    expect(result.assessment.language).toBe('typescript');
    const frameworks = result.assessment.framework as string[];
    expect(frameworks.some((f) => f.toLowerCase().includes('nestjs'))).toBe(true);
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-09: emits INV-05 with container runtime from docker-compose', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    const inv05 = result.signals.find((s) => s.id === 'INV-05');
    expect(inv05).toBeDefined();
    expect(result.assessment.docker_compose).toBe(true);
    expect(result.assessment.runtime_type).toBe('container');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-10: emits INV-04 with app_version from package.json', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    const inv04 = result.signals.find((s) => s.id === 'INV-04');
    expect(inv04).toBeDefined();
    expect(result.assessment.app_version).toBe('3.0.1');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('emits at least 3 INV signals', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    expect(findSignal(result, 'INV').length).toBeGreaterThanOrEqual(3);
  });

  it('all signal IDs match INV-NN pattern', async () => {
    const result = await runInvPass(sourceCtx('ghostfolio'));
    for (const s of result.signals) {
      expect(s.id).toMatch(/^INV-\d{2}$/);
    }
  });
});

describe('Pass 1 -- INV (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runInvPass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum INV');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('detects typescript and express', async () => {
    const result = await runInvPass(sourceCtx('medplum'));
    expect(result.assessment.language).toBe('typescript');
    const frameworks = result.assessment.framework as string[];
    expect(frameworks.some((f) => f.toLowerCase().includes('express'))).toBe(true);
  });
});

describe('Pass 1 -- INV (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runInvPass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health INV');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('detects typescript language', async () => {
    const result = await runInvPass(sourceCtx('sovereign-health'));
    expect(result.assessment.language).toBe('typescript');
  });
});

// =====================================================================
// Pass 2 -- State
// =====================================================================

describe('Pass 2 -- STATE (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runStatePass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio STATE');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-11: emits STATE-01 with postgresql from Prisma schema', async () => {
    const result = await runStatePass(sourceCtx('ghostfolio'));
    const state01 = result.signals.find((s) => s.id === 'STATE-01');
    expect(state01).toBeDefined();
    expect(result.assessment.primary_db).toBe('postgresql');
    expect(result.assessment.orm).toBe('prisma');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-12: emits STATE-02 with redis cache and bull queue', async () => {
    const result = await runStatePass(sourceCtx('ghostfolio'));
    const state02 = result.signals.find((s) => s.id === 'STATE-02');
    expect(state02).toBeDefined();
    expect(result.assessment.cache_engine).toBe('redis');
    expect(result.assessment.queue_engine).toBe('bull');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-13: emits STATE-04 with spof_risk when no K8s manifests', async () => {
    const result = await runStatePass(sourceCtx('ghostfolio'));
    const state04 = result.signals.find((s) => s.id === 'STATE-04');
    expect(state04).toBeDefined();
    expect(result.assessment.spof_risk).toBe(true);
    expect(result.assessment.deployment_type).toBe('single_node_compose');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('emits at least 3 STATE signals', async () => {
    const result = await runStatePass(sourceCtx('ghostfolio'));
    expect(findSignal(result, 'STATE').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Pass 2 -- STATE (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runStatePass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum STATE');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('detects postgresql from Prisma schema', async () => {
    const result = await runStatePass(sourceCtx('medplum'));
    expect(result.assessment.primary_db).toBe('postgresql');
  });
});

describe('Pass 2 -- STATE (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runStatePass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health STATE');
  });
});

// =====================================================================
// Pass 3 -- Data (stub LLM)
// =====================================================================

describe('Pass 3 -- DATA (ghostfolio stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    assertSchemaValid(result, 'ghostfolio DATA');
  });

  it('AC-J1-14: assessment.data_classes contains financial_transaction', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    const classes = result.assessment.data_classes as string[];
    expect(classes).toContain('financial_transaction');
  });

  it('AC-J1-15: assessment.gdpr_art17_implemented is true', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    expect(result.assessment.gdpr_art17_implemented).toBe(true);
  });

  it('AC-J1-16: assessment.secrets_in_env is true', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    expect(result.assessment.secrets_in_env).toBe(true);
  });

  it('emits at least 3 DATA signals', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    expect(findSignal(result, 'DATA').length).toBeGreaterThanOrEqual(3);
  });

  it('all signal IDs match DATA-NN pattern', async () => {
    const result = await runDataPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'data') });
    for (const s of result.signals) {
      expect(s.id).toMatch(/^DATA-\d{2}$/);
    }
  });
});

describe('Pass 3 -- DATA (medplum stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runDataPass({ ...sourceCtx('medplum'), ...withStub('medplum', 'data') });
    assertSchemaValid(result, 'medplum DATA');
  });
});

describe('Pass 3 -- DATA (sovereign-health stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runDataPass({
      ...sourceCtx('sovereign-health'),
      ...withStub('sovereign-health', 'data'),
    });
    assertSchemaValid(result, 'sovereign-health DATA');
  });
});

// =====================================================================
// Pass 4 -- Context (stub LLM)
// =====================================================================

describe('Pass 4 -- CTX (ghostfolio stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    assertSchemaValid(result, 'ghostfolio CTX');
  });

  it('AC-J1-17: assessment.context_overrides present (MongoDB contradiction detected)', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    const overrides = result.assessment.context_overrides as unknown[] | undefined;
    expect(overrides).toBeDefined();
    expect(Array.isArray(overrides)).toBe(true);
    expect((overrides as unknown[]).length).toBeGreaterThan(0);
  });

  it('AC-J1-18: assessment.confirmed_landing_zone and residency_requirement present', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    expect(result.assessment.confirmed_landing_zone).toBeTruthy();
    expect(result.assessment.residency_requirement).toBe('DE_only');
  });

  it('AC-J1-19: assessment.context_inputs_found reflects actual imports scanned', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    expect(typeof result.assessment.context_inputs_found).toBe('number');
    expect(result.assessment.context_inputs_found as number).toBeGreaterThan(0);
  });

  it('emits at least 3 CTX signals', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    expect(findSignal(result, 'CTX').length).toBeGreaterThanOrEqual(3);
  });

  it('all signal IDs match CTX-NN pattern', async () => {
    const result = await runCtxPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'ctx') });
    for (const s of result.signals) {
      expect(s.id).toMatch(/^CTX-\d{2}$/);
    }
  });
});

describe('Pass 4 -- CTX (medplum stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCtxPass({ ...sourceCtx('medplum'), ...withStub('medplum', 'ctx') });
    assertSchemaValid(result, 'medplum CTX');
  });
});

describe('Pass 4 -- CTX (sovereign-health stub)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCtxPass({
      ...sourceCtx('sovereign-health'),
      ...withStub('sovereign-health', 'ctx'),
    });
    assertSchemaValid(result, 'sovereign-health CTX');
  });
});

// =====================================================================
// Pass 5 -- SBOM / CVE (OSV spot check degrades gracefully; network not required)
// =====================================================================

describe('Pass 5 -- SBOM (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runSbomPass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio SBOM');
  }, 20000);

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-20: detects alphavantage as an unmaintained package (SBOM stale signal)', async () => {
    const result = await runSbomPass(sourceCtx('ghostfolio'));
    const staleSignal = result.signals.find(
      (s) => s.derivation.includes('alphavantage') && s.severity === 'medium',
    );
    expect(staleSignal, 'Stale alphavantage signal must be emitted').toBeDefined();
  }, 20000);

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-21: Node EOL status is active_lts for node>=22', async () => {
    const result = await runSbomPass(sourceCtx('ghostfolio'));
    expect(result.assessment.node_eol_status).toBe('active_lts');
    expect(result.assessment.node_constraint).toContain('22');
  }, 20000);

  it('all signal IDs match SBOM-NN pattern', async () => {
    const result = await runSbomPass(sourceCtx('ghostfolio'));
    for (const s of result.signals) {
      expect(s.id).toMatch(/^SBOM-\d{2}$/);
    }
  }, 20000);
});

describe('Pass 5 -- SBOM (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runSbomPass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum SBOM');
  }, 20000);

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-22: Node EOL status is maintenance_lts for node>=20', async () => {
    const result = await runSbomPass(sourceCtx('medplum'));
    expect(result.assessment.node_eol_status).toBe('maintenance_lts');
  }, 20000);
});

describe('Pass 5 -- SBOM (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runSbomPass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health SBOM');
  }, 20000);
});

// =====================================================================
// Pass 6 -- Twelve-Factor
// =====================================================================

describe('Pass 6 -- TF (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runTfPass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio TF');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-23: Factor III satisfied -- .env.example present -> TF-01 positive', async () => {
    const result = await runTfPass(sourceCtx('ghostfolio'));
    const tf01 = result.signals.find((s) => s.id === 'TF-01');
    expect(tf01, 'TF-01 must be emitted').toBeDefined();
    expect(tf01?.severity).toBe('positive');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-24: Factor VIII gap -- docker-compose but no K8s -> TF-03 high', async () => {
    const result = await runTfPass(sourceCtx('ghostfolio'));
    const tf03 = result.signals.find((s) => s.id === 'TF-03');
    expect(tf03, 'TF-03 must be emitted').toBeDefined();
    expect(tf03?.severity).toBe('high');
  });

  it('AC-J1-25: Factor XI partial -- no structured logging -> TF-04 medium', async () => {
    const result = await runTfPass(sourceCtx('ghostfolio'));
    const tf04 = result.signals.find((s) => s.id === 'TF-04');
    expect(tf04, 'TF-04 must be emitted').toBeDefined();
    expect(tf04?.severity).toBe('medium');
  });

  it('all signal IDs match TF-NN pattern', async () => {
    const result = await runTfPass(sourceCtx('ghostfolio'));
    for (const s of result.signals) {
      expect(s.id).toMatch(/^TF-\d{2}$/);
    }
  });
});

describe('Pass 6 -- TF (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runTfPass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum TF');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('Factor III satisfied for medplum (.env.example present)', async () => {
    const result = await runTfPass(sourceCtx('medplum'));
    const tf01 = result.signals.find((s) => s.id === 'TF-01');
    expect(tf01?.severity).toBe('positive');
  });
});

describe('Pass 6 -- TF (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runTfPass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health TF');
  });
});

// =====================================================================
// Pass 7 -- Egress / Data Residency
// =====================================================================

describe('Pass 7 -- EGR (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runEgrPass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio EGR');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-26: migration_blockers > 0 reflecting DE_only blocked domains', async () => {
    const result = await runEgrPass(sourceCtx('ghostfolio'));
    expect(result.assessment.migration_blockers as number).toBeGreaterThan(0);
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-27: alphavantage package dep triggers critical EGR signal via package detection', async () => {
    const result = await runEgrPass(sourceCtx('ghostfolio'));
    const egrSignal = result.signals.find(
      (s) => s.evidence.some((e) => e.includes('alphavantage')) && s.severity === 'critical',
    );
    expect(egrSignal, 'Critical EGR signal for alphavantage must be emitted').toBeDefined();
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-28: source scan detects api.alphavantage.co domain in source files (evidence enriched)', async () => {
    const result = await runEgrPass(sourceCtx('ghostfolio'));
    const egrSignal = result.signals.find((s) => s.id === 'EGR-01');
    expect(egrSignal, 'EGR-01 must be emitted').toBeDefined();
    const evidenceStr = egrSignal?.evidence.join(' ') ?? '';
    expect(evidenceStr).toMatch(/alphavantage|alpha-vantage|api\.alphavantage\.co/);
  });

  it('all signal IDs match EGR-NN pattern', async () => {
    const result = await runEgrPass(sourceCtx('ghostfolio'));
    for (const s of result.signals) {
      expect(s.id).toMatch(/^EGR-\d{2}$/);
    }
  });
});

describe('Pass 7 -- EGR (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runEgrPass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum EGR');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('comprehendmedical.amazonaws.com detected via package dep', async () => {
    const result = await runEgrPass(sourceCtx('medplum'));
    const comprehendSignal = result.signals.find((s) =>
      s.evidence.some((e) => e.includes('comprehend') || e.includes('aws')),
    );
    expect(comprehendSignal).toBeDefined();
  });
});

describe('Pass 7 -- EGR (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runEgrPass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health EGR');
  });
});

// =====================================================================
// Pass 8 -- Crypto Posture
// =====================================================================

describe('Pass 8 -- CRYPTO (ghostfolio fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    assertSchemaValid(result, 'ghostfolio CRYPTO');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-29: pbkdf2 detected in source -> CRYPTO-01 positive severity', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    const crypto01 = result.signals.find((s) => s.id === 'CRYPTO-01');
    expect(crypto01, 'CRYPTO-01 must be emitted').toBeDefined();
    expect(crypto01?.severity).toBe('positive');
    expect(crypto01?.derivation.toLowerCase()).toContain('pbkdf2');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-30: JWT symmetric signing detected -> medium severity signal', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    const jwtSignal = result.signals.find(
      (s) => s.derivation.toLowerCase().includes('jwt') && s.severity === 'medium',
    );
    expect(jwtSignal, 'JWT medium signal must be emitted for symmetric signing').toBeDefined();
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('AC-J1-31: assessment.nist_compliant true and blocks_migration false for ghostfolio', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    expect(result.assessment.nist_compliant).toBe(true);
    expect(result.assessment.blocks_migration).toBe(false);
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('HMAC-SHA512 detected -> positive signal (CRYPTO-02)', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    const hmacSignal = result.signals.find(
      (s) => s.derivation.toLowerCase().includes('hmac') && s.severity === 'positive',
    );
    expect(hmacSignal, 'HMAC positive signal must be emitted').toBeDefined();
  });

  it('all signal IDs match CRYPTO-NN pattern', async () => {
    const result = await runCryptoPass(sourceCtx('ghostfolio'));
    for (const s of result.signals) {
      expect(s.id).toMatch(/^CRYPTO-\d{2}$/);
    }
  });
});

describe('Pass 8 -- CRYPTO (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCryptoPass(sourceCtx('medplum'));
    assertSchemaValid(result, 'medplum CRYPTO');
  });

  it('at-rest encryption gap signal emitted (medium)', async () => {
    const result = await runCryptoPass(sourceCtx('medplum'));
    const atRestSignal = result.signals.find(
      (s) => s.category === 'infrastructure_platform' && s.severity === 'medium',
    );
    expect(atRestSignal, 'At-rest encryption gap signal must be emitted').toBeDefined();
  });
});

describe('Pass 8 -- CRYPTO (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runCryptoPass(sourceCtx('sovereign-health'));
    assertSchemaValid(result, 'sovereign-health CRYPTO');
  });

  it.skipIf(!SOURCE_FIXTURES_EXIST)('JWT symmetric detected for sovereign-health (jsonwebtoken + JWT_SECRET)', async () => {
    const result = await runCryptoPass(sourceCtx('sovereign-health'));
    const jwtSignal = result.signals.find(
      (s) => s.derivation.toLowerCase().includes('jwt') && s.severity === 'medium',
    );
    expect(jwtSignal, 'JWT medium signal must be emitted for sovereign-health').toBeDefined();
  });
});

// =====================================================================
// Pass 9 -- SYNTH (synthesis / 7R label)
// =====================================================================

describe('Pass 9 -- SYNTH (ghostfolio fixture)', () => {
  it('AC-J1-32: produces schema-valid output with seven_r_label', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    assertSchemaValid(result, 'ghostfolio SYNTH');
    const sevenR = result.assessment['seven_r_label'];
    expect(typeof sevenR).toBe('string');
    expect(['Retire', 'Retain', 'Rehost', 'Replatform', 'Repurchase', 'Refactor', 'Re-architect']).toContain(sevenR);
  });

  it('AC-J1-33: coverage_score is present and >= 0', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    const score = result.assessment['coverage_score'];
    expect(typeof score).toBe('number');
    expect(score as number).toBeGreaterThanOrEqual(0);
    expect(score as number).toBeLessThanOrEqual(1);
  });

  it('AC-J1-34: migration_blockers is present and is a non-negative integer', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    const blockers = result.assessment['migration_blockers'];
    expect(typeof blockers).toBe('number');
    expect(blockers as number).toBeGreaterThanOrEqual(0);
  });

  it('emits SYNTH-01 with synthesis: true', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    const synth01 = result.signals.find(s => s.id === 'SYNTH-01');
    expect(synth01, 'SYNTH-01 must be emitted').toBeDefined();
    expect(synth01?.synthesis).toBe(true);
  });

  it('all signal IDs match SYNTH-NN pattern', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    for (const s of result.signals) {
      expect(s.id).toMatch(/^SYNTH-\d{2}$/);
    }
  });

  it('assessment includes landing_zone', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    expect(typeof result.assessment['landing_zone']).toBe('string');
  });

  // #0249: modernization_position + portability_score must populate so
  // dim_app / fact_app_summary do not ship empty dashboard-gauge columns.
  it('#0249: modernization_position is a non-empty string', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    const pos = result.assessment['modernization_position'];
    expect(typeof pos).toBe('string');
    expect((pos as string).length).toBeGreaterThan(0);
  });

  it('#0249: portability_score is a number in [0, 1]', async () => {
    const result = await runSynthPass({ ...sourceCtx('ghostfolio'), ...withStub('ghostfolio', 'synth') });
    const score = result.assessment['portability_score'];
    expect(typeof score).toBe('number');
    expect(score as number).toBeGreaterThanOrEqual(0);
    expect(score as number).toBeLessThanOrEqual(1);
  });
});

describe('Pass 9 -- SYNTH (#0249 validation rejection)', () => {
  function buildSynthCtx(appId: string, response: string) {
    return { ...sourceCtx(appId), llm: new InlineLlmStub(response) };
  }

  function baseResponseWithout(omit: 'modernization_position' | 'portability_score'): string {
    const assessment: Record<string, unknown> = {
      seven_r_label: 'Replatform',
      migration_rationale: 'test',
      modernization_position: 'invest_modernize_now',
      portability_score: 0.5,
      landing_zone: 'test',
      recommended_next_steps: [],
      migration_blockers: 0,
      migration_enablers: [],
    };
    delete assessment[omit];
    return JSON.stringify({ signals: [], assessment });
  }

  it('throws when modernization_position is missing', async () => {
    const ctx = buildSynthCtx('ghostfolio', baseResponseWithout('modernization_position'));
    await expect(runSynthPass(ctx)).rejects.toThrow(/modernization_position/);
  });

  it('throws when portability_score is missing', async () => {
    const ctx = buildSynthCtx('ghostfolio', baseResponseWithout('portability_score'));
    await expect(runSynthPass(ctx)).rejects.toThrow(/portability_score/);
  });

  it('throws when portability_score is out of [0, 1] range', async () => {
    const response = JSON.stringify({
      signals: [],
      assessment: {
        seven_r_label: 'Replatform',
        migration_rationale: 'test',
        modernization_position: 'invest_modernize_now',
        portability_score: 1.5,
        landing_zone: 'test',
        recommended_next_steps: [],
        migration_blockers: 0,
        migration_enablers: [],
      },
    });
    const ctx = buildSynthCtx('ghostfolio', response);
    await expect(runSynthPass(ctx)).rejects.toThrow(/portability_score/);
  });
});

describe('Pass 9 -- SYNTH (medplum fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runSynthPass({ ...sourceCtx('medplum'), ...withStub('medplum', 'synth') });
    assertSchemaValid(result, 'medplum SYNTH');
  });

  it('seven_r_label is a valid 7R value', async () => {
    const result = await runSynthPass({ ...sourceCtx('medplum'), ...withStub('medplum', 'synth') });
    expect(['Retire', 'Retain', 'Rehost', 'Replatform', 'Repurchase', 'Refactor', 'Re-architect']).toContain(
      result.assessment['seven_r_label'],
    );
  });
});

describe('Pass 9 -- SYNTH (sovereign-health fixture)', () => {
  it('produces schema-valid output', async () => {
    const result = await runSynthPass({ ...sourceCtx('sovereign-health'), ...withStub('sovereign-health', 'synth') });
    assertSchemaValid(result, 'sovereign-health SYNTH');
  });

  it('seven_r_label is a valid 7R value', async () => {
    const result = await runSynthPass({ ...sourceCtx('sovereign-health'), ...withStub('sovereign-health', 'synth') });
    expect(['Retire', 'Retain', 'Rehost', 'Replatform', 'Repurchase', 'Refactor', 'Re-architect']).toContain(
      result.assessment['seven_r_label'],
    );
  });
});
