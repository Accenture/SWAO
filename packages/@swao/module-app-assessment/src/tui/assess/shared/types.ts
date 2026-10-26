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

// #3388 (Design 112): one connector reader + one LocalConnectorInfo type for
// every screen. Re-exported from @swao/module-llm-providers so the type stays
// identical across the TUI and the loader (the four private copies are gone).
export type { LocalConnectorInfo } from '@swao/module-llm-providers';
