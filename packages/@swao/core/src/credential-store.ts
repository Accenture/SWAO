// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, hostname, userInfo } from 'os';
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from 'crypto';

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'swao');
const CREDENTIALS_FILE = '.swao-credentials.json';

// EncryptedVault -- the on-disk format after migration from plaintext.
// All byte arrays stored as lowercase hex strings.
interface EncryptedVault {
  v: 1;
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

// scrypt params for machine-attribute key (option c).
// N=16384 keeps derivation to ~100ms; option b (passphrase) uses N=131072.
const KDF_N = 16384;
const KDF_R = 8;
const KDF_P = 1;

function machineInput(): string {
  // username@hostname deliberately avoids the license fingerprint inputs
  // (platform + firstRun). See src/license/license-guard.ts.
  try {
    return `${userInfo().username}@${hostname()}:swao-vault-v1`;
  } catch {
    return `${process.env['USERNAME'] ?? 'unknown'}@${hostname()}:swao-vault-v1`;
  }
}

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(machineInput(), salt, 32, { N: KDF_N, r: KDF_R, p: KDF_P }) as Buffer;
}

function encryptCredentials(plaintext: string, existingSalt?: Buffer): EncryptedVault {
  const salt = existingSalt ?? randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    n: KDF_N,
    r: KDF_R,
    p: KDF_P,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

function decryptCredentials(vault: EncryptedVault): string {
  const salt = Buffer.from(vault.salt, 'hex');
  const iv = Buffer.from(vault.iv, 'hex');
  const tag = Buffer.from(vault.tag, 'hex');
  const data = Buffer.from(vault.data, 'hex');
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(data).toString('utf-8') + decipher.final('utf-8');
  } catch {
    throw new Error(
      '[credential] Vault decryption failed. ' +
      'The credential file may have been created on a different machine or the vault is corrupt.'
    );
  }
}

function isEncryptedVault(obj: unknown): obj is EncryptedVault {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as Record<string, unknown>)['v'] === 1 &&
    (obj as Record<string, unknown>)['alg'] === 'aes-256-gcm'
  );
}

function envVarName(name: string): string {
  return `SWAO_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
}

function redact(_value: string): string {
  return '[REDACTED]';
}

export class CredentialStore {
  private readonly configDir: string;
  private readonly credFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? DEFAULT_CONFIG_DIR;
    this.credFile = join(this.configDir, CREDENTIALS_FILE);
  }

  private load(): { data: Record<string, string>; salt?: Buffer } {
    if (!existsSync(this.credFile)) return { data: {} };
    let raw: string;
    try {
      raw = readFileSync(this.credFile, 'utf-8').trim();
    } catch {
      return { data: {} };
    }

    if (!raw || raw === '{}') return { data: {} };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { data: {} };
    }

    if (isEncryptedVault(parsed)) {
      const salt = Buffer.from(parsed.salt, 'hex');
      const plaintext = decryptCredentials(parsed);
      let inner: unknown;
      try {
        inner = JSON.parse(plaintext);
      } catch {
        return { data: {}, salt };
      }
      return {
        data: (typeof inner === 'object' && inner !== null ? inner : {}) as Record<string, string>,
        salt,
      };
    }

    // Plaintext legacy format -- migrate on next save.
    return { data: parsed as Record<string, string> };
  }

  private save(data: Record<string, string>, existingSalt?: Buffer): void {
    mkdirSync(this.configDir, { recursive: true });
    const vault = encryptCredentials(JSON.stringify(data), existingSalt);
    writeFileSync(this.credFile, JSON.stringify(vault, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  async set(name: string, value: string): Promise<void> {
    const { data, salt } = this.load();
    data[name] = value;
    this.save(data, salt);
  }

  async get(name: string): Promise<string | null> {
    const envKey = envVarName(name);
    const envVal = process.env[envKey];
    if (envVal !== undefined) return envVal;

    const { data } = this.load();
    return data[name] ?? null;
  }

  async list(): Promise<string[]> {
    const { data } = this.load();
    const fileKeys = Object.keys(data);
    const envKeys = Object.keys(process.env)
      .filter((k) => k.startsWith('SWAO_CREDENTIAL_'))
      .map((k) => k.slice('SWAO_CREDENTIAL_'.length).toLowerCase().replace(/_/g, '-'));
    return [...new Set([...fileKeys, ...envKeys])].sort();
  }

  async delete(name: string): Promise<boolean> {
    const { data, salt } = this.load();
    if (!(name in data)) return false;
    delete data[name];
    this.save(data, salt);
    return true;
  }

  loadSync(): Record<string, string> {
    return this.load().data;
  }

  async getOrThrow(name: string, _context: string): Promise<string> {
    const value = await this.get(name);
    if (!value) {
      throw new Error(`[credential] "${name}" not found. Set ${envVarName(name)} or run: swao credential set ${name} <value>`);
    }
    void redact;
    return value;
  }
}

export const credentialStore = new CredentialStore();
