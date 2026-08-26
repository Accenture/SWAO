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

// .swao.yml zod schema relocated to @swao/core (#0575) so the publication engine
// (@swao/module-html-report) can read .swao.yml without importing from
// @swao/swao. Re-exported here for the existing '../schema/swao-yml.js' and
// schema-barrel import sites.
export {
  SwaoYmlCrawlSchema,
  SwaoYmlVcsSchema,
  SwaoYmlAssessmentSchema,
  SwaoYmlPublicationSchema,
  SwaoYmlSchema,
} from '@swao/core';
export type {
  SwaoYml,
  SwaoYmlCrawl,
  SwaoYmlAssessment,
  SwaoYmlPublication,
} from '@swao/core';
