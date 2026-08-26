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

import type { Command } from 'commander';
import { CredentialStore } from '@swao/core';

// #1411 Phase 1: display-only grouping of the flat credential namespace.
// Storage stays flat (vault-only rule untouched); only the LIST rendering
// classifies names so a store with many apps stays navigable. Exported for
// credential.test.ts.
const PLAYWRIGHT_RE = /^playwright-(url|user|pass)-(.+)$/;
const PW_PART_ORDER = ['url', 'user', 'pass'];

export function renderCredentialList(names: string[]): string[] {
  const llm: string[] = [];
  const vcs: string[] = [];
  const other: string[] = [];
  const playwright = new Map<string, string[]>();

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const pw = PLAYWRIGHT_RE.exec(name);
    if (pw) {
      const parts = playwright.get(pw[2] as string) ?? [];
      parts.push(pw[1] as string);
      playwright.set(pw[2] as string, parts);
      continue;
    }
    if (/^vcs-/.test(name) || /^provider:[^:]+:token$/.test(name)) { vcs.push(name); continue; }
    if (/-api-key$/.test(name)) { llm.push(name); continue; }
    other.push(name);
  }

  const lines: string[] = [];
  const section = (title: string, items: string[]): void => {
    if (items.length === 0) return;
    lines.push(`  ${title} (${items.length})`);
    for (const item of items) lines.push(`    ${item}`);
  };
  section('LLM API keys', llm);
  if (playwright.size > 0) {
    lines.push(`  Web crawl / Playwright (${[...playwright.values()].reduce((n, p) => n + p.length, 0)})`);
    for (const [app, parts] of [...playwright.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ordered = PW_PART_ORDER.filter(p => parts.includes(p));
      const missing = PW_PART_ORDER.filter(p => !parts.includes(p));
      lines.push(`    playwright-*-${app}: ${ordered.join(', ')}${missing.length ? `   (missing: ${missing.join(', ')})` : ''}`);
    }
  }
  section('VCS tokens', vcs);
  section('Other', other);
  return lines;
}

export function registerCredential(program: Command): void {
  const cmd = program.command('credential').description('Manage SWAO credentials securely (anthropic-api-key, and LZR adapter keys for AWS, Azure, and meshStack).');

  cmd
    .command('set <name> <value>')
    .description('store a credential (value is not echoed)')
    .action(async (name: string, value: string) => {
      const store = new CredentialStore();
      await store.set(name, value);
      console.log(`[credential] stored "${name}"`);
      // #1416: a URL in a *token* key is almost always a paste slip meant for
      // a vcs-url-* key. Warn (never refuse -- some proprietary schemes may
      // legitimately look URL-ish); never echo the value itself.
      if (/token/i.test(name) && /^https?:\/\//i.test(value.trim())) {
        console.warn(
          `[credential] WARNING: the value stored under "${name}" looks like a URL, not a token. ` +
          'If you meant to store a repository URL, use a vcs-url-<app> key instead and remove this entry ' +
          `(\`swao credential delete ${name}\`).`,
        );
      }
    });

  cmd
    .command('get <name>')
    .description('retrieve a credential (programmatic use; not printed to stdout)')
    .action(async (name: string) => {
      const store = new CredentialStore();
      const value = await store.get(name);
      if (value === null) {
        console.error(`[credential] "${name}" not found`);
        process.exitCode = 1;
        return;
      }
      // Credential value intentionally not printed to stdout.
      // Use SWAO_CREDENTIAL_<NAME> env var or credential store in code.
      console.log(`[credential] "${name}" is set`);
    });

  cmd
    .command('list')
    .description('list credential names (values are never shown)')
    .action(async () => {
      const store = new CredentialStore();
      const names = await store.list();
      if (names.length === 0) {
        console.log('[credential] no credentials stored');
        return;
      }
      console.log(`[credential] stored credentials (${names.length}):`);
      for (const line of renderCredentialList(names)) {
        console.log(line);
      }
    });

  cmd
    .command('delete <name>')
    .description('remove a credential from the store')
    .action(async (name: string) => {
      const store = new CredentialStore();
      const deleted = await store.delete(name);
      if (deleted) {
        console.log(`[credential] deleted "${name}"`);
      } else {
        console.error(`[credential] "${name}" not found`);
        process.exitCode = 1;
      }
    });
}
