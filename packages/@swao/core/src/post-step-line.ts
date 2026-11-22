// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core, the post-pass step lines of the assess command
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4498 (Design 126 section 4.6): after the last pass, `swao assess` runs its
// post-pass steps (run manifest, findings, the portfolio summary of every app,
// ...). Each step prints one line when it starts, and a long step prints its
// progress, so the run screen names the step instead of standing on the last
// pass: "[post] Portfolio summary" and "[post] Portfolio summary: 106 of 235 apps".
// The format and its one parser live here (as pass-marker.ts for the passes).

const PREFIX = '[post] ';

/** A post-pass step name in words: "portfolio_summary" reads "Portfolio summary". */
export function postStepLabel(name: string): string {
  const words = name.split('_').filter((w) => w.length > 0).join(' ');
  return words.length > 0 ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : name;
}

/** The line of a post-pass step, with its progress when known. */
export function formatPostStepLine(label: string, progress?: { done: number; total: number; noun: string }): string {
  return progress ? `${PREFIX}${label}: ${progress.done} of ${progress.total} ${progress.noun}` : `${PREFIX}${label}`;
}

export interface PostStepLine {
  label: string;
  done?: number;
  total?: number;
  noun?: string;
}

/** The last post-pass step line of a chunk of output, or null. String code, no regex on the line. */
export function parsePostStepLine(text: string): PostStepLine | null {
  let found: PostStepLine | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith(PREFIX)) continue;
    const body = line.slice(PREFIX.length).trim();
    const colon = body.lastIndexOf(': ');
    if (colon > 0) {
      const parts = body.slice(colon + 2).split(' ');
      const done = Number(parts[0]);
      const total = Number(parts[2]);
      if (parts.length >= 4 && parts[1] === 'of' && Number.isInteger(done) && Number.isInteger(total) && total > 0) {
        found = { label: body.slice(0, colon), done, total, noun: parts.slice(3).join(' ') };
        continue;
      }
    }
    if (body.length > 0) found = { label: body };
  }
  return found;
}
