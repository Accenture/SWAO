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

// #4239: the app kinds live in @swao/core (workspace-app-kinds.ts) since run 4,
// shared with the Publish and Portfolio pickers; this module re-exports them.

export { APP_KIND_GROUP, appKind, listWorkspaceApps, preselectedAppIndex, readSubjectApp } from '@swao/core';
export type { AppKind, WorkspaceApp } from '@swao/core';
