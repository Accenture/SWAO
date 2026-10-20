import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Sidebar: ONE definition, rendered for both locales (EN/DE parity, sprint-150).
// Each entry carries the English and German label; links are written without
// a locale prefix and get `/de` prepended for the German sidebar.
// ---------------------------------------------------------------------------

type Entry = { en: string; de: string; link?: string; collapsed?: boolean; items?: Entry[] }

const passes: Entry[] = [
  { en: 'Overview', de: 'Übersicht', link: '/passes/' },
  { en: '00 INGEST: Ingestion', de: '00 INGEST: Ingestion', link: '/passes/00-ingest' },
  { en: '01 INV: Inventory', de: '01 INV: Inventar', link: '/passes/01-inv' },
  { en: '02 STATE: Stateful components', de: '02 STATE: Zustandsbehaftete Komponenten', link: '/passes/02-state' },
  { en: '03 DATA: Data classification', de: '03 DATA: Datenklassifizierung', link: '/passes/03-data' },
  { en: '04 CTX: Context ingestion', de: '04 CTX: Kontextaufnahme', link: '/passes/04-ctx' },
  { en: '05 SBOM: Software bill of materials', de: '05 SBOM: Software-Stückliste', link: '/passes/05-sbom' },
  { en: '06 TF: Infrastructure as code', de: '06 TF: Infrastructure as Code', link: '/passes/06-tf' },
  { en: '07 EGR: Egress', de: '07 EGR: Ausgehende Verbindungen', link: '/passes/07-egr' },
  { en: '08 CRYPTO: Cryptography', de: '08 CRYPTO: Kryptografie', link: '/passes/08-crypto' },
  { en: '09 SYNTH: Migration synthesis', de: '09 SYNTH: Migrationssynthese', link: '/passes/09-synth' },
  { en: '10 DYNAMIC: Dynamic analysis', de: '10 DYNAMIC: Dynamische Analyse', link: '/passes/10-dynamic' },
  { en: '11 COMP: Compliance', de: '11 COMP: Compliance', link: '/passes/11-comp' },
  { en: '12 BLOCKS: Block assessment', de: '12 BLOCKS: Bausteinbewertung', link: '/passes/12-blocks' },
  { en: '13 SCOPE: Scope coverage', de: '13 SCOPE: Scope-Abdeckung', link: '/passes/13-scope' },
  { en: '14 MALWARE: Malware scan', de: '14 MALWARE: Malware-Scan', link: '/passes/14-malware' },
  { en: '23 LZR: Landing zone readiness', de: '23 LZR: Landing-Zone-Eignung', link: '/passes/23-lzr' },
  { en: '24 RESEARCH: Public research', de: '24 RESEARCH: Öffentliche Recherche', link: '/passes/24-research' },
  { en: '25 BINARY: Installer analysis', de: '25 BINARY: Analyse von Installationspaketen', link: '/passes/25-binary' },
]

const frameworks: Entry[] = [
  { en: 'Overview', de: 'Übersicht', link: '/frameworks/' },
  { en: 'AI 10 Pillars', de: 'AI 10 Pillars', link: '/frameworks/ai-10-pillars' },
  { en: 'BSI C5', de: 'BSI C5', link: '/frameworks/bsi-c5' },
  { en: 'BSI IT-Grundschutz 2023', de: 'BSI IT-Grundschutz 2023', link: '/frameworks/bsi-grundschutz-2023' },
  { en: 'COBIT 5', de: 'COBIT 5', link: '/frameworks/cobit-5' },
  { en: 'DORA', de: 'DORA', link: '/frameworks/dora' },
  { en: 'EC Cloud Sovereignty Framework', de: 'EC Cloud Sovereignty Framework', link: '/frameworks/ec-csf' },
  { en: 'EU AI Act', de: 'EU AI Act', link: '/frameworks/eu-ai-act' },
  { en: 'EU Cyber Resilience Act', de: 'EU Cyber Resilience Act', link: '/frameworks/eu-cra' },
  { en: 'EUCS', de: 'EUCS', link: '/frameworks/eucs' },
  { en: 'GDPR', de: 'DSGVO (GDPR)', link: '/frameworks/gdpr' },
  { en: 'ISO/IEC 27001:2022', de: 'ISO/IEC 27001:2022', link: '/frameworks/iso-27001' },
  { en: 'KRITIS-DE', de: 'KRITIS-DE', link: '/frameworks/kritis-de' },
  { en: 'LLM Selection', de: 'LLM-Auswahl', link: '/frameworks/llm-selection' },
  { en: 'NCA CCC (CSP)', de: 'NCA CCC (CSP)', link: '/frameworks/nca-ccc-2-2024-csp' },
  { en: 'NCA CCC (CST)', de: 'NCA CCC (CST)', link: '/frameworks/nca-ccc-2-2024-cst' },
  { en: 'NCA ECC', de: 'NCA ECC', link: '/frameworks/nca-ecc-2-2024' },
  { en: 'NIS2', de: 'NIS2', link: '/frameworks/nis2' },
  { en: 'NIST SP 800-66r2 (HIPAA)', de: 'NIST SP 800-66r2 (HIPAA)', link: '/frameworks/nist-sp-800-66r2-hipaa' },
  { en: 'OpenSSF Scorecard', de: 'OpenSSF Scorecard', link: '/frameworks/openssf-scorecard' },
  { en: 'PCI DSS', de: 'PCI DSS', link: '/frameworks/pci-dss' },
  { en: 'SAMA CSF', de: 'SAMA CSF', link: '/frameworks/sama-csf-v1' },
  { en: 'SecNumCloud', de: 'SecNumCloud', link: '/frameworks/secnumcloud' },
  { en: 'SOC 2', de: 'SOC 2', link: '/frameworks/soc-2' },
  { en: 'SWAO_APM (portfolio)', de: 'SWAO_APM (Portfolio)', link: '/frameworks/swao-apm' },
]

// Task-based grouping (#3364, Design 111 section 3, Iteration 3): Get started,
// Assess, Report, Operate, Reference. The order is also the reading order: the
// doc footer (prev / next) walks the flattened sidebar, so Getting started guide,
// Workspace setup, Health check, the assessment pages, Generate report, Publish
// HTML and Export BI follow each other, and every guide page ends with a
// "Next page" link to the next step. Keep each link exactly once: a duplicate
// breaks the single highlight from Iteration 1 and the prev / next chain.
const lzCatalogues: Entry[] = [
  { en: 'Overview', de: 'Übersicht', link: '/lz-catalogues/' },
  { en: 'Amazon Web Services', de: 'Amazon Web Services', link: '/lz-catalogues/aws' },
  { en: 'AWS European Sovereign Cloud', de: 'AWS European Sovereign Cloud', link: '/lz-catalogues/aws-esc' },
  { en: 'AWS ISOE Europe (classified)', de: 'AWS ISOE Europe (klassifiziert)', link: '/lz-catalogues/aws-iso-e' },
  { en: 'Microsoft Azure', de: 'Microsoft Azure', link: '/lz-catalogues/azure' },
  { en: 'Azure Local', de: 'Azure Local', link: '/lz-catalogues/azure-local' },
  { en: 'Delos Cloud', de: 'Delos Cloud', link: '/lz-catalogues/delos' },
  { en: 'Google Cloud Platform', de: 'Google Cloud Platform', link: '/lz-catalogues/gcp' },
  { en: 'Oracle Cloud Infrastructure', de: 'Oracle Cloud Infrastructure', link: '/lz-catalogues/oci' },
  { en: 'Open Telekom Cloud / T Cloud Public', de: 'Open Telekom Cloud / T Cloud Public', link: '/lz-catalogues/otc' },
  { en: 'STACKIT', de: 'STACKIT', link: '/lz-catalogues/stackit' },
]

const sidebar: Entry[] = [
  {
    en: 'Get started', de: 'Erste Schritte', collapsed: false,
    items: [
      { en: 'Quick start (5 min)', de: 'Schnellstart (5 Min.)', link: '/quick-start' },
      { en: 'How it works', de: 'Wie es funktioniert', link: '/how-it-works' },
      { en: 'Features & Editions', de: 'Funktionen & Editionen', link: '/features' },
      { en: 'Getting started guide', de: 'Leitfaden für den Einstieg', link: '/getting-started' },
      { en: 'Workspace setup', de: 'Workspace-Setup', link: '/workspace-setup' },
      { en: 'Health check', de: 'Health Check', link: '/health-check' },
    ],
  },
  {
    en: 'Assess', de: 'Bewerten', collapsed: false,
    items: [
      { en: 'Run an assessment', de: 'Bewertung durchführen', link: '/assessment/' },
      // Numbered like the TUI assessment type menu.
      { en: '1. Application Assessment', de: '1. Anwendungsbewertung', link: '/assessment/application' },
      {
        en: '2. Service Portfolio Assessment', de: '2. Service-Portfolio-Bewertung', link: '/service-assessment/', collapsed: true,
        items: [
          { en: 'Command reference', de: 'Befehlsreferenz', link: '/service-assessment/commands' },
          { en: 'Column mapping', de: 'Spaltenzuordnung', link: '/service-assessment/column-mapping' },
          { en: 'INFRA-CAT reference', de: 'INFRA-CAT-Referenz', link: '/service-assessment/infra-cat' },
          { en: 'Configuration', de: 'Konfiguration', link: '/service-assessment/configuration' },
          { en: 'Optional API keys', de: 'Optionale API-Schlüssel', link: '/service-assessment/api-keys' },
          { en: 'SWAO_APM framework and TIME', de: 'Rahmenwerk SWAO_APM und TIME', link: '/service-assessment/framework' },
          { en: 'Migration waves', de: 'Migrationswellen', link: '/service-assessment/migration-waves' },
        ],
      },
      { en: '3. Landing Zone Catalog Assessment', de: '3. Landing-Zone-Katalog-Bewertung', link: '/assessment/landing-zone' },
      { en: '4. LLM Assessment', de: '4. LLM-Bewertung', link: '/assessment/llm' },
    ],
  },
  {
    en: 'Report', de: 'Berichten', collapsed: false,
    items: [
      { en: 'Generate report', de: 'Bericht erstellen', link: '/generate-report' },
      { en: 'Publish HTML', de: 'HTML veröffentlichen', link: '/publish-html' },
      { en: 'Export BI', de: 'BI exportieren', link: '/export-bi' },
      {
        en: 'Samples + screenshots', de: 'Beispiele + Screenshots', link: '/samples/', collapsed: true,
        items: [
          { en: 'CLI', de: 'CLI', link: '/samples/#cli' },
          { en: 'Power BI reports', de: 'Power BI Berichte', link: '/samples/#power-bi-reports' },
          { en: 'Terminal interface (TUI)', de: 'Terminal (TUI)', link: '/samples/#terminal-interface-tui' },
          { en: 'MCP connector', de: 'MCP-Konnektor', link: '/samples/#mcp-connector' },
        ],
      },
    ],
  },
  {
    en: 'Operate', de: 'Betreiben', collapsed: false,
    // Runbook groups collapsed by default (#3362, Design 111 Iteration 1).
    items: [
      { en: 'Portfolio operations', de: 'Portfolio-Betrieb', link: '/portfolio' },
      { en: 'Generate TF modules', de: 'TF-Module erstellen', link: '/generate-tf' },
      { en: 'Tools', de: 'Werkzeuge', link: '/tools' },
      {
        en: 'Installation', de: 'Installation', collapsed: true,
        items: [
          { en: 'All platforms (overview)', de: 'Alle Plattformen (Übersicht)', link: '/runbooks/install' },
          { en: 'Windows', de: 'Windows', link: '/runbooks/windows-binary-allowlisting' },
          { en: 'macOS', de: 'macOS', link: '/runbooks/macos-install' },
          { en: 'Linux', de: 'Linux', link: '/runbooks/linux-install' },
          { en: 'Docker', de: 'Docker', link: '/runbooks/docker-deployment' },
        ],
      },
      {
        en: 'Configuration', de: 'Konfiguration', collapsed: true,
        items: [
          { en: 'Workspace config', de: 'Workspace konfigurieren', link: '/runbooks/workspace-config' },
          { en: 'LLM gateway authoring', de: 'LLM-Gateway erstellen', link: '/runbooks/llm-gateway-authoring' },
          { en: 'LLM provider swap', de: 'LLM-Anbieter wechseln', link: '/runbooks/llm-provider-swap' },
          { en: 'Adapting LZ catalogues', de: 'LZ-Kataloge anpassen', link: '/runbooks/adapting-lz-catalogues' },
          { en: 'Licence management', de: 'Lizenzverwaltung', link: '/runbooks/licence-management' },
        ],
      },
      {
        en: 'Integration', de: 'Integration', collapsed: true,
        items: [
          { en: 'MCP server', de: 'MCP-Server', link: '/runbooks/mcp-integration' },
          { en: 'CI/CD pipeline', de: 'CI/CD-Pipeline', link: '/runbooks/cicd-pipeline' },
          { en: 'CI/CD sovereignty gate', de: 'CI/CD-Souveränitäts-Gate', link: '/runbooks/ci-cd-sovereignty-gate' },
        ],
      },
      {
        en: 'Maintenance', de: 'Wartung', collapsed: true,
        items: [
          { en: 'Malware scanning', de: 'Malware-Scan', link: '/malware-scanning' },
          { en: 'Code signing', de: 'Code-Signierung', link: '/runbooks/code-signing' },
          { en: 'Updating SWAO', de: 'SWAO aktualisieren', link: '/runbooks/updating-swao' },
          { en: 'Troubleshooting', de: 'Fehlerbehebung', link: '/runbooks/troubleshooting' },
        ],
      },
    ],
  },
  {
    en: 'Reference', de: 'Referenz', collapsed: false,
    // Every reference group collapsed by default.
    items: [
      { en: 'Analysis passes', de: 'Analyse-Passes', link: '/passes/', collapsed: true, items: passes },
      { en: 'Community frameworks', de: 'Community-Rahmenwerke', link: '/frameworks/', collapsed: true, items: frameworks },
      { en: 'Landing Zone catalogues', de: 'Landing-Zone-Kataloge', link: '/lz-catalogues/', collapsed: true, items: lzCatalogues },
      { en: 'Dimension catalogue', de: 'Dimensionskatalog', link: '/assessment-dimension-catalogue' },
      {
        en: 'CLI and logs', de: 'CLI und Logs', collapsed: true,
        items: [
          { en: 'CLI reference', de: 'CLI-Referenz', link: '/runbooks/cli-reference' },
          { en: 'Health-check output', de: 'Health-Check-Ausgabe', link: '/runbooks/health-check-output' },
          { en: 'Log event reference', de: 'Log-Ereignisse', link: '/runbooks/log-events' },
        ],
      },
    ],
  },
]

type SidebarItem = { text: string; link?: string; collapsed?: boolean; items?: SidebarItem[] }

function render(entries: Entry[], lang: 'en' | 'de'): SidebarItem[] {
  return entries.map((e) => ({
    text: e[lang],
    ...(e.link ? { link: lang === 'de' ? `/de${e.link}` : e.link } : {}),
    ...(e.collapsed !== undefined ? { collapsed: e.collapsed } : {}),
    ...(e.items ? { items: render(e.items, lang) } : {}),
  }))
}

// ---------------------------------------------------------------------------
// Page metadata (#3364, Design 111 section 3, Iteration 3).
// ---------------------------------------------------------------------------

const SITE_URL = 'https://accenture.github.io/SWAO/'
const SITE_TITLE = 'SWAO: Sovereign Workload Assessment and Onboarding'
const SOCIAL_DESCRIPTION = {
  en: 'Audit-grade cloud workload assessments in a single command. No telemetry, no call-home: your data stays on your machine.',
  de: 'Revisionssichere Bewertungen von Cloud-Workloads mit einem einzigen Befehl. Keine Telemetrie, kein Call-Home: Ihre Daten bleiben auf Ihrem Rechner.',
}

// Source file in swao/docs/ for a page in docs-site/manual/ (see sync-content.mjs).
const DOCS_ROOT = fileURLToPath(new URL('../../docs/', import.meta.url))
function sourcePath(relativePath: string): string {
  if (relativePath === 'samples/index.md') return 'samples/README.md'
  if (relativePath.startsWith('templates/')) return relativePath.replace(/^templates\//, 'templates/powerbi/')
  return relativePath
}

// docs-site/manual/ is a gitignored copy, so the VitePress git lookup finds no
// history there. Read the last commit of the source file in swao/docs/ instead.
// Uncommitted files get no date (the footer then hides "Last updated").
// The public site shows real dates only if pages.yml checks out enough history.
// One `git log` for the whole folder (one call per page made the build 4x slower).
let commitTimes: Map<string, number> | undefined
function sourceTimestamp(relativePath: string): number | undefined {
  if (!commitTimes) {
    commitTimes = new Map()
    try {
      const out = execFileSync('git', ['log', '--format=@%ct', '--name-only', '--relative', '--', '.'], {
        cwd: DOCS_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
      })
      let ts = 0
      for (const line of out.split('\n')) {
        if (line.startsWith('@')) ts = Number(line.slice(1)) * 1000
        else if (line && !commitTimes.has(line)) commitTimes.set(line, ts) // newest commit first
      }
    } catch {
      // No git (for example a source archive): no "Last updated" dates.
    }
  }
  return commitTimes.get(sourcePath(relativePath))
}

// Page URL with the base, matching cleanUrls: 'de/assessment/index.md' -> 'de/assessment/'.
function pageUrl(relativePath: string): string {
  return SITE_URL + relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')
}

export default defineConfig({
  title: 'SWAO',
  description: 'Sovereign Workload Assessment and Onboarding: consultant and customer documentation',
  // "Last updated" per page; the date comes from transformPageData below.
  lastUpdated: true,
  transformPageData(pageData) {
    const fm = pageData.frontmatter.lastUpdated
    if (fm === false || fm instanceof Date) return
    const ts = sourceTimestamp(pageData.relativePath)
    return { lastUpdated: ts }
  },
  // Per-page link previews: title and description per page, the card image
  // stays site-wide (head below).
  transformHead({ pageData, title }) {
    const de = pageData.relativePath.startsWith('de/')
    const pageTitle = pageData.title && pageData.frontmatter.layout !== 'home' ? title : SITE_TITLE
    const description = pageData.frontmatter.description || SOCIAL_DESCRIPTION[de ? 'de' : 'en']
    return [
      ['meta', { property: 'og:title', content: pageTitle }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: pageUrl(pageData.relativePath) }],
      ['meta', { property: 'og:locale', content: de ? 'de_DE' : 'en_GB' }],
      ['meta', { name: 'twitter:title', content: pageTitle }],
      ['meta', { name: 'twitter:description', content: description }],
    ]
  },
  // Curated content folder. Source-of-truth files live under
  // swao/docs/, but VitePress reads from a copied subset under
  // docs-site/manual/ to avoid building docs with bare-angle-
  // bracket placeholders that Vue can't parse. Re-sync with
  // `npm run docs:sync` (see below) when source markdown changes.
  srcDir: './manual',
  // Static assets (swao-mark-96.png, favicons, swao-icon-512.png) live in docs-site/public/. With
  // srcDir set, VitePress would look in manual/public/ instead, so the logo and
  // favicon returned 404 on the live site.
  vite: {
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  },
  base: '/SWAO/',
  cleanUrls: true,
  // The brand is designed for dark backgrounds only; no light-mode toggle
  // (#3361, Design 111 section 3, Iteration 4).
  appearance: 'force-dark',
  ignoreDeadLinks: true,
  buildEnd: async (siteConfig) => {
    // GitHub Pages 404 fix: /SWAO/en/ has no static file because English
    // is the root locale. Write a meta-refresh redirect so direct navigation
    // and old bookmarks land on the correct root instead of a 404.
    const { promises: fs } = await import('fs')
    const { join } = await import('path')
    const redirectHtml =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<title>SWAO Documentation</title>' +
      '<meta http-equiv="refresh" content="0; url=/SWAO/">' +
      '<link rel="canonical" href="/SWAO/"></head>' +
      '<body><script>window.location.replace(\'/SWAO/\');</script></body></html>'
    const enDir = join(siteConfig.outDir, 'en')
    await fs.mkdir(enDir, { recursive: true })
    await fs.writeFile(join(enDir, 'index.html'), redirectHtml)
  },
  head: [
    // Favicons scaled from the brand icon (docs/brand/assets/logo-icon-dark.png,
    // mark on black) with Pillow LANCZOS (#3362). Head hrefs need the base.
    ['link', { rel: 'icon', href: '/SWAO/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/SWAO/favicon-32.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/SWAO/favicon-16.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/SWAO/apple-touch-icon.png' }],
    // Link previews (#3362, Design 111 section 3, Iteration 1). The image is
    // the 1280x640 brand social card in docs-site/public/swao-social.png.
    // Title, description and URL are per page (transformHead above, #3364).
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'SWAO Documentation' }],
    ['meta', { property: 'og:image', content: 'https://accenture.github.io/SWAO/swao-social.png' }],
    ['meta', { property: 'og:image:width', content: '1280' }],
    ['meta', { property: 'og:image:height', content: '640' }],
    ['meta', { property: 'og:image:alt', content: 'SWAO logo with the title Sovereign Workload Assessment and Onboarding' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: 'https://accenture.github.io/SWAO/swao-social.png' }],
  ],
  locales: {
    root: {
      label: 'English',
      // en-GB: British date format for "Last updated" (forceLocale below).
      lang: 'en-GB',
    },
    de: {
      label: 'Deutsch',
      lang: 'de',
      link: '/de/',
      themeConfig: {
        nav: [
          { text: 'Schnellstart', link: '/de/quick-start' },
          { text: 'Wie es funktioniert', link: '/de/how-it-works' },
          { text: 'Funktionen', link: '/de/features' },
          { text: 'Beispiele', link: '/de/samples/' },
        ],
        sidebar: { '/de/': render(sidebar, 'de') },
        lastUpdated: { text: 'Zuletzt aktualisiert', formatOptions: { dateStyle: 'long', forceLocale: true } },
        docFooter: { prev: 'Vorherige Seite', next: 'Nächste Seite' },
        outline: { label: 'Auf dieser Seite' },
        sidebarMenuLabel: 'Menü',
        returnToTopLabel: 'Zurück nach oben',
        langMenuLabel: 'Sprache wählen',
      },
    },
  },
  themeConfig: {
    // Transparent 96x96 brand mark (#3364); logo.svg stays in public/.
    logo: '/swao-mark-96.png',
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'How it works', link: '/how-it-works' },
      { text: 'Features', link: '/features' },
      { text: 'Samples', link: '/samples/' },
    ],
    sidebar: { '/': render(sidebar, 'en') },
    // No editLink: the public repo accepts no pull requests (Design 111, Iteration 3).
    lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'long', forceLocale: true } },
    docFooter: { prev: 'Previous page', next: 'Next page' },
    // Local search, one index per locale (#3364). The index is loaded only
    // when the search dialog opens.
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        miniSearch: {
          searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 4, text: 2, titles: 1 } },
        },
        locales: {
          de: {
            translations: {
              button: { buttonText: 'Suchen', buttonAriaLabel: 'Suchen' },
              modal: {
                displayDetails: 'Detailansicht anzeigen',
                resetButtonTitle: 'Suche zurücksetzen',
                backButtonTitle: 'Suche schließen',
                noResultsText: 'Keine Ergebnisse für',
                footer: {
                  selectText: 'auswählen',
                  selectKeyAriaLabel: 'Eingabetaste',
                  navigateText: 'navigieren',
                  navigateUpKeyAriaLabel: 'Pfeil nach oben',
                  navigateDownKeyAriaLabel: 'Pfeil nach unten',
                  closeText: 'schließen',
                  closeKeyAriaLabel: 'Escape',
                },
              },
            },
          },
        },
      },
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Accenture/SWAO' },
    ],
    footer: {
      message: 'Released under the <a href="https://github.com/Accenture/SWAO/blob/main/LICENSE" target="_blank">Apache 2.0 Licence</a>. &nbsp;|&nbsp; <a href="https://github.com/Accenture/SWAO/discussions" target="_blank">Community</a> &nbsp;|&nbsp; <a href="https://github.com/Accenture/SWAO/issues" target="_blank">Report an issue</a>',
      copyright: '&copy; 2026 Accenture. Sovereign Workload Assessment and Onboarding.',
    },
  },
})
