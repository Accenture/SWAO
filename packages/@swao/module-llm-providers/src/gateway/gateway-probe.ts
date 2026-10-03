// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- doctor probe contribution (#1402, #1410)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Host-injected into @swao/module-health-check (sibling modules must not
// import each other; same mediation pattern as the audit-ingestion probe).
// Message uses the bracketed-state prefix convention ([PASS]/[WARNING]) that
// the health-check formatter maps onto aligned status tokens.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { ProbeContribution } from '@swao/core';
import { CredentialStore } from '@swao/core';
import { getConnector, listConnectors } from './connector-loader.js';
import { createProviderFromConnector } from './resolve.js';
import { resolveModelAlias } from './alias-resolver.js';

export interface GatewayProbeContribution {
  // #2897: null = credential not loaded (skip live ping; run session setup first).
  ok: boolean | null;
  message: string;
}

/** Host-injectable ProbeContribution wrapper (#1402). */
export const llmGatewayProbeContribution: ProbeContribution = {
  id: 'llm-gateway',
  name: 'LLM gateway',
  run: async ({ workspacePath }) => buildLlmGatewayProbe(workspacePath),
};

// #1410 / #2751: hard ceiling for the live ping. 35 s covers the open-llm-provider
// MAX_RETRIES=3 back-off schedule (3 s + 6 s + 12 s = 21 s sleep + fetch latency)
// so the timeout never fires mid-retry for transient 503 responses. The previous
// 20 s ceiling fired during the third retry sleep, losing the HTTP 503 status from
// the thrown error and producing the misleading "endpoint unreachable" message.
const PING_TIMEOUT_MS = 35_000;
const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';

interface ActiveConnectorSpec {
  connector: string;
  model?: string;
  label: string;
}

/** Read all configured LLM connectors from the workspace .swao.yml:
 *  primary, secondary, and any unique leg connectors (#1814). Env-var
 *  override wins and returns a single entry (spawned child context). */
function readAllActiveConnectors(workspaceRoot?: string | null): ActiveConnectorSpec[] {
  const envConnector = process.env['SWAO_LLM_CONNECTOR'];
  if (envConnector) {
    return [{ connector: envConnector, model: process.env['SWAO_LLM_MODEL'], label: 'env' }];
  }
  if (!workspaceRoot) return [];
  try {
    const raw = loadYaml(readFileSync(join(workspaceRoot, '.swao.yml'), 'utf-8')) as Record<string, unknown> | null;
    const providers = raw?.['providers'] as Record<string, unknown> | undefined;
    const llm = providers?.['llm'] as Record<string, unknown> | undefined;
    const results: ActiveConnectorSpec[] = [];
    const seen = new Set<string>();

    const push = (slot: Record<string, unknown> | undefined, label: string) => {
      const connector = typeof slot?.['connector'] === 'string' ? slot['connector'] : undefined;
      const model = typeof slot?.['model'] === 'string' ? slot['model'] : undefined;
      if (!connector) return;
      const key = `${connector}::${model ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ connector, model, label });
    };

    push(llm?.['primary'] as Record<string, unknown> | undefined, 'primary');
    push(llm?.['secondary'] as Record<string, unknown> | undefined, 'secondary');

    const legs = raw?.['llm_assessment'] as Record<string, unknown> | undefined;
    const legList = legs?.['legs'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(legList)) {
      legList.forEach((leg, i) => push(leg, `leg[${i}]`));
    }

    return results;
  } catch {
    return [];
  }
}

/** Map a raw driver error onto an actionable operator hint. Never echoes
 *  credential values; only the credential KEY name may appear. */
export function classifyPingFailure(rawMessage: string, opts: { credentialKey?: string; model: string; baseUrl?: string }): string {
  const msg = rawMessage.toLowerCase();
  const keyHint = opts.credentialKey ? ` (credential key: ${opts.credentialKey})` : '';

  // AWS SDK semantic exception names (#2160): checked before generic HTTP patterns
  // because AWS throws named exceptions, not HTTP status codes.
  if (/AccessDeniedException|UnrecognizedClientException/i.test(rawMessage)) {
    return 'AWS credentials rejected -- check AWS_PROFILE, aws sso login, or IAM bedrock:InvokeModel permission';
  }
  if (/ValidationException|ResourceNotFoundException/i.test(rawMessage)) {
    return `model '${opts.model}' not valid for this region -- check the model id and active_env in bedrock.yaml`;
  }
  if (/ModelNotReadyException/i.test(rawMessage)) {
    return `model '${opts.model}' not enabled -- request access in the AWS Bedrock Console for your region`;
  }
  if (/ThrottlingException/i.test(rawMessage)) {
    return `AWS throttling -- retries exhausted; check quota or request limit increase in Bedrock Console`;
  }

  // #2751: 503 classified before the generic timeout check. 503 appears in the
  // LlmConnectivityError message when all retries exhaust on a transient HTTP error.
  if (msg.includes('503') || msg.includes('service unavailable')) {
    return 'endpoint returned HTTP 503 Service Unavailable -- model may be loading, under maintenance, or overloaded; retry in a few minutes or check with the platform team';
  }
  if (msg.includes('402') || msg.includes('payment required') || msg.includes('insufficient credits')) {
    return `platform reports no credits (HTTP 402) -- add prepaid credits on the provider account${keyHint}`;
  }
  // Check 404 before auth keywords: an OpenRouter 404 "No endpoints found" response
  // can contain "authentication" in its body, causing misclassification (#1816).
  if (msg.includes('404') || msg.includes('no endpoints found') || (msg.includes('model') && (msg.includes('not found') || msg.includes('invalid') || msg.includes('unknown')))) {
    return `model '${opts.model}' rejected by the platform -- check the model id`;
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
    // #2897: ADFS/JWT token expiry -- distinct from a wrong key; re-login is the fix.
    if (/jwt is expired|token is expired|jwt expired|access token.*expired/i.test(rawMessage)) {
      return `authentication token expired (JWT) -- re-run 'swao session setup' to refresh the ADFS token${keyHint}`;
    }
    // #2410: detect endpoint/key mismatch -- OpenRouter key used against api.openai.com is the
    // most common operator error (sk-or-v1* keys must go to openrouter.ai, not openai.com).
    if (opts.baseUrl && /openai\.com/i.test(opts.baseUrl) && opts.credentialKey) {
      return `authentication failed -- endpoint is api.openai.com but the credential key may be an OpenRouter key. If you have an OpenRouter key (sk-or-v1*), set base_url to https://openrouter.ai/api/v1 in the connector${keyHint}`;
    }
    return `authentication failed -- API key missing, wrong, or revoked${keyHint}`;
  }
  // #2894 Part A: TLS cert errors fail fast (< 2 s); surface before the generic
  // timeout/unreachable check so operators see the real cause, not "35 s timeout".
  if (/ERR_TLS_|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/i.test(rawMessage)) {
    return `TLS certificate error -- endpoint reachable but cert not trusted by Node.js. ` +
      `Fix: set NODE_EXTRA_CA_CERTS=<ca-bundle.pem>, or set tls.reject_unauthorized: false in the connector YAML${keyHint}`;
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return `no response within ${PING_TIMEOUT_MS / 1000}s -- endpoint unreachable or overloaded`;
  }
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed') || msg.includes('econnreset')) {
    return 'endpoint unreachable -- check base_url, network, or proxy settings';
  }
  return rawMessage.slice(0, 160);
}

/** #1410: live connectivity ping of the ACTIVE connector. Sends a minimal
 *  prompt through the real driver (negligible token cost) so bad keys,
 *  missing credits, wrong model ids, and dead endpoints surface in the
 *  health check instead of mid-assessment. */
async function pingActiveConnector(
  workspaceRoot: string | null | undefined,
  active: { connector: string; model?: string },
): Promise<GatewayProbeContribution> {
  const loaded = getConnector(active.connector, { workspaceRoot: workspaceRoot ?? undefined });
  if (!loaded) {
    const available = listConnectors({ workspaceRoot: workspaceRoot ?? undefined })
      .connectors.map(c => c.file.connector.id);
    return {
      ok: false,
      message: `[WARNING] active connector '${active.connector}' not found -- available: ${available.join(', ') || '(none)'}`,
    };
  }
  const auth = loaded.file.connector.auth;
  const credentialKey = auth?.credential_key;
  const envVar = auth?.env_var;

  // #2897: env var = live session token; vault = may be expired (ADFS 60-min TTL).
  // Resolve ~-prefix model aliases before pinging (#1817).
  let apiKey: string | undefined;
  if (envVar) {
    // Env-var-configured connectors: check env var first (#2901 order).
    apiKey = process.env[envVar] || undefined;
    if (!apiKey) {
      // Env var absent. Check vault -- if vault holds a key it is likely stale (ADFS TTL).
      // Return ok: null so the operator gets a clear "run session-setup" hint rather than
      // a misleading 401 that looks like a wrong key.
      let vaultHasKey = false;
      if (credentialKey) {
        try {
          const store = new CredentialStore().loadSync();
          vaultHasKey = credentialKey in store && !!store[credentialKey];
        } catch { /* vault unavailable */ }
      }
      const vaultHint = vaultHasKey
        ? ` The credential vault holds a stored key that may be expired (ADFS token TTL 60 min).`
        : '';
      return {
        ok: null,
        message: `[N/A] ${envVar} not set in this terminal -- live ping skipped.${vaultHint} Re-run 'swao session setup' to refresh the token, then run health-check again.`,
      };
    }
  } else if (credentialKey) {
    // Vault-only connector (static API key; no env_var configured).
    try {
      const store = new CredentialStore().loadSync();
      apiKey = store[credentialKey] || undefined;
    } catch { /* store unavailable */ }
    if (!apiKey) {
      return {
        ok: null,
        message: `[N/A] credential '${credentialKey}' not loaded -- run 'swao session setup' to load the API key before the live ping`,
      };
    }
  }
  const activeModel = active.model
    ? await resolveModelAlias(active.model, loaded.file.connector, apiKey)
    : active.model;
  let model = activeModel ?? '';
  try {
    const resolved = createProviderFromConnector(loaded, { model: activeModel });
    model = resolved.provider.model;
    const started = Date.now();
    await Promise.race([
      resolved.provider.complete(PING_PROMPT),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`live ping timed out after ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS).unref?.(),
      ),
    ]);
    const ms = Date.now() - started;
    return {
      ok: true,
      message: `[PASS] live ping OK -- connector '${active.connector}', model '${model}', ${ms} ms round trip`,
    };
  } catch (err) {
    // #2894 Part A: Node.js fetch() wraps TLS errors as TypeError("fetch failed") with
    // err.cause carrying the TLS error code. Build the raw message to include the cause
    // so classifyPingFailure can match TLS patterns rather than the generic "fetch failed".
    let raw = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.cause instanceof Error) {
      const causeCode = (err.cause as { code?: string }).code;
      if (causeCode) raw = `${raw}: ${causeCode} (${err.cause.message})`;
    }
    return {
      ok: false,
      message: `[WARNING] connector '${active.connector}' live ping FAILED: ` +
        classifyPingFailure(raw, { credentialKey, model: model || active.model || '(connector default)' }),
    };
  }
}

export async function buildLlmGatewayProbe(workspaceRoot?: string | null): Promise<GatewayProbeContribution> {
  const { connectors, warnings } = listConnectors({ workspaceRoot: workspaceRoot ?? undefined });
  const bundled = connectors.filter(c => c.origin === 'bundled').length;
  const workspace = connectors.length - bundled;

  if (connectors.length === 0) {
    return {
      ok: false,
      message: '[WARNING] no LLM-Gateway connectors discovered -- bundled seeds missing from the build (dist/_llm-gateway)',
    };
  }
  if (warnings.length > 0) {
    const first = warnings[0] ?? '';
    return {
      ok: false,
      message: `[WARNING] ${connectors.length} connector(s) valid (${bundled} bundled, ${workspace} workspace); ` +
        `${warnings.length} file(s) skipped -- ${first.slice(0, 120)}`,
    };
  }

  // #1410 / #1814: when connectors are ACTIVE (workspace .swao.yml or env),
  // verify all of them (primary + secondary + leg connectors) end to end.
  // Discovery alone said OK while the platform behind the connector was
  // unusable; and probing only primary missed broken secondary/leg keys.
  const activeSpecs = readAllActiveConnectors(workspaceRoot);
  if (activeSpecs.length > 0) {
    const results: Array<{ label: string; ping: GatewayProbeContribution }> = [];
    for (const spec of activeSpecs) {
      const ping = await pingActiveConnector(workspaceRoot, { connector: spec.connector, model: spec.model });
      results.push({ label: spec.label, ping });
    }
    // #2897: ok === false = hard failure; ok === null = credential not loaded (SKIP).
    const failed = results.filter(r => r.ping.ok === false);
    const skipped = results.filter(r => r.ping.ok === null);
    if (failed.length === 0) {
      if (skipped.length === 0) {
        // All connectors passed.
        const primaryMsg = results[0]!.ping.message;
        const suffix = results.length > 1
          ? ` (${results.length} connectors checked: ${results.map(r => r.label).join(', ')})`
          : '';
        return {
          ok: true,
          message: `${primaryMsg}${suffix}; ${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace)`,
        };
      }
      // Some credentials not loaded -- no hard failure but live ping was skipped.
      const primaryResult = results.find(r => r.label === 'primary') ?? results[0]!;
      if (primaryResult.ping.ok === null) {
        return {
          ok: null,
          message: `${primaryResult.ping.message}; ${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace)`,
        };
      }
      // Primary passed; secondary/leg credential(s) not loaded -- informational only.
      const primaryMsg = primaryResult.ping.message;
      const suffix = results.length > 1
        ? ` (${results.length} connectors checked: ${results.map(r => r.label).join(', ')})`
        : '';
      return {
        ok: true,
        message: `${primaryMsg}${suffix}; ${skipped.length} secondary/leg credential(s) not loaded -- run 'swao session setup'; ` +
          `${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace)`,
      };
    }

    // #2392: a secondary or leg connector probe failure must NOT be reported as
    // a gateway-level failure when the primary connector is healthy.
    // Only the primary connector's reachability determines ok/fail for the
    // gateway category; secondary/leg failures are warnings included in the
    // message so operators can see them but assessments are not blocked.
    const primaryResult = results.find(r => r.label === 'primary');
    const primaryPassed = primaryResult?.ping.ok === true;
    if (primaryPassed) {
      const primaryMsg = primaryResult!.ping.message;
      const suffix = results.length > 1
        ? ` (${results.length} connectors checked: ${results.map(r => r.label).join(', ')})`
        : '';
      const warnNote = failed.map(r => `${r.label}: ${classifyPingFailure(r.ping.message, { model: r.label })}`).join('; ');
      return {
        ok: true,
        message: `${primaryMsg}${suffix}; ${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace)` +
          `; ${failed.length} secondary/leg probe warning(s): ${warnNote}`,
      };
    }

    // #1837: primary failed (or env-only context) -- include both pass/fail in message.
    const passing = results.filter(r => r.ping.ok).map(r => r.label);
    const first = failed[0]!;
    const passingNote = passing.length > 0 ? ` (${passing.join(', ')}: OK)` : '';
    const moreNote = failed.length > 1 ? `; ${failed.length - 1} more connector(s) also failed` : '';
    return {
      ok: false,
      message: `${first.ping.message} [${first.label}]${passingNote}${moreNote}`,
    };
  }

  return {
    ok: true,
    message: `[PASS] ${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace); ` +
      'all files schema-valid (no active connector; discovery-only)',
  };
}
