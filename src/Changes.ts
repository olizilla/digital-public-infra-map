// The changes in the current release (src/Release.ts), for the changelog pages, /changes/ and
// /changes/<type>/ (src/pages/changes/). They're the changesets in the changesets collection
// (src/content.config.ts) released with this release, plus the pending ones in changesets/next/,
// applied to the previous release's rows. Within the round, a cell's changes apply in the data
// build's order (lib/changesets/build.ts): by as_of, then changeset id, then place in the
// changeset, all on top of the previous release. So each change's old value is the previous
// release's, or that of the change before it. The DPI status before is the DPI test's on the
// previous release's row. The codebook's changes are the previous release's datapackage.json
// against this one's, by src/CodebookChanges.ts.
import slug from 'slug'
import { getCollection } from 'astro:content'
import { unreverted } from '../lib/changesets/build.ts'
import type { Changeset } from '../lib/changesets/types.ts'
import { schemas, labelOf, resourceNames, toRecord, type DPIType, type Field } from './Schema'
import { dpiStatus, dpiTest, nameOf, nouns, statusOf, type DpiStatus } from './DpiTest'
import { normaliseImplementationStatus } from './Status'
import { derivedFields } from './DpiLayer'
import { isRegion, placeNamed } from './Places'
import { pages } from './Records'
import { systems, type System } from './Systems'
import { laneAnchors } from './CountryPage'
import { changesetUrl } from './SystemPage'
import { release } from './Release'
import { releasePackage } from './ReleaseFiles'
import { codebookChanges, type Package, type ResourceChanges } from './CodebookChanges'

// The release folders' JSON files, by path, loaded only when needed
const releaseFiles = import.meta.glob<{ default: any }>('../public/data/*/*.json')
const fileOf = (folder: string, file: string) => `../public/data/${folder}/${file}`
const load = async (path: string) => (await releaseFiles[path]()).default
/** A release folder's name, its date, as RELEASE_FOLDER in lib/changesets/log.ts */
const releaseFolder = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * The release before this one, whose rows the changes apply to: the latest release folder before
 * src/Release.ts's with JSON for every table, as `npm run data:build` finds it.
 */
export const previousRelease = [...new Set(Object.keys(releaseFiles).map(path => path.split('/')[3]))]
  .filter(folder => releaseFolder.test(folder) && folder < release)
  .sort()
  .filter(folder => Object.values(resourceNames).every(name => fileOf(folder, `${folder}-${name}.json`) in releaseFiles))
  .at(-1)!
if (!previousRelease) throw new Error(`No release folder before ${release} in public/data/ has JSON for every table`)
const previousRows = Object.fromEntries(await Promise.all((Object.keys(resourceNames) as DPIType[])
  .map(async dpiType => [dpiType, await load(fileOf(previousRelease, `${previousRelease}-${resourceNames[dpiType]}.json`))]))) as Record<DPIType, Record<string, any>[]>

/**
 * What changed in the codebook since the previous release, by resource: its datapackage.json against
 * this release's (D71). Undefined if the previous release has no datapackage.json.
 */
const previousPackagePath = fileOf(previousRelease, 'datapackage.json')
export const codebookChangesByResource = previousPackagePath in releaseFiles
  ? codebookChanges(await load(previousPackagePath) as Package, releasePackage as unknown as Package)
  : undefined

/** The codebook's changes for a DPI type, or undefined if there's no previous codebook to compare with */
export const codebookChangesOf = (dpiType: DPIType) => codebookChangesByResource?.[resourceNames[dpiType]]

/** How each type's page names the type, as in "Payments: changes in the 6 Nov 2026 release" */
export const changeTitles: Record<DPIType, string> = { id: 'Digital ID', pay: 'Payments', data: 'Data exchange' }

/** Each type's page: /changes/<lane anchor>/, so the slugs match the country page's lanes */
export const changesHref = (dpiType: DPIType) => `/changes/${laneAnchors[dpiType]}/`

/** The release's date, like "6 Nov 2026" */
export const releaseDate = new Date(`${release}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Whether the release is still to come: the build is before its date. Pending changes are always to come. */
export const upcoming = new Date().toISOString().slice(0, 10) < release

/** The kinds of change the page filters by, in chip order. `dpi` is a system's, the rest a change's. */
export const kinds = ['dpi', 'new', 'removed', 'renamed', 'values', 'sources', 'wording'] as const
export type Kind = typeof kinds[number]
export type ChangeKind = Exclude<Kind, 'dpi'>
export const kindLabels: Record<Kind, string> = {
  dpi: 'DPI status', new: 'New', removed: 'Removed', renamed: 'Renamed', values: 'Values', sources: 'Sources only', wording: 'Wording fixes'
}

/**
 * Whether a change only rewords a value, to the codebook's agreed wording. The page folds these away.
 * For now it's read from the reason; a `method` field on the change will say it instead.
 */
export const isWordingFix = (change: { reason: string }) => /^(Use the agreed wording for|Codebook revision:)/.test(change.reason.trim())

/** A changeset's file on GitHub. Pending ones are in changesets/next/. */
const sourceBranch = process.env.CF_PAGES_BRANCH || 'main'
const changesetLink = (resource: string, id: string, pending: boolean) => pending
  ? `https://github.com/olizilla/digital-public-infra-map/blob/${sourceBranch}/changesets/next/${resource}/${id}.toml`
  : changesetUrl(resource, id)

/** One cell a change set: the value before it, if the cell had one, and after */
export interface Cell {
  field: Field
  label: string
  before?: string
  after: string
  valueChanged: boolean
}

/** One change: an entry in a changeset, which may set more than one of a system's cells */
export interface Change {
  changeset: string
  /** its index in the changeset */
  index: number
  kind: ChangeKind
  as_of: string
  reason: string
  /** the change's sources that are URLs */
  sources: string[]
  cells: Cell[]
}

/** A system's changes, from one changeset */
export interface ChangesetGroup {
  changeset: string
  href: string
  /** in changesets/next/, not yet in a release */
  pending: boolean
  /** the as_of all its changes share, if they do */
  as_of?: string
  changes: Change[]
}

/** What a removed system says about the system that takes its place */
export interface Successor {
  /** `duplicate`: the remove's duplicate_of; `replaced`: named in its reason, or new in the same place this round */
  how: 'duplicate' | 'replaced'
  system: System
}

export interface SystemChanges {
  id: string
  dpiType: DPIType
  /** the system as the release has it, or undefined if it was removed */
  system?: System
  /** its name, or the stand-in for an unnamed system: the release's, or the previous release's if it was removed */
  title: string
  named: boolean
  country: string
  isNew: boolean
  removed?: { reason: string, as_of: string, sources: string[], successor?: Successor }
  /** the DPI status before the release, or undefined if the system is new */
  before?: DpiStatus
  /** the DPI status now, or undefined if it was removed */
  after?: DpiStatus
  /** the DPI test items that changed, the implementation status first */
  criteria: { label: string, kind: 'status' | 'flag', was: string, now: string }[]
  renamed: boolean
  /** its changes, by changeset, except wording fixes; a removed system's one change is its removal */
  groups: ChangesetGroup[]
  /** its wording fixes, by changeset */
  wording: ChangesetGroup[]
  /** how many changes */
  count: number
}

export interface CountryChanges {
  country: string
  slug: string
  href?: string
  systems: SystemChanges[]
  count: number
}

/** A country that gains or loses a DPI-like system, and the systems that made it */
export interface DpiCountry {
  country: string
  slug: string
  gains: boolean
  systems: SystemChanges[]
}

const validUrls = (urls: string[] = []) => urls.filter(url => URL.canParse(url))
const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value)

/** The changesets of this round: those released with this release, and the pending ones, without reverted ones */
const round = await getCollection('changesets', entry => entry.data.status === 'pending' || entry.data.release === release)
const roundByResource = new Map<string, Changeset[]>()
for (const { data } of round) {
  const list = roundByResource.get(data.resource) ?? []
  list.push({
    id: data.changeset, resource: data.resource, folder: data.release ?? 'next', path: '',
    changes: data.changes as unknown as Changeset['changes']
  })
  roundByResource.set(data.resource, list)
}
for (const [resource, list] of roundByResource) {
  list.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  roundByResource.set(resource, unreverted(list, []))
}

/** A place's key for counting DPI-like countries, as the homepage does: its code, or undefined for a region */
function countryKey (name: string) {
  const place = placeNamed(name)
  if (place && isRegion(place)) return undefined
  return place?.code ?? name.trim().toLowerCase()
}

/** The criteria of the DPI test that differ between two records, the implementation status for Active */
function criteriaChanged (dpiType: DPIType, then: Record<string, any> | undefined, now: Record<string, any>): SystemChanges['criteria'] {
  if (!then) return []
  const out: SystemChanges['criteria'] = []
  const [was, is] = [statusOf(dpiType, then).label, statusOf(dpiType, now).label]
  if (was !== is) out.push({ label: 'Status', kind: 'status', was, now: is })
  const before = dpiTest(dpiType, then)
  dpiTest(dpiType, now).forEach((c, i) => {
    if (c.field !== 'status' && c.value !== before[i].value) out.push({ label: c.label, kind: 'flag', was: before[i].value, now: c.value })
  })
  return out
}

function groupsOf (changes: Change[], resource: string, pending: Set<string>): ChangesetGroup[] {
  return [...Map.groupBy(changes, change => change.changeset).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([changeset, changes]) => {
      const dates = new Set(changes.map(change => change.as_of))
      return {
        changeset, href: changesetLink(resource, changeset, pending.has(changeset)), pending: pending.has(changeset),
        ...(dates.size === 1 ? { as_of: changes[0].as_of } : {}),
        changes: changes.sort((a, b) => a.index - b.index)
      }
    })
}

interface Entry { changeset: string, index: number, type: string, as_of: string, reason: string, sources: string[], values: Record<string, string>, duplicate_of?: string }

/** Everything the changelog shows for one DPI type */
function changelogOf (dpiType: DPIType) {
  const schema = schemas[dpiType]
  const resource = resourceNames[dpiType]
  const fields = schema.fields as Field[]
  const fieldOf = new Map(fields.map(field => [field.id, field]))
  const keyField = fields.find(field => field.name === schema.primaryKey![0])!
  const toPreviousRecord = (row: Record<string, any>) => {
    const record = toRecord(schema, row, { status: normaliseImplementationStatus } as never)
    record['DPI Status'] = dpiStatus(dpiType, record)
    return record
  }
  const previous = new Map(previousRows[dpiType].map(row => [String(row[keyField.name]), row]))
  const current = new Map(systems.filter(system => system.dpiType === dpiType).map(system => [system.id, system]))
  const changesets = roundByResource.get(resource) ?? []
  const pending = new Set(changesets.filter(c => c.folder === 'next').map(c => c.id))

  // every change of the round, by row key
  const byKey = new Map<string, Entry[]>()
  for (const c of changesets) {
    c.changes.forEach((change, index) => {
      if (!change.key || change.type === 'revert' || change.type === 'snapshot') return
      const entry: Entry = {
        changeset: c.id, index, type: change.type, as_of: change.as_of ?? '', reason: (change.reason ?? '').trim(),
        sources: validUrls(change.sources), values: Object.fromEntries(Object.entries(change.values ?? {}).map(([k, v]) => [k, cellText(v)])),
        ...(change.duplicate_of ? { duplicate_of: change.duplicate_of } : {})
      }
      byKey.set(change.key, [...(byKey.get(change.key) ?? []), entry])
    })
  }
  // the systems new this round, by place, for a removed system's replacement
  const createdIn = (code?: string) => [...byKey.entries()]
    .filter(([key, entries]) => entries.some(e => e.type === 'create') && current.has(key) && !previous.has(key))
    .map(([key]) => current.get(key)!)
    .filter(system => code !== undefined && placeNamed(system.country)?.code === code)

  const changed: SystemChanges[] = []
  for (const [key, entries] of byKey) {
    const system = current.get(key)
    const old = previous.get(key)
    const oldRecord = old ? toPreviousRecord(old) : undefined
    const isNew = !old && !!system
    // the round's changes in the build's order, each cell's value before it the one before
    const ordered = [...entries].sort((a, b) => a.as_of !== b.as_of ? (a.as_of < b.as_of ? -1 : 1) : a.changeset !== b.changeset ? (a.changeset < b.changeset ? -1 : 1) : a.index - b.index)
    const running = new Map<string, string>()
    if (old) for (const field of fields) if (field.name in old) running.set(field.id, cellText(old[field.name]))
    const changes: Change[] = []
    let renamed = false
    for (const entry of ordered) {
      if (entry.type === 'remove') continue
      const cells: Cell[] = []
      for (const [id, value] of Object.entries(entry.values)) {
        const field = fieldOf.get(id)
        const before = running.get(id)
        running.set(id, value)
        if (!field || derivedFields.includes(id) || field.site.kind === 'hidden' || (isNew && field.site.kind === 'country')) continue
        cells.push({ field, label: labelOf(field), ...(before !== undefined ? { before } : {}), after: value, valueChanged: before !== value })
      }
      if (!cells.length) continue
      const renames = !isNew && cells.some(cell => cell.field.site.kind === 'name' && cell.valueChanged)
      if (renames) renamed = true
      const change: Change = { changeset: entry.changeset, index: entry.index, kind: 'values', as_of: entry.as_of, reason: entry.reason, sources: entry.sources, cells }
      change.kind = isNew ? 'new'
        : isWordingFix(change) ? 'wording'
        : renames ? 'renamed'
        : cells.every(cell => !cell.valueChanged) ? 'sources'
        : 'values'
      changes.push(change)
    }

    if (!system) {
      // removed: its last remove, its reason, and what takes its place
      const remove = ordered.findLast(entry => entry.type === 'remove')
      if (!remove || !old || !oldRecord) continue
      const code = placeNamed(String(oldRecord.Country))?.code
      const named = remove.reason.match(/\b(?:id|pay|dx)-[a-z]+-\d+\b/g)?.map(id => current.get(id)).find(Boolean)
      const successor: Successor | undefined = remove.duplicate_of && current.get(remove.duplicate_of)
        ? { how: 'duplicate', system: current.get(remove.duplicate_of)! }
        : named ? { how: 'replaced', system: named }
        : createdIn(code)[0] ? { how: 'replaced', system: createdIn(code)[0] } : undefined
      const removal: Change = { changeset: remove.changeset, index: remove.index, kind: 'removed', as_of: remove.as_of, reason: remove.reason, sources: remove.sources, cells: [] }
      const name = nameOf(dpiType, oldRecord)
      changed.push({
        id: key, dpiType, title: name ?? `Unnamed ${nouns[dpiType]} system`, named: !!name, country: String(oldRecord.Country),
        isNew: false, removed: { reason: remove.reason, as_of: remove.as_of, sources: remove.sources, ...(successor ? { successor } : {}) },
        before: oldRecord['DPI Status'], criteria: [], renamed: false,
        groups: groupsOf([removal], resource, pending), wording: [], count: 1,
      })
      continue
    }
    if (!changes.length) continue
    changed.push({
      id: key, dpiType, system, title: system.title, named: nameOf(dpiType, system.record) !== undefined, country: system.country,
      isNew,
      ...(oldRecord ? { before: oldRecord['DPI Status'] } : {}),
      after: system.dpiStatus,
      criteria: criteriaChanged(dpiType, oldRecord, system.record),
      renamed,
      groups: groupsOf(changes.filter(change => change.kind !== 'wording'), resource, pending),
      wording: groupsOf(changes.filter(change => change.kind === 'wording'), resource, pending),
      count: new Set(entries.map(e => `${e.changeset}#${e.index}`)).size,
    })
  }
  changed.sort((a, b) => a.id.localeCompare(b.id))

  // countries by place, named as the release names them, so a renamed country is one heading
  const nameOfPlace = new Map<string, string>()
  for (const system of current.values()) nameOfPlace.set(placeNamed(system.country)?.code ?? system.country, system.country)
  const headingOf = (s: SystemChanges) => nameOfPlace.get(placeNamed(s.country)?.code ?? s.country) ?? s.country
  const countries: CountryChanges[] = [...Map.groupBy(changed, headingOf).entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([country, list]) => {
      const code = placeNamed(country)?.code
      return { country, slug: slug(country), href: (code && pages.get(code)?.href) || undefined, systems: list, count: list.reduce((n, s) => n + s.count, 0) }
    })

  // DPI-like countries, counted as the homepage counts them: places that aren't regions, with a system that passes the DPI test
  const dpiBefore = new Set([...previous.values()].map(toPreviousRecord).filter(r => r['DPI Status'] === 'DPI').map(r => countryKey(String(r.Country))).filter(k => k !== undefined))
  const dpiAfter = new Set([...current.values()].filter(s => s.dpiStatus === 'DPI').map(s => countryKey(s.country)).filter(k => k !== undefined))
  const dpiCountries: DpiCountry[] = [...new Set([...dpiBefore, ...dpiAfter])]
    .filter(key => dpiBefore.has(key) !== dpiAfter.has(key))
    .map(key => {
      const gains = dpiAfter.has(key)
      const here = changed.filter(s => countryKey(s.country) === key)
      // what made it: the systems that are DPI-like now and weren't, or were and aren't
      const systems = gains ? here.filter(s => s.after === 'DPI' && s.before !== 'DPI') : here.filter(s => s.before === 'DPI' && s.after !== 'DPI')
      const country = systems[0] ? headingOf(systems[0]) : key
      return { country, slug: slug(country), gains, systems }
    })
    .sort((a, b) => a.country.localeCompare(b.country, 'en'))

  const statusChanged = (s: SystemChanges) => !s.isNew && !s.removed && s.before !== s.after
  const counts: Record<Kind, number> & { changes: number, systems: number, countries: number } = {
    changes: changed.reduce((n, s) => n + s.count, 0),
    systems: changed.length,
    countries: countries.length,
    dpi: changed.filter(statusChanged).length,
    new: changed.filter(s => s.isNew).length,
    removed: changed.filter(s => s.removed).length,
    renamed: changed.filter(s => s.renamed).length,
    values: 0, sources: 0, wording: 0,
  }
  for (const s of changed) for (const group of [...s.groups, ...s.wording]) for (const change of group.changes) {
    if (change.kind === 'values' || change.kind === 'sources' || change.kind === 'wording') counts[change.kind]++
  }
  return { dpiType, countries, dpiCountries, dpiLike: { before: dpiBefore.size, after: dpiAfter.size }, counts, statusChanged }
}
export type Changelog = ReturnType<typeof changelogOf>

const cache = new Map<DPIType, Changelog>()
/** The changelog for a DPI type, worked out once per build */
export function changelog (dpiType: DPIType) {
  if (!cache.has(dpiType)) cache.set(dpiType, changelogOf(dpiType))
  return cache.get(dpiType)!
}

/** "1,141" */
export const n = (count: number) => count.toLocaleString('en-GB')
/** "1 change", "3 changes" */
export const plural = (count: number, noun: string, nouns = `${noun}s`) => `${n(count)} ${count === 1 ? noun : nouns}`

/** The codebook's changes in a line, like "2 fields added, 1 removed, 15 fields gain new allowed values, 6 definitions reworded" */
export function codebookSummary (c: ResourceChanges) {
  const fields = (count: number, verb: string) => `${plural(count, 'field')} ${count === 1 ? `${verb}s` : verb}`
  const parts = [
    c.added.length ? `${plural(c.added.length, 'field')} added` : '',
    c.removed.length ? `${n(c.removed.length)} removed` : '',
    c.fieldsGaining ? `${fields(c.fieldsGaining, 'gain')} new allowed values` : '',
    c.fieldsLosing ? `${fields(c.fieldsLosing, 'lose')} allowed values` : '',
    c.definitions.length ? `${plural(c.definitions.length, 'definition')} reworded` : '',
    c.meanings.length ? `${plural(c.meanings.length, 'value meaning')} reworded` : '',
    c.missing.length ? `${plural(c.missing.length, 'missing value')} changed` : '',
    c.other.length ? `${plural(c.other.length, 'field')} otherwise changed` : '',
  ].filter(Boolean)
  // "2 fields added, 1 removed": the second "removed" reads as fields too, unless nothing was added
  if (!c.added.length && c.removed.length) parts[0] = `${plural(c.removed.length, 'field')} removed`
  return parts.length ? parts.join(', ') : 'No changes to the codebook'
}
