/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Start',
      items: ['start/installation', 'start/quickstart', 'start/first-run', 'start/requirements', 'start/build-from-source'],
    },
    {
      type: 'category',
      label: 'Product',
      items: [
        'product/overview',
        'product/workflows',
        'product/screenshots',
        'product/workspaces',
        'product/environment-creation',
        'product/project-board',
        'product/package-studio',
        'product/package-sources',
        'product/health-repair',
        'product/diagnostics-security',
        'product/disk-cleanup',
        'product/project-tools',
        'product/managers',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/architecture', 'reference/c4-model', 'reference/commands', 'reference/background-jobs', 'reference/troubleshooting', 'reference/faq'],
    },
    {
      type: 'category',
      label: 'Community',
      items: ['community/contributing', 'community/roadmap', 'community/release'],
    },
  ],
};

module.exports = sidebars;
