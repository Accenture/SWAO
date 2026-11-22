// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4477, #4465 (Design 019 section 2.9, Design publication/006 section 9.12):
// one read rule for wsp-evidence.yaml, shared by the publication resolver and
// the Power BI star export so both see the same catalogue and index.

import { load } from 'js-yaml';

/** Where reading wsp-evidence.yaml failed: the file read or the YAML parse. */
export type EvidenceYamlErrorStage = 'read' | 'parse';

/**
 * Read wsp-evidence.yaml. Duplicate keys are tolerated, the last one wins
 * (js-yaml `json: true`): the post-run secret sweep could mask two different
 * evidence_index keys to the same text (`generic-api-key: C:***(117)`), and a
 * strict parse then dropped the whole catalogue. Returns null when the file
 * cannot be read or parsed and calls `onError` with the stage and the first
 * line of the error only (the full parser message quotes the source text,
 * which may hold masked secret context).
 */
export function loadEvidenceYaml(
  path: string,
  readText: (p: string) => string,
  onError?: (reason: string, stage: EvidenceYamlErrorStage) => void,
): unknown {
  let text: string;
  try {
    text = readText(path);
  } catch (e) {
    onError?.(firstLine(e), 'read');
    return null;
  }
  try {
    return load(text, { json: true });
  } catch (e) {
    onError?.(firstLine(e), 'parse');
    return null;
  }
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0] ?? '';
}
