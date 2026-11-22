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

// #4387: the Community command wiring, importable without parsing argv (the
// entry tiers/community.ts parses on import), so the root help drift test can
// build the full program. Imports NO premium module (tier-bundle-exclusion):
// the tier slots are the gated stubs from bootstrap.ts, and `generate-tf`,
// `challenge`, `unipipe` and `lz catalogue update` are [LICENSE] stubs.

import type { Command } from 'commander';
import type { McpHostDeps } from '../lib/mcp-chat-contract.js';
import type { TierCommands } from '../lib/command-groups.js';
import { registerLicenceStub } from '../lib/tier-stub.js';
import {
  buildProgram,
  communityRenderHtml,
  communityRenderPdf,
  communityRenderLlmPdf,
  communityRunPortfolio,
  communityFormatPortfolioResult,
  communityBuildPortal,
  communityRunForApp,
  communityServiceDeps,
  hideEnterprisePublishOptions,
} from '../bootstrap.js';
import { COMMUNITY_TOP_LEVEL_STUBS, registerCommunityLzCatalogueUpdateStub } from './community-stubs.js';
import { ROOT_HELP } from './root-help-manifest.js';

export const communityTier: TierCommands = {
  tier: 'community',
  extraGroups: COMMUNITY_TOP_LEVEL_STUBS.map((spec) => ({
    names: spec.alias ? [spec.name, spec.alias] : [spec.name],
    register: async (p: Command) => {
      registerLicenceStub(p, spec);
    },
  })),
  after: {
    lz: registerCommunityLzCatalogueUpdateStub,
    publish: hideEnterprisePublishOptions,
  },
};

/** The Community program for argv (see bootstrap.buildProgram). */
export function buildCommunityProgram(cliSpawnDescriptor: McpHostDeps, argv: readonly string[] = process.argv): Promise<Command> {
  return buildProgram(
    {
      cliSpawnDescriptor,
      // #3348 B-01 / B-02: MCP server and SWAO Chat are Enterprise; stubs here.
      mcpChat: async () => (await import('./premium-stubs/mcp-chat.js')).registerStubMcpChat(),
      buildPortal: async () => communityBuildPortal,
      serviceDeps: communityServiceDeps,
      assessDeps: async () => ({
        runForApp: communityRunForApp,
        runPortfolio: communityRunPortfolio,
        formatPortfolioResult: communityFormatPortfolioResult,
      }),
      reportDeps: async () => ({
        runForApp: communityRunForApp,
        renderHtml: communityRenderHtml,
        renderPdf: communityRenderPdf,
        renderLlmPdf: communityRenderLlmPdf,
        runPortfolio: communityRunPortfolio,
        formatPortfolioResult: communityFormatPortfolioResult,
      }),
    },
    communityTier,
    ROOT_HELP.community,
    argv,
  );
}
