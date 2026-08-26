// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- bundled connector seed sweep (#1396)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConnectorYaml } from './connector-schema.js';
import { listConnectors } from './connector-loader.js';

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../llm-gateway');

describe('bundled llm-gateway seeds (#1396)', () => {
  const files = readdirSync(SEEDS_DIR).filter(f => f.endsWith('.yaml') && !f.startsWith('_'));

  it('ships the five expected seeds plus the template', () => {
    expect(files.sort()).toEqual(['anthropic.yaml', 'ollama.yaml', 'openai.yaml', 'openrouter.yaml', 'vllm-generic.yaml']);
    expect(readdirSync(SEEDS_DIR)).toContain('_template.yaml');
  });

  it('every seed validates against the connector schema', () => {
    for (const f of files) {
      const r = parseConnectorYaml(readFileSync(join(SEEDS_DIR, f), 'utf-8'), f);
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
    }
  });

  it('seed ids match their filenames and carry contributor + last_reviewed', () => {
    for (const f of files) {
      const r = parseConnectorYaml(readFileSync(join(SEEDS_DIR, f), 'utf-8'), f);
      if (!r.ok) throw new Error(r.error);
      expect(`${r.file.connector.id}.yaml`).toBe(f);
      expect(r.file.connector.meta?.source).toBe('bundled');
      expect(r.file.connector.meta?.last_reviewed).toBeTruthy();
      expect(r.file.connector.meta?.contributor).toContain('Accenture');
    }
  });

  it('openrouter defaults to an EU-vendor model (operator direction 2026-08-05)', () => {
    const r = parseConnectorYaml(readFileSync(join(SEEDS_DIR, 'openrouter.yaml'), 'utf-8'), 'openrouter.yaml');
    if (!r.ok) throw new Error(r.error);
    expect(r.file.connector.models.default).toBe('mistralai/mistral-large');
    expect(r.file.connector.models.default).not.toContain('deepseek');
    expect(r.file.connector.models.discovery_endpoint).toBe('/v1/models');
  });

  it('every seed carries honest sovereignty facts', () => {
    for (const f of files) {
      const r = parseConnectorYaml(readFileSync(join(SEEDS_DIR, f), 'utf-8'), f);
      if (!r.ok) throw new Error(r.error);
      expect(r.file.connector.sovereignty?.data_residency, `${f} sovereignty.data_residency`).toBeTruthy();
      expect(r.file.connector.sovereignty?.zero_retention, `${f} sovereignty.zero_retention`).toBeDefined();
    }
  });

  it('the dev-path loader discovers all five seeds (bundle path verified at binary gate)', () => {
    const r = listConnectors();
    const ids = r.connectors.filter(c => c.origin === 'bundled').map(c => c.file.connector.id);
    for (const id of ['anthropic', 'openai', 'ollama', 'openrouter', 'vllm-generic']) {
      expect(ids).toContain(id);
    }
    expect(r.warnings).toEqual([]);
  });

  it('the template itself is schema-valid when its id is amended (copy/paste contract)', () => {
    const text = readFileSync(join(SEEDS_DIR, '_template.yaml'), 'utf-8');
    const r = parseConnectorYaml(text, '_template.yaml');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  });
});
