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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { loadPassCatalog } from './pass-catalog-loader.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.java', '.py', '.cs', '.go', '.kt', '.yaml', '.yml', '.json', '.env', '.example', '.properties']);
const ENV_EXTENSIONS = new Set(['.env', '.example', '.properties', '.cfg', '.ini']);

interface IamProviderDetection {
  imports: string[];
  env_vars: string[];
  config_keys: string[];
}

interface IamProviderPosture {
  data_residency: string[];
  sovereignty: string;
  schrems_ii_risk: string;
  eidas_trust_level: string;
  operator: string;
}

interface IamProviderEntry {
  id: string;
  name: string;
  detection: IamProviderDetection;
  posture: IamProviderPosture;
  cross_reference_frameworks: string[];
}

interface DetectedProvider {
  provider: IamProviderEntry;
  matchedTokens: string[];
  matchedFiles: string[];
}

function walk(dir: string, accept: (ext: string) => boolean): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...walk(full, accept));
      } else if (accept(extname(entry).toLowerCase())) {
        results.push(full);
      }
    } catch { /* skip */ }
  }
  return results;
}

function detectProvider(sourcePath: string, provider: IamProviderEntry): DetectedProvider | null {
  const { imports: importTokens, env_vars: envPatterns, config_keys: configKeys } = provider.detection;

  const allImportTokens = [...importTokens, ...configKeys];
  const matchedTokens: string[] = [];
  const matchedFiles: string[] = [];

  // Scan source files for import tokens and config keys
  const sourceFiles = walk(sourcePath, (ext) => SOURCE_EXTENSIONS.has(ext));
  const importPattern = allImportTokens.length > 0
    ? new RegExp(allImportTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
    : null;

  if (importPattern) {
    for (const file of sourceFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        if (importPattern.test(content)) {
          const relPath = file.replace(sourcePath + '/', '').replace(sourcePath + '\\', '');
          matchedFiles.push(relPath);
          // Collect which tokens matched
          for (const token of allImportTokens) {
            const tokenPat = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            if (tokenPat.test(content) && !matchedTokens.includes(token)) {
              matchedTokens.push(token);
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // Scan env / config files for env_var patterns
  if (envPatterns.length > 0) {
    const envFiles = walk(sourcePath, (ext) => ENV_EXTENSIONS.has(ext));
    // Also check .env.example, .env.template in root
    for (const ef of ['.env.example', '.env.template', '.env.sample']) {
      const full = join(sourcePath, ef);
      if (existsSync(full)) envFiles.push(full);
    }
    for (const file of envFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        for (const pattern of envPatterns) {
          try {
            if (new RegExp(pattern, 'i').test(content)) {
              const relPath = file.replace(sourcePath + '/', '').replace(sourcePath + '\\', '');
              if (!matchedFiles.includes(relPath)) matchedFiles.push(relPath);
              if (!matchedTokens.includes(pattern)) matchedTokens.push(pattern);
            }
          } catch { /* skip invalid regex */ }
        }
      } catch { /* skip */ }
    }
  }

  if (matchedTokens.length === 0) return null;
  return { provider, matchedTokens, matchedFiles };
}

export async function runIamPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];

  const catalogue = loadPassCatalog(workspacePath, 'pass-21-iam-providers.yaml');
  if (!catalogue || catalogue.entries.length === 0) {
    signals.push({
      id: 'IAM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'IAM provider catalogue not found or empty. Install the pass-catalogs bundle and re-run.',
      evidence: [],
      confidence: 'low',
    });
    return {
      pass: { id: 21, name: 'iam_assessment', signal_prefix: 'IAM', status: 'complete', iter, assessed_at: assessedAt },
      signals,
      assessment: { providers_detected: [], catalogue_available: false },
    };
  }

  const providers = catalogue.entries as unknown as IamProviderEntry[];
  const detected: DetectedProvider[] = [];

  for (const provider of providers) {
    const hit = detectProvider(sourcePath, provider);
    if (hit) detected.push(hit);
  }

  let sigNum = 1;
  const detectedIds: string[] = [];

  if (detected.length === 0) {
    signals.push({
      id: 'IAM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'No IAM provider integration detected in static analysis. If an IAM provider is in use, verify import and env-var naming matches catalogue entries.',
      evidence: [],
      confidence: 'low',
    });
  } else {
    for (const hit of detected) {
      const p = hit.provider;
      const posture = p.posture;
      const eidasLevel = posture.eidas_trust_level;
      const sovereignty = posture.sovereignty;
      const schremsRisk = posture.schrems_ii_risk;

      const isSovereign = sovereignty === 'de_sovereign' || sovereignty === 'eu_sovereign';
      const hasEidas = eidasLevel !== 'none' && eidasLevel !== '';
      const severity: Signal['severity'] = isSovereign && hasEidas ? 'positive' : isSovereign ? 'low' : 'medium';

      signals.push({
        id: `IAM-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'application',
        severity,
        derivation: `IAM provider detected: ${p.name}. Sovereignty: ${sovereignty}. eIDAS trust level: ${eidasLevel}. Schrems II risk: ${schremsRisk}. Operator: ${posture.operator}. Matched tokens: ${hit.matchedTokens.slice(0, 3).join(', ')}.`,
        evidence: hit.matchedFiles.slice(0, 5),
        confidence: 'medium',
      });
      sigNum++;
      detectedIds.push(String(p.id));
    }
  }

  return {
    pass: { id: 21, name: 'iam_assessment', signal_prefix: 'IAM', status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment: {
      providers_detected: detectedIds,
      catalogue_available: true,
      catalogue_entry_count: providers.length,
    },
  };
}
