// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3430: Zod schema and loader for swao/controls/service-footprint-catalogue.yaml,
// the deterministic mapping from build files, compose files, Kubernetes
// manifests, configuration, Liquibase changelogs and documents to the backing
// services (landing-zone capabilities) an application needs. Read by
// passes/service-footprint.ts (Pass 01). The loader never throws.

import { z } from 'zod';
import { IsoDateSchema, loadCatalogue, type CatalogueLoad } from './reference-catalogues.js';

export const SERVICE_FOOTPRINT_CATALOGUE_FILE = 'service-footprint-catalogue.yaml';

/** Capability id: a landing-zone catalogue `fulfills` token (lower case, digits, underscore). */
const CapabilityIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'capability id must be a lower-case fulfills token');

const PatternList = z.array(z.string().min(1)).optional();

export const ServiceFootprintCategorySchema = z.enum([
  'compute', 'network', 'storage', 'database', 'cache', 'messaging', 'security',
]);
export type ServiceFootprintCategory = z.infer<typeof ServiceFootprintCategorySchema>;

export const ServiceFootprintCapabilitySchema = z
  .object({
    id: CapabilityIdSchema,
    label: z.string().min(1),
    category: ServiceFootprintCategorySchema,
    detect: z
      .object({
        maven: PatternList,
        npm: PatternList,
        pip: PatternList,
        images: PatternList,
        helm_charts: PatternList,
        k8s_kinds: PatternList,
        config: PatternList,
        db_dialects: PatternList,
        docs: PatternList,
      })
      .strict(),
  })
  .strict();
export type ServiceFootprintCapability = z.infer<typeof ServiceFootprintCapabilitySchema>;

export const ServiceFootprintCatalogueSchema = z
  .object({
    version: z.string().min(1),
    last_reviewed: IsoDateSchema.optional(),
    capabilities: z.array(ServiceFootprintCapabilitySchema).min(1),
  })
  .strict()
  .superRefine((cat, ctx) => {
    const ids = new Set<string>();
    for (const c of cat.capabilities) {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate capability id ${c.id}` });
      ids.add(c.id);
    }
  });
export type ServiceFootprintCatalogue = z.infer<typeof ServiceFootprintCatalogueSchema>;

export function loadServiceFootprintCatalogue(pathOverride?: string): CatalogueLoad<ServiceFootprintCatalogue> {
  return loadCatalogue(SERVICE_FOOTPRINT_CATALOGUE_FILE, ServiceFootprintCatalogueSchema, pathOverride);
}
