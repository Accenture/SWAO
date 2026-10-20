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
 * Default place of the service intake inside a workspace (#3211):
 * `<workspace>/wsp/inputs/service-intake/` holds the intake workbook and,
 * optionally, its column map. `swao service init` without `--from` (and the
 * TUI intake step) resolve the files from here. Never prompts: when the
 * folder is empty or ambiguous the caller gets an error naming what was found.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SERVICE_INTAKE_DIR = join('wsp', 'inputs', 'service-intake');

const WORKBOOK = /\.xlsx$/i;
const COLUMN_MAP = /column-?map.*\.ya?ml$|\.column-?map\.ya?ml$/i;
/** Excel lock files ("~$name.xlsx") left while the workbook is open in Excel. */
const OFFICE_LOCK = /^~\$/;

export class IntakeLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeLocationError';
  }
}

export interface ResolvedIntake {
  intakePath: string;
  /** Column map found next to the workbook, when exactly one exists. */
  mappingPath: string | null;
}

function filesIn(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => re.test(n) && !OFFICE_LOCK.test(n) && statSync(join(dir, n)).isFile())
    .sort();
}

export function serviceIntakeDir(workspacePath: string): string {
  return join(workspacePath, SERVICE_INTAKE_DIR);
}

/** The workbook (and optional column map) in `wsp/inputs/service-intake/`. */
export function resolveServiceIntake(workspacePath: string): ResolvedIntake {
  const dir = serviceIntakeDir(workspacePath);
  const workbooks = filesIn(dir, WORKBOOK);
  if (workbooks.length === 0) {
    throw new IntakeLocationError(`no intake workbook found: put one .xlsx file into ${dir}, or pass --from <xlsx>`);
  }
  if (workbooks.length > 1) {
    throw new IntakeLocationError(`${workbooks.length} workbooks in ${dir} (${workbooks.join(', ')}): keep one, or pass --from <xlsx>`);
  }
  const maps = filesIn(dir, COLUMN_MAP);
  return { intakePath: join(dir, workbooks[0] as string), mappingPath: maps.length === 1 ? join(dir, maps[0] as string) : null };
}
