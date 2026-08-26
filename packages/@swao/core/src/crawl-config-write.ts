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

// #0776-C: shared helper for writing the crawl section to an app .swao.yml.
//
// Credentials (URL, username, password) are stored ONLY in the SWAO credential
// vault (playwright-url-*, playwright-user-*, playwright-pass-*) -- never in
// the YAML config file.  buildCrawlConfig() bootstraps from the vault at
// assessment time.  writeCrawlSection() is kept for call-site compat but
// deliberately writes nothing sensitive to disk.
//
// Idempotency: the function is a no-op on every call (kept for compat only).

export interface CrawlSectionInput {
  // Intentionally empty. Credentials and URL go to the credential vault.
  // Kept for backwards-compatible call sites in AssessScreen.tsx.
}

/**
 * No-op stub kept for call-site backwards compatibility.
 *
 * All crawl credentials (URL, username, password) are stored in the SWAO
 * credential vault by AssessScreen.tsx, never in .swao.yml.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function writeCrawlSection(_appYmlPath: string, _crawl: CrawlSectionInput = {}): void {
  // Nothing written to YAML -- vault is the sole source of crawl credentials.
}
