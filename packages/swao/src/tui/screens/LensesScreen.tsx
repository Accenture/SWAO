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

import { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { Header } from '../components/Header.js';
import { GuidanceBox } from '@swao/tui-kit';
import { findWorkspace } from '@swao/core';
import {
  listLenses,
  readWorkspaceLenses,
  writeWorkspaceLenses,
  type LensDef,
} from '../../commands/lenses.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the controls/lenses directory robustly -- try multiple candidate
// paths to handle both development (src/) and binary (pkg snapshot) layouts.
function resolveLensesDir(): string {
  const candidates = [
    join(__dirname, '../../../../../controls/lenses'),  // dist/tui/screens -> swao/
    join(__dirname, '../../../../controls/lenses'),      // alt depth
    join(__dirname, '../../../../../../controls/lenses'),// pkg snapshot extra level
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p) && readdirSync(p).some(f => f.endsWith('.yaml'))) return p;
    } catch { /* skip */ }
  }
  return candidates[0]; // fallback; listLenses will return []
}

const LENSES_DIR = resolveLensesDir();

interface LensItem extends LensDef {
  selected: boolean;
}

interface LensesScreenProps {
  onBack: () => void;
  onRunAssessment?: () => void;
}

export function LensesScreen({ onBack, onRunAssessment }: LensesScreenProps) {
  const workspace = findWorkspace(process.cwd());
  const swaoYmlPath = workspace ? join(workspace, '.swao.yml') : null;

  const defs = listLenses(LENSES_DIR);
  const active = swaoYmlPath ? readWorkspaceLenses(swaoYmlPath) : [];

  const [items, setItems] = useState<LensItem[]>(
    defs.map((def) => ({ ...def, selected: active.includes(def.id) })),
  );
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<string>('');

  // Compute the union of passes across selected lenses.
  const selectedPasses = Array.from(
    new Set(items.filter((it) => it.selected).flatMap((it) => it.passes)),
  );

  // Helper: save current selection to .swao.yml. Returns true on success.
  const saveLenses = (): boolean => {
    const chosen = items.filter((it) => it.selected).map((it) => it.id);
    if (!swaoYmlPath) {
      setStatus('No workspace found -- navigate to a workspace directory first.');
      return false;
    }
    try {
      writeWorkspaceLenses(swaoYmlPath, chosen);
      setStatus(`Saved ${ chosen.length } lens(es): ${ chosen.join(', ') || '(none)' }. Press R to run now, or Esc to go back.`);
      return true;
    } catch (err) {
      setStatus(`Error saving: ${ (err as Error).message }`);
      return false;
    }
  };

  const guidanceOpenRef = useRef(false);

  useInput((input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.upArrow) {
      setIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (input === ' ') {
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, selected: !it.selected } : it)),
      );
      return;
    }

    const lower = input.toLowerCase();

    if (lower === 'a' || key.return) {
      // Apply and save.
      saveLenses();
      return;
    }

    if (lower === 'r') {
      // Save + navigate to Run Assessment.
      if (saveLenses() && onRunAssessment) {
        onRunAssessment();
      } else if (!onRunAssessment) {
        setStatus('Saved. Use Run Assessment (main menu item 3) to run with the active lenses.');
      }
      return;
    }

    if (lower === 'b' || key.escape) {
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Manage Assessment Lenses" />

      <Box marginTop={1}>
        <Text bold color="cyanBright">Assessment Lenses</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Lenses select which analysis passes run and which compliance frameworks are
          automatically applied.
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {items.map((item, i) => {
          const active = i === idx;
          const check = item.selected ? '[x]' : '[ ]';
          const fwLabel = item.auto_frameworks.length > 0
            ? `  (auto: ${ item.auto_frameworks.join(', ') })`
            : '';
          return (
            <Box key={item.id}>
              <Text color={active ? 'cyan' : undefined} bold={active}>
                {active ? ' > ' : '   '}
                <Text color={item.selected ? 'cyan' : 'white'}>{check} </Text>
                {item.id}
              </Text>
              <Text dimColor>{`  passes: ${ item.passes.join(', ') }${ fwLabel }`}</Text>
            </Box>
          );
        })}
      </Box>

      {items.length === 0 && (
        <Box marginTop={1}>
          <Text color="yellow">No lenses available. This should not happen -- please report this as a bug.</Text>
        </Box>
      )}

      {/* #0922: cap box width to match header separator so it does not overflow on wide terminals */}
      <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}
        width={Math.min(100, Math.max(63, (process.stdout.columns ?? 80) - 2))}
      >
        <Text bold>Pass union for selected lenses:</Text>
        <Text color="cyanBright" wrap="wrap">
          {selectedPasses.length > 0 ? selectedPasses.join(', ') : '(none selected)'}
        </Text>
      </Box>

      {status !== '' && (
        <Box marginTop={1}>
          <Text color="green">{status}</Text>
        </Box>
      )}

      <GuidanceBox
        title="Assessment Lenses"
        what="Select which passes and frameworks run. A or Enter saves. R saves and navigates to Run Assessment."
        details={[{ label: 'After saving', value: 'Go to Run Assessment (main menu 3) to run with saved lenses' }]}
        affordances={['Space -- toggle  |  Enter/A -- save  |  R -- save + run  |  Esc/B -- back']}
        onOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
    </Box>
  );
}
