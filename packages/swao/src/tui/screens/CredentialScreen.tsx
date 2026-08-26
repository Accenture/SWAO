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

import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { Header } from '../components/Header.js';
import { TextInput } from '@swao/tui-kit';
import { PasswordInput } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { LiveOutput } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { CredentialStore } from '@swao/core';
import { renderCredentialList } from '../../commands/credential.js';
import { computeCredentialWindow, CRED_CHROME_RESERVED, CRED_MIN_VISIBLE } from './credential-window.js';

// In pkg binary mode argv[1] equals the binary path itself -- passing it as
// an extra arg causes a double-binary invocation and silent exit (#1815).
const isPkg = Boolean((process as { pkg?: unknown }).pkg);
const BIN        = process.execPath;
const BASE_ARGS  = isPkg ? [] : [process.argv[1] as string];

type SubScreen =
  | 'menu'
  | 'list'
  | 'set-pick'   | 'set-custom' | 'set-value' | 'set-running'
  | 'set-pw-appid' | 'set-pw-url' | 'set-pw-user' | 'set-pw-pass'
  | 'set-pw-save1' | 'set-pw-save2' | 'set-pw-save3'
  | 'delete-pick' | 'delete-custom' | 'delete-confirm' | 'delete-running';

const SUB_OPTIONS = [
  { label: 'List stored credentials',   value: 'list'      },
  { label: 'Set / update a credential', value: 'set-pick'  },
  { label: 'Delete a credential',       value: 'delete-pick' },
  { label: 'Back to main menu',         value: 'back'      },
];

const KNOWN_CRED_OPTIONS = [
  { label: 'anthropic-api-key          -- Anthropic API key (sk-ant-...)',          value: 'anthropic-api-key'       },
  { label: 'openai-api-key             -- OpenAI API key (sk-...)',                 value: 'openai-api-key'          },
  { label: 'provider:github:token      -- GitHub PAT (#0421)',                      value: 'provider:github:token'   },
  { label: 'provider:gitlab:token      -- GitLab PAT (#0421)',                      value: 'provider:gitlab:token'   },
  { label: 'provider:azure-devops:token -- Azure DevOps PAT (#0421)',               value: 'provider:azure-devops:token' },
  { label: 'playwright-[app]            -- Web crawl URL + username + password (wizard)', value: 'playwright'        },
  { label: 'other                       -- Enter a custom name',                    value: 'other'                   },
];

type CredOption = { label: string; value: string };

// #1834: Discover connector credential keys from wsp/inputs/llm-gateway/*.yaml so
// connectors added after this file was written (e.g. openrouter-api-key) appear in
// Derive a friendly input label from a credential key slug (#1961).
// e.g. "openrouter-api-key" -> "API Key", "playwright-url-acme" -> "URL".
function credentialValueLabel(slug: string): string {
  const s = slug.toLowerCase();
  if (s.includes('api-key') || s.includes('apikey')) return 'API Key';
  if (s.includes('-url') || s.endsWith('url'))        return 'URL';
  if (s.includes('-pass') || s.endsWith('pass'))      return 'Password';
  if (s.includes('-user') || s.endsWith('user'))      return 'Username';
  if (s.includes('token'))                            return 'Token';
  return 'Value';
}

// the pick list without requiring a code change.
function discoverConnectorCredOptions(): CredOption[] {
  try {
    const gatewayDir = join(process.cwd(), 'wsp', 'inputs', 'llm-gateway');
    const knownValues = new Set(KNOWN_CRED_OPTIONS.map(o => o.value));
    const discovered: CredOption[] = [];
    let files: string[] = [];
    try { files = readdirSync(gatewayDir).filter(f => f.endsWith('.yaml')); } catch { return []; }
    for (const f of files) {
      try {
        const parsed = yamlLoad(readFileSync(join(gatewayDir, f), 'utf-8'));
        const key = (parsed as Record<string, unknown> | null)?.['connector'] as Record<string, unknown> | undefined;
        const credKey = key?.['auth'] as Record<string, unknown> | undefined;
        const keyStr = credKey?.['credential_key'];
        if (typeof keyStr === 'string' && keyStr.length > 0 && !knownValues.has(keyStr)) {
          discovered.push({ label: `${keyStr}  -- connector credential key (${f})`, value: keyStr });
          knownValues.add(keyStr);
        }
      } catch { /* skip malformed YAML */ }
    }
    return discovered;
  } catch {
    return [];
  }
}

// Merge hardcoded options with auto-discovered connector keys; 'other' stays last.
const _OTHER = KNOWN_CRED_OPTIONS[KNOWN_CRED_OPTIONS.length - 1] as CredOption;
const ALL_CRED_OPTIONS: CredOption[] = [
  ...KNOWN_CRED_OPTIONS.slice(0, -1),
  ...discoverConnectorCredOptions(),
  _OTHER,
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
    const child = spawn(BIN, [...BASE_ARGS, ...args], {
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
      <LiveOutput lines={lines} maxLines={16} />
      {done && <Text dimColor>Press Enter or Escape to go back...</Text>}
    </Box>
  );
}

// #1413: in-process credential list with viewport scrolling.
// Replaces RunOutput (child process, 16-line cap) for the list sub-screen.
interface CredentialListViewProps {
  onBack: () => void;
}

function CredentialListView({ onBack }: CredentialListViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const { stdout } = useStdout();

  useEffect(() => {
    const store = new CredentialStore();
    store.list()
      .then(names => {
        setLines(names.length === 0 ? ['  (no credentials stored)'] : renderCredentialList(names));
        setLoading(false);
      })
      .catch(() => {
        setLines(['  (error reading credentials)']);
        setLoading(false);
      });
  }, []);

  const rows = stdout?.rows ?? 24;
  const viewportSize = Math.max(CRED_MIN_VISIBLE, rows - CRED_CHROME_RESERVED);
  const total = lines.length;
  const win = computeCredentialWindow(offset, total, rows);

  // Use refs so the useInput closure always reads fresh values without stale captures.
  const totalRef = useRef(total);
  totalRef.current = total;
  const viewportRef = useRef(viewportSize);
  viewportRef.current = viewportSize;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useInput((_input, key) => {
    if (loadingRef.current) return;
    if (key.return || key.escape) { onBack(); return; }
    const maxOff = Math.max(0, totalRef.current - viewportRef.current);
    if (key.upArrow)   setOffset(o => Math.max(0, o - 1));
    if (key.downArrow) setOffset(o => Math.min(maxOff, o + 1));
    if (key.pageUp)    setOffset(o => Math.max(0, o - viewportRef.current));
    if (key.pageDown)  setOffset(o => Math.min(maxOff, o + viewportRef.current));
  });

  return (
    <Box flexDirection="column">
      {loading && <Text color="yellow">Loading...</Text>}
      {!loading && win.aboveCount > 0 && (
        <Text color="gray">  ^ {win.aboveCount} more line{win.aboveCount !== 1 ? 's' : ''} above (arrow up)</Text>
      )}
      {lines.slice(win.start, win.end).map((line, i) => (
        <Text key={win.start + i}>{line}</Text>
      ))}
      {!loading && win.belowCount > 0 && (
        <Text color="gray">  v {win.belowCount} more line{win.belowCount !== 1 ? 's' : ''} below (arrow down)</Text>
      )}
      {!loading && <Text dimColor>Press Enter or Escape to go back...</Text>}
    </Box>
  );
}

interface CredentialScreenProps {
  onBack: () => void;
}

export function CredentialScreen({ onBack }: CredentialScreenProps) {
  const [sub, setSub]               = useState<SubScreen>('menu');
  const [credName, setCredName]     = useState('');
  const [credValue, setCredValue]   = useState('');
  // #1281: Playwright three-key wizard state
  const [pwAppId, setPwAppId]       = useState('');
  const [pwUrl, setPwUrl]           = useState('');
  const [pwUser, setPwUser]         = useState('');
  const [pwPass, setPwPass]         = useState('');
  const guidanceOpenRef = useRef(false);

  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) { if (sub === 'menu') onBack(); else setSub('menu'); }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Credential Management" />

      {sub === 'menu' && (
        <>
          <SelectInput
            label="Choose an action"
            options={SUB_OPTIONS}
            onSelect={(v) => { if (v === 'back') { onBack(); } else { setSub(v as SubScreen); } }}
            active
          />
          <GuidanceBox
            title="Credential Management"
            what="API keys stored encrypted on this machine. Never printed in logs or reports."
            details={[{ label: 'Storage', value: 'OS keyring or ~/.config/swao/.swao-credentials.json' }]}
            affordances={['Up/Down -- pick action  |  Enter -- confirm  |  Esc -- back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {sub === 'list' && (
        <>
          <CredentialListView onBack={() => setSub('menu')} />
          <GuidanceBox
            title="Stored Credentials"
            what="Credentials listed above are encrypted on this machine. They are used by SWAO to access LLM providers and VCS repositories."
            details={[{ label: 'Update', value: 'Choose "Set / update a credential" from the menu to rotate a value' }]}
            affordances={['Up/Down/PgUp/PgDn -- scroll  |  Enter / Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {/* ---- SET flow ---- */}

      {sub === 'set-pick' && (
        <>
          <SelectInput
            label="Credential to set"
            options={ALL_CRED_OPTIONS}
            onSelect={(v) => {
              if (v === 'other')       { setSub('set-custom'); }
              else if (v === 'playwright') { setSub('set-pw-appid'); }
              else { setCredName(v); setSub('set-value'); }
            }}
            active
          />
          <GuidanceBox
            title="Set Credential"
            what="Select the credential to store or update. Values are encrypted on this machine."
            details={[
              { label: 'Anthropic', value: 'sk-ant-... API key for LLM analysis passes (required for AI passes)' },
              { label: 'OpenAI', value: 'sk-... API key (alternative LLM provider)' },
              { label: 'VCS tokens', value: 'GitHub / GitLab / Azure DevOps PATs for source code clone' },
            ]}
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {sub === 'set-custom' && (
        <Box flexDirection="column">
          <TextInput
            label="Credential name"
            placeholder="my-custom-key"
            onSubmit={(v) => { if (v) { setCredName(v); setSub('set-value'); } }}
            active
          />
          <GuidanceBox
            title="Custom Credential Name"
            what="Enter the exact key name to store. Use the Playwright wizard (pick 'playwright-[app]') to add web-crawl credentials."
            details={[
              { label: 'Playwright URL',  value: 'playwright-url-<appId>  e.g. playwright-url-sovereign-health' },
              { label: 'Playwright user', value: 'playwright-user-<appId> e.g. playwright-user-sovereign-health' },
              { label: 'Playwright pass', value: 'playwright-pass-<appId> e.g. playwright-pass-sovereign-health' },
            ]}
            affordances={['Enter -- confirm name  |  Esc -- back to credential menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-value' && (
        <Box flexDirection="column">
          <Text>Name: <Text color="cyanBright">{credName}</Text></Text>
          <PasswordInput
            label={credentialValueLabel(credName) + ' (masked)'}

            onSubmit={(v) => {
              if (v) { setCredValue(v); setSub('set-running'); }
              else   { setSub('menu'); }
            }}
            active
          />
          <GuidanceBox
            title="Enter Credential Value"
            what={`Paste or type the value for "${credName}". Input is masked and stored encrypted.`}
            details={[
              { label: 'anthropic-api-key',          value: 'sk-ant-api03-... (Anthropic console -> API Keys)' },
              { label: 'openai-api-key',              value: 'sk-... (platform.openai.com -> API keys)' },
              { label: 'provider:github:token',       value: 'ghp_... or fine-grained token (GitHub -> Settings -> Developer settings)' },
              { label: 'provider:gitlab:token',       value: 'glpat-... (GitLab -> User Settings -> Access Tokens)' },
              { label: 'provider:azure-devops:token', value: 'Azure DevOps PAT (User Settings -> Personal access tokens)' },
              { label: 'playwright-url-<appId>',      value: 'App login URL -- e.g. https://app.sovereignhealth.io (NOT the marketing homepage)' },
              { label: 'playwright-user-<appId>',     value: 'Login email or username for the app' },
              { label: 'playwright-pass-<appId>',     value: 'Login password for the app' },
            ]}
            affordances={['Enter -- save value  |  Esc -- back to credential menu (to pick a different name)']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-running' && (
        <>
          <RunOutput
            args={['credential', 'set', credName, credValue]}
            onDone={() => { setCredValue(''); setSub('list'); }}
          />
          <GuidanceBox
            title="Credential Saved"
            what="The credential has been encrypted and stored on this machine."
            details={[{ label: 'Storage', value: 'OS keyring or ~/.config/swao/.swao-credentials.json' }]}
            affordances={['Enter / Esc -- back to menu  |  Use "Set / update" again to rotate the value']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {/* ---- Playwright three-key wizard ---- */}

      {sub === 'set-pw-appid' && (
        <Box flexDirection="column">
          <TextInput
            label="App ID (used to name the three keys)"
            placeholder="sovereign-health"
            onSubmit={(v) => { if (v) { setPwAppId(v); setSub('set-pw-url'); } }}
            active
          />
          <GuidanceBox
            title="Playwright Wizard -- App ID"
            what="Enter a short identifier for the application (lowercase, hyphens ok). This becomes the suffix in playwright-url-<appId>, playwright-user-<appId>, playwright-pass-<appId>."
            details={[{ label: 'Example', value: 'sovereign-health  ->  playwright-url-sovereign-health' }]}
            affordances={['Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-pw-url' && (
        <Box flexDirection="column">
          <Text dimColor>App ID: <Text color="cyanBright">{pwAppId}</Text></Text>
          <TextInput
            label={`playwright-url-${pwAppId}`}
            placeholder="https://app.example.com"
            onSubmit={(v) => { if (v) { setPwUrl(v); setSub('set-pw-user'); } }}
            active
          />
          <GuidanceBox
            title="Playwright Wizard -- Login URL"
            what="Enter the URL of the application login page. This must be the actual app, not a marketing homepage."
            details={[
              { label: 'Correct',   value: 'https://app.sovereignhealth.io  (the authenticated app)' },
              { label: 'Incorrect', value: 'https://sovereignhealth.io  (marketing site -- has no login form)' },
            ]}
            affordances={['Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-pw-user' && (
        <Box flexDirection="column">
          <Text dimColor>App ID: <Text color="cyanBright">{pwAppId}</Text>  URL: <Text color="cyanBright">{pwUrl}</Text></Text>
          <TextInput
            label={`playwright-user-${pwAppId}`}
            placeholder="user@example.com"
            onSubmit={(v) => { if (v) { setPwUser(v); setSub('set-pw-pass'); } }}
            active
          />
          <GuidanceBox
            title="Playwright Wizard -- Username"
            what="Enter the login email or username for the application account."
            affordances={['Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-pw-pass' && (
        <Box flexDirection="column">
          <Text dimColor>App ID: <Text color="cyanBright">{pwAppId}</Text></Text>
          <PasswordInput
            label={`playwright-pass-${pwAppId} (masked)`}
            onSubmit={(v) => {
              if (v) { setPwPass(v); setSub('set-pw-save1'); }
              else   { setSub('menu'); }
            }}
            active
          />
          <GuidanceBox
            title="Playwright Wizard -- Password"
            what="Enter the login password. Input is masked. Three keys will be saved next."
            affordances={['Enter -- save all three keys  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {sub === 'set-pw-save1' && (
        <Box flexDirection="column">
          <Text dimColor>Saving playwright-url-{pwAppId}... (1/3)</Text>
          <RunOutput
            args={['credential', 'set', `playwright-url-${pwAppId}`, pwUrl]}
            onDone={() => setSub('set-pw-save2')}
          />
        </Box>
      )}

      {sub === 'set-pw-save2' && (
        <Box flexDirection="column">
          <Text dimColor>Saving playwright-user-{pwAppId}... (2/3)</Text>
          <RunOutput
            args={['credential', 'set', `playwright-user-${pwAppId}`, pwUser]}
            onDone={() => setSub('set-pw-save3')}
          />
        </Box>
      )}

      {sub === 'set-pw-save3' && (
        <Box flexDirection="column">
          <Text dimColor>Saving playwright-pass-{pwAppId}... (3/3)</Text>
          <RunOutput
            args={['credential', 'set', `playwright-pass-${pwAppId}`, pwPass]}
            onDone={() => { setPwAppId(''); setPwUrl(''); setPwUser(''); setPwPass(''); setSub('list'); }}
          />
        </Box>
      )}

      {/* ---- DELETE flow ---- */}

      {sub === 'delete-pick' && (
        <>
          <SelectInput
            label="Credential to delete"
            options={ALL_CRED_OPTIONS}
            onSelect={(v) => {
              if (v === 'other') { setSub('delete-custom'); }
              else { setCredName(v); setSub('delete-confirm'); }
            }}
            active
          />
          <GuidanceBox
            title="Delete Credential"
            what="Select the credential to permanently remove from the encrypted store."
            affordances={['Up/Down -- pick  |  Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </>
      )}

      {sub === 'delete-custom' && (
        <TextInput
          label="Credential name to delete"
          placeholder="my-custom-key"
          onSubmit={(v) => { if (v) { setCredName(v); setSub('delete-confirm'); } }}
          active
        />
      )}

      {sub === 'delete-confirm' && (
        <DeleteConfirm
          name={credName}
          onConfirm={() => setSub('delete-running')}
          onCancel={() => setSub('menu')}
        />
      )}

      {sub === 'delete-running' && (
        <RunOutput args={['credential', 'delete', credName]} onDone={() => setSub('menu')} />
      )}

      <Box marginTop={1}>
        <Text dimColor>Escape to go back</Text>
      </Box>
    </Box>
  );
}

function DeleteConfirm({ name, onConfirm, onCancel }: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>Delete <Text color="cyanBright">"{name}"</Text>?</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>  <Text color="cyanBright">Enter</Text>  -- confirm delete</Text>
        <Text>  <Text color="cyanBright">Escape</Text> -- cancel</Text>
      </Box>
    </Box>
  );
}
