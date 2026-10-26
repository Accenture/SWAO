import { describe, it, expect } from 'vitest';
import { listConnectors, resolveBundledConnectorsDir } from '../index.js';

// #3372: the bundled seeds (including bedrock and openrouter) must load cleanly.
// The setup wizard and LLM Assessment screen seed these into the workspace and
// render exactly listConnectors().connectors, so if the packaged seeds load,
// both screens show them. #3388: resolve the bundled dir via the exported
// resolver (the single source of the bundled-dir path) and load it as an
// explicit overrideDir (the CI/test path, D-3).
describe('bundled LLM gateway seeds load (#3372)', () => {
  const dir = resolveBundledConnectorsDir();
  const r = listConnectors(dir ? { overrideDir: dir } : {});

  it('loads bedrock and openrouter with no warnings', () => {
    const ids = r.connectors.map((c) => c.file.connector.id);
    expect(ids).toContain('bedrock');
    expect(ids).toContain('openrouter');
    expect(r.warnings).toEqual([]);
  });

  it('includes every public seed id', () => {
    const ids = r.connectors.map((c) => c.file.connector.id).sort();
    for (const id of ['anthropic', 'bedrock', 'ollama', 'open-llm', 'openai', 'openrouter', 'vllm-generic']) {
      expect(ids).toContain(id);
    }
  });
});
