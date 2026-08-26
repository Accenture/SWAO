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

import { mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import type { CrawlResult, ScreenArtefact } from './types.js';

export interface ParityManifest {
  schema_version: '1.0';
  target_url: string;
  screen_count: number;
  crawl_duration_ms: number;
  total_disk_bytes: number;
  engine_version: string;
  screens: Array<{
    index: number;
    url: string;
    title: string;
    slug: string;
    timestamp: string;
    screenshot_file: string | null;
    dom_file: string | null;
    a11y_file: string | null;
    network_entries: number;
    console_entries: number;
    a11y_violations: number;
  }>;
}

function safeStatSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function writeScreen(baseDir: string, screen: ScreenArtefact): {
  screenshotFile: string | null;
  domFile: string | null;
  a11yFile: string | null;
  diskBytes: number;
} {
  const screenDir = join(baseDir, screen.slug);
  mkdirSync(screenDir, { recursive: true });

  let screenshotFile: string | null = null;
  let diskBytes = 0;

  if (screen.screenshotJpeg !== null) {
    const fname = 'screenshot.jpg';
    const fpath = join(screenDir, fname);
    writeFileSync(fpath, screen.screenshotJpeg);
    screenshotFile = join(screen.slug, fname).replace(/\\/g, '/');
    diskBytes += safeStatSize(fpath);
  }

  const domFname = 'dom.html';
  const domFpath = join(screenDir, domFname);
  writeFileSync(domFpath, screen.domSnapshot, 'utf-8');
  const domFile = join(screen.slug, domFname).replace(/\\/g, '/');
  diskBytes += safeStatSize(domFpath);

  let a11yFile: string | null = null;
  if (screen.a11yJson !== null) {
    const fname = 'a11y.json';
    const fpath = join(screenDir, fname);
    writeFileSync(fpath, screen.a11yJson, 'utf-8');
    a11yFile = join(screen.slug, fname).replace(/\\/g, '/');
    diskBytes += safeStatSize(fpath);
  }

  const metaFpath = join(screenDir, 'meta.json');
  writeFileSync(
    metaFpath,
    JSON.stringify({
      index: screen.index,
      url: screen.url,
      title: screen.title,
      timestamp: screen.timestamp,
      slug: screen.slug,
      network_entries: screen.networkEntries.length,
      console_entries: screen.consoleEntries.length,
      a11y_violations: screen.a11yViolations,
      network_log: screen.networkEntries,
      console_log: screen.consoleEntries,
    }, null, 2),
    'utf-8',
  );
  diskBytes += safeStatSize(metaFpath);

  return { screenshotFile, domFile, a11yFile, diskBytes };
}

export function writeParityBaseline(workspaceAppDir: string, result: CrawlResult): string {
  const baseDir = join(workspaceAppDir, 'parity-baseline');
  mkdirSync(baseDir, { recursive: true });

  let totalDiskBytes = 0;
  const manifestScreens: ParityManifest['screens'] = [];

  for (const screen of result.screens) {
    const { screenshotFile, domFile, a11yFile, diskBytes } = writeScreen(baseDir, screen);
    totalDiskBytes += diskBytes;
    manifestScreens.push({
      index: screen.index,
      url: screen.url,
      title: screen.title,
      slug: screen.slug,
      timestamp: screen.timestamp,
      screenshot_file: screenshotFile,
      dom_file: domFile,
      a11y_file: a11yFile,
      network_entries: screen.networkEntries.length,
      console_entries: screen.consoleEntries.length,
      a11y_violations: screen.a11yViolations,
    });
  }

  const manifest: ParityManifest = {
    schema_version: '1.0',
    target_url: result.targetUrl,
    screen_count: result.screenCount,
    crawl_duration_ms: result.durationMs,
    total_disk_bytes: totalDiskBytes,
    engine_version: result.engineVersion,
    screens: manifestScreens,
  };

  const manifestPath = join(baseDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const crawlMapLines = [
    `target: ${result.targetUrl}`,
    `screens: ${result.screenCount}  duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
    ...manifestScreens.map(s =>
      `${String(s.index).padStart(3, '0')}  ${s.url}`,
    ),
  ];
  writeFileSync(join(baseDir, 'crawl-map.txt'), crawlMapLines.join('\n') + '\n', 'utf-8');

  return baseDir;
}
