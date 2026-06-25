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
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/en/' },
      { text: 'Getting Started', link: '/en/getting-started' },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/en/reference/cli' },
          { text: 'Configuration', link: '/en/reference/configuration' },
        ],
      },
      { text: 'Frameworks', link: '/en/frameworks/gdpr' },
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
          text: 'Reference',
          items: [
            { text: 'CLI Reference', link: '/en/reference/cli' },
            { text: 'Configuration', link: '/en/reference/configuration' },
          ],
        },
        {
          text: 'Frameworks',
          items: [
            { text: 'GDPR', link: '/en/frameworks/gdpr' },
            { text: 'HIPAA', link: '/en/frameworks/hipaa' },
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
          text: 'Referenz',
          items: [
            { text: 'CLI', link: '/de/referenz/cli' },
            { text: 'Konfiguration', link: '/de/referenz/konfiguration' },
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
      copyright: 'Apache 2.0 -- Copyright 2025 Accenture',
    },

    search: {
      provider: 'local',
    },
  },
})
