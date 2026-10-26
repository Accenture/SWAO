// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3474: the workspace .swao.yml mcp block (Design 116 REQ-08.3).

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { SwaoYmlSchema } from './swao-yml.js';

const parse = (yaml: string) => SwaoYmlSchema.safeParse(load(yaml));

describe('SwaoYmlSchema mcp block (#3474)', () => {
  it('accepts mcp.profile', () => {
    const r = parse('mcp:\n  profile: starter\n');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mcp?.profile).toBe('starter');
  });

  it('accepts mcp.tools', () => {
    const r = parse('mcp:\n  tools: [swao, swao_health_check]\n');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mcp?.tools).toEqual(['swao', 'swao_health_check']);
  });

  it('rejects an unknown profile value', () => {
    expect(parse('mcp:\n  profile: tiny\n').success).toBe(false);
  });

  it('rejects profile and tools together', () => {
    expect(parse('mcp:\n  profile: assess\n  tools: [swao]\n').success).toBe(false);
  });

  it('a workspace without the block still parses', () => {
    expect(parse('version: 1\n').success).toBe(true);
  });
});
