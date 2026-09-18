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
 * Profile YAML reader -- Design 068 §20.5, Step 10.
 *
 * Reads the engagement-specific profile override written by the HTML Editor
 * from `wsp/templates/profiles/<profileId>.yaml`. Returns a ResolvedProfile
 * containing block order/enabled state, block-level option overrides (keyed
 * by slot/block name), and component-level option overrides (keyed by
 * component name, e.g. 'swao-table').
 *
 * The two option maps serve different purposes:
 *   blockOptions   -- supplements slot params at render time (e.g. signal-list filter)
 *   componentOptions -- applies globally to a component type (e.g. swao-table density)
 *
 * The YAML format written by the HTML Editor uses 'options' (block-keyed).
 * The format specified in Design 068 §20.5 uses 'component_options' (component-keyed).
 * Both are parsed and kept separate so neither format is lost.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { load as loadYaml } from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavAnchorEntry {
  id: string;
  enabled?: boolean;
}

export interface NavSideEntry {
  id: string;
  enabled?: boolean;
  order?: number;
}

export interface NavTopConfig {
  search?: boolean;
  langSwitcher?: boolean;
  themeToggle?: boolean;
  sidebarVisible?: boolean;
  anchors?: NavAnchorEntry[];
}

export interface ProfileBlockEntry {
  id: string;
  enabled: boolean;
  order: number;
}

export interface ResolvedProfile {
  profileId: string;
  /** Active variant name (undefined = default profile file). */
  variant?: string;
  /** Block order and enabled state from workspace YAML override. */
  blocks: ProfileBlockEntry[];
  /** Block-level option overrides keyed by block/slot name (editor 'options' field). */
  blockOptions: Record<string, Record<string, string>>;
  /** Component-level option overrides keyed by component name (spec 'component_options'). */
  componentOptions: Record<string, Record<string, string>>;
  nav?: { top?: NavTopConfig; side?: NavSideEntry[] };
}

export interface ProfileVariantInfo {
  /** Variant name, or 'default' for the base profile file. */
  name: string;
  /** Full path to the YAML file. */
  path: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function parseOptions(raw: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, opts] of Object.entries(raw as Record<string, unknown>)) {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) continue;
    out[key] = Object.fromEntries(
      Object.entries(opts as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(([k, v]) => [k, toStr(v)]),
    );
  }
  return out;
}

const SAFE_ID = /^[a-z][a-z0-9-]{0,40}$/;
const SAFE_VARIANT = /^[a-z][a-z0-9-]{0,40}$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the filesystem path for a profile YAML file.
 * variant = undefined -> `<profileId>.yaml` (default profile)
 * variant = 'client'  -> `<profileId>-client.yaml` (named variant)
 */
export function resolveProfilePath(workspace: string, profileId: string, variant?: string): string {
  const filename = variant ? `${profileId}-${variant}.yaml` : `${profileId}.yaml`;
  return join(workspace, 'wsp', 'templates', 'profiles', filename);
}

/**
 * Return the list of available profile variants for the given profile ID.
 * Always includes 'default' (the base `<profileId>.yaml`) if that file exists.
 * Named variants are inferred from `<profileId>-<name>.yaml` files in the same directory.
 * Returns an empty array if the profiles directory does not exist.
 */
export function listProfileVariants(workspace: string, profileId: string): ProfileVariantInfo[] {
  const profilesDir = join(workspace, 'wsp', 'templates', 'profiles');
  if (!existsSync(profilesDir)) return [];

  const variants: ProfileVariantInfo[] = [];
  let entries: string[];
  try {
    entries = readdirSync(profilesDir).filter(f => f.endsWith('.yaml'));
  } catch {
    return [];
  }

  // Base profile (no variant suffix)
  const baseName = `${profileId}.yaml`;
  if (entries.includes(baseName)) {
    variants.push({ name: 'default', path: join(profilesDir, baseName) });
  }

  // Named variants: <profileId>-<variant>.yaml
  const prefix = `${profileId}-`;
  for (const entry of entries.sort()) {
    if (entry.startsWith(prefix) && entry !== baseName) {
      const variantName = basename(entry, '.yaml').slice(prefix.length);
      if (SAFE_VARIANT.test(variantName)) {
        variants.push({ name: variantName, path: join(profilesDir, entry) });
      }
    }
  }
  return variants;
}

/**
 * Load the profile YAML override for the given workspace and profile ID.
 * Pass variant to select a named variant file (`<profileId>-<variant>.yaml`).
 * Returns null if the file does not exist or cannot be parsed.
 */
/**
 * Static registry of block IDs per assessment profile (Design 068 Phase 3A, #1125).
 * Mirrors BLOCK_PROFILE_CONTEXTS in the editor server; kept here so the rendering
 * engine and the editor share one authoritative source.
 */
export const BLOCK_PROFILES: Readonly<Record<string, readonly string[]>> = {
  application: [
    'cover', 'quick-nav', 'coverage-bar', 'exec-summary', 'seven-r-card', 'signal-list',
    'compliance-regime', 'compliance-framework-detail', 'compliance-matrix',
    'compliance-requirements', 'controls', 'risk-register',
    'evidence-gallery', 'lzr-summary', 'stakeholder-challenge', 'delta-view', 'run-history',
    'assessment-scope', 'block-scorecard', 'runbook', 'glossary', 'methodology', 'footer',
  ],
  'lz-catalog': [
    'cover', 'lzr-catalog-header', 'lzr-catalog-verdict', 'lz-catalog-services',
    'lzr-catalog-findings', 'lzr-catalog-remediation', 'lzr-catalog-finops',
    'evidence-gallery', 'run-history',
  ],
  hub: [
    'hub.header', 'hub.app_list', 'hub.cross_links', 'hub.workspace_summary',
  ],
} as const;

export function loadProfileOverride(workspace: string, profileId: string, variant?: string): ResolvedProfile | null {
  const profilePath = resolveProfilePath(workspace, profileId, variant);
  if (!existsSync(profilePath)) return null;

  let raw: Record<string, unknown>;
  try {
    const parsed = loadYaml(readFileSync(profilePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Blocks: accept both 'id' and 'name' as the block identifier field.
  const blocks: ProfileBlockEntry[] = [];
  if (Array.isArray(raw['blocks'])) {
    for (const b of raw['blocks'] as unknown[]) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      const entry = b as Record<string, unknown>;
      const id =
        typeof entry['id'] === 'string' ? entry['id'] :
        typeof entry['name'] === 'string' ? entry['name'] : null;
      if (!id || !SAFE_ID.test(id)) continue;
      blocks.push({
        id,
        enabled: entry['enabled'] !== false,
        order: typeof entry['order'] === 'number' ? entry['order'] : 0,
      });
    }
    blocks.sort((a, b) => a.order - b.order);
  }

  // Block-level options (editor format: 'options' keyed by block/slot name).
  const blockOptions = parseOptions(raw['options']);

  // Component-level options (spec format: 'component_options' keyed by component name).
  const componentOptions = parseOptions(raw['component_options']);

  // Navigation config -- accepts the rich editor format saved by server.ts or
  // the legacy string-array format.  The editor saves:
  //   nav.top: { search, langSwitcher, themeToggle, sidebarVisible, anchors:[{id,enabled}] }
  //   nav.side: { items: [{id,enabled,order}] }
  let nav: ResolvedProfile['nav'] | undefined;
  const rawNav = raw['nav'];
  if (rawNav && typeof rawNav === 'object' && !Array.isArray(rawNav)) {
    const navObj = rawNav as Record<string, unknown>;
    nav = {};

    const rawTop = navObj['top'];
    if (Array.isArray(rawTop)) {
      // Legacy string-array format -- convert to rich format preserving order.
      nav.top = { anchors: rawTop.filter(v => typeof v === 'string').map(id => ({ id })) };
    } else if (rawTop && typeof rawTop === 'object') {
      const topObj = rawTop as Record<string, unknown>;
      const anchors: NavAnchorEntry[] = [];
      if (Array.isArray(topObj['anchors'])) {
        for (const a of topObj['anchors']) {
          if (a && typeof a === 'object') {
            const ao = a as Record<string, unknown>;
            if (typeof ao['id'] === 'string' && ao['id']) {
              anchors.push({ id: ao['id'], enabled: ao['enabled'] !== false });
            }
          }
        }
      }
      nav.top = {
        search:          topObj['search'] === true,
        langSwitcher:    topObj['langSwitcher'] === true,
        themeToggle:     topObj['themeToggle'] === true,
        sidebarVisible:  topObj['sidebarVisible'] !== false,
        anchors,
      };
    }

    const rawSide = navObj['side'];
    if (Array.isArray(rawSide)) {
      // Legacy string-array format.
      nav.side = rawSide
        .filter((v): v is string => typeof v === 'string')
        .map((id, i) => ({ id, order: i }));
    } else if (rawSide && typeof rawSide === 'object') {
      const sideObj = rawSide as Record<string, unknown>;
      const items = Array.isArray(sideObj['items']) ? sideObj['items'] : [];
      nav.side = (items as unknown[])
        .filter(v => v && typeof v === 'object')
        .map(v => {
          const vo = v as Record<string, unknown>;
          return {
            id:      typeof vo['id'] === 'string' ? vo['id'] : '',
            enabled: vo['enabled'] !== false,
            order:   typeof vo['order'] === 'number' ? vo['order'] : 0,
          };
        })
        .filter(v => Boolean(v.id));
    }
  }

  return {
    profileId,
    ...(variant !== undefined && { variant }),
    blocks,
    blockOptions,
    componentOptions,
    ...(nav !== undefined && { nav }),
  };
}
