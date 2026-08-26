import { defineConfig } from 'vitepress'

const deRunbooksSidebar = {
  text: 'Runbooks',
  items: [
    {
      text: 'Installation',
      items: [
        { text: 'Windows', link: '/de/runbooks/windows-binary-allowlisting' },
        { text: 'macOS', link: '/de/runbooks/macos-install' },
        { text: 'Linux', link: '/de/runbooks/linux-install' },
        { text: 'Docker', link: '/de/runbooks/docker-deployment' },
      ],
    },
    {
      text: 'Konfiguration',
      items: [
        { text: 'LLM-Anbieter wechseln', link: '/de/runbooks/llm-provider-swap' },
        { text: 'Lizenzverwaltung', link: '/de/runbooks/licence-management' },
        { text: 'Workspace konfigurieren', link: '/de/runbooks/workspace-config' },
      ],
    },
    {
      text: 'Integration',
      items: [
        { text: 'MCP-Server', link: '/de/runbooks/mcp-integration' },
        { text: 'CI/CD-Pipeline', link: '/de/runbooks/cicd-pipeline' },
      ],
    },
    {
      text: 'Betrieb',
      items: [
        { text: 'CLI-Referenz', link: '/de/runbooks/cli-reference' },
        { text: 'Doctor-Ausgabe', link: '/de/runbooks/doctor-output' },
        { text: 'SWAO aktualisieren', link: '/de/runbooks/updating-swao' },
        { text: 'Fehlerbehebung', link: '/de/runbooks/troubleshooting' },
      ],
    },
  ],
}

const deSidebar = {
  '/de/': [
    {
      text: 'Erste Schritte',
      items: [
        { text: 'Schnellstart (5 Min.)', link: '/de/quick-start' },
        { text: 'Wie es funktioniert', link: '/de/how-it-works' },
        { text: 'Funktionen & Editionen', link: '/de/features' },
      ],
    },
    {
      text: 'Hauptfunktionen',
      items: [
        { text: 'Anwendungsbewertung', link: '/de/how-it-works#die-bewertungs-pipeline' },
        { text: 'HTML-Veröffentlichung', link: '/de/how-it-works#die-html-veroffentlichung' },
        { text: 'MCP-Integration', link: '/de/how-it-works#mcp-integration' },
        { text: 'PowerBI-Dashboards', link: '/de/how-it-works#powerbi-dashboards' },
      ],
    },
    {
      text: 'PowerBI-Vorlagen',
      items: [
        { text: 'Autorenleitfaden -- Einzelanwendung', link: '/templates/AUTHORING-GUIDE' },
        { text: 'Autorenleitfaden -- Portfolio', link: '/templates/AUTHORING-GUIDE-PORTFOLIO' },
        { text: 'Abfragen parametrisieren', link: '/templates/PARAMETERISE-PBIT-QUERIES' },
        { text: 'Aktualisierungs-Runbook', link: '/templates/REFRESH-RUNBOOK' },
        { text: 'CHANGELOG', link: '/templates/CHANGELOG' },
      ],
    },
    {
      text: 'Beispiele + Screenshots',
      items: [
        { text: 'Beispielgalerie', link: '/samples/' },
      ],
    },
    deRunbooksSidebar,
  ],
}

export default defineConfig({
  title: 'SWAO',
  description: 'Sovereign Workload Assessment and Onboarding -- consultant + customer documentation',
  // Curated content folder. Source-of-truth files live under
  // swao/docs/, but VitePress reads from a copied subset under
  // docs-site/manual/ to avoid building docs with bare-angle-
  // bracket placeholders that Vue can't parse. Re-sync with
  // `npm run docs:sync` (see below) when source markdown changes.
  srcDir: './manual',
  base: '/SWAO/',
  cleanUrls: true,
  appearance: 'dark',
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en',
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
          { text: 'Autorenleitfaden', link: '/templates/AUTHORING-GUIDE' },
          { text: 'Beispiele', link: '/samples/' },
        ],
        sidebar: deSidebar,
      },
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'How it works', link: '/how-it-works' },
      { text: 'Features', link: '/features' },
      { text: 'Authoring', link: '/templates/AUTHORING-GUIDE' },
      { text: 'Samples', link: '/samples/' },
    ],
    sidebar: {
      '/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Quick start (5 min)', link: '/quick-start' },
            { text: 'How it works', link: '/how-it-works' },
            { text: 'Features & Editions', link: '/features' },
          ],
        },
        {
          text: '1. Workspace Setup',
          link: '/workspace-setup',
        },
        {
          text: '2. Health Check',
          link: '/health-check',
        },
        {
          text: '3. Run Assessment',
          link: '/assessment/',
          items: [
            { text: 'Application', link: '/assessment/application' },
            { text: 'Landing Zone', link: '/assessment/landing-zone' },
            { text: 'LLM', link: '/assessment/llm' },
          ],
        },
        {
          text: '4. Generate Report',
          link: '/generate-report',
        },
        {
          text: '5. Publish HTML',
          link: '/publish-html',
        },
        {
          text: '6. Export BI',
          link: '/export-bi',
          items: [
            { text: 'Authoring guide -- single-app', link: '/templates/AUTHORING-GUIDE' },
            { text: 'Authoring guide -- portfolio', link: '/templates/AUTHORING-GUIDE-PORTFOLIO' },
            { text: 'Parameterise queries', link: '/templates/PARAMETERISE-PBIT-QUERIES' },
            { text: 'Refresh runbook', link: '/templates/REFRESH-RUNBOOK' },
          ],
        },
        {
          text: '7. Portfolio Operations',
          link: '/portfolio',
        },
        {
          text: '8. Generate TF Modules',
          link: '/generate-tf',
        },
        {
          text: '9. Tools',
          link: '/tools',
        },
        {
          text: 'Samples + screenshots',
          items: [
            {
              text: 'Sample gallery',
              link: '/samples/',
              items: [
                { text: 'CLI', link: '/samples/#cli' },
                { text: 'Power BI reports', link: '/samples/#power-bi-reports' },
                { text: 'Terminal interface (TUI)', link: '/samples/#terminal-interface-tui' },
                { text: 'MCP connector', link: '/samples/#mcp-connector' },
              ],
            },
          ],
        },
        {
          text: 'Runbooks',
          items: [
            {
              text: 'Installation',
              items: [
                { text: 'Windows', link: '/runbooks/windows-binary-allowlisting' },
                { text: 'macOS', link: '/runbooks/macos-install' },
                { text: 'Linux', link: '/runbooks/linux-install' },
                { text: 'Docker', link: '/runbooks/docker-deployment' },
              ],
            },
            {
              text: 'Configuration',
              items: [
                { text: 'LLM provider swap', link: '/runbooks/llm-provider-swap' },
                { text: 'Licence management', link: '/runbooks/licence-management' },
                { text: 'Workspace config', link: '/runbooks/workspace-config' },
              ],
            },
            {
              text: 'Integration',
              items: [
                { text: 'MCP server', link: '/runbooks/mcp-integration' },
                { text: 'CI/CD pipeline', link: '/runbooks/cicd-pipeline' },
              ],
            },
            {
              text: 'Operations',
              items: [
                { text: 'CLI reference', link: '/runbooks/cli-reference' },
                { text: 'Doctor output', link: '/runbooks/doctor-output' },
                { text: 'Updating SWAO', link: '/runbooks/updating-swao' },
                { text: 'Troubleshooting', link: '/runbooks/troubleshooting' },
              ],
            },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Accenture/SWAO' },
    ],
    footer: {
      message: 'Released under the <a href="https://github.com/Accenture/SWAO/blob/main/LICENSE" target="_blank">Apache 2.0 Licence</a>. &nbsp;|&nbsp; <a href="https://github.com/Accenture/SWAO/discussions" target="_blank">Community</a> &nbsp;|&nbsp; <a href="https://github.com/Accenture/SWAO/issues" target="_blank">Report an issue</a>',
      copyright: '&copy; 2026 Accenture. Sovereign Workload Assessment and Onboarding.',
    },
  },
})
