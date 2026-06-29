import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SWAO',
  description: 'Sovereign Workload Assessment and Onboarding -- Community Edition',
  base: '/SWAO/',

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
    },
    de: {
      label: 'Deutsch',
      lang: 'de-DE',
      link: '/de/',
    },
  },

  themeConfig: {
    logo: {
      light: '/logo.svg',
      dark: '/logo-icon-dark.png',
    },

    nav: [
      { text: 'Home', link: '/en/' },
      { text: 'Getting Started', link: '/en/getting-started' },
      { text: 'User Guide', link: '/en/workspace-setup' },
      { text: 'Samples', link: '/en/samples/' },
      {
        text: 'Exports',
        items: [
          { text: 'HTML Report', link: '/en/exports/html-report' },
          { text: 'Power BI', link: '/en/exports/powerbi' },
        ],
      },
      { text: 'Frameworks', link: '/en/frameworks/' },
      { text: 'Contributing', link: '/en/contributing' },
    ],

    sidebar: {
      '/en/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Quick start (5 min)', link: '/en/getting-started' },
          ],
        },
        { text: '1. Workspace Setup', link: '/en/workspace-setup' },
        { text: '2. Health Check', link: '/en/health-check' },
        {
          text: '3. Run Assessment',
          link: '/en/assessment/',
          items: [
            { text: 'Application', link: '/en/assessment/application' },
            { text: 'Landing Zone', link: '/en/assessment/landing-zone' },
            { text: 'Audit', link: '/en/assessment/audit' },
            { text: 'LLM', link: '/en/assessment/llm' },
            { text: 'Hybrid', link: '/en/assessment/hybrid' },
          ],
        },
        { text: '4. Generate Report', link: '/en/generate-report' },
        { text: '5. Publish HTML', link: '/en/publish-html' },
        {
          text: '6. Export BI',
          link: '/en/export-bi',
          items: [
            { text: 'Authoring guide -- single-app', link: '/en/exports/powerbi' },
          ],
        },
        { text: '7. Portfolio Operations', link: '/en/portfolio' },
        { text: '8. Generate TF Modules', link: '/en/generate-tf' },
        { text: '9. Tools', link: '/en/tools' },
        {
          text: 'Samples + screenshots',
          items: [
            {
              text: 'Sample gallery',
              link: '/en/samples/',
              items: [
                { text: 'CLI', link: '/en/samples/#cli' },
                { text: 'Power BI reports', link: '/en/samples/#power-bi-reports' },
                { text: 'Terminal interface (TUI)', link: '/en/samples/#terminal-interface-tui' },
                { text: 'MCP connector', link: '/en/samples/#mcp-connector' },
              ],
            },
          ],
        },
      ],

      '/de/': [
        {
          text: 'Benutzerhandbuch',
          items: [
            { text: '1. Workspace Setup', link: '/de/workspace-setup' },
            { text: '2. Health Check', link: '/de/health-check' },
            {
              text: '3. Bewertung durchfuehren',
              link: '/de/assessment/',
              items: [
                { text: 'Anwendung', link: '/de/assessment/application' },
                { text: 'Landing Zone', link: '/de/assessment/landing-zone' },
                { text: 'Audit', link: '/de/assessment/audit' },
                { text: 'LLM', link: '/de/assessment/llm' },
                { text: 'Hybrid', link: '/de/assessment/hybrid' },
              ],
            },
            { text: '4. Bericht erstellen', link: '/de/generate-report' },
            { text: '5. HTML veroeffentlichen', link: '/de/publish-html' },
            { text: '6. BI exportieren', link: '/de/export-bi' },
            { text: '7. Portfolio-Operationen', link: '/de/portfolio' },
            { text: '8. TF-Module generieren', link: '/de/generate-tf' },
            { text: '9. Werkzeuge', link: '/de/tools' },
            {
              text: 'Beispiele + Screenshots',
              items: [
                {
                  text: 'Beispielgalerie',
                  link: '/de/samples/',
                  items: [
                    { text: 'CLI', link: '/de/samples/#cli' },
                    { text: 'Power BI Berichte', link: '/de/samples/#power-bi-reports' },
                    { text: 'Terminal-Oberflaeche (TUI)', link: '/de/samples/#terminal-interface-tui' },
                    { text: 'MCP-Connector', link: '/de/samples/#mcp-connector' },
                  ],
                },
              ],
            },
          ],
        },
        {
          text: 'Erste Schritte',
          items: [
            { text: 'Erste Schritte', link: '/de/erste-schritte' },
          ],
        },
        {
          text: 'Benutzerhandbuch',
          items: [
            { text: 'CLI', link: '/de/referenz/cli' },
            { text: 'TUI', link: '/de/referenz/tui' },
            { text: 'MCP-Server', link: '/de/referenz/mcp' },
            { text: 'Konfiguration', link: '/de/referenz/konfiguration' },
          ],
        },
        {
          text: 'Exporte',
          items: [
            { text: 'HTML-Bericht', link: '/de/exporte/html-bericht' },
            { text: 'Power BI', link: '/de/exporte/powerbi' },
          ],
        },
        {
          text: 'Frameworks',
          items: [
            { text: 'DSGVO', link: '/de/frameworks/dsgvo' },
          ],
        },
        {
          text: 'Mitwirken',
          items: [
            { text: 'Mitwirken', link: '/de/mitwirken' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Accenture/SWAO' },
    ],

    footer: {
      message: 'Released under the <a href="https://github.com/Accenture/SWAO/blob/main/LICENSE" target="_blank">Apache 2.0 Licence</a>.',
      copyright: '&copy; 2026 Accenture. Sovereign Workload Assessment and Onboarding.',
    },

    search: {
      provider: 'local',
    },
  },
})
