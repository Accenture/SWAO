// #4283: the lens choice is a run-time value; the save-as-default question
// is asked only when the choice differs from the workspace default.

import { describe, expect, it } from 'vitest';
import { LENS_SAVE_NO, LENS_SAVE_OPTIONS, lensRunArgs, lensSaveQuestionNeeded } from './lens-save-default.js';

describe('lensSaveQuestionNeeded (#4283)', () => {
  it('no question for an empty choice without a default', () => {
    expect(lensSaveQuestionNeeded([], [], true)).toBe(false);
  });
  it('no question when the choice equals the default, in any order', () => {
    expect(lensSaveQuestionNeeded(['b', 'a'], ['a', 'b'], true)).toBe(false);
  });
  it('asks when the choice differs, also when it clears the default', () => {
    expect(lensSaveQuestionNeeded(['a'], [], true)).toBe(true);
    expect(lensSaveQuestionNeeded([], ['a'], true)).toBe(true);
    expect(lensSaveQuestionNeeded(['a', 'c'], ['a', 'b'], true)).toBe(true);
  });
  it('never asks when the host cannot save', () => {
    expect(lensSaveQuestionNeeded(['a'], [], false)).toBe(false);
  });
  it('the answer starts on No', () => {
    expect(LENS_SAVE_OPTIONS[0]!.value).toBe(LENS_SAVE_NO);
  });
});

describe('lensRunArgs (#4283)', () => {
  it('passes the run lenses to swao assess only when the lens step was shown', () => {
    expect(lensRunArgs(false, ['a'])).toEqual([]);
    expect(lensRunArgs(true, ['a', 'b'])).toEqual(['--lenses', 'a,b']);
    expect(lensRunArgs(true, [])).toEqual(['--lenses', 'none']);
  });
});
