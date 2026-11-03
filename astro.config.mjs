// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import mdx from '@astrojs/mdx';

import { records } from './src/Records';
import { checkDpiCounts } from './src/DpiTest';

/**
 * Fail the build if any system's 'Count for DPI' disagrees with the DPI test in src/DpiTest.ts.
 * @type {import('astro').AstroIntegration}
 */
const dpiCountCheck = {
  name: 'dpi-count-check',
  hooks: {
    'astro:build:start': () => {
      const problems = checkDpiCounts(records)
      if (problems.length) {
        throw new Error(`${problems.length} systems' Count for DPI disagrees with the DPI test:\n${problems.join('\n')}`)
      }
    },
    'astro:server:setup': ({ logger }) => {
      for (const problem of checkDpiCounts(records)) logger.warn(`Count for DPI disagrees with the DPI test: ${problem}`)
    }
  }
}

const site = process.env.CF_PAGES_URL ?? 'https://dpi-map.pages.dev'

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [mdx(), dpiCountCheck],
  redirects: {
    "/blog/my-blog/dpi-map-data-for-statistical-analysis": "/blog/dpi-map-data-for-statistical-analysis",
    "/blog/my-blog/dpi-dataset-update-mar-2025": "/blog/dpi-dataset-update-mar-2025"
  }
})
