// Let a Node script import the site's modules in src/, which are written for
// Vite: relative imports without extensions, JSON without import attributes,
// and `?raw` for a file's text. Import this before any of them, so the build
// uses the same code as the site, like the DPI test in src/DpiTest.ts.

import fs from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const extensions = ['.ts', '.js', '.mjs', '/index.ts', '/index.js']

registerHooks({
  resolve (specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (!relative || !context.parentURL?.startsWith('file:') || context.parentURL.includes('/node_modules/')) return nextResolve(specifier, context)
    const [file, query] = specifier.split('?')
    if (query === 'raw') return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
    if (!fs.existsSync(new URL(file, context.parentURL))) {
      const found = extensions.map(ext => new URL(file + ext, context.parentURL)).find(candidate => fs.existsSync(candidate))
      if (found) return { url: found.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load (url, context, nextLoad) {
    const [file, query] = url.split('?')
    const text = () => fs.readFileSync(fileURLToPath(file), 'utf8')
    if (query === 'raw') return { format: 'module', source: `export default ${JSON.stringify(text())}`, shortCircuit: true }
    const imported = url.startsWith('file:') && !url.includes('/node_modules/') && !context.conditions?.includes('require')
    if (imported && file.endsWith('.json') && context.importAttributes?.type !== 'json') {
      return { format: 'module', source: `export default ${text()}`, shortCircuit: true }
    }
    return nextLoad(url, context)
  }
})
