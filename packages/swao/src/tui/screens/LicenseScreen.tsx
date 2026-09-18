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

import { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { Header } from '../components/Header.js';
import { TextInput } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { LiveOutput } from '@swao/tui-kit';
import { ProgressBar } from '@swao/tui-kit';
import { GuidanceBox, licenseStatusColor, formatExpiry } from '@swao/tui-kit';
import { LicenseGuard, LicenseInvalidError } from '../../license/license-guard.js';
import { logPortfolio } from '@swao/core';
import type { LicenseState } from '../../license/license-guard.js';

// #0612: licence issuance is OPERATOR-ONLY and lives in the air-gapped
// swao-premium tooling (scripts/issue-license.mjs + license-tui.mjs), which
// wraps the hidden `swao license issue --json` signing primitive. The shipped
// product therefore exposes only the three things an end user needs:
// see their fingerprint (status panel), request a licence, and activate one.
// The previous in-TUI 7-step issuance flow was removed (Design 062 split).

const BIN  = process.execPath;
// #2589: inside a pkg binary process.argv[1] is the snapshot bundle path, not a
// valid CLI sub-command prefix. Omit it when running packaged; keep it for
// the dev-time `node dist/...` invocation so Commander can find the entry point.
const _isPkg     = Boolean((process as { pkg?: unknown }).pkg);
const SELF_ARGS: string[] = _isPkg ? [] : [process.argv[1] as string];

type SubScreen =
  | 'menu'
  | 'status'
  | 'request'
  | 'request-details'
  | 'request-running'
  | 'activate-input'
  | 'activate-running'
  | 'remove-confirm'
  | 'remove-running';

const _binaryTier = process.env['SWAO_BINARY_TIER'];
const SUB_OPTIONS = [
  { label: 'Show license status',             value: 'status'         },
  { label: 'Request a license upgrade',       value: 'request'        },
  { label: 'Activate a license',              value: 'activate-input' },
  ...(_binaryTier !== 'community' ? [{ label: 'Remove license from this machine', value: 'remove-confirm' }] : []),
  { label: 'Back to main menu',               value: 'back'           },
];

const TIER_OPTIONS = [
  { label: 'Consultant', value: 'consultant' },
  { label: 'Enterprise', value: 'enterprise' },
];

interface RunOutputProps {
  args: string[];
  onDone: () => void;
  /** Optional GuidanceBox shown when the subprocess completes (#2297). */
  guidanceTitle?: string;
  guidanceWhat?: string;
  guidanceDetails?: ReadonlyArray<{ label: string; value: string }>;
  /** #2654: when true, output lines wrap rather than truncate so long tokens remain copyable. */
  wrapLiveOutput?: boolean;
}

function RunOutput({ args, onDone, guidanceTitle, guidanceWhat, guidanceDetails, wrapLiveOutput }: RunOutputProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);
  // #2297: guard Escape/Enter from firing onDone while the GuidanceBox is open.
  const guidanceOpenRef = useRef(false);
  // #2630: ref to capture the latest lines inside the close handler (state is stale in closure).
  const linesRef = useRef<string[]>([]);

  useEffect(() => {
    const child = spawn(BIN, [...SELF_ARGS, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PKG_EXECPATH: '' },
    });
    const push = (chunk: Buffer) => {
      const newLines = chunk.toString().split('\n').filter(Boolean);
      linesRef.current = [...linesRef.current, ...newLines];
      setLines(prev => [...prev, ...newLines]);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      setCode(exitCode);
      setDone(true);
      if (exitCode !== 0) {
        // #2636: exit 3 = "no workspace" or "no active licence" -- not an error during healthy use.
        const logLevel = exitCode === 3 ? 'warn' : 'error';
        const ctx: Record<string, unknown> = { exit_code: exitCode };
        if (args.includes('activate')) {
          // #2630: include last non-empty output line as failure reason + key suffix.
          const lastLine = [...linesRef.current].reverse().find(l => l.trim().length > 0) ?? '';
          const activateIdx = args.indexOf('activate');
          const keyArg = activateIdx >= 0 ? (args[activateIdx + 1] ?? '') : '';
          if (lastLine) ctx['reason'] = lastLine;
          if (keyArg) ctx['key_suffix'] = keyArg.slice(-8);
        }
        try { logPortfolio(logLevel, 'setup.license.error', `License command exited ${exitCode}`, { context: ctx }); } catch { /* best-effort */ }
      } else if (args.includes('request')) {
        // #2562: emit an audit-trail event when a licence request token is generated.
        // PII (licensee name, email) must NOT be logged -- only tier and timestamp.
        const tierIdx = args.indexOf('--tier');
        const reqTier = tierIdx >= 0 ? (args[tierIdx + 1] ?? 'unknown') : 'unknown';
        try { logPortfolio('info', 'licence.upgrade_request', 'Licence upgrade request token generated', { context: { requested_tier: reqTier } }); } catch { /* best-effort */ }
      } else if (args.includes('activate')) {
        // #2587: emit licence.activate event on successful activation.
        const activateIdx = args.indexOf('activate');
        const keyArg = activateIdx >= 0 ? (args[activateIdx + 1] ?? '') : '';
        const keySuffix = keyArg.slice(-8);
        try { logPortfolio('info', 'licence.activate', 'Licence activated', { context: { licence_id_suffix: keySuffix } }); } catch { /* best-effort */ }
      }
    });
    return () => { child.kill(); };
  }, []);

  useInput((_input, key) => {
    if (guidanceOpenRef.current && !done && !key.escape && !key.return && !key.upArrow && !key.downArrow) return;
    if (done && (key.return || key.escape)) onDone();
  });

  return (
    <Box flexDirection="column">
      {!done && <Text color="yellow">Running...</Text>}
      {done && code === 0 && <Text color="green">Done.</Text>}
      {done && code !== 0 && <Text color="red">Failed. Check the details above.</Text>}
      <LiveOutput lines={lines} maxLines={20} wrapMode={wrapLiveOutput ? 'wrap' : 'truncate-end'} />
      {done && guidanceTitle && (
        <GuidanceBox
          title={guidanceTitle}
          what={guidanceWhat ?? ''}
          details={guidanceDetails}
          affordances={['Enter or Esc -- go back']}
          initiallyCollapsed
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      )}
      {done && <Text dimColor>Press Enter or Escape to go back...</Text>}
    </Box>
  );
}

/**
 * Dedicated output component for the `remove-running` sub-screen (#2315).
 * Spawns `swao license remove --json`, streams via LiveOutput, then on
 * completion parses the JSON and shows the removal token prominently along
 * with a brief email template. No GuidanceBox -- the running sub-screen
 * carries live output and does not need one.
 */
function RemoveRunOutput({ tier, licensee, onDone }: { tier: string; licensee: string; onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);
  const [removalToken, setRemovalToken] = useState<string | null>(null);
  const rawRef = useRef('');

  useEffect(() => {
    const child = spawn(BIN, [...SELF_ARGS, 'license', 'remove', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PKG_EXECPATH: '' },
    });
    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      rawRef.current += text;
      setLines(prev => [...prev, ...text.split('\n').filter(Boolean)]);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      try {
        const parsed = JSON.parse(rawRef.current) as Record<string, unknown>;
        if (typeof parsed['removal_token'] === 'string') {
          setRemovalToken(parsed['removal_token'] as string);
        }
      } catch { /* leave removalToken null; raw output shown via LiveOutput */ }
      setCode(exitCode);
      setDone(true);
      if (exitCode !== 0) {
        try { logPortfolio('error', 'setup.license.remove.error', `License remove exited ${exitCode}`, { context: { exit_code: exitCode } }); } catch { /* best-effort */ }
      } else {
        // #2587: emit licence.remove on successful removal.
        try { logPortfolio('info', 'licence.remove', 'Licence removed from this machine', { context: { tier_before: tier } }); } catch { /* best-effort */ }
      }
    });
    return () => { child.kill(); };
  }, []);

  useInput((_input, key) => {
    if (done && (key.return || key.escape)) onDone();
  });

  const tierLabel = tier === 'enterprise' ? 'Enterprise' : 'Consultant';

  return (
    <Box flexDirection="column">
      {!done && <Text color="yellow">Removing license...</Text>}
      {done && code === 0  && <Text color="green">Done.</Text>}
      {done && code !== 0  && <Text color="red">Failed. Check the details above.</Text>}
      {/* #2585: show a GuidanceBox while the remove is in progress so the screen is not blank. */}
      {!done && (
        <GuidanceBox
          title="Removing Licence"
          what="SWAO is generating a removal token and clearing the licence file from this machine. The token lets the Accenture team re-issue a seat on a different machine."
          details={[{ label: 'Next step', value: 'Copy the removal token shown after completion and send it to your SWAO account contact.' }]}
          affordances={['Please wait -- this takes a few seconds']}
          initiallyCollapsed={false}
        />
      )}
      {/* #2647: only show raw subprocess output when token parse failed (error path);
          on success the styled token box below replaces the JSON dump. */}
      {(!removalToken || code !== 0) && <LiveOutput lines={lines} maxLines={10} />}
      {done && removalToken && (
        <>
          <Box flexDirection="column" borderStyle="double" borderColor="cyanBright" paddingX={1} marginY={1}>
            <Text bold color="cyanBright">Removal Token</Text>
            <Text wrap="wrap">{removalToken}</Text>
          </Box>
          <GuidanceBox
            title="Licence Removed"
            what={`Your ${tierLabel} licence has been removed from this machine. Keep the token above -- it is your proof of removal and lets the operator re-issue a seat on a new machine.`}
            details={[
              { label: 'Next step', value: 'Send the email below to swao-tool@accenture.com so the operator can update the registry.' },
              { label: 'New machine', value: 'Run swao license request on the new machine and send the request token to your SWAO contact.' },
            ]}
            affordances={['Enter / Escape -- return to menu']}
            initiallyCollapsed={false}
          />
          <Text bold>Send the following email to notify the operator:</Text>
          <Text dimColor>{`  To:      swao-tool@accenture.com`}</Text>
          <Text dimColor>{`  Subject: SWAO License Removal -- ${tierLabel}`}</Text>
          <Text></Text>
          <Text dimColor>  Hello,</Text>
          <Text></Text>
          <Text dimColor>{`  I have removed my ${tierLabel} licence from this machine.`}</Text>
          {licensee && <Text dimColor>{`  Licensee: ${licensee}`}</Text>}
          <Text dimColor wrap="wrap">{`  Removal token: ${removalToken}`}</Text>
          <Text></Text>
          <Text dimColor>  Thank you.</Text>
        </>
      )}
      {done && <Text dimColor>Press Enter or Escape to return to main menu...</Text>}
    </Box>
  );
}

/**
 * Rich licence status panel (M18 #0283). Renders tier + budget + expiry
 * with progress bars and colour-coding by `licenseStatusColor`. Also the
 * end user's source of truth for their machine fingerprint (needed when
 * requesting a licence). #0741: width matches the header bar so the panel
 * and guidance box stay aligned.
 */
function LicenseStatusPanel({ state, width }: { state: LicenseState; width?: number }) {
  const color = licenseStatusColor(state);
  const tierLabel =
    state.tier === 'enterprise' ? 'Enterprise' :
    state.tier === 'consultant' ? 'Consultant' :
    'Community (free, unlimited)';

  const expiry = formatExpiry(state);
  const expDate = state.exp ? new Date(state.exp).getTime() : null;
  // #2586: always show a Valid until row.
  const isExpired = expDate != null && expDate < Date.now();
  const validUntilText =
    state.tier === 'community' ? 'Unlimited (free tier)' :
    state.exp == null          ? 'No expiry' :
    isExpired                  ? `EXPIRED (${state.exp})` :
    state.exp;
  const validUntilColor = isExpired ? ('red' as const) : undefined;
  // Use the licence's own issuedAt (payload iat) as the period start so the
  // progress bar shows "days into THIS licence" rather than days since first
  // machine run. Falls back to firstRun for community or legacy keys without iat.
  const periodStart = state.issuedAt ?? state.firstRun;
  const periodStartDate = new Date(periodStart).getTime();
  const totalDays = expDate != null ? Math.max(1, Math.round((expDate - periodStartDate) / 86_400_000)) : null;
  const daysUsed = expDate != null ? Math.min(totalDays!, Math.max(0, totalDays! - Math.floor((expDate - Date.now()) / 86_400_000))) : null;

  // #0707: compact layout -- single-line fields, no internal blank lines.
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1} width={width}>
      <Text bold color={color.inkColor}>Tier: {tierLabel}</Text>
      {state.licensee && <Text><Text dimColor>Licensee:     </Text><Text>{state.licensee}</Text></Text>}
      {state.email && <Text><Text dimColor>Email:        </Text><Text>{state.email}</Text></Text>}
      <Text><Text dimColor>First run:    </Text><Text>{state.firstRun}</Text><Text dimColor>    Fingerprint: </Text><Text>{state.fingerprint.substring(0, 16)}</Text></Text>
      <Text><Text dimColor>Valid until:  </Text><Text color={validUntilColor}>{validUntilText}</Text></Text>

      {state.tier !== 'community' && expiry && (
        <Text><Text dimColor>Expiry:       </Text><Text color={color.inkColor}>{expiry}</Text></Text>
      )}
      {state.tier !== 'community' && expDate != null && totalDays != null && daysUsed != null && (
        <ProgressBar value={daysUsed} total={totalDays} label="days into licence" />
      )}

      {/* #2632: show expiry banner when a paid tier expired and downgraded this session.
          #2607: distinguish natural expiry (date past) from manual removal (date future). */}
      {state.expiredTier && (
        <Box marginTop={1} borderStyle="single" borderColor="red" paddingX={1}>
          <Text bold color="red">
            {isExpired
              ? `${state.expiredTier.charAt(0).toUpperCase() + state.expiredTier.slice(1)} licence expired on ${state.exp ?? 'unknown date'}. Renew to restore access.`
              : `${state.expiredTier.charAt(0).toUpperCase() + state.expiredTier.slice(1)} licence removed. Was valid until ${state.exp ?? 'unknown date'}.`
            }
          </Text>
        </Box>
      )}
      {color.state === 'amber' && !state.expiredTier && (
        <Text color="yellow">Licence is approaching its limit. Consider renewing.</Text>
      )}
      {color.state === 'red' && !state.expiredTier && (
        <Text bold color="red">Licence at or past its limit. Renew before issuing further work.</Text>
      )}
      {/* #2608 / #2664: when a Consultant or Enterprise key is installed on a Community
          binary, state.tier is capped to 'community' and state.exp is a future date.
          Original condition (assessmentLimit != null) missed Enterprise (unlimited = null). */}
      {state.tier === 'community' && state.exp != null && new Date(state.exp).getTime() > Date.now() && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Higher-tier licence on file -- capped to Community by this binary.</Text>
          <Text dimColor>Licence expires {state.exp}{state.licensee ? ` (${state.licensee})` : ''}.</Text>
          <Text dimColor>Use the Consultant or Enterprise binary to activate it.</Text>
        </Box>
      )}
    </Box>
  );
}

interface LicenseScreenProps {
  onBack: () => void;
}

export function LicenseScreen({ onBack }: LicenseScreenProps) {
  const [sub, setSub]     = useState<SubScreen>('menu');
  const [tier, setTier]   = useState('consultant');
  // #0741: match the header bar width so bordered boxes stay aligned.
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  const headerWidth = Math.min(100, Math.max(63, cols - 2));

  // #0744: guided collection fields for the request token.
  const [reqStep, setReqStep]         = useState(0);
  const [reqLicensee, setReqLicensee] = useState('');
  const [reqEmail, setReqEmail]       = useState('');
  const [reqOrgName, setReqOrgName]   = useState('');
  const [reqOrgId, setReqOrgId]       = useState('');
  const [reqEvbIt, _setReqEvbIt]      = useState(''); // EVB-IT step removed (#1526); field kept for backend compat
  // #2299: licence activation key (pasted by user in activate-input sub-screen).
  const [activateKey, setActivateKey] = useState('');
  // #2315: capture tier/licensee before transitioning to remove-running.
  const [removeTier, setRemoveTier]       = useState('consultant');
  const [removeLicensee, setRemoveLicensee] = useState('');

  // Load licence state once for the rich-status panel. The state is
  // re-read on every screen entry (component remount) so a fresh
  // activation is reflected.
  const licenseLoad = useMemo<{ state: LicenseState | null; error: string | null }>(() => {
    try {
      return { state: LicenseGuard.load().state, error: null };
    } catch (e) {
      if (e instanceof LicenseInvalidError) {
        return { state: null, error: e.message };
      }
      return { state: null, error: (e as Error).message };
    }
  }, [sub]);  // re-evaluate after an activation returns to menu

  // #2587: emit structured NDJSON events on licence load and validation failure.
  // #2632: also emit licence.expired when a paid tier was silently downgraded.
  useEffect(() => {
    if (licenseLoad.state) {
      const s = licenseLoad.state;
      try {
        logPortfolio('info', 'licence.load', 'Licence loaded', {
          context: {
            fingerprint: s.fingerprint.substring(0, 8),
            tier: s.tier,
            valid_until: s.exp ?? 'unlimited',
          },
        });
      } catch { /* best-effort */ }
      if (s.expiredTier) {
        try {
          logPortfolio('warn', 'licence.expired', 'Licence expired; session downgraded to community', {
            context: { exp: s.exp, tier_before: s.expiredTier, fingerprint: s.fingerprint.substring(0, 8) },
          });
        } catch { /* best-effort */ }
      }
    } else if (licenseLoad.error) {
      try {
        logPortfolio('warn', 'licence.invalid', 'Licence file invalid or missing', {
          context: { reason: licenseLoad.error },
        });
      } catch { /* best-effort */ }
    }
  }, [licenseLoad]);

  const guidanceOpenRef = useRef(false);

  useInput((_input, keyEvt) => {
    if (guidanceOpenRef.current && !keyEvt.escape && !keyEvt.return && !keyEvt.upArrow && !keyEvt.downArrow) return;
    if (keyEvt.escape) {
      if (sub === 'menu') {
        onBack();
      } else if (sub === 'request-details') {
        // Step-back within the details form; exit form on step 0.
        if (reqStep > 0) { setReqStep(s => s - 1); }
        else { setSub('request'); }
      } else {
        setSub('menu');
      }
    }
  });

  return (
    <Box key={sub} flexDirection="column" padding={1}>
      <Header subtitle="Licence Management" hideLicenseStatus />

      {/* Rich status panel always visible while in the menu (M18 #0283).
          When the user explicitly chooses "Show license status" we drop
          down to the CLI subprocess view for parity with `swao license`
          text output. */}
      {sub === 'menu' && licenseLoad.state && (
        <LicenseStatusPanel state={licenseLoad.state} width={headerWidth} />
      )}
      {sub === 'menu' && licenseLoad.error && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} width={headerWidth}>
          <Text bold color="red">Licence error</Text>
          <Text>{licenseLoad.error}</Text>
        </Box>
      )}

      {sub === 'menu' && (
        <SelectInput
          label="Choose an action"
          options={SUB_OPTIONS}
          onSelect={(v) => {
            if (v === 'back') {
              onBack();
            } else {
              setSub(v as SubScreen);
            }
          }}
          active
        />
      )}

      {sub === 'menu' && (
        <GuidanceBox
          title="License"
          what="Community tier runs static passes. Consultant + Enterprise unlock LLM passes and BI export."
          details={[
            { label: 'Request',       value: 'Generates a signed request token; send it to the SWAO team to receive a key' },
            { label: 'Questions',     value: 'https://github.com/Accenture/SWAO/discussions' },
            { label: 'Report a bug',  value: 'https://github.com/Accenture/SWAO/issues' },
            { label: 'Docs',          value: 'https://accenture.github.io/SWAO/en/' },
          ]}
          affordances={['Up/Down -- pick action  |  Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      )}

      {sub === 'status' && (
        <RunOutput
          args={['license', 'status']}
          onDone={() => setSub('menu')}
          guidanceTitle="Licence Status"
          guidanceWhat={licenseLoad.state?.tier === 'community'
            ? "Community tier is active -- free, unlimited assessments. Consultant adds PDF reports and BI export; Enterprise adds portfolio operations and the adversarial challenge."
            : "Your licence is active. Your machine fingerprint (shown above) is the unique identifier for this licence -- keep it for renewal requests."}
          guidanceDetails={[
            { label: 'Upgrade',  value: "Select 'Request a license upgrade' from the Licence menu" },
            { label: 'Activate', value: "After receiving your key by email, select 'Activate a license' from the Licence menu" },
            { label: 'Contact',  value: "swao-tool@accenture.com" },
          ]}
        />
      )}

      {sub === 'request' && (
        <>
          <SelectInput
            label="License tier to request"
            options={TIER_OPTIONS}
            onSelect={(v) => { setTier(v); setReqStep(0); setSub('request-details'); }}
            active
          />
          {/* #2298: GuidanceBox must render BELOW interactive content, consistent with all other TUI screens. */}
          <GuidanceBox
            title="Choose Licence Tier"
            what="Select the tier that matches your use case. Consultant adds PDF reports, BI export, and advanced features. Enterprise adds portfolio-level assessment and the adversarial challenge."
            details={[
              { label: 'Community',   value: 'Free (Apache-2.0). All assessment passes including LLM adapters, structured reports, and raw BI data export (CSV/NDJSON/XLSX). No PDF, HTML publication, or Power BI templates.' },
              { label: 'Consultant',  value: 'All Community features plus PDF reports, HTML publication, branded output, NIS2/EU AI Act frameworks, LZ catalogue updates. Per-user annual.' },
              { label: 'Enterprise',  value: 'All Consultant features plus portfolio assessment, adversarial challenge, HTML Editor, Power BI templates, Terraform scaffold, FedRAMP/CMMC/TISAX/HITRUST. Per-user annual.' },
            ]}
            affordances={['Up/Down -- pick tier  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {/* #0744: collect identity fields before generating the request token. */}
      {sub === 'request-details' && (
        <Box flexDirection="column">
          <Text>
            <Text color="cyanBright">{tier.charAt(0).toUpperCase() + tier.slice(1)}</Text>
            <Text dimColor> license request -- fill in your details (Esc = back one step)</Text>
          </Text>
          {reqStep === 0 && (
            <>
              <TextInput
                label="Your full name"
                placeholder={licenseLoad.state?.licensee ?? 'e.g. Jane Doe'}
                onSubmit={(v) => {
                  setReqLicensee(v.trim() || (licenseLoad.state?.licensee ?? ''));
                  setReqStep(1);
                }}
                active
              />
              <GuidanceBox
                title="Step 1 of 4 -- Your name"
                what="Enter your full name as it should appear on the licence. This is pre-filled from your existing licence if one is present."
                details={[{ label: 'Example', value: 'Jane Doe' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            </>
          )}
          {reqStep === 1 && (
            <>
              <TextInput
                label="Contact email"
                placeholder={licenseLoad.state?.email ?? 'e.g. jane.doe@company.com'}
                onSubmit={(v) => {
                  const val = v.trim();
                  // #1526: basic format guard -- must contain @ and a dot after @.
                  if (val && (!val.includes('@') || !val.slice(val.indexOf('@')).includes('.'))) {
                    return; // reject; user must re-enter
                  }
                  setReqEmail(val || (licenseLoad.state?.email ?? ''));
                  setReqStep(2);
                }}
                active
              />
              <GuidanceBox
                title="Step 2 of 4 -- Contact email"
                what="The email address where your licence key will be sent. Pre-filled from your existing licence if one is present. Use your organisation email, not a personal address."
                details={[{ label: 'Example', value: 'jane.doe@company.com' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            </>
          )}
          {reqStep === 2 && (
            <>
              <TextInput
                label="Organisation name"
                placeholder="e.g. Accenture GmbH"
                onSubmit={(v) => { setReqOrgName(v.trim()); setReqStep(3); }}
                active
              />
              <GuidanceBox
                title="Step 3 of 4 -- Organisation name"
                what="The full legal name of your organisation. This appears on the licence and in SWAO reports."
                details={[{ label: 'Example', value: 'Accenture GmbH' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            </>
          )}
          {reqStep === 3 && (
            <>
              <TextInput
                label={`Org ID slug${tier === 'enterprise' ? ' (required)' : ' (optional, Enter to skip)'}`}
                placeholder="e.g. accenture"
                onSubmit={(v) => { setReqOrgId(v.trim()); setSub('request-running'); }}
                active
              />
              <GuidanceBox
                title="Step 4 of 4 -- Organisation ID slug"
                what={`Short lowercase identifier for your organisation. Used for seat grouping in ${tier === 'enterprise' ? 'Enterprise' : 'Consultant'} licences. Leave blank to skip.`}
                details={[
                  { label: 'Format',  value: 'Lowercase letters, digits, hyphens only' },
                  { label: 'Example', value: 'accenture-gmbh' },
                ]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
            </>
          )}
          {reqStep === 4 && (
            // #1526: EVB-IT step removed from public-facing flow; skip directly to submission.
            // reqEvbIt stays empty and is not sent in the request token.
            <>{void 0}</>
          )}
        </Box>
      )}

      {sub === 'request-running' && (
        <RunOutput
          args={[
            'license', 'request', '--tier', tier,
            ...(reqLicensee ? ['--licensee', reqLicensee] : []),
            ...(reqEmail    ? ['--email', reqEmail]       : []),
            ...(reqOrgName  ? ['--org-name', reqOrgName]  : []),
            ...(reqOrgId    ? ['--org-id', reqOrgId]      : []),
            ...(reqEvbIt    ? ['--evb-it-order-ref', reqEvbIt] : []),
          ]}
          onDone={() => setSub('menu')}
          wrapLiveOutput
          guidanceTitle="Licence Request Sent"
          guidanceWhat="The request token above has been generated. Send the email shown to the SWAO team to receive your signed licence key. Do NOT use the request token itself as the activation key."
          guidanceDetails={[
            { label: 'Next step', value: "When you receive the key by email, return here and select 'Activate a license'" },
            { label: 'Contact',   value: "swao-tool@accenture.com" },
          ]}
        />
      )}

      {/* #2299: Activate a license -- key input sub-screen */}
      {sub === 'activate-input' && (
        <Box flexDirection="column">
          <Text>
            <Text color="cyanBright">Activate a license</Text>
            <Text dimColor> -- paste your licence key (Esc = back)</Text>
          </Text>
          <TextInput
            label="Licence key"
            placeholder="Paste your key here..."
            onSubmit={(v) => {
              const trimmed = v.trim().replace(/\s+/g, '');
              if (!trimmed) return;
              setActivateKey(trimmed);
              setSub('activate-running');
            }}
            active
            labelAbove
            maxValueWidth={88}
          />
          <GuidanceBox
            title="Activate a License"
            what="Paste the signed licence key you received by email. The key is a long base64url string. Paste it in full -- partial keys will fail verification."
            details={[
              { label: 'Tip',     value: "If the key wraps in your terminal, paste it here in the TUI input field to avoid splitting it across lines." },
              { label: 'Contact', value: "swao-tool@accenture.com for support with invalid or expired keys." },
            ]}
            affordances={['Enter -- submit key  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {/* #2299: Activate a license -- running sub-screen */}
      {sub === 'activate-running' && activateKey && (
        <RunOutput
          args={['license', 'activate', activateKey]}
          onDone={() => setSub('menu')}
          guidanceTitle="Activation Result"
          guidanceWhat="If activation succeeded, your new licence tier is now active. Run 'Show license status' to confirm the tier, expiry, and budget."
          guidanceDetails={[
            { label: 'On error', value: "Check that the key was not truncated or modified. Contact swao-tool@accenture.com if the error persists." },
          ]}
        />
      )}

      {/* #2315: Remove license -- confirmation sub-screen */}
      {sub === 'remove-confirm' && (
        <Box flexDirection="column">
          <Text bold color="red">Remove License</Text>
          {licenseLoad.state && (
            <LicenseStatusPanel state={licenseLoad.state} width={headerWidth} />
          )}
          {licenseLoad.error && (
            <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1}>
              <Text color="red">{licenseLoad.error}</Text>
            </Box>
          )}
          <Text color="yellow">WARNING: This will permanently remove the license from this machine.</Text>
          <Text color="yellow">A removal token will be generated for your records.</Text>
          <SelectInput
            label="Confirm removal"
            options={[
              { label: 'Remove license (generates removal token)', value: 'do-remove' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onSelect={(v) => {
              if (v === 'cancel') {
                setSub('menu');
              } else {
                setRemoveTier(licenseLoad.state?.tier ?? 'consultant');
                setRemoveLicensee(licenseLoad.state?.licensee ?? '');
                setSub('remove-running');
              }
            }}
            active
          />
          <GuidanceBox
            title="Remove License"
            what="Removing the license deletes the licence file from this machine. A cryptographically-attributed removal token is generated so the operator can verify the removal. This action cannot be undone -- you would need to request and activate a new key."
            details={[
              { label: 'Removal token', value: 'Base64url-encoded JSON signed with an HMAC derived from your licence file.' },
              { label: 'After removal',  value: "Run 'Request a license upgrade' to request a new key." },
              { label: 'Contact',        value: 'swao-tool@accenture.com' },
            ]}
            affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {/* #2315: Remove license -- running sub-screen */}
      {sub === 'remove-running' && (
        <RemoveRunOutput
          tier={removeTier}
          licensee={removeLicensee}
          onDone={() => setSub('menu')}
        />
      )}

    </Box>
  );
}
