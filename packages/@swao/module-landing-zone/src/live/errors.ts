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

// #3572: a list method that the scope cannot serve (missing permission, API
// error, no verified API) throws this error; the scan assembler (scan.ts)
// records it as `sources[{name, status: not_collected, http_status | reason}]`
// and carries on, so a gap is visible and never an empty success (Design 120
// section 7.1, ADR-0041).

export class LiveSourceUnavailableError extends Error {
  constructor(readonly source: string, readonly httpStatus?: number, readonly why?: string) {
    super(`[lz live] source ${source} not collected (${httpStatus !== undefined ? `HTTP ${httpStatus}` : why ?? 'no reason given'})`);
    this.name = 'LiveSourceUnavailableError';
  }
}

/** Authentication failed (wrong login, locked user, MFA required); stops the run. */
export class LiveAuthError extends Error {
  readonly exitCode = 1;
  constructor(readonly provider: string, readonly httpStatus: number, detail: string) {
    super(`[lz live] ${provider}: authentication failed (HTTP ${httpStatus}): ${detail}`);
    this.name = 'LiveAuthError';
  }
}
