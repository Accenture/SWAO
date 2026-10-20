// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Read and write research stubs: YAML front-matter + Markdown body (Design 103 §4.4).
 * On rewrite only the front-matter and the text between the generated markers
 * change; anything an analyst wrote outside the markers is kept.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';

export const GENERATED_START = '<!-- swao:generated:start -->';
export const GENERATED_END = '<!-- swao:generated:end -->';

export interface StubFile {
  front: Record<string, unknown>;
  body: string;
}

export function parseStub(text: string): StubFile | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  try {
    const front = load(m[1] as string);
    if (!front || typeof front !== 'object') return null;
    return { front: front as Record<string, unknown>, body: m[2] ?? '' };
  } catch {
    return null;
  }
}

export function readStub(path: string): StubFile | null {
  if (!existsSync(path)) return null;
  try {
    return parseStub(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Replace the generated section of `body` (or append one), keeping analyst text outside the markers. */
export function mergeBody(existing: string | null, generated: string): string {
  const block = `${GENERATED_START}\n${generated.trimEnd()}\n${GENERATED_END}`;
  if (!existing || !existing.trim()) return `${block}\n`;
  const start = existing.indexOf(GENERATED_START);
  const end = existing.indexOf(GENERATED_END);
  if (start >= 0 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + GENERATED_END.length);
  }
  return `${block}\n\n${existing.trimStart()}`;
}

export function writeStub(path: string, front: Record<string, unknown>, generatedBody: string, existingBody: string | null): void {
  const yaml = dump(front, { lineWidth: -1, noRefs: true, sortKeys: false });
  writeFileSync(path, `---\n${yaml}---\n${mergeBody(existingBody, generatedBody)}`, 'utf-8');
}
