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

// #4430: the build that produced this program. Two builds of the same version
// (1.6.1) were indistinguishable in the owner UAT, so every bundle names its
// commit and build date.
//
// This file holds the SOURCE defaults (`commit: 'source'`). The bundle step
// (swao/packages/swao/scripts/build-lib.mjs, buildBundle) replaces the contents
// of this module's dist/build-info.js inside the bundle only, with the values
// resolved at build time (git short commit, dirty flag, UTC build date, release
// tag). No file on disk is rewritten, so `node dist/index.js` always reports
// "source" and never a stale stamp. Nothing here reads the environment at run
// time.
//
// Dev builds only (owner decision 2026-11-15): the stamp is shown and logged
// only when the bundle step sets `display: true`, which only
// scripts/build-dev-win.mjs does. Every other build (release, community CI,
// enterprise, consultant) is stamped with display false: the version line,
// the TUI header, the MCP welcome and the health check show the plain version,
// and no build_commit or build_date enters logs or manifests, so no private
// repository commit reaches a public build or its outputs. The audit gate
// tests/audit-gates/build-info-stamp.gate.mjs pins the stamp in the build
// scripts and that only build-dev-win.mjs turns the display on.

export interface BuildInfo {
  /** Short commit (8 hex) of the build, or "source" for an unbundled run. */
  commit: string;
  /** True when the build tree had uncommitted changes to tracked files. */
  dirty: boolean;
  /** UTC build date (YYYY-MM-DD), null for an unbundled run. */
  date: string | null;
  /** Release tag the build was made from (e.g. v1.6.1), else null. */
  tag: string | null;
  /** True only for a dev binary (build-dev-win.mjs): show and log the build. */
  display: boolean;
}

export const BUILD_INFO: BuildInfo = {
  commit: 'source',
  dirty: false,
  date: null,
  tag: null,
  display: false,
};

/** True when the build is shown and logged: a dev build, or an unbundled source run. */
export function buildShown(info: BuildInfo = BUILD_INFO): boolean {
  return info.display || info.commit === 'source';
}

/** The commit as recorded in logs and manifests: "4c8dd01e", "4c8dd01e-dirty" or "source". */
export function buildCommitLabel(info: BuildInfo = BUILD_INFO): string {
  return info.dirty && info.commit !== 'source' ? `${info.commit}-dirty` : info.commit;
}

/**
 * The build part of the version string: "4c8dd01e, 2026-11-14", for a release
 * build from a tag "4c8dd01e, v1.6.1", for an unbundled run "source";
 * null for a build that does not show its stamp (every non-dev bundle).
 */
export function buildTag(info: BuildInfo = BUILD_INFO): string | null {
  if (!buildShown(info)) return null;
  const commit = buildCommitLabel(info);
  const second = info.tag ?? info.date;
  return second ? `${commit}, ${second}` : commit;
}

/** Version plus build, e.g. "1.6.1 (4c8dd01e, 2026-11-14)". */
export function versionWithBuild(version: string, info: BuildInfo = BUILD_INFO): string {
  const tag = buildTag(info);
  return tag ? `${version} (${tag})` : version;
}

/**
 * The provenance fields every run log start event and run manifest carries next
 * to `swao_version` (#4430, additive WSP fields, run-manifest schema 1.7).
 */
export function buildProvenance(info: BuildInfo = BUILD_INFO): { build_commit?: string; build_date?: string | null } {
  if (!buildShown(info)) return {};
  return { build_commit: buildCommitLabel(info), build_date: info.date };
}
