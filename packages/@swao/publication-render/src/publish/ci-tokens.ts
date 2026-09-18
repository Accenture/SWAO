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
 * CI/branding token store (D1 -- #0930).
 *
 * Reads `wsp/templates/styles/ci.yaml`, validates that every key is a known
 * Tier 1 CSS custom-property name (Design 068 §20.10.1), and builds the
 * `<style id="swao-ci-tokens">` block that is injected into the publication
 * head BEFORE `swao-pub.css` so client brand overrides cascade correctly.
 *
 * YAML schema:
 *   # flat top-level = light-mode overrides
 *   --brand-accent: "#ff0000"
 *   # nested dark: key = dark-mode overrides
 *   dark:
 *     --bg-primary: "#1e293b"
 */

import { readFileSync } from 'fs';
import { load as loadYaml } from 'js-yaml';

// ---------------------------------------------------------------------------
// Valid Tier 1 token names (Design 068 §20.10.1)
// ---------------------------------------------------------------------------

export const TIER1_TOKENS = [
  '--brand-primary',
  '--brand-accent',
  '--brand-accent-rgb',
  '--rag-fail',
  '--rag-partial',
  '--rag-pass',
  '--rag-info',
  '--rag-positive',
  '--sev-critical',
  '--sev-high',
  '--sev-medium',
  '--sev-low',
  '--sev-info',
  '--sev-positive',
  '--bg-primary',
  '--bg-secondary',
  '--bg-dark',
  '--bg-overlay',
  '--font-heading',
  '--font-body',
  '--font-mono',
  '--font-size-base',
  '--font-size-sm',
  '--font-size-xs',
  '--line-height-base',
  '--line-height-tight',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-pill',
  '--shadow-sm',
  '--shadow-md',
] as const;

export type Tier1TokenName = (typeof TIER1_TOKENS)[number];

const TIER1_SET: ReadonlySet<string> = new Set<string>(TIER1_TOKENS);

export interface CiTokens {
  light: Record<string, string>;
  dark:  Record<string, string>;
}

// ---------------------------------------------------------------------------
// Reader + validator
// ---------------------------------------------------------------------------

function validateTokenMap(map: Record<string, string>, context: string): void {
  for (const key of Object.keys(map)) {
    if (!TIER1_SET.has(key)) {
      throw new Error(
        `[swao publish] ci.yaml: unknown token "${key}" in ${context} -- ` +
        `valid tokens are: ${TIER1_TOKENS.join(', ')}`,
      );
    }
  }
}

/**
 * Read and validate a ci.yaml file. Returns structured light + dark token maps.
 * Throws on file read errors, YAML parse errors, or unknown token names.
 */
export function readCiTokens(path: string): CiTokens {
  const content = readFileSync(path, 'utf-8');
  // js-yaml 5 throws YAMLException for comment-only input rather than returning null.
  // Strip comment-only lines before the emptiness check to avoid coupling to the exception message.
  const stripped = content.replace(/^\s*#[^\n]*(\n|$)/gm, '').trim();
  if (stripped === '') {
    return { light: {}, dark: {} };
  }
  const raw = loadYaml(content) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    return { light: {}, dark: {} };
  }

  const darkRaw = raw['dark'];
  const darkMap: Record<string, string> = {};
  if (darkRaw && typeof darkRaw === 'object' && !Array.isArray(darkRaw)) {
    for (const [k, v] of Object.entries(darkRaw as Record<string, unknown>)) {
      darkMap[k] = String(v);
    }
  }

  const lightMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'dark') continue;
    lightMap[k] = String(v);
  }

  validateTokenMap(lightMap, 'root');
  validateTokenMap(darkMap, 'dark:');

  return { light: lightMap, dark: darkMap };
}

// ---------------------------------------------------------------------------
// Style block builder
// ---------------------------------------------------------------------------

function renderTokenMap(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
}

/**
 * Build the `<style id="swao-ci-tokens">` HTML block from validated CI tokens.
 * Returns an empty string when both light and dark maps are empty.
 */
export function buildCiTokenStyleBlock(tokens: CiTokens): string {
  const hasLight = Object.keys(tokens.light).length > 0;
  const hasDark  = Object.keys(tokens.dark).length > 0;
  if (!hasLight && !hasDark) return '';

  const parts: string[] = ['<style id="swao-ci-tokens">'];
  if (hasLight) {
    parts.push(`:root {\n${renderTokenMap(tokens.light)}\n}`);
  }
  if (hasDark) {
    parts.push(`.dark :root {\n${renderTokenMap(tokens.dark)}\n}`);
  }
  parts.push('</style>');
  return parts.join('\n');
}
