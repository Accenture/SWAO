// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3886 (Design 123 section 5.7, D-13): each driver's ROLES.md holds a
// read-call coverage list under the heading `## Read-call coverage`: one row
// per relevant read call with the data products it feeds, whether the driver
// uses it, and the reason when it does not. This parser is the boundary
// between that document and the tests that pin the list against the calls
// the driver makes (Zod, CLAUDE.md section 5.5).

import { z } from 'zod';

export const COVERAGE_HEADING = '## Read-call coverage';

/** Data products of Design 120 section 5.1 and Design 123 (plus the probe and the login). */
export const CoverageFeedSchema = z.enum(['auth', 'probe', 'offering', 'estate', 'posture', 'hierarchy', 'pass23']);
export type CoverageFeed = z.infer<typeof CoverageFeedSchema>;

/**
 * `yes`: the driver calls it. `planned`: a sprint issue adds it (the reason
 * names the issue). `no`: relevant but not used, with one of the reasons of
 * Design 123 section 5.7 (not readable with the login, no data in the test
 * tenant, outside the read-only allow-list).
 */
export const CoverageUseSchema = z.enum(['yes', 'planned', 'no']);

export const CoverageRowSchema = z.object({
  /** `GET /v3/{project_id}/trackers` (route template) or `ec2:DescribeRegions` (AWS operation). */
  call: z.string().regex(/^((GET|HEAD|POST) \/\S*|[a-z0-9-]+:[A-Z][A-Za-z0-9]+)$/, { message: 'a read call is `<METHOD> /<route>` or `<api>:<Operation>`' }),
  feeds: z.array(CoverageFeedSchema).min(1),
  used: CoverageUseSchema,
  reason: z.string(),
}).strict().superRefine((r, ctx) => {
  if (r.used === 'planned' && !/#\d{4}/.test(r.reason)) ctx.addIssue({ code: 'custom', path: ['reason'], message: `${r.call}: a planned call names its issue (#NNNN)` });
  if (r.used === 'no' && r.reason.trim().length < 10) ctx.addIssue({ code: 'custom', path: ['reason'], message: `${r.call}: an unused relevant call needs a recorded reason` });
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const unquote = (c: string): string => c.replace(/^`|`$/g, '');

/** Parse the coverage table of a ROLES.md; throws when the section or a row is malformed or a call repeats. */
export function parseCoverageList(markdown: string): CoverageRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(COVERAGE_HEADING));
  if (start < 0) throw new Error(`no "${COVERAGE_HEADING}" section`);
  const rows: CoverageRow[] = [];
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    const c = cells(line);
    if (!inTable) {
      if (c[0] !== 'Read call' || c[1] !== 'Feeds' || c[2] !== 'Used' || c[3] !== 'Reason when not used') throw new Error(`coverage table header must be | Read call | Feeds | Used | Reason when not used |, got ${line}`);
      inTable = true;
      continue;
    }
    if (/^-+$/.test((c[0] ?? '').replace(/:/g, ''))) continue;
    const parsed = CoverageRowSchema.safeParse({
      call: unquote(c[0] ?? ''),
      feeds: (c[1] ?? '').split(',').map((f) => f.trim()).filter((f) => f !== ''),
      used: c[2],
      reason: c[3] === '-' ? '' : (c[3] ?? ''),
    });
    if (!parsed.success) throw new Error(`coverage row ${i + 1}: ${parsed.error.issues.map((x) => x.message).join('; ')}`);
    if (rows.some((r) => r.call === parsed.data.call)) throw new Error(`coverage row ${i + 1}: ${parsed.data.call} is listed twice`);
    rows.push(parsed.data);
  }
  if (rows.length === 0) throw new Error('the coverage table has no rows');
  return rows;
}
