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

import { useState, useRef, useEffect } from 'react';
import { Box, useInput } from 'ink';
import { spawn } from 'child_process';
import { CredentialStore, logPortfolio } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { getConnector, connectorPostJson, openAiChatCompletionsUrl, resolveModelAlias } from '@swao/module-llm-providers';
import { PasswordInput, SelectInput, StatusRow, useOptionGuidance, type SelectOption } from '@swao/tui-kit';
import { type LlmProvider } from '../shared.js';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

function isCredentialStored(name: string): boolean {
  const envKey = `SWAO_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
  if (process.env[envKey]) return true;
  try {
    const creds = new CredentialStore().loadSync();
    return name in creds && !!creds[name];
  } catch { return false; }
}

// -- Credentials --------------------------------------------------------------

/** #4230: the entries of the menu after a failed connectivity check, each with its guidance entry. */
export function credentialFailOptions(testMessage: string, obtainUrl: string): SelectOption[] {
  return [
    { label: 'Continue with this key', value: 'continue', guidance: { title: 'Continue with this key', what: 'The key stays stored; the assessment tries it and the health check reports the connection again.', sections: [{ label: 'Reason', text: testMessage }] } },
    { label: 'Enter the key again', value: 'again', guidance: { title: 'Enter the key again', what: 'Back to the key input; a new key replaces the stored one and the check runs again.', sections: [{ label: 'Obtain at', text: obtainUrl }] } },
  ];
}

export function CredentialsStep({
  provider,
  onNext,
  workspaceRoot,
  model: selectedModel,
}: {
  provider: LlmProvider;
  onNext: () => void;
  workspaceRoot?: string;
  /** #3381: model chosen in the LLM step; the check pings it, not the connector default. */
  model?: string;
  /** #2381: 1-indexed step position matching the wizard header display. */
  stepNumber?: number;
}) {
  const [status, setStatus] = useState('');
  const [testPhase, setTestPhase] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  // #4230: the guidance of the failed check follows the highlighted entry.
  const { entry: failGuidance, onCursorChange: onFailCursor } = useOptionGuidance({
    title: 'Connectivity check failed',
    what: 'The key is stored, but the LLM did not answer the check request. Continue with it, or enter the key again.',
  });

  // #1400: gateway connector selection -- the connector file names the
  // credential-store entry; a connector without auth (ollama) needs nothing.
  const gwConnector = provider.startsWith('gw:')
    ? (() => { try { return getConnector(provider.slice(3), { workspaceRoot }); } catch { return undefined; } })()
    : undefined;
  const gwCredKey = gwConnector?.file.connector.auth.credential_key;
  const needsCredential = provider.startsWith('gw:')
    ? Boolean(gwCredKey)
    : (provider === 'anthropic' || provider === 'openai' || provider === 'open-llm-provider');

  // #2162: Bedrock connectors use the AWS SDK credential chain -- no API key
  // is stored in SWAO, but the user needs to know how to authenticate before
  // running swao health-check. Show an informational panel instead of skipping.
  const isBedrockConnector = gwConnector?.file.connector.protocol === 'bedrock';

  useInput((input, key) => {
    // #4254: a failed check offers "Continue with this key" and "Enter the key again" as list entries.
    // #2382: allow Enter to advance early when connectivity check succeeded.
    if (testPhase === 'ok' && key.return) { onNextRef.current(); }
    if (isBedrockConnector && (key.return || input === ' ')) { onNextRef.current(); }
  });

  // #0809: VCS token belongs in the Application Assessment flow (per-app),
  // not the global workspace wizard. Providers with no API key (ollama, skip)
  // have nothing to enter here; advance immediately to the next step.
  useEffect(() => {
    if (!needsCredential && !isBedrockConnector) {
      onNextRef.current();
    }
  }, []); // fires once on mount; provider is immutable for the wizard step lifetime

  // #2357/#2378: auto-advance after successful live test but with a 1.5s pause so
  // the user can see the green "[ok] connection successful" message before advancing.
  useEffect(() => {
    if (testPhase !== 'ok') return;
    const tid = setTimeout(() => onNextRef.current(), 1500);
    return () => clearTimeout(tid);
  }, [testPhase]);

  const storeCredential = (name: string, value: string, cb: () => void) => {
    if (!value) { cb(); return; }
    const selfCmd = selfSpawnCommand(['credential', 'set', name, value]);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
    });
    // #2326: call cb only after write completes so health-check reads the stored key.
    // #2367: error handler prevents unhandled error event crash on spawn failure.
    child.on('error', (err) => { setStatus(`Warning: could not store ${name}: ${err.message}`); cb(); });
    child.on('close', (code) => {
      if (code !== 0) setStatus(`Warning: could not store ${name}`);
      cb();
    });
  };

  // #2357: live connectivity ping after the key is stored -- same protocol logic as
  // AssessScreen preflight. On ok: auto-advance. On fail: show error, await Enter.
  const runTest = (apiKey: string) => {
    setTestPhase('testing');
    const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';
    const TIMEOUT_MS = 15_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const pingStart = Date.now();
    void (async () => {
      try {
        let url: string;
        let reqBody: Record<string, unknown>;
        let pingModel = '';
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (gwConnector) {
          const proto = gwConnector.file.connector.protocol;
          const base = gwConnector.file.connector.base_url.replace(/\/$/, '');
          // #4500: a ~vendor/family-latest alias goes through the same resolver as
          // the Health Check (gateway-probe.ts) and the assessment, so a model the
          // Health Check would reject never passes this ping.
          const model = await resolveModelAlias(selectedModel || gwConnector.file.connector.models.default, gwConnector.file.connector, apiKey);
          pingModel = model;
          if (proto === 'anthropic-messages') {
            url = `${base}/v1/messages`;
            reqBody = { model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
            reqHeaders['x-api-key'] = apiKey;
            reqHeaders['anthropic-version'] = '2023-06-01';
          } else if (proto === 'ollama') {
            url = `${base}/api/chat`;
            reqBody = { model, messages: [{ role: 'user', content: PING_PROMPT }], stream: false };
          } else {
            // #2540: OpenAI-compatible connectors (OpenRouter, vLLM, etc.) use /v1/chat/completions.
            // The base_url omits /v1 (e.g. https://openrouter.ai/api) so we append it here.
            url = openAiChatCompletionsUrl(base);
            reqBody = { model, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
            reqHeaders['Authorization'] = `Bearer ${apiKey}`;
          }
        } else if (provider === 'anthropic') {
          url = 'https://api.anthropic.com/v1/messages';
          reqBody = { model: 'claude-haiku-4-5-20251001', max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
          reqHeaders['x-api-key'] = apiKey;
          reqHeaders['anthropic-version'] = '2023-06-01';
        } else if (provider === 'openai') {
          url = 'https://api.openai.com/v1/chat/completions';
          reqBody = { model: 'gpt-4o-mini', max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
          reqHeaders['Authorization'] = `Bearer ${apiKey}`;
        } else {
          setTestPhase('idle');
          onNextRef.current();
          return;
        }
        // #3381: gateway connectors go through the connector's TLS and proxy rules
        // (tls.reject_unauthorized, HTTPS_PROXY, NO_PROXY), like the provider.
        const resp = gwConnector
          ? await connectorPostJson(url, reqHeaders, reqBody, { rejectUnauthorized: gwConnector.file.connector.tls?.reject_unauthorized === false ? false : undefined, signal: controller.signal })
          : await (async () => { const r = await fetch(url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(reqBody), signal: controller.signal }); return { ok: r.ok, status: r.status, text: r.ok ? '' : await r.text().catch(() => '') }; })();
        clearTimeout(timeoutId);
        if (resp.ok) {
          // #2383: log connectivity check result to portfolio event log
          const connId = gwConnector ? gwConnector.file.connector.id : (provider ?? 'unknown');
          const proto = gwConnector ? gwConnector.file.connector.protocol : (provider === 'anthropic' ? 'anthropic-messages' : 'openai-chat');
          try { logPortfolio('info', 'wizard.credentials.llm.ping.ok', 'Wizard LLM connectivity check succeeded', { context: { connector_id: connId, protocol: proto, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setTestPhase('ok');
        } else {
          // #2379: strip HTML bodies (Nginx/gateway error pages) from the error message.
          const rawText = resp.text;
          const isHtml = rawText.trimStart().startsWith('<');
          const errText = isHtml ? `server returned HTML (check gateway URL and credentials)` : rawText.slice(0, 120);
          const connId = gwConnector ? gwConnector.file.connector.id : (provider ?? 'unknown');
          const proto = gwConnector ? gwConnector.file.connector.protocol : (provider === 'anthropic' ? 'anthropic-messages' : 'openai-chat');
          // #2383: log connectivity check failure to portfolio event log
          try { logPortfolio('warn', 'wizard.credentials.llm.ping.fail', 'Wizard LLM connectivity check failed', { context: { connector_id: connId, protocol: proto, model: pingModel || null, http_status: resp.status, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setTestPhase('fail');
          setTestMessage(`HTTP ${resp.status}${pingModel ? ` (model ${pingModel})` : ''}: ${errText}`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const connId = gwConnector ? gwConnector.file.connector.id : (provider ?? 'unknown');
        const errMsg = (err as Error).name === 'AbortError' ? `no response after ${TIMEOUT_MS / 1000}s` : (err as Error).message.slice(0, 80);
        // #2383: log connectivity check error to portfolio event log
        try { logPortfolio('warn', 'wizard.credentials.llm.ping.fail', 'Wizard LLM connectivity check error', { context: { connector_id: connId, error: errMsg, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
        setTestPhase('fail');
        setTestMessage(errMsg);
      }
    })();
  };

  // #4254 (Design 126 sections 4.5, 6, 8 and 9): every view renders through
  // SetupStepFrame (step title without a number, the hint line of its input
  // kind, one guidance box); states are StatusRows; no profile path on screen
  // (the vault location is in the guidance). Esc belongs to the wizard.
  const title = 'Credentials';

  // #2162: Bedrock guidance panel: no API key entry; inform the operator of the AWS auth options.
  if (isBedrockConnector) {
    return (
      <SetupStepFrame
        title={title}
        subtitle="Amazon Bedrock uses the AWS SDK credential chain; no API key is stored in SWAO."
        kind="confirm"
        guidance={{
          title: 'AWS authentication (Bedrock)',
          what: 'SWAO calls Amazon Bedrock with the AWS SDK credential chain of this machine. One of the options must be active before the health check and the assessment run.',
          sections: [
            { label: 'AWS SSO', text: 'aws sso login with your AWS profile.' },
            { label: 'Environment', text: 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION set in the shell that starts SWAO.' },
            { label: 'IAM role', text: 'An EC2, ECS or Lambda instance role; no action needed.' },
            { label: 'Permission', text: 'bedrock:InvokeModel on the configured model ARN.' },
          ],
        }}
      >
        <Box flexDirection="column">
          <StatusRow level="info" label="Bedrock" summary="AWS SSO, environment variables or an instance role; details in the guidance." labelWidth={10} />
          {status ? <StatusRow level="warn" label="Vault" summary={status} labelWidth={10} /> : null}
        </Box>
      </SetupStepFrame>
    );
  }

  if (!needsCredential) return null;

  const isOpenLlm = provider === 'open-llm-provider';
  const llmLabel = gwConnector
    ? `API key for ${gwConnector.file.connector.name} (empty if unauthenticated)`
    : isOpenLlm
      ? 'Bearer token for Open LLM Provider (empty if unauthenticated)'
      : provider === 'openai'
        ? 'OpenAI API key (sk-...)'
        : 'Anthropic API key (sk-ant-...)';
  const credName = gwCredKey
    ?? (isOpenLlm
      ? `open-llm-api-key-${process.env['SWAO_LLM_ENV'] ?? 'prod'}`
      : provider === 'openai'
        ? 'openai-api-key'
        : 'anthropic-api-key');
  const llmAlreadyStored = isCredentialStored(credName);
  const obtainUrl = gwConnector
    ? (gwConnector.file.connector.description ?? 'Your platform administrator; see the connector file')
    : isOpenLlm
      ? 'Your platform administrator; see runbook docs/runbooks/llm-provider-swap.md'
      : provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://console.anthropic.com/settings/keys';
  const providerLabel = gwConnector
    ? gwConnector.file.connector.name
    : isOpenLlm ? 'Open LLM Provider' : provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const labelWidth = Math.max(10, providerLabel.length + 2);

  // #2382: when the connectivity check is running or done, show its result.
  if (testPhase !== 'idle') {
    const failOptions = credentialFailOptions(testMessage, obtainUrl);
    return (
      <SetupStepFrame
        title={title}
        subtitle="LLM connectivity check"
        kind={testPhase === 'fail' ? 'picker' : 'confirm'}
        guidance={testPhase === 'fail' ? failGuidance : {
          title: 'LLM connectivity check',
          what: 'Verifies the connection to the configured LLM with a short request before the setup goes on.',
          sections: [{ label: 'Connector', text: providerLabel }],
        }}
      >
        <Box flexDirection="column">
          {testPhase === 'testing' && <StatusRow level="waiting" label={providerLabel} summary="checking the connection" labelWidth={labelWidth} />}
          {testPhase === 'ok' && <StatusRow level="ok" label={providerLabel} summary="reachable" labelWidth={labelWidth} />}
          {testPhase === 'fail' && (
            <>
              <StatusRow level="ok" label="Key" summary="stored in the vault" labelWidth={labelWidth} />
              <StatusRow level="warn" label={providerLabel} summary={`connectivity check failed: ${testMessage}`} labelWidth={labelWidth} />
              <Box marginTop={1}>
                <SelectInput
                  label=""
                  options={failOptions}
                  numbered
                  showKeyHints={false}
                  visibleCount={failOptions.length}
                  onCursorChange={onFailCursor}
                  onSelect={(v) => {
                    if (v === 'again') { setTestPhase('idle'); setTestMessage(''); return; }
                    onNextRef.current();
                  }}
                />
              </Box>
            </>
          )}
          {status && <StatusRow level="warn" label="Vault" summary={status} labelWidth={labelWidth} />}
        </Box>
      </SetupStepFrame>
    );
  }

  return (
    <SetupStepFrame
      title={title}
      subtitle="Stored encrypted on this machine; never printed after entry."
      kind="textInput"
      guidance={{
        title: `${providerLabel} credential`,
        what: llmAlreadyStored
          ? 'A key is already stored. An empty entry keeps it and checks the connection with it; a new key replaces it.'
          : 'The key is needed for authenticated endpoints. It is stored encrypted in the SWAO credential vault on this machine and never printed in reports or logs.',
        sections: [
          { label: 'Stored as', text: credName },
          { label: 'Obtain at', text: obtainUrl },
        ],
      }}
    >
      <Box flexDirection="column">
        <StatusRow
          level={llmAlreadyStored ? 'ok' : 'missing'}
          label={providerLabel}
          summary={llmAlreadyStored ? 'key stored; an empty entry keeps it' : 'no key stored, needed for authenticated endpoints'}
          labelWidth={labelWidth}
        />
        <Box marginTop={1}>
          <PasswordInput
            label={llmLabel}
            onSubmit={(v) => {
              if (v) {
                storeCredential(credName, v, () => runTest(v));
              } else {
                // #2354: when credential already stored, test with the stored
                // value instead of advancing silently so the user sees
                // whether the key is still valid.
                try {
                  const stored = new CredentialStore().loadSync();
                  const existingKey = stored[credName];
                  if (existingKey) { runTest(existingKey); return; }
                } catch { /* best-effort: fall through to onNext */ }
                onNext();
              }
            }}
            active
          />
        </Box>
        {status && <StatusRow level="warn" label="Vault" summary={status} labelWidth={labelWidth} />}
      </Box>
    </SetupStepFrame>
  );
}
