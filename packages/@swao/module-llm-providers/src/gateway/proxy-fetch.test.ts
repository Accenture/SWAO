import { describe, it, expect, afterEach } from 'vitest';
import { createProxyAwareFetch } from './connector-fetch.js';
import { buildFetchDispatcher } from '../open-llm-provider.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('proxy-aware research fetch (#3369)', () => {
  it('returns a callable fetch', () => {
    expect(typeof createProxyAwareFetch()).toBe('function');
  });

  it('buildFetchDispatcher yields a dispatcher when HTTPS_PROXY is set for an external host', () => {
    process.env['HTTPS_PROXY'] = 'http://proxy.example:3128';
    delete process.env['NO_PROXY'];
    expect(buildFetchDispatcher({ targetUrl: 'https://services.nvd.nist.gov/' })).toBeDefined();
  });

  it('buildFetchDispatcher bypasses the proxy for a NO_PROXY host', () => {
    process.env['HTTPS_PROXY'] = 'http://proxy.example:3128';
    process.env['NO_PROXY'] = '.corp.example';
    expect(buildFetchDispatcher({ targetUrl: 'https://gateway.corp.example/' })).toBeUndefined();
  });

  it('no proxy configured yields no dispatcher', () => {
    delete process.env['HTTPS_PROXY']; delete process.env['HTTP_PROXY']; delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
    expect(buildFetchDispatcher({ targetUrl: 'https://services.nvd.nist.gov/' })).toBeUndefined();
  });
});
