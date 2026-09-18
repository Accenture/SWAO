// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #2325: Credential vault probe (probe 16).
// Checks vault existence, decryptability, and key category completeness.
// Never logs key names or values -- only counts and category presence.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CredentialStore } from '@swao/core';

export type CredentialVaultProbeStatus = 'ok' | 'warn' | 'fail';

export type CredentialVaultCategory = 'llm' | 'vcs' | 'playwright' | 'playwright-mfa';

export interface CredentialVaultProbeResult {
  status: CredentialVaultProbeStatus;
  vaultExists: boolean;
  decryptable: boolean;
  keyCount: number;
  categories: CredentialVaultCategory[];
  message: string;
}

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'swao');
const CREDENTIALS_FILE = '.swao-credentials.json';

function categoriseKeys(keys: string[]): CredentialVaultCategory[] {
  const found = new Set<CredentialVaultCategory>();
  for (const k of keys) {
    if (k.endsWith('-api-key'))                 found.add('llm');
    if (k === 'vcs-token' || /^provider:.+:token$/.test(k)) found.add('vcs');
    if (/^playwright-(url|user|pass)-/.test(k)) found.add('playwright');
    if (k.startsWith('playwright-mfa-'))        found.add('playwright-mfa');
  }
  return [...found].sort();
}

export function buildCredentialVaultProbe(configDir?: string): CredentialVaultProbeResult {
  const dir = configDir ?? DEFAULT_CONFIG_DIR;
  const vaultFile = join(dir, CREDENTIALS_FILE);
  const vaultExists = existsSync(vaultFile);

  if (!vaultExists) {
    return {
      status: 'fail',
      vaultExists: false,
      decryptable: false,
      keyCount: 0,
      categories: [],
      message: 'Credential vault not found. Run `swao credential set` or the Setup Wizard to store credentials.',
    };
  }

  let keys: string[];
  try {
    const store = new CredentialStore(dir);
    const data = store.loadSync();
    keys = Object.keys(data);
  } catch {
    return {
      status: 'fail',
      vaultExists: true,
      decryptable: false,
      keyCount: 0,
      categories: [],
      message: 'Credential vault exists but could not be decrypted. It may be corrupt or from a different machine.',
    };
  }

  const categories = categoriseKeys(keys);
  const hasLlm = categories.includes('llm');

  if (!hasLlm) {
    return {
      status: 'warn',
      vaultExists: true,
      decryptable: true,
      keyCount: keys.length,
      categories,
      message: 'Credential vault is accessible but contains no LLM API key. At least one connector must have an API key for assessments to run. Run the Setup Wizard (Step 2 LLM) or use `swao credential set` to add a key.',
    };
  }

  return {
    status: 'ok',
    vaultExists: true,
    decryptable: true,
    keyCount: keys.length,
    categories,
    message: `Credential vault OK -- ${keys.length} credential${keys.length === 1 ? '' : 's'} stored.`,
  };
}
