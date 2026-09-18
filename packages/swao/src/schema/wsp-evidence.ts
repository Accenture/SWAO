// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { z } from 'zod';

const EvidenceItemSchema = z
  .object({
    type: z.enum([
      'static_analysis',
      'cmdb',
      'finops',
      'incident',
      'ops_runbook',
      'workshop',
      'architecture_doc',
      'apm',
    ]),
    file: z.string(),
  })
  .passthrough();

export const EvidenceSchema = z.object({
  evidence_catalogue: z.record(z.string(), EvidenceItemSchema),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
