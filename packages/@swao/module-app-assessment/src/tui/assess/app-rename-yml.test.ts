// #4283 (b): app rename through the central minimal-patch writer.

import { describe, it, expect } from 'vitest';
import { renameAppYmlText } from './app-rename-yml.js';

const YML = [
  '# .swao.yml -- SWAO app configuration',
  'wsp_version: "0.9"',
  'app_id: shop   # folder name',
  'app_name: shop',
  '',
  'compliance:',
  '  regimes:',
  '    - id: GDPR',
  'landing_zone:',
  '  targets:',
  '    - id: lz-a',
  '',
].join('\n');

describe('renameAppYmlText (#4283 b)', () => {
  it('changes only app_id and a mirrored app_name; nested ids, comments and blank lines stay', () => {
    const r = renameAppYmlText(YML, 'shop', 'webshop');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = YML.split('\n');
    const after = r.text.split('\n');
    expect(after.length).toBe(before.length);
    const changed = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
    expect(changed).toEqual([
      ['app_id: shop   # folder name', 'app_id: webshop   # folder name'],
      ['app_name: shop', 'app_name: webshop'],
    ]);
  });

  it('keeps a display name that differs from the id, and CRLF line ends', () => {
    const crlf = YML.replace('app_name: shop', 'app_name: "Web Shop"').replace(/\n/g, '\r\n');
    const r = renameAppYmlText(crlf, 'shop', 'webshop');
    expect(r.ok && r.text).toBe(crlf.replace('app_id: shop', 'app_id: webshop'));
  });

  it('leaves a file without id keys unchanged and refuses a file that does not parse', () => {
    expect(renameAppYmlText('wsp_version: "0.9"\n', 'a', 'b')).toEqual({ ok: true, text: 'wsp_version: "0.9"\n', changed: false });
    expect(renameAppYmlText('a: [\n', 'a', 'b').ok).toBe(false);
  });
});
