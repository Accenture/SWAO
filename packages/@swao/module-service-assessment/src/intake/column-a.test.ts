// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Column A parsing + operational flags (#3077, #3082, Design 103 §3.3.2, G-03, G-04).
import { describe, it, expect } from 'vitest';
import { normaliseAppId, parseIdNameCell, resolveOperationalStatus } from './column-a.js';
import { cellText, coerceCell } from './cell.js';

describe('parseIdNameCell (#3077)', () => {
  it('splits the standard compound form on the first "("', () => {
    expect(parseIdNameCell('HOSAPP133 (Radimetrics)')).toEqual({ id: 'hosapp133', name: 'Radimetrics' });
  });

  it('treats a value without parentheses as the full ID with an empty name', () => {
    expect(parseIdNameCell('HOSAPP153-MACMON')).toEqual({ id: 'hosapp153-macmon', name: '' });
  });

  it('keeps every word of an ID without parentheses so distinct rows stay distinct (#3162)', () => {
    expect(parseIdNameCell('FILESRV 2020')).toEqual({ id: 'filesrv-2020', name: '' });
    expect(parseIdNameCell('FILESRV (Linux Fileserver)').id).toBe('filesrv');
  });

  it('decodes URL-encoded characters in the name', () => {
    expect(parseIdNameCell('HOSAPP070 (Report%2fExport)').name).toBe('Report/Export');
  });
});

describe('operational flags (#3082, G-03)', () => {
  it('"nicht starten & nicht loschen!" -> restricted', () => {
    const p = parseIdNameCell('HOSAPP045 (P+I Applikation) nicht starten & nicht loschen!');
    expect(p).toEqual({ id: 'hosapp045', name: 'P+I Applikation', flag: 'restricted' });
  });

  it('"Alt Abgeschaltet" -> decommissioned', () => {
    expect(parseIdNameCell('HOSAPP050 (Old Archive) Alt Abgeschaltet').flag).toBe('decommissioned');
  });

  it('"Ungenutzte Ressource. Nicht starten" -> unused (not restricted)', () => {
    expect(parseIdNameCell('HOSAPP051 (Spare VM) Ungenutzte Ressource. Nicht starten').flag).toBe('unused');
    expect(parseIdNameCell('HOSAPP052 (Spare) ungenutzte ressource').flag).toBe('unused');
  });

  it('detects a flag on a value without parentheses and keeps the ID clean', () => {
    expect(parseIdNameCell('HOSAPP053 Alt Abgeschaltet')).toEqual({ id: 'hosapp053', name: '', flag: 'decommissioned' });
  });

  it('active_memory_mb = 0 without a flag -> inactive (G-04); an explicit flag wins', () => {
    expect(resolveOperationalStatus(undefined, 0)).toBe('inactive');
    expect(resolveOperationalStatus('decommissioned', 0)).toBe('decommissioned');
    expect(resolveOperationalStatus(undefined, 512)).toBe('active');
    expect(resolveOperationalStatus(undefined, null)).toBe('active');
  });
});

describe('cellText / coerceCell', () => {
  it('flattens rich text, hyperlink, and formula cells to plain text', () => {
    expect(cellText({ richText: [{ text: 'Win' }, { text: 'dows' }] })).toBe('Windows');
    expect(cellText({ text: 'support@example.org', hyperlink: 'mailto:support@example.org' })).toBe('support@example.org');
    expect(cellText({ formula: 'A1*2', result: 8 })).toBe('8');
    expect(cellText({ error: '#N/A' })).toBe('');
    expect(cellText(null)).toBe('');
  });

  it('coerces numbers, booleans, lists, and null markers', () => {
    expect(coerceCell('4', { type: 'integer' })).toEqual({ ok: true, value: 4 });
    expect(coerceCell('four', { type: 'integer' })).toEqual({ ok: false, reason: 'not_numeric' });
    expect(coerceCell('Ja', { type: 'boolean' })).toEqual({ ok: true, value: true });
    expect(coerceCell('vielleicht', { type: 'boolean' })).toEqual({ ok: false, reason: 'unknown_boolean' });
    expect(coerceCell('N/A', { type: 'string' })).toEqual({ ok: true, value: null });
    expect(coerceCell('Alle / IT', { type: 'list', separator: '/' })).toEqual({ ok: true, value: ['Alle', 'IT'] });
  });
});

// #3167: real intake cells carry the name and free-text notes in the identity
// column. The ID is the leading code, the name comes from the brackets, flag
// phrases set the status, and note text never reaches the ID or the name
// (notes can name a staff member). Synthetic prefixes only.
describe('identity cells with notes and flags (#3167)', () => {
  it.each([
    // [cell, id, name, flag]
    ['HOSAPP145 (Archive4) NICHT LÖSCHEN ANALYST FRAGEN', 'hosapp145', 'Archive4', 'restricted'],
    ['HOSAPP124 NICHT STARTEN - ANALYST FRAGEN (FTP Gateway und Cache)', 'hosapp124', 'FTP Gateway und Cache', 'restricted'],
    ['HOSAPP146 (CPM Suite - Nicht starten! IT MELDEN bei Änderung!)', 'hosapp146', 'CPM Suite', 'restricted'],
    ['HOSAPP148 (Gateway Connect) NICHT STARTEN ANALYST FRAGEN', 'hosapp148', 'Gateway Connect', 'restricted'],
    ['HOSAPP167 (Device GDT- Alt, nicht starten)', 'hosapp167', 'Device GDT- Alt', 'restricted'],
    ['HOSPACS002 (Interface 64-Bit) - nicht starten & nicht löschen!', 'hospacs002', 'Interface 64-Bit', 'restricted'],
    ['HOSPRN010 (Ungenutzte Ressource. Nicht starten)', 'hosprn010', '', 'unused'],
    ['HOSAPP127 (Steril Assure) Alt Abgeschaltet', 'hosapp127', 'Steril Assure', 'decommissioned'],
    ['FILESRV (Linux Fileserver) - nicht starten & nicht löschen!', 'filesrv', 'Linux Fileserver', 'restricted'],
    ['HOSPACS009 - nicht starten!', 'hospacs009', '', 'restricted'],
  ])('%s', (cell, id, name, flag) => {
    expect(parseIdNameCell(cell)).toEqual({ id, name, flag });
  });

  it('keeps every word of a code without brackets or separators (#3162) and distinct rows distinct', () => {
    expect(parseIdNameCell('FILESRV 2020')).toEqual({ id: 'filesrv-2020', name: '' });
    expect(parseIdNameCell('HOSSAP030 SAP ROUTER 2020')).toEqual({ id: 'hossap030-sap-router-2020', name: '' });
    expect(parseIdNameCell('FILESRV (Linux Fileserver)').id).toBe('filesrv');
  });

  it('cuts the ID at a spaced dash or en dash and keeps names that contain one', () => {
    expect(parseIdNameCell('HOSAPP200 - Imaging Router').id).toBe('hosapp200');
    expect(parseIdNameCell('HOSAPP249 (NPS – Radius)')).toEqual({ id: 'hosapp249', name: 'NPS – Radius' });
    expect(parseIdNameCell('HOSAPP103 (Monitor 3 - Long Term ECG)').name).toBe('Monitor 3 - Long Term ECG');
  });

  it('never puts note text into the ID or the name', () => {
    const p = parseIdNameCell('HOSAPP145 (Archive4) NICHT LÖSCHEN ANALYST FRAGEN');
    expect(`${p.id} ${p.name}`.toLowerCase()).not.toMatch(/analyst|fragen/);
  });
});

describe('normaliseAppId (#3167)', () => {
  it('transliterates umlauts and sharp s and collapses dash runs', () => {
    expect(normaliseAppId('Prüf-Server Größe')).toBe('pruef-server-groesse');
    expect(normaliseAppId('ÄRZTE  ÖL   Übung')).toBe('aerzte-oel-uebung');
    expect(normaliseAppId('A --- B')).toBe('a-b');
  });
});
