// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4283 (b): the app rename of the Assess screen writes the app `.swao.yml`
// through the central minimal-patch writer. The former regular expressions
// rewrote the first `id:` line anywhere in the file (a regime or landing zone
// id under a nested block) and missed `app_id`, the key `swao init` and the
// app template write. Only top-level keys change: `app_id` and `id` when
// present, and `app_name` or `name` when they still mirror the old id.

import { load } from 'js-yaml';
import { patchSwaoYmlText, type SwaoYmlEdit } from '@swao/core';

export type RenameAppYmlResult = { ok: true; text: string; changed: boolean } | { ok: false; error: string };

export function renameAppYmlText(text: string, oldId: string, newId: string): RenameAppYmlResult {
  let doc: unknown;
  try { doc = load(text); } catch (err) {
    return { ok: false, error: `the app .swao.yml does not parse (${(err as Error).message.split('\n')[0]})` };
  }
  if (doc === null || doc === undefined) return { ok: true, text, changed: false };
  if (typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'the app .swao.yml is not a YAML mapping' };
  const d = doc as Record<string, unknown>;
  const edits: SwaoYmlEdit[] = [];
  for (const key of ['app_id', 'id']) if (key in d) edits.push({ path: [key], value: newId });
  for (const key of ['app_name', 'name']) if (d[key] === oldId) edits.push({ path: [key], value: newId });
  if (edits.length === 0) return { ok: true, text, changed: false };
  return patchSwaoYmlText(text, edits);
}
