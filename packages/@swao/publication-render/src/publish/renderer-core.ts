// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Shared publication-rendering engine core (#0582 -- D-PORTAL-4).
 *
 * This is the SHARED page-assembly pipeline plus its helpers, extracted from the
 * Mode A renderer into the @swao/publication-render leaf so both the Community
 * single-page publication (@swao/module-html-report) and the Consultant HTML
 * portal render through ONE code path. Because the block HTML, the term wrapping
 * and the inlined swao-pub.css all flow through assemblePublicationPage, style +
 * content parity between the portal and the single-page publication is
 * structural -- the portal cannot drift (Design 058 D-PORTAL-1 / D-PORTAL-4).
 *
 * Pipeline (steps 5-10 of the Mode A render):
 *   interpolate meta -> parse slots -> renderBlock per slot -> splice
 *   -> data-quality banner -> wrap terms -> inline assets
 *
 * The host's renderModeA (which stays in @swao/module-html-report) does steps
 * 1-4 (extract / sanitise / locate output / load template) + 11-12 (enforce
 * size / write) around this, importing assemblePublicationPage + resolvePublishAsset
 * + PublicationSizeError from here.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';

import type { PublicationModel } from './model.js';
import { RunManifestSchema } from '@swao/core';
import { evaluateDataQuality, buildDataQualityBannerHtml } from './data-quality-banner.js';
import { buildTagIndex, buildSearchIndex, serialiseTagIndex, mergeSearchIndexWithSections } from './tag-index.js';
import { renderBlock } from './blocks.js';
import { resolvePublicationTitle } from './planner.js';
import { readCiTokens, buildCiTokenStyleBlock } from './ci-tokens.js';
import { loadProfileOverride, type ResolvedProfile, type NavTopConfig } from './profiles.js';

// ---------------------------------------------------------------------------
// Step 7: Nav label map (Design 068 §20.9, #0951)
// Maps slot/block ID to display label + i18n key for top nav links.
// ---------------------------------------------------------------------------

const NAV_LABEL_MAP: Record<string, { label: string; key: string; navKey: string }> = {
  'cover':                    { label: 'Overview',    key: 'nav.overview',    navKey: 'overview' },
  'exec-summary':             { label: 'Summary',     key: 'nav.summary',     navKey: 'summary' },
  'signal-list':              { label: 'Signals',     key: 'nav.signals',     navKey: 'signals' },
  'compliance-regime':        { label: 'Compliance',  key: 'nav.compliance',  navKey: 'compliance' },
  'controls':                 { label: 'Controls',    key: 'nav.controls',    navKey: 'controls' },
  'risk-register':            { label: 'Risk',        key: 'nav.risk',        navKey: 'risk' },
  'evidence-gallery':         { label: 'Evidence',    key: 'nav.evidence',    navKey: 'evidence' },
  'run-history':              { label: 'History',     key: 'nav.history',     navKey: 'history' },
  'methodology':              { label: 'Methodology', key: 'nav.methodology', navKey: 'methodology' },
  'glossary':                 { label: 'Glossary',    key: 'nav.glossary',    navKey: 'glossary' },
  'lzr-summary':              { label: 'LZ Readiness',key: 'nav.lz',         navKey: 'lz' },
  'lz-catalog-services':      { label: 'Services',    key: 'nav.services',    navKey: 'services' },
  'compliance-requirements':  { label: 'Requirements',key: 'nav.requirements',navKey: 'requirements' },
  'assessment-scope':         { label: 'Scope',       key: 'nav.scope',       navKey: 'scope' },
};

function buildNavHtml(navTop: NavTopConfig): string {
  const links = (navTop.anchors ?? [])
    .filter(a => a.enabled !== false)
    .map(({ id }) => {
      const entry = NAV_LABEL_MAP[id];
      if (!entry) return `<a href="#${id}" data-nav-key="${id}">${id}</a>`;
      return `<a href="#${id}" data-nav-key="${entry.navKey}" data-i18n-key="${entry.key}">${entry.label}</a>`;
    })
    .join('\n      ');
  return `<nav class="site-header__nav" aria-label="Main navigation">\n      ${links}\n    </nav>`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// No hard cap: HTML publications are self-contained single files that can be
// zipped for email or hosted directly. Warn only above 10 MB so operators
// notice unexpectedly large outputs (#0929 -- limit raised from 2 MB).
const MAX_APP_BYTES   = 10 * 1024 * 1024;  // 10 MB warn-only threshold
const WARN_APP_BYTES  = Math.round(MAX_APP_BYTES * 0.8);

export class PublicationSizeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Publication size ${bytes} bytes exceeds 10 MB limit`);
  }
}

// Re-exported so the host renderer can enforce size against the shared limits
// without redeclaring them (keeps the limit contract in one place).
export { MAX_APP_BYTES, WARN_APP_BYTES };

// ---------------------------------------------------------------------------
// Slot parsing
// ---------------------------------------------------------------------------

interface Slot {
  name: string;
  params: Record<string, string>;
  raw: string; // the original comment text, for splicing
}

const SLOT_RE = /<!--\s*SWAO:slot\s+name="([^"]+)"([^>]*?)-->/g;

function parseSlots(template: string): Slot[] {
  const slots: Slot[] = [];
  let m: RegExpExecArray | null;
  SLOT_RE.lastIndex = 0;
  while ((m = SLOT_RE.exec(template)) !== null) {
    const name = m[1];
    const attrsStr = m[2] ?? '';
    const params: Record<string, string> = {};
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsStr)) !== null) {
      params[am[1]] = am[2];
    }
    slots.push({ name, params, raw: m[0] });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Template substitution helpers
// ---------------------------------------------------------------------------

function interpolateMeta(template: string, model: PublicationModel): string {
  // Access publication_config safely -- parallel agent may have added it
  const pubCfg = (model.meta as unknown as { publication_config?: Record<string, string> })
    .publication_config ?? {};

  const publicationTitle = resolvePublicationTitle(
    (model as unknown as Record<string, unknown>)['assessment_type'] as string | undefined,
  );

  return template
    .replace(/\{\{publication_title\}\}/g, esc(publicationTitle))
    .replace(/\{\{meta\.app_name\}\}/g, esc(model.meta.app_name))
    .replace(/\{\{meta\.app_id\}\}/g, esc(model.meta.app_id))
    .replace(/\{\{meta\.assessed_at\}\}/g, esc(model.meta.assessed_at))
    // publication_config substitutions
    .replace(
      /\{\{publication_config\.classification_band\}\}/g,
      esc(pubCfg['classification_band'] ?? 'Accenture Internal, Confidential'),
    )
    .replace(
      /\{\{publication_config\.logo_name\}\}/g,
      esc(pubCfg['logo_name'] ?? 'SWAO'),
    )
    .replace(
      /\{\{publication_config\.logo_sub\}\}/g,
      esc(pubCfg['logo_sub'] ?? 'Publication'),
    )
    .replace(
      /\{\{publication_config\.github_url\}\}/g,
      esc(pubCfg['github_url'] ?? 'https://github.com/Accenture/SWAO'),
    )
    .replace(
      /\{\{publication_config\.docs_url\}\}/g,
      esc(pubCfg['docs_url'] ?? 'https://accenture.github.io/SWAO/'),
    );
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Term wrapping (§6.2)
// ---------------------------------------------------------------------------

interface GlossaryTerm {
  term: string;
  definition: string;
}

function loadGlossary(): GlossaryTerm[] {
  // Multi-candidate resolution (#0575): controls/glossary.yaml lives at
  // <workspace>/swao/controls/glossary.yaml. This file lives at
  // @swao/publication-render/src/publish/, so the dev path is 5 levels up
  // (publish -> src -> publication-render -> @swao -> packages -> swao). The
  // built leaf (dist/publish/) sits at the same depth, so one string covers
  // dev + leaf-dist. The original 4-up string is PRESERVED for the pkg binary,
  // where __dirname tracks the bundled dist/ regardless of source location and
  // pkg.assets snapshots `../../controls/**`.
  // No existsSync guard: existsSync returns false for pkg snapshot paths
  // even when readFileSync succeeds. Use try/catch per candidate directly.
  const candidates = [
    join(__dirname, '../../../../../controls/glossary.yaml'),  // dev + leaf dist (5-up)
    join(__dirname, '../../../controls/glossary.yaml'),        // pkg binary: dist/ -> swao/ (3-up)
    join(__dirname, '../../../../controls/glossary.yaml'),     // legacy preserved (4-up)
  ];
  for (const glossaryPath of candidates) {
    try {
      const raw = loadYaml(readFileSync(glossaryPath, 'utf-8')) as {
        terms?: Array<{ term?: string; definition?: string }>;
      } | null;
      return (raw?.terms ?? [])
        .filter(t => typeof t.term === 'string' && typeof t.definition === 'string')
        .map(t => ({ term: String(t.term), definition: String(t.definition) }));
    } catch {
      /* try next candidate */
    }
  }
  return [];
}

/** @internal exported for unit testing only */
export function wrapTerms(html: string, terms: GlossaryTerm[]): string {
  // Wrap known glossary terms in <abbr> elements, skipping script and style blocks.
  // Uses indexOf-based block protection rather than a regex tag filter (avoids
  // CodeQL js/bad-tag-filter; terms come from a bundled read-only asset).
  if (terms.length === 0) return html;

  const protectedBlocks: string[] = [];
  let working = html;

  function protectTag(openTag: string, closeTag: string): void {
    // Single-pass, index-offset approach: compute toLowerCase once and advance
    // a position pointer instead of rebuilding `working` on every iteration.
    // The old pattern rebuilt working via slice+concat each loop, growing a V8
    // ConsString tree that crashed on large pages (5000+ tags) when toLowerCase
    // tried to flatten the deep tree (#0929).
    const parts: string[] = [];
    let pos = 0;
    const lo = working.toLowerCase();
    for (;;) {
      const start = lo.indexOf(openTag, pos);
      if (start === -1) { parts.push(working.slice(pos)); break; }
      const end = lo.indexOf(closeTag, start + openTag.length);
      if (end === -1) { parts.push(working.slice(pos)); break; }
      const blockEnd = end + closeTag.length;
      if (start > pos) parts.push(working.slice(pos, start));
      const marker = `\x00P${protectedBlocks.length}\x00`;
      protectedBlocks.push(working.slice(start, blockEnd));
      parts.push(marker);
      pos = blockEnd;
    }
    working = parts.join('');
  }

  protectTag('<script', '</script>');
  protectTag('<style', '</style>');
  // Protect all HTML tag boundaries so attribute values are not modified.
  // e.g. href="#signal-INV-05" -- 'signal' in the href must not be wrapped.
  // Tags are replaced with markers; only text nodes between tags get term wrapping.
  protectTag('<', '>');

  // Single-pass replacement: all terms at once so earlier insertions
  // cannot be corrupted by later term replacements (cascading bug).
  const termMap = new Map(terms.map(t => [t.term.toLowerCase(), t]));
  const altPattern = terms
    .map(t => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (altPattern) {
    const allRe = new RegExp(`\\b(${altPattern})\\b`, 'gi');
    working = working.replace(allRe, (match) => {
      const t = termMap.get(match.toLowerCase());
      if (!t) return match;
      return `<abbr class="swao-term" data-def="${esc(t.definition)}">${esc(match)}</abbr>`;
    });
  }

  // Restore protected blocks via a single regex pass. Markers can appear in
  // any order (e.g. a <style> block that precedes a <script> gets a higher
  // marker number because script-protection runs first). A sequential
  // indexOf loop would miss out-of-order markers; a regex replace callback
  // handles them in whatever order they appear without ConsString buildup (#0929).
  working = working.replace(/\x00P(\d+)\x00/g, (_, numStr: string) => {
    const i = parseInt(numStr, 10);
    return i < protectedBlocks.length ? protectedBlocks[i] : '';
  });

  return working;
}

// ---------------------------------------------------------------------------
// Asset resolution (shared with the portal builder -- #0582)
// ---------------------------------------------------------------------------

/**
 * Resolve a bundled publish asset (swao-pub.css / swao-pub.js / i18n yaml) by
 * trying the multi-candidate path list that copes with dev src/, the built
 * leaf dist/, and the pkg binary snapshot.
 *
 * WHY this is exported and lives in the shared engine core (not the portal
 * module): the candidate paths are relative to THIS file's __dirname. The portal
 * builder (publish/portal/portal-builder.ts) sits one directory deeper, so
 * recomputing the candidates from its own __dirname would break every path in
 * dev/test. The portal MUST import this helper so it reads the identical asset
 * bytes the single-page publication inlines -- that is part of how style parity
 * is made structural (Design 058 D-PORTAL-4). Uses readFileSync directly in
 * try/catch: existsSync may return false for pkg snapshot virtual paths on
 * Windows even when the file is bundled.
 */
export function resolvePublishAsset(name: string, fallback = ''): string {
  // After esbuild bundling, __dirname = dist/ (not dist/publish/). The leaf's
  // source assets are inlined into the host bundle, so __dirname tracks the host
  // dist/ regardless of which leaf the code came from; the 'publish/assets'
  // candidate covers that bundled binary case. The remaining candidates resolve
  // from the leaf's own location for dev/vitest (dist/publish/ + src/publish/).
  const candidates = [
    join(__dirname, 'publish', 'assets', name),          // bundled: dist/ -> dist/publish/assets/
    join(__dirname, 'assets', name),                     // source: dist/publish/ -> dist/publish/assets/
    join(__dirname, '..', 'publish', 'assets', name),    // extra level
    join(__dirname, '..', 'assets', name),
    join(__dirname, '..', '..', 'src', 'publish', 'assets', name),
  ];
  for (const c of candidates) {
    try { return readFileSync(c, 'utf-8'); } catch { /* try next */ }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Asset inlining
// ---------------------------------------------------------------------------

function inlineAssets(
  html: string,
  model: PublicationModel,
  timestamp: string,
  searchIndexJson: string,
  tagIndexJson: string,
  logger: { warn(msg: string): void; error(msg: string): void },
  ciTokenStyleBlock: string,
): string {
  const css = resolvePublishAsset('swao-pub.css', '');
  const js  = resolvePublishAsset('swao-pub.js',  '');

  if (!css) {
    logger.warn('[swao publish] swao-pub.css not found -- publication will render without styles');
  }
  if (!js) {
    logger.warn('[swao publish] swao-pub.js not found -- publication will render without client-side features');
  }

  // #0435: load real i18n label files
  function loadI18nFile(lang: string): Record<string, unknown> {
    const candidates = [
      join(__dirname, 'publish', 'i18n', `${lang}.yaml`),  // bundled: dist/ -> dist/publish/i18n/
      join(__dirname, 'i18n', `${lang}.yaml`),              // source: dist/publish/ -> dist/publish/i18n/
      join(__dirname, '..', 'publish', 'i18n', `${lang}.yaml`),
      join(__dirname, '..', 'i18n', `${lang}.yaml`),
      join(__dirname, '..', '..', 'src', 'publish', 'i18n', `${lang}.yaml`),
    ];
    for (const c of candidates) {
      try { return (loadYaml(readFileSync(c, 'utf-8')) as Record<string, unknown>) ?? {}; } catch { /* try next */ }
    }
    return {};
  }
  const i18nBundle = { en: loadI18nFile('en'), de: loadI18nFile('de') };
  const i18nJson = JSON.stringify(i18nBundle);
  // Sanitise em-dashes (U+2014) and en-dashes (U+2013) from LLM-generated content
  // before embedding in JSON data blocks (#1252). These characters can only appear
  // inside JSON string values so the replacement is safe and does not corrupt structure.
  const sanitizeDashes = (s: string) => s.replace(/\u2014/g, ' -- ').replace(/\u2013/g, '-');
  const pubDataJson = sanitizeDashes(JSON.stringify({ ...model, _generated_at: timestamp }));

  // Use arrow-function replacement to prevent String.replace() from
  // interpreting $& / $' / $` inside script/CSS content as back-references.
  // Without this, `$&` in swao-pub.js (regex escape: '\\$&') gets replaced
  // with the matched marker text, breaking the search highlight function.
  //
  // CI token block (D1 -- #0930): injected BEFORE swao-pub.css so Tier 1
  // overrides cascade into Tier 2 semantic tokens.
  const cssBlock = ciTokenStyleBlock
    ? `${ciTokenStyleBlock}\n<style id="swao-pub-css">\n${css}\n</style>`
    : `<style id="swao-pub-css">\n${css}\n</style>`;
  html = html.replace(/<!--\s*swao:css\s*-->/gi, () => cssBlock);

  // #1388: extend the typed model docs with full-text docs extracted from the
  // rendered sections so any visible string is findable via the search overlay.
  const fullSearchIndexJson = mergeSearchIndexWithSections(searchIndexJson, html);

  const jsInline = [
    `<script type="application/json" id="swao-search-index">${sanitizeDashes(fullSearchIndexJson)}</script>`,
    `<script type="application/json" id="swao-tag-index">${sanitizeDashes(tagIndexJson)}</script>`,
    `<script type="application/json" id="swao-i18n">${i18nJson}</script>`,
    `<script type="application/json" id="swao-pub-data">${pubDataJson}</script>`,
    `<script id="swao-pub-js">\n${js}\n</script>`,
  ].join('\n');
  html = html.replace(/<!--\s*swao:js\s*-->/gi, () => jsInline);

  return html;
}

// ---------------------------------------------------------------------------
// Shared page-assembly pipeline (#0582 -- D-PORTAL-4)
// ---------------------------------------------------------------------------

/**
 * Assemble a single publication page from an interpolated slot-marker template
 * and a PublicationModel. This is the EXACT pipeline renderModeA uses for the
 * single-page publication (steps 5-10: interpolate meta -> parse slots ->
 * renderBlock per slot -> splice -> data-quality banner -> wrap terms ->
 * inline assets), factored out so the HTML Portal builder can reuse it.
 *
 * WHY this matters (Design 058 D-PORTAL-4): the portal renders each page from
 * THIS function over a portal-specific template (the publication shell + a
 * grouped slot subset + a portal nav). Because the block HTML, the term
 * wrapping and the inlined swao-pub.css all come from this one code path,
 * style + content parity with the single-page publication is structural -- the
 * portal cannot drift. The ONLY portal-specific layer is which slots a given
 * page declares; the rendering of each slot is identical.
 *
 * The caller passes `template` already chosen (bundled / workspace override /
 * portal page template). `model` is assumed already extracted + PII-sanitised;
 * `wspRunDir` is only used to locate the run-manifest for the data-quality
 * banner (omit / pass a non-existent path to skip the banner). `timestamp` is
 * the fixed/empty generated_at to keep output deterministic.
 */
export function assemblePublicationPage(args: {
  template: string;
  model: PublicationModel;
  wspRunDir?: string;
  timestamp: string;
  ciTokensPath?: string;
  /** Named profile variant to load (e.g. 'client', 'internal'). Undefined = default profile file. */
  profileVariant?: string;
  logger?: { warn(msg: string): void; info(msg: string): void; error(msg: string): void };
}): string {
  const { model, wspRunDir, timestamp } = args;
  const logger = args.logger ?? { warn: console.warn, info: console.info, error: console.error };

  // D1 (#0930): resolve ci.yaml path -- explicit > derived from wspRunDir > skip
  let ciTokenStyleBlock = '';
  let resolvedWorkspace = '';
  {
    let ciPath = args.ciTokensPath;
    if (!ciPath && wspRunDir) {
      // wspRunDir = <ws>/apps/<id>/wsp/runs/<ts> -- workspace is 5 levels up
      resolvedWorkspace = join(wspRunDir, '../../../../../');
      ciPath = join(resolvedWorkspace, 'wsp', 'templates', 'styles', 'ci.yaml');
    }
    if (ciPath && existsSync(ciPath)) {
      const tokens = readCiTokens(ciPath); // throws on unknown token names (AC #0930)
      ciTokenStyleBlock = buildCiTokenStyleBlock(tokens);
    }
  }

  // Step 10 (#0943): load profile YAML override (Design 068 §20.5).
  // blockEnabled: slot name -> boolean (false = skip the block).
  // profileBlockOptions: slot name -> extra params merged into slot.params.
  // profileComponentOptions: component name -> options Record (e.g. swao-table density).
  let profileBlockEnabled: Record<string, boolean> = {};
  let profileBlockOptions: Record<string, Record<string, string>> = {};
  let profileComponentOptions: Record<string, Record<string, string>> = {};
  let loadedProfile: ResolvedProfile | null = null;
  if (resolvedWorkspace) {
    const profileId = model.block_profile ?? 'application';
    loadedProfile = loadProfileOverride(resolvedWorkspace, profileId, args.profileVariant);
    if (loadedProfile) {
      for (const entry of loadedProfile.blocks) {
        profileBlockEnabled[entry.id] = entry.enabled;
      }
      profileBlockOptions = loadedProfile.blockOptions;
      profileComponentOptions = loadedProfile.componentOptions;
    }
  }

  // 5. Interpolate meta
  let template = interpolateMeta(args.template, model);

  // 5.5. Apply profile block order (#1032): reorder slot comments in template
  // before parsing so parseSlots sees them in the profile-specified sequence.
  // Swaps the slot-comment strings in place; surrounding HTML is preserved.
  if (loadedProfile && loadedProfile.blocks.length > 0) {
    const profileOrderMap = new Map<string, number>();
    for (const entry of loadedProfile.blocks) {
      profileOrderMap.set(entry.id, entry.order);
    }
    const slotCommentRe = /<!--\s*SWAO:slot\s+name="([^"]+)"[^>]*?-->/g;
    const positions: { name: string; match: string; start: number; end: number }[] = [];
    let m2: RegExpExecArray | null;
    while ((m2 = slotCommentRe.exec(template)) !== null) {
      positions.push({ name: m2[1], match: m2[0], start: m2.index, end: m2.index + m2[0].length });
    }
    if (positions.length > 1) {
      const sorted = [...positions].sort((a, b) => {
        const aOrd = profileOrderMap.has(a.name) ? profileOrderMap.get(a.name)! : 9999 + positions.indexOf(a);
        const bOrd = profileOrderMap.has(b.name) ? profileOrderMap.get(b.name)! : 9999 + positions.indexOf(b);
        return aOrd - bOrd;
      });
      if (sorted.some((s, i) => s.name !== positions[i].name)) {
        let reordered = '';
        let cursor = 0;
        for (let i = 0; i < positions.length; i++) {
          reordered += template.slice(cursor, positions[i].start);
          reordered += sorted[i].match;
          cursor = positions[i].end;
        }
        reordered += template.slice(cursor);
        template = reordered;
      }
    }
  }

  // 6. Parse slots
  const slots = parseSlots(template);

  // 7. Render blocks (static import at top of file -- dynamic import causes
  //    ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING in server/editor preview contexts)
  const toc = slots.map(s => s.name);
  const fragments = new Map<string, string>();
  for (const slot of slots) {
    // Skip blocks the profile has disabled.
    if (profileBlockEnabled[slot.name] === false) {
      fragments.set(slot.raw, `<section id="${slot.name}" class="swao-block swao-block--disabled" aria-hidden="true"></section>`);
      continue;
    }

    const params = { ...slot.params };
    if (slot.name === 'toc') params['slots'] = toc.join(',');
    if (slot.name === 'assessment-scope' && wspRunDir) params['_wspRunDir'] = wspRunDir;
    // Merge block-level options from the profile (supplements template slot attributes).
    Object.assign(params, profileBlockOptions[slot.name] ?? {});
    try {
      fragments.set(slot.raw, renderBlock(slot.name, params, model, logger, profileComponentOptions));
    } catch (err) {
      // Gracefully degrade: render a minimal placeholder section
      logger.error(`[swao publish] Block "${slot.name}" render failed: ${String(err)}`);
      fragments.set(slot.raw, `<section id="${slot.name}" class="swao-block swao-block--error" aria-label="${slot.name}"><p style="color:var(--colour-critical)">Block unavailable: ${slot.name}</p></section>`);
    }
  }

  // 8. Splice fragments
  let html = template;
  for (const [raw, rendered] of fragments) {
    html = html.replace(raw, rendered);
  }

  // 8.5. Data quality banner (#0475 C-18)
  {
    const manifestPath = wspRunDir ? join(wspRunDir, 'run-manifest.json') : '';
    let manifest = null;
    if (manifestPath && existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
        const parsed = RunManifestSchema.safeParse(raw);
        if (parsed.success) manifest = parsed.data;
      } catch { /* skip */ }
    }
    const conditions = evaluateDataQuality(manifest);
    // Inject false-positive signal IDs so the banner renders clickable links
    const fpCond = conditions.find(c => c.message.includes('hallucination') || c.message.includes('false_positive') || c.message.includes('flagged'));
    if (fpCond) {
      const fpSignals = model.signals.filter((s) => s.false_positive_flag === true);
      fpCond.signal_ids = fpSignals.map((s) => s.id).filter(Boolean);
      if (fpCond.signal_ids.length > 0) {
        fpCond.signal_derivations = Object.fromEntries(
          fpSignals.map((s) => [s.id, s.derivation ?? ''])
        );
      }
    }
    const bannerHtml = buildDataQualityBannerHtml(conditions);
    if (bannerHtml) {
      // ReDoS-safe (#0582, CodeQL js/polynomial-redos): `<main\b[^>]*>` is linear
      // and equivalent to the prior `<main(\s[^>]*)?>` -- `\b` keeps the whole-tag-name
      // match (still won't match `<maindata>`); the single `[^>]*` before `>` avoids
      // the optional-group-with-star backtracking.
      html = html.replace(/<main\b[^>]*>/, (m) => `${m}${bannerHtml}`);
    }
  }

  // 9. Wrap terms
  const glossary = loadGlossary();
  html = wrapTerms(html, glossary);

  // 9.5. Step 7 (#0951 + #1028 #1029): inject configurable nav from profile.nav.
  // profile.nav.top: replace anchor list + inject CSS for toggle booleans (search etc.)
  if (loadedProfile?.nav?.top) {
    const navTop = loadedProfile.nav.top;
    if (navTop.anchors && navTop.anchors.length > 0) {
      const newNav = buildNavHtml(navTop);
      // indexOf+slice instead of [\s\S]*? regex -- avoids polynomial backtracking (CodeQL).
      const NAV_OPEN = '<nav class="site-header__nav"';
      const navStart = html.indexOf(NAV_OPEN);
      if (navStart !== -1) {
        const closeTag = '</nav>';
        const navEnd = html.indexOf(closeTag, navStart);
        if (navEnd !== -1) {
          html = html.slice(0, navStart) + newNav + html.slice(navEnd + closeTag.length);
        }
      }
    }
    // CSS for optional UI toggles -- only inject when explicitly disabled.
    const cssRules: string[] = [];
    if (navTop.search === false)        cssRules.push('.site-header__search { display: none !important; }');
    if (navTop.langSwitcher === false)  cssRules.push('.site-header__lang { display: none !important; }');
    if (navTop.themeToggle === false)   cssRules.push('.site-header__theme { display: none !important; }');
    if (navTop.sidebarVisible === false) cssRules.push('.side-nav { display: none !important; }');
    if (cssRules.length > 0) {
      html = html.replace('</head>', `<style>\n${cssRules.join('\n')}\n</style>\n</head>`);
    }
  }
  // profile.nav.side: CSS flexbox order + visibility for side nav items.
  if (loadedProfile?.nav?.side && loadedProfile.nav.side.length > 0) {
    const sideCssRules: string[] = [];
    const enabledItems = loadedProfile.nav.side
      .filter(s => s.enabled !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    enabledItems.forEach((item, i) => {
      sideCssRules.push(`.side-nav a[href="#${item.id}"] { order: ${i + 1}; }`);
    });
    loadedProfile.nav.side.filter(s => s.enabled === false).forEach(item => {
      sideCssRules.push(`.side-nav a[href="#${item.id}"] { display: none !important; }`);
    });
    if (sideCssRules.length > 0) {
      html = html.replace('</head>', `<style>\n${sideCssRules.join('\n')}\n</style>\n</head>`);
    }
  }

  // 10. Inline assets
  // #0433: build real tag index + lunr search index
  const populatedTagIndex = buildTagIndex(model);
  // Merge into model.tags so blocks can use it
  Object.assign(model.tags, populatedTagIndex);
  const searchIndexJson = buildSearchIndex(model);
  const tagIndexJson = serialiseTagIndex(model.tags);
  html = inlineAssets(html, model, timestamp, searchIndexJson, tagIndexJson, logger, ciTokenStyleBlock);

  return html;
}
