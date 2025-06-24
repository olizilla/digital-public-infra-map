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
    "/blog/my-blog/dpi-map-data-for-statistical-analysis": "/blog/dpi-map-data-for-statistical-analysis",
    "/blog/my-blog/dpi-dataset-update-mar-2025": "/blog/dpi-dataset-update-mar-2025"
  }
})
