// useLlmLoader -- loading effect extracted from LlmAssessmentScreen.tsx (#2376).
// Runs exactly once (when stage === 'loading'), discovers workspace state,
// and calls onDone / onError to hand control back to the parent.

import { useEffect } from 'react';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { findWorkspace, SwaoYmlSchema, credentialStore } from '@swao/core';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import { checkAppAssessmentPrecondition } from '@swao/module-llm-assessment';
import { listConnectors, type LoadedConnector } from '@swao/module-llm-providers';
import type { EligibleApp } from '../types.js';

interface LoadedState {
  workspacePath: string;
  eligibleApps: EligibleApp[];
  llmCfg: SwaoYmlLlmAssessment | null;
  loadedConnectors: LoadedConnector[];
  configuredCredKeys: Set<string>;
  crawlAvailable: boolean;
  includeCrawlInitial: boolean;
}

interface UseLlmLoaderParams {
  stage: string;
  workspacePathProp: string | undefined;
  onDone: (noApps: boolean, state: LoadedState) => void;
  onError: (msg: string) => void;
}

export function useLlmLoader({ stage, workspacePathProp, onDone, onError }: UseLlmLoaderParams): void {
  useEffect(() => {
    if (stage !== 'loading') return;
    try {
      const wsFound = workspacePathProp ?? findWorkspace(process.cwd());
      if (!wsFound) throw new Error('No SWAO workspace found. Run Workspace Setup (menu 1) to initialise.');
      const wp = wsFound;

      let parsedCfg: SwaoYmlLlmAssessment | null = null;
      let hasCrawlYamlUrl = false;
      try {
        const raw = load(readFileSync(join(wp, '.swao.yml'), 'utf8'));
        const res = SwaoYmlSchema.safeParse(raw);
        if (res.success && res.data.llm_assessment) parsedCfg = res.data.llm_assessment;
        const crawlBlock = (raw as Record<string, unknown>)?.['crawl'] as Record<string, unknown> | undefined;
        hasCrawlYamlUrl = typeof crawlBlock?.['target_url'] === 'string' && (crawlBlock['target_url'] as string).length > 0;
      } catch { /* no .swao.yml */ }

      const appsDir = join(wp, 'apps');
      const appNames: string[] = existsSync(appsDir) ? (readdirSync(appsDir) as string[]) : [];
      const eligible: EligibleApp[] = [];
      for (const appId of appNames) {
        try {
          const pre = checkAppAssessmentPrecondition(wp, appId);
          if (pre.ok) eligible.push({ id: appId, passCount: pre.latestRun?.passStats?.length ?? 0 });
        } catch { /* skip */ }
      }

      let connectors: LoadedConnector[] = [];
      let credKeys = new Set<string>();
      try {
        connectors = listConnectors({ workspaceRoot: wp }).connectors;
        const creds = credentialStore.loadSync();
        credKeys = new Set(Object.keys(creds));
      } catch { /* no connectors */ }

      onDone(eligible.length === 0, {
        workspacePath: wp,
        eligibleApps: eligible,
        llmCfg: parsedCfg,
        loadedConnectors: connectors,
        configuredCredKeys: credKeys,
        crawlAvailable: hasCrawlYamlUrl,
        includeCrawlInitial: hasCrawlYamlUrl,
      });
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [stage]);
}
