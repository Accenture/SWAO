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

// Community-tier gate stubs (#1652, #1787, #2089, #3321, #3323). Kept out of
// tiers/community.ts (which parses argv on import) so tests can register the
// stubs on a fresh program. Imports NO premium module: the stubs print the
// [LICENSE] block from FEATURE_GATES and exit 2.

import type { Command } from 'commander';
import { registerLicenceStub } from '../lib/tier-stub.js';

export function registerCommunityTierStubs(program: Command): void {
  // #1652: meshcloud UniPipe integration (licence tier matrix D-04: Enterprise roadmap).
  registerLicenceStub(program, {
    name: 'unipipe',
    description: 'meshcloud UniPipe integration',
    label: 'swao unipipe',
    key: 'unipipe',
  });

  // #1787 / #3321: generate-tf is Enterprise (F-090, Enterprise roadmap). Does
  // NOT import the Terraform module (absent from the Community bundle).
  registerLicenceStub(program, {
    name: 'generate-tf',
    alias: 'tf-gen',
    description: 'Generate Terraform modules for sovereign landing zone',
    label: 'swao generate-tf',
    key: 'generate-tf',
  });

  // #2089: adversarial challenge review (F-091, Enterprise).
  registerLicenceStub(program, {
    name: 'challenge',
    description: 'AI-generated stakeholder challenge questions',
    label: 'swao challenge',
    key: 'challenge',
  });

  // #3323: `lz catalogue update` (F-111, Consultant+). The real command lives in
  // lz-premium.ts, which the Community entry does not register; without this
  // stub Commander answered "unknown command 'update'".
  const lz = program.commands.find((c) => c.name() === 'lz');
  const catalogue = lz?.commands.find((c) => c.name() === 'catalogue');
  if (catalogue && !catalogue.commands.some((c) => c.name() === 'update')) {
    registerLicenceStub(catalogue, {
      name: 'update',
      description: 'Refresh the LZ service catalogue from the cloud provider sources',
      label: 'swao lz catalogue update',
      key: 'lz-catalogue-update',
    });
  }
}
