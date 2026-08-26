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
import { GuidanceBox, licenseStatusColor, formatBudget, formatExpiry } from '@swao/tui-kit';
import { LicenseGuard, LicenseInvalidError } from '../../license/license-guard.js';
import type { LicenseState } from '../../license/license-guard.js';

// #0612: licence issuance is OPERATOR-ONLY and lives in the air-gapped
// swao-premium tooling (scripts/issue-license.mjs + license-tui.mjs), which
// wraps the hidden `swao license issue --json` signing primitive. The shipped
// product therefore exposes only the three things an end user needs:
// see their fingerprint (status panel), request a licence, and activate one.
// The previous in-TUI 7-step issuance flow was removed (Design 062 split).

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

type SubScreen =
  | 'menu'
  | 'status'
  | 'request'
  | 'request-details'
  | 'request-running';

const SUB_OPTIONS = [
  { label: 'Show license status',         value: 'status'  },
  { label: 'Request a license upgrade',   value: 'request' },
  { label: 'Back to main menu',           value: 'back'    },
];

const TIER_OPTIONS = [
  { label: 'Consultant', value: 'consultant' },
  { label: 'Enterprise', value: 'enterprise' },
];

interface RunOutputProps {
  args: string[];
  onDone: () => void;
}

function RunOutput({ args, onDone }: RunOutputProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);

  useEffect(() => {
    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const push = (chunk: Buffer) =>
      setLines(prev => [...prev, ...chunk.toString().split('\n').filter(Boolean)]);
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => { setCode(exitCode); setDone(true); });
    return () => { child.kill(); };
  }, []);

  useInput((_input, key) => {
    if (done && (key.return || key.escape)) onDone();
  });

  return (
    <Box flexDirection="column">
      {!done && <Text color="yellow">Running...</Text>}
      {done && code === 0 && <Text color="green">Done.</Text>}
      {done && code !== 0 && <Text color="yellow">Finished (exit {code}).</Text>}
      <LiveOutput lines={lines} maxLines={20} />
      {done && <Text dimColor>Press Enter or Escape to go back...</Text>}
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

  const limit = state.assessmentLimit;
  const expiry = formatExpiry(state);
  const expDate = state.exp ? new Date(state.exp).getTime() : null;
  const firstRunDate = new Date(state.firstRun).getTime();
  const totalDays = expDate != null ? Math.max(1, Math.round((expDate - firstRunDate) / 86_400_000)) : null;
  const daysUsed = expDate != null ? Math.min(totalDays!, Math.max(0, totalDays! - Math.floor((expDate - Date.now()) / 86_400_000))) : null;

  // #0707: compact layout -- single-line fields, no internal blank lines.
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1} width={width}>
      <Text bold color={color.inkColor}>Tier: {tierLabel}</Text>
      {state.licensee && <Text><Text dimColor>Licensee:     </Text><Text>{state.licensee}</Text></Text>}
      {state.email && <Text><Text dimColor>Email:        </Text><Text>{state.email}</Text></Text>}
      <Text><Text dimColor>First run:    </Text><Text>{state.firstRun}</Text><Text dimColor>    Fingerprint: </Text><Text>{state.fingerprint.substring(0, 8)}</Text></Text>

      {state.tier === 'community' ? (
        <>
          <Text><Text dimColor>Assessments:  </Text><Text>{state.assessmentCount} run (lifetime; no limit)</Text></Text>
          {expiry && expiry.startsWith('previous') && (
            <Text color="yellow" dimColor>{expiry}</Text>
          )}
        </>
      ) : (
        <>
          <Text><Text dimColor>Budget:       </Text><Text color={color.inkColor}>{formatBudget(state)}</Text></Text>
          {limit != null && (
            <ProgressBar value={state.assessmentCount} total={limit} label="assessments used" />
          )}
          {expiry && (
            <Text><Text dimColor>Expiry:       </Text><Text color={color.inkColor}>{expiry}</Text></Text>
          )}
          {expDate != null && totalDays != null && daysUsed != null && (
            <ProgressBar value={daysUsed} total={totalDays} label="days into licence" />
          )}
        </>
      )}

      {color.state === 'amber' && (
        <Text color="yellow">Licence is approaching its limit. Consider renewing.</Text>
      )}
      {color.state === 'red' && (
        <Text bold color="red">Licence at or past its limit. Renew before issuing further work.</Text>
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

  const guidanceOpenRef = useRef(false);

  useInput((_input, keyEvt) => {
    if (guidanceOpenRef.current) return;
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
        <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginBottom={1}>
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
        <RunOutput args={['license', 'status']} onDone={() => setSub('menu')} />
      )}

      {sub === 'request' && (
        <>
          <GuidanceBox
            title="Choose Licence Tier"
            what="Select the tier that matches your use case. Consultant adds PDF reports, BI export, and advanced features. Enterprise adds portfolio-level assessment and the adversarial challenge."
            details={[
              { label: 'Community',   value: 'Free (Apache-2.0). All assessment passes including LLM adapters. HTML report. No PDF, BI, portfolio, or custom LZ catalogue.' },
              { label: 'Consultant',  value: 'PDF reports, branded headers, BI templates (Power BI/Tableau), Terraform, NIS2/EU AI Act, custom LZ catalogue. Per-user annual.' },
              { label: 'Enterprise',  value: 'All Consultant features plus portfolio assessment, adversarial challenge, HTML portal, FedRAMP/CMMC/TISAX/HITRUST. Per-portfolio annual.' },
            ]}
            affordances={['Up/Down -- pick tier  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
          <SelectInput
            label="License tier to request"
            options={TIER_OPTIONS}
            onSelect={(v) => { setTier(v); setReqStep(0); setSub('request-details'); }}
            active
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
              <GuidanceBox
                title="Step 1 of 4 -- Your name"
                what="Enter your full name as it should appear on the licence. This is pre-filled from your existing licence if one is present."
                details={[{ label: 'Example', value: 'Jane Doe' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
              <TextInput
                label="Your full name"
                placeholder={licenseLoad.state?.licensee ?? 'e.g. Jane Doe'}
                onSubmit={(v) => {
                  setReqLicensee(v.trim() || (licenseLoad.state?.licensee ?? ''));
                  setReqStep(1);
                }}
                active
              />
            </>
          )}
          {reqStep === 1 && (
            <>
              <GuidanceBox
                title="Step 2 of 4 -- Contact email"
                what="The email address where your licence key will be sent. Use your organisation email, not a personal address."
                details={[{ label: 'Example', value: 'jane.doe@company.com' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
              <TextInput
                label="Contact email"
                placeholder={licenseLoad.state?.email ?? 'e.g. jane@company.com'}
                onSubmit={(v) => {
                  const val = v.trim() || (licenseLoad.state?.email ?? '');
                  // #1526: basic format guard -- must contain @ and a dot after @.
                  if (val && (!val.includes('@') || !val.slice(val.indexOf('@')).includes('.'))) {
                    return; // reject; user must re-enter
                  }
                  setReqEmail(val);
                  setReqStep(2);
                }}
                active
              />
            </>
          )}
          {reqStep === 2 && (
            <>
              <GuidanceBox
                title="Step 3 of 4 -- Organisation name"
                what="The full legal name of your organisation. This appears on the licence and in SWAO reports."
                details={[{ label: 'Example', value: 'Accenture GmbH' }]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
              <TextInput
                label="Organisation name"
                placeholder="e.g. Accenture GmbH"
                onSubmit={(v) => { setReqOrgName(v.trim()); setReqStep(3); }}
                active
              />
            </>
          )}
          {reqStep === 3 && (
            <>
              <GuidanceBox
                title="Step 4 of 4 -- Organisation ID slug"
                what={`Short lowercase identifier for your organisation. Used for seat grouping in ${tier === 'enterprise' ? 'Enterprise' : 'Consultant'} licences. Leave blank to skip.`}
                details={[
                  { label: 'Format',  value: 'Lowercase letters, digits, hyphens only' },
                  { label: 'Example', value: 'accenture-gmbh' },
                ]}
                onOpenChange={(open) => { guidanceOpenRef.current = open; }}
              />
              <TextInput
                label={`Org ID slug${tier === 'enterprise' ? ' (required)' : ' (optional, Enter to skip)'}`}
                placeholder="e.g. accenture"
                onSubmit={(v) => { setReqOrgId(v.trim()); setSub('request-running'); }}
                active
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
        />
      )}

    </Box>
  );
}
