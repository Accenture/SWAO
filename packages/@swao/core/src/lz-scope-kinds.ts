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

/**
 * #4299 (Design 120 section 5.2): the two landing zone scope kinds by their
 * operator names, with a one-line definition each. The kind id (`platform`,
 * `application`) stays the machine key in `.swao.yml` and the WSP; every TUI
 * and CLI label of a kind comes from here (Landing Zone Connections, the
 * Landing Zone Live Assessment scope picker), so a kind reads the same everywhere.
 */
export type LzScopeKind = 'platform' | 'application';

export const LZ_SCOPE_KIND_LABELS: Readonly<Record<LzScopeKind, string>> = Object.freeze({
  platform: 'Platform landing zone (PLZ)',
  application: 'Application landing zone (ALZ)',
});

export const LZ_SCOPE_KIND_DEFINITIONS: Readonly<Record<LzScopeKind, string>> = Object.freeze({
  platform: "The provider's platform or organisation level, for example the OTC domain or the AWS management account; at most one per landing zone.",
  application: 'One application project, subscription or account inside the landing zone.',
});

/** The label of a stored scope kind; an unknown kind is shown as it is. */
export function lzScopeKindLabel(kind: string): string {
  return kind === 'platform' || kind === 'application' ? LZ_SCOPE_KIND_LABELS[kind] : kind;
}
