// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  IaC provider abstraction module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync } from 'fs';
import { join } from 'path';
import type { IaCProvider, IaCResourceGraph } from '../../types.js';
import { parsePulumiState } from './state-parser.js';

// ---------------------------------------------------------------------------
// PulumiProvider
// ---------------------------------------------------------------------------

export class PulumiProvider implements IaCProvider {
  readonly toolchain = 'pulumi' as const;

  async readState(filePaths: string[]): Promise<IaCResourceGraph> {
    const graphs = filePaths.map(parsePulumiState);

    // Merge all graphs into one (same toolchain, combined resources)
    const merged: IaCResourceGraph = {
      toolchain: 'pulumi',
      formatVersion: graphs[0]?.formatVersion ?? '3',
      resources: graphs.flatMap((g) => g.resources),
    };
    return merged;
  }

  async detect(dirPath: string): Promise<boolean> {
    if (!existsSync(dirPath)) return false;

    // Pulumi.yaml is the canonical Pulumi project descriptor
    if (existsSync(join(dirPath, 'Pulumi.yaml')) || existsSync(join(dirPath, 'Pulumi.yml'))) {
      return true;
    }

    // wsp/inputs/pulumi/ folder with .json files
    const pulumiInputDir = join(dirPath, 'wsp', 'inputs', 'pulumi');
    if (existsSync(pulumiInputDir)) {
      try {
        const { readdirSync } = await import('fs');
        if (readdirSync(pulumiInputDir).some((f) => f.endsWith('.json'))) return true;
      } catch {
        // ignore
      }
    }

    return false;
  }
}
