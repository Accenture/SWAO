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

// #3425: pass 11 scopes controls by assessment type. It must see the routed
// type (the `--type` CLI override, else assessment.type, else the default),
// not only the raw .swao.yml value. assess.ts captures the router decision
// once and injects it into every PassContext it builds.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');

describe('PassContext.assessmentType wiring (#3425)', () => {
  it('captures the effective type from the router decision, after --type is applied', () => {
    expect(src).toContain('const requestedType = opts.type ?? (assessmentCfg?.[\'type\'] as string | undefined);');
    expect(src).toContain('routeDecision = assessRouter.route(requestedType);');
    expect(src).toContain('const effectiveAssessmentType = routeDecision.type;');
    expect(src.indexOf('routeDecision = assessRouter.route(requestedType);'))
      .toBeLessThan(src.indexOf('const effectiveAssessmentType = routeDecision.type;'));
  });

  it('sets assessmentType on every PassContext built by assess.ts', () => {
    const ctxBlocks = [...src.matchAll(/const (\w+): PassContext = \{([\s\S]*?)\};/g)];
    expect(ctxBlocks.map(m => m[1]).sort()).toEqual(['ctx', 'dynamicCtx', 'lzrCtx', 'secondaryCtx', 'visionCtx']);
    for (const m of ctxBlocks) {
      // A context spread from the main ctx inherits the field.
      if (/^\s*\.\.\.ctx\b/.test(m[2]!)) continue;
      expect(m[2], `${m[1]} must carry assessmentType`).toMatch(/assessmentType: effectiveAssessmentType/);
    }
  });

  it('the secondary-model context inherits it from the main pass context', () => {
    expect(src).toContain('const secondaryCtx: PassContext = { ...ctx, llm: secondaryTracking };');
  });
});
