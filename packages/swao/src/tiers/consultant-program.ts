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

// #4387: the Consultant command wiring, importable without parsing argv (the
// entry tiers/consultant.ts parses on import). The two Consultant tier modules
// (@swao/module-pdf-report, @swao/module-terraform) load on first use through
// string-literal dynamic imports; esbuild still bundles them. The Enterprise
// modules stay absent (tier-bundle-exclusion).

import type { Command } from 'commander';
import type { McpHostDeps } from '../lib/mcp-chat-contract.js';
import type { TierCommands } from '../lib/command-groups.js';
import { registerLicenceStub } from '../lib/tier-stub.js';
import { premiumScreens } from '../tui/premium-screens.js';
import {
  buildProgram,
  communityBuildPortal,
  communityRenderHtml,
  communityRunPortfolio,
  communityFormatPortfolioResult,
  communityRunForApp,
  communityServiceDeps,
  hideEnterprisePublishOptions,
} from '../bootstrap.js';
import { ROOT_HELP } from './root-help-manifest.js';

export const consultantTier: TierCommands = {
  tier: 'consultant',
  extraGroups: [
    {
      names: ['generate-tf', 'tf-gen'],
      register: async (p) => (await import('@swao/module-terraform')).registerGenerateTf(p),
    },
    { names: ['unipipe'], register: async (p) => (await import('../commands/unipipe.js')).registerUnipipe(p) },
    {
      names: ['challenge'],
      register: async (p) => {
        registerLicenceStub(p, {
          name: 'challenge',
          description: 'AI-generated stakeholder challenge questions',
          label: 'swao challenge',
          key: 'challenge',
        });
      },
    },
  ],
  after: {
    // Consultant command: lz catalogue update (Design 065 section 5.6).
    lz: async (p) => (await import('@swao/module-landing-zone')).registerLzCatalogueUpdate(p),
    publish: hideEnterprisePublishOptions,
  },
  // Register premium TUI screens available at Consultant tier (sprint-128 #2132).
  onFull: async () => {
    premiumScreens.GenerateTfScreen = (await import('@swao/module-terraform')).GenerateTfScreen;
  },
};

/** The Consultant program for argv (see bootstrap.buildProgram). */
export function buildConsultantProgram(cliSpawnDescriptor: McpHostDeps, argv: readonly string[] = process.argv): Promise<Command> {
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
      reportDeps: async () => {
        const pdf = await import('@swao/module-pdf-report');
        return {
          runForApp: communityRunForApp,
          renderHtml: communityRenderHtml,
          renderPdf: pdf.renderTextReportToPdf,
          renderLlmPdf: pdf.renderLlmComparisonToPdf,
          runPortfolio: communityRunPortfolio,
          formatPortfolioResult: communityFormatPortfolioResult,
        };
      },
    },
    consultantTier,
    ROOT_HELP.consultant,
    argv,
  );
}
