// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import mdx from '@astrojs/mdx';

const site = process.env.CF_PAGES_URL ?? 'https://dpi-map.pages.dev'

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [mdx()],
  redirects: {
    "/blog/my-blog/[...slug]": "/blog/[...slug]"
  }
})
