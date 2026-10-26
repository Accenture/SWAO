// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  assess: test-code setting of a run (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: `swao assess` resolves assessment.test_code / exclude_test_code once
// per run: the app .swao.yml wins, the workspace .swao.yml (written by the
// Setup Wizard) is the fallback, `include` the default. The workspace file is
// validated with the same Zod schema as the app file; an invalid workspace
// file is ignored here (the health check reports it).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { SwaoYmlSchema, resolveCodeHealthSetting, resolveTestCodeSetting, type ResolvedCodeHealthSetting, type ResolvedTestCodeSetting, type RunManifest, type SourceScopeSummary } from '@swao/core';

/** run-manifest files_assessed.source_scope. */
export type ManifestSourceScope = NonNullable<NonNullable<RunManifest['files_assessed']>['source_scope']>;

/** The workspace `.swao.yml` `assessment` block (undefined when absent, invalid or the app file itself). */
export function readWorkspaceAssessment(workspaceRoot: string | undefined, appYmlPath: string): unknown {
  if (!workspaceRoot) return undefined;
  const wsYmlPath = join(workspaceRoot, '.swao.yml');
  if (resolve(wsYmlPath) === resolve(appYmlPath) || !existsSync(wsYmlPath)) return undefined;
  try {
    const parsed = SwaoYmlSchema.safeParse(load(readFileSync(wsYmlPath, 'utf-8')) ?? {});
    if (parsed.success) return parsed.data.assessment;
  } catch { /* unreadable workspace yml: default */ }
  return undefined;
}

export function readRunTestCodeSetting(
  appAssessment: unknown,
  workspaceRoot: string | undefined,
  appYmlPath: string,
): ResolvedTestCodeSetting {
  return resolveTestCodeSetting(appAssessment, readWorkspaceAssessment(workspaceRoot, appYmlPath));
}

/** #3487: effective Pass 26 settings (`assessment.code_health`), app file first per key, then workspace. */
export function readRunCodeHealthSetting(
  appAssessment: unknown,
  workspaceRoot: string | undefined,
  appYmlPath: string,
): ResolvedCodeHealthSetting {
  return resolveCodeHealthSetting(appAssessment, readWorkspaceAssessment(workspaceRoot, appYmlPath));
}

/** run-manifest files_assessed fields for the source scope and the test-code setting. */
export function testCodeFilesAssessed(
  scope: Omit<SourceScopeSummary, 'root'>,
  setting: ResolvedTestCodeSetting,
  marked: { tagged: number; lowered: number },
): { source_files_total: number; source_scope: ManifestSourceScope } {
  // In exclude mode no pass but the secret scan read the test files, so the
  // in-scope total leaves them out.
  const testExcluded = setting.mode === 'exclude' ? scope.files_test : 0;
  return {
    source_files_total: scope.files_scanned - testExcluded,
    source_scope: {
      ...scope,
      test_code_mode: setting.mode,
      test_code_source: setting.source,
      ...(setting.mode !== 'include'
        ? { files_test_excluded: testExcluded, signals_test_tagged: marked.tagged, signals_test_lowered: marked.lowered }
        : {}),
    },
  };
}
