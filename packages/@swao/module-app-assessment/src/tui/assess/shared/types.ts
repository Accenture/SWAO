// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Shared types for assess phase components (#2371).
// Moved from AssessScreen.tsx to allow import by extracted phase components.

export interface LocalConnectorInfo {
  id: string;
  name: string;
  credentialKey: string | undefined;
  envVar: string | undefined;
  baseUrl: string;
  protocol: string;
  defaultModel: string;
}
