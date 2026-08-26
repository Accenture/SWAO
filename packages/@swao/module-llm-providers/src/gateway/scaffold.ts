// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- workspace gateway scaffold (#1403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const README = `# LLM-Gateway connectors (this workspace)

Drop ONE YAML file per LLM platform here. Connectors placed in this folder
override bundled connectors with the same id and are discovered
automatically by \`swao setup\`, the assess TUI, and \`swao assess --llm\`.

Quick start:
1. Copy _template.yaml (or any bundled connector) to <your-id>.yaml.
2. Amend id, name, protocol, base_url, auth, and models.default.
3. Re-run setup -- your platform appears in the LLM selection.

Rules:
- NEVER put key material in a connector file. auth names WHERE the key
  lives (SWAO credential store entry and/or environment variable); SWAO
  refuses files containing secret-shaped values.
- Files starting with an underscore are ignored by discovery.
- Verify connectors with \`swao doctor\` (probe 14/14, LLM gateway).

Documentation: https://accenture.github.io/SWAO/en/
`;

const TEMPLATE_FALLBACK = `schema_version: "1.0"
connector:
  id: my-platform
  name: My LLM Platform
  protocol: openai-chat
  base_url: https://llm.example.internal
  auth:
    credential_key: my-platform-api-key
    env_var: SWAO_MY_PLATFORM_API_KEY
  models:
    default: my-model
  defaults:
    temperature: 0
  meta:
    source: user
`;

function findBundledTemplate(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '_llm-gateway/_template.yaml'),
    resolve(here, '../_llm-gateway/_template.yaml'),
    resolve(here, '../../../../../llm-gateway/_template.yaml'),
    resolve(here, '../../../../llm-gateway/_template.yaml'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return readFileSync(c, 'utf-8');
    } catch { /* try next */ }
  }
  return undefined;
}

/**
 * Materialise a connector file into the workspace gateway folder (#1400,
 * operator decision 2026-08-06): when the user SELECTS a connector, its file
 * is copied into wsp/inputs/llm-gateway/<id>.yaml as a RAW byte copy
 * (comments preserved) so the operator can see and edit exactly what runs.
 * Workspace files override bundled seeds, so subsequent edits take effect.
 * Idempotent: an existing workspace file is never overwritten.
 * Returns the destination path, or undefined when nothing was written.
 */
export function copyConnectorToWorkspace(
  workspaceRoot: string,
  connectorSourcePath: string,
  connectorId: string,
): string | undefined {
  const dir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${connectorId}.yaml`);
  if (existsSync(dest)) return undefined; // user copy exists -- never clobber edits
  try {
    writeFileSync(dest, readFileSync(connectorSourcePath, 'utf-8'), 'utf-8');
    return dest;
  } catch {
    return undefined;
  }
}

/**
 * Scaffold <workspace>/wsp/inputs/llm-gateway/ with the copy/paste template
 * and a README. Idempotent: existing files are never overwritten.
 * Returns the list of files written.
 */
export function scaffoldWorkspaceGateway(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  const templatePath = join(dir, '_template.yaml');
  if (!existsSync(templatePath)) {
    writeFileSync(templatePath, findBundledTemplate() ?? TEMPLATE_FALLBACK, 'utf-8');
    written.push(templatePath);
  }
  const readmePath = join(dir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README, 'utf-8');
    written.push(readmePath);
  }
  return written;
}
