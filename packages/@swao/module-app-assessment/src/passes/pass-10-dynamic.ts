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

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { CrawlResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { runPhase2 } from './phase2/extractor.js';
import { detectExternalHosts } from './phase2/rules/external-hosts.js';
import { inventoryApiEndpoints } from './phase2/rules/api-endpoints.js';
import { detectHttpErrors } from './phase2/rules/http-errors.js';
import { mapAuthSurface } from './phase2/rules/auth-surface.js';
import { detectPiiFormFields } from './phase2/rules/pii-form-fields.js';
import { detectThirdPartyScripts } from './phase2/rules/third-party-scripts.js';
import { detectCookieConsentAbsence } from './phase2/rules/cookie-consent.js';
import { loadAnalyticsBlocklist } from './phase2/analytics-blocklist.js';
import { compareBaselines } from './phase2/parity-hash.js';

const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
];

function isExternalHost(hostname: string, targetHostname: string): boolean {
  if (hostname === targetHostname) return false;
  return !LOCAL_HOST_PATTERNS.some((p) => p.test(hostname));
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface DynamicPassVisionOpts {
  maxScreens?: number;
}

export async function runDynamicPass(
  ctx: PassContext,
  crawlResult: CrawlResult,
  visionOpts?: DynamicPassVisionOpts,
): Promise<PassResult> {
  const { iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  let sigNum = 1;

  let targetHostname = '';
  try {
    targetHostname = new URL(crawlResult.targetUrl).hostname;
  } catch {
    // ignore
  }

  // Collect unique external hostnames from all network entries (for DYN-01 summary).
  const externalHosts = new Map<string, number>();
  for (const screen of crawlResult.screens) {
    for (const entry of screen.networkEntries) {
      const host = hostnameFromUrl(entry.url);
      if (!host || !isExternalHost(host, targetHostname)) continue;
      externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
    }
  }

  // A11y violations across all screens.
  const a11yScreens = crawlResult.screens.filter((s) => s.a11yViolations > 0);
  const totalA11yViolations = crawlResult.screens.reduce((sum, s) => sum + s.a11yViolations, 0);
  if (a11yScreens.length > 0) {
    signals.push({
      id: `DYN-${String(sigNum).padStart(2, '0')}`,
      source: 'dynamic_analysis',
      category: 'application',
      severity: 'low',
      derivation: `Accessibility violations detected on ${a11yScreens.length} of ${crawlResult.screenCount} screens (${totalA11yViolations} total violations). Review with axe-core or Lighthouse for detailed remediation.`,
      evidence: a11yScreens.slice(0, 5).map((s) => `screen ${s.index}: ${s.url} (${s.a11yViolations} violations)`),
      confidence: 'medium',
    });
    sigNum++;
  }

  // Console errors.
  const allConsoleErrors = crawlResult.screens.flatMap((s) =>
    s.consoleEntries
      .filter((c) => c.type === 'error')
      .map((c) => `[screen ${s.index}: ${s.title}] ${c.text.slice(0, 200)}`),
  );
  if (allConsoleErrors.length > 0) {
    signals.push({
      id: `DYN-${String(sigNum).padStart(2, '0')}`,
      source: 'dynamic_analysis',
      category: 'application',
      severity: 'low',
      derivation: `${allConsoleErrors.length} JavaScript console error(s) observed during Playwright crawl. Runtime errors may indicate unhandled edge cases or broken integrations.`,
      evidence: allConsoleErrors.slice(0, 5),
      confidence: 'medium',
    });
    sigNum++;
  }

  // DYN-01: crawl summary (always emitted). External host detail is provided by Phase 2 DYN-02.
  signals.push({
    id: 'DYN-01',
    source: 'dynamic_analysis',
    category: 'application',
    severity: signals.length > 0 ? 'informational' : 'informational',
    derivation:
      `Playwright crawl of ${crawlResult.screenCount} screens completed. ` +
      `External hosts contacted: ${externalHosts.size}. ` +
      `A11y violations: ${totalA11yViolations}. Console errors: ${allConsoleErrors.length}.`,
    evidence: [`${crawlResult.screenCount} screens crawled from ${crawlResult.targetUrl}`],
    confidence: 'high',
  });

  const externalHostList = [...externalHosts.keys()];

  // Phase 2 post-crawl extraction (Design 083 section 7.1, #1263).
  // Reads parity-baseline/ that was written by writeParityBaseline() in assess.ts.
  // Rule functions produce canonical DYN-02..DYN-07 signals (#1264-#1267).
  let extractionDurationMs = 0;
  let phase2ScreensProcessed = 0;
  // Design 083 §8 new summary fields -- populated when Phase 2 runs (#1272).
  let phase2ApiEndpoints: string[] = [];
  let phase2HttpErrorsTotal = 0;
  let phase2PiiFieldsFlagged = 0;
  let phase2ThirdPartyScriptsTotal = 0;
  let phase2CookieConsentPresent = false;

  const baselineDir = join(ctx.workspacePath, 'parity-baseline');
  if (existsSync(baselineDir)) {
    try {
      let appDomain = '';
      try { appDomain = new URL(crawlResult.targetUrl).hostname; } catch { /* ignore */ }
      const phase2 = await runPhase2(baselineDir, { appDomain });
      extractionDurationMs = phase2.extraction_duration_ms;
      phase2ScreensProcessed = phase2.screens_processed;
      phase2ApiEndpoints = phase2.extracted.apiEndpoints;
      phase2HttpErrorsTotal = phase2.extracted.httpErrors.length;
      phase2PiiFieldsFlagged = phase2.extracted.piiForms.length;
      phase2ThirdPartyScriptsTotal = phase2.extracted.thirdPartyScripts.length;
      phase2CookieConsentPresent = phase2.extracted.cookieConsentPresent;

      const analyticsBlocklist = loadAnalyticsBlocklist();
      const p2Rules: (Signal | null)[] = [
        detectExternalHosts(phase2.extracted),            // DYN-02 (#1264)
        inventoryApiEndpoints(phase2.extracted),          // DYN-03 (#1265)
        detectHttpErrors(phase2.extracted),               // DYN-04 (#1266)
        mapAuthSurface(phase2.extracted, phase2.screens_processed), // DYN-07 (#1267)
        detectPiiFormFields(phase2.extracted),                // DYN-05 (#1269)
        detectThirdPartyScripts(phase2.extracted, analyticsBlocklist.domains), // DYN-06 (#1270)
        detectCookieConsentAbsence(phase2.extracted, phase2.screens_processed), // DYN-08 (#1271)
      ];
      for (const s of p2Rules) {
        if (s) signals.push(s);
      }
    } catch {
      // Phase 2 failure is non-fatal; Phase 1 signals are still emitted.
    }
  }

  // DYN-10: visual parity hash (Design 083 Section 4.2, #1274).
  // No-op when current-crawl/ does not exist -- compareBaselines returns skipped_reason.
  try {
    const currentCrawlDir = join(ctx.workspacePath, 'current-crawl');
    const parityResult = await compareBaselines(baselineDir, currentCrawlDir);
    for (const diff of parityResult.diffs) {
      signals.push({
        id: 'DYN-10',
        source: 'dynamic_analysis',
        category: 'application',
        severity: diff.severity,
        derivation:
          `Visual parity regression detected on screen "${diff.slug}". ` +
          `Perceptual hash Hamming distance: ${diff.distance} (threshold: 10). ` +
          `Indicates a layout or rendering change between baseline and current crawl.`,
        evidence: [
          `screen ${diff.slug}: Hamming distance ${diff.distance} (${diff.severity === 'high' ? '>30' : '11-30'})`,
        ],
        confidence: 'medium',
      });
    }
  } catch {
    // DYN-10 failure is non-fatal.
  }

  // Phase 3 -- vision analysis of Playwright screenshots (#1802).
  // Gated on: (a) visionOpts provided by assess.ts, (b) ctx.llm.completeVision defined.
  // Each screen with a JPEG buffer is sent to the configured LLM connector.
  // TODO-PROMPT: DYN-11 (PII visible in UI), DYN-12 (sovereignty label), DYN-13 (embedded widget).
  // Prompts are structural placeholders -- tune before production use.
  let visionScreensAnalysed = 0;
  if (visionOpts && ctx.llm?.completeVision) {
    const maxScreens = visionOpts.maxScreens ?? 5;
    const screensWithImages = crawlResult.screens
      .filter((s) => s.screenshotJpeg != null)
      .slice(0, maxScreens);

    for (const screen of screensWithImages) {
      const img = screen.screenshotJpeg as Buffer;
      try {
        const visionPrompt =
          'You are a data sovereignty and privacy auditor. Analyse this screenshot of a running application. ' +
          'Identify: (1) any personally identifiable information (PII) visible in the UI (names, IDs, medical data); ' +
          '(2) any sovereignty or classification labels rendered on screen; ' +
          '(3) any embedded third-party widgets or iframes. ' +
          'Respond with JSON: { "pii_visible": true|false, "pii_detail": "...", ' +
          '"sovereignty_label": "..." | null, "embedded_widgets": ["..."] | [] }';

        const raw = await ctx.llm.completeVision(visionPrompt, [img]);
        visionScreensAnalysed++;

        // Parse response and emit signals.
        let parsed: { pii_visible?: boolean; pii_detail?: string; sovereignty_label?: string | null; embedded_widgets?: string[] } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { /* non-JSON response -- skip signal emission */ }

        if (parsed.pii_visible) {
          signals.push({
            id: 'DYN-11',
            source: 'dynamic_analysis',
            category: 'application',
            severity: 'high',
            derivation: `Vision analysis detected PII visible in the rendered UI of screen "${screen.url}". ` +
              `${parsed.pii_detail ?? 'Details unavailable.'}`,
            evidence: [`screen ${screen.index}: ${screen.url}`],
            confidence: 'medium',
          });
        }
        if (parsed.sovereignty_label) {
          signals.push({
            id: 'DYN-12',
            source: 'dynamic_analysis',
            category: 'application',
            severity: 'informational',
            derivation: `Vision analysis identified a sovereignty or classification label on screen "${screen.url}": "${parsed.sovereignty_label}".`,
            evidence: [`screen ${screen.index}: ${screen.url}`, `label: ${parsed.sovereignty_label}`],
            confidence: 'medium',
          });
        }
        if (Array.isArray(parsed.embedded_widgets) && parsed.embedded_widgets.length > 0) {
          signals.push({
            id: 'DYN-13',
            source: 'dynamic_analysis',
            category: 'application',
            severity: 'medium',
            derivation: `Vision analysis detected embedded third-party widget(s) on screen "${screen.url}": ${parsed.embedded_widgets.join(', ')}.`,
            evidence: [`screen ${screen.index}: ${screen.url}`, ...parsed.embedded_widgets.map((w) => `widget: ${w}`)],
            confidence: 'medium',
          });
        }

        // Write call artefact to passes/ (same format as other pass artefacts).
        if (ctx.passesDir) {
          const slug = `screen-${String(screen.index).padStart(2, '0')}`;
          const artefact = {
            pass: '10-dynamic-vision',
            screen: { index: screen.index, url: screen.url },
            prompt: visionPrompt,
            response: raw,
            signals_emitted: signals.filter((s) => ['DYN-11', 'DYN-12', 'DYN-13'].includes(s.id)).length,
          };
          const outPath = join(ctx.passesDir, `10-dynamic-vision-${slug}-call-1.yaml`);
          try { writeFileSync(outPath, dump(artefact, { lineWidth: 120 }), 'utf-8'); } catch { /* non-fatal */ }
        }
      } catch {
        // Vision failure on a single screen is non-fatal -- continue with remaining screens.
      }
    }
  }

  return {
    pass: {
      id: 10,
      name: 'dynamic_analysis',
      signal_prefix: 'DYN',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      screens_captured: crawlResult.screenCount,
      crawl_duration_ms: crawlResult.durationMs,
      extraction_duration_ms: extractionDurationMs,
      phase2_screens_processed: phase2ScreensProcessed,
      external_hosts: externalHostList,
      external_host_count: externalHostList.length,
      a11y_violations_total: totalA11yViolations,
      console_errors_total: allConsoleErrors.length,
      // Design 083 §8 Phase 2 summary fields (#1272)
      api_endpoints_observed: phase2ApiEndpoints,
      http_errors_total: phase2HttpErrorsTotal,
      pii_form_fields_flagged: phase2PiiFieldsFlagged,
      third_party_scripts_total: phase2ThirdPartyScriptsTotal,
      cookie_consent_present: phase2CookieConsentPresent,
      // Phase 3 vision summary (#1802)
      vision_screens_analysed: visionScreensAnalysed,
    },
  };
}
