// Re-sync curated manual content from swao/docs/ into docs-site/manual/.
// Run before `npm run docs:build` when source markdown has changed.

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', 'docs');
const dstRoot = join(__dirname, 'manual');

const FILES = [
  { src: 'index.md', dst: 'index.md' },
  { src: 'quick-start.md', dst: 'quick-start.md' },
  { src: 'how-it-works.md', dst: 'how-it-works.md' },
  { src: 'features.md', dst: 'features.md' },
  { src: 'getting-started.md', dst: 'getting-started.md' },
  { src: 'workspace-setup.md', dst: 'workspace-setup.md' },
  { src: 'health-check.md', dst: 'health-check.md' },
  { src: 'generate-report.md', dst: 'generate-report.md' },
  { src: 'publish-html.md', dst: 'publish-html.md' },
  { src: 'export-bi.md', dst: 'export-bi.md' },
  { src: 'portfolio.md', dst: 'portfolio.md' },
  { src: 'generate-tf.md', dst: 'generate-tf.md' },
  { src: 'tools.md', dst: 'tools.md' },
  { src: 'malware-scanning.md', dst: 'malware-scanning.md' },
  { src: 'assessment-dimension-catalogue.md', dst: 'assessment-dimension-catalogue.md' },
  // README.md -> index.md: VitePress routes directory root from index.md
  { src: 'samples/README.md', dst: 'samples/index.md' },
  { src: 'de/index.md', dst: 'de/index.md' },
  { src: 'de/quick-start.md', dst: 'de/quick-start.md' },
  { src: 'de/how-it-works.md', dst: 'de/how-it-works.md' },
  { src: 'de/features.md', dst: 'de/features.md' },
  { src: 'de/workspace-setup.md', dst: 'de/workspace-setup.md' },
  { src: 'de/health-check.md', dst: 'de/health-check.md' },
  { src: 'de/generate-report.md', dst: 'de/generate-report.md' },
  { src: 'de/publish-html.md', dst: 'de/publish-html.md' },
  { src: 'de/export-bi.md', dst: 'de/export-bi.md' },
  { src: 'de/portfolio.md', dst: 'de/portfolio.md' },
  { src: 'de/generate-tf.md', dst: 'de/generate-tf.md' },
  { src: 'de/tools.md', dst: 'de/tools.md' },
];

// Image extensions to copy alongside the samples markdown.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.webp', '.gif', '.svg']);

const TEMPLATE_FOLDER = {
  src: 'templates/powerbi',
  dst: 'templates',
  filter: (name) => name.endsWith('.md'),
};

const RUNBOOKS_FOLDER = {
  src: 'runbooks',
  dst: 'runbooks',
  filter: (name) => name.endsWith('.md'),
};

const DE_RUNBOOKS_FOLDER = {
  src: 'de/runbooks',
  dst: 'de/runbooks',
  filter: (name) => name.endsWith('.md'),
};

const ASSESSMENT_FOLDER = {
  src: 'assessment',
  dst: 'assessment',
  filter: (name) => name.endsWith('.md'),
};

const DE_ASSESSMENT_FOLDER = {
  src: 'de/assessment',
  dst: 'de/assessment',
  filter: (name) => name.endsWith('.md'),
};

const DE_SAMPLES_FOLDER = {
  src: 'de/samples',
  dst: 'de/samples',
  filter: (name) => name.endsWith('.md'),
};

console.log(`Syncing ${srcRoot} -> ${dstRoot}`);

if (existsSync(dstRoot)) {
  rmSync(dstRoot, { recursive: true, force: true });
}
mkdirSync(dstRoot);

for (const { src, dst } of FILES) {
  const s = join(srcRoot, src);
  const d = join(dstRoot, dst);
  if (!existsSync(s)) {
    console.warn(`[warn] source missing: ${s}`);
    continue;
  }
  mkdirSync(dirname(d), { recursive: true });
  copyFileSync(s, d);
  console.log(`  copied: ${src} -> manual/${dst}`);
}

{
  const s = join(srcRoot, TEMPLATE_FOLDER.src);
  const d = join(dstRoot, TEMPLATE_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!TEMPLATE_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${TEMPLATE_FOLDER.src}/${file} -> manual/${TEMPLATE_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy runbooks from docs/runbooks/ -> manual/runbooks/
{
  const s = join(srcRoot, RUNBOOKS_FOLDER.src);
  const d = join(dstRoot, RUNBOOKS_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!RUNBOOKS_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${RUNBOOKS_FOLDER.src}/${file} -> manual/${RUNBOOKS_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy DE runbooks from docs/de/runbooks/ -> manual/de/runbooks/
{
  const s = join(srcRoot, DE_RUNBOOKS_FOLDER.src);
  const d = join(dstRoot, DE_RUNBOOKS_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!DE_RUNBOOKS_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${DE_RUNBOOKS_FOLDER.src}/${file} -> manual/${DE_RUNBOOKS_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy assessment pages from docs/assessment/ -> manual/assessment/
{
  const s = join(srcRoot, ASSESSMENT_FOLDER.src);
  const d = join(dstRoot, ASSESSMENT_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!ASSESSMENT_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${ASSESSMENT_FOLDER.src}/${file} -> manual/${ASSESSMENT_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy DE assessment stubs from docs/de/assessment/ -> manual/de/assessment/
{
  const s = join(srcRoot, DE_ASSESSMENT_FOLDER.src);
  const d = join(dstRoot, DE_ASSESSMENT_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!DE_ASSESSMENT_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${DE_ASSESSMENT_FOLDER.src}/${file} -> manual/${DE_ASSESSMENT_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy DE samples stub from docs/de/samples/ -> manual/de/samples/
{
  const s = join(srcRoot, DE_SAMPLES_FOLDER.src);
  const d = join(dstRoot, DE_SAMPLES_FOLDER.dst);
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      if (!DE_SAMPLES_FOLDER.filter(file)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: ${DE_SAMPLES_FOLDER.src}/${file} -> manual/${DE_SAMPLES_FOLDER.dst}/${file}`);
    }
  } else {
    console.warn(`[warn] source folder missing: ${s}`);
  }
}

// Copy sample images (PNG/JPG/WEBP) from docs/samples/ -> manual/samples/
{
  const s = join(srcRoot, 'samples');
  const d = join(dstRoot, 'samples');
  if (existsSync(s)) {
    mkdirSync(d, { recursive: true });
    for (const file of readdirSync(s)) {
      const ext = '.' + file.split('.').pop().toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      copyFileSync(join(s, file), join(d, file));
      console.log(`  copied: samples/${file} -> manual/samples/${file}`);
    }
  }
}

console.log('Sync complete.');
