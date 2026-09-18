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
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { CredentialStore, logPortfolio } from '@swao/core';
import { getConnector } from '@swao/module-llm-providers';
import { PasswordInput, GuidanceBox } from '@swao/tui-kit';
import { type LlmProvider, BIN, SELF_ARGS, setWizardGuidanceOpen } from '../shared.js';

const CRED_PATH = join(homedir(), '.config', 'swao', '.swao-credentials.json');

function isCredentialStored(name: string): boolean {
  const envKey = `SWAO_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
  if (process.env[envKey]) return true;
  try {
    const creds = new CredentialStore().loadSync();
    return name in creds && !!creds[name];
  } catch { return false; }
}

// -- Step 3: Credentials --------------------------------------------------

export function CredentialsStep({
  provider,
  onNext,
  workspaceRoot,
  stepNumber = 3,
}: {
  provider: LlmProvider;
  onNext: () => void;
  workspaceRoot?: string;
  /** #2381: 1-indexed step position matching the wizard header display. */
  stepNumber?: number;
}) {
  const [status, setStatus] = useState('');
  const [testPhase, setTestPhase] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

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
    if (testPhase === 'fail' && key.return) { onNextRef.current(); }
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
    const child = spawn(BIN, [...SELF_ARGS, 'credential', 'set', name, value], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PKG_EXECPATH: '' },
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
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (gwConnector) {
          const proto = gwConnector.file.connector.protocol;
          const base = gwConnector.file.connector.base_url.replace(/\/$/, '');
          const model = gwConnector.file.connector.models.default;
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
            url = `${base}/v1/chat/completions`;
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
        const resp = await fetch(url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(reqBody), signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) {
          // #2383: log connectivity check result to portfolio event log
          const connId = gwConnector ? gwConnector.file.connector.id : (provider ?? 'unknown');
          const proto = gwConnector ? gwConnector.file.connector.protocol : (provider === 'anthropic' ? 'anthropic-messages' : 'openai-chat');
          try { logPortfolio('info', 'wizard.credentials.llm.ping.ok', 'Wizard LLM connectivity check succeeded', { context: { connector_id: connId, protocol: proto, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setTestPhase('ok');
        } else {
          // #2379: strip HTML bodies (Nginx/gateway error pages) from the error message.
          const rawText = await resp.text().catch(() => '');
          const isHtml = rawText.trimStart().startsWith('<');
          const errText = isHtml ? `server returned HTML (check gateway URL and credentials)` : rawText.slice(0, 120);
          const connId = gwConnector ? gwConnector.file.connector.id : (provider ?? 'unknown');
          const proto = gwConnector ? gwConnector.file.connector.protocol : (provider === 'anthropic' ? 'anthropic-messages' : 'openai-chat');
          // #2383: log connectivity check failure to portfolio event log
          try { logPortfolio('warn', 'wizard.credentials.llm.ping.fail', 'Wizard LLM connectivity check failed', { context: { connector_id: connId, protocol: proto, http_status: resp.status, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setTestPhase('fail');
          setTestMessage(`HTTP ${resp.status} -- ${errText}`);
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

  // #2162: Bedrock guidance panel -- no API key entry; inform user of AWS auth options.
  if (isBedrockConnector) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyanBright">Step 2 -- AWS Authentication (Bedrock)</Text>
        <Text>Amazon Bedrock uses the AWS SDK credential chain -- no API key is stored in SWAO.</Text>
        <Text> </Text>
        <Text bold>Ensure one of the following is active before running swao health-check:</Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>AWS SSO:        <Text color="yellow">aws sso login --profile {'<profile>'}</Text></Text>
          <Text>Environment:    <Text color="yellow">export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_REGION=...</Text></Text>
          <Text>IAM role:       EC2 / ECS / Lambda instance role (no action needed)</Text>
        </Box>
        <Text> </Text>
        <Text dimColor>Required IAM permission: bedrock:InvokeModel on the configured model ARN.</Text>
        <Text> </Text>
        <Text dimColor>Press Enter to continue</Text>
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  if (!needsCredential) return null;

  const isOpenLlm = provider === 'open-llm-provider';
  const llmLabel = gwConnector
    ? `API key for ${gwConnector.file.connector.name} (Enter to skip if unauthenticated)`
    : isOpenLlm
      ? 'Bearer token for Open LLM Provider (Enter to skip if unauthenticated)'
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
    ? (gwConnector.file.connector.description ?? 'Your platform administrator -- see the connector file')
    : isOpenLlm
      ? 'Your platform administrator -- see runbook docs/runbooks/llm-provider-swap.md'
      : provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://console.anthropic.com/settings/keys';
  const providerLabel = gwConnector
    ? gwConnector.file.connector.name
    : isOpenLlm ? 'Open LLM Provider' : provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const llmStatusLine = llmAlreadyStored
    ? `${providerLabel} token: stored (Enter to keep)`
    : `${providerLabel} token: NOT stored -- needed for authenticated endpoints`;

  // #2382: when connectivity check is running/done, show dedicated section
  // matching AssessScreen preflight-llm visual pattern.
  if (testPhase !== 'idle') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyanBright">Step {stepNumber} -- Credentials</Text>
        <Text> </Text>
        <Text bold>LLM connectivity check</Text>
        {testPhase === 'testing' && <Text color="yellow">Pinging connector...</Text>}
        {testPhase === 'ok' && (
          <Box flexDirection="column">
            <Text color="green">[ok]   <Text bold>{providerLabel}</Text>   reachable</Text>
            <Text> </Text>
            <Text dimColor>Press Enter to continue...</Text>
          </Box>
        )}
        {testPhase === 'fail' && (
          <Box flexDirection="column">
            <Text color="green">Key stored.</Text>
            <Text color="yellow">[warn]  Connectivity check failed for <Text bold>{providerLabel}</Text>: {testMessage}</Text>
            <Text> </Text>
            <Text dimColor>Continue with this key (assessment will attempt it), or press Esc to go back and re-enter.</Text>
          </Box>
        )}
        {status && <Text color="yellow">{status}</Text>}
        <GuidanceBox
          title={`Step ${stepNumber} -- Credentials`}
          what="Verifying connectivity to the configured LLM gateway before proceeding."
          details={[
            { label: 'Connector', value: providerLabel },
            ...(testPhase === 'fail' ? [{ label: 'Reason', value: testMessage }] : []),
          ]}
          affordances={testPhase === 'fail'
            ? ['Enter -- continue (key is stored)  |  Esc -- re-enter key']
            : testPhase === 'ok'
            ? ['Enter -- continue to next step']
            : []}
          onOpenChange={setWizardGuidanceOpen}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyanBright">Step {stepNumber} -- Credentials</Text>
      <Text dimColor>Values are stored locally. Enter to keep existing value. Never printed after entry.</Text>
      <Text>Storage: <Text bold color="whiteBright">{CRED_PATH}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        {llmAlreadyStored && <Text color="green">{providerLabel} token already stored -- press Enter to keep.</Text>}
        <PasswordInput
          label={llmAlreadyStored ? `${llmLabel} (Enter to keep existing)` : llmLabel}
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
      {status && <Text color="yellow">{status}</Text>}
      <GuidanceBox
        title={`Step ${stepNumber} -- Credentials`}
        what="Stored encrypted on this machine. Never printed in reports or logs."
        details={[
          { label: 'Token',     value: llmStatusLine },
          { label: 'Obtain at', value: obtainUrl },
        ]}
        affordances={['Enter -- save or keep existing  |  Esc -- back']}
        onOpenChange={setWizardGuidanceOpen}
      />
    </Box>
  );
}
