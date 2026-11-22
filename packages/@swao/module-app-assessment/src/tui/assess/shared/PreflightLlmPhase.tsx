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
import { Box, useInput } from 'ink';
import { logPortfolio } from '@swao/core';
import { DetailRow, PICKER_VISIBLE_COUNT, SelectInput, StatusRow, guidanceOwnsKey, useOptionGuidance, type KeyHint, type SelectOption } from '@swao/tui-kit';
import { FlowFrame, type FlowFrameBase } from './flow-frame.js';
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
  onPass: () => void;
  onBack: () => void;
  /** #3383: run the deterministic passes only (adds --skip-llm), offered when the
   *  gateway check does not pass. Omit to hide the option (e.g. LZ-only runs). */
  onRunWithoutLlm?: () => void;
  /** #4256: the flow frame of the screen (header, licence line, step bar on Run). */
  frame: FlowFrameBase;
}

// #2328: LLM preflight phase -- pings the active gateway connector before starting the run.
// Shared by AppAssessmentScreen and LzAssessmentScreen (#2371).
export function PreflightLlmPhase({ connector, apiKey, app, onPass, onBack, onRunWithoutLlm, frame }: PreflightLlmPhaseProps): JSX.Element {
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
          setResults([{ connectorId: connector.id, status: 'warn', message: 'no credential stored, not checked' }]);
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

  // #4256 (Design 126 sections 4.9 and 7.10): Esc returns to the credentials;
  // after a check that did not pass, the choices are list entries (was the
  // letter W and the hand-written "Press Enter or Esc" lines).
  const needsChoice = done && results.some(r => r.status === 'warn' || r.status === 'fail');
  useInput((_input, key) => {
    // #4230: an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape) onBack();
    if (done && key.return && !needsChoice) onPass();
  });

  const choices: SelectOption[] = [
    { label: 'Start the run anyway', value: 'start', guidance: { title: 'Start the run anyway', what: 'The passes that need the LLM (synthesis, compliance, blocks) may fail during the run.' } },
    ...(onRunWithoutLlm ? [{ label: 'Run without the LLM', value: 'no-llm', detail: 'deterministic passes only', guidance: { title: 'Run without the LLM', what: 'Runs the deterministic passes only; context, compliance and block assessments are not produced.', cli: 'swao assess --app <id> --skip-llm' } }] : []),
    { label: 'Back to the credentials', value: 'back', guidance: { title: 'Back to the credentials', what: 'Check the API key and the connector of this app, then start again.' } },
  ];
  const choiceGuidance = useOptionGuidance(choices[0]!.guidance!);
  const keys: readonly KeyHint[] = needsChoice ? [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'back' }] : [{ key: 'Esc', verb: 'back' }];

  return (
    <FlowFrame
      {...frame}
      onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; frame.onGuidanceOpenChange(open); }}
      title="LLM connectivity check"
      subtitle="A short test prompt to the LLM gateway before the run starts."
      keys={keys}
      guidance={{ entry: needsChoice ? choiceGuidance.entry : {
        title: 'LLM connectivity check',
        what: 'Sends a minimal test prompt to the LLM gateway connector before the run. A warn or fail result means the synthesis, compliance and block assessment passes may fail during the run.',
        sections: [{ label: 'Timeout', text: '20 seconds per connector' }, { label: 'Credential', text: 'read from the SWAO vault with the credential key of the connector' }],
      } }}
    >
      <DetailRow label="App" value={app} />
      {results.map(r => (
        r.status === 'running'
          ? <StatusRow key={r.connectorId} level="waiting" label={r.connectorId} summary="checking" />
          : <StatusRow key={r.connectorId} level={r.status} label={r.connectorId} summary={r.message} />
      ))}
      {needsChoice && (
        <Box marginTop={1}>
          <SelectInput
            label="The connector could not be verified"
            options={choices}
            visibleCount={PICKER_VISIBLE_COUNT}
            showKeyHints={false}
            onCursorChange={choiceGuidance.onCursorChange}
            onSelect={(v) => {
              if (v === 'start') onPass();
              else if (v === 'no-llm') onRunWithoutLlm?.();
              else onBack();
            }}
            active={frame.dialog === null}
          />
        </Box>
      )}
    </FlowFrame>
  );
}
