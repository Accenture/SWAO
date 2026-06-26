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
      {
        text: 'User Guide',
        items: [
          { text: 'CLI Reference', link: '/en/reference/cli' },
          { text: 'TUI', link: '/en/reference/tui' },
          { text: 'MCP Server', link: '/en/reference/mcp' },
          { text: 'Configuration', link: '/en/reference/configuration' },
        ],
      },
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
          text: 'Getting Started',
          items: [
            { text: 'Getting Started', link: '/en/getting-started' },
          ],
        },
        {
          text: 'User Guide',
          items: [
            { text: 'CLI Reference', link: '/en/reference/cli' },
            { text: 'TUI', link: '/en/reference/tui' },
            { text: 'MCP Server', link: '/en/reference/mcp' },
            { text: 'Configuration', link: '/en/reference/configuration' },
          ],
        },
        {
          text: 'Exports',
          items: [
            { text: 'HTML Report', link: '/en/exports/html-report' },
            { text: 'Power BI', link: '/en/exports/powerbi' },
          ],
        },
        {
          text: 'Frameworks',
          items: [
            { text: 'All Frameworks', link: '/en/frameworks/' },
            { text: 'GDPR', link: '/en/frameworks/gdpr' },
            { text: 'HIPAA', link: '/en/frameworks/hipaa' },
            { text: 'AI 10 Pillars', link: '/en/frameworks/ai-10-pillars' },
            { text: 'COBIT 5', link: '/en/frameworks/cobit5' },
            { text: 'NIST SP 800-66 R2', link: '/en/frameworks/nist-sp-800-66r2' },
          ],
        },
        {
          text: 'Contributing',
          items: [
            { text: 'Contributing', link: '/en/contributing' },
          ],
        },
      ],

      '/de/': [
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
      message: 'SWAO is an Accenture open-source project.',
      copyright: 'Apache 2.0 -- Copyright 2026 Accenture',
    },

    search: {
      provider: 'local',
    },
  },
})
