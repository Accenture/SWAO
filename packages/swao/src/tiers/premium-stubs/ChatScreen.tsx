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

import React from 'react';
import { Box, Text, useInput } from 'ink';

export function ChatScreen({ onBack }: { onBack: () => void }) {
  useInput((input, key) => {
    if (key.escape || key.return || input === 'q' || input === 'Q') onBack();
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="yellow">[LICENSE] SWAO Chat requires an Enterprise licence and the Enterprise binary.</Text>
      <Text>To upgrade: swao license request --tier enterprise</Text>
      <Text>Contact: https://github.com/Accenture/SWAO/discussions</Text>
      <Box marginTop={1}><Text dimColor>Esc / Enter / Q -- back</Text></Box>
    </Box>
  );
}
