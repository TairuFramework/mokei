import type { Options as UmamiOptions } from '@dipakparmar/docusaurus-plugin-umami'
import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import { themes as prismThemes } from 'prism-react-renderer'

const config: Config = {
  title: 'Mokei',
  tagline: 'TypeScript toolkit for Model Context Protocol servers, clients and hosts',
  favicon: 'img/logo-light.svg',
  url: 'https://mokei.dev',
  baseUrl: '/',
  trailingSlash: true,
  organizationName: 'TairuFramework',
  projectName: 'mokei',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  future: {
    experimental_faster: true,
    v4: true,
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  plugins: [
    [
      'docusaurus-plugin-typedoc',
      {
        tsconfig: './tsconfig.docs.json',
        sidebar: {
          autoConfiguration: false,
        },
      },
    ],
    [
      '@dipakparmar/docusaurus-plugin-umami',
      {
        websiteID: '5cbf58f4-d3eb-4947-8ded-03f8f2979b7a',
        analyticsDomain: 'metrics.tairu.dev',
        dataAutoTrack: true,
        dataDoNotTrack: true,
        dataCache: true,
      } satisfies UmamiOptions,
    ],
    // '@orama/plugin-docusaurus-v3',
  ],
  themeConfig: {
    // Replace with your project's social card
    // image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'Mokei',
      logo: {
        alt: 'Mokei',
        src: 'img/logo-light.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Documentation',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apis',
          position: 'left',
          label: 'APIs',
        },
        { label: 'Roadmap', to: '/roadmap' },
        {
          href: 'https://github.com/TairuFramework/mokei',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/docs/introduction',
            },
            {
              label: 'Quick start',
              to: '/docs/quick-start',
            },
            {
              label: 'CLI',
              to: '/docs/cli',
            },
          ],
        },
        {
          title: 'APIs',
          items: [
            { label: 'Overview', to: '/docs/api' },
            { label: 'MCP server', to: '/docs/api/context-server' },
            { label: 'MCP client', to: '/docs/api/context-client' },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Roadmap',
              to: '/roadmap',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/TairuFramework/mokei',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Mokei.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
}

export default config
