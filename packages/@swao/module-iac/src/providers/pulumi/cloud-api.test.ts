// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  IaC provider abstraction module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fetchPulumiStackExport, ingestPulumiStacks } from './cloud-api.js';

// ---------------------------------------------------------------------------
// Minimal mock HTTP server (no external deps required)
// ---------------------------------------------------------------------------

interface MockRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
}

function startMockServer(
  statusCode: number,
  body: string,
): Promise<{ server: Server; port: number; lastRequest: () => MockRequest }> {
  let lastReq: MockRequest = { method: undefined, url: undefined, authorization: undefined };

  const server = createServer((req, res) => {
    lastReq = {
      method: req.method,
      url: req.url,
      authorization: req.headers['authorization'],
    };
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        lastRequest: () => lastReq,
      });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Tests for fetchPulumiStackExport (CLAUDE.md SS5.9 -- mock before real call)
// ---------------------------------------------------------------------------

const MINIMAL_EXPORT = JSON.stringify({
  version: 3,
  deployment: { resources: [] },
});

describe('fetchPulumiStackExport', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it('happy path: sends correct URL and Authorization header, returns response body', async () => {
    const mock = await startMockServer(200, MINIMAL_EXPORT);
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    const result = await fetchPulumiStackExport(
      { org: 'myorg', project: 'myapp', stack: 'prod' },
      'test-token-abc',
      baseUrl,
    );

    expect(result).toBe(MINIMAL_EXPORT);

    const req = mock.lastRequest();
    expect(req.url).toBe('/api/stacks/myorg/myapp/prod/export');
    expect(req.method).toBe('GET');
    expect(req.authorization).toBe('token test-token-abc');
  });

  it('401 Unauthorized: throws with 401 in message', async () => {
    const mock = await startMockServer(401, JSON.stringify({ message: 'Unauthorized' }));
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    await expect(
      fetchPulumiStackExport({ org: 'myorg', project: 'myapp', stack: 'prod' }, 'bad-token', baseUrl),
    ).rejects.toThrow('401');
  });

  it('404 Not Found: throws with 404 in message', async () => {
    const mock = await startMockServer(404, JSON.stringify({ message: 'Not found' }));
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    await expect(
      fetchPulumiStackExport({ org: 'myorg', project: 'myapp', stack: 'nonexistent' }, 'tok', baseUrl),
    ).rejects.toThrow('404');
  });

  it('500 Server Error: throws with 500 in message', async () => {
    const mock = await startMockServer(500, 'Internal Server Error');
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    await expect(
      fetchPulumiStackExport({ org: 'o', project: 'p', stack: 's' }, 'tok', baseUrl),
    ).rejects.toThrow('500');
  });
});

// ---------------------------------------------------------------------------
// Tests for ingestPulumiStacks
// ---------------------------------------------------------------------------

const TMP = join(tmpdir(), `swao-pulumi-api-test-${process.pid}`);

describe('ingestPulumiStacks', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('happy path: writes fetched JSON to wsp/inputs/pulumi/{project}-{stack}.json', async () => {
    const mock = await startMockServer(200, MINIMAL_EXPORT);
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    mkdirSync(TMP, { recursive: true });
    const vaultReader = (key: string) => (key === 'pulumi-api-token' ? 'test-tok' : undefined);

    const result = await ingestPulumiStacks(
      TMP,
      [{ org: 'acme', project: 'myapp', stack: 'prod' }],
      vaultReader,
      baseUrl,
    );

    expect(result.fetched).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);

    const written = readFileSync(join(TMP, 'wsp', 'inputs', 'pulumi', 'myapp-prod.json'), 'utf-8');
    expect(written).toBe(MINIMAL_EXPORT);
  });

  it('missing vault token: returns INV-07 warning, does not throw', async () => {
    mkdirSync(TMP, { recursive: true });
    const vaultReader = (_key: string) => undefined;

    const result = await ingestPulumiStacks(
      TMP,
      [{ org: 'acme', project: 'myapp', stack: 'prod' }],
      vaultReader,
    );

    expect(result.fetched).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('INV-07');
    expect(result.warnings[0]).toContain('pulumi-api-token');
  });

  it('API 401 error: records warning with INV-07, continues, does not throw', async () => {
    const mock = await startMockServer(401, '{"message":"Unauthorized"}');
    server = mock.server;
    const baseUrl = `http://127.0.0.1:${mock.port}`;

    mkdirSync(TMP, { recursive: true });
    const vaultReader = (key: string) => (key === 'pulumi-api-token' ? 'bad-token' : undefined);

    const result = await ingestPulumiStacks(
      TMP,
      [{ org: 'acme', project: 'myapp', stack: 'prod' }],
      vaultReader,
      baseUrl,
    );

    expect(result.fetched).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('INV-07');
    expect(result.warnings[0]).toContain('401');
  });

  it('empty stacks list: returns immediately with no fetches or warnings', async () => {
    mkdirSync(TMP, { recursive: true });
    const vaultReader = (key: string) => (key === 'pulumi-api-token' ? 'tok' : undefined);

    const result = await ingestPulumiStacks(TMP, [], vaultReader);

    expect(result.fetched).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
