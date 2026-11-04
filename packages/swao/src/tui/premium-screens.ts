// Premium screen registry (sprint-128 #2132 -- community source isolation).
//
// App.tsx does NOT import premium module packages directly. Instead, tier entry
// points (consultant.ts, enterprise.ts) populate this registry at startup before
// calling buildProgram(). The Community entry registers only the stub
// ChatScreen (#3348 B-02), so esbuild tree-shakes the premium module imports
// out of bundle-community.cjs.
//
// Each field is typed with the minimal props that App.tsx passes to the screen.

import type { ComponentType } from 'react';

export interface PortfolioScreenProps {
  onBack: () => void;
  onOpenLicense: () => void;
  version: string;
}

export interface GenerateTfScreenProps {
  onBack: () => void;
  onOpenLicense: () => void;
  version: string;
}

export interface ChallengeScreenProps {
  mode: 'app' | 'lz';
  initialApp?: string;
  onBack: () => void;
  onComplete: () => void;
  onOpenLicense: () => void;
  version: string;
}

/** #3348 B-02: SWAO Chat. Every tier entry registers it: the real screen in
 * Enterprise, the premium-stubs upgrade notice in Community and Consultant. */
export interface ChatScreenProps {
  onBack: () => void;
}

export const premiumScreens: {
  ChatScreen?: ComponentType<ChatScreenProps>;
  PortfolioScreen?: ComponentType<PortfolioScreenProps>;
  GenerateTfScreen?: ComponentType<GenerateTfScreenProps>;
  ChallengeScreen?: ComponentType<ChallengeScreenProps>;
} = {};
