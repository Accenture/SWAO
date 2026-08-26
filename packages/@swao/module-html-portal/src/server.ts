// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML portal module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO Live Portal -- Fastify REST + SSE server (#0438)
 *
 * Design 041 §12 / issue #0438
 * Provides authenticated REST endpoints over the PublicationModel
 * and a Server-Sent Events stream for live updates.
 *
 * TypeScript strict, NodeNext module resolution.
 */

import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { existsSync, readFileSync, readdirSync, watch } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import type { ServerResponse } from 'http';

// Shared rendering engine (extractor / model / page-assembly pipeline) lives in
// the @swao/publication-render leaf (#0582, module-split stage 1). The on-demand
// Mode A render below assembles a page THROUGH this leaf pipeline rather than
// importing renderModeA from @swao/module-html-report: this Consultant portal
// module must not import its Community sibling (Design 058 D-PORTAL-1). The
// leaf's BUNDLED_TEMPLATE_CONTENT is the same slot-marker shell the single-page
// publication uses, so the served HTML is byte-equivalent to renderModeA's.
import {
  extractPublicationModel,
  sanitisePII,
  assemblePublicationPage,
  BUNDLED_TEMPLATE_CONTENT,
} from '@swao/publication-render';
import type { PublicationModel, RiskRegisterItem } from '@swao/publication-render';
import { buildModeBSite } from './site-builder.js';
import { findWorkspace } from '@swao/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PiiDepth = 'full' | 'sanitised' | 'public';

export class ModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelLoadError';
  }
}

export interface PortalOptions {
  port?: number;
  host?: string;
  workspace?: string;
  jwtSecret?: string;
  watch?: boolean;
}

export interface PortalServer {
  start(): Promise<string>;
  stop(): Promise<void>;
  readonly fastify: ReturnType<typeof Fastify>;
}

interface AppSummary {
  app_id: string;
  app_name: string;
  assessed_at: string;
  signal_counts: Record<string, number>;
  blocker_count: number;
  coverage_score: number;
}

interface JwtUser {
  role?: string;
  sub?: string;
}

// ---------------------------------------------------------------------------
// PII depth by role
// ---------------------------------------------------------------------------

function piiDepthForRole(role: string | undefined): PiiDepth {
  if (role === 'dpo' || role === 'ccoe') return 'full';
  return 'sanitised';
}

// ---------------------------------------------------------------------------
// Model cache
// ---------------------------------------------------------------------------

interface CachedEntry {
  model: PublicationModel;
  runDir: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPortalServer(opts: PortalOptions = {}): PortalServer {
  const port = opts.port ?? 4000;
  const host = opts.host ?? '127.0.0.1';
  const jwtSecret = opts.jwtSecret ?? 'swao-portal-secret';
  const enableWatch = opts.watch ?? false;

  // Resolve workspace: option > findWorkspace(cwd) > cwd
  const workspace = opts.workspace ?? findWorkspace(process.cwd()) ?? process.cwd();

  // In-memory model cache: appId -> CachedEntry
  const modelCache = new Map<string, CachedEntry>();

  // SSE clients
  const sseClients = new Set<ServerResponse>();

  // Heartbeat interval handle
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // fs.watch handle for live reload
  let fsWatcher: ReturnType<typeof watch> | null = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Allowlist: app IDs are lowercase alphanumeric + hyphens + underscores only.
  // Rejects path traversal attempts (CodeQL js/path-injection).
  function sanitizeAppId(raw: string): string | null {
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(raw) ? raw : null;
  }

  function findLatestRun(appId: string): string | null {
    // Resolve to canonical path; verify result stays under workspace (CodeQL js/path-injection)
    const runsDir = resolvePath(workspace, 'apps', appId, 'wsp', 'runs');
    if (!runsDir.startsWith(resolvePath(workspace))) return null;
    if (!existsSync(runsDir)) return null;

    // Prefer the canonical latest.txt pointer the CLI writes ("runs/<ts>"). It
    // is the source of truth for the current run and is robust to stray run
    // dirs left by ad-hoc `swao assess` invocations against a shared workspace
    // (#0592). Fall back to newest-by-name when the pointer is absent or stale.
    const latestPtr = resolvePath(workspace, 'apps', appId, 'wsp', 'latest.txt');
    if (latestPtr.startsWith(resolvePath(workspace)) && existsSync(latestPtr)) {
      const rel = readFileSync(latestPtr, 'utf-8').trim();
      if (rel) {
        const pointed = resolvePath(workspace, 'apps', appId, 'wsp', rel);
        if (pointed.startsWith(resolvePath(workspace)) && existsSync(pointed)) {
          return pointed;
        }
      }
    }

    const runs = readdirSync(runsDir).sort().reverse();
    if (runs.length === 0) return null;
    return join(runsDir, runs[0]);
  }

  // Resolve + sanitize an app ID from a route param, load its model.
  // Returns null on invalid ID (path traversal rejection) or missing app.
  async function resolveApp(
    rawId: string,
    reply: { code(n: number): { send(e: unknown): unknown } },
  ): Promise<PublicationModel | null> {
    const safe = sanitizeAppId(rawId);
    if (!safe) {
      reply.code(400).send({ error: 'Invalid app ID' });
      return null;
    }
    let model: PublicationModel | null;
    try {
      model = await loadModel(safe);
    } catch (err) {
      const msg = err instanceof ModelLoadError ? err.message : String(err);
      reply.code(404).send({ error: msg });
      return null;
    }
    if (!model) {
      reply.code(404).send({ error: `App not found: ${safe}` });
      return null;
    }
    return model;
  }

  async function loadModel(appId: string): Promise<PublicationModel | null> {
    const cached = modelCache.get(appId);
    if (cached) return cached.model;

    const runDir = findLatestRun(appId);
    if (!runDir) return null;

    try {
      const model = await extractPublicationModel(runDir);
      modelCache.set(appId, { model, runDir });
      return model;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[swao portal] model load failed for ${appId}: ${reason}`);
      throw new ModelLoadError(`model load failed for ${appId}: ${reason}`);
    }
  }

  function getModelForRole(model: PublicationModel, depth: PiiDepth): PublicationModel {
    if (depth === 'full') return model;
    // Clone + sanitise for non-full access
    const clone = JSON.parse(JSON.stringify(model)) as PublicationModel;
    sanitisePII(clone);
    return clone;
  }

  function listAppIds(): string[] {
    const appsDir = join(workspace, 'apps');
    if (!existsSync(appsDir)) return [];
    try {
      return readdirSync(appsDir).filter(name => {
        return existsSync(join(appsDir, name, 'wsp', 'runs'));
      });
    } catch {
      return [];
    }
  }

  // Find the most-recently generated Mode A publication HTML file for an app.
  function findLatestPublication(appId: string): string | null {
    const pubDir = resolvePath(workspace, 'apps', appId, 'wsp', 'publications');
    if (!pubDir.startsWith(resolvePath(workspace))) return null;
    if (!existsSync(pubDir)) return null;
    try {
      const htmlFiles = readdirSync(pubDir)
        .filter(f => f.endsWith('.html') && !f.includes('.tmpl'))
        .sort()
        .reverse();
      if (htmlFiles.length === 0) return null;
      return join(pubDir, htmlFiles[0]);
    } catch {
      return null;
    }
  }

  function broadcastSse(data: Record<string, unknown>): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Fastify instance
  // ---------------------------------------------------------------------------

  const fastify = Fastify({ logger: false });

  // Register JWT
  void fastify.register(fastifyJwt, { secret: jwtSecret });

  // Register CORS
  void fastify.register(fastifyCors, { origin: true });

  // Rate limiting via @fastify/rate-limit -- recognised by CodeQL js/missing-rate-limiting.
  // Applies globally to all routes: 300 req/min per IP.
  void fastify.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: 'Too Many Requests',
      retryAfter: context.after,
    }),
  });

  // ---------------------------------------------------------------------------
  // Auth hook
  // ---------------------------------------------------------------------------

  async function authenticate(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'Unauthorised: valid JWT required' });
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  // GET /assets/swao-pub.css -- serve shared stylesheet
  // Multi-candidate path: after esbuild bundling, __dirname = dist/ not dist/publish/
  fastify.get('/assets/swao-pub.css',
    { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (_req, reply) => {
    const candidates = [
      join(__dirname, 'publish', 'assets', 'swao-pub.css'),
      join(__dirname, '..', 'assets', 'swao-pub.css'),
      join(__dirname, '..', 'publish', 'assets', 'swao-pub.css'),
      join(__dirname, '..', '..', 'src', 'publish', 'assets', 'swao-pub.css'),
    ];
    for (const p of candidates) {
      try {
        const css = readFileSync(p, 'utf-8');
        return reply.type('text/css; charset=utf-8').send(css);
      } catch { /* try next */ }
    }
    return reply.code(404).send('/* swao-pub.css not found */');
  });

  // Root handler -- styled portfolio page linking to per-app publication views
  fastify.get('/', async (_req, reply) => {
    const appIds = listAppIds();

    const appCards = appIds.length > 0
      ? appIds.map(id => {
          const pubFile = findLatestPublication(id);
          const hasPublication = pubFile !== null;

          // Parse publication timestamp from filename e.g. 2026-06-02T04-34-58-sovereign-health.html
          let pubDateLabel = '';
          if (pubFile) {
            const fname = pubFile.split(/[\\/]/).pop() ?? '';
            const tsMatch = fname.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
            if (tsMatch) {
              // Convert dashes back to colons for display
              const ts = tsMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
              try {
                pubDateLabel = new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
              } catch {
                pubDateLabel = tsMatch[1];
              }
            }
          }

          // Get latest assessment run date
          const runDir = findLatestRun(id);
          let assessDateLabel = '';
          if (runDir) {
            const rname = runDir.split(/[\\/]/).pop() ?? '';
            const rMatch = rname.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
            if (rMatch) {
              const ts = rMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
              try {
                assessDateLabel = new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
              } catch {
                assessDateLabel = rMatch[1];
              }
            }
          }

          return `<div class="swao-card" style="padding:1.25rem;margin-bottom:1rem;">
            <h3 style="margin:0 0 0.25rem;">${id}</h3>
            ${assessDateLabel ? `<p style="margin:0 0 0.25rem;font-size:0.82rem;color:var(--text-secondary);">Assessed: ${assessDateLabel}</p>` : ''}
            ${pubDateLabel ? `<p style="margin:0 0 0.5rem;font-size:0.82rem;color:var(--text-secondary);">Publication: ${pubDateLabel}</p>` : ''}
            ${hasPublication
              ? `<p style="margin:0;"><a href="/apps/${id}" style="font-weight:600;">View Publication</a></p>`
              : `<p style="margin:0;color:var(--text-secondary);font-size:0.875rem;">No publication yet. Run <code>swao publish</code> first.</p>`}
            <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-secondary);"><a href="/api/v1/apps/${id}/signals">Signals (JSON)</a></p>
          </div>`;
        }).join('')
      : '<p style="color:var(--text-secondary);">No apps found. Run <code>swao assess</code> to generate assessment data.</p>';

    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SWAO Live Portal</title>
  <link rel="stylesheet" href="/assets/swao-pub.css">
</head>
<body>
<div class="band band-top">Accenture Internal, Confidential</div>
<header class="site-header">
  <div class="site-header__logo">
    <span class="site-header__logo-name">SWAO</span>
    <span class="site-header__logo-sub">LIVE PORTAL</span>
  </div>
  <nav class="site-header__nav">
    <a href="/" class="active">Portfolio</a>
    <a href="/api/v1/apps">API</a>
    <a href="/api/v1/health">Health</a>
  </nav>
</header>
<div class="breadcrumb-bar">
  <ol class="breadcrumb"><li><strong>Portfolio</strong></li></ol>
</div>
<div class="page-layout">
  <nav class="sidebar" id="swao-sidebar" aria-label="Portal navigation">
    <div class="sidebar__section">
      <span class="sidebar__label">PORTAL</span>
      <ul class="sidebar__nav">
        <li><a href="/" class="active" aria-current="page">Portfolio</a></li>
        <li><a href="/api/v1/apps">App List (JSON)</a></li>
        <li><a href="/api/v1/health">Health Check</a></li>
      </ul>
    </div>
    ${appIds.length > 0 ? `<div class="sidebar__section">
      <span class="sidebar__label">APPS</span>
      <ul class="sidebar__nav">
        ${appIds.map(id => `<li><a href="/apps/${id}">${id}</a></li>`).join('\n        ')}
      </ul>
    </div>` : ''}
  </nav>
  <main class="main-content" id="main-content">
    <section id="portfolio">
      <h1>Portfolio</h1>
      <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Click any application to view its full assessment publication.</p>
      ${appCards}
    </section>
  </main>
</div>
<div class="band band-bottom">Accenture Internal, Confidential</div>
</body>
</html>`);
  });

  // GET /apps/:id -- serve the Mode A publication HTML for an app
  fastify.get<{ Params: { id: string } }>(
    '/apps/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const safe = sanitizeAppId(req.params.id);
    if (!safe) return reply.code(400).send('Invalid app ID');

    const pubFile = findLatestPublication(safe);
    if (pubFile) {
      try {
        const html = readFileSync(pubFile, 'utf-8');
        return reply.type('text/html; charset=utf-8').send(html);
      } catch {
        // fall through to on-demand render
      }
    }

    // No pre-rendered file: render Mode A on demand through the shared leaf
    // pipeline (extract -> sanitise -> assemble through the bundled shell). This
    // is byte-equivalent to renderModeA without importing the Community sibling
    // (Design 058 D-PORTAL-1).
    const runDir = findLatestRun(safe);
    if (!runDir) return reply.code(404).send('App not found or not yet assessed');

    try {
      const model = await extractPublicationModel(runDir);
      sanitisePII(model);
      const html = assemblePublicationPage({
        template: BUNDLED_TEMPLATE_CONTENT,
        model,
        wspRunDir: runDir,
        // renderModeA defaults the timestamp to now when none is supplied (this
        // route never passed one), so mirror that for behaviour parity.
        timestamp: new Date().toISOString(),
      });
      // No hard size cap -- serve the page regardless of size (#0929).
      return reply.type('text/html; charset=utf-8').send(html);
    } catch (err) {
      return reply.code(500).send(`Render error: ${String(err)}`);
    }
  });

  fastify.get('/api/v1/health', async (_req, reply) => {
    return reply.send({ status: 'ok', version: '1.0' });
  });

  // GET /api/v1/apps  (no auth)
  fastify.get('/api/v1/apps', async (_req, reply) => {
    const appIds = listAppIds();
    const summaries: AppSummary[] = [];

    for (const appId of appIds) {
      try {
        const model = await loadModel(appId);
        if (!model) continue;
        summaries.push({
          app_id: model.meta.app_id,
          app_name: model.meta.app_name,
          assessed_at: model.meta.assessed_at,
          signal_counts: model.summary.signal_counts,
          blocker_count: model.summary.blocker_count,
          coverage_score: model.summary.coverage_score,
        });
      } catch {
        // skip apps that fail to load
      }
    }

    return reply.send(summaries);
  });

  // GET /api/v1/apps/:id/publication  (auth)
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/apps/:id/publication',
    { preHandler: authenticate },
    async (req, reply) => {
      const model = await resolveApp(req.params.id, reply);
      if (!model) return;
      const user = req.user as JwtUser;
      const depth = piiDepthForRole(user.role);
      return reply.send(getModelForRole(model, depth));
    },
  );

  // GET /api/v1/apps/:id/signals  (auth; ?severity=critical)
  fastify.get<{ Params: { id: string }; Querystring: { severity?: string } }>(
    '/api/v1/apps/:id/signals',
    { preHandler: authenticate },
    async (req, reply) => {
      const model = await resolveApp(req.params.id, reply);
      if (!model) return;
      const user = req.user as JwtUser;
      const depth = piiDepthForRole(user.role);
      const m = getModelForRole(model, depth);
      const { severity } = req.query;
      const signals = severity
        ? m.signals.filter(s => s.severity === severity)
        : m.signals;
      return reply.send(signals);
    },
  );

  // GET /api/v1/apps/:id/risk-register  (auth)
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/apps/:id/risk-register',
    { preHandler: authenticate },
    async (req, reply) => {
      const model = await resolveApp(req.params.id, reply);
      if (!model) return;
      const user = req.user as JwtUser;
      const depth = piiDepthForRole(user.role);
      const m = getModelForRole(model, depth);
      return reply.send(m.risk_register);
    },
  );

  // GET /api/v1/apps/:id/compliance/:frameworkId  (auth)
  fastify.get<{ Params: { id: string; frameworkId: string } }>(
    '/api/v1/apps/:id/compliance/:frameworkId',
    { preHandler: authenticate },
    async (req, reply) => {
      const model = await resolveApp(req.params.id, reply);
      if (!model) return;
      // frameworkId is a constant enum (GDPR, DORA etc.) -- restrict to safe chars
      const fwId = req.params.frameworkId.replace(/[^A-Z0-9_-]/gi, '');
      const result = model.compliance.find(
        c => c.framework_id.toLowerCase() === fwId.toLowerCase(),
      );
      if (!result) {
        return reply.code(404).send({ error: `Framework not found: ${fwId}` });
      }
      return reply.send(result);
    },
  );

  // PATCH /api/v1/apps/:id/remediation/:riskId  (auth)
  fastify.patch<{
    Params: { id: string; riskId: string };
    Body: { status: 'open' | 'in_progress' | 'resolved'; notes?: string };
  }>(
    '/api/v1/apps/:id/remediation/:riskId',
    { preHandler: authenticate },
    async (req, reply) => {
      const model = await resolveApp(req.params.id, reply);
      if (!model) return;
      const { riskId } = req.params;
      // Sanitize riskId to safe characters (CodeQL js/path-injection)
      const safeRiskId = riskId.replace(/[^A-Z0-9_-]/gi, '');

      const riskIndex = model.risk_register.findIndex(r => r.risk_id === safeRiskId);
      if (riskIndex === -1) {
        return reply.code(404).send({ error: `Risk not found: ${safeRiskId}` });
      }

      const { status, notes } = req.body;
      const updated: RiskRegisterItem = {
        ...model.risk_register[riskIndex],
        status,
        ...(notes !== undefined ? { notes } : {}),
        ...(status === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
      };
      model.risk_register[riskIndex] = updated;

      // Broadcast SSE notification
      broadcastSse({ type: 'remediation-updated', appId: req.params.id, riskId: safeRiskId });

      return reply.send(updated);
    },
  );

  // GET /api/v1/events  (SSE; auth optional)
  fastify.get('/api/v1/events',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
    // Attempt JWT verification but do not block on failure
    try {
      await req.jwtVerify();
    } catch {
      // anonymous access allowed for SSE
    }

    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial ping immediately
    res.write('data: {"type":"ping"}\n\n');

    sseClients.add(res);

    req.raw.on('close', () => {
      sseClients.delete(res);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: start / stop
  // ---------------------------------------------------------------------------

  return {
    get fastify() {
      return fastify;
    },

    async start(): Promise<string> {
      await fastify.listen({ port, host });

      // Heartbeat every 30s
      heartbeatInterval = setInterval(() => {
        broadcastSse({ type: 'ping' });
      }, 30_000);
      heartbeatInterval.unref();

      // File watcher for live reload
      if (enableWatch) {
        const appsDir = join(workspace, 'apps');
        if (existsSync(appsDir)) {
          try {
            fsWatcher = watch(appsDir, { recursive: true }, (_event, filename) => {
              if (!filename) return;
              // Detect new run directories
              const parts = String(filename).split(/[\\/]/);
              const appId = parts[0];
              if (!appId) return;

              // Invalidate cache for this app
              modelCache.delete(appId);

              // Rebuild site incrementally (fire-and-forget; errors are non-fatal)
              const runDir = findLatestRun(appId);
              if (runDir) {
                const outDir = join(workspace, 'apps', appId, 'wsp', 'publications', 'site');
                void buildModeBSite({
                  wspRunDir: runDir,
                  outDir,
                  lang: 'en',
                  swaoVersion: 'unknown',
                }).then(() => {
                  broadcastSse({ type: 'assessment-updated', appId });
                }).catch(() => {
                  // non-fatal
                });
              }
            });
          } catch {
            // non-fatal: watcher setup failure
          }
        }
      }

      return `http://${host}:${port}`;
    },

    async stop(): Promise<void> {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
      }
      // Close all SSE connections
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      await fastify.close();
    },
  };
}
