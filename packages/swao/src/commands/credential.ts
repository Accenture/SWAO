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
import { CredentialStore, logPortfolio } from '@swao/core';
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// #2325 Feature 2 -- Export / Import crypto helpers.
// Exported for unit-testing; not part of the credential module public API.
// ---------------------------------------------------------------------------

const EXPORT_KDF_N = 131_072; // higher cost than vault KDF (16384) -- offline brute-force hardening

export interface ExportEnvelope {
  v: 1;
  type: 'swao-credential-export';
  exported_at: string;
  machine: string;
  alg: 'aes-256-gcm';
  kdf: 'scrypt';
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function encryptExport(plaintext: string, passphrase: string): ExportEnvelope {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  // maxmem must be >= 128*N*r; set to 3x that to stay well clear of the limit.
  const key = scryptSync(passphrase, salt, 32, { N: EXPORT_KDF_N, r: 8, p: 1, maxmem: 3 * 128 * EXPORT_KDF_N * 8 }) as Buffer;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const machineRaw = `${process.env['USERNAME'] ?? process.env['USER'] ?? 'unknown'}@${hostname()}`;
  const machineHash = createHash('sha256').update(machineRaw).digest('hex').slice(0, 8);
  return {
    v: 1,
    type: 'swao-credential-export',
    exported_at: new Date().toISOString(),
    machine: machineHash,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    n: EXPORT_KDF_N,
    r: 8,
    p: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

export function decryptExport(envelope: ExportEnvelope, passphrase: string): string {
  const salt = Buffer.from(envelope.salt, 'hex');
  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const data = Buffer.from(envelope.data, 'hex');
  const key = scryptSync(passphrase, salt, 32, { N: envelope.n, r: envelope.r, p: envelope.p, maxmem: 3 * 128 * envelope.n * envelope.r }) as Buffer;
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(data).toString('utf-8') + decipher.final('utf-8');
  } catch {
    throw new Error('wrong-passphrase');
  }
}

// Read a line from stdin, optionally with hidden input (TTY only).
function readPassphrase(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    if (process.stdin.isTTY && typeof (process.stdin as NodeJS.ReadStream).setRawMode === 'function') {
      (process.stdin as NodeJS.ReadStream).setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let pass = '';
      const handler = (char: string) => {
        if (char === '\r' || char === '\n') {
          (process.stdin as NodeJS.ReadStream).setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          resolve(pass);
        } else if (char === '') {
          (process.stdin as NodeJS.ReadStream).setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          process.exit(1);
        } else if (char === '' || char === '\b') {
          if (pass.length > 0) pass = pass.slice(0, -1);
        } else {
          pass += char;
        }
      };
      process.stdin.on('data', handler);
    } else {
      // Non-TTY (piped / test env): read line directly.
      const rl = createInterface({ input: process.stdin });
      rl.once('line', (line) => { rl.close(); resolve(line); });
    }
  });
}

// ---------------------------------------------------------------------------
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

  // #2325 Feature 2 -- Export
  cmd
    .command('export <output-file>')
    .description('export credentials to an encrypted file (for machine transfer)')
    .option('--passphrase-env <var>', 'read passphrase from this environment variable (non-interactive)')
    .action(async (outputFile: string, opts: { passphraseEnv?: string }) => {
      const store = new CredentialStore();
      const data = store.loadSync();
      const keyCount = Object.keys(data).length;
      if (keyCount === 0) {
        console.error('[credential] no credentials to export');
        process.exitCode = 1;
        return;
      }

      let passphrase: string;
      if (opts.passphraseEnv) {
        passphrase = process.env[opts.passphraseEnv] ?? '';
        if (!passphrase) {
          console.error(`[credential] environment variable ${opts.passphraseEnv} is not set or empty`);
          process.exitCode = 1;
          return;
        }
      } else {
        passphrase = await readPassphrase('Export passphrase: ');
        const confirm = await readPassphrase('Confirm passphrase: ');
        if (passphrase !== confirm) {
          console.error('[credential] passphrases do not match');
          process.exitCode = 1;
          return;
        }
      }
      if (passphrase.length < 8) {
        console.error('[credential] passphrase must be at least 8 characters');
        process.exitCode = 1;
        return;
      }

      const envelope = encryptExport(JSON.stringify(data), passphrase);
      writeFileSync(outputFile, JSON.stringify(envelope, null, 2), { encoding: 'utf-8', mode: 0o600 });
      logPortfolio('info', 'credential.export', 'Credential export written', {
        context: { key_count: keyCount, output_file: basename(outputFile) },
      });

      console.log(`Credential export written to: ${outputFile}`);
      console.log(`Keys exported: ${keyCount} credential${keyCount === 1 ? '' : 's'}`);
      console.log('Keep this file secure. It contains all your SWAO credentials encrypted with the passphrase you just set.');
    });

  // #2325 Feature 2 -- Import
  cmd
    .command('import <input-file>')
    .description('import credentials from an encrypted export file')
    .option('--passphrase-env <var>', 'read passphrase from this environment variable (non-interactive)')
    .option('--mode <mode>', 'merge (default) or replace', 'merge')
    .action(async (inputFile: string, opts: { passphraseEnv?: string; mode: string }) => {
      if (!existsSync(inputFile)) {
        console.error(`[credential] file not found: ${inputFile}`);
        process.exitCode = 1;
        return;
      }

      let raw: string;
      try {
        raw = readFileSync(inputFile, 'utf-8');
      } catch {
        console.error(`[credential] cannot read: ${inputFile}`);
        process.exitCode = 1;
        return;
      }

      let envelope: ExportEnvelope;
      try {
        const parsed = JSON.parse(raw) as Partial<ExportEnvelope>;
        if (parsed.type !== 'swao-credential-export' || parsed.v !== 1) {
          throw new Error('not a swao-credential-export file');
        }
        envelope = parsed as ExportEnvelope;
      } catch (err) {
        console.error(`[credential] invalid export file: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      let passphrase: string;
      if (opts.passphraseEnv) {
        passphrase = process.env[opts.passphraseEnv] ?? '';
        if (!passphrase) {
          console.error(`[credential] environment variable ${opts.passphraseEnv} is not set or empty`);
          process.exitCode = 1;
          return;
        }
      } else {
        passphrase = await readPassphrase('Import passphrase: ');
      }

      let plaintext: string;
      try {
        plaintext = decryptExport(envelope, passphrase);
      } catch {
        console.error('[credential] Import failed: wrong passphrase or corrupted file.');
        process.exitCode = 1;
        return;
      }

      let importData: Record<string, string>;
      try {
        importData = JSON.parse(plaintext) as Record<string, string>;
      } catch {
        console.error('[credential] Import failed: decrypted data is not valid JSON.');
        process.exitCode = 1;
        return;
      }

      const importKeys = Object.keys(importData);
      if (importKeys.length === 0) {
        console.error('[credential] export file contains no credentials');
        process.exitCode = 1;
        return;
      }

      // Show preview -- key names only, never values
      console.log(`\nKeys in export file (${importKeys.length} total):`);
      for (const k of importKeys.sort()) console.log(`  ${k}`);

      let mode: 'merge' | 'replace' = opts.mode === 'replace' ? 'replace' : 'merge';

      if (!opts.passphraseEnv) {
        // Interactive mode selection
        console.log('\nImport mode:');
        console.log('  [M] Merge   -- add or overwrite individual keys (default)');
        console.log('  [R] Replace -- replace entire vault contents');
        process.stdout.write('\nChoice [M/R]: ');
        const choice = await new Promise<string>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.once('line', (line) => { rl.close(); resolve(line.trim().toUpperCase()); });
        });
        if (choice === 'R') mode = 'replace';
      }

      const store = new CredentialStore();
      await store.importAll(importData, mode);
      logPortfolio('info', 'credential.import', 'Credential import completed', {
        context: { keys_imported: importKeys.length, mode },
      });

      console.log(`\nImported ${importKeys.length} credential${importKeys.length === 1 ? '' : 's'} into vault (mode: ${mode}).`);
      // #1416 check: warn if any imported token key looks like a URL
      for (const [name, value] of Object.entries(importData)) {
        if (/token/i.test(name) && /^https?:\/\//i.test(value.trim())) {
          console.warn(`[credential] WARNING: "${name}" looks like a URL, not a token.`);
        }
      }
    });

}
