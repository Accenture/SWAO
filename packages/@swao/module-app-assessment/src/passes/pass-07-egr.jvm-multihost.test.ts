// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass 07 egress: multi-host JDBC URLs (#3485)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3485: synthetic fixtures; hosts are invented, public-looking or private on
// purpose (documentation names are not reportable). Before #3485 only the
// first host of `jdbc:mysql://h1,h2/db` was reported, and the replication /
// loadbalance protocols were not read at all.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { endSourceScopeRun, type PassContext, type PassResult } from '@swao/core';
import { runEgrPass } from './pass-07-egr.js';

let tmp: string;
let src: string;

function put(rel: string, content: string): void {
  const p = join(src, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
}

function ctx(): PassContext {
  return { workspacePath: tmp, sourcePath: src, appId: 'jvm-app', iter: 1, assessedAt: '2026-10-25' } as PassContext;
}

type HostYaml = { host: string; channels: string[]; locations: Array<{ file: string; line: number; via?: string }> };

function hosts(r: PassResult): HostYaml[] {
  return (r.assessment['hardcoded_endpoints'] as { hosts: HostYaml[] } | undefined)?.hosts ?? [];
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-3485-egr-'));
  src = join(tmp, 'source');
  mkdirSync(src, { recursive: true });
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('#3485 Pass 07: multi-host JDBC URLs', () => {
  it('reports every host of a MySQL / PostgreSQL multi-host URL and of replication / loadbalance URLs', async () => {
    put('pom.xml', '<project><artifactId>orders</artifactId></project>\n');
    put('src/main/resources/application.properties', [
      'spring.datasource.url=jdbc:mysql://db-a.partner-cloud.de:3306,db-b.partner-cloud.de:3306/orders',
      'reporting.url=jdbc:mysql:replication://svc:pw,1@10.20.0.11:3306,10.20.0.12:3306/reports',
      'archive.url=jdbc:postgresql://pg1.partner-cloud.de,pg2.partner-cloud.de:5433/archive?targetServerType=primary',
      'local.url=jdbc:mysql:loadbalance://${DB_A},${DB_B}/x',
    ].join('\n'));
    const r = await runEgrPass(ctx());
    const byHost = new Map(hosts(r).map((h) => [h.host, h]));
    for (const h of ['db-a.partner-cloud.de', 'db-b.partner-cloud.de', 'pg1.partner-cloud.de', 'pg2.partner-cloud.de']) {
      expect(byHost.get(h), h).toBeDefined();
      expect(byHost.get(h)!.channels).toEqual(['database']);
    }
    // IPv4 hosts were already found by the shared scanner as bare literals (channel network).
    expect(byHost.get('10.20.0.11')).toBeDefined();
    expect(byHost.get('10.20.0.12')).toBeDefined();
    expect(byHost.get('db-b.partner-cloud.de')!.locations).toEqual([
      expect.objectContaining({ file: 'src/main/resources/application.properties', line: 1, via: 'spring.datasource.url' }),
    ]);
    // The first host is not counted twice (scanner hit and multi-host hit on one line).
    expect(byHost.get('db-a.partner-cloud.de')!.locations).toHaveLength(1);
    // Userinfo is never read as a host; placeholders are externalised.
    expect([...byHost.keys()].some((h) => h === 'svc' || h.includes('$'))).toBe(false);
    expect(JSON.stringify(r)).not.toContain('pw,1');
  });
});
