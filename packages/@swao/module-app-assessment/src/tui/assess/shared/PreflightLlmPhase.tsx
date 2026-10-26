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
import { buildPreflightRequest, type PreflightRequest } from './preflight-request.js';

type PingStatus = 'running' | 'ok' | 'warn' | 'fail';

/** POST the preflight request with the global fetch (no certificate bypass in the TUI, #3385). */
async function sendPreflight(req: PreflightRequest, signal: AbortSignal): Promise<{ ok: boolean; status: number; text: string }> {
  const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  return { ok: resp.ok, status: resp.status, text: resp.ok ? '' : await resp.text().catch(() => '') };
}

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
  /** #3383: run the deterministic passes only (adds --skip-llm), offered when the
   *  gateway check does not pass. Omit to hide the option (e.g. LZ-only runs). */
  onRunWithoutLlm?: () => void;
  Header: ComponentType<{ subtitle?: string }>;
}

// #2328: LLM preflight phase -- pings the active gateway connector before starting the run.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function PreflightLlmPhase({ connector, apiKey, app, typeLabel, onPass, onBack, onRunWithoutLlm, Header }: PreflightLlmPhaseProps): JSX.Element {
  const guidanceOpenRef = useRef(false);
  const [results, setResults] = useState<PreflightResult[]>([
    { connectorId: connector.id, status: 'running', message: 'checking...' },
  ]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const PING_TIMEOUT_MS = 20_000;

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
      const req = buildPreflightRequest(connector, apiKey);
      try {
        const resp = await sendPreflight(req, controller.signal);
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (resp.ok) {
          // #2383: log preflight ping result to portfolio event log for operator visibility
          try { logPortfolio('info', 'assess.preflight.llm.ping.ok', 'LLM preflight ping succeeded', { context: { app, connector_id: connector.id, protocol: connector.protocol, model: req.model, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setResults([{ connectorId: connector.id, status: 'ok', message: `reachable (${req.model})` }]);
          setDone(true);
          onPass();
        } else {
          // #2383: log preflight ping failure to portfolio event log
          try { logPortfolio('warn', 'assess.preflight.llm.ping.fail', 'LLM preflight ping failed', { context: { app, connector_id: connector.id, protocol: connector.protocol, model: req.model, endpoint: req.url, http_status: resp.status, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
          setResults([{ connectorId: connector.id, status: 'fail', message: `HTTP ${resp.status} (${req.model}): ${resp.text.slice(0, 80)}` }]);
          setDone(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        const certError = !!cause && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause);
        // #3385: the pre-check never bypasses certificate checks itself. When the
        // connector disables verification, the provider applies it during the run,
        // so a certificate error here is a warning, not a failure.
        if (certError && connector.rejectUnauthorized === false) {
          try { logPortfolio('info', 'assess.preflight.llm.ping.tls-skipped', 'LLM preflight: certificate not checked (connector disables TLS verification)', { context: { app, connector_id: connector.id, model: req.model, cause } }); } catch { /* best-effort */ }
          setResults([{ connectorId: connector.id, status: 'warn', message: `certificate not checked by the pre-check (connector sets tls.reject_unauthorized: false; the assessment applies it). Model: ${req.model}` }]);
          setDone(true);
          return;
        }
        const msg = (err as Error).name === 'AbortError'
          ? `timed out after ${PING_TIMEOUT_MS / 1000}s`
          : certError
            ? `TLS certificate not trusted (${cause}): set tls.reject_unauthorized: false or tls.ca_bundle in the connector YAML`
            : (err as Error).message;
        // #2383: log preflight ping error to portfolio event log
        try { logPortfolio('warn', 'assess.preflight.llm.ping.fail', 'LLM preflight ping error', { context: { app, connector_id: connector.id, error: msg, duration_ms: Date.now() - pingStart } }); } catch { /* best-effort */ }
        setResults([{ connectorId: connector.id, status: 'fail', message: msg }]);
        setDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) onBack();
    if (done && key.return) onPass();
    // #3383: W starts the run without the LLM (deterministic passes only).
    if (done && onRunWithoutLlm && (input === 'w' || input === 'W') && results.some(r => r.status === 'warn' || r.status === 'fail')) onRunWithoutLlm();
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
          {onRunWithoutLlm && (
            <Text dimColor>Press <Text color="cyanBright">W</Text> to run without the LLM (deterministic passes only; no CTX, compliance or blocks).</Text>
          )}
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
