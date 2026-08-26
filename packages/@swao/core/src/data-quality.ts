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

import type { RunManifest } from './run-manifest.js';

// Data-quality conditions derived from a run manifest. Relocated to @swao/core
// (ADR-0048 modular architecture, Phase 5, #0577) so that both the publication
// renderer (@swao/module-html-report) and the BI-export star writer
// (@swao/module-powerbi) can evaluate data-quality flags without either module
// importing the other. A `@swao/module-*` may import only @swao/core / @swao/tui-kit
// / leaf npm deps -- never a sibling module -- so this shared contract lives in
// core. The HTML-rendering helper (buildDataQualityBannerHtml) stays in
// module-html-report: it is a presentation concern, not a shared data contract,
// and keeping it out of core preserves core's no-HTML layering.

export interface DataQualityCondition {
  severity: 'error' | 'warn';
  message: string;
  signal_ids?: string[];                     // optional list of signal IDs to link from the banner
  signal_derivations?: Record<string, string>; // derivation text per signal ID (for tooltip)
}

/**
 * Evaluate the run-manifest and return active data quality conditions.
 * Returns an empty array when the run is clean (real LLM, temperature=0,
 * no placeholder inputs, no false-positive flags, current LZR snapshot).
 */
export function evaluateDataQuality(manifest: RunManifest | null): DataQualityCondition[] {
  if (!manifest) return [];
  const conditions: DataQualityCondition[] = [];

  if (manifest.llm?.provider === 'stub') {
    conditions.push({ severity: 'error', message: 'LLM: stub fixture data -- not a real assessment' });
  }

  const prov = manifest.provenance;
  if (prov) {
    if (prov.temperature > 0) {
      conditions.push({ severity: 'warn', message: `Temperature: ${prov.temperature} -- results may vary between runs` });
    }
    if (prov.placeholder_inputs.length > 0) {
      // #0513: red banner for scaffold placeholder inputs -- must not share with clients
      const fileList = prov.placeholder_inputs.slice(0, 5).join(', ');
      const extra = prov.placeholder_inputs.length > 5 ? ` (+${prov.placeholder_inputs.length - 5} more)` : '';
      conditions.push({
        severity: 'error',
        message: `Scaffold placeholder data: ${prov.placeholder_inputs.length} input file(s) contain placeholder text (${fileList}${extra}) -- results reflect sample data, not the real application. Replace these files before sharing this report.`,
      });
    }
    if (prov.false_positive_flags > 0) {
      conditions.push({
        severity: 'warn',
        message: `Possible hallucinations: ${prov.false_positive_flags} signal(s) flagged -- evidence file not found`,
        // signal_ids populated by caller (renderer) from model.signals
      });
    }
    if (prov.lzr_snapshot_age_days !== undefined && prov.lzr_snapshot_age_days > 7) {
      conditions.push({
        severity: 'warn',
        message: `LZR snapshot: ${Math.floor(prov.lzr_snapshot_age_days)} days old -- infrastructure state may have changed`,
      });
    }
    if (prov.lzr_snapshot_fabricated) {
      conditions.push({ severity: 'warn', message: 'LZR snapshot: fabricated example data -- not real cloud state' });
    }
    // #0550: LLM-optional. Name the passes that degraded to no_llm_provider
    // skip signals so the deliverable shows what was not evaluated.
    if (prov.llm_skipped_passes && prov.llm_skipped_passes.length > 0) {
      conditions.push({
        severity: 'warn',
        message: `LLM passes skipped: ${prov.llm_skipped_passes.join(', ')} -- no LLM provider configured (no_llm_provider)`,
      });
    }
  }

  return conditions;
}

/**
 * Serialise active conditions to a compact comma-separated string for the
 * BI export data_quality_flags column.
 */
export function buildDataQualityFlagsString(conditions: DataQualityCondition[]): string {
  if (conditions.length === 0) return '';
  return conditions.map((c) => c.message.split(' -- ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')).join(',');
}
