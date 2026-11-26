// A stand-in for `astro:content`, so a test can import the site's modules that read the changesets
// collection (src/Release.ts, and through it src/Systems.ts). getCollection('changesets') reads the log as the
// loader does (src/ChangesetLoader.ts): every released changeset, with its release's folder. Import it before them.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks } from 'node:module'
import { readFolders, releaseFolders } from '../../lib/changesets/log.ts'
import datapackage from '../../datapackage.json' with { type: 'json' }
import type { DataPackage } from '../../lib/changesets/types.ts'

registerHooks({
  resolve (specifier, context, nextResolve) {
    if (specifier === 'astro:content') return { url: import.meta.url, shortCircuit: true }
    return nextResolve(specifier, context)
  }
})

const log = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../changesets')

export async function getCollection (name: string, filter: (entry: { data: any }) => boolean = () => true) {
  if (name !== 'changesets') throw new Error(`The test's astro:content only has changesets, not ${name}`)
  const entries = releaseFolders(log).flatMap(folder =>
    Object.values(readFolders(log, [folder], datapackage as DataPackage, [])).flat().map(c => ({
      id: `${folder}/${c.resource}/${c.id}`,
      data: { changeset: c.id, resource: c.resource, status: 'released', release: folder, author: c.author, summary: c.summary, changes: c.changes }
    })))
  return entries.filter(filter)
}
