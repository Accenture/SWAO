// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- SWAO LLM-Gateway connector loader
//  (Design 090 Section 6.1, #1395)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConnectorYaml, type ConnectorFile } from './connector-schema.js';

/**
 * Multi-candidate connector directory resolution (Design 090 Section 5;
 * mirrors the LZ-catalogue loader and the #1380 lesson: the pkg-bundle
 * candidate MUST be present and packaged-binary verified).
 *
 * Precedence -- FIRST directory containing a given connector id wins:
 *   1. explicit override (tests / advanced callers)
 *   2. <workspaceRoot>/wsp/inputs/llm-gateway   (user copy/paste/amend)
 *   3. <bundle dir>/_llm-gateway                (pkg binary: build-lib copies here)
 *   4. <repo>/swao/llm-gateway                  (monorepo dev + module dist)
 */
function candidateDirs(override?: string, workspaceRoot?: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // bundle: dist/; dev: src|dist/gateway
  return [
    override,
    workspaceRoot ? join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway') : undefined,
    resolve(here, '_llm-gateway'),                    // pkg binary: dist/_llm-gateway
    resolve(here, '../_llm-gateway'),                 // safety: one up from gateway/
    resolve(here, '../../../../../llm-gateway'),      // dev: src|dist/gateway -> swao/llm-gateway
    resolve(here, '../../../../llm-gateway'),         // safety fallback
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export interface LoadedConnector {
  file: ConnectorFile;
  /** Absolute path of the YAML file the connector was loaded from. */
  path: string;
  /** 'workspace' when loaded from the workspace dir, 'bundled' otherwise. */
  origin: 'workspace' | 'bundled';
}

export interface ListConnectorsResult {
  connectors: LoadedConnector[];
  /** Human-readable skip reasons for invalid files -- never fatal. */
  warnings: string[];
}

function isWorkspaceDir(dir: string, workspaceRoot?: string): boolean {
  if (!workspaceRoot) return false;
  return resolve(dir) === resolve(join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway'));
}

/**
 * Enumerate all valid connectors across the candidate directories.
 * First-writer wins per connector id in candidate order, so a workspace
 * connector overrides a bundled seed with the same id. Invalid files are
 * skipped with a warning naming file and reason.
 */
export function listConnectors(opts?: { workspaceRoot?: string; overrideDir?: string }): ListConnectorsResult {
  const byId = new Map<string, LoadedConnector>();
  const warnings: string[] = [];

  for (const dir of candidateDirs(opts?.overrideDir, opts?.workspaceRoot)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir).filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const fullPath = join(dir, entry);
      let text: string;
      try {
        text = readFileSync(fullPath, 'utf-8');
      } catch (err) {
        warnings.push(`${fullPath}: unreadable -- ${String(err instanceof Error ? err.message : err)}`);
        continue;
      }
      const parsed = parseConnectorYaml(text, entry);
      if (!parsed.ok) {
        warnings.push(parsed.error);
        continue;
      }
      const id = parsed.file.connector.id;
      if (byId.has(id)) continue; // earlier candidate (higher precedence) wins
      byId.set(id, {
        file: parsed.file,
        path: fullPath,
        origin: isWorkspaceDir(dir, opts?.workspaceRoot) || dir === opts?.overrideDir ? 'workspace' : 'bundled',
      });
    }
  }

  return {
    connectors: [...byId.values()].sort((a, b) => a.file.connector.id.localeCompare(b.file.connector.id)),
    warnings,
  };
}

/** Resolve one connector by id, or undefined when unknown. */
export function getConnector(
  id: string,
  opts?: { workspaceRoot?: string; overrideDir?: string },
): LoadedConnector | undefined {
  return listConnectors(opts).connectors.find(c => c.file.connector.id === id);
}
