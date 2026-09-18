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

import type { CrawlConfig, CrawlResult, BinaryCheck, CrawlProvider, ScreenArtefact } from './types.js';

export class StubCrawlProvider implements CrawlProvider {
  private readonly _screens: ScreenArtefact[];

  constructor(screens?: ScreenArtefact[]) {
    this._screens = screens ?? StubCrawlProvider.defaultScreens();
  }

  async checkBinary(): Promise<BinaryCheck> {
    return { available: true, version: 'stub', path: null };
  }

  async crawl(config: CrawlConfig, _workspaceAppDir: string): Promise<CrawlResult> {
    return {
      targetUrl: config.targetUrl,
      screenCount: this._screens.length,
      screens: this._screens,
      durationMs: 0,
      engineVersion: 'stub',
    };
  }

  static defaultScreens(): ScreenArtefact[] {
    const now = new Date().toISOString();
    return [
      {
        index: 0,
        url: 'http://localhost:3000/',
        title: 'Home',
        timestamp: now,
        slug: '000-home',
        screenshotJpeg: null,
        domSnapshot:
          '<html><body><h1>Home</h1><a href="/patients">Patients</a><a href="/admin">Admin</a></body></html>',
        a11yJson: null,
        networkEntries: [
          {
            url: 'https://api.stripe.com/v1/payment_intents',
            method: 'POST',
            status: 200,
            resourceType: 'fetch',
          },
          {
            url: 'https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js',
            method: 'GET',
            status: 200,
            resourceType: 'script',
          },
        ],
        consoleEntries: [],
        a11yViolations: 0,
      },
      {
        index: 1,
        url: 'http://localhost:3000/patients',
        title: 'Patient List',
        timestamp: now,
        slug: '001-patients',
        screenshotJpeg: null,
        domSnapshot: '<html><body><h1>Patients</h1><ul><li>Alice</li></ul></body></html>',
        a11yJson: null,
        networkEntries: [
          {
            url: 'http://localhost:3000/api/patients',
            method: 'GET',
            status: 200,
            resourceType: 'fetch',
          },
        ],
        consoleEntries: [
          { type: 'error', text: 'Uncaught TypeError: Cannot read properties of null (reading "id")' },
        ],
        a11yViolations: 1,
      },
    ];
  }
}
