import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    { type: 'doc', id: 'introduction', label: 'Introduction' },
    { type: 'doc', id: 'quick-start' },
    { type: 'doc', id: 'cli' },
  ],
  apis: [
    { type: 'doc', id: 'api' },
    {
      type: 'category',
      label: 'Context',
      collapsed: false,
      items: [
        'api/context-protocol/index',
        'api/context-rpc/index',
        'api/context-server/index',
        'api/context-client/index',
      ],
    },
    {
      type: 'category',
      label: 'Host',
      collapsed: false,
      items: ['api/host-protocol/index', 'api/host/index', 'api/host-monitor/index'],
    },
  ],
}

export default sidebars
