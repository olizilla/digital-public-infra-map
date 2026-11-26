// What the editor's pages are made from (D91, D93): the next release, the release the site shows with every changeset waiting
// in changesets/next/ replayed onto it, built once for the site, as the proposal check builds it (src/NextRelease.ts).
// - the edit pages, /<id>/edit/: a page for each system in the next release, and for one waiting to be removed from it
// - the index, for /edit/ and /edit/new/<table>/: the places, and the next release's systems, so a system that's been
//   proposed and not released yet can be found and counts towards the next System ID
// The public pages stay on the release.
import { getCollection } from 'astro:content'
import rootPackage from '../datapackage.json'
import type { Changeset, DataPackage } from '../lib/changesets/types.ts'
import { places, placeAliases } from './Places'
import { dpiTypes, systems, systemsOf, type System } from './Systems'
import { resourceNames } from './Schema'
import { release, releaseTables } from './ReleaseFiles'
import { nameOf, presence } from './DpiTest'
import { nextRelease, pagesOf, type PendingChange, type Removal, type State } from './NextRelease'
import { buildIndex, usedIds, type EditIndex, type Kind } from './EditIndex'

const kinds = { named: 0, unnamed: 1, 'not-found': 2 } as const satisfies Record<string, Kind>

// every release's tables, from the first that has System IDs (src/Release.ts baselineRelease)
const tables = import.meta.glob<{ default: { system_id?: string }[] }>('../public/data/*/*-{identity,payment,exchange}.json')
const firstWithIds = '2026-03-31'

/** The changesets waiting for the next release, by resource, as the build reads them (reverted ones are left to it) */
async function pendingChangesets () {
  const byResource: Record<string, Changeset[]> = {}
  for (const { data } of await getCollection('changesets', entry => entry.data.status === 'pending')) {
    (byResource[data.resource] ??= []).push({
      id: data.changeset, resource: data.resource, folder: 'next', path: '',
      ...(data.author !== undefined ? { author: data.author } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      changes: data.changes as unknown as Changeset['changes']
    })
  }
  for (const list of Object.values(byResource)) list.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return byResource
}

/** A system's edit page: its next release's system, how it stands against the release, and what waits for it */
export interface EditPage {
  /** the next release's system, or the release's if it's waiting to be removed */
  system: System
  state: State
  /** the fields whose next value differs from the release's, by field id, with the release's value */
  changed: Record<string, string>
  /** the change that last set each field's value while it waits for the next release, by field id */
  latest: Record<string, PendingChange>
  /** a pending removal, for a system to be removed */
  removal?: Removal
}

let next: Promise<EditPage[]> | undefined

/** The next release's systems and the edit pages, built once for the site */
export function loadNext () {
  next ??= (async () => {
    const built = nextRelease({
      datapackage: rootPackage as unknown as DataPackage,
      release,
      tables: releaseTables,
      changesets: await pendingChangesets()
    })
    // a system's row as the site's system, by the type its table is
    const typeOf = Object.fromEntries(dpiTypes.map(dpiType => [resourceNames[dpiType], dpiType]))
    return pagesOf(built, releaseTables, rootPackage as unknown as DataPackage).map(({ id, resource, state, row, changed, latest, removal }): EditPage => {
      const system = systemsOf(typeOf[resource], [row])[0]
      if (system.id !== id) throw new Error(`${id}'s row has the System ID ${system.id}`)
      return { system, state, changed, latest, ...(removal ? { removal } : {}) }
    })
  })()
  return next
}

let index: Promise<EditIndex> | undefined

/** The index, made once for the build */
export function loadEditIndex (): Promise<EditIndex> {
  index ??= (async () => {
    const released = new Set(systems.map(system => system.id))
    const rows = (await loadNext()).filter(page => page.state !== 'removed').map(({ system }) => ({
      id: system.id,
      name: nameOf(system.dpiType, system.record) ?? '',
      country: system.country,
      kind: kinds[presence(system.dpiType, system.record)],
      pending: !released.has(system.id)
    }))
    // System IDs are never reused (D82): those of every release and of every change in every changeset, released or pending
    const inReleases = (await Promise.all(Object.entries(tables).filter(([path]) => path.split('/')[3] >= firstWithIds).map(async ([, load]) => (await load()).default)))
      .flatMap(table => table.flatMap(row => row.system_id ? [row.system_id] : []))
    const changes = (await getCollection('changesets')).flatMap(entry => entry.data.changes as { key?: unknown }[])
    return buildIndex({ places, names: placeAliases, rows, used: usedIds(changes, inReleases) })
  })()
  return index
}
