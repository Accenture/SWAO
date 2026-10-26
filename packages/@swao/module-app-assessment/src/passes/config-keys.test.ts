// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Shared configuration key tracker (#3485)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { configKeyLines, configKeysPerLine, keyValueLines } from './config-keys.js';
import { configKeysPerLine as jvmView } from './jvm-source-patterns.js';
import { keyValueLines as tfView } from './tf-config-evidence.js';

describe('#3485 configKeyLines: YAML', () => {
  it('tracks dotted parents, values, kinds and line numbers', () => {
    const r = configKeyLines('yaml', ['spring:', '  datasource:', '    url: jdbc:x # c', '    password: |', '      secret', '']);
    expect(r).toEqual([
      { line: 1, key: 'spring', value: '', kind: 'section', listItem: false },
      { line: 2, key: 'spring.datasource', value: '', kind: 'section', listItem: false },
      { line: 3, key: 'spring.datasource.url', value: 'jdbc:x', kind: 'pair', listItem: false },
      { line: 4, key: 'spring.datasource.password', value: '', kind: 'section', listItem: false },
      { line: 5, key: 'spring.datasource.password', value: '', kind: 'inherited', listItem: false },
      null,
    ]);
  });

  it('carries the parent key onto key-less list items (Kafka bootstrap lists)', () => {
    const r = configKeyLines('yaml', ['spring:', '  kafka:', '    bootstrap-servers:', '      - broker1:9092', '      - "broker2:9092"', '  port: 1']);
    expect(r[3]).toEqual({ line: 4, key: 'spring.kafka.bootstrap-servers', value: '', kind: 'inherited', listItem: true });
    expect(r[4]?.key).toBe('spring.kafka.bootstrap-servers');
    expect(r[5]?.key).toBe('spring.port');
  });

  it('list items with their own key, quoted keys and annotation keys with a slash', () => {
    const r = configKeyLines('yaml', [
      'env:', '  - name: DB_HOST', '    value: db', 'metadata:', '  annotations:',
      '    nginx.ingress.kubernetes.io/affinity: cookie', '  "quoted": 1',
    ]);
    expect(r[1]).toMatchObject({ key: 'env.name', value: 'DB_HOST', kind: 'pair', listItem: true });
    expect(r[2]).toMatchObject({ key: 'env.value', value: 'db', kind: 'pair', listItem: false });
    expect(r[5]?.key).toBe('metadata.annotations.nginx.ingress.kubernetes.io/affinity');
    expect(r[6]?.key).toBe('metadata.quoted');
  });

  it('a document marker resets the parents; comments and URLs are no keys', () => {
    const r = configKeyLines('yaml', ['a:', '  b: 1', '---', '  c: 2', '# x: 1', 'url: http://host:80/p']);
    expect(r[2]).toBeNull();
    expect(r[3]?.key).toBe('c');
    expect(r[4]).toBeNull();
    expect(r[5]).toMatchObject({ key: 'url', value: 'http://host:80/p' });
  });

  it('accepts lines with a trailing carriage return', () => {
    expect(configKeyLines('yaml', ['a:\r', '  b: 1\r'])[1]).toMatchObject({ key: 'a.b', value: '1' });
  });
});

describe('#3485 configKeyLines: properties', () => {
  it('key, value and comments', () => {
    const r = configKeyLines('properties', ['a.b=1', '# x', '! y', 'c.d: 2', '  e.f = 3 ', 'g.h[0]=x']);
    expect(r.map((e) => e && [e.key, e.value])).toEqual([['a.b', '1'], null, null, ['c.d', '2'], ['e.f', '3'], ['g.h[0]', 'x']]);
  });

  it('continuation lines keep the key they continue', () => {
    const r = configKeyLines('properties', ['spring.kafka.bootstrap-servers=a:9092,\\', '  b:9092,\\', '  c:9092', 'next=1', 'path=c:\\\\', 'other=2']);
    expect(r.slice(0, 3).map((e) => e?.key)).toEqual(['spring.kafka.bootstrap-servers', 'spring.kafka.bootstrap-servers', 'spring.kafka.bootstrap-servers']);
    expect(r[2]?.kind).toBe('inherited');
    expect(r[3]).toMatchObject({ key: 'next', kind: 'pair' });
    // An escaped backslash at the end is no continuation.
    expect(r[5]).toMatchObject({ key: 'other', value: '2', kind: 'pair' });
  });
});

describe('#3485 views', () => {
  it('configKeysPerLine: keys by extension, other files all null', () => {
    expect(configKeysPerLine({ name: 'application.yml', ext: '.yml' }, ['a:', '  - x'])).toEqual(['a', 'a']);
    expect(configKeysPerLine({ name: 'App.java', ext: '.java' }, ['a: 1', 'b: 2'])).toEqual([null, null]);
  });

  it('keyValueLines: mapping pairs only (no sections, no list-item keys)', () => {
    const kv = keyValueLines('values.yaml', 'db:\n  host: x\nenv:\n  - password: y\n    other: z\n');
    expect(kv).toEqual([
      { key: 'db.host', value: 'x', line: 2 },
      { key: 'env.other', value: 'z', line: 5 },
    ]);
    expect(keyValueLines('application.properties', 'a=\nb=2\n')).toEqual([
      { key: 'a', value: '', line: 1 },
      { key: 'b', value: '2', line: 2 },
    ]);
  });

  it('the Pass 02/07 and Pass 06 imports are the shared implementation', () => {
    expect(jvmView).toBe(configKeysPerLine);
    expect(tfView).toBe(keyValueLines);
  });
});
