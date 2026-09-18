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

// ChatScreen -- Enterprise-gated multi-turn portfolio chat TUI (#2780).
//
// Renders inside the alt-screen TUI (App.tsx router, screen === 'chat').
// Delegates session management and LLM calls to useChatSession (#2781 #2782).
//
// Navigation: ESC exits to the Tools submenu.
// Input: printable characters accumulate in the input buffer; Enter sends;
// Backspace removes the last character. Up/Down arrows scroll the message
// window when history overflows the visible area.
//
// Layout (#2784/#2785): SWAO runs Ink inside an alt-screen buffer with no
// terminal scrollback (run-app.ts). Ink's <Static> component writes to stdout
// which is discarded in alt-screen mode, so a manual sliding viewport is used
// instead. useStdout() provides terminal dimensions; a height-estimation pass
// selects the most recent messages that fit in the available rows. Older
// messages are accessible via Up/Down arrow keys.
//
// MCP badge: [MCP: ok] / [MCP: offline] shown in the footer so the
// operator knows whether portfolio context was loaded.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { isAllowed } from '@swao/tui-kit';
import type { LicenseStateView } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { LicenseGuard } from '../../license/license-guard.js';
import { useChatSession } from '../chat/useChatSession.js';
import { SWAO_LANDING_URL } from '../../branding.js';
import type { ChatTurn } from '@swao/core';

interface ChatScreenProps {
  onBack: () => void;
  /** Workspace root passed from App.tsx (process.cwd() at launch time). */
  workspace?: string;
  /** Optional focused app ID. */
  appId?: string;
  /** LLM model override. */
  model?: string;
}

/** Upgrade notice when the user does not have an Enterprise licence. */
function EnterpriseGateView({ onBack }: { onBack: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Chat with Portfolio" />
      <Box marginTop={1} flexDirection="column">
        <Text bold color="yellow">Enterprise licence required</Text>
        <Text dimColor>swao chat is available on the Enterprise tier.</Text>
        <Text dimColor>Run `swao license` to upgrade or request a licence key.</Text>
        <Text dimColor>Contact: <Text bold color="cyanBright">{SWAO_LANDING_URL}</Text></Text>
      </Box>
      <Box marginTop={2}>
        <Text dimColor>Press Enter or Esc to go back</Text>
      </Box>
    </Box>
  );
}

const SPINNER_FRAMES = ['-', '\\', '|', '/'];

/**
 * Estimate how many terminal rows a single message occupies.
 * 1 row for the label + wrapped content rows + 1 row for marginBottom.
 * The viewport loop subtracts 1 for the last visible message (its trailing
 * margin is not rendered -- JSX uses marginBottom=0 for the last item).
 */
function estimateMessageRows(msg: ChatTurn, termCols: number): number {
  const usableWidth = Math.max(10, termCols - 6); // 6 = padding + indent overhead
  const lines = msg.content.split('\n');
  const contentRows = lines.reduce(
    (acc, line) => acc + Math.max(1, Math.ceil((line.length || 1) / usableWidth)),
    0,
  );
  return 1 + contentRows + 1; // label row + content rows + margin row
}

export function ChatScreen({ onBack, workspace, appId, model }: ChatScreenProps) {
  const licenseState = useMemo<LicenseStateView>(() => {
    try { return LicenseGuard.load().state as LicenseStateView; }
    catch { return { tier: 'community', assessmentCount: 0, firstRun: '' }; }
  }, []);

  // Enterprise gate
  if (!isAllowed(licenseState, 'enterprise')) {
    return <EnterpriseGateView onBack={onBack} />;
  }

  return <ChatSessionView onBack={onBack} workspace={workspace} appId={appId} model={model} />;
}

/** Inner view -- only rendered when Enterprise licence is confirmed. */
function ChatSessionView({ onBack, workspace, appId, model }: ChatScreenProps) {
  const [input, setInput] = useState('');
  const [spinnerIdx, setSpinnerIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();

  const session = useChatSession({ workspace, appId, model, autoMcp: true });

  // Cleanup on unmount
  useEffect(() => {
    return () => session.cleanup();
  }, []);

  // Spinner animation while thinking or loading
  useEffect(() => {
    if (session.status !== 'thinking' && session.status !== 'mcp-probe' &&
        session.status !== 'mcp-tools' && session.status !== 'init') return;
    const interval = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(interval);
  }, [session.status]);

  // Track message count so we can detect new arrivals
  const prevMsgLenRef = useRef(0);
  useEffect(() => {
    const len = session.messages.length;
    if (len > prevMsgLenRef.current) {
      prevMsgLenRef.current = len;
      // If the user was already at the bottom, keep them there.
      // scrollOffset === 0 means "show newest" so no action needed.
    }
  }, [session.messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setScrollOffset(0); // Jump to newest on every send
    await session.sendMessage(text);
  }, [input, session]);

  const allVisible = session.messages.filter(m => m.role !== 'system');

  useInput((inputChar, key) => {
    if (key.escape) {
      session.cleanup();
      onBack();
      return;
    }
    if (key.return) {
      void handleSend();
      return;
    }
    if (key.backspace || key.delete) {
      setInput(s => s.slice(0, -1));
      return;
    }
    if (key.upArrow) {
      setScrollOffset(n => Math.min(n + 1, Math.max(0, allVisible.length - 1)));
      return;
    }
    if (key.downArrow) {
      setScrollOffset(n => Math.max(0, n - 1));
      return;
    }
    // Accept printable characters only; reject control sequences
    if (!key.ctrl && !key.meta && inputChar && inputChar.length === 1) {
      setInput(s => s + inputChar);
    }
  });

  const isLoading = session.status === 'init' || session.status === 'mcp-probe' || session.status === 'mcp-tools';
  const isThinking = session.status === 'thinking';
  const isError = session.status === 'error';
  const isReady = session.status === 'ready';
  const spinner = SPINNER_FRAMES[spinnerIdx];

  // Calculate how many rows the fixed chrome consumes so we know the message budget.
  const termRows = stdout.rows ?? 24;
  const termCols = stdout.columns ?? 80;
  const chromeRows = (
    6 +                          // Header: ===, title, subtitle, ===, license, marginBottom
    2 +                          // Scroll indicator (marginTop + text) OR message-area top margin -- worst case 2 rows
    (isLoading  ? 2 : 0) +      // Loading indicator + margin
    (isThinking ? 2 : 0) +      // Thinking indicator + margin
    (isError    ? 3 : 0) +      // Error block
    2 +                          // Input line + margin
    3                            // Footer: hint line, URL, marginTop
  );
  const availableRows = Math.max(3, termRows - chromeRows);

  // Build the visible window: start from viewEnd = (total - clampedOffset) and
  // walk backwards accumulating height until the budget is exhausted.
  //
  // Last visible message: JSX renders marginBottom=0 (no trailing gap before input),
  // so subtract 1 from its estimate. Always include the most-recent message even if
  // it overruns the budget -- the terminal clips the bottom rows gracefully rather
  // than hiding the message entirely.
  const clampedOffset = Math.min(scrollOffset, Math.max(0, allVisible.length - 1));
  const viewEnd = allVisible.length - clampedOffset;
  let usedRows = 0;
  let viewStart = viewEnd;
  while (viewStart > 0) {
    const isLastMsg = (viewStart === viewEnd);
    const h = estimateMessageRows(allVisible[viewStart - 1], termCols);
    const adjusted = isLastMsg ? h - 1 : h; // last msg: no trailing margin in JSX
    // Non-last messages stop when they don't fit; last message always shows.
    if (!isLastMsg && usedRows + adjusted > availableRows) break;
    viewStart--;
    usedRows += adjusted;
  }

  const displayMessages = allVisible.slice(viewStart, viewEnd);
  const olderCount = viewStart;
  const newerCount = allVisible.length - viewEnd;

  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle="Chat with Portfolio" />

      {/* Older-messages scroll indicator */}
      {olderCount > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            {`^ ${olderCount} older message${olderCount !== 1 ? 's' : ''} -- Up arrow to scroll`}
          </Text>
        </Box>
      )}

      {/* Message window (#2784/#2785) */}
      {(isReady || isThinking || allVisible.length > 0) && (
        <Box marginTop={olderCount > 0 ? 0 : 1} flexDirection="column">
          {allVisible.length === 0 && isReady && (
            <Text dimColor>No messages yet. Type a question and press Enter.</Text>
          )}
          {displayMessages.map((msg, i) => (
            <Box key={viewStart + i} marginBottom={i < displayMessages.length - 1 ? 1 : 0} flexDirection="column">
              {/* Single template string avoids Ink multi-child expression artefacts (#2784) */}
              <Text bold color={msg.role === 'user' ? 'cyanBright' : 'greenBright'}>
                {`${msg.role === 'user' ? 'You' : 'SWAO'}${msg.model ? ` (${msg.model})` : ''}:`}
              </Text>
              <Box marginLeft={2}>
                <Text wrap="wrap">{msg.content}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Newer-messages indicator (shown when scrolled up) */}
      {newerCount > 0 && (
        <Box>
          <Text dimColor>
            {`v ${newerCount} newer message${newerCount !== 1 ? 's' : ''} -- Down arrow to scroll`}
          </Text>
        </Box>
      )}

      {/* Status / loading indicator */}
      {isLoading && (
        <Box marginTop={1}>
          <Text color="cyan">{spinner} </Text>
          <Text dimColor>
            {session.status === 'mcp-probe'  ? 'Connecting to MCP server...' :
             session.status === 'mcp-tools'  ? 'Loading portfolio context...' :
             'Initialising...'}
            {session.statusDetail ? ` ${session.statusDetail}` : ''}
          </Text>
        </Box>
      )}

      {/* Error state */}
      {isError && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Initialisation failed</Text>
          <Text dimColor>{session.statusDetail}</Text>
          <Box marginTop={1}><Text dimColor>Press Esc to go back</Text></Box>
        </Box>
      )}

      {/* Thinking indicator */}
      {isThinking && (
        <Box marginTop={1}>
          <Text color="cyan">{spinner} </Text>
          <Text dimColor>SWAO is thinking...</Text>
        </Box>
      )}

      {/* Input field */}
      {(isReady || isThinking) && (
        <Box marginTop={1}>
          <Text color="cyan">{'> '}</Text>
          <Text>{input}</Text>
          {isReady && <Text color="cyan">{'_'}</Text>}
        </Box>
      )}

      {/* Footer -- single template string prevents token-count from bleeding into URL (#2784) */}
      <Box marginTop={1}>
        <Text dimColor>
          {`Enter to send   Esc to exit${clampedOffset > 0 ? '   Up/Down to scroll' : ''}${session.mcpAvailable ? '   [MCP: ok]' : '   [MCP: offline]'}${session.totalTokensIn > 0 ? `   [tokens: ${session.totalTokensIn}/${session.tokenBudget}]` : ''}`}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{'Further information: '}</Text>
        <Text bold color="cyanBright">{SWAO_LANDING_URL}</Text>
      </Box>
    </Box>
  );
}
