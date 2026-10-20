// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3160: Pass 07 reads sovereign-service-catalogue.yaml and emits one EGR
// signal per catalogue service whose client package or API host is found.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { SignalSchema } from '@swao/core';
import type { PassContext } from '@swao/core';
import { loadSovereignServiceCatalogue, type SovereignServiceEntry } from '../catalogue/reference-catalogues.js';
import {
  runEgrPass,
  SOVEREIGN_SERVICE_DETECTION,
  matchSovereignServices,
  sovereignServiceSeverity,
  sovereignServiceBlocks,
} from './pass-07-egr.js';

function writeFixture(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
}

const ctx = (sourcePath: string): PassContext => ({
  appId: 'fixture', sourcePath, workspacePath: sourcePath, iter: 1, assessedAt: '2026-10-17T00:00:00Z',
});

let root: string;
let plainRoot: string;
let mergeRoot: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-3160-egr-'));
  writeFixture(root, {
    'package.json': JSON.stringify({
      name: 'egr-fixture',
      dependencies: { firebase: '^10.0.0', stripe: '^14.0.0', '@sentry/node': '^7.0.0', 'yahoo-finance2': '^2.0.0' },
    }),
    'src/llm.ts': "export const ANTHROPIC = 'https://api.anthropic.com/v1/messages';\n",
    'worker/requirements.txt': 'slack-sdk==3.27.0\n',
  });
  plainRoot = mkdtempSync(join(tmpdir(), 'swao-3160-egr-plain-'));
  writeFixture(plainRoot, { 'package.json': JSON.stringify({ name: 'plain', dependencies: { express: '^4.19.0' } }) });
  // #3296: an egress-catalogue package and a sovereign catalogue service for the same service
  mergeRoot = mkdtempSync(join(tmpdir(), 'swao-3296-egr-merge-'));
  writeFixture(mergeRoot, {
    'package.json': JSON.stringify({ name: 'merge', dependencies: { '@aws-sdk/client-comprehendmedical': '3.540.0' } }),
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(plainRoot, { recursive: true, force: true });
  rmSync(mergeRoot, { recursive: true, force: true });
});

describe('SOVEREIGN_SERVICE_DETECTION', () => {
  it('names only services that exist in the catalogue', () => {
    const cat = loadSovereignServiceCatalogue();
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;
    const ids = new Set(cat.data.services.map((s) => s.id));
    for (const id of Object.keys(SOVEREIGN_SERVICE_DETECTION)) expect(ids.has(id), id).toBe(true);
  });

  it('every catalogue service has at least one detection key', () => {
    const cat = loadSovereignServiceCatalogue();
    if (!cat.ok) throw new Error(cat.reason);
    for (const s of cat.data.services) {
      const rule = SOVEREIGN_SERVICE_DETECTION[s.id];
      expect(rule, s.id).toBeDefined();
      expect((rule!.npm?.length ?? 0) + (rule!.pip?.length ?? 0) + (rule!.domains?.length ?? 0), s.id).toBeGreaterThan(0);
    }
  });
});

describe('sovereignServiceSeverity', () => {
  const base = {
    id: 'x', name: 'X', category: 'c', vendor: 'v', parent_jurisdiction: 'US', sovereign_evidence: 'not_assessed',
    sources: [], last_reviewed: '2026-10-17',
  } as const;
  const entry = (v: Partial<SovereignServiceEntry>): SovereignServiceEntry => ({ ...base, ...v }) as SovereignServiceEntry;
  it('maps verified verdicts to severities', () => {
    const verified = { verdict_confidence: 'verified' } as const;
    expect(sovereignServiceSeverity(entry({ ...verified, portability_verdict: 'unavailable', blocks_migration: true }))).toBe('critical');
    expect(sovereignServiceSeverity(entry({ ...verified, portability_verdict: 'unavailable', blocks_migration: false }))).toBe('high');
    expect(sovereignServiceSeverity(entry({ ...verified, portability_verdict: 'partial', blocks_migration: false }))).toBe('medium');
    expect(sovereignServiceSeverity(entry({ ...verified, portability_verdict: 'available', blocks_migration: false }))).toBe('low');
  });

  it('#3296: an unverified verdict is at most medium and never a blocker', () => {
    const e = entry({ verdict_confidence: 'unverified', portability_verdict: 'unavailable', blocks_migration: true });
    expect(sovereignServiceSeverity(e)).toBe('medium');
    expect(sovereignServiceBlocks(e)).toBe(false);
    expect(sovereignServiceSeverity(entry({ verdict_confidence: 'unverified', portability_verdict: 'available', blocks_migration: false }))).toBe('low');
  });
});

describe('#3296 catalogue quality', () => {
  it('every verified entry has a source; blocks_migration only on verified unavailable entries', () => {
    const cat = loadSovereignServiceCatalogue();
    if (!cat.ok) throw new Error(cat.reason);
    for (const s of cat.data.services) {
      if (s.verdict_confidence === 'verified') expect(s.sources.length, s.id).toBeGreaterThan(0);
      expect(s.blocks_migration, s.id).toBe(s.portability_verdict === 'unavailable' && s.verdict_confidence === 'verified');
    }
  });

  it('a US-parent vendor is never available (CLOUD Act rule in the catalogue header)', () => {
    const cat = loadSovereignServiceCatalogue();
    if (!cat.ok) throw new Error(cat.reason);
    for (const s of cat.data.services.filter((x) => x.parent_jurisdiction === 'US')) {
      expect(s.portability_verdict, s.id).not.toBe('available');
    }
  });
});

describe('matchSovereignServices', () => {
  it('matches npm and pip packages and domain hits; ignores unrelated packages', () => {
    const cat = loadSovereignServiceCatalogue();
    if (!cat.ok) throw new Error(cat.reason);
    const hits = matchSovereignServices(
      cat.data,
      [
        { ecosystem: 'npm', name: '@sentry/node', file: 'package.json' },
        { ecosystem: 'pip', name: 'slack_sdk', file: 'requirements.txt' },
        { ecosystem: 'npm', name: 'express', file: 'package.json' },
      ],
      new Map([['api.anthropic.com', 'src/llm.ts']]),
    );
    expect(hits.map((h) => `${h.service.id}:${h.detectedVia}`).sort()).toEqual([
      'anthropic-api:source_scan', 'sentry:package', 'slack:package',
    ]);
  });
});

describe('runEgrPass with the sovereign service catalogue', () => {
  it('keeps egress signals first and appends one signal per catalogue service', async () => {
    const result = await runEgrPass(ctx(root));
    for (const s of result.signals) expect(() => SignalSchema.parse(s), s.id).not.toThrow();
    // EGR-01 stays the egress-catalogue destination (Yahoo Finance package)
    expect(result.signals[0]!.id).toBe('EGR-01');
    expect(result.signals[0]!.derivation).toContain('Yahoo Finance');

    const services = result.assessment.sovereign_services as Array<Record<string, unknown>>;
    expect(services.map((s) => s.service_id)).toEqual(['anthropic-api', 'stripe', 'sentry', 'slack', 'firebase']);
    const ids = result.signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of services) expect(ids).toContain(s.signal_ref);
    const sig = (id: string) => result.signals.find((s) => s.id === services.find((x) => x.service_id === id)!.signal_ref)!;

    // #3296: Firebase Firestore/RTDB have EU locations (verified partial), not a blocker
    expect(sig('firebase').severity).toBe('medium');
    expect(sig('firebase').derivation).toContain('blocks_migration: false');
    expect(sig('firebase').confidence).toBe('high');
    // first-party Anthropic API: verified unavailable (no EU inference geography)
    const anthropic = sig('anthropic-api');
    expect(anthropic.severity).toBe('critical');
    expect(anthropic.derivation).toContain('blocks_migration: true');
    expect(anthropic.confidence).toBe('medium');
    expect(anthropic.evidence[0]).toContain('api.anthropic.com');
    // Stripe: unverified unavailable, capped at medium and not a blocker
    expect(sig('stripe').severity).toBe('medium');
    expect(sig('stripe').derivation).toContain('not verified');
    expect(services.find((x) => x.service_id === 'stripe')!.blocks_migration).toBe(false);
    for (const s of result.signals.filter((x) => services.some((y) => y.signal_ref === x.id))) {
      expect(s.implies?.[0]).toMatch(/^sovereign_service:/);
    }

    expect(result.assessment.sovereign_service_blockers).toBe(1);
    expect(result.assessment.sovereign_service_check).toBe('matched');
  });

  it('#3296: an egress destination and a catalogue service for the same service yield one signal', async () => {
    const result = await runEgrPass(ctx(mergeRoot));
    for (const s of result.signals) expect(() => SignalSchema.parse(s), s.id).not.toThrow();
    expect(result.signals.map((s) => s.id)).toEqual(['EGR-01']);
    const egr = result.signals[0]!;
    expect(egr.derivation).toContain('AWS Comprehend Medical');
    expect(egr.derivation).toContain('Sovereign service catalogue verdict');
    expect(egr.implies).toEqual(['sovereign_service:aws-comprehend-medical']);
    // the verified catalogue verdict (EU regions, US parent: partial) governs the severity
    expect(egr.severity).toBe('medium');
    const services = result.assessment.sovereign_services as Array<Record<string, unknown>>;
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      service_id: 'aws-comprehend-medical', signal_ref: 'EGR-01', merged_with_egress_destination: 'comprehendmedical.amazonaws.com',
    });
    expect(result.assessment.sovereign_services_merged_with_egress).toBe(1);
    expect(result.assessment.migration_blockers).toBe(0);
  });

  it('#3296: the misspelt package name client-comprehend-medical is not an egress package', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'swao-3296-egr-typo-'));
    try {
      writeFixture(root2, { 'package.json': JSON.stringify({ name: 't', dependencies: { '@aws-sdk/client-comprehend-medical': '3.0.0' } }) });
      const result = await runEgrPass(ctx(root2));
      expect(result.signals.map((s) => s.severity)).toEqual(['informational']);
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it('a plain app keeps the EGR-01 fallback and records no_match', async () => {
    const result = await runEgrPass(ctx(plainRoot));
    expect(result.signals.map((s) => s.id)).toEqual(['EGR-01']);
    expect(result.signals[0]!.severity).toBe('informational');
    expect(result.assessment.sovereign_services).toEqual([]);
    expect(result.assessment.sovereign_service_check).toBe('no_match');
  });
});
