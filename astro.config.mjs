// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import mdx from '@astrojs/mdx';

import { execSync } from 'node:child_process'

function executeGitCommand(command) {
  return execSync(command)
    .toString('utf8')
    .replace(/[\n\r\s]+$/, '');
}

const branch = executeGitCommand('git rev-parse --abbrev-ref HEAD')

const site = branch === 'main' ? 'https://dpi-map.pages.dev' : `https://${branch}.dpi-map.pages.dev`

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()]
  },
  integrations: [mdx()]
});