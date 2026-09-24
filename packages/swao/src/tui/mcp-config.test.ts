// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI + orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { patchClaudeDesktopConfig } from './mcp-config.js';

const BINARY = 'C:\\swao\\test-9.5\\swao-enterprise-win.exe';
const CONFIG  = 'C:\\Users\\user\\AppData\\Roaming\\Claude\\claude_desktop_config.json';

function mockConfig(obj: unknown) {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(obj) as unknown as Buffer);
}

function captureWrite(): () => string {
  let written = '';
  vi.mocked(writeFileSync).mockImplementation((_p, data) => { written = String(data); });
  vi.mocked(mkdirSync).mockReturnValue(undefined as unknown as string);
  return () => written;
}

describe('patchClaudeDesktopConfig', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('creates a new config with key "swao" when no file exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const getWritten = captureWrite();

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers['swao']?.command).toBe(BINARY);
  });

  it('returns already_present when the existing entry already points to binaryPath', () => {
    mockConfig({ mcpServers: { swao: { command: BINARY, args: ['mcp'] } } });

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('already_present');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('updates existing swao-mcp entry in-place, preserving the key name', () => {
    const oldBinary = 'C:\\swao\\test-8.2\\swao-enterprise-win-x64.exe';
    mockConfig({ mcpServers: { 'swao-mcp': { command: oldBinary, args: ['mcp'] } } });
    const getWritten = captureWrite();

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers).toHaveProperty('swao-mcp');
    expect(parsed.mcpServers).not.toHaveProperty('swao');
    expect(parsed.mcpServers['swao-mcp']?.command).toBe(BINARY);
  });

  it('adds new "swao" key when no existing swao binary entry is found', () => {
    mockConfig({ mcpServers: { 'other-tool': { command: '/path/to/other.exe', args: ['start'] } } });
    const getWritten = captureWrite();

    const result = patchClaudeDesktopConfig(CONFIG, 'C:\\swao\\swao-enterprise-win.exe');

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers).toHaveProperty('swao');
    expect(parsed.mcpServers).toHaveProperty('other-tool');
  });

  it('detects existing win-x64.exe entry and updates it in-place', () => {
    const oldBinary = 'C:\\swao\\rc-1\\swao-enterprise-win-x64.exe';
    mockConfig({ mcpServers: { 'swao': { command: oldBinary, args: ['mcp'] } } });
    const getWritten = captureWrite();
    const newBinary = 'C:\\swao\\rc-2\\swao-enterprise-win-x64.exe';

    const result = patchClaudeDesktopConfig(CONFIG, newBinary);

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers['swao']?.command).toBe(newBinary);
  });

  it('recognises linux binary names', () => {
    mockConfig({ mcpServers: { 'swao': { command: '/old/swao-linux-x64', args: ['mcp'] } } });
    const getWritten = captureWrite();

    const result = patchClaudeDesktopConfig(CONFIG, '/new/swao-linux-x64');

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers['swao']?.command).toBe('/new/swao-linux-x64');
  });

  // CI audit gate: SWAO_BIN_RE must match every actual release binary filename (#2713).
  // Tier-named Unix binaries (swao-enterprise-linux-x64) were not covered by the
  // previous regex and would not be detected as existing SWAO entries.
  it.each([
    ['swao-community-win-x64.exe',   'C:\\swao\\rc-1\\swao-community-win-x64.exe'],
    ['swao-consultant-win-x64.exe',  'C:\\swao\\rc-1\\swao-consultant-win-x64.exe'],
    ['swao-enterprise-linux-x64',    '/opt/swao/swao-enterprise-linux-x64'],
    ['swao-community-linux-x64',     '/opt/swao/swao-community-linux-x64'],
    ['swao-consultant-linux-x64',    '/opt/swao/swao-consultant-linux-x64'],
    ['swao-enterprise-macos-x64',    '/Applications/swao-enterprise-macos-x64'],
    ['swao-community-macos-x64',     '/Applications/swao-community-macos-x64'],
    ['swao-enterprise-macos-arm64',  '/Applications/swao-enterprise-macos-arm64'],
  ])('detects existing %s entry and updates it in-place', (_name, oldBinary) => {
    mockConfig({ mcpServers: { 'swao': { command: oldBinary, args: ['mcp'] } } });
    const getWritten = captureWrite();
    const newBinary = 'C:\\swao\\rc-2\\swao-enterprise-win-x64.exe';

    const result = patchClaudeDesktopConfig(CONFIG, newBinary);

    expect(result).toBe('patched');
    const parsed = JSON.parse(getWritten()) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers['swao']?.command).toBe(newBinary);
  });

  it('returns error when writeFileSync throws', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined as unknown as string);
    vi.mocked(writeFileSync).mockImplementation(() => { throw new Error('EPERM'); });

    const result = patchClaudeDesktopConfig(CONFIG, BINARY);

    expect(result).toBe('error');
  });
});
