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

/**
 * Contract test for the `playwright-stub` esbuild plugin in
 * `scripts/build-lib.mjs` (#0583: the shared esbuild config moved out of
 * bundle.mjs into build-lib.mjs, which bundle.mjs + the per-tier build scripts
 * delegate to).
 *
 * Purpose: pin the runtime behaviour of the stub that replaces `playwright`
 * inside the pkg-bundled `swao-win.exe`. The standalone binary cannot run a
 * browser; the stub's job is to throw a CLEAR error identifying the bundle
 * limitation, not the cryptic "TypeError: undefined is not a function" that
 * sprint-035 #0337 surfaced.
 *
 * Why a stand-alone test: the stub lives inside an esbuild plugin's onLoad
 * contents string, not as an importable module. The test re-extracts the
 * stub source from `scripts/bundle.mjs` and evaluates it in an isolated vm
 * context to verify behaviour. Fast (no esbuild invocation, no binary build).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_SCRIPT = resolve(__dirname, '../../scripts/build-lib.mjs');

/**
 * Pull the contents of the playwright-stub plugin's onLoad return value
 * out of bundle.mjs. Couples the test to the file structure deliberately --
 * if someone refactors the plugin, the test fails fast.
 */
function extractStubSource(): string {
  const src = readFileSync(BUNDLE_SCRIPT, 'utf-8');
  const match = src.match(
    /name:\s*'playwright-stub'[\s\S]*?contents:\s*`([\s\S]*?)`/,
  );
  if (!match) {
    throw new Error('playwright-stub plugin not found in scripts/bundle.mjs');
  }
  return match[1] as string;
}

/**
 * Evaluate the stub's CJS contents in a fresh vm context and return its
 * module.exports.
 */
function loadStub(): unknown {
  const contents = extractStubSource();
  const moduleObj: { exports: unknown } = { exports: {} };
  const ctx: Record<string, unknown> = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: createRequire(import.meta.url),
  };
  vm.createContext(ctx);
  vm.runInContext(contents, ctx);
  return moduleObj.exports;
}

describe('playwright-stub (esbuild plugin in scripts/bundle.mjs) -- #0337 Part B regression contract', () => {
  // The stub is a Proxy that returns Proxies on any property access -- structurally
  // untyped by design. `any` is the right shape; this is the one place in the codebase
  // where the no-any rule should yield.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stub: any;

  beforeAll(() => {
    stub = loadStub();
  });

  it('exports a non-undefined value (matches `import playwright from "playwright"`)', () => {
    expect(stub).toBeDefined();
    expect(stub).not.toBeNull();
  });

  it('exposes `.chromium` as a defined value (matches `import { chromium } from "playwright"`)', () => {
    expect(stub.chromium).toBeDefined();
    expect(stub.chromium).not.toBeNull();
  });

  it('exposes `.chromium.launch` as a defined value (regression: previously undefined -> "TypeError: undefined is not a function")', () => {
    expect(stub.chromium.launch).toBeDefined();
    expect(stub.chromium.launch).not.toBeNull();
  });

  it('throws the explicit "playwright is not bundled" message when chromium.launch() is invoked', () => {
    expect(() => stub.chromium.launch({ headless: true })).toThrow(
      /playwright is not bundled in the swao binary/,
    );
  });

  it('throws the explicit message at every chain depth (chromium.launch.foo.bar.baz())', () => {
    // Intermediate property access on the proxy must remain chainable so
    // the error message is the same regardless of where the user-code
    // invocation happens.
    expect(stub.chromium.launch).toBeDefined();
    expect(stub.chromium.firefox).toBeDefined();
    expect(stub.chromium.webkit).toBeDefined();
    expect(stub.chromium.launch.foo).toBeDefined();
    expect(stub.chromium.launch.foo.bar).toBeDefined();
    expect(() => stub.chromium.launch.foo.bar.baz()).toThrow(
      /playwright is not bundled in the swao binary/,
    );
  });

  it('throws the explicit message when invoked directly: stub() / stub.chromium()', () => {
    expect(() => stub()).toThrow(/playwright is not bundled in the swao binary/);
    expect(() => stub.chromium()).toThrow(/playwright is not bundled in the swao binary/);
  });

  it('does NOT look thenable to `await` (clean throw, no infinite microtask loop)', () => {
    expect(stub.then).toBeUndefined();
    expect(stub.chromium.then).toBeUndefined();
    expect(stub.chromium.launch.then).toBeUndefined();
  });

  it('returns undefined for any Symbol property (avoids coercion / iterator surprises)', () => {
    expect(stub[Symbol.iterator]).toBeUndefined();
    expect(stub[Symbol.asyncIterator]).toBeUndefined();
    expect(stub[Symbol.toPrimitive]).toBeUndefined();
    expect(stub.chromium[Symbol.iterator]).toBeUndefined();
  });

  it('error message includes the operator-facing remediation (--no-crawl OR --passes excluding "dynamic")', () => {
    try {
      stub.chromium.launch();
      throw new Error('expected throw did not happen');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/--no-crawl/);
      expect(msg).toMatch(/dynamic/);
    }
  });
});
