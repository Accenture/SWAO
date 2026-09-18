// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #2328: LLM preflight connectivity check phase, extracted from AssessScreen (#2371).
// Parent resolves the connector and apiKey before entering this phase.
// This component owns the ping useEffect, local results state, and keyboard handlers.
// All subprocess management stays in the parent screen's state machine.

import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { Box, Text, useInput } from 'ink';
import { logPortfolio } from '@swao/core';
import { GuidanceBox } from '@swao/tui-kit';
import type { LocalConnectorInfo } from './types.js';

type PingStatus = 'running' | 'ok' | 'warn' | 'fail';

interface PreflightResult {
  connectorId: string;
  status: PingStatus;
  message: string;
}

export interface PreflightLlmPhaseProps {
  connector: LocalConnectorInfo;
  apiKey: string | undefined;
  app: string;
  typeLabel: string;
  onPass: () => void;
  onBack: () => void;
  Header: ComponentType<{ subtitle?: string }>;
}

// #2328: LLM preflight phase -- pings the active gateway connector before starting the run.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function PreflightLlmPhase({ connector, apiKey, app, typeLabel, onPass, onBack, Header }: PreflightLlmPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const [results, setResults] = useState<PreflightResult[]>([
    { connectorId: connector.id, status: 'running', message: 'checking...' },
  ]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const PING_TIMEOUT_MS = 20_000;
    const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';

    void (async () => {
      if (!apiKey) {
        if (!cancelled) {
          setResults([{ connectorId: connector.id, status: 'warn', message: 'no credential stored -- skipping ping' }]);
          setDone(true);
        }
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      const pingStart = Date.now();
      try {
        const proto = connector.protocol;
        let url: string;
        let reqBody: Record<string, unknown>;
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (proto === 'anthropic-messages') {
          url = `${connector.baseUrl}/v1/messages`;
          reqBody = { model: connector.defaultModel, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
          reqHeaders['x-api-key'] = apiKey;
          reqHeaders['anthropic-version'] = '2023-06-01';
        } else if (proto === 'ollama') {
          url = `${connector.baseUrl}/api/chat`;
          reqBody = { model: connector.defaultModel, messages: [{ role: 'user', content: PING_PROMPT }], stream: false };
        } else {
          // openai-chat and bedrock (OpenAI-compatible path)
          url = `${connector.baseUrl}/chat/completions`;
          reqBody = { model: connector.defaultModel, max_tokens: 16, messages: [{ role: 'user', content: PING_PROMPT }] };
          reqHeaders['Authorization'] = `Bearer ${apiKey}`;
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (resp.ok) {
          // #2383: log preflight ping result to portfolio event log for operator visibility
          try { logPortfolio('info', 'assess.preflight.llm.ping.ok', 'LLM preflight ping succeeded', { context: { app, connector_id: connector.id, protocol: connector.protocol, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setResults([{ connectorId: connector.id, status: 'ok', message: 'reachable' }]);
          setDone(true);
          onPass();
        } else {
          const errText = await resp.text().catch(() => '');
          // #2383: log preflight ping failure to portfolio event log
          try { logPortfolio('warn', 'assess.preflight.llm.ping.fail', 'LLM preflight ping failed', { context: { app, connector_id: connector.id, protocol: connector.protocol, http_status: resp.status, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setResults([{ connectorId: connector.id, status: 'fail', message: `HTTP ${resp.status}: ${errText.slice(0, 80)}` }]);
          setDone(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const msg = (err as Error).name === 'AbortError'
          ? `timed out after ${PING_TIMEOUT_MS / 1000}s`
          : (err as Error).message;
        // #2383: log preflight ping error to portfolio event log
        try { logPortfolio('warn', 'assess.preflight.llm.ping.fail', 'LLM preflight ping error', { context: { app, connector_id: connector.id, error: msg, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
        setResults([{ connectorId: connector.id, status: 'fail', message: msg }]);
        setDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) onBack();
    if (done && key.return) onPass();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={typeLabel} />
      <Text>App: <Text color="cyanBright">{app}</Text></Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>LLM connectivity check</Text>
        {results.map(r => {
          const col = r.status === 'ok' ? 'green' : r.status === 'warn' ? 'yellow' : r.status === 'fail' ? 'red' : 'gray';
          const icon = r.status === 'ok' ? '[ok]' : r.status === 'warn' ? '[warn]' : r.status === 'fail' ? '[fail]' : '[..]';
          return (
            <Text key={r.connectorId}>
              <Text color={col}>{icon}</Text>{'  '}{r.connectorId}{'  '}<Text dimColor>{r.message}</Text>
            </Text>
          );
        })}
      </Box>
      {done && results.some(r => r.status === 'warn' || r.status === 'fail') && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">One or more connectors could not be verified.</Text>
          <Text dimColor>Press <Text color="cyanBright">Enter</Text> to start anyway, or <Text color="cyanBright">Esc</Text> to go back and fix credentials.</Text>
        </Box>
      )}
      {!done && (
        <Box marginTop={1}>
          <Text dimColor>Pinging connector...</Text>
        </Box>
      )}
      <GuidanceBox
        title="LLM connectivity check"
        what="Sends a minimal test prompt to verify the LLM gateway connector is reachable before the assessment run. A warn or fail result means the synthesis, compliance, and block-assessment passes may fail mid-run."
        details={[
          { label: 'Timeout', value: '20 seconds per connector' },
          { label: 'Credential', value: 'Read from the SWAO vault using the connector credential key' },
        ]}
        affordances={['Ctrl+G -- close guidance']}
        onOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
    </Box>
  );
}
