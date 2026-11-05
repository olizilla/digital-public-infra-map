// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

// Production (the main branch, or a local build with no Cloudflare variables) is the custom domain.
// Preview deploys keep their own URL, so their canonical, OG and feed links resolve.
const { CF_PAGES_BRANCH, CF_PAGES_URL } = process.env
const isProduction = !CF_PAGES_BRANCH || CF_PAGES_BRANCH === 'main'
const site = isProduction ? 'https://dpimap.org' : (CF_PAGES_URL ?? 'https://dpi-map.pages.dev')

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [
    mdx(),
    sitemap({
      // unlinked or internal for now: the changelog, the editor, and the payment analysis scratch pages
      filter: (page) => !/\/(changes|edit|pay-diff|pay-test)(\/|$)/.test(new URL(page).pathname)
    })
  ],
  redirects: {
    "/blog/my-blog/dpi-map-data-for-statistical-analysis": "/blog/dpi-map-data-for-statistical-analysis",
    "/blog/my-blog/dpi-dataset-update-mar-2025": "/blog/dpi-dataset-update-mar-2025"
  }
})
