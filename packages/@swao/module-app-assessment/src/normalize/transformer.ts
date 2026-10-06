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

// v1.1
import { basename } from 'node:path';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
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
 * Uses mammoth as the primary extractor. If mammoth throws (e.g. when a
 * DOCX's [Content_Types].xml lacks the Override for /word/document.xml,
 * causing jsdom to receive an undefined mimeType -- #2869), falls back to
 * reading word/document.xml directly from the ZIP and extracting <w:t> text.
 */
export async function docxToMarkdown(filePath: string): Promise<string> {
  try {
    const result = await mammoth.convertToMarkdown({ path: filePath });
    return result.value;
  } catch {
    // #2869: degrade gracefully for structurally non-conformant DOCX files.
    console.warn(`[swao normalize] mammoth failed on ${basename(filePath)}; falling back to raw XML extraction`);
    return docxZipExtract(filePath);
  }
}

/**
 * Last-resort DOCX text extractor: reads word/document.xml directly from the
 * ZIP archive and extracts text from <w:t> elements, grouped by paragraph.
 * Preserves paragraph breaks but no rich Markdown structure.
 */
export function docxZipExtract(filePath: string): string {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return '';
  const xml = entry.getData().toString('utf-8');
  return docxXmlToText(xml);
}

/**
 * Extract plain text from OOXML word/document.xml content.
 * Splits on paragraph boundaries (<w:p>) and collects <w:t> text nodes.
 * Decodes common XML entities (&amp; &lt; &gt; &quot; &apos;).
 */
export function docxXmlToText(xml: string): string {
  const lines = xml.split(/<w:p[ \/>]/).map((para) => {
    const texts: string[] = [];
    const re = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(para)) !== null) {
      if (m[1]) texts.push(decodeXmlEntities(m[1]));
    }
    return texts.join('');
  });
  return lines.filter((l) => l.trim().length > 0).join('\n\n');
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case '&amp;': return '&';
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&quot;': return '"';
      case '&apos;': return "'";
      default: return entity;
    }
  });
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
