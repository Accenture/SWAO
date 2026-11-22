import { describe, it, expect } from 'vitest';
import { relativiseWorkspacePaths, hasDriveLetterPath, evidenceRefLookupKeys, evidenceLookupKey, inputsRelativePath, evidenceCatalogueId, secretScanRefShape, trimPathSlashes } from './evidence-ref.js';
import { isEvidenceNote } from './evidence-note.js';

const BS = String.fromCharCode(92);
const ABS = 'C:/swao/s158-dev1/apps/sovereign-health/wsp/inputs/source/apps/health/sovereign-health';
const SUB = { sourceSubdir: 'apps/health/sovereign-health' };

describe('relativiseWorkspacePaths (#4463)', () => {
  it('makes a secret-scan location relative to the scanned source', () => {
    expect(relativiseWorkspacePaths(`curl-auth-header: ${ABS}/docs/src/api-reference/measurements.md:12`, SUB))
      .toBe('curl-auth-header: docs/src/api-reference/measurements.md:12');
  });
  it('without the subdir keeps the path below wsp/inputs/source/', () => {
    expect(relativiseWorkspacePaths(`${ABS}/api/Cargo.toml`)).toBe('apps/health/sovereign-health/api/Cargo.toml');
  });
  it('handles backslash paths and other inputs', () => {
    const win = ['D:', 'ws', 'apps', 'a', 'wsp', 'inputs', 'terraform', 'main.tf'].join(BS);
    expect(relativiseWorkspacePaths(`see ${win}:4`)).toBe('see terraform/main.tf:4');
    expect(relativiseWorkspacePaths('/home/op/ws/apps/a/wsp/inputs/cmdb/export.csv')).toBe('cmdb/export.csv');
  });
  it('makes other app paths relative to the app folder', () => {
    expect(relativiseWorkspacePaths('run C:/swao/ws/apps/a/wsp/runs/2026-11-15T17-27-24/assess.log'))
      .toBe('run wsp/runs/2026-11-15T17-27-24/assess.log');
  });
  it('leaves relative paths, URLs and prose untouched', () => {
    for (const v of ['api/Cargo.toml:16', 'wsp/inputs/terraform', 'https://example.org/wsp/inputs/x', 'No application code provided']) {
      expect(relativiseWorkspacePaths(v)).toBe(v);
    }
  });
  it('inputsRelativePath names the inputs root itself', () => {
    expect(inputsRelativePath('')).toBe('wsp/inputs/');
    expect(inputsRelativePath('source/api/x.rs')).toBe('api/x.rs');
  });
});

describe('hasDriveLetterPath (#4463)', () => {
  it('finds drive-letter paths, not JSON escapes or URLs', () => {
    expect(hasDriveLetterPath('x C:/swao/a')).toBe(true);
    expect(hasDriveLetterPath(`x d:${BS}ws`)).toBe(true);
    expect(hasDriveLetterPath(`Items:${BS}u003c/span`)).toBe(false);
    expect(hasDriveLetterPath(`s:${BS}u003c/span`)).toBe(false);
    expect(hasDriveLetterPath('https://example.org')).toBe(false);
  });
});

describe('evidenceRefLookupKeys (#4465)', () => {
  const last = (ref: string): string => evidenceRefLookupKeys(ref, SUB).at(-1)!;
  it('reduces every cited shape to the file', () => {
    expect(last('api/Cargo.toml:16')).toBe('api/Cargo.toml');
    expect(last('api/x.rs:12-30')).toBe('api/x.rs');
    expect(last('api/x.sql: some columns')).toBe('api/x.sql');
    expect(last('ops/postgres/Dockerfile (image: postgres:16-alpine)')).toBe('ops/postgres/Dockerfile');
    expect(last('sentry-cargo: api/Cargo.toml (cargo: sentry)')).toBe('api/Cargo.toml');
    expect(last(`generic-api-key: ${ABS}/api/tests/platform_test.rs:113`)).toBe('api/tests/platform_test.rs');
    expect(last('api/tests/platform_test.rs:113 (generic-api-key)')).toBe('api/tests/platform_test.rs');
    expect(last('other/doc.md section 1 & 11')).toBe('other/doc.md');
  });
  it('tries the ref as cited first, then each shorter form', () => {
    expect(evidenceRefLookupKeys('api/x.sql: is_deleted columns')).toEqual(['api/x.sql: is_deleted columns', 'api/x.sql']);
    expect(evidenceRefLookupKeys(`rule: ${ABS}/a/b.rs:3`, SUB)).toEqual([`rule: ${ABS}/a/b.rs:3`, 'rule: a/b.rs:3', 'a/b.rs:3', 'a/b.rs']);
  });
  it('keeps non-path refs as one key', () => {
    expect(evidenceRefLookupKeys('TF-03')).toEqual(['TF-03']);
    expect(evidenceRefLookupKeys('')).toEqual([]);
  });
  it('evidenceLookupKey normalises index keys the same way', () => {
    expect(evidenceLookupKey(`  ${['C:', 'ws', 'apps', 'a', 'wsp', 'inputs', 'source', 'x.md'].join(BS)} `)).toBe('x.md');
  });
});

describe('isEvidenceNote path-led sentence (#4455)', () => {
  it('a path followed by prose is a note', () => {
    expect(isEvidenceNote('wsp/inputs/ directory listing shows only terraform/lz-*-snapshot.json and README.md')).toBe(true);
    expect(isEvidenceNote('terraform/ holds only the lz snapshot files of aws/azure')).toBe(true);
    expect(isEvidenceNote('src/*.ts files')).toBe(true);
  });
  it('a file with a location, description or blanks stays a reference', () => {
    for (const v of [
      'other/doc.md section 1 & 11',
      'api/x.sql: is_deleted, deleted_at columns',
      'ops/docker-compose.dev.yml (image: redis:7-alpine)',
      'docs/Architecture Overview v2.docx',
      'api/src/services/purge.rs: WHERE is_deleted = true AND deleted_at IS NOT NULL',
      'api/Cargo.toml:16',
      'generic-api-key: api/tests/platform_test.rs:113',
      'curl-auth-header: docs/m.md:12',
    ]) expect(isEvidenceNote(v), v).toBe(false);
    expect(isEvidenceNote('Chunks available: 4')).toBe(true);
  });
});

describe('evidenceCatalogueId and secretScanRefShape (#4463, #4465)', () => {
  it('slugs like derive-plan and drops absence statements', () => {
    expect(evidenceCatalogueId('api/Cargo.toml:16')).toBe('EVD-API-CARGO-TOML-16');
    expect(evidenceCatalogueId('api/x.rs:113 (generic-api-key)')).toBe('EVD-API-X-RS-113');
    expect(evidenceCatalogueId('No application code provided')).toBeNull();
  });
  it('puts a legacy rule-first secret-scan ref in the location-first shape', () => {
    expect(secretScanRefShape('generic-api-key: api/tests/platform_test.rs:113')).toBe('api/tests/platform_test.rs:113 (generic-api-key)');
    expect(secretScanRefShape('api/x.sql: some columns')).toBe('api/x.sql: some columns');
    expect(secretScanRefShape('endpoints: GET/POST /user')).toBe('endpoints: GET/POST /user');
  });
});

describe('linear-time ref helpers (CodeQL js/polynomial-redos)', () => {
  it('trimPathSlashes removes the leading and trailing slashes, or only the trailing ones', () => {
    expect(trimPathSlashes('//apps/health//')).toBe('apps/health');
    expect(trimPathSlashes('/apps/health/', 'end')).toBe('/apps/health');
    expect(trimPathSlashes('///')).toBe('');
    expect(trimPathSlashes('')).toBe('');
  });
  it('a ref made of a long run of slashes is handled at once', () => {
    const ref = '/'.repeat(50_000) + ' x';
    const started = Date.now();
    evidenceRefLookupKeys(ref);
    expect(trimPathSlashes('a' + '/'.repeat(50_000) + 'b' + '/'.repeat(50_000))).toBe('a' + '/'.repeat(50_000) + 'b');
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it('path-shaped tokens keep their lookup key', () => {
    expect(evidenceRefLookupKeys('api/Cargo.toml:16')).toContain('api/Cargo.toml');
    expect(evidenceRefLookupKeys('Cargo.toml (dependency)')).toContain('Cargo.toml');
  });
});
