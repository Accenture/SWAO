// useLlmHealthCheck -- health-check ping effect extracted from LlmAssessmentScreen.tsx
// (#2376). Uses createProviderFromConnector + provider.complete (not useLlmPing which
// is fetch-based); wiring to useLlmPing is deferred to the PreflightLlmPhase (#2369).

import { useState, useEffect, useRef } from 'react';
import { createProviderFromConnector, classifyPingFailure } from '@swao/module-llm-providers';
import type { PendingLeg } from '../types.js';

export interface HealthCheckState {
  healthStatus:    'running' | 'ok' | 'fail' | null;
  healthMessage:   string;
  healthPermanent: boolean;
  setHealthStatus:    (s: 'running' | 'ok' | 'fail' | null) => void;
  setHealthMessage:   (m: string) => void;
  setHealthPermanent: (p: boolean) => void;
}

const PING_PROMPT    = 'SWAO connectivity check. Reply with the single word: OK';
const PING_TIMEOUT_MS = 20_000;

export function useLlmHealthCheck(stage: string, nextLegRef: React.RefObject<PendingLeg | null>): HealthCheckState {
  const [healthStatus,    setHealthStatus]    = useState<'running' | 'ok' | 'fail' | null>(null);
  const [healthMessage,   setHealthMessage]   = useState('');
  const [healthPermanent, setHealthPermanent] = useState(false);

  // Keep a stable ref to the current setter so the async callback can always
  // write to it even if the component re-renders mid-flight.
  const setStatusRef    = useRef(setHealthStatus);
  const setMessageRef   = useRef(setHealthMessage);
  const setPermanentRef = useRef(setHealthPermanent);
  setStatusRef.current    = setHealthStatus;
  setMessageRef.current   = setHealthMessage;
  setPermanentRef.current = setHealthPermanent;

  useEffect(() => {
    if (stage !== 'health-check') return;
    const pending = nextLegRef.current;
    if (!pending) return;

    setStatusRef.current('running');
    setMessageRef.current('');
    setPermanentRef.current(false);

    let cancelled = false;
    void (async () => {
      try {
        const resolved = createProviderFromConnector(pending.connector, { model: pending.model });
        await Promise.race([
          resolved.provider.complete(PING_PROMPT),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`ping timed out after ${PING_TIMEOUT_MS}ms`)),
              PING_TIMEOUT_MS,
            ).unref?.(),
          ),
        ]);
        if (!cancelled) {
          setStatusRef.current('ok');
          setMessageRef.current(`PASS -- ${pending.connectorId} / ${pending.model}`);
        }
      } catch (err) {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : String(err);
          const hint = classifyPingFailure(raw, {
            credentialKey: pending.connector.file.connector.auth.credential_key ?? '',
            model: pending.model,
            baseUrl: pending.connector.file.connector.base_url,
          });
          const permanent = /request failed: 4(?!29)\d\d/.test(raw);
          setPermanentRef.current(permanent);
          setStatusRef.current('fail');
          setMessageRef.current(hint);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [stage]);

  return { healthStatus, healthMessage, healthPermanent, setHealthStatus, setHealthMessage, setHealthPermanent };
}
