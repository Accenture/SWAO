import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import pdfParse from './node_modules/.pnpm/pdf-parse@1.1.4/node_modules/pdf-parse/lib/pdf-parse.js';

// A page is considered near-blank if it has fewer characters than this threshold.
// 100 chars catches pages with only a few items (e.g. 4 service names ~= 50-60 chars)
// vs pages with real content (heading + body text >= 200 chars).
const BLANK_THRESHOLD = parseInt(process.env.BLANK_THRESHOLD || '100', 10);
const VERBOSE = process.env.VERBOSE === '1';

async function checkFile(filePath) {
  const buf = readFileSync(filePath);
  const pageTexts = [];
  await pdfParse(buf, {
    pagerender(pd) {
      return pd.getTextContent().then(tc => {
        pageTexts.push(tc.items.map(i => i.str).join('').trim());
        return '';
      });
    }
  });
  const blanks = pageTexts.map((t, i) => ({ page: i + 1, chars: t.length })).filter(p => p.chars < BLANK_THRESHOLD);
  if (VERBOSE) {
    pageTexts.forEach((t, i) => {
      const chars = t.length;
      const preview = t.slice(0, 80).replace(/\s+/g, ' ');
      const flag = chars < BLANK_THRESHOLD ? ' *** NEAR-BLANK ***' : '';
      console.log(`  p${i + 1}: ${chars} chars${flag}  "${preview}"`);
    });
  }
  return { pages: pageTexts.length, blanks };
}

async function checkDir(dir) {
  if (!existsSync(dir)) { console.log(`SKIP (dir not found): ${dir}`); return { total: 0, blankCount: 0 }; }
  const files = readdirSync(dir).filter(f => f.endsWith('.pdf')).sort();
  if (files.length === 0) { console.log(`SKIP (no PDFs): ${dir}`); return { total: 0, blankCount: 0 }; }
  let blankCount = 0;
  for (const file of files) {
    const { pages, blanks } = await checkFile(join(dir, file));
    if (blanks.length > 0) {
      console.error(`  NEAR-BLANK ${file} (${pages}p): pages ${blanks.map(b => b.page + '(' + b.chars + 'ch)').join(', ')}`);
      blankCount += blanks.length;
    } else {
      console.log(`  OK (${pages} pages): ${file}`);
    }
  }
  return { total: files.length, blankCount };
}

const base = process.argv[2] || 'C:\\swao\\swao-v1.1.0\\apps\\sovereign-health\\wsp';
const singleFile = process.argv[3];

if (singleFile) {
  // Verbose single-file mode
  process.env.VERBOSE = '1';
  console.log(`\n=== ${singleFile} ===`);
  const { pages, blanks } = await checkFile(singleFile);
  console.log(`\nTotal: ${pages} pages, ${blanks.length} near-blank (threshold: ${BLANK_THRESHOLD} chars)`);
  process.exit(blanks.length > 0 ? 1 : 0);
}

const dirs = [
  join(base, 'reports-app'),
  join(base, 'reports-llm'),
  join(base, 'reports-lz'),
];

let grandTotal = 0, grandBlanks = 0;
for (const dir of dirs) {
  console.log(`\n=== ${dir} ===`);
  const { total, blankCount } = await checkDir(dir);
  grandTotal += total;
  grandBlanks += blankCount;
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Threshold: ${BLANK_THRESHOLD} chars/page`);
if (grandBlanks > 0) {
  console.error(`FAIL: ${grandBlanks} near-blank page(s) found across ${grandTotal} PDFs`);
  process.exit(1);
} else {
  console.log(`PASS: ${grandTotal} PDFs checked -- 0 near-blank pages`);
  process.exit(0);
}
