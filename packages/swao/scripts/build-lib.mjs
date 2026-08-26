/**
 * Shared esbuild bundle library for the SWAO per-tier build scripts (#0583,
 * Sprint 064). Factored out of the original scripts/bundle.mjs so the three
 * per-tier scripts (build-community / build-consultant / build-enterprise) share
 * one esbuild + asset-copy path and differ only in their entry point.
 *
 * The original bundle.mjs behaviour is preserved verbatim here for the
 * enterprise/full entry (build:bundle still points at it via build-enterprise's
 * default). The only generalisation is the ENTRY (a dist/*.js path) and the
 * OUTFILE, both passed in.
 *
 * IMPORTANT (dist sequencing): callers MUST run `tsc` (pnpm build) BEFORE
 * invoking buildBundle -- esbuild reads dist/*.js, not src. Skipping tsc bundles
 * stale JS. (Memory: dev-binary-build-sequence.)
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

// Canonical Windows binary output paths for each tier.
// Import these in per-tier build scripts -- a future rename only touches this file.
export const BIN_ENTERPRISE = '../../dist-bin/swao-enterprise-win.exe';
export const BIN_CONSULTANT = '../../dist-bin/swao-consultant-win.exe';
export const BIN_COMMUNITY  = '../../dist-bin/swao-community-win.exe';

// Copy non-.ts assets from src/ to dist/ that tsc does not transpile but the
// runtime needs (LLM stub fixtures, etc.). pkg's `assets` field then snapshots
// dist/passes/fixtures/** into the binary.
function copyAssets(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyAssets(srcPath, destPath);
    } else if (/\.(json|yaml|yml)$/i.test(entry.name)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function copyAllFiles(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) copyAllFiles(srcPath, destPath);
    else if (entry.isFile()) copyFileSync(srcPath, destPath);
  }
}

/**
 * Copy the runtime assets the bundled host reads from dist/ at runtime.
 *
 * `includePdfkit` (Consultant+ only): pdfkit hard-codes
 * `require('./data/Xxx.afm')` relative to its module path; after esbuild bundles
 * it into the tier bundle, those reads resolve to dist/data/*.afm. The pdf
 * renderer is Community-ABSENT (#0583), so the Community build may skip this
 * copy. Defaults to true (the enterprise/full behaviour).
 */
export function copyRuntimeAssets({ includePdfkit = true, premiumTier = 'none', log = console.log } = {}) {
  copyAssets('src/passes/fixtures', 'dist/passes/fixtures');
  log('[build-lib] copied src/passes/fixtures/** -> dist/');

  // Publication static assets (CSS, JS) + i18n. #0582: the shared rendering
  // engine + its assets live in the @swao/publication-render leaf (Community).
  copyAllFiles('../@swao/publication-render/src/publish/assets', 'dist/publish/assets');
  copyAllFiles('../@swao/publication-render/src/publish/i18n', 'dist/publish/i18n');
  log('[build-lib] copied @swao/publication-render publish assets/** + i18n/** -> dist/');

  // Controls assets (glossary.yaml, catalogues) for runtime use.
  copyAllFiles('../../controls', 'dist/_controls');
  log('[build-lib] copied controls/** -> dist/_controls/');

  // LZ service catalogues (Design 056). Same pattern as _controls + _community-frameworks:
  // the loader resolves `_lz-catalogues` relative to __dirname (= dist/) in the bundle.
  copyAllFiles('../../lz-catalogues', 'dist/_lz-catalogues');
  log('[build-lib] copied lz-catalogues/** -> dist/_lz-catalogues/');

  // LLM-Gateway connector seeds (Design 090, #1395/#1396). The connector
  // loader resolves `_llm-gateway` relative to __dirname (= dist/) in the bundle.
  copyAllFiles('../../llm-gateway', 'dist/_llm-gateway');
  log('[build-lib] copied llm-gateway/** -> dist/_llm-gateway/');

  // #0625: the bundled COMMUNITY framework catalogues. esbuild inlines the
  // @swao/community-frameworks CODE into the bundle, but the framework DATA must
  // be staged on disk where its resolver looks. The resolver (community-
  // frameworks/src/index.ts) probes `<bundle dir>/_community-frameworks`, so
  // stage them there for both the CJS bundle and the pkg binary. Without this,
  // `swao framework list` / `install` report "bundled community-frameworks/
  // folder not found in this binary build".
  copyAllFiles('../@swao/community-frameworks/frameworks', 'dist/_community-frameworks');
  log('[build-lib] copied @swao/community-frameworks/frameworks/** -> dist/_community-frameworks/');

  // #0577: the .pbit PowerBI templates are Enterprise-only (012-feature-licence-tier-matrix).
  // Community and Consultant binaries must NOT bundle them.
  if (premiumTier === 'enterprise') {
    copyAllFiles('../@swao/module-powerbi/assets', 'dist/templates/powerbi');
    log('[build-lib] copied @swao/module-powerbi assets/*.pbit -> dist/templates/powerbi/');
  } else {
    log('[build-lib] SKIPPED pbit copy (Community/Consultant: Power BI is Enterprise-only)');
  }

  if (includePdfkit) {
    // #0576: the PDF renderer lives in @swao/module-pdf-report (Consultant), but
    // pdfkit is a DIRECT dependency of packages/swao so pnpm materialises it at
    // node_modules/pdfkit. This copy reads its .afm metrics from that path at
    // BUILD time. #0583: Community has no pdf renderer bundled, so the Community
    // build skips this copy (includePdfkit: false).
    copyAllFiles('node_modules/pdfkit/js/data', 'dist/data');
    log('[build-lib] copied pdfkit/js/data/** -> dist/data/');
  } else {
    log('[build-lib] SKIPPED pdfkit data copy (Community: pdf renderer not bundled)');
  }

  // #0584: premium (Consultant / Enterprise) framework content. These live in
  // the PRIVATE content repo as the leaf packages
  // @swao/controls-consultant + @swao/controls-enterprise, mirroring
  // @swao/community-frameworks. They are NOT in this (public-eventual) repo; a
  // build WITHOUT the private repo (OSS / Community checkout) gracefully skips
  // them. See docs/runbooks/premium-content-setup.md.
  if (premiumTier === 'consultant' || premiumTier === 'enterprise') {
    copyPremiumFrameworks('controls-consultant', 'consultant', log);
  }
  if (premiumTier === 'enterprise') {
    copyPremiumFrameworks('controls-enterprise', 'enterprise', log);
  }

  // #0775-B: demo frameworks (private repo only -- 12 controls each, optimised
  // for live presentations). Staged from docs/custom-frameworks/ if present
  // (private checkout); gracefully skipped on public/Community builds.
  const demoFwSrc = '../../../docs/custom-frameworks';
  // cobit-5-demo excluded (#0842); operators install COBIT 5 manually.
  const DEMO_FW_FOLDERS = ['gdpr-demo', 'ai-10-pillars-demo', 'nist-hipaa-demo'];
  const hasDemoSrc = existsSync(demoFwSrc) && DEMO_FW_FOLDERS.some(fw => existsSync(join(demoFwSrc, fw)));
  if (hasDemoSrc) {
    for (const fw of DEMO_FW_FOLDERS) {
      const src = join(demoFwSrc, fw);
      if (existsSync(src)) copyAllFiles(src, join('dist/_demo-frameworks', fw));
    }
    log('[build-lib] copied demo frameworks -> dist/_demo-frameworks/');
  } else {
    log('[build-lib] SKIPPED demo frameworks (private repo docs/custom-frameworks/ not present)');
  }
}

/**
 * Copy a premium framework package's frameworks/ into dist/_premium-frameworks/
 * IF present. Resolution order (#0584):
 *   1. SWAO_<TIER>_FRAMEWORKS_DIR env var (operator override / CI), else
 *   2. the workspace package ../@swao/<pkg>/frameworks (the private repo cloned
 *      or submoduled into packages/@swao/, picked up by pnpm-workspace).
 * Absent -> graceful skip with a runbook pointer (the public/Community build,
 * and any checkout without private-repo access, must never hard-fail here).
 */
function copyPremiumFrameworks(pkg, tier, log) {
  // CWD-relative (the build runs from packages/swao, like the copies above).
  const envVar = `SWAO_${tier.toUpperCase()}_FRAMEWORKS_DIR`;
  const src = process.env[envVar] ?? `../@swao/${pkg}/frameworks`;
  if (!existsSync(src)) {
    log(
      `[build-lib] SKIPPED premium ${tier} frameworks (@swao/${pkg} not present). ` +
      `This is expected without the private content repo; see docs/runbooks/premium-content-setup.md.`,
    );
    return;
  }
  copyAllFiles(src, `dist/_premium-frameworks/${tier}`);
  log(`[build-lib] copied @swao/${pkg}/frameworks/** -> dist/_premium-frameworks/${tier}/`);
}

/**
 * esbuild the given entry (a dist/*.js path) into outfile. Mirrors the original
 * bundle.mjs esbuild config + plugins (playwright stub, ink devtools stub).
 * Returns the esbuild result.
 */
export async function buildBundle({ entry, outfile, log = console.log }) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    external: ['fsevents', 'react-devtools-core'],
    alias: {
      'yoga-wasm-web/auto': 'yoga-layout-prebuilt',
    },
    define: {
      'import.meta.url': '__importMetaUrl',
    },
    banner: {
      js: "const __importMetaUrl=require('url').pathToFileURL(__filename).href;",
    },
    plugins: [
      {
        // Playwright is an optional dev-time dependency for dynamic crawl
        // analysis. The standalone binary cannot run a browser, so we stub the
        // module out to keep pkg from embedding playwright-core into the exe.
        // Stub contract (#0337 Part B): any property access returns a chainable
        // proxy; any INVOCATION throws an explicit "not bundled" error.
        name: 'playwright-stub',
        setup(build) {
          build.onResolve({ filter: /^playwright$/ }, () => ({
            path: 'playwright-stub',
            namespace: 'playwright-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'playwright-stub' }, () => ({
            contents: `
              const NOT_BUNDLED_MSG = 'playwright is not bundled in the swao binary -- run from source (npm install + npm run dev) or invoke with --no-crawl / --passes excluding "dynamic" to skip Pass 10 dynamic_analysis';
              function makeProxy() {
                const fn = function () { throw new Error(NOT_BUNDLED_MSG); };
                return new Proxy(fn, {
                  get(target, key) {
                    if (key === 'then') return undefined;
                    if (typeof key === 'symbol') return undefined;
                    return makeProxy();
                  },
                  apply() { throw new Error(NOT_BUNDLED_MSG); },
                });
              }
              const stub = makeProxy();
              module.exports = stub;
              module.exports.__esModule = true;
              module.exports.default = stub;
              module.exports.chromium = stub;
              module.exports.firefox = stub;
              module.exports.webkit = stub;
              module.exports.devices = stub;
              module.exports.errors = stub;
              module.exports.request = stub;
              module.exports.selectors = stub;
            `,
            loader: 'js',
          }));
        },
      },
      {
        name: 'ink-devtools-stub',
        setup(build) {
          // ink's reconciler conditionally loads devtools with a top-level
          // await. The condition is never true in production, but esbuild
          // rejects top-level awaits in CJS output. Remove the single `await
          // import` line so the surrounding if/try/catch is harmless dead code.
          build.onLoad(
            { filter: /ink[/\\]build[/\\]reconciler\.js$/ },
            (args) => {
              const contents = readFileSync(args.path, 'utf-8').replace(
                "await import('./devtools.js');",
                "/* devtools disabled -- production bundle */",
              );
              return { contents, loader: 'js' };
            },
          );
        },
      },
    ],
  });
  log(`[build-lib] CJS bundle written to ${outfile}`);
  return result;
}
