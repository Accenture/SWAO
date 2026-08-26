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
 * Assessment-type router (#0554).
 *
 * `swao assess` supports multiple assessment types (ADR-0039 amendment 3,
 * ADR-0047). Each type is owned by a module that registers an
 * AssessmentTypeContribution. This router is the central dispatch mechanism:
 * it normalises the requested type (default + deprecated-alias handling),
 * looks up the registered contribution, applies the coming-soon guard, and
 * raises a clear error listing the registered types when the request is
 * unknown.
 *
 * The router does not own the application-assessment run loop: the LLM
 * provider factory and WSP I/O live in @swao/swao's assess command, which
 * drives the `type: application` pipeline directly. The router gates which
 * type runs and surfaces coming-soon / unknown-type outcomes uniformly.
 */

import type { AssessmentType, AssessmentTypeContribution } from './plugin-types.js';

/** The full set of assessment-type values SWAO recognises. Used to tell an
 *  unknown type ("workshop") apart from a known-but-unregistered one ("audit",
 *  which surfaces a coming-soon notice rather than an error). */
export const KNOWN_ASSESSMENT_TYPES: readonly AssessmentType[] = [
  'application',
  'audit',
  'landing-zone-catalog',
  'landing-zone-customer',
  'hybrid',
  'llm',
];

/** The default assessment type when `.swao.yml` and `--type` are both silent. */
export const DEFAULT_ASSESSMENT_TYPE: AssessmentType = 'application';

/** Deprecated `assessment.type` values normalised to a canonical type at parse
 *  time (ADR-0039 amendment 3). `source-code` predates the modular vocabulary;
 *  it described the evidence technique rather than the subject. Removed at
 *  v2.0.0. */
const DEPRECATED_TYPE_ALIASES: Readonly<Record<string, AssessmentType>> = {
  'source-code': 'application',
  // Design 049 named the human audit type `human`; the canonical value is
  // `audit` (ADR-0039 amendment 4, #0559). Accepted as a deprecated alias.
  human: 'audit',
  // ADR-0051: `landing-zone` is the deprecated token; canonical is
  // `landing-zone-catalog`. Alias retained until v2.0.0 for .swao.yml compat.
  'landing-zone': 'landing-zone-catalog',
};

/** Coming-soon notices for known types that have no registered contribution
 *  yet. A module that ships the type later overrides this by registering a
 *  real (non-comingSoon) contribution. */
const DEFAULT_COMING_SOON: Readonly<Partial<Record<AssessmentType, string>>> = {
  audit: 'Assessment type "audit" (controls + evidence audit) is coming soon.',
  'landing-zone-catalog': 'Assessment type "landing-zone-catalog" (CSP service catalog fit/gap) is coming soon.',
  'landing-zone-customer': 'Assessment type "landing-zone-customer" (customer landing zone) is coming soon.',
  hybrid: 'Assessment type "hybrid" (combined source + human evidence) is coming soon.',
  llm: 'Assessment type "llm" (LLM Assessment for SWAO, Design 092) requires @swao/module-llm-assessment; this build has no registered engine for it.',
};

export class UnknownAssessmentTypeError extends Error {
  constructor(
    readonly requested: string,
    readonly registered: AssessmentType[],
  ) {
    super(
      `Unknown assessment type "${requested}". ` +
        `Recognised types: ${KNOWN_ASSESSMENT_TYPES.join(', ')}. ` +
        `Registered (runnable now): ${registered.length > 0 ? registered.join(', ') : '(none)'}.`,
    );
    this.name = 'UnknownAssessmentTypeError';
  }
}

/** The outcome of routing a requested assessment type. */
export type AssessmentRouteDecision =
  | { kind: 'run'; type: AssessmentType; contribution: AssessmentTypeContribution }
  | { kind: 'coming-soon'; type: AssessmentType; message: string };

export class AssessmentTypeRouter {
  private readonly registry = new Map<AssessmentType, AssessmentTypeContribution>();

  /** Register an AssessmentTypeContribution. A later registration for the same
   *  type overrides an earlier one (lets a real module override a placeholder). */
  register(contribution: AssessmentTypeContribution): void {
    this.registry.set(contribution.type, contribution);
  }

  /** Register every assessmentTypes contribution from a module's manifest. */
  registerAll(contributions: AssessmentTypeContribution[] | undefined): void {
    for (const c of contributions ?? []) this.register(c);
  }

  /** Types with a registered, runnable (non-coming-soon) contribution. */
  registeredTypes(): AssessmentType[] {
    return [...this.registry.entries()]
      .filter(([, c]) => !c.comingSoon)
      .map(([t]) => t);
  }

  /**
   * Normalise a raw `assessment.type` / `--type` value to a canonical type.
   * Empty / undefined defaults to {@link DEFAULT_ASSESSMENT_TYPE}. Deprecated
   * aliases are mapped. Throws {@link UnknownAssessmentTypeError} for a value
   * that is not a recognised type.
   */
  normalizeType(raw?: string | null): AssessmentType {
    const trimmed = (raw ?? '').trim().toLowerCase();
    if (trimmed === '') return DEFAULT_ASSESSMENT_TYPE;
    const aliased = DEPRECATED_TYPE_ALIASES[trimmed];
    if (aliased) return aliased;
    if ((KNOWN_ASSESSMENT_TYPES as readonly string[]).includes(trimmed)) {
      return trimmed as AssessmentType;
    }
    throw new UnknownAssessmentTypeError(trimmed, this.registeredTypes());
  }

  /**
   * Resolve a requested type to a route decision. A registered, runnable
   * contribution yields `kind: 'run'`. A registered coming-soon contribution,
   * or a known type with no registration, yields `kind: 'coming-soon'`. An
   * unknown type throws {@link UnknownAssessmentTypeError}.
   */
  route(raw?: string | null): AssessmentRouteDecision {
    const type = this.normalizeType(raw);
    const contribution = this.registry.get(type);
    if (contribution && !contribution.comingSoon) {
      return { kind: 'run', type, contribution };
    }
    const message =
      contribution?.description ??
      DEFAULT_COMING_SOON[type] ??
      `Assessment type "${type}" is coming soon.`;
    return { kind: 'coming-soon', type, message };
  }
}
