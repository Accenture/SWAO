// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Rationale: swao-pub.js is a non-module browser script loaded via eval().
// Accessing window.initSwaoTable and Blob/URL browser globals requires `any`
// casts that cannot be typed without adding a full browser type lib to this
// package. The pattern is intentional and safe -- all casts are test-only.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SWAO_PUB_JS = join(__dirname, 'assets/swao-pub.js');

function loadSwaoTable(): void {
  const code = readFileSync(SWAO_PUB_JS, 'utf-8');
  // Execute in global scope so window.initSwaoTable is registered
  (0, eval)(code);
}

function createContainer(id: string): HTMLElement {
  const div = document.createElement('div');
  div.id = id + '-container';
  document.body.appendChild(div);
  return div;
}

const NAME_COL = {
  id: 'name',
  label: 'Name',
  field: 'name',
  type: 'text' as const,
  sortable: true,
};

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  // Stub URL methods not available in jsdom
  (globalThis as any).URL = {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  };
});

describe('SwaoTable', () => {
  it('window.initSwaoTable is defined after loading', () => {
    loadSwaoTable();
    expect(typeof (window as any).initSwaoTable).toBe('function');
  });

  it('renders a minimal table with 2 rows', () => {
    loadSwaoTable();
    createContainer('test');
    (window as any).initSwaoTable({
      id: 'test',
      columns: [NAME_COL],
      rows: [{ name: 'Alice' }, { name: 'Bob' }],
    });
    const table = document.querySelector('#test-container table');
    expect(table).not.toBeNull();
    const rows = document.querySelectorAll('#test-tbody .swao-row');
    expect(rows.length).toBe(2);
  });

  it('filter by value using chip', () => {
    loadSwaoTable();
    createContainer('sev-table');
    (window as any).initSwaoTable({
      id: 'sev-table',
      columns: [
        { id: 'severity', label: 'Severity', field: 'severity', type: 'text', sortable: false,
          filterable: true, filterType: 'chips', filterValues: ['high', 'low'] },
      ],
      rows: [
        { severity: 'high' },
        { severity: 'low' },
        { severity: 'high' },
      ],
    });

    // Click the 'high' filter chip
    const highChip = document.querySelector(
      '.filter-chip[data-filter-val="high"]'
    ) as HTMLElement;
    expect(highChip).not.toBeNull();
    highChip.click();

    // Only 'high' rows should be present in tbody
    const rows = document.querySelectorAll('#sev-table-tbody .swao-row');
    expect(rows.length).toBe(2);
    rows.forEach(row => {
      const cell = row.querySelector('td:nth-child(1)');
      expect(cell?.textContent).toContain('high');
    });
  });

  it('sort by clicking column header', () => {
    loadSwaoTable();
    createContainer('sort-table');
    (window as any).initSwaoTable({
      id: 'sort-table',
      columns: [NAME_COL],
      rows: [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }],
    });

    // Click Name header to sort ascending
    const th = document.querySelector(
      'th.sortable[data-sort-field="name"]'
    ) as HTMLElement;
    expect(th).not.toBeNull();
    th.click();

    const rows = document.querySelectorAll('#sort-table-tbody .swao-row');
    expect(rows.length).toBe(3);
    const names = Array.from(rows).map(r => r.querySelector('td:nth-child(1)')?.textContent?.trim());
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('CSV export content', () => {
    loadSwaoTable();
    createContainer('csv-table');

    // Capture the CSV string by intercepting the Blob constructor
    let capturedCsv: string = '';
    const OrigBlob = (window as any).Blob;
    (window as any).Blob = function(parts: unknown[], opts: unknown) {
      if (Array.isArray(parts) && typeof parts[0] === 'string') {
        capturedCsv = parts[0];
      }
      return new OrigBlob(parts, opts);
    };

    (window as any).initSwaoTable({
      id: 'csv-table',
      columns: [
        { id: 'name', label: 'Name', field: 'name', type: 'text', sortable: true },
        { id: 'score', label: 'Score', field: 'score', type: 'number', sortable: true },
      ],
      rows: [
        { name: 'Alice', score: 10 },
        { name: 'Bob', score: 20 },
      ],
      exportCsv: true,
    });

    const exportBtn = document.getElementById('csv-table-export') as HTMLElement;
    expect(exportBtn).not.toBeNull();
    exportBtn.click();

    // Restore
    (window as any).Blob = OrigBlob;

    expect(capturedCsv).not.toBe('');
    const lines = capturedCsv.trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Score');
  });

  it('expand row template substitution', () => {
    loadSwaoTable();
    createContainer('expand-table');
    (window as any).initSwaoTable({
      id: 'expand-table',
      columns: [NAME_COL],
      rows: [{ name: 'Alice' }],
      expandTemplate: '<div class="detail">{{name}} details</div>',
    });

    const expandBtn = document.querySelector('.expand-btn') as HTMLElement;
    expect(expandBtn).not.toBeNull();
    expandBtn.click();

    const detailRow = document.querySelector('.row-detail');
    expect(detailRow).not.toBeNull();
    expect(detailRow?.textContent).toContain('Alice details');
  });

  it('{{#if field}} conditional omits block when field is empty (#0731)', () => {
    loadSwaoTable();
    createContainer('if-table');
    (window as any).initSwaoTable({
      id: 'if-table',
      columns: [NAME_COL],
      rows: [{ name: 'Alice', note: '' }],
      expandTemplate: '<div>{{name}}</div>{{#if note}}<div class="note">{{note}}</div>{{/if}}',
    });

    const expandBtn = document.querySelector('.expand-btn') as HTMLElement;
    expandBtn.click();

    const detailRow = document.querySelector('.row-detail');
    expect(detailRow).not.toBeNull();
    expect(detailRow?.textContent).toContain('Alice');
    // Empty note field -- the conditional block must be absent
    expect(detailRow?.querySelector('.note')).toBeNull();
  });

  it('{{#if field}} conditional includes block when field is non-empty (#0731)', () => {
    loadSwaoTable();
    createContainer('if-filled-table');
    (window as any).initSwaoTable({
      id: 'if-filled-table',
      columns: [NAME_COL],
      rows: [{ name: 'Bob', note: 'Important note' }],
      expandTemplate: '<div>{{name}}</div>{{#if note}}<div class="note">{{note}}</div>{{/if}}',
    });

    const expandBtn = document.querySelector('.expand-btn') as HTMLElement;
    expandBtn.click();

    const detailRow = document.querySelector('.row-detail');
    expect(detailRow?.querySelector('.note')?.textContent).toBe('Important note');
  });

  it('column visibility picker toggle hides Name column', () => {
    loadSwaoTable();
    createContainer('vis-table');
    (window as any).initSwaoTable({
      id: 'vis-table',
      columns: [NAME_COL],
      rows: [{ name: 'Alice' }],
    });

    // Open the picker
    const gearBtn = document.querySelector('.btn-cols-picker') as HTMLElement;
    expect(gearBtn).not.toBeNull();
    gearBtn.click();

    const dropdown = document.getElementById('vis-table-cols-dropdown');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.style.display).not.toBe('none');

    // Find the checkbox for 'name' column and uncheck it
    const checkbox = dropdown?.querySelector(
      '.col-vis-cb[data-col-id="name"]'
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);

    // Uncheck by clicking (triggers change event)
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // The Name th should now be absent or hidden
    const nameTh = document.querySelector('th[data-col-id="name"]') as HTMLElement;
    // After rebuildTable(), invisible columns are not rendered in thead
    if (nameTh) {
      // If still in DOM, it should be hidden
      expect(nameTh.style.display).toBe('none');
    } else {
      // Column was not rendered -- that is acceptable
      expect(nameTh).toBeNull();
    }
  });

  it('PII field excluded from CSV', () => {
    loadSwaoTable();
    createContainer('pii-table');

    let capturedCsv: string = '';
    const OrigBlob = (window as any).Blob;
    (window as any).Blob = function(parts: unknown[], opts: unknown) {
      if (Array.isArray(parts) && typeof parts[0] === 'string') {
        capturedCsv = parts[0];
      }
      return new OrigBlob(parts, opts);
    };

    (window as any).initSwaoTable({
      id: 'pii-table',
      columns: [
        { id: 'name', label: 'Name', field: 'name', type: 'text', sortable: true },
        { id: 'email', label: 'Email', field: 'email', type: 'text', sortable: false, piiField: true },
      ],
      rows: [{ name: 'Alice', email: 'alice@example.com' }],
      exportCsv: true,
    });

    const exportBtn = document.getElementById('pii-table-export') as HTMLElement;
    exportBtn.click();

    (window as any).Blob = OrigBlob;

    expect(capturedCsv).not.toBe('');
    expect(capturedCsv).toContain('Name');
    expect(capturedCsv).not.toContain('Email');
    expect(capturedCsv).not.toContain('alice@example.com');
  });
});
