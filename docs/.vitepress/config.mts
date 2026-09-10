import { defineConfig } from 'vitepress';

const base = process.env.DOCS_BASE || '/openai-guardrails-js/';
export default defineConfig({
  title: 'OpenAI Guardrails TypeScript',
  description: 'A TypeScript framework for building safe and reliable AI systems.',
  base,
  outDir: '../site',
  cleanUrls: true,
  appearance: false,
  // Keep MkDocs' directory URLs, including pages outside the sidebar.
  rewrites: (file) =>
    file === 'index.md' || file.endsWith('/index.md') ? file : file.replace(/\.md$/, '/index.md'),
  head: [['link', { rel: 'icon', href: `${base}assets/images/favicon-platform.svg` }]],
  sitemap: { hostname: 'https://openai.github.io/openai-guardrails-js/' },
  markdown: {
    // Match Python Markdown's heading IDs so existing fragment links survive.
    anchor: {
      slugify: (text) =>
        text
          .normalize('NFKD')
          .replace(/\P{ASCII}/gu, '')
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/[\s-]+/g, '-'),
    },
  },
  themeConfig: {
    logo: '/assets/logo.svg',
    siteTitle: 'OpenAI Guardrails',
    search: { provider: 'local' },
    nav: [
      { text: 'Documentation', link: '/quickstart/' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Guardrails Wizard', link: 'https://guardrails.openai.com/' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/openai/openai-guardrails-js' }],
    sidebar: [
      { text: 'Intro', link: '/' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'Documentation',
        items: [
          { text: 'Quickstart', link: '/quickstart/' },
          { text: 'Streaming vs Blocking', link: '/streaming_output/' },
          { text: 'Tripwires', link: '/tripwires/' },
          {
            text: 'Checks',
            items: [
              { text: 'Contains PII', link: '/ref/checks/pii/' },
              { text: 'Custom Prompt Check', link: '/ref/checks/custom_prompt_check/' },
              { text: 'Hallucination Detection', link: '/ref/checks/hallucination_detection/' },
              { text: 'Jailbreak Detection', link: '/ref/checks/jailbreak/' },
              { text: 'Moderation', link: '/ref/checks/moderation/' },
              { text: 'NSFW', link: '/ref/checks/nsfw/' },
              { text: 'Off Topic Prompts', link: '/ref/checks/off_topic_prompts/' },
              {
                text: 'Prompt Injection Detection',
                link: '/ref/checks/prompt_injection_detection/',
              },
              { text: 'URL Filter', link: '/ref/checks/urls/' },
            ],
          },
          { text: 'Evaluation Tool', link: '/evals/' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Types', link: '/ref/types-typescript/' },
          { text: 'Exceptions', link: '/ref/exceptions-typescript/' },
        ],
      },
    ],
  },
});
