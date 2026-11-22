// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Build-time stand-in for `tui/screens/ChatScreen.tsx` in the Community and
 * Consultant bundles (#3348 B-02, Design 122). SWAO Chat is Enterprise-only;
 * the screen shows the licence notice and returns on Esc, Enter or Q, so the
 * chat session code (tui/chat/*) is not in those bundles.
 */

import React, { useRef } from 'react';
import { Text, useInput } from 'ink';
import { ScreenLayout, guidanceOwnsKey, tone, type KeyHint } from '@swao/tui-kit';
import { useScreenHeader } from '../../tui/components/screen-header.js';

// #4257 (TUI-13, Design 126 section 3): on ScreenLayout like every screen;
// the upgrade command is the guidance CLI line, not screen text.
const KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];

export function ChatScreen({ onBack }: { onBack: () => void }) {
  const header = useScreenHeader('Chat with Portfolio');
  // Design 126 section 7.5: Esc closes an open guidance box first.
  const guidanceOpenRef = useRef(false);
  useInput((input, key) => {
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (key.escape || key.return || input === 'q' || input === 'Q') onBack();
  });
  return (
    <ScreenLayout
      header={header}
      keys={KEYS}
      guidance={{
        onOpenChange: (open) => { guidanceOpenRef.current = open; },
        entry: {
          title: 'Chat with Portfolio',
          what: 'SWAO Chat is part of the Enterprise binary. Request an Enterprise licence to use it.',
          sections: [{ label: 'Contact', text: 'https://github.com/Accenture/SWAO/discussions' }],
          cli: 'swao license request --tier enterprise',
        },
      }}
    >
      <Text {...tone('warning')}>[LICENSE] SWAO Chat requires an Enterprise licence and the Enterprise binary.</Text>
      <Text>To upgrade, request an Enterprise licence in Tools, then License.</Text>
    </ScreenLayout>
  );
}
