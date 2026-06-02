const {themes: prismThemes} = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'VOrchestra',
  tagline: 'Local-first orchestration for Python virtual environments.',
  favicon: 'img/vorchestra-mark.svg',
  url: 'https://marquesantero.github.io',
  baseUrl: '/vorchestra/',
  organizationName: 'marquesantero',
  projectName: 'vorchestra',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,
  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    localeConfigs: {
      en: {
        label: 'English',
        htmlLang: 'en-US',
      },
    },
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/marquesantero/vorchestra/edit/main/site/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  plugins: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: 'filename',
        indexDocs: true,
        indexPages: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        language: ['en', 'pt'],
        removeDefaultStopWordFilter: true,
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchResultLimits: 10,
        searchResultContextMaxLength: 90,
        searchBarShortcut: true,
        searchBarShortcutKeymap: 'mod+k',
        searchBarPosition: 'right',
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/vorchestra-mark.svg',
      navbar: {
        title: 'VOrchestra',
        logo: {
          alt: 'VOrchestra',
          src: 'img/vorchestra-mark.svg',
        },
        items: [
          {to: '/docs/intro', label: 'Docs', position: 'left'},
          {to: '/docs/product/overview', label: 'Product', position: 'left'},
          {to: '/docs/reference/architecture', label: 'Architecture', position: 'left'},
          {to: '/docs/reference/troubleshooting', label: 'Troubleshooting', position: 'left'},
          {type: 'search', position: 'right'},
          {
            href: 'https://github.com/marquesantero/vorchestra',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              {label: 'Quick start', to: '/docs/start/quickstart'},
              {label: 'Product workflows', to: '/docs/product/overview'},
              {label: 'Architecture', to: '/docs/reference/architecture'},
              {label: 'Troubleshooting', to: '/docs/reference/troubleshooting'},
            ],
          },
          {
            title: 'Project',
            items: [
              {label: 'GitHub', href: 'https://github.com/marquesantero/vorchestra'},
              {label: 'Issues', href: 'https://github.com/marquesantero/vorchestra/issues'},
              {label: 'Releases', href: 'https://github.com/marquesantero/vorchestra/releases'},
              {label: 'Contributing', to: '/docs/community/contributing'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} VOrchestra contributors. Documentation powered by Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'python', 'rust', 'toml', 'yaml'],
      },
    }),
};

module.exports = config;
