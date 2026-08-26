// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO Component Library registry -- Design 068 §20.5, Step 1.
 *
 * Defines the OptionSchema (Zod) for each named component in the SWAO
 * Component Library. The HTML Editor generates form inputs from these schemas
 * automatically -- no hardcoded editor UI per component. Adding a new option
 * to a component schema immediately makes it configurable from the editor.
 *
 * Usage:
 *   const schema = componentOptions('swao-table');
 *   const parsed = schema.safeParse(rawOptions);
 *
 * Component options are stored in the workspace profile YAML under
 * 'component_options' and threaded into renderBlock via assemblePublicationPage.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-component option schemas
// ---------------------------------------------------------------------------

/** Interactive data table -- used by signal-list, controls, risks, evidence, etc. */
const swaoTableSchema = z.object({
  /** Initial row density applied to the table on publication open. User can cycle with the Density button. */
  density: z.enum(['compact', 'normal', 'comfortable']).optional(),
  /** Whether the text search input is shown above the table. */
  search: z.coerce.boolean().optional(),
  /** Whether column headers are sortable by default. */
  sortable: z.coerce.boolean().optional(),
});

/** Compliance framework tile grid -- used by compliance-regime block. */
const swaoTilesComplianceSchema = z.object({
  /** Number of columns in the tile grid (1-4). Defaults to responsive layout. */
  columns: z.coerce.number().int().min(1).max(4).optional(),
  /** Whether control-level detail rows are expanded by default. */
  show_controls: z.coerce.boolean().optional(),
});

/** Donut / ring coverage chart -- used by coverage-bar and hub tiles. */
const swaoChartDonutSchema = z.object({
  /** Whether the chart renders with a CSS transition animation. */
  animation: z.coerce.boolean().optional(),
  /** Visual size variant. */
  size: z.enum(['small', 'medium', 'large']).optional(),
});

/** Horizontal severity-count bar chart -- used by signal-list header. */
const swaoChartSeverityBarSchema = z.object({
  /** Whether data-point labels are rendered above each bar segment. */
  show_labels: z.coerce.boolean().optional(),
  /** Bar orientation. */
  orientation: z.enum(['horizontal', 'vertical']).optional(),
});

/** RAG status badge (pass / partial / fail / not-assessed). */
const swaoRagBadgeSchema = z.object({
  /** Whether the status text label is rendered alongside the colour chip. */
  show_text: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Registry map
// ---------------------------------------------------------------------------

export const COMPONENT_SCHEMAS = {
  'swao-table': swaoTableSchema,
  'swao-tiles-compliance': swaoTilesComplianceSchema,
  'swao-chart-donut': swaoChartDonutSchema,
  'swao-chart-severity-bar': swaoChartSeverityBarSchema,
  'swao-rag-badge': swaoRagBadgeSchema,
} as const;

export type ComponentName = keyof typeof COMPONENT_SCHEMAS;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the Zod OptionSchema for the named SWAO component.
 * The schema can be used to validate and coerce raw YAML/JSON options.
 */
export function componentOptions<K extends ComponentName>(name: K): (typeof COMPONENT_SCHEMAS)[K] {
  return COMPONENT_SCHEMAS[name];
}

/**
 * Return the list of all registered component names.
 */
export function registeredComponents(): ComponentName[] {
  return Object.keys(COMPONENT_SCHEMAS) as ComponentName[];
}
