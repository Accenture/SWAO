// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- SWAO LLM-Gateway connector schema
//  (Design 090 Section 5, #1394)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { z } from 'zod';
import { load as loadYaml } from 'js-yaml';

// ---------------------------------------------------------------------------
// Schema version gate
// ---------------------------------------------------------------------------
// v1.x accepted; unknown majors rejected with a clear message so a future
// breaking schema can coexist with old binaries refusing it loudly.

const SUPPORTED_SCHEMA_MAJOR = 1;

// ---------------------------------------------------------------------------
// Secret-shape refusal (CLAUDE.md 5.7)
// ---------------------------------------------------------------------------
// Connector files carry credential NAMES (store keys, env var names), never
// key material. Any string value that looks like an actual secret fails the
// whole file. Two detectors:
//   1. Known key prefixes (Anthropic, OpenAI, OpenRouter, GitHub, AWS, ...).
//   2. Long unbroken high-entropy tokens (base64/hex-ish, >= 32 chars,
//      Shannon entropy above threshold). URLs and model ids contain '/',
//      ':' or '.' separators and are EXCLUDED from the unbroken-token
//      pattern -- #1414: '/' was originally in the character class (base64
//      alphabet) which made long aggregator model ids like
//      vendor/dolphin-mistral-24b-venice-edition trip the detector and
//      reject the whole refreshed connector file. Key formats containing
//      '/' remain covered by the prefix rules above.

const SECRET_PREFIX_RE = /\b(sk-ant-|sk-or-|sk-proj-|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,})/;
const UNBROKEN_TOKEN_RE = /^[A-Za-z0-9+_=-]{32,}$/;

function shannonEntropyBitsPerChar(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** True when a string value looks like actual key material. */
export function looksLikeSecret(value: string): boolean {
  if (SECRET_PREFIX_RE.test(value)) return true;
  if (UNBROKEN_TOKEN_RE.test(value) && shannonEntropyBitsPerChar(value) >= 4.0) return true;
  return false;
}

function findSecretShapedValues(node: unknown, path: string, hits: string[]): void {
  if (typeof node === 'string') {
    if (looksLikeSecret(node)) hits.push(path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findSecretShapedValues(v, `${path}[${i}]`, hits));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      findSecretShapedValues(v, path ? `${path}.${k}` : k, hits);
    }
  }
}

// ---------------------------------------------------------------------------
// Connector schema (Design 090 Section 5.1)
// ---------------------------------------------------------------------------

export const CONNECTOR_PROTOCOLS = ['openai-chat', 'anthropic-messages', 'ollama'] as const;
export type ConnectorProtocol = (typeof CONNECTOR_PROTOCOLS)[number];

/** Keys the request builder owns; request_overrides may never replace them. */
export const RESERVED_OVERRIDE_KEYS = ['model', 'messages', 'stream'] as const;

const CostSchema = z.object({
  input_per_million: z.number().nonnegative(),
  output_per_million: z.number().nonnegative(),
}).strict();

const ModelEntrySchema = z.object({
  id: z.string().min(1),
  context_window: z.number().int().positive().optional(),
  cost: CostSchema.optional(),
  notes: z.string().optional(),
}).strict();

const AuthSchema = z.object({
  credential_key: z.string().min(1).optional(),
  env_var: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'env_var must be an UPPER_SNAKE_CASE name').optional(),
  header: z.string().min(1).default('Authorization'),
  /** 'bearer' (default) prefixes the key with 'Bearer '; 'raw' sends it verbatim
   *  (e.g. Anthropic x-api-key). */
  scheme: z.enum(['bearer', 'raw']).default('bearer'),
}).strict();

const DefaultsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
}).strict();

const SovereigntySchema = z.object({
  data_residency: z.string().optional(),
  zero_retention: z.union([z.boolean(), z.literal('unknown')]).optional(),
  notes: z.string().optional(),
}).strict();

const MetaSchema = z.object({
  source: z.enum(['bundled', 'user']).optional(),
  last_reviewed: z.string().optional(),
  contributor: z.string().optional(),
  fetched_at: z.string().optional(),
}).strict();

const RequestOverridesSchema = z.record(z.string(), z.unknown()).superRefine((val, ctx) => {
  for (const key of RESERVED_OVERRIDE_KEYS) {
    if (key in val) {
      ctx.addIssue({
        code: 'custom',
        message: `request_overrides may not override reserved key "${key}"`,
      });
    }
  }
});

/** Per-environment partial override of connection fields (Design 082 4.4 carry-over). */
const EnvironmentSchema = z.object({
  base_url: z.string().url().optional(),
  path_prefix: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.object({
    default: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

const ConnectorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  description: z.string().optional(),
  protocol: z.enum(CONNECTOR_PROTOCOLS),
  base_url: z.string().url(),
  path_prefix: z.string().default(''),
  auth: AuthSchema.default({ header: 'Authorization', scheme: 'bearer' }),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.object({
    default: z.string().min(1),
    catalogue: z.array(ModelEntrySchema).optional(),
    discovery_endpoint: z.string().optional(),
  }).strict(),
  defaults: DefaultsSchema.optional(),
  request_overrides: RequestOverridesSchema.optional(),
  cost_per_token: CostSchema.optional(),
  environments: z.record(z.string(), EnvironmentSchema).optional(),
  active_env: z.string().optional(),
  sovereignty: SovereigntySchema.optional(),
  meta: MetaSchema.optional(),
}).strict();

export const ConnectorFileSchema = z.object({
  schema_version: z.string().regex(/^\d+\.\d+$/),
  connector: ConnectorSchema,
}).strict();

export type ConnectorFile = z.infer<typeof ConnectorFileSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type ConnectorModelEntry = z.infer<typeof ModelEntrySchema>;
export type ConnectorAuth = z.infer<typeof AuthSchema>;

// ---------------------------------------------------------------------------
// Parse + validate one connector YAML document
// ---------------------------------------------------------------------------

export type ParseConnectorResult =
  | { ok: true; file: ConnectorFile }
  | { ok: false; error: string };

export function parseConnectorYaml(yamlText: string, sourceLabel: string): ParseConnectorResult {
  let raw: unknown;
  try {
    raw = loadYaml(yamlText);
  } catch (err) {
    return { ok: false, error: `${sourceLabel}: invalid YAML -- ${String(err instanceof Error ? err.message : err)}` };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `${sourceLabel}: not a YAML mapping` };
  }

  // Secret-shape refusal runs BEFORE schema validation so a rejected file
  // never leaks its structure into error messages.
  const secretHits: string[] = [];
  findSecretShapedValues(raw, '', secretHits);
  if (secretHits.length > 0) {
    return {
      ok: false,
      error: `${sourceLabel}: refusing to parse -- secret-shaped value at ${secretHits.join(', ')}. ` +
        `Connector files name WHERE a key lives (auth.credential_key / auth.env_var), never the key itself.`,
    };
  }

  const versionRaw = (raw as Record<string, unknown>)['schema_version'];
  const major = typeof versionRaw === 'string' ? parseInt(versionRaw.split('.')[0] ?? '', 10) : NaN;
  if (!Number.isInteger(major)) {
    return { ok: false, error: `${sourceLabel}: missing or invalid schema_version (expected "1.0")` };
  }
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return {
      ok: false,
      error: `${sourceLabel}: unsupported schema_version major ${major} (this SWAO supports ${SUPPORTED_SCHEMA_MAJOR}.x). ` +
        `Update SWAO or downgrade the connector file.`,
    };
  }

  const parsed = ConnectorFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 3)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `${sourceLabel}: schema validation failed -- ${first}` };
  }
  return { ok: true, file: parsed.data };
}
