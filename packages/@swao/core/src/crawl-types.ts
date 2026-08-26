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

export interface CrawlConfig {
  targetUrl: string;
  authType?: 'none' | 'basic' | 'form';
  username?: string;
  password?: string;
  screenshotQuality?: number;
  viewportWidth?: number;
  maxTurns?: number;
  excludePatterns?: string[];
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
}

export type ConsoleEntryType = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'other';

export interface ConsoleEntry {
  type: ConsoleEntryType;
  text: string;
}

export interface ScreenArtefact {
  index: number;
  url: string;
  title: string;
  timestamp: string;
  slug: string;
  screenshotJpeg: Buffer | null;
  domSnapshot: string;
  a11yJson: string | null;
  networkEntries: NetworkEntry[];
  consoleEntries: ConsoleEntry[];
  a11yViolations: number;
}

export interface CrawlResult {
  targetUrl: string;
  screenCount: number;
  screens: ScreenArtefact[];
  durationMs: number;
  engineVersion: string;
}

export interface BinaryCheck {
  available: boolean;
  version: string | null;
  path: string | null;
}

export interface CrawlProvider {
  crawl(config: CrawlConfig, workspaceAppDir: string): Promise<CrawlResult>;
  checkBinary(): Promise<BinaryCheck>;
}
