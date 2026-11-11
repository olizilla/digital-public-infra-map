// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

import fs from 'node:fs';

// /changes/ and /changes/<type>/ go to the latest release's changelog (D81). data:build writes the
// redirects into public/_redirects, which Cloudflare Pages serves as 302s; the same lines here make
// them work in astro dev, and give a build a page that redirects too.
const changelogRedirects = Object.fromEntries(fs.readFileSync(new URL('./public/_redirects', import.meta.url), 'utf8')
  .split('\n')
  .map(line => line.trim().split(/\s+/))
  .filter(([from, to, status]) => /^\/changes(\/[a-z-]+)?$/.test(from ?? '') && to && status)
  .map(([from, to, status]) => [from, { status: Number(status), destination: to }]));

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
      // unlinked or internal for now: the editor, and the payment analysis scratch pages. And the
      // pending changes, /changes/ and /changes/<type>/, which aren't published (D81); a release's
      // changelog, /changes/<date>/…, is fixed, so it's in.
      filter: (page) => {
        const { pathname } = new URL(page)
        return !/\/(edit|pay-diff|pay-test|share-previews)(\/|$)/.test(pathname) && !/^\/changes\/(?![0-9]{4}-[0-9]{2}-[0-9]{2}\/)/.test(pathname)
      }
    })
  ],
  redirects: {
    ...changelogRedirects,
    "/blog/my-blog/dpi-map-data-for-statistical-analysis": "/blog/dpi-map-data-for-statistical-analysis",
    "/blog/my-blog/dpi-dataset-update-mar-2025": "/blog/dpi-dataset-update-mar-2025"
  }
})
