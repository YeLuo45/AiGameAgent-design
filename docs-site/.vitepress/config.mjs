import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AiGameAgent Design',
  description: 'Design documentation for AiGameAgent (aiGameGongfang Studio) — multi-platform mini-game workflow with department-based AI agents.',
  base: '/AiGameAgent-design/',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Tech Stack', link: '/tech-stack' },
      { text: 'Docs', link: '/docs/01-studio-server' }
    ],
    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Tech Stack', link: '/tech-stack' }
        ]
      },
      {
        text: 'Core Modules',
        items: [
          { text: 'Studio Server', link: '/docs/01-studio-server' },
          { text: 'Studio Web (Isometric Office)', link: '/docs/02-studio-web' },
          { text: 'Shared Events Bus', link: '/docs/03-events-bus' },
          { text: 'Agent Roster & Departments', link: '/docs/04-agents-and-departments' }
        ]
      },
      {
        text: 'Workflows',
        items: [
          { text: 'OpenSpec Change Control', link: '/docs/05-openspec' },
          { text: 'Meeting Room & Project Charter', link: '/docs/06-meeting-and-charter' },
          { text: 'Monitor & HTML Preview', link: '/docs/07-monitor-and-preview' },
          { text: 'Asset Pipeline', link: '/docs/08-asset-pipeline' }
        ]
      },
      {
        text: 'Operations',
        items: [
          { text: 'Finance & Model Routing', link: '/docs/09-finance-and-routing' },
          { text: 'Local LLM Integration', link: '/docs/10-local-llm' },
          { text: 'H5 & Mini-Game Platforms', link: '/docs/11-minigame-platforms' },
          { text: 'Hooks, Rules & Skills', link: '/docs/12-hooks-rules-skills' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Open API Reference', link: '/docs/13-api-reference' },
          { text: 'Deployment', link: '/docs/14-deployment' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/YeLuo45/AiGameAgent-design' }
    ],
    footer: {
      message: 'Released under MIT License.',
      copyright: 'Copyright © 2026 AiGameAgent Design'
    }
  }
})
