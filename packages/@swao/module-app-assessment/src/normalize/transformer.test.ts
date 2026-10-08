// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- transformer tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// v1.0
// Tests for transformer.ts: docxXmlToText, docxZipExtract, docxToMarkdown (#2869)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { docxXmlToText, docxZipExtract, docxToMarkdown, pdfToText, pptxToText } from './transformer.js';

// ESM-safe mock for pdf-parse (#2966 -- must be declared at module level)
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip') as typeof import('adm-zip');

const TEMP_DIR = join(tmpdir(), 'swao-transformer-test');

function ensureTempDir(): void {
  mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanTempDir(): void {
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// docxXmlToText -- pure XML parsing (no filesystem)
// ---------------------------------------------------------------------------

describe('docxXmlToText (#2869)', () => {
  it('extracts text from w:t elements grouped by w:p paragraphs', () => {
    const xml = [
      '<w:document>',
      '  <w:body>',
      '    <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>',
      '    <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>',
      '  </w:body>',
      '</w:document>',
    ].join('\n');
    const result = docxXmlToText(xml);
    expect(result).toContain('Hello World');
    expect(result).toContain('Second paragraph');
  });

  it('joins multiple w:t runs within a paragraph without separator', () => {
    const xml = '<w:p><w:r><w:t>Foo</w:t></w:r><w:r><w:t>Bar</w:t></w:r></w:p>';
    const result = docxXmlToText(xml);
    expect(result).toBe('FooBar');
  });

  it('separates paragraphs with double newlines', () => {
    const xml = '<w:p><w:t>A</w:t></w:p><w:p><w:t>B</w:t></w:p>';
    const result = docxXmlToText(xml);
    expect(result).toBe('A\n\nB');
  });

  it('filters out empty paragraphs', () => {
    const xml = '<w:p></w:p><w:p><w:t>Content</w:t></w:p><w:p>  </w:p>';
    const result = docxXmlToText(xml);
    expect(result).toBe('Content');
  });

  it('decodes XML entities in text nodes', () => {
    const xml = '<w:p><w:t>Tom &amp; Jerry &lt;tag&gt; &quot;quoted&quot; &apos;it&apos;</w:t></w:p>';
    const result = docxXmlToText(xml);
    expect(result).toBe(`Tom & Jerry <tag> "quoted" 'it'`);
  });

  it('handles w:t with xml:space attribute', () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve"> spaced </w:t></w:r></w:p>';
    const result = docxXmlToText(xml);
    expect(result).toContain('spaced');
  });

  it('returns empty string for XML with no w:t elements', () => {
    const xml = '<w:document><w:body><w:p></w:p></w:body></w:document>';
    const result = docxXmlToText(xml);
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// docxZipExtract -- reads word/document.xml from a real ZIP
// ---------------------------------------------------------------------------

describe('docxZipExtract (#2869)', () => {
  afterEach(() => { cleanTempDir(); });

  function buildDocx(documentXml: string, contentTypesXml?: string): string {
    ensureTempDir();
    const path = join(TEMP_DIR, `test-${Date.now()}.docx`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zip = new (AdmZip as any)();
    const ct = contentTypesXml ?? '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
    zip.addFile('[Content_Types].xml', Buffer.from(ct, 'utf-8'));
    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
    zip.writeZip(path);
    return path;
  }

  it('extracts text from word/document.xml inside the ZIP', () => {
    const xml = '<w:document><w:body><w:p><w:t>Extracted text</w:t></w:p></w:body></w:document>';
    const docxPath = buildDocx(xml);
    const result = docxZipExtract(docxPath);
    expect(result).toBe('Extracted text');
  });

  it('returns empty string when word/document.xml is absent from ZIP', () => {
    ensureTempDir();
    const path = join(TEMP_DIR, 'no-doc.docx');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zip = new (AdmZip as any)();
    zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>', 'utf-8'));
    zip.writeZip(path);
    const result = docxZipExtract(path);
    expect(result).toBe('');
  });

  it('handles DOCX with missing Override in Content_Types.xml (the #2869 scenario)', () => {
    // Simulate the exact failure: Content_Types.xml has no Override for word/document.xml
    // but word/document.xml exists with real content.
    const malformedCt = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
    const xml = '<w:document><w:body><w:p><w:t>Recovered content</w:t></w:p></w:body></w:document>';
    const docxPath = buildDocx(xml, malformedCt);
    const result = docxZipExtract(docxPath);
    expect(result).toBe('Recovered content');
  });
});

// ---------------------------------------------------------------------------
// docxToMarkdown -- integration: mammoth primary, ZIP fallback (#2869)
// ---------------------------------------------------------------------------

describe('docxToMarkdown fallback (#2869)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanTempDir();
  });

  function buildMinimalDocx(text: string): string {
    ensureTempDir();
    const path = join(TEMP_DIR, `mammoth-fail-${Date.now()}.docx`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zip = new (AdmZip as any)();
    zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>', 'utf-8'));
    zip.addFile('word/document.xml', Buffer.from(
      `<w:document><w:body><w:p><w:t>${text}</w:t></w:p></w:body></w:document>`,
      'utf-8',
    ));
    zip.writeZip(path);
    return path;
  }

  it('falls back to ZIP extraction when mammoth throws mimeType error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const docxPath = buildMinimalDocx('Fallback text');

    // A DOCX with missing Content_Types Override causes mammoth to fail;
    // the fallback must still return the text from word/document.xml.
    const result = await docxToMarkdown(docxPath);

    // The result comes from ZIP extraction (mammoth threw, fallback ran).
    expect(result).toContain('Fallback text');
    // A warning must be emitted to signal degraded extraction.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mammoth failed'));
  });

  it('emits a warning naming the file when falling back', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const docxPath = buildMinimalDocx('text');
    await docxToMarkdown(docxPath);
    const warned = warnSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('mammoth-fail'),
    );
    expect(warned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pdfToText -- pdf-parse integration (#2966)
// ---------------------------------------------------------------------------

describe('pdfToText (#2966)', () => {
  const TEMP_PDF_DIR = join(tmpdir(), 'swao-pdf-test');

  function makePdfStub(name: string): string {
    mkdirSync(TEMP_PDF_DIR, { recursive: true });
    const p = join(TEMP_PDF_DIR, name);
    writeFileSync(p, Buffer.from('%PDF-1.4 minimal stub'));
    return p;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (existsSync(TEMP_PDF_DIR)) rmSync(TEMP_PDF_DIR, { recursive: true, force: true });
  });

  it('returns extracted text for a valid PDF', async () => {
    const pdfParseMod = await import('pdf-parse');
    vi.mocked(pdfParseMod.default).mockResolvedValue({ text: 'Architecture overview: sovereign deployment.' } as never);
    const result = await pdfToText(makePdfStub('arch.pdf'));
    expect(result).toBe('Architecture overview: sovereign deployment.');
  });

  it('returns empty string when pdf-parse throws (encrypted or corrupt PDF)', async () => {
    const pdfParseMod = await import('pdf-parse');
    vi.mocked(pdfParseMod.default).mockRejectedValue(new Error('PDF encrypted'));
    const result = await pdfToText(makePdfStub('encrypted.pdf'));
    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse returns null text (image-only PDF)', async () => {
    const pdfParseMod = await import('pdf-parse');
    vi.mocked(pdfParseMod.default).mockResolvedValue({ text: null } as never);
    const result = await pdfToText(makePdfStub('image-only.pdf'));
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// pptxToText -- adm-zip DrawingML extraction (#2967)
// ---------------------------------------------------------------------------

describe('pptxToText (#2967)', () => {
  const TEMP_PPTX_DIR = join(tmpdir(), 'swao-pptx-test');

  function makePptx(slides: Record<string, string>): string {
    mkdirSync(TEMP_PPTX_DIR, { recursive: true });
    const path = join(TEMP_PPTX_DIR, `test-${Date.now()}.pptx`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zip = new (AdmZip as any)();
    for (const [name, xml] of Object.entries(slides)) {
      zip.addFile(name, Buffer.from(xml, 'utf-8'));
    }
    zip.writeZip(path);
    return path;
  }

  afterEach(() => {
    if (existsSync(TEMP_PPTX_DIR)) rmSync(TEMP_PPTX_DIR, { recursive: true, force: true });
  });

  it('extracts text from DrawingML a:t elements across slides', () => {
    const slide1 = '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Architecture Overview</a:t><a:t>Sovereign Deployment</a:t></p:sld>';
    const slide2 = '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Compliance Requirements</a:t></p:sld>';
    const pptxPath = makePptx({
      'ppt/slides/slide1.xml': slide1,
      'ppt/slides/slide2.xml': slide2,
    });
    const result = pptxToText(pptxPath);
    expect(result).toContain('Architecture Overview');
    expect(result).toContain('Sovereign Deployment');
    expect(result).toContain('Compliance Requirements');
  });

  it('returns empty string for a corrupt or non-PPTX file', () => {
    mkdirSync(TEMP_PPTX_DIR, { recursive: true });
    const badPath = join(TEMP_PPTX_DIR, 'corrupt.pptx');
    writeFileSync(badPath, 'not a zip');
    const result = pptxToText(badPath);
    expect(result).toBe('');
  });
});
