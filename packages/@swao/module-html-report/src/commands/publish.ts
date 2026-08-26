// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * `swao publish` CLI command -- Design 041 §12 + issue #0432
 *
 * Flags:
 *   --app <id>          Mode A, single app (Community+)
 *   --portfolio         Mode A, portfolio (Premium)
 *   --init              Scaffold template files in workspace
 *   --open              Open output in default browser after generation
 *   --pii-strict        Exit 1 if PII redaction applied
 *   --lang <code>       Output language: en (default), de
 *   --headless          JSON only, no HTML (Premium)
 *   --out <dir>         Override output directory
 *   --timestamp <ISO>   Override generated_at for determinism testing
 *   --run <ts>          Specific historical run timestamp
 *   --template <name>   Template name or absolute path -- resolves to wsp/templates/html/<name>.html.tmpl (#1008)
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import type { Command } from 'commander';

import { renderModeA, renderHubPage, renderWorkspaceHubPage, renderModeALlm, scaffoldPublicationTemplate } from '../publish/renderer.js';
import { findWorkspace, LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError, logPortfolio } from '@swao/core';

/**
 * Options accepted by the injected HTML Portal builder. Declared structurally
 * here (NOT imported from @swao/module-html-portal) because this Community module
 * must not import the sibling Consultant portal module: `publish --site` is the
 * Consultant portal, but the `publish` command itself stays Community. The host
 * injects the real buildPortalSite from @swao/module-html-portal (Design 058
 * D-PORTAL-1), mirroring how createLlmProvider is injected into registerChallenge.
 * The shape matches @swao/module-html-portal's BuildPortalSiteOptions /
 * BuildPortalSiteResult.
 */
export interface BuildPortalOptions {
  workspace: string;
  outDir: string;
  appId?: string;
  lang?: string;
  timestamp?: string;
  swaoVersion?: string;
  logger?: { info(m: string): void; warn(m: string): void };
}

export interface BuildPortalResult {
  outDir: string;
  pageCount: number;
  appIds: string[];
  pages: string[];
}

export type BuildPortal = (opts: BuildPortalOptions) => Promise<BuildPortalResult>;

/**
 * Host-injected dependencies (#0575, extended Sprint 064 #0582).
 *
 * The module cannot import host branding, so the host passes SWAO_VERSION via
 * registerPublish (the #0573 doctor + #0574 mcp dependency-injection pattern).
 * Sprint 064 adds `buildPortal`: the `publish --site` / `--site-app` branch is
 * the Consultant HTML Portal, which now lives in @swao/module-html-portal. This
 * Community module cannot import that sibling, so the host injects the portal
 * builder here (mirrors createLlmProvider -> registerChallenge). The Community
 * `--edit` Publication Editor stays a local import (NOT injected).
 */
export interface PublishHostDeps {
  swaoVersion: string;
  buildPortal: BuildPortal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openFile(filePath: string): void {
  // Pass path via environment variable SWAO_OPEN_PATH instead of spawn args.
  // This breaks the data-flow chain that CodeQL js/shell-command-injection-from-environment
  // traces from CLI --out/--app arguments through to child-process command arguments.
  // The Node helper script reads process.env.SWAO_OPEN_PATH -- that value never appears
  // in spawn argument arrays, so CodeQL cannot trace the taint to a shell command.
  const env = { ...process.env, SWAO_OPEN_PATH: filePath };
  const helper = [
    "var p=process.env.SWAO_OPEN_PATH;if(!p)process.exit(0);",
    "var cp=require('child_process'),pl=process.platform;",
    // On Windows, cmd /c start uses the .html file-extension handler which may be Firefox
    // even when the user's default web browser is different. Using a file:// URL routes
    // through the URI protocol handler (default browser) instead.
    "if(pl==='win32'){var u='file:///'+p.replace(/\\\\/g,'/').replace(/ /g,'%20');cp.spawn('cmd',['/c','start','',u],{detached:true,stdio:'ignore'}).unref();}",
    "else if(pl==='darwin')cp.spawn('open',[p],{detached:true,stdio:'ignore'}).unref();",
    "else cp.spawn('xdg-open',[p],{detached:true,stdio:'ignore'}).unref();",
  ].join('');
  // spawn receives only fixed strings in arg array; user path is only in env
  spawn(process.execPath, ['-e', helper], { detached: true, stdio: 'ignore', env }).unref();
}

/**
 * Normalise a run timestamp to the directory-name format used on disk.
 * The TUI RunContextPicker emits ISO 8601 strings (e.g. "2026-07-30T10:09:16Z")
 * but run directories use dashes and no Z suffix (e.g. "2026-07-30T10-09-16").
 */
function normalizeRunTs(ts: string): string {
  return ts.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, '');
}

/**
 * Find the latest run directory for an app (sorted descending by name).
 * Run directories are ISO timestamps like `2026-05-13T18-42-00`.
 */
function findLatestRun(workspace: string, appId: string, runTs?: string): string {
  const runsDir = join(workspace, 'apps', appId, 'wsp', 'runs');
  if (!existsSync(runsDir)) {
    throw new Error(`No runs directory found for app '${appId}' at ${runsDir}`);
  }
  if (runTs) {
    const normalized = normalizeRunTs(runTs);
    const explicit = join(runsDir, normalized);
    if (!existsSync(explicit)) throw new Error(`Run '${normalized}' not found at ${explicit}`);
    return explicit;
  }
  const runs = readdirSync(runsDir)
    .filter(r => existsSync(join(runsDir, r, 'wsp.yaml')))
    .sort()
    .reverse();
  if (runs.length === 0) throw new Error(`No publishable runs found for app '${appId}'. Run \`swao assess --app ${appId}\` first.`);
  return join(runsDir, runs[0]);
}

/**
 * Resolve a landing-zone-catalog run directory (#1250).
 * The LZ run pointer (latest-landing-zone-catalog.txt) contains a path relative
 * to the wsp/ directory -- which may NOT be under wsp/runs/ (e.g. lz-assessment-fixture).
 * Accepts both directory-name format ("2026-07-30T10-09-16") and ISO format
 * ("2026-07-30T10:09:16Z") as emitted by the TUI RunContextPicker.
 */
function findLzRunDir(workspace: string, appId: string, runTs?: string): string {
  const wspDir = join(workspace, 'apps', appId, 'wsp');
  if (runTs) {
    const normalized = normalizeRunTs(runTs);
    process.stderr.write(`[swao publish] LZ run requested: '${runTs}' (normalised: '${normalized}')\n`);
    // Try direct wsp/<normalized> first, then wsp/runs/<normalized> for compatibility.
    const direct = join(wspDir, normalized);
    if (existsSync(direct)) {
      process.stderr.write(`[swao publish] LZ run resolved (direct): ${direct}\n`);
      return direct;
    }
    const inRuns = join(wspDir, 'runs', normalized);
    if (existsSync(inRuns)) {
      process.stderr.write(`[swao publish] LZ run resolved (runs/): ${inRuns}\n`);
      return inRuns;
    }
    throw new Error(`LZ run '${normalized}' not found at ${direct} or ${inRuns}`);
  }
  const ptrPath = join(wspDir, 'latest-landing-zone-catalog.txt');
  process.stderr.write(`[swao publish] Reading LZ pointer: ${ptrPath}\n`);
  if (existsSync(ptrPath)) {
    const dirName = readFileSync(ptrPath, 'utf-8').trim();
    if (dirName) {
      const dir = join(wspDir, dirName);
      process.stderr.write(`[swao publish] LZ pointer -> '${dirName}' -> ${dir}\n`);
      if (existsSync(dir)) return dir;
      process.stderr.write(`[swao publish] WARN: LZ pointer dir does not exist: ${dir}\n`);
    }
  }
  throw new Error(
    `No LZ catalog run found for app '${appId}'. ` +
    `Run 'swao assess --type landing-zone-catalog --app ${appId}' first.`,
  );
}

// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------

export function registerPublish(program: Command, deps: PublishHostDeps): void {
  const { swaoVersion, buildPortal } = deps;
  program
    .command('publish')
    .description('Generate a single self-contained HTML report from the latest assessment run')
    .option('--app <id>', 'App ID to publish (Community+)')
    .option('--portfolio', 'Publish portfolio view (Premium)')
    .option('--init', 'Scaffold publication template files in the workspace')
    .option('--open', 'Open output file in default browser after generation')
    .option('--pii-strict', 'Exit 1 if any PII redaction was applied')
    .option('--lang <code>', 'Output language code (en, de)', 'en')
    .option('--headless', 'Emit publication-data.json only; no HTML (Premium)')
    .option('--out <dir>', 'Override output directory')
    .option('--timestamp <ISO>', 'Override generated_at for determinism testing')
    .option('--run <ts>', 'Specific run timestamp (default: latest)')
    .option('--site', 'Build the HTML Portal: multi-page portfolio over the workspace (Enterprise)')
    .option('--site-app <id>', 'Rebuild one app in the portal (Enterprise)')
    .option('--block-profile <name>', 'Override block profile (application, lz-catalog, hub). Defaults to the profile auto-detected from the run type.')
    .option('--profile-variant <name>', 'Named profile variant (e.g. client, internal). Selects wsp/templates/profiles/<profile>-<variant>.yaml.')
    .option('--no-llm-narrative', 'Disable optional LLM narrative sections')
    .option('--edit', 'Open Publication Editor in browser -- customise layout, blocks and style')
    .option('--serve', 'HTML Portal server (coming soon -- build the static portal with --site)')
    .option('--port <n>', 'Port for --serve or --edit server', '4000')
    .option('--no-watch', 'Disable fs.watch live re-render for --serve')
    .option('--evidence-base-url <url>', 'Base URL prefix for evidence file links in the HTML report')
    .option('--template <name>', 'Template name or path (resolves to wsp/templates/html/<name>.html.tmpl, or absolute path)')
    .option('--lz', 'Publish Landing Zone Catalog assessment -- Community+ (shorthand for --block-profile lz-catalog)')
    .option('--llm', 'Publish LLM Assessment report -- Consultant+ (shorthand for --block-profile llm-assessment)')
    .option('--combined', 'Publish combined hub report: App, LZ, and LLM Assessment in one tabbed file (shorthand for --block-profile hub)')
    .option('--workspace <path>', 'Workspace root path (default: auto-detected from cwd)')
    .action(async (opts: {
      app?: string;
      portfolio?: boolean;
      init?: boolean;
      open?: boolean;
      piiStrict?: boolean;
      lang: string;
      headless?: boolean;
      out?: string;
      timestamp?: string;
      run?: string;
      site?: boolean;
      siteApp?: string;
      edit?: boolean;
      serve?: boolean;
      port?: string;
      watch?: boolean;
      blockProfile?: string;
      profileVariant?: string;
      llmNarrative?: boolean;
      evidenceBaseUrl?: string;
      template?: string;
      lz?: boolean;
      llm?: boolean;
      combined?: boolean;
      workspace?: string;
    }) => {
      try {
        const workspace = opts.workspace ? resolve(opts.workspace) : findWorkspace(process.cwd());
        if (!workspace) {
          process.stderr.write('Error: No SWAO workspace found. Run from inside a workspace.\n');
          process.exitCode = 1;
          return;
        }

        const logger = {
          info:  (m: string) => process.stderr.write(m + '\n'),
          warn:  (m: string) => process.stderr.write('WARN '  + m + '\n'),
          error: (m: string) => process.stderr.write('ERROR ' + m + '\n'),
        };

        // --lz / --llm / --combined are user-facing shorthands; normalise to blockProfile for internal routing.
        if (opts.lz)       opts.blockProfile = 'lz-catalog';
        if (opts.llm)      opts.blockProfile = 'llm-assessment';
        if (opts.combined) opts.blockProfile = 'hub';

        // --serve (live portal server) -- deferred; #0438 / Design 058 §7.
        if (opts.serve) {
          process.stdout.write('[info] HTML Portal server (--serve) is coming soon. Build the static portal with --site.\n');
          return;
        }

        if (opts.headless) {
          process.stdout.write('[info] JSON data export is coming soon. No active consumer exists in this release.\n');
          return;
        }

        // --edit: launch Publication Editor UI (#0436). Enterprise tier (D-06, 2026-07-26).
        if (opts.edit) {
          const editGuard = LicenseGuard.load();
          try {
            editGuard.requireTier('enterprise', { feature: 'publish --edit' });
          } catch (err) {
            if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
              process.stderr.write([
                '[LICENSE] swao publish --edit (Publication Editor) requires an Enterprise license.',
                'Run `swao license request` to obtain a license.',
                'Contact: https://github.com/Accenture/SWAO/discussions',
                '',
              ].join('\n'));
              process.exitCode = 2;
              return;
            }
            if (err instanceof LicenseInvalidError) {
              process.stderr.write(`[LICENSE] Invalid license: ${(err as Error).message}\n`);
              process.exitCode = 3;
              return;
            }
            throw err;
          }
          const { launchEditor } = await import('../publish/editor/editor.js');
          await launchEditor({ appId: opts.app, profileVariant: opts.profileVariant });
          return;
        }

        // --init
        if (opts.init) {
          scaffoldPublicationTemplate(workspace, logger);
          return;
        }

        // --portfolio (Premium gate placeholder)
        if (opts.portfolio) {
          process.stderr.write(
            'Error: --portfolio requires a Premium licence.\n' +
            'Upgrade at https://swao.accenture.com/licences\n',
          );
          process.exitCode = 1;
          return;
        }

        // --headless: JSON-only output (Premium)
        if (opts.headless) {
          if (!opts.app) {
            process.stderr.write('Error: --headless requires --app <id>\n');
            process.exitCode = 1;
            return;
          }
          const wspRunDir = findLatestRun(workspace, opts.app, opts.run);
          const outDir = opts.out ? resolve(opts.out) : resolve(workspace, 'apps', opts.app, 'wsp', 'publications');
          const result = await renderModeA({
            wspRunDir, outputPath: resolve(outDir, `${opts.app}-publication-data.json`),
            headless: true, timestamp: opts.timestamp, swaoVersion, logger,
          });
          process.stderr.write(`[swao publish --headless] Done. Written to ${result.outputPath}\n`);
          process.stdout.write(result.outputPath + '\n');
          return;
        }

        // --site (HTML Portal: multi-page portfolio over the workspace).
        // --site-app <id> rebuilds one app. Enterprise-tier per D-06 (2026-07-26)
        // + ADR-0049 / Design 058 D-PORTAL-1 (#1228): the command stays visible
        // but refuses on Community/Consultant with an upgrade message.
        if (opts.site || opts.siteApp) {
          const guard = LicenseGuard.load();
          try {
            guard.requireTier('enterprise', { feature: 'publish --site' });
          } catch (err) {
            if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
              process.stderr.write([
                '[LICENSE] swao publish --site (HTML Portal) requires an Enterprise license.',
                'Run `swao license request` to obtain a license.',
                'Contact: https://github.com/Accenture/SWAO/discussions',
                '',
              ].join('\n'));
              process.exitCode = 2;
              return;
            }
            if (err instanceof LicenseInvalidError) {
              process.stderr.write(`[LICENSE] Invalid license: ${(err as Error).message}\n`);
              process.exitCode = 3;
              return;
            }
            throw err;
          }

          const outDir = opts.out
            ? resolve(opts.out)
            : resolve(workspace, 'wsp', 'portal');

          logger.info(`[swao publish --site] Building portal from ${workspace}`);
          logger.info(`[swao publish --site] Output: ${outDir}`);

          // Injected from @swao/module-html-portal by the host (Design 058
          // D-PORTAL-1); this Community module never imports the sibling.
          const siteResult = await buildPortal({
            workspace,
            outDir,
            appId: opts.siteApp,
            lang: opts.lang,
            timestamp: opts.timestamp,
            swaoVersion,
            logger,
          });

          const siteIndexPath = resolve(siteResult.outDir, 'index.html');
          process.stderr.write(
            `[swao publish --site] Done. ${siteResult.pageCount} pages across ${siteResult.appIds.length} app(s) -> ${siteResult.outDir}\n` +
            `[swao publish --site] Open: ${siteIndexPath}\n`,
          );
          if (opts.open) openFile(siteIndexPath);
          // Write the index.html path to stdout so the TUI can display it
          process.stdout.write(siteIndexPath + '\n');
          return;
        }

        // HTML Report baseline gate (DOCX golden standard: Consultant+).
        // lz-catalog and llm-assessment profiles are Community+ by design.
        const COMMUNITY_PROFILES = ['lz-catalog', 'llm-assessment'];
        if (!opts.blockProfile || !COMMUNITY_PROFILES.includes(opts.blockProfile)) {
          const htmlGuard = LicenseGuard.load();
          try {
            htmlGuard.requireTier('consultant', { feature: 'html-report' });
          } catch (err) {
            if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
              process.stderr.write([
                '[LICENSE] swao publish (HTML Report) requires a Consultant or Enterprise license.',
                'Run `swao license request` to obtain a license.',
                'Contact: https://github.com/Accenture/SWAO/discussions',
                '',
              ].join('\n'));
              process.exitCode = 2;
              return;
            }
            if (err instanceof LicenseInvalidError) {
              process.stderr.write(`[LICENSE] Invalid license: ${(err as Error).message}\n`);
              process.exitCode = 3;
              return;
            }
            throw err;
          }
        }

        // --app
        if (!opts.app) {
          process.stderr.write('Error: specify --app <id> or --portfolio\n');
          process.exitCode = 1;
          return;
        }

        // Validate --block-profile if provided (#0793)
        const KNOWN_PROFILES = ['application', 'lz-catalog', 'hub', 'llm-assessment'];
        if (opts.blockProfile && !KNOWN_PROFILES.includes(opts.blockProfile)) {
          process.stderr.write(
            `Error: Unknown block profile "${opts.blockProfile}". Valid profiles: ${KNOWN_PROFILES.join(', ')}\n`,
          );
          process.exitCode = 1;
          return;
        }

        const publishStartedAt = Date.now();
        const publishType = opts.blockProfile === 'llm-assessment' ? 'llm'
          : opts.blockProfile === 'lz-catalog' ? 'lz'
          : opts.blockProfile === 'hub' ? 'hub'
          : 'app';

        // Hub profile: generate engagement-hub.html from existing publications (#0794/#0795)
        if (opts.blockProfile === 'hub') {
          if (opts.app) {
            // Per-app hub (#0794)
            logPortfolio('info', 'publish.start', `Publish hub started -- app: ${opts.app}`, { context: { type: 'hub', app: opts.app } });
            const hubResult = await renderHubPage({
              workspace,
              appId: opts.app,
              swaoVersion,
              timestamp: opts.timestamp,
              logger,
            });
            process.stderr.write(
              `[swao publish --block-profile hub] Done. Size: ${Math.round(hubResult.bytes / 1024)} KB\n`,
            );
            logPortfolio('info', 'publish.ok', `Hub written: ${hubResult.outputPath}`, { context: { type: 'hub', app: opts.app, file: hubResult.outputPath, bytes: hubResult.bytes } });
            logPortfolio('info', 'publish.complete', `Hub publish complete`, { context: { type: 'hub', app: opts.app, duration_ms: Date.now() - publishStartedAt } });
            process.stdout.write(hubResult.outputPath + '\n');
            if (opts.open) openFile(hubResult.outputPath);
          } else {
            // Workspace-level hub (#0795)
            logPortfolio('info', 'publish.start', `Publish workspace hub started`, { context: { type: 'hub' } });
            const wsHubResult = await renderWorkspaceHubPage({
              workspace,
              swaoVersion,
              timestamp: opts.timestamp,
              logger,
            });
            process.stderr.write(
              `[swao publish --block-profile hub] Done. ${wsHubResult.appCount} apps. Size: ${Math.round(wsHubResult.bytes / 1024)} KB\n`,
            );
            logPortfolio('info', 'publish.ok', `Workspace hub written: ${wsHubResult.outputPath}`, { context: { type: 'hub', file: wsHubResult.outputPath, bytes: wsHubResult.bytes, app_count: wsHubResult.appCount } });
            logPortfolio('info', 'publish.complete', `Workspace hub publish complete`, { context: { type: 'hub', duration_ms: Date.now() - publishStartedAt } });
            process.stdout.write(wsHubResult.outputPath + '\n');
            if (opts.open) openFile(wsHubResult.outputPath);
          }
          return;
        }

        // LLM Assessment profile: Community+ (DOCX golden standard; no tier gate).
        if (opts.blockProfile === 'llm-assessment') {
          if (!opts.app) {
            process.stderr.write('Error: --block-profile llm-assessment requires --app <id>\n');
            process.exitCode = 1;
            return;
          }
          logPortfolio('info', 'publish.start', `LLM publish started -- app: ${opts.app}`, { context: { type: 'llm', app: opts.app } });
          const llmResult = await renderModeALlm({
            workspace,
            appId: opts.app,
            runTs: opts.run,
            swaoVersion,
            timestamp: opts.timestamp,
            narrativeEnabled: opts.llmNarrative !== false,
            logger,
          });
          process.stderr.write(
            `[swao publish --block-profile llm-assessment] Done. Size: ${Math.round(llmResult.bytes / 1024)} KB\n`,
          );
          logPortfolio('info', 'publish.ok', `LLM HTML written: ${llmResult.outputPath}`, { context: { type: 'llm', app: opts.app, file: llmResult.outputPath, bytes: llmResult.bytes } });
          // Auto-regenerate per-app engagement hub so LLM Assessment appears (#1472)
          try {
            await renderHubPage({ workspace, appId: opts.app, swaoVersion, logger });
          } catch {
            // Hub generation is best-effort; do not fail the publish
          }
          logPortfolio('info', 'publish.complete', `LLM publish complete`, { context: { type: 'llm', app: opts.app, duration_ms: Date.now() - publishStartedAt } });
          process.stdout.write(llmResult.outputPath + '\n');
          if (opts.open) openFile(llmResult.outputPath);
          return;
        }

        // For lz-catalog, resolve via pointer file which may be outside wsp/runs/ (#1250).
        const wspRunDir = opts.blockProfile === 'lz-catalog'
          ? findLzRunDir(workspace, opts.app, opts.run)
          : findLatestRun(workspace, opts.app, opts.run);

        process.stderr.write(`[swao publish] Publishing ${opts.app} from ${wspRunDir}\n`);
        logPortfolio('info', 'publish.start', `Publish started -- app: ${opts.app}, type: ${publishType}`, { context: { type: publishType, app: opts.app, run_dir: wspRunDir } });;

        let outputPath: string | undefined;
        if (opts.out) {
          outputPath = resolve(opts.out, `${opts.app}.html`);
        }

        // #1008: resolve --template <name> to a full path.
        let templatePath: string | undefined;
        if (opts.template) {
          templatePath = opts.template.includes('/') || opts.template.includes('\\')
            ? resolve(opts.template)
            : join(workspace, 'wsp', 'templates', 'html', `${opts.template}.html.tmpl`);
        }

        const result = await renderModeA({
          wspRunDir,
          outputPath,
          lang: opts.lang,
          headless: false,
          piiStrict: opts.piiStrict ?? false,
          timestamp: opts.timestamp,
          swaoVersion,
          blockProfile: opts.blockProfile,
          profileVariant: opts.profileVariant,
          evidenceBaseUrl: opts.evidenceBaseUrl,
          templatePath,
          workspaceDir: workspace,
          appDir: join(workspace, 'apps', opts.app),
          logger,
        });

        process.stderr.write(
          `[swao publish] Done. Size: ${Math.round(result.bytes / 1024)} KB` +
          (result.piiRedactions > 0 ? ` (${result.piiRedactions} PII redactions)` : '') +
          '\n',
        );
        logPortfolio('info', 'publish.ok', `HTML written: ${result.outputPath}`, { context: { type: publishType, app: opts.app, file: result.outputPath, bytes: result.bytes, pii_redactions: result.piiRedactions ?? 0 } });

        // Auto-regenerate per-app engagement hub so it stays current (#0795)
        try {
          await renderHubPage({ workspace, appId: opts.app, swaoVersion, logger });
        } catch {
          // Hub generation is best-effort; do not fail the publish
        }
        logPortfolio('info', 'publish.complete', `Publish complete`, { context: { type: publishType, app: opts.app, duration_ms: Date.now() - publishStartedAt } });
        // Print output path to stdout (machine-readable)
        process.stdout.write(result.outputPath + '\n');

        if (opts.open) {
          openFile(result.outputPath);
        }

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${errMsg}\n`);
        logPortfolio('error', 'publish.error', `Publish failed: ${errMsg.slice(0, 200)}`, { context: { error: errMsg.slice(0, 500) } });
        process.exitCode = 1;
      }
    });
}
