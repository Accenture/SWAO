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

// swao machine-id -- print the machine fingerprint used for licence binding (#2115).
//
// Wraps LicenseGuard.fingerprint() in a dedicated top-level command so operators
// and customers can retrieve the machine fingerprint without running `swao doctor`
// (which requires a configured workspace) or `swao license request` (which requires
// selecting a tier).

import type { Command } from 'commander';
import { LicenseGuard } from '@swao/core';

export function registerMachineId(program: Command): void {
  program
    .command('machine-id')
    .description('Print the machine fingerprint used for licence binding')
    .option('--json', 'Output machine-readable JSON', false)
    .action((opts: { json: boolean }) => {
      let fp: string;
      try {
        fp = LicenseGuard.fingerprint();
      } catch (e) {
        console.error(`[error] Could not read or create the machine state file: ${(e as Error).message}`);
        process.exit(1);
      }
      const fp8 = fp.substring(0, 8);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ fingerprint: fp8, fingerprint_full: fp }) + '\n');
      } else {
        console.log(`Machine fingerprint: ${fp8}`);
        console.log('');
        console.log('Provide this fingerprint when requesting a Consultant or Enterprise licence.');
        console.log('Full fingerprint (for operator use only): ' + fp);
      }
    });
}
