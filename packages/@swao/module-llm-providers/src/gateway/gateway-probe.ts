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
  ok: boolean;
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
    // #2410: detect endpoint/key mismatch -- OpenRouter key used against api.openai.com is the
    // most common operator error (sk-or-v1* keys must go to openrouter.ai, not openai.com).
    if (opts.baseUrl && /openai\.com/i.test(opts.baseUrl) && opts.credentialKey) {
      return `authentication failed -- endpoint is api.openai.com but the credential key may be an OpenRouter key. If you have an OpenRouter key (sk-or-v1*), set base_url to https://openrouter.ai/api/v1 in the connector${keyHint}`;
    }
    return `authentication failed -- API key missing, wrong, or revoked${keyHint}`;
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
  const credentialKey = loaded.file.connector.auth?.credential_key;
  // Resolve ~-prefix model aliases before pinging (#1817).
  let apiKey: string | undefined;
  if (credentialKey) {
    try {
      const store = new CredentialStore().loadSync();
      apiKey = store[credentialKey] || undefined;
    } catch { /* store unavailable */ }
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
    const raw = err instanceof Error ? err.message : String(err);
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
    const failed = results.filter(r => !r.ping.ok);
    if (failed.length === 0) {
      const primaryMsg = results[0]!.ping.message;
      const suffix = results.length > 1
        ? ` (${results.length} connectors checked: ${results.map(r => r.label).join(', ')})`
        : '';
      return {
        ok: true,
        message: `${primaryMsg}${suffix}; ${connectors.length} connector(s) discovered (${bundled} bundled, ${workspace} workspace)`,
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
