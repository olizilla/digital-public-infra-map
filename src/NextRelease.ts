// What the next release will hold (D93): the latest release's tables with every changeset waiting in changesets/next/
// replayed onto them, built the way the proposal check builds it (src/BuildRelease.ts, scripts/proposal-check.ts) with the root
// datapackage.json, the next codebook (D71). The editor's pages show this, not the release alone: a value
// that's been accepted and not yet released is the value a new proposal changes, its `# was`, and what a
// system's "Current" says, so a proposal is always about the data as it will be.
//
// This file is the build and what the pages need of it: each system's state, the fields whose next value
// differs from the release's, the evidence for a pending value, and a pending removal's reason. It has no astro:
// imports, so Node can test it; src/EditData.ts reads the changesets and gives it to the pages, once for the build.
import { fieldId, keyField, unreverted } from '../lib/changesets/build.ts'
import type { Baseline, Changeset, DataPackage } from '../lib/changesets/types.ts'
import { buildRelease, dpiTypeOf, tableRecords } from './BuildRelease'

type Row = Record<string, unknown>

export interface NextInput {
  /** the next release's codebook: the root datapackage.json */
  datapackage: DataPackage
  /** the release the site shows: its date, and its tables by resource name, keyed by field name (D83) */
  release: string
  tables: Record<string, Row[]>
  /** the changesets waiting in changesets/next/, by resource */
  changesets: Record<string, Changeset[]>
}

/** The change that last set a field's value while it waits for the next release */
export interface PendingChange {
  changeset: string
  as_of: string
  reason: string
  /** the change's sources that are links */
  sources: string[]
}

/** A system's removal, waiting for the next release: the latest one, if more than one */
export interface Removal {
  changeset: string
  as_of: string
  reason: string
  sources: string[]
  /** the System ID of a system it duplicates or that replaces it */
  duplicate_of?: string
}

/**
 * - `released`: in the release, and in the next one, possibly with other values
 * - `new`: created by a changeset waiting for the next release, so it has no public page until then
 * - `removed`: in the release, and removed by a changeset waiting for the next release
 */
export type State = 'released' | 'new' | 'removed'

export interface Next {
  /** the release it's built on */
  release: string
  /** the next release's rows by resource, keyed by field name as the release's JSON has them, derived fields worked out */
  tables: Record<string, Row[]>
  /** the changesets read, as the build replays them (reverted ones left out) */
  changesets: number
  /** the removed systems' removals, by System ID */
  removals: Map<string, Removal>
  /** for each system, the change that last set each field's value among the changesets waiting for the next release, by System ID and field id */
  latest: Map<string, Map<string, PendingChange>>
}

const links = (urls: string[] = []) => urls.filter(url => URL.canParse(url))

/** Build the next release from the release and its pending changesets, as the proposal check does */
export function nextRelease ({ datapackage, release, tables, changesets }: NextInput): Next {
  const baseline: Baseline = { id: release, tables: tables as Baseline['tables'] }
  const built = buildRelease({ datapackage, baseline, earlierFields: {}, changesets, report: [] })
  const latest = new Map<string, Map<string, PendingChange>>()
  for (const [resource, byKey] of Object.entries(built.history)) {
    if (!(resource in dpiTypeOf)) continue
    for (const [key, cells] of Object.entries(byKey)) {
      for (const [id, entries] of Object.entries(cells)) {
        // the baseline's values are the release's: the change that last set the value is the latest that isn't one of them
        const change = entries.findLast(entry => entry.type !== 'snapshot')
        if (!change) continue
        if (!latest.has(key)) latest.set(key, new Map())
        latest.get(key)!.set(id, { changeset: change.changeset, as_of: change.as_of, reason: change.reason, sources: links(change.sources) })
      }
    }
  }

  // a system that's in the release and not in the next one was removed: by its latest remove, in the build's order
  const now = new Set(Object.values(built.tables).flatMap(table => table.rows.map(row => row[keyOf(datapackage, table.resource.name)])))
  const removals = new Map<string, Removal>()
  for (const [resource, list] of Object.entries(changesets)) {
    const key = keyOf(datapackage, resource)
    const removes = unreverted(list, []).flatMap(c => c.changes.map((change, index) => ({ c, change, index })))
      .filter(({ change }) => change.type === 'remove' && change.key !== undefined)
      .sort((a, b) => (a.change.as_of ?? '').localeCompare(b.change.as_of ?? '') || a.c.id.localeCompare(b.c.id) || a.index - b.index)
    for (const { c, change } of removes) {
      const id = change.key!
      if (now.has(id) || !(tables[resource] ?? []).some(row => row[key] === id)) continue
      removals.set(id, {
        changeset: c.id, as_of: change.as_of ?? '', reason: (change.reason ?? '').trim(), sources: links(change.sources),
        ...(change.duplicate_of ? { duplicate_of: change.duplicate_of } : {})
      })
    }
  }
  return {
    release,
    tables: Object.fromEntries(Object.entries(built.tables).filter(([name]) => name in dpiTypeOf).map(([name, table]) => [name, tableRecords(table)])),
    changesets: Object.values(changesets).flat().length,
    removals,
    latest
  }
}

/** The id of a resource's key field, the System ID's */
const keyOf = (datapackage: DataPackage, resource: string): string => fieldId(keyField(datapackage.resources.find(r => r.name === resource)!))

/** A system's state: in the release, in the next release, or both */
export const stateOf = (released: Row | undefined, next: Row | undefined): State | undefined =>
  next ? (released ? 'released' : 'new') : released ? 'removed' : undefined

/**
 * The fields whose next value differs from the release's, by field id, with the release's value: what a row
 * says under its value, "waiting for the next release (released: …)". Cells are compared as text, as the editor
 * reads them. A new system's fields have none: everything it has is new, and the page says so once.
 */
export function changedFields (released: Row | undefined, next: Row | undefined, fields: string[]): Map<string, string> {
  const changed = new Map<string, string>()
  if (!released || !next) return changed
  for (const id of fields) {
    const was = String(released[id] ?? '')
    if (was !== String(next[id] ?? '')) changed.set(id, was)
  }
  return changed
}

/** One system's edit page, in rows, before they're made systems (src/EditData.ts): what the page is made from */
export interface PageData {
  /** the System ID, and the table it's in */
  id: string
  resource: string
  state: State
  /** the next release's row, or the release's for a system that's to be removed */
  row: Row
  /** the release's row, if it's in the release */
  released?: Row
  /** the fields whose next value differs from the release's, by field id, with the release's value (`changedFields`) */
  changed: Record<string, string>
  /** the change that last set each field's value while it waits for the next release, by field id */
  latest: Record<string, PendingChange>
  /** the removal, for a system that's to be removed */
  removal?: Removal
}

/**
 * The systems that have an edit page: each in the next release, and each in the release that it removes, in the tables' order, then
 * the removed ones. A new system's page is for a system with no page on the map yet, and a removed one's says it's to go (D93).
 */
export function pagesOf (next: Next, released: Record<string, Row[]>, datapackage: DataPackage): PageData[] {
  const pages: PageData[] = []
  const inRelease = new Map<string, Row>()
  for (const [resource, rows] of Object.entries(released)) for (const row of rows) inRelease.set(String(row[keyOf(datapackage, resource)]), row)
  for (const [resource, rows] of Object.entries(next.tables)) {
    const key = keyOf(datapackage, resource)
    for (const row of rows) {
      const id = String(row[key])
      const was = inRelease.get(id)
      pages.push({
        id, resource, state: was ? 'released' : 'new', row, ...(was ? { released: was } : {}),
        changed: Object.fromEntries(changedFields(was, row, Object.keys(row))),
        latest: Object.fromEntries(next.latest.get(id) ?? [])
      })
    }
  }
  for (const [id, removal] of next.removals) {
    const was = inRelease.get(id)
    const resource = Object.keys(released).find(name => released[name].includes(was!))
    if (was && resource) pages.push({ id, resource, state: 'removed', row: was, released: was, changed: {}, latest: {}, removal })
  }
  return pages
}
