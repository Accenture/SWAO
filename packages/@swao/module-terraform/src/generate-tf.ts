// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Terraform module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import {
  LicenseGuard,
  LicenseLimitError,
  LicenseTierError,
  LicenseInvalidError,
} from '@swao/core';

const UPGRADE_MESSAGE = [
  '[LICENSE] Terraform generation requires a Consultant or Enterprise license.',
  'Run `swao license request` to obtain a license.',
  'Contact: https://github.com/Accenture/SWAO/discussions',
].join('\n');

export function registerGenerateTf(program: Command): void {
  program
    .command('generate-tf')
    .alias('tf-gen')
    .description('Generate Terraform modules for sovereign landing zone (Consultant+)')
    .option('--app <app>', 'Application name to generate Terraform for')
    .action((_opts: { app?: string }) => {
      let guard;
      try {
        guard = LicenseGuard.load();
      } catch (e) {
        if (e instanceof LicenseInvalidError) {
          console.error(e.message);
          process.exit(3);
        }
        throw e;
      }

      try {
        guard.requireTier('consultant', { feature: 'generate-tf' });
      } catch (e) {
        if (e instanceof LicenseTierError || e instanceof LicenseLimitError) {
          console.error(UPGRADE_MESSAGE);
          process.exit(2);
        }
        throw e;
      }

      // TF generation logic will be implemented under a separate issue
      console.error('generate-tf: Terraform module generation not yet implemented.');
      process.exit(1);
    });
}
