// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// File transformation utilities for `swao normalize` (#0442).
//
// xlsxToCsv: converts the first sheet of an XLSX file to CSV string.
// docxToMarkdown: extracts Markdown text from a DOCX file via mammoth.
// pdfToText: stub -- returns a placeholder for v1 scope.

import { basename } from 'node:path';
import ExcelJS from 'exceljs';
// #0683: static import so esbuild inlines mammoth into the SEA bundle.
// Type shape declared in mammoth.d.ts (no official @types/mammoth).
import mammoth from 'mammoth';

/**
 * Convert the first worksheet of an XLSX file to a CSV string.
 * Uses exceljs to read the file; handles the 1-indexed row.values array.
 */
export async function xlsxToCsv(filePath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return '';
  }

  const lines: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed; index 0 is always undefined/null.
    const values = (row.values as (ExcelJS.CellValue | undefined | null)[]).slice(1);
    const csvRow = values
      .map((cell) => {
        const raw = cellToString(cell);
        // Quote fields that contain commas, double-quotes, or newlines.
        if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
          return `"${raw.replace(/"/g, '""')}"`;
        }
        return raw;
      })
      .join(',');
    lines.push(csvRow);
  });

  return lines.join('\n');
}

function cellToString(cell: ExcelJS.CellValue | undefined | null): string {
  if (cell === undefined || cell === null) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return String(cell);
  if (cell instanceof Date) return cell.toISOString();
  // RichText
  if (typeof cell === 'object' && 'richText' in cell) {
    const rt = cell as { richText: Array<{ text: string }> };
    return rt.richText.map((r) => r.text).join('');
  }
  // Hyperlink
  if (typeof cell === 'object' && 'text' in cell) {
    return String((cell as { text: unknown }).text ?? '');
  }
  // Formula
  if (typeof cell === 'object' && 'result' in cell) {
    return String((cell as { result: unknown }).result ?? '');
  }
  return String(cell);
}

/**
 * Extract text from a DOCX file and return it as Markdown.
 * Uses mammoth; returns the value string from the conversion result.
 */
export async function docxToMarkdown(filePath: string): Promise<string> {
  const result = await mammoth.convertToMarkdown({ path: filePath });
  return result.value;
}

/**
 * Extract text from a plain (text-based) PDF.
 * Sprint-047 stub -- returns a placeholder comment.
 * A real extraction library (pdf-parse, pdfjs-dist) would go here.
 */
export async function pdfToText(filePath: string): Promise<string> {
  const name = basename(filePath);
  console.warn(
    `[swao normalize] PDF text extraction not yet implemented; manual review required for: ${name}`,
  );
  return `// PDF text extraction requires manual review for file: ${name}`;
}
