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
import type { LlmProvider } from './shared.js';

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
      // Bearer token stored in credential store -- never written to .swao.yml (Design 082 D-04).
      llmBlock = `      type: open-llm-provider\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
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
      llmBlock = `      type: open-llm-provider\n      baseUrl: "${openLlmBase}"\n      model: ${model}\n      temperature: 0`;
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
