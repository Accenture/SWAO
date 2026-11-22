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
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DetailRow, ProgressBar, RunOutput, ScreenLayout, SelectInput, StatusRow, TextInput,
  formatExpiry, guidanceOwnsKey, licenseStatusColor, tokenColor, tone, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type SelectOption, type StatusLevel,
} from '@swao/tui-kit';
import { LicenseGuard, LicenseInvalidError } from '../../license/license-guard.js';
import { logPortfolio } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { useScreenHeader } from '../components/screen-header.js';
import type { LicenseState } from '../../license/license-guard.js';

// #0612: licence issuance is OPERATOR-ONLY and lives in the air-gapped
// private licence tooling, which
// wraps the hidden `swao license issue --json` signing primitive. The shipped
// product therefore exposes only the three things an end user needs:
// see their fingerprint (status panel), request a licence, and activate one.
// The previous in-TUI 7-step issuance flow was removed (Design 062 split).

// #2589 / #4241: child processes start through the central self-spawn helper
// (selfSpawnCommand): the snapshot bundle path is never passed in the binary.

// #4257 (TUI-13, Design 126 sections 3, 4, 6 and 7): Licence Management on
// ScreenLayout. Each sub-screen reports its title, key hints and guidance
// entry to the one layout; the status panel as DetailRow and StatusRow; the
// command output through RunOutput (wrapped, never cut); no hand-written key
// hints and no spaced double hyphens; the CLI only in the guidance `cli` field.

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

const CONTACT = 'swao-tool@accenture.com';

const _binaryTier = process.env['SWAO_BINARY_TIER'];
const SUB_OPTIONS: SelectOption[] = [
  { label: 'Show license status', value: 'status', guidance: { title: 'Show license status', what: 'The tier, the validity and the machine fingerprint of the licence on this machine.', cli: 'swao license status' } },
  { label: 'Request a license upgrade', value: 'request', guidance: { title: 'Request a license upgrade', what: 'Generates a signed request token; send it to the SWAO team to receive a key.', cli: 'swao license request --tier <tier>' } },
  { label: 'Activate a license', value: 'activate-input', guidance: { title: 'Activate a license', what: 'Paste the signed licence key you received by email.', cli: 'swao license activate <key>' } },
  ...(_binaryTier !== 'community' ? [{ label: 'Remove license from this machine', value: 'remove-confirm', guidance: { title: 'Remove license', what: 'Deletes the licence file of this machine and generates a removal token for the operator.', cli: 'swao license remove' } }] : []),
  { label: 'Back to main menu', value: 'back', guidance: { title: 'Back', what: 'Leave Licence Management.' } },
];

const TIER_OPTIONS: SelectOption[] = [
  { label: 'Consultant', value: 'consultant', guidance: { title: 'Consultant', what: 'All Community features plus PDF reports, HTML publication, branded output, NIS2 and EU AI Act frameworks, LZ catalogue updates. Per user, annual.' } },
  { label: 'Enterprise', value: 'enterprise', guidance: { title: 'Enterprise', what: 'All Consultant features plus portfolio assessment, adversarial challenge, HTML Editor, Power BI templates, Terraform scaffold, FedRAMP, CMMC, TISAX and HITRUST. Per user, annual.' } },
];

const MENU_GUIDANCE: GuidanceEntry = {
  title: 'License',
  what: 'All tiers run the App, Landing Zone, Service and LLM Assessments. Consultant adds PDF reports, the App Assessment HTML report and LZ catalogue updates. Enterprise adds portfolio runs, the HTML Editor and Portal, challenge, BI export, chat and the MCP server.',
  sections: [
    { label: 'Questions', text: 'https://github.com/Accenture/SWAO/discussions' },
    { label: 'Report a bug', text: 'https://github.com/Accenture/SWAO/issues' },
    { label: 'Docs', text: 'https://accenture.github.io/SWAO/en/' },
  ],
  cli: 'swao license status',
};

const TIER_GUIDANCE: GuidanceEntry = {
  title: 'Choose the licence tier',
  what: 'Select the tier that matches your use case. Community stays free (Apache-2.0) with every assessment pass, the structured reports and the raw BI data export.',
  cli: 'swao license request --tier <tier>',
};

const DETAIL_STEPS = ['Your name', 'Contact email', 'Organisation name', 'Organisation id'] as const;

const RUN_DONE_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
const RUN_KEYS: readonly KeyHint[] = [{ key: 'Esc', verb: 'cancel' }];

/** Key hints of a sub-screen (Design 126 section 7.9); `runDone` for the command sub-screens. */
export function licenseKeys(sub: SubScreen, runDone: boolean): readonly KeyHint[] {
  switch (sub) {
    case 'menu':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }];
    case 'request':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
    case 'remove-confirm':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'back' }];
    case 'request-details':
      return [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
    case 'activate-input':
      return [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'back' }];
    case 'status':
    case 'request-running':
    case 'activate-running':
    case 'remove-running':
      return runDone ? RUN_DONE_KEYS : RUN_KEYS;
    default: {
      const never: never = sub;
      return never;
    }
  }
}

interface LicenseRunProps {
  args: string[];
  onDone: () => void;
  onFinished?: () => void;
  /** #3048: when set, write all output to this file path on successful completion. */
  saveToFile?: string;
}

/** Runs one `swao license` command; output wrapped (#2654: long tokens stay copyable). */
function LicenseRun({ args, onDone, onFinished, saveToFile }: LicenseRunProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  // #2630: ref to capture the latest lines inside the close handler (state is stale in closure).
  const linesRef = useRef<string[]>([]);

  useEffect(() => {
    const selfCmd = selfSpawnCommand(args);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
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
      onFinished?.();
      // #3048: persist output so CTRL+C after completion does not destroy the token.
      if (exitCode === 0 && saveToFile) {
        try {
          writeFileSync(saveToFile, linesRef.current.join('\n') + '\n', 'utf8');
          setSavedPath(saveToFile);
        } catch { /* best-effort */ }
      }
      if (exitCode !== 0) {
        // #2636: exit 3 = "no workspace" or "no active licence"; not an error during healthy use.
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
        // PII (licensee name, email) must NOT be logged; only tier and timestamp.
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
    if (done && (key.return || key.escape)) onDone();
  });

  return (
    <Box flexDirection="column">
      {!done && <Text {...tone('muted')}>Running...</Text>}
      {lines.length > 0 && <RunOutput lines={lines} maxLines={20} />}
      {done && <StatusRow level={code === 0 ? 'ok' : 'fail'} label="Result" summary={code === 0 ? 'done' : 'failed, see the output above'} />}
      {done && savedPath && <DetailRow label="Saved to" value={savedPath} path />}
    </Box>
  );
}

/**
 * The `remove-running` sub-screen (#2315): spawns `swao license remove --json`,
 * then shows the removal token prominently with a short email template.
 */
function RemoveRun({ tier, licensee, onDone, onFinished }: { tier: string; licensee: string; onDone: () => void; onFinished?: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);
  const [removalToken, setRemovalToken] = useState<string | null>(null);
  const rawRef = useRef('');

  useEffect(() => {
    const selfCmd = selfSpawnCommand(['license', 'remove', '--json']);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
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
      } catch { /* leave removalToken null; raw output shown */ }
      setCode(exitCode);
      setDone(true);
      onFinished?.();
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
      {!done && <Text {...tone('muted')}>Removing the licence...</Text>}
      {done && <StatusRow level={code === 0 ? 'ok' : 'fail'} label="Result" summary={code === 0 ? 'licence removed' : 'failed, see the output above'} />}
      {/* #2647: raw output only when the token parse failed (error path). */}
      {(!removalToken || code !== 0) && lines.length > 0 && <RunOutput lines={lines} maxLines={10} />}
      {done && removalToken && (
        <>
          <Box flexDirection="column" borderStyle="double" borderColor={tokenColor('brand')} paddingX={1} marginY={1}>
            <Text bold {...tone('brand')}>Removal token</Text>
            <Text wrap="wrap">{removalToken}</Text>
          </Box>
          <Text bold>Send the following email to notify the operator:</Text>
          <DetailRow label="To" value={CONTACT} />
          <DetailRow label="Subject" value={`SWAO License Removal, ${tierLabel}`} />
          <Text {...tone('muted')} wrap="wrap">{`I have removed my ${tierLabel} licence from this machine.${licensee ? ` Licensee: ${licensee}.` : ''}`}</Text>
          <Text {...tone('muted')} wrap="wrap">{`Removal token: ${removalToken}`}</Text>
        </>
      )}
    </Box>
  );
}

/** Status level of the licence colour state (Design 126 section 6). */
function licenceLevel(state: string): StatusLevel {
  return state === 'green' ? 'ok' : state === 'amber' ? 'warn' : state === 'red' ? 'fail' : 'info';
}

/**
 * Licence status panel (M18 #0283): tier, licensee, validity, expiry and the
 * machine fingerprint (needed when requesting a licence).
 */
function LicenseStatusPanel({ state }: { state: LicenseState }) {
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
    isExpired                  ? `expired (${state.exp})` :
    state.exp;
  // The licence's own issuedAt (payload iat) as the period start; firstRun for
  // community or legacy keys without iat.
  const periodStart = state.issuedAt ?? state.firstRun;
  const periodStartDate = new Date(periodStart).getTime();
  const totalDays = expDate != null ? Math.max(1, Math.round((expDate - periodStartDate) / 86_400_000)) : null;
  const daysUsed = expDate != null ? Math.min(totalDays!, Math.max(0, totalDays! - Math.floor((expDate - Date.now()) / 86_400_000))) : null;
  const expiredTier = state.expiredTier ? state.expiredTier.charAt(0).toUpperCase() + state.expiredTier.slice(1) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <StatusRow level={licenceLevel(color.state)} label="Tier" summary={tierLabel} />
      {state.licensee && <DetailRow label="Licensee" value={state.licensee} />}
      {state.email && <DetailRow label="Email" value={state.email} />}
      <DetailRow label="First run" value={state.firstRun} />
      <DetailRow label="Fingerprint" value={state.fingerprint.substring(0, 16)} />
      <DetailRow label="Valid until" value={validUntilText} />
      {state.tier !== 'community' && expiry && <DetailRow label="Expiry" value={expiry} />}
      {state.tier !== 'community' && expDate != null && totalDays != null && daysUsed != null && (
        <ProgressBar value={daysUsed} total={totalDays} label="days into licence" />
      )}
      {/* #2632 / #2607: expiry or manual removal of a paid tier in this session. */}
      {state.expiredTier && (
        <StatusRow level="fail" label="Licence" summary={isExpired
          ? `${expiredTier} licence expired on ${state.exp ?? 'unknown date'}. Renew to restore access.`
          : `${expiredTier} licence removed. Was valid until ${state.exp ?? 'unknown date'}.`} />
      )}
      {color.state === 'amber' && !state.expiredTier && (
        <StatusRow level="warn" label="Licence" summary="approaching its limit; consider renewing" />
      )}
      {color.state === 'red' && !state.expiredTier && (
        <StatusRow level="fail" label="Licence" summary="at or past its limit; renew before issuing further work" />
      )}
      {/* #2608 / #2664: a Consultant or Enterprise key on a Community binary is capped to Community. */}
      {state.tier === 'community' && state.exp != null && new Date(state.exp).getTime() > Date.now() && (
        <StatusRow level="warn" label="Licence" summary={`Higher-tier licence on file, capped to Community by this binary. Valid until ${state.exp}${state.licensee ? ` (${state.licensee})` : ''}; use the Consultant or Enterprise binary.`} />
      )}
    </Box>
  );
}

interface LicenseScreenProps {
  onBack: () => void;
}

export function LicenseScreen({ onBack }: LicenseScreenProps) {
  const header = useScreenHeader('Licence Management');
  const [sub, setSubState] = useState<SubScreen>('menu');
  const [runDone, setRunDone] = useState(false);
  const [tier, setTier]   = useState('consultant');
  const setSub = (next: SubScreen): void => { setRunDone(false); setSubState(next); };
  const finished = (): void => setRunDone(true);

  // #0744: guided collection fields for the request token.
  const [reqStep, setReqStep]         = useState(0);
  const [reqLicensee, setReqLicensee] = useState('');
  const [reqEmail, setReqEmail]       = useState('');
  const [reqOrgName, setReqOrgName]   = useState('');
  const [reqOrgId, setReqOrgId]       = useState('');
  const [emailError, setEmailError]   = useState('');
  // #2299: licence activation key (pasted by user in activate-input sub-screen).
  const [activateKey, setActivateKey] = useState('');
  // #2315: capture tier/licensee before transitioning to remove-running.
  const [removeTier, setRemoveTier]       = useState('consultant');
  const [removeLicensee, setRemoveLicensee] = useState('');
  const menuGuidance = useOptionGuidance(MENU_GUIDANCE);
  const tierGuidance = useOptionGuidance(TIER_GUIDANCE);
  // #4213: the highlighted option of the removal confirmation; undefined falls back to the sub-step entry.
  const [removeOptionEntry, setRemoveOptionEntry] = useState<GuidanceEntry | undefined>(undefined);

  // Load licence state for the status panel; re-read after an activation returns to the menu.
  const licenseLoad = useMemo<{ state: LicenseState | null; error: string | null }>(() => {
    try {
      return { state: LicenseGuard.load().state, error: null };
    } catch (e) {
      if (e instanceof LicenseInvalidError) {
        return { state: null, error: e.message };
      }
      return { state: null, error: (e as Error).message };
    }
  }, [sub]);

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
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(keyEvt, guidanceOpenRef.current)) return;
    if (keyEvt.escape) {
      if (sub === 'menu') {
        onBack();
      } else if (sub === 'request-details') {
        // Step back within the details form; leave the form on step 0.
        setEmailError('');
        if (reqStep > 0) { setReqStep(s => s - 1); }
        else { setSub('request'); }
      } else {
        setSub('menu');
      }
    }
  });

  const requestFile = join(process.cwd(), 'swao-license-request.txt');
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

  const title = sub === 'menu' ? { title: 'Licence Management', subtitle: 'Status, upgrade request and activation of the licence of this machine.' }
    : sub === 'status' ? { title: 'Licence status' }
    : sub === 'request' ? { title: 'Licence tier to request' }
    : sub === 'request-details' ? { title: `${tierName} licence request`, subtitle: `Step ${Math.min(reqStep, 3) + 1} of 4: ${DETAIL_STEPS[Math.min(reqStep, 3)]}` }
    : sub === 'request-running' ? { title: `${tierName} licence request` }
    : sub === 'activate-input' ? { title: 'Activate a license', subtitle: 'Paste your licence key.' }
    : sub === 'activate-running' ? { title: 'Activating the licence' }
    : sub === 'remove-confirm' ? { title: 'Remove License', subtitle: 'This permanently removes the licence from this machine.' }
    : { title: 'Removing the licence' };

  const entry: GuidanceEntry = sub === 'menu' ? menuGuidance.entry
    : sub === 'request' ? tierGuidance.entry
    : sub === 'status' ? {
      title: 'Licence status',
      what: licenseLoad.state?.tier === 'community'
        ? 'Community tier is active: free, unlimited assessments. Consultant adds PDF reports and BI export; Enterprise adds portfolio operations and the adversarial challenge.'
        : 'Your licence is active. The machine fingerprint shown is the identifier of this licence; keep it for renewal requests.',
      sections: [
        { label: 'Upgrade', text: 'Choose Request a license upgrade in the Licence menu.' },
        { label: 'Contact', text: CONTACT },
      ],
      cli: 'swao license status',
    }
    : sub === 'request-details' ? [
      { title: 'Your name', what: 'Your full name as it should appear on the licence; pre-filled from an existing licence.', sections: [{ label: 'Example', text: 'Jane Doe' }] },
      { title: 'Contact email', what: 'The email address the licence key is sent to; pre-filled from an existing licence. Use your organisation email.', sections: [{ label: 'Example', text: 'jane.doe@company.com' }] },
      { title: 'Organisation name', what: 'The full legal name of your organisation; it appears on the licence and in SWAO reports.', sections: [{ label: 'Example', text: 'Accenture GmbH' }] },
      { title: 'Organisation id', what: `Short lowercase identifier of your organisation, used for seat grouping in ${tierName} licences.${tier === 'enterprise' ? '' : ' Leave blank to skip.'}`, sections: [{ label: 'Format', text: 'lowercase letters, digits and hyphens, for example accenture-gmbh' }] },
    ][Math.min(reqStep, 3)]!
    : sub === 'request-running' ? {
      title: 'Licence request',
      what: 'The request token is generated and saved in your working directory. Send it to the SWAO team to receive your signed licence key. The request token itself is not an activation key.',
      sections: [
        { label: 'Saved to', text: requestFile },
        { label: 'Next step', text: 'When you receive the key by email, choose Activate a license in the Licence menu.' },
        { label: 'Contact', text: CONTACT },
      ],
      cli: `swao license request --tier ${tier}`,
    }
    : sub === 'activate-input' ? {
      title: 'Activate a license',
      what: 'Paste the signed licence key you received by email, in full; a partial key fails verification.',
      sections: [{ label: 'Contact', text: `${CONTACT} for invalid or expired keys` }],
      cli: 'swao license activate <key>',
    }
    : sub === 'activate-running' ? {
      title: 'Activation result',
      what: 'When the activation succeeded, the new licence tier is active; Show license status confirms tier, expiry and budget.',
      sections: [{ label: 'On error', text: `Check that the key was not cut or changed. Contact ${CONTACT} if the error persists.` }],
      cli: 'swao license activate <key>',
    }
    : sub === 'remove-confirm' ? removeOptionEntry ?? {
      title: 'Remove License',
      what: 'Removing the licence deletes the licence file of this machine. A removal token lets the operator verify the removal; to use SWAO with this tier again you request and activate a new key.',
      sections: [
        { label: 'After removal', text: 'Choose Request a license upgrade to request a new key.' },
        { label: 'Contact', text: CONTACT },
      ],
      cli: 'swao license remove',
    }
    : {
      title: 'Licence removed',
      what: 'Keep the removal token: it is the proof of removal and lets the operator re-issue a seat on a new machine.',
      sections: [
        { label: 'Next step', text: `Send the email shown to ${CONTACT} so the operator can update the registry.` },
        { label: 'New machine', text: 'On the new machine, choose Request a license upgrade in the Licence menu and send the request token to your SWAO contact.' },
      ],
      cli: 'swao license remove',
    };

  return (
    <ScreenLayout
      header={header}
      title={title}
      keys={licenseKeys(sub, runDone)}
      guidance={{ entry, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {sub === 'menu' && licenseLoad.state && <LicenseStatusPanel state={licenseLoad.state} />}
      {sub === 'menu' && licenseLoad.error && (
        <Box marginBottom={1}><StatusRow level="fail" label="Licence" summary={licenseLoad.error} /></Box>
      )}

      {sub === 'menu' && (
        <SelectInput
          label="Choose an action"
          options={SUB_OPTIONS}
          showKeyHints={false}
          onCursorChange={menuGuidance.onCursorChange}
          onSelect={(v) => { if (v === 'back') onBack(); else setSub(v as SubScreen); }}
        />
      )}

      {sub === 'status' && <LicenseRun args={['license', 'status']} onFinished={finished} onDone={() => setSub('menu')} />}

      {sub === 'request' && (
        <SelectInput
          label="License tier to request"
          options={TIER_OPTIONS}
          showKeyHints={false}
          onCursorChange={tierGuidance.onCursorChange}
          onSelect={(v) => { setTier(v); setReqStep(0); setSub('request-details'); }}
        />
      )}

      {/* #0744: collect identity fields before generating the request token. */}
      {sub === 'request-details' && reqStep === 0 && (
        <TextInput
          label="Your full name"
          placeholder={licenseLoad.state?.licensee ?? 'e.g. Jane Doe'}
          onSubmit={(v) => {
            setReqLicensee(v.trim() || (licenseLoad.state?.licensee ?? ''));
            setReqStep(1);
          }}
          active
        />
      )}
      {sub === 'request-details' && reqStep === 1 && (
        <>
          <TextInput
            label="Contact email"
            placeholder={licenseLoad.state?.email ?? 'e.g. jane.doe@company.com'}
            onSubmit={(v) => {
              const val = v.trim();
              // #1526: basic format guard: an @ and a dot after the @.
              if (val && (!val.includes('@') || !val.slice(val.indexOf('@')).includes('.'))) {
                setEmailError('not an email address');
                return;
              }
              setEmailError('');
              setReqEmail(val || (licenseLoad.state?.email ?? ''));
              setReqStep(2);
            }}
            active
          />
          {emailError && <StatusRow level="fail" label="Email" summary={emailError} />}
        </>
      )}
      {sub === 'request-details' && reqStep === 2 && (
        <TextInput
          label="Organisation name"
          placeholder="e.g. Accenture GmbH"
          onSubmit={(v) => { setReqOrgName(v.trim()); setReqStep(3); }}
          active
        />
      )}
      {sub === 'request-details' && reqStep === 3 && (
        <TextInput
          label={`Org ID slug${tier === 'enterprise' ? ' (required)' : ' (optional)'}`}
          placeholder="e.g. accenture"
          onSubmit={(v) => { setReqOrgId(v.trim()); setSub('request-running'); }}
          active
        />
      )}

      {sub === 'request-running' && (
        <LicenseRun
          args={[
            'license', 'request', '--tier', tier,
            ...(reqLicensee ? ['--licensee', reqLicensee] : []),
            ...(reqEmail    ? ['--email', reqEmail]       : []),
            ...(reqOrgName  ? ['--org-name', reqOrgName]  : []),
            ...(reqOrgId    ? ['--org-id', reqOrgId]      : []),
          ]}
          onFinished={finished}
          onDone={() => setSub('menu')}
          saveToFile={requestFile}
        />
      )}

      {/* #2299: Activate a license, key input. */}
      {sub === 'activate-input' && (
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
      )}

      {sub === 'activate-running' && activateKey && (
        <LicenseRun args={['license', 'activate', activateKey]} onFinished={finished} onDone={() => setSub('menu')} />
      )}

      {/* #2315: Remove license, confirmation. */}
      {sub === 'remove-confirm' && (
        <>
          {licenseLoad.state && <LicenseStatusPanel state={licenseLoad.state} />}
          {licenseLoad.error && <StatusRow level="fail" label="Licence" summary={licenseLoad.error} />}
          <StatusRow level="warn" label="Remove" summary="permanently removes the licence from this machine; a removal token is generated for your records" />
          <SelectInput
            label="Confirm removal"
            options={[
              {
                label: 'Remove license',
                value: 'do-remove',
                detail: 'generates a removal token',
                guidance: { title: 'Remove license', what: 'Deletes the licence file of this machine now and shows a removal token; keep the token as the proof of removal.', cli: 'swao license remove' },
              },
              { label: 'Cancel', value: 'cancel', guidance: { title: 'Cancel', what: 'Returns to the Licence menu; the licence stays on this machine.' } },
            ]}
            showKeyHints={false}
            onCursorChange={(_v, o) => setRemoveOptionEntry(o?.guidance)}
            onSelect={(v) => {
              if (v === 'cancel') {
                setSub('menu');
              } else {
                setRemoveTier(licenseLoad.state?.tier ?? 'consultant');
                setRemoveLicensee(licenseLoad.state?.licensee ?? '');
                setSub('remove-running');
              }
            }}
          />
        </>
      )}

      {sub === 'remove-running' && (
        <RemoveRun tier={removeTier} licensee={removeLicensee} onFinished={finished} onDone={() => setSub('menu')} />
      )}
    </ScreenLayout>
  );
}

