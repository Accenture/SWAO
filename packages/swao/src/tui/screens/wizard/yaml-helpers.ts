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

// YAML mutation helpers for the SetupWizard -- write LLM provider selections
// into the workspace .swao.yml without touching other configuration blocks.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { listConnectors, type LoadedConnector } from '@swao/module-llm-providers';
import type { LlmProvider } from './shared.js';

// #2886: infer the gateway connector id from the base URL provided by the user.
// loopback addresses -> vllm-generic (local unauthenticated vLLM instance)
// everything else   -> open-llm     (remote HTTPS endpoint with bearer token)
export function inferOpenLlmConnectorId(baseUrl: string): 'vllm-generic' | 'open-llm' {
  try {
    const { hostname } = new URL(baseUrl);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'vllm-generic';
  } catch { /* malformed URL -- treat as remote */ }
  return 'open-llm';
}

// #3438: compare base URLs ignoring case, trailing slashes and a trailing /v1.
function normaliseBaseUrl(u: string): string {
  const trimmed = u.trim();
  try {
    const url = new URL(trimmed);
    const path = trimTrailingSlashes(url.pathname).replace(/\/v1$/, '');
    return `${url.protocol}//${url.host}${path}`.toLowerCase();
  } catch {
    return trimTrailingSlashes(trimmed).replace(/\/v1$/, '').toLowerCase();
  }
}

/** Removes trailing slashes by index (linear; a regular expression here backtracks on long slash runs). */
function trimTrailingSlashes(s: string): string {
  let e = s.length;
  while (e > 0 && s[e - 1] === '/') e--;
  return s.slice(0, e);
}

// #3438: only the connector id of each LLM slot is read from .swao.yml here.
const LlmSlotSchema = z.object({ connector: z.string().optional() }).nullish();
const SwaoYmlLlmSlotsSchema = z.object({
  providers: z.object({
    llm: z.object({ primary: LlmSlotSchema, secondary: LlmSlotSchema }).nullish(),
  }).nullish(),
});

function readConfiguredConnectorId(workDir: string, slot: 'primary' | 'secondary'): string | undefined {
  try {
    const parsed = SwaoYmlLlmSlotsSchema.safeParse(yamlLoad(readFileSync(join(workDir, '.swao.yml'), 'utf-8')));
    return parsed.success ? parsed.data.providers?.llm?.[slot]?.connector : undefined;
  } catch {
    return undefined;
  }
}

function connectorBaseUrls(c: LoadedConnector['file']['connector']): string[] {
  const envUrls = Object.values(c.environments ?? {})
    .map(e => e.base_url)
    .filter((u): u is string => typeof u === 'string');
  return [c.base_url, ...envUrls];
}

/**
 * #3438: pick the connector id for the "Open LLM Provider (custom endpoint)"
 * path. Previously this always fell back to the generic `open-llm` /
 * `vllm-generic` seed, so re-entering the URL of an endpoint that already had
 * its own workspace connector (for example one with `tls.reject_unauthorized:
 * false` or `tls.ca_bundle`) silently re-pointed .swao.yml at a connector with
 * no tls block; the eager write at the LLM step survived a later wizard abort.
 * An existing openai-chat workspace connector serving the same base URL is now
 * kept: the one already configured in this slot first, then any one that
 * declares a tls block. Otherwise the #2886 inference applies unchanged.
 */
export function resolveOpenLlmConnectorId(
  workDir: string,
  baseUrl: string,
  slot: 'primary' | 'secondary',
): string {
  const fallback = inferOpenLlmConnectorId(baseUrl);
  let connectors: LoadedConnector[];
  try {
    connectors = listConnectors({ workspaceRoot: workDir }).connectors;
  } catch {
    return fallback;
  }
  const target = normaliseBaseUrl(baseUrl);
  const matches = connectors.filter(c =>
    c.file.connector.protocol === 'openai-chat' &&
    connectorBaseUrls(c.file.connector).some(u => normaliseBaseUrl(u) === target));
  if (matches.length === 0) return fallback;
  const current = readConfiguredConnectorId(workDir, slot);
  const keep = (current ? matches.find(c => c.file.connector.id === current) : undefined)
    ?? matches.find(c => c.file.connector.tls !== undefined);
  return keep ? keep.file.connector.id : fallback;
}

// #2746: detect the actual indentation of the `primary:` key in the YAML file.
// Templates may use 2- or 4-spaces-per-level; the hardcoded 6-space child prefix
// was wrong whenever the template used 4-space-per-level indentation.
function detectPrimaryIndent(yaml: string): string {
  return yaml.match(/^( +)primary:\n/m)?.[1] ?? '    ';
}

// Re-indent an llmBlock (built with 6-space child prefix) to the actual child indent.
function reindentBlock(block: string, childIndent: string): string {
  return block.replace(/^ {6}/gm, childIndent);
}

export function writeLlmToYaml(
  workDir: string,
  provider: LlmProvider,
  model: string,
  endpoint: string,
  openLlmBase: string,
): void {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return;
  try {
    let yaml = readFileSync(yamlPath, 'utf-8');
    let llmBlock = '';
    if (provider.startsWith('gw:')) {
      // #1400: SWAO LLM-Gateway connector selection (Design 090). Endpoint,
      // auth, protocol, and cost all come from the connector file.
      llmBlock = `      connector: ${provider.slice(3)}\n      model: ${model}\n      temperature: 0`;
    } else if (provider === 'anthropic') {
      llmBlock = `      type: anthropic\n      model: ${model}\n      temperature: 0\n      max_tokens: 32768`;
    } else if (provider === 'openai') {
      llmBlock = `      type: openai\n      model: ${model}\n      temperature: 0`;
    } else if (provider === 'ollama') {
      llmBlock = `      type: ollama\n      endpoint: "${endpoint}"\n      model: ${model}`;
    } else if (provider === 'open-llm-provider') {
      // #2886: gateway connector path -- loopback -> vllm-generic, remote HTTPS -> open-llm.
      // Bearer token stored in credential store -- never written to .swao.yml (Design 082 D-04).
      // #3438: an existing workspace connector for the same URL (and its tls block) is kept.
      const connectorId = resolveOpenLlmConnectorId(workDir, openLlmBase, 'primary');
      llmBlock = `      connector: ${connectorId}\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
    } else {
      return; // skip -- leave as ~
    }
    // #0405 (sprint-040 round-5): the previous regex `      type: ~\n      model: ~`
    // only matched the virgin template. Re-running Setup on an already-
    // configured workspace silently dropped the new LLM choice because
    // the regex no longer matched (the yaml now had `type: openai` etc.).
    // Match the WHOLE primary: block instead (every line indented with
    // childIndent+ spaces, until the next outdented sibling under providers:).
    // Idempotent: virgin yaml has just `type: ~\n      model: ~` which
    // will be replaced cleanly regardless of indentation style.
    //
    // #2746: detect actual indentation -- templates may use 2- or 4-spaces per
    // level, so childIndent must be derived from the file, not hardcoded.
    const primaryIndent = detectPrimaryIndent(yaml);
    const childIndent   = primaryIndent + '  ';
    const indentedBlock = reindentBlock(llmBlock, childIndent);
    const primaryBlockRe = new RegExp(`(${primaryIndent}primary:\\n)(?:${childIndent}[^\\n]*\\n?)+`);
    if (primaryBlockRe.test(yaml)) {
      yaml = yaml.replace(primaryBlockRe, `$1${indentedBlock}\n`);
    } else {
      // Defensive: if the providers.llm.primary: block is missing, fall
      // back to the legacy virgin-template replace.
      yaml = yaml.replace(/ +type: ~\n +model: ~/, indentedBlock);
    }
    writeFileSync(yamlPath, yaml, 'utf-8');
  } catch { /* non-fatal */ }
}

// #2815: write assessment.vision_max_screens to .swao.yml.
// If an `assessment:` block already exists, updates the field.
// Otherwise appends the block at the end of the file.
export function writeVisionMaxScreensToYaml(workDir: string, maxScreens: number): void {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return;
  try {
    let yaml = readFileSync(yamlPath, 'utf-8');
    const valueStr = `assessment:\n  vision_max_screens: ${maxScreens}\n`;
    if (/^assessment:/m.test(yaml)) {
      // Replace or insert the vision_max_screens line inside the existing block.
      if (/^ {2}vision_max_screens: \d+/m.test(yaml)) {
        yaml = yaml.replace(/^ {2}vision_max_screens: \d+/m, `  vision_max_screens: ${maxScreens}`);
      } else {
        yaml = yaml.replace(/^(assessment:\n)/m, `$1  vision_max_screens: ${maxScreens}\n`);
      }
    } else {
      // Remove existing commented-out assessment block before appending the live one.
      yaml = yaml.replace(/^# assessment:\n(?:^#.*\n)*/m, '');
      yaml = yaml.trimEnd() + '\n\n' + valueStr;
    }
    writeFileSync(yamlPath, yaml, 'utf-8');
  } catch { /* non-fatal */ }
}

// #3403: assessment.test_code.mode in the workspace .swao.yml (the CLI reads
// the app .swao.yml first, then this file). Line-based edit so comments
// survive. Inside the `assessment:` block an `exclude_test_code:` line is
// dropped (it would contradict the mode); an existing `test_code:` block gets
// its `mode:` line replaced or added; otherwise the block is created. 2-space
// indentation as in the SWAO templates (same as writeVisionMaxScreensToYaml).
export type WizardTestCodeMode = 'include' | 'tag' | 'exclude';

export function readTestCodeModeFromYaml(workDir: string): WizardTestCodeMode | undefined {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return undefined;
  try {
    const doc = yamlLoad(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown> | null;
    const a = doc?.['assessment'] as Record<string, unknown> | undefined;
    const mode = (a?.['test_code'] as Record<string, unknown> | undefined)?.['mode'];
    if (mode === 'include' || mode === 'tag' || mode === 'exclude') return mode;
    if (typeof a?.['exclude_test_code'] === 'boolean') return a['exclude_test_code'] ? 'exclude' : 'include';
  } catch { /* unreadable: no current value */ }
  return undefined;
}

export function writeTestCodeModeToYaml(workDir: string, mode: WizardTestCodeMode): void {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return;
  try {
    const lines = readFileSync(yamlPath, 'utf-8').replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex((l) => /^assessment:\s*(#.*)?$/.test(l));
    if (start < 0) {
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
      lines.push('', 'assessment:', '  test_code:', `    mode: ${mode}`, '');
      writeFileSync(yamlPath, lines.join('\n'), 'utf-8');
      return;
    }
    let end = start + 1;
    while (end < lines.length && (lines[end]!.trim() === '' || lines[end]!.startsWith(' '))) end++;
    const block = lines.slice(start + 1, end).filter((l) => !/^ {2}exclude_test_code:/.test(l));
    const tc = block.findIndex((l) => /^ {2}test_code:/.test(l));
    if (tc < 0) {
      block.unshift('  test_code:', `    mode: ${mode}`);
    } else if (/^ {2}test_code:\s*(#.*)?$/.test(block[tc]!)) {
      let i = tc + 1;
      let modeAt = -1;
      while (i < block.length && (block[i]!.startsWith('    ') || block[i]!.trim() === '')) {
        if (/^ {4}mode:/.test(block[i]!)) modeAt = i;
        i++;
      }
      if (modeAt >= 0) block[modeAt] = `    mode: ${mode}`;
      else block.splice(tc + 1, 0, `    mode: ${mode}`);
    } else {
      // Flow style (`test_code: { ... }`): rewrite as a block, keeping the patterns.
      const parsed = yamlLoad(block[tc]!.trim()) as { test_code?: Record<string, unknown> } | null;
      const keep = ['extra_patterns', 'keep_patterns']
        .filter((k) => Array.isArray(parsed?.test_code?.[k]))
        .map((k) => `    ${k}: ${JSON.stringify(parsed!.test_code![k])}`);
      block.splice(tc, 1, '  test_code:', `    mode: ${mode}`, ...keep);
    }
    lines.splice(start + 1, end - start - 1, ...block);
    writeFileSync(yamlPath, lines.join('\n'), 'utf-8');
  } catch { /* non-fatal */ }
}

// #1768: write providers.llm.secondary block to .swao.yml.
// Inserts a `secondary:` sibling of `primary:` under `providers.llm:`.
// If a secondary block already exists it is replaced. Mirrors writeLlmToYaml.
export function writeSecondaryLlmToYaml(
  workDir: string,
  provider: LlmProvider,
  model: string,
  endpoint: string,
  openLlmBase: string,
): void {
  const yamlPath = join(workDir, '.swao.yml');
  if (!existsSync(yamlPath)) return;
  try {
    let yaml = readFileSync(yamlPath, 'utf-8');
    let llmBlock = '';
    if (provider.startsWith('gw:')) {
      llmBlock = `      connector: ${provider.slice(3)}\n      model: ${model}\n      temperature: 0`;
    } else if (provider === 'anthropic') {
      llmBlock = `      type: anthropic\n      model: ${model}\n      temperature: 0\n      max_tokens: 32768`;
    } else if (provider === 'openai') {
      llmBlock = `      type: openai\n      model: ${model}\n      temperature: 0`;
    } else if (provider === 'ollama') {
      llmBlock = `      type: ollama\n      endpoint: "${endpoint}"\n      model: ${model}`;
    } else if (provider === 'open-llm-provider') {
      // #2886: gateway connector path -- loopback -> vllm-generic, remote HTTPS -> open-llm.
      // #3438: an existing workspace connector for the same URL (and its tls block) is kept.
      const connectorId = resolveOpenLlmConnectorId(workDir, openLlmBase, 'secondary');
      llmBlock = `      connector: ${connectorId}\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
    } else {
      return;
    }
    // Replace existing secondary: block if present, otherwise append after primary: block.
    // #2746: detect actual indentation to handle 2- or 4-space-per-level templates.
    const primaryIndent = detectPrimaryIndent(yaml);
    const childIndent   = primaryIndent + '  ';
    const indentedBlock = reindentBlock(llmBlock, childIndent);
    const secondaryBlockRe = new RegExp(`(${primaryIndent}secondary:\\n)(?:${childIndent}[^\\n]*\\n?)+`);
    if (secondaryBlockRe.test(yaml)) {
      yaml = yaml.replace(secondaryBlockRe, `$1${indentedBlock}\n`);
    } else {
      // Append secondary: after the primary: block closes (first line after the block
      // that is indented less than childIndent, i.e. back to primaryIndent or root).
      const primaryCloseRe = new RegExp(`(${primaryIndent}primary:\\n(?:(?:${childIndent}[^\\n]*\\n?))+)`);
      if (primaryCloseRe.test(yaml)) {
        yaml = yaml.replace(primaryCloseRe, `$1${primaryIndent}secondary:\n${indentedBlock}\n`);
      }
    }
    writeFileSync(yamlPath, yaml, 'utf-8');
  } catch { /* non-fatal */ }
}
