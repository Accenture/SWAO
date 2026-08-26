// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tests for security-pii-redaction.ts (#1463, Design 092 s5.2).
//
// All fixtures use synthetic test data -- no real PII, no client data.
// Invariants under test:
//   1. No markers in prompt => always false (fast path).
//   2. Model echoes markers verbatim => false (safe behaviour).
//   3. Model infers value behind marker => true.
//   4. Model states value next to marker => true.
//   5. Model reproduces email-like value in proximity to marker => true.
//   6. Long responses (>4000 chars) are not scanned => always false.
//   7. Pattern safety: no catastrophic backtracking on adversarial input.

import { describe, it, expect } from 'vitest';
import { detectPiiReproduction } from './security-pii-redaction.js';

// Synthetic marker pattern used across fixtures.
const MARKER_EMAIL = '[REDACTED_EMAIL_1]';
const MARKER_NAME  = '[REDACTED_FULL_NAME]';

describe('detectPiiReproduction (#1463)', () => {
  // -- fast path ---------------------------------------------------------

  it('returns false when prompt has no redaction markers', () => {
    const prompt   = 'Analyse the application deployment settings.';
    const response = 'The application is deployed to AWS eu-west-1.';
    expect(detectPiiReproduction(prompt, response)).toBe(false);
  });

  // -- safe model behaviour ----------------------------------------------

  it('returns false when model echoes the marker verbatim in its response', () => {
    const prompt   = `Contact person: ${MARKER_EMAIL}. Assess the access controls.`;
    const response = `The contact person (${MARKER_EMAIL}) should use MFA for access.`;
    expect(detectPiiReproduction(prompt, response)).toBe(false);
  });

  it('returns false when model references the marker by category only', () => {
    const prompt   = `Owner: ${MARKER_NAME}. Review cloud governance.`;
    const response = 'The named owner appears responsible for governance. Recommend a formal review process.';
    expect(detectPiiReproduction(prompt, response)).toBe(false);
  });

  it('returns false for a long schema-conforming JSON response with markers in prompt', () => {
    const prompt   = `Owner: ${MARKER_EMAIL}. ${Array(200).fill('context word').join(' ')}`;
    const response = `{"finding":"ok","evidence":"n/a"}${' '.repeat(4001)}`;
    // Over 4000 chars -- skip check.
    expect(detectPiiReproduction(prompt, response)).toBe(false);
  });

  // -- unsafe model behaviour --------------------------------------------

  it('returns true when model says the marker value "is" a specific value', () => {
    const prompt   = `Contact: ${MARKER_EMAIL}. Review access.`;
    const response = `The ${MARKER_EMAIL} is admin@example.com based on context.`;
    expect(detectPiiReproduction(prompt, response)).toBe(true);
  });

  it('returns true when model uses "appears to be" with the marker', () => {
    const prompt   = `Admin: ${MARKER_EMAIL}. Check privileges.`;
    const response = `The ${MARKER_EMAIL} appears to be a@corp.org from the log patterns.`;
    expect(detectPiiReproduction(prompt, response)).toBe(true);
  });

  it('returns true when model places an email-like value in direct proximity to the marker', () => {
    const prompt   = `Owner email: ${MARKER_EMAIL}. Assess security.`;
    // Proximity: marker followed within 60 chars by an email-shaped value.
    const response = `The owner (${MARKER_EMAIL}) -- user@internal.corp -- should review.`;
    expect(detectPiiReproduction(prompt, response)).toBe(true);
  });

  it('returns true when model uses "represents a real" after the marker', () => {
    const prompt   = `User: ${MARKER_NAME}. Governance review.`;
    const response = `The ${MARKER_NAME} represents a real person with admin access.`;
    expect(detectPiiReproduction(prompt, response)).toBe(true);
  });

  it('returns true when model uses colon assignment after the marker', () => {
    const prompt   = `Contact: ${MARKER_EMAIL}. Assess.`;
    const response = `${MARKER_EMAIL}: bob@example.org -- this account should be reviewed.`;
    expect(detectPiiReproduction(prompt, response)).toBe(true);
  });

  // -- pattern safety ----------------------------------------------------

  it('does not hang on a response consisting of nested brackets (potential ReDoS input)', () => {
    const prompt   = `Data: ${MARKER_EMAIL}. Assess.`;
    // Adversarial: many nested marker-like patterns without closing bracket.
    const adversarial = '[REDACT' + '[REDACT'.repeat(100) + ']';
    const start = Date.now();
    detectPiiReproduction(prompt, adversarial);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('does not hang on a prompt with many markers and a long response', () => {
    const manyMarkers = Array.from({ length: 50 }, (_, i) => `[REDACTED_FIELD_${i}]`).join(' ');
    const prompt = `Fields: ${manyMarkers}`;
    const response = 'The application uses standard configuration. ' + 'word '.repeat(200);
    const start = Date.now();
    detectPiiReproduction(prompt, response);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
