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

// #1652: unipipe command stub -- meshcloud UniPipe integration (automated
// landing zone provisioning). Licence tier matrix D-04
// (the SWAO licence tier matrix): meshcloud integration is
// on the Enterprise roadmap alongside Terraform (F-090), so the command is gated
// with FEATURE_GATES['unipipe'] (#3324). Before #3324 the Consultant and
// Enterprise binaries had no gate at all. Lower tiers get the [LICENSE] block
// and exit non-zero; Enterprise gets the coming-soon notice.

import type { Command } from 'commander';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError } from '@swao/core';
import { printLicenseGateError, printLicenseLimitError, printLicenseInvalidError } from '../lib/license-gate-error.js';
import { tierLabel } from '../lib/tier-stub.js';

export function registerUnipipe(program: Command): void {
  program
    .command('unipipe')
    .description(`meshcloud UniPipe integration: provision and manage landing zones via UniPipe API ${tierLabel('unipipe')}`)
    .option('--workspace <path>', 'Workspace directory (default: current directory)')
    .option('--app <id>', 'Application ID to provision a landing zone for')
    .action((_opts: { workspace?: string; app?: string }) => {
      try {
        LicenseGuard.load().requireFeature('unipipe');
      } catch (err) {
        if (err instanceof LicenseTierError) printLicenseGateError('swao unipipe', err.required, err.current);
        if (err instanceof LicenseLimitError) printLicenseLimitError(err);
        if (err instanceof LicenseInvalidError) printLicenseInvalidError(err.message);
        throw err;
      }
      console.log('unipipe: meshcloud UniPipe integration is coming soon (Enterprise roadmap).');
      console.log('Run `swao lz` for the current landing zone assessment commands.');
    });
}
