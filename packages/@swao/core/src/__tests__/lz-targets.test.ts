// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3281: assessment.landing_zone.targets schema + target resolution order.
// Fixtures are .swao.yml texts parsed through SwaoYmlSchema, as assess.ts does.

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { SwaoYmlSchema } from '../swao-yml.js';
import {
  parseLzTargetList,
  resolveLzTargets,
  setLzTargetsInSwaoYml,
  lzTargetsFromAssessment,
} from '../lz-targets.js';

const parseYml = (text: string): Record<string, unknown> => {
  const r = SwaoYmlSchema.safeParse(load(text) ?? {});
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data as Record<string, unknown>;
};
const assessmentOf = (text: string) => parseYml(text)['assessment'] as Record<string, unknown> | undefined;

const APP_YML = `
assessment:
  regimes_active: [GDPR, BSI_C5]
  landing_zone:
    provider: stackit
    region: eu01
    targets:
      - stackit:eu01
      - azure:Europe
      - provider: aws
        region: eu-central-1
`;

const WORKSPACE_YML = `
engagement:
  name: Demo
assessment:
  landing_zone:
    targets: [otc:eu-de, aws-esc:eusc-de-east-1]
`;

describe('SwaoYmlSchema assessment.landing_zone (#3281)', () => {
  it('accepts targets as provider:region strings and { provider, region } objects', () => {
    const a = assessmentOf(APP_YML)!;
    expect((a['landing_zone'] as Record<string, unknown>)['targets']).toHaveLength(3);
  });

  it('accepts a geography or an unknown region (shape only; resolved or skipped at run time)', () => {
    expect(() => parseYml('assessment:\n  landing_zone:\n    targets: [azure:Atlantis]\n')).not.toThrow();
  });

  it('keeps provider without region valid (Pass 23 LZR) and the deprecated lz_cat_targets string', () => {
    expect(() => parseYml('assessment:\n  landing_zone:\n    provider: meshstack\n  lz_cat_targets: aws:eu-central-1\n')).not.toThrow();
  });

  it('rejects a target without provider:region form with a message naming the key', () => {
    const r = SwaoYmlSchema.safeParse(load('assessment:\n  landing_zone:\n    targets: [nocolon]\n'));
    expect(r.success).toBe(false);
    expect(JSON.stringify(!r.success && r.error.issues)).toMatch(/<provider>:<region>/);
  });

  it('rejects targets that are not a list', () => {
    expect(SwaoYmlSchema.safeParse(load('assessment:\n  landing_zone:\n    targets: azure:westeurope\n')).success).toBe(false);
  });
});

describe('resolveLzTargets order (#3281)', () => {
  const app = assessmentOf(APP_YML);
  const workspace = assessmentOf(WORKSPACE_YML);

  it('--lz-cat-targets wins over every config key', () => {
    expect(resolveLzTargets({ cliTargets: 'gcp:europe-west3, oci:eu-frankfurt-1', appAssessment: app, workspaceAssessment: workspace })).toEqual({
      targets: [{ provider: 'gcp', region: 'europe-west3' }, { provider: 'oci', region: 'eu-frankfurt-1' }],
      source: 'cli:--lz-cat-targets',
    });
  });

  it('the single CLI pair wins over config; a missing half comes from the config pair', () => {
    expect(resolveLzTargets({ cliProvider: 'aws', cliRegion: 'eu-central-1', appAssessment: app })).toEqual({
      targets: [{ provider: 'aws', region: 'eu-central-1' }], source: 'cli:--lz-provider/--lz-region',
    });
    expect(resolveLzTargets({ cliRegion: 'eu02', appAssessment: app }).targets).toEqual([{ provider: 'stackit', region: 'eu02' }]);
  });

  it('app landing_zone.targets beats the app provider/region pair and the workspace', () => {
    expect(resolveLzTargets({ appAssessment: app, workspaceAssessment: workspace })).toEqual({
      targets: [
        { provider: 'stackit', region: 'eu01' },
        { provider: 'azure', region: 'Europe' },
        { provider: 'aws', region: 'eu-central-1' },
      ],
      source: 'app:assessment.landing_zone.targets',
    });
  });

  it('falls back to the workspace .swao.yml when the app configures no target', () => {
    const appProviderOnly = assessmentOf('assessment:\n  landing_zone:\n    provider: meshstack\n');
    expect(resolveLzTargets({ appAssessment: appProviderOnly, workspaceAssessment: workspace })).toEqual({
      targets: [{ provider: 'otc', region: 'eu-de' }, { provider: 'aws-esc', region: 'eusc-de-east-1' }],
      source: 'workspace:assessment.landing_zone.targets',
    });
  });

  it('reads the deprecated lz_cat_targets after landing_zone.targets and before provider/region', () => {
    const legacy = assessmentOf('assessment:\n  lz_cat_targets: "aws:eu-central-1,azure:westeurope"\n  landing_zone:\n    provider: stackit\n    region: eu01\n');
    expect(lzTargetsFromAssessment(legacy)).toEqual({
      targets: [{ provider: 'aws', region: 'eu-central-1' }, { provider: 'azure', region: 'westeurope' }],
      key: 'assessment.lz_cat_targets',
    });
  });

  it('keeps the single provider + region pair supported', () => {
    const single = assessmentOf('assessment:\n  landing_zone:\n    provider: stackit\n    region: eu01\n');
    expect(resolveLzTargets({ appAssessment: single })).toEqual({
      targets: [{ provider: 'stackit', region: 'eu01' }], source: 'app:assessment.landing_zone.provider/region',
    });
  });

  it('returns no target when nothing is configured', () => {
    expect(resolveLzTargets({})).toEqual({ targets: [], source: 'none' });
  });

  it('drops malformed pairs and duplicates from a CLI list', () => {
    expect(parseLzTargetList('aws:eu-central-1,nocolon,aws:eu-central-1,:x,azure:')).toEqual([{ provider: 'aws', region: 'eu-central-1' }]);
  });
});

describe('setLzTargetsInSwaoYml (TUI persistence, #3281)', () => {
  it('writes landing_zone.targets as a list, keeps provider/region and drops the deprecated key', () => {
    const yml = parseYml('assessment:\n  regimes_active: [GDPR]\n  lz_cat_targets: aws:eu-central-1\n  landing_zone:\n    provider: stackit\n');
    setLzTargetsInSwaoYml(yml, ['azure:germanywestcentral', 'stackit:eu01', 'stackit:eu01']);
    const a = yml['assessment'] as Record<string, unknown>;
    expect(a['lz_cat_targets']).toBeUndefined();
    expect(a['regimes_active']).toEqual(['GDPR']);
    expect(a['landing_zone']).toEqual({ provider: 'stackit', targets: ['azure:germanywestcentral', 'stackit:eu01'] });
    // Round trip: what the TUI writes is what the CLI reads.
    expect(resolveLzTargets({ appAssessment: a }).source).toBe('app:assessment.landing_zone.targets');
  });
});
