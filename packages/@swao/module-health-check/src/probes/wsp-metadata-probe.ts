// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #1509: workspace .swao.yml metadata quality probe.
// Warns when engagement.name is the scaffold placeholder or empty.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

export type WspMetadataProbeStatus = 'ok' | 'warn' | 'absent';

export interface WspMetadataProbeResult {
  status: WspMetadataProbeStatus;
  engagement_name: string;
  warnings: string[];
  message: string;
}

const PLACEHOLDER_NAMES = new Set(['My Cloud Transformation', '']);

export function buildWspMetadataProbe(workspacePath: string): WspMetadataProbeResult {
  const swaoYmlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(swaoYmlPath)) {
    return {
      status: 'absent',
      engagement_name: '',
      warnings: [],
      message: 'No .swao.yml found in workspace.',
    };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = load(readFileSync(swaoYmlPath, 'utf-8')) as Record<string, unknown> | null;
  } catch {
    return {
      status: 'warn',
      engagement_name: '',
      warnings: ['.swao.yml could not be parsed'],
      message: '.swao.yml exists but failed to parse.',
    };
  }

  const eng = parsed?.engagement as Record<string, unknown> | undefined;
  const engName = typeof eng?.name === 'string' ? eng.name.trim() : '';
  const warnings: string[] = [];

  if (PLACEHOLDER_NAMES.has(engName)) {
    warnings.push(`engagement.name is "${engName || '(empty)'}" -- update .swao.yml before publishing`);
  }

  const engCode = typeof eng?.client_code === 'string' ? eng.client_code.trim() : '';
  if (engCode === 'MCT' || engCode === '') {
    warnings.push(`engagement.client_code is "${engCode || '(empty)'}" -- update to the real client code`);
  }

  if (warnings.length === 0) {
    return {
      status: 'ok',
      engagement_name: engName,
      warnings: [],
      message: `engagement.name: "${engName}"`,
    };
  }

  return {
    status: 'warn',
    engagement_name: engName,
    warnings,
    message: warnings.join('; '),
  };
}
