// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO_APM domain-weights probe (Design 103 Q4, §19.4, #3102).
 *
 * In a service workspace (workspace `.swao.yml` has `service_portfolio:`), reads
 * `domain_weights` from the active SWAO_APM `framework-meta.yaml` (workspace copy
 * first, then the bundled framework) and checks, with integer arithmetic, that
 * all eleven domains are present and the weights sum to exactly 100. A missing
 * `domain_weights` key is a warning (equal weights assumed); a wrong sum is an error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { apmFrameworkDir, validateDomainWeights } from '@swao/module-service-assessment';

export type ApmWeightsProbeStatus = 'skip' | 'ok' | 'warn' | 'error';

export interface ApmWeightsProbeResult {
  status: ApmWeightsProbeStatus;
  message: string;
  source: 'workspace' | 'bundled' | null;
  errors: string[];
  warnings: string[];
}

function isServiceWorkspace(workspacePath: string): boolean {
  const p = join(workspacePath, '.swao.yml');
  if (!existsSync(p)) return false;
  try {
    const doc = load(readFileSync(p, 'utf-8')) as { service_portfolio?: unknown } | null;
    return !!doc?.service_portfolio;
  } catch {
    return false;
  }
}

export function buildApmWeightsProbe(workspacePath: string): ApmWeightsProbeResult {
  if (!isServiceWorkspace(workspacePath)) return { status: 'skip', message: 'not a service workspace', source: null, errors: [], warnings: [] };
  const located = apmFrameworkDir(workspacePath);
  if (!located) return { status: 'skip', message: 'SWAO_APM framework-meta.yaml not found', source: null, errors: [], warnings: [] };
  let weights: Record<string, unknown> | undefined;
  try {
    const doc = load(readFileSync(join(located.dir, 'framework-meta.yaml'), 'utf-8')) as { framework?: { domain_weights?: Record<string, unknown> } } | null;
    weights = doc?.framework?.domain_weights;
  } catch (e) {
    return { status: 'error', message: `SWAO_APM framework-meta.yaml unreadable: ${(e as Error).message}`, source: located.source, errors: ['unreadable'], warnings: [] };
  }
  const { errors, warnings } = validateDomainWeights(weights);
  if (errors.length > 0) return { status: 'error', message: errors.join('; '), source: located.source, errors, warnings };
  if (warnings.length > 0) return { status: 'warn', message: warnings.join('; '), source: located.source, errors, warnings };
  return { status: 'ok', message: `SWAO_APM domain_weights valid (11 domains, sum 100, ${located.source} framework)`, source: located.source, errors, warnings };
}
