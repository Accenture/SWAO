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

// #4257 (TUI-13, Design 126 sections 3, 4, 6 and 7): Credential Management on
// ScreenLayout. Every sub-screen reports its title, key hints and guidance
// entry to the one layout; the pickers show the credential key and its
// description in two columns with one guidance entry per key; command results
// through StatusRow and RunOutput; the CLI only in the guidance `cli` field.

import { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { listLocalConnectors } from '@swao/module-llm-providers';
import {
  PasswordInput, RunOutput, ScreenLayout, SelectInput, StatusRow, TextInput,
  guidanceOwnsKey, tone, useOptionGuidance,
  type GuidanceEntry, type KeyHint, type SelectOption,
} from '@swao/tui-kit';
import { CredentialStore, logPortfolio } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { renderCredentialList } from '../../commands/credential.js';
import { useScreenHeader } from '../components/screen-header.js';
import { computeCredentialWindow, CRED_CHROME_RESERVED, CRED_MIN_VISIBLE } from './credential-window.js';

// #1815 / #4241: child processes start through the central self-spawn helper
// (selfSpawnCommand): in the pkg binary argv[1] is never passed.

type SubScreen =
  | 'menu'
  | 'list'
  | 'set-pick'   | 'set-custom' | 'set-value' | 'set-running'
  | 'set-pw-appid' | 'set-pw-url' | 'set-pw-user' | 'set-pw-pass'
  | 'set-pw-save1' | 'set-pw-save2' | 'set-pw-save3'
  | 'delete-pick' | 'delete-custom' | 'delete-confirm' | 'delete-running';

const STORAGE = 'OS keyring or ~/.config/swao/.swao-credentials.json';

const SUB_OPTIONS: SelectOption[] = [
  { label: 'List stored credentials', value: 'list', guidance: { title: 'List stored credentials', what: 'Show the names of the credentials stored on this machine. Values are never shown.', cli: 'swao credential list' } },
  { label: 'Set / update a credential', value: 'set-pick', guidance: { title: 'Set / update a credential', what: 'Store a new credential or replace the value of a stored one. The value is masked and encrypted.', cli: 'swao credential set <name>' } },
  { label: 'Delete a credential', value: 'delete-pick', guidance: { title: 'Delete a credential', what: 'Remove a credential from the encrypted store of this machine.', cli: 'swao credential delete <name>' } },
  { label: 'Back to main menu', value: 'back', guidance: { title: 'Back', what: 'Leave Credential Management.' } },
];

/** The credential keys SWAO knows: key, description, guidance text. */
const KNOWN_CREDS: ReadonlyArray<{ key: string; detail: string; what: string }> = [
  { key: 'anthropic-api-key', detail: 'Anthropic API key (sk-ant-...)', what: 'API key of the Anthropic console (API Keys page), used by the LLM passes.' },
  { key: 'openai-api-key', detail: 'OpenAI API key (sk-...)', what: 'API key of the OpenAI platform (API keys page), an alternative LLM provider.' },
  { key: 'openrouter-api-key', detail: 'OpenRouter API key (sk-or-...)', what: 'API key of OpenRouter, an LLM gateway with many models.' },
  { key: 'provider:github:token', detail: 'GitHub personal access token', what: 'Classic or fine-grained token (GitHub, Settings, Developer settings), used to clone the source code.' },
  { key: 'provider:gitlab:token', detail: 'GitLab personal access token', what: 'Token from GitLab, User Settings, Access Tokens, used to clone the source code.' },
  { key: 'provider:azure-devops:token', detail: 'Azure DevOps personal access token', what: 'Token from Azure DevOps, User Settings, Personal access tokens, used to clone the source code.' },
];

type CredOption = SelectOption;

function credOption(key: string, detail: string, what: string): CredOption {
  return { label: key, value: key, detail, guidance: { title: key, what, cli: `swao credential set ${key}` } };
}

const PLAYWRIGHT_OPTION: CredOption = {
  label: 'playwright-[app]', value: 'playwright', detail: 'web crawl URL, username and password (wizard)',
  guidance: { title: 'Playwright credentials', what: 'Three keys for the web crawl of one app: playwright-url-<appId>, playwright-user-<appId> and playwright-pass-<appId>. The wizard asks for each.' },
};

const OTHER_OPTION: CredOption = {
  label: 'other', value: 'other', detail: 'enter a custom name',
  guidance: { title: 'Custom credential name', what: 'Type the exact key name to store, for example a connector credential key.' },
};

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

// #1834 / #3388 (Design 112): connector credential keys from the one shared
// loader (listLocalConnectors), so connectors added later appear in the pick
// list without a code change. The loader seeds the workspace folder when empty.
function discoverConnectorCredOptions(): CredOption[] {
  try {
    const knownValues = new Set(KNOWN_CREDS.map(o => o.key));
    const discovered: CredOption[] = [];
    for (const c of listLocalConnectors(process.cwd())) {
      const keyStr = c.credentialKey;
      if (typeof keyStr === 'string' && keyStr.length > 0 && !knownValues.has(keyStr)) {
        discovered.push(credOption(keyStr, `connector credential key (${c.id})`, `Credential key of the LLM gateway connector ${c.id}.`));
        knownValues.add(keyStr);
      }
    }
    return discovered;
  } catch {
    return [];
  }
}

/** The pick list: known keys, connector keys, the Playwright wizard and "other" last. */
export function credentialPickOptions(connectors: CredOption[], withPlaywright: boolean): CredOption[] {
  return [
    ...KNOWN_CREDS.map((c) => credOption(c.key, c.detail, c.what)),
    ...connectors,
    ...(withPlaywright ? [PLAYWRIGHT_OPTION] : []),
    OTHER_OPTION,
  ];
}

interface CredentialRunProps {
  args: string[];
  onDone: () => void;
  onFinished?: () => void;
}

/** Runs one `swao credential` command; the result as a StatusRow, the output wrapped. */
function CredentialRun({ args, onDone, onFinished }: CredentialRunProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [code, setCode]   = useState<number | null>(null);

  useEffect(() => {
    const selfCmd = selfSpawnCommand(args);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
    });
    const push = (chunk: Buffer) =>
      setLines(prev => [...prev, ...chunk.toString().split('\n').filter(Boolean)]);
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (exitCode) => {
      setCode(exitCode);
      setDone(true);
      onFinished?.();
      if (exitCode !== 0) {
        try { logPortfolio('error', 'setup.credential.error', `Credential command exited ${exitCode}`, { context: { exit_code: exitCode } }); } catch { /* best-effort */ }
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
      {lines.length > 0 && <RunOutput lines={lines} maxLines={16} />}
      {done && <StatusRow level={code === 0 ? 'ok' : 'warn'} label="Result" summary={code === 0 ? 'done' : `finished with exit code ${code}`} />}
    </Box>
  );
}

// #1413: in-process credential list with viewport scrolling.
function CredentialListView({ onBack }: { onBack: () => void }) {
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
      {loading && <Text {...tone('muted')}>Loading...</Text>}
      {!loading && win.aboveCount > 0 && (
        <Text {...tone('muted')}>{`  ↑ ${win.aboveCount} more line${win.aboveCount !== 1 ? 's' : ''} above`}</Text>
      )}
      {lines.slice(win.start, win.end).map((line, i) => (
        <Text key={win.start + i}>{line}</Text>
      ))}
      {!loading && win.belowCount > 0 && (
        <Text {...tone('muted')}>{`  ↓ ${win.belowCount} more line${win.belowCount !== 1 ? 's' : ''} below`}</Text>
      )}
    </Box>
  );
}

const PICK_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
const INPUT_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }];
const RESULT_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];

/** Key hints of a sub-screen (Design 126 section 7.9); `runDone` for the command sub-screens. */
export function credentialKeys(sub: SubScreen, runDone: boolean): readonly KeyHint[] {
  switch (sub) {
    case 'menu':
      return [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }];
    case 'list':
      return [{ key: '↑↓', verb: 'scroll' }, { key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
    case 'set-pick':
    case 'delete-pick':
      return PICK_KEYS;
    case 'set-value':
    case 'set-pw-pass':
      return [{ key: 'Enter', verb: 'save' }, { key: 'Esc', verb: 'back' }];
    case 'set-custom':
    case 'set-pw-appid':
    case 'set-pw-url':
    case 'set-pw-user':
    case 'delete-custom':
      return INPUT_KEYS;
    case 'delete-confirm':
      return [{ key: 'Enter', verb: 'confirm' }, { key: 'Esc', verb: 'cancel' }];
    case 'set-running':
    case 'set-pw-save1':
    case 'set-pw-save2':
    case 'set-pw-save3':
    case 'delete-running':
      return runDone ? RESULT_KEYS : [];
    default: {
      const never: never = sub;
      return never;
    }
  }
}

const MENU_GUIDANCE: GuidanceEntry = {
  title: 'Credential Management',
  what: 'API keys and tokens stored encrypted on this machine. Never printed in logs or reports.',
  sections: [{ label: 'Storage', text: STORAGE }],
  cli: 'swao credential list',
};

function subGuidance(sub: SubScreen, credName: string, pwAppId: string): GuidanceEntry {
  switch (sub) {
    case 'list':
      return { title: 'Stored credentials', what: 'The credentials listed are encrypted on this machine. SWAO uses them for the LLM providers and the source code repositories.', sections: [{ label: 'Update', text: 'Choose Set / update a credential in the menu to rotate a value.' }], cli: 'swao credential list' };
    case 'set-custom':
      return { title: 'Custom credential name', what: 'Enter the exact key name to store. For web crawl credentials pick playwright-[app] instead; the wizard names the three keys.', sections: [{ label: 'Playwright keys', text: 'playwright-url-<appId>, playwright-user-<appId>, playwright-pass-<appId>' }], cli: 'swao credential set <name>' };
    case 'set-value':
      return { title: 'Credential value', what: `Paste or type the value of ${credName}. The input is masked and stored encrypted.`, sections: [{ label: 'Storage', text: STORAGE }], cli: `swao credential set ${credName}` };
    case 'set-pw-appid':
      return { title: 'Playwright wizard, app id', what: 'A short identifier of the application (lowercase, hyphens allowed). It is the suffix of the three keys.', sections: [{ label: 'Example', text: 'sovereign-health gives playwright-url-sovereign-health' }] };
    case 'set-pw-url':
      return { title: 'Playwright wizard, login URL', what: 'The URL of the login page of the application itself, not a marketing homepage without a login form.', sections: [{ label: 'Key', text: `playwright-url-${pwAppId}` }] };
    case 'set-pw-user':
      return { title: 'Playwright wizard, username', what: 'The login email or username of the application account.', sections: [{ label: 'Key', text: `playwright-user-${pwAppId}` }] };
    case 'set-pw-pass':
      return { title: 'Playwright wizard, password', what: 'The login password. The input is masked; the three keys are saved next.', sections: [{ label: 'Key', text: `playwright-pass-${pwAppId}` }] };
    case 'set-running':
    case 'set-pw-save1':
    case 'set-pw-save2':
    case 'set-pw-save3':
      return { title: 'Saving the credential', what: 'The credential is encrypted and stored on this machine.', sections: [{ label: 'Storage', text: STORAGE }] };
    case 'delete-custom':
      return { title: 'Credential name to delete', what: 'Enter the exact key name to remove from the encrypted store.', cli: 'swao credential delete <name>' };
    case 'delete-confirm':
    case 'delete-running':
      return { title: 'Delete a credential', what: `Remove ${credName} from the encrypted store of this machine. This cannot be undone.`, cli: `swao credential delete ${credName}` };
    case 'menu':
    case 'set-pick':
    case 'delete-pick':
      return MENU_GUIDANCE;
    default: {
      const never: never = sub;
      return never;
    }
  }
}

function subTitle(sub: SubScreen, credName: string, pwAppId: string): { title: string; subtitle?: string } {
  switch (sub) {
    case 'menu': return { title: 'Credential Management', subtitle: 'API keys and tokens, encrypted on this machine.' };
    case 'list': return { title: 'Stored credentials' };
    case 'set-pick': return { title: 'Credential to set' };
    case 'set-custom': return { title: 'Custom credential name' };
    case 'set-value': return { title: `Value of ${credName}` };
    case 'set-running': return { title: `Saving ${credName}` };
    case 'set-pw-appid': return { title: 'Playwright wizard', subtitle: 'App id' };
    case 'set-pw-url': return { title: 'Playwright wizard', subtitle: `Login URL of ${pwAppId}` };
    case 'set-pw-user': return { title: 'Playwright wizard', subtitle: `Username of ${pwAppId}` };
    case 'set-pw-pass': return { title: 'Playwright wizard', subtitle: `Password of ${pwAppId}` };
    case 'set-pw-save1': return { title: `Saving playwright-url-${pwAppId}`, subtitle: '1 of 3' };
    case 'set-pw-save2': return { title: `Saving playwright-user-${pwAppId}`, subtitle: '2 of 3' };
    case 'set-pw-save3': return { title: `Saving playwright-pass-${pwAppId}`, subtitle: '3 of 3' };
    case 'delete-pick': return { title: 'Credential to delete' };
    case 'delete-custom': return { title: 'Credential name to delete' };
    case 'delete-confirm': return { title: `Delete ${credName}?` };
    case 'delete-running': return { title: `Deleting ${credName}` };
    default: {
      const never: never = sub;
      return never;
    }
  }
}

interface CredentialScreenProps {
  onBack: () => void;
}

export function CredentialScreen({ onBack }: CredentialScreenProps) {
  const header = useScreenHeader('Credential Management');
  // #2541: discover connector credential options at render time (not at import time)
  // so that connector YAML files written by the wizard are visible when the user
  // opens this screen for the first time.
  const connectorOptions = useMemo<CredOption[]>(() => discoverConnectorCredOptions(), []);
  const setOptions = useMemo(() => credentialPickOptions(connectorOptions, true), [connectorOptions]);
  const deleteOptions = useMemo(() => credentialPickOptions(connectorOptions, false), [connectorOptions]);
  const [sub, setSubState]          = useState<SubScreen>('menu');
  const [runDone, setRunDone]       = useState(false);
  const [credName, setCredName]     = useState('');
  const [credValue, setCredValue]   = useState('');
  // #1281: Playwright three-key wizard state
  const [pwAppId, setPwAppId]       = useState('');
  const [pwUrl, setPwUrl]           = useState('');
  const [pwUser, setPwUser]         = useState('');
  const [pwPass, setPwPass]         = useState('');
  const guidanceOpenRef = useRef(false);
  const menuGuidance = useOptionGuidance(MENU_GUIDANCE);
  const pickGuidance = useOptionGuidance(MENU_GUIDANCE);
  const setSub = (next: SubScreen): void => { setRunDone(false); setSubState(next); };

  useInput((_input, key) => {
    // Design 126 section 7.8: an open guidance box owns Esc and the pager keys.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (!key.escape) return;
    // Command and list sub-screens handle Esc themselves (back when done).
    if (sub === 'list' || sub === 'set-running' || sub === 'delete-running' || sub.startsWith('set-pw-save')) return;
    if (sub === 'menu') onBack(); else setSub('menu');
  });

  const entry = sub === 'menu' ? menuGuidance.entry
    : sub === 'set-pick' || sub === 'delete-pick' ? pickGuidance.entry
    : subGuidance(sub, credName, pwAppId);
  const finished = (): void => setRunDone(true);

  return (
    <ScreenLayout
      header={header}
      title={subTitle(sub, credName, pwAppId)}
      keys={credentialKeys(sub, runDone)}
      guidance={{ entry, initiallyCollapsed: true, onOpenChange: (open) => { guidanceOpenRef.current = open; } }}
    >
      {sub === 'menu' && (
        <SelectInput
          label="Choose an action"
          options={SUB_OPTIONS}
          showKeyHints={false}
          onCursorChange={menuGuidance.onCursorChange}
          onSelect={(v) => { if (v === 'back') { onBack(); } else { setSub(v as SubScreen); } }}
        />
      )}

      {sub === 'list' && <CredentialListView onBack={() => setSub('menu')} />}

      {/* ---- SET flow ---- */}

      {sub === 'set-pick' && (
        <SelectInput
          label="Credential to set"
          options={setOptions}
          visibleCount={Math.min(setOptions.length, 12)}
          showKeyHints={false}
          onCursorChange={pickGuidance.onCursorChange}
          onSelect={(v) => {
            if (v === 'other')       { setSub('set-custom'); }
            else if (v === 'playwright') { setSub('set-pw-appid'); }
            else { setCredName(v); setSub('set-value'); }
          }}
        />
      )}

      {sub === 'set-custom' && (
        <TextInput
          label="Credential name"
          placeholder="my-custom-key"
          onSubmit={(v) => { if (v) { setCredName(v); setSub('set-value'); } }}
          active
        />
      )}

      {sub === 'set-value' && (
        <PasswordInput
          label={credentialValueLabel(credName) + ' (masked)'}
          onSubmit={(v) => {
            if (v) { setCredValue(v); setSub('set-running'); }
            else   { setSub('menu'); }
          }}
          active
        />
      )}

      {sub === 'set-running' && (
        <CredentialRun
          args={['credential', 'set', credName, credValue]}
          onFinished={finished}
          onDone={() => { setCredValue(''); setSub('list'); }}
        />
      )}

      {/* ---- Playwright three-key wizard ---- */}

      {sub === 'set-pw-appid' && (
        <TextInput
          label="App id (names the three keys)"
          placeholder="sovereign-health"
          onSubmit={(v) => { if (v) { setPwAppId(v); setSub('set-pw-url'); } }}
          active
        />
      )}

      {sub === 'set-pw-url' && (
        <TextInput
          label={`playwright-url-${pwAppId}`}
          placeholder="https://app.example.com"
          onSubmit={(v) => { if (v) { setPwUrl(v); setSub('set-pw-user'); } }}
          active
        />
      )}

      {sub === 'set-pw-user' && (
        <TextInput
          label={`playwright-user-${pwAppId}`}
          placeholder="user@example.com"
          onSubmit={(v) => { if (v) { setPwUser(v); setSub('set-pw-pass'); } }}
          active
        />
      )}

      {sub === 'set-pw-pass' && (
        <PasswordInput
          label={`playwright-pass-${pwAppId} (masked)`}
          onSubmit={(v) => {
            if (v) { setPwPass(v); setSub('set-pw-save1'); }
            else   { setSub('menu'); }
          }}
          active
        />
      )}

      {sub === 'set-pw-save1' && (
        <CredentialRun
          args={['credential', 'set', `playwright-url-${pwAppId}`, pwUrl]}
          onFinished={finished}
          onDone={() => setSub('set-pw-save2')}
        />
      )}

      {sub === 'set-pw-save2' && (
        <CredentialRun
          args={['credential', 'set', `playwright-user-${pwAppId}`, pwUser]}
          onFinished={finished}
          onDone={() => setSub('set-pw-save3')}
        />
      )}

      {sub === 'set-pw-save3' && (
        <CredentialRun
          args={['credential', 'set', `playwright-pass-${pwAppId}`, pwPass]}
          onFinished={finished}
          onDone={() => { setPwAppId(''); setPwUrl(''); setPwUser(''); setPwPass(''); setSub('list'); }}
        />
      )}

      {/* ---- DELETE flow ---- */}

      {sub === 'delete-pick' && (
        <SelectInput
          label="Credential to delete"
          options={deleteOptions}
          visibleCount={Math.min(deleteOptions.length, 12)}
          showKeyHints={false}
          onCursorChange={pickGuidance.onCursorChange}
          onSelect={(v) => {
            if (v === 'other') { setSub('delete-custom'); }
            else { setCredName(v); setSub('delete-confirm'); }
          }}
        />
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
        />
      )}

      {sub === 'delete-running' && (
        <CredentialRun args={['credential', 'delete', credName]} onFinished={finished} onDone={() => setSub('menu')} />
      )}
    </ScreenLayout>
  );
}

/** The delete question; Esc (cancel) is handled by the screen. */
function DeleteConfirm({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
  });

  return (
    <Text wrap="wrap">
      <Text>Delete </Text>
      <Text {...tone('accent')}>{name}</Text>
      <Text> from the encrypted store of this machine?</Text>
    </Text>
  );
}
