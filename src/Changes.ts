// The changelog (D81), for the changes pages (src/pages/changes/), by round (src/ChangeRounds.ts):
// - a release's changes, at /changes/<date>/ and /changes/<date>/<type>/: the changesets released
//   with it, in changesets/<date>/, applied to the release before it. They never change once it's out.
// - /changes/ and /changes/<type>/ redirect to the latest release's, as /data/latest/ does (written by
//   scripts/data-build.ts, and in astro.config.mjs for astro dev), so a shared link names its release.
// - the pending changes, at /changes/next/ and /changes/next/<type>/: the changesets in changesets/next/,
//   applied to the release the site shows (src/Release.ts), so they're what the next release will
//   change. They aren't in the published data, so they never count towards a release (B2).
// The changesets come from the changesets collection (src/content.config.ts). Within a round, a
// cell's changes apply in the data build's order (lib/changesets/build.ts): by as_of, then changeset
// id, then place in the changeset, all on top of the round's base release. So each change's old value
// is the base release's, or that of the change before it. The DPI status before is the DPI test's on
// the base release's row, and after, on the round's: the release's own row, or for the pending
// changes, the latest release's with them replayed by lib/changesets, as the data build will. The
// codebook's changes are the base release's datapackage.json against the round's: the release's, or
// for the pending changes the root one, the next release's codebook (D71), by src/CodebookChanges.ts.
// Astro calls this per page, so each round is worked out once per build.
import slug from 'slug'
import { getCollection } from 'astro:content'
import { build, fieldId, unreverted } from '../lib/changesets/build.ts'
import type { Changeset, DataPackage } from '../lib/changesets/types.ts'
import nextPackage from '../datapackage.json'
import { schemas, resourceNames, toRecord, type DPIType, type Field } from './Schema'
import { dpiStatus, dpiTest, nameOf, nouns, statusOf, type DpiStatus } from './DpiTest'
import { normaliseImplementationStatus } from './Status'
import { derivedFields } from './DpiLayer'
import { isRegion, placeNamed } from './Places'
import { pages } from './Records'
import { dpiTypes, systemHref, systems, systemsOf, type System } from './Systems'
import { laneAnchors } from './CountryPage'
import { changesetUrl } from './SystemPage'
import { release } from './Release'
import { releasePackage } from './ReleaseFiles'
import { codebookChanges, type Package, type ResourceChanges } from './CodebookChanges'
import { baseOf, inRound, pending, releaseRounds, type Round } from './ChangeRounds'

export { pending, type Round }

// The release folders' JSON files, by path, loaded only when needed
const releaseFiles = import.meta.glob<{ default: any }>('../public/data/*/*.json')
const fileOf = (folder: string, file: string) => `../public/data/${folder}/${file}`
const load = async (path: string) => (await releaseFiles[path]()).default
/** A release folder's name, its date, as RELEASE_FOLDER in lib/changesets/log.ts */
const releaseFolder = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** The release folders with JSON for every table, oldest first: those a round's changes can apply to, as `npm run data:build` finds them */
const releases = [...new Set(Object.keys(releaseFiles).map(path => path.split('/')[3]))]
  .filter(folder => releaseFolder.test(folder))
  .sort()
  .filter(folder => Object.values(resourceNames).every(name => fileOf(folder, `${folder}-${name}.json`) in releaseFiles))

/** Every changeset, released or pending */
const entries = (await getCollection('changesets')).map(entry => entry.data)

/** The releases with a changelog, newest first: those with changesets. The releases made from the spreadsheets have none. */
export const releaseChangelogs = releaseRounds(entries, releases, release)

/** A release's date, like "6 Nov 2026", as in "changes in the 6 Nov 2026 release" */
export const dateOf = (folder: string) => new Date(`${folder}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** A round: its changesets, the rows they apply to, the systems after them, and the codebook's changes */
export interface RoundOf {
  round: Round
  /** the release the changes apply to, and its date */
  base: string
  baseDate: string
  /** a release's date, like "6 Nov 2026", or undefined for the pending changes */
  date?: string
  /** the changesets by resource, in id order, without reverted ones */
  changesets: Map<string, Changeset[]>
  /** the base release's rows, by type, keyed by column header */
  baseRows: Record<DPIType, Record<string, any>[]>
  /** the systems after the changes: the release's, or the latest release's with the pending changes */
  systems: System[]
  /** what changed in the codebook, by resource, or undefined if the base release has no datapackage.json */
  codebook?: Record<string, ResourceChanges>
}

/** A release's rows, by type, keyed by column header, as in its JSON */
const rowsOf = async (folder: string) => Object.fromEntries(await Promise.all(dpiTypes
  .map(async dpiType => [dpiType, await load(fileOf(folder, `${folder}-${resourceNames[dpiType]}.json`))]))) as Record<DPIType, Record<string, any>[]>

/** A release's datapackage.json, or undefined if it has none */
const packageOf = async (folder: string) => fileOf(folder, 'datapackage.json') in releaseFiles ? await load(fileOf(folder, 'datapackage.json')) as Package : undefined

/**
 * The pending changes replayed onto the latest release's rows by lib/changesets, as the data build
 * will, keyed by column header. With the release's codebook, as the site reads its rows: values for
 * fields only the next release has are left out, as the changelog leaves them out.
 */
function replayed (rows: Record<DPIType, Record<string, any>[]>, changesets: Map<string, Changeset[]>) {
  const result = build({
    datapackage: releasePackage as DataPackage,
    baseline: { id: release, tables: Object.fromEntries(dpiTypes.map(dpiType => [resourceNames[dpiType], rows[dpiType]])) },
    layers: [Object.fromEntries(changesets)]
  })
  return Object.fromEntries(dpiTypes.map(dpiType => {
    const table = result.tables[resourceNames[dpiType]]
    return [dpiType, table.rows.map(row => Object.fromEntries(table.fields.map(field => [field.name, row[fieldId(field)]])))]
  })) as Record<DPIType, Record<string, any>[]>
}

async function loadRound (round: Round): Promise<RoundOf> {
  const isPending = round === pending
  const base = baseOf(round, releases, release)
  if (!base) throw new Error(`No release folder before ${round} in public/data/ has JSON for every table`)

  // the round's changesets, by resource, without reverted ones
  const changesets = new Map<string, Changeset[]>()
  for (const data of entries.filter(entry => inRound(entry, round))) {
    const list = changesets.get(data.resource) ?? []
    list.push({
      id: data.changeset, resource: data.resource, folder: data.release ?? pending, path: '',
      changes: data.changes as unknown as Changeset['changes']
    })
    changesets.set(data.resource, list)
  }
  for (const [resource, list] of changesets) {
    list.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    changesets.set(resource, unreverted(list, []))
  }

  const baseRows = await rowsOf(base)
  const rows = round === release ? undefined : isPending ? replayed(baseRows, changesets) : await rowsOf(round)
  const after = rows ? dpiTypes.flatMap(dpiType => systemsOf(dpiType, rows[dpiType])) : systems
  const [before, now] = [await packageOf(base), isPending ? nextPackage as unknown as Package : await packageOf(round)]
  return {
    round, base, baseDate: dateOf(base), ...(isPending ? {} : { date: dateOf(round) }),
    changesets, baseRows, systems: after,
    ...(before && now ? { codebook: codebookChanges(before, now) } : {})
  }
}

const rounds = new Map<Round, Promise<RoundOf>>()
/** A round, the pending changes or a release's, worked out once per build */
export function roundOf (round: Round) {
  if (!rounds.has(round)) rounds.set(round, loadRound(round))
  return rounds.get(round)!
}

/** How each type's page names the type, as in "Payments: changes in the 6 Nov 2026 release" */
export const changeTitles: Record<DPIType, string> = { id: 'Digital ID', pay: 'Payments', data: 'Data exchange' }

/**
 * A round's changelog: /changes/next/ for the pending changes, /changes/<date>/ for a release's, or with
 * `dpiType` its type's page under it, /changes/…/<lane anchor>/, so the slugs match the country page's lanes
 */
export const changesHref = (round: Round, dpiType?: DPIType) =>
  `/changes/${round === pending ? 'next' : round}/${dpiType ? `${laneAnchors[dpiType]}/` : ''}`

/** The changelog's own address, /changes/: it redirects to the latest release's (D81) */
export const changelogHref = '/changes/'

/** How the changes pages' nav bar names a round: "Next release (pending)", or the release's date */
export const roundLabel = (round: Round) => round === pending ? 'Next release (pending)' : `${dateOf(round)} release`

/** The systems the site has a page for: those in the release it shows */
const pageIds = new Set(systems.map(system => system.id))

/** A system's page, or undefined if the release the site shows doesn't have it, as for a pending new system */
export const pageOf = (id: string) => pageIds.has(id) ? systemHref(id) : undefined

/** The kinds of change the page filters by, in chip order. `dpi` is a system's, the rest a change's. */
export const kinds = ['dpi', 'new', 'removed', 'renamed', 'values', 'sources', 'wording'] as const
export type Kind = typeof kinds[number]
export type ChangeKind = Exclude<Kind, 'dpi'>
export const kindLabels: Record<Kind, string> = {
  dpi: 'DPI status', new: 'New', removed: 'Removed', renamed: 'Renamed', values: 'Values', sources: 'Unchanged values', wording: 'Wording fixes'
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
  /** the field's codebook title: the changelog doesn't use the site's labels */
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
  /** the system after the round's changes, or undefined if it was removed */
  system?: System
  /** its name, or the stand-in for an unnamed system: after the round's changes, or the base release's if it was removed */
  title: string
  named: boolean
  country: string
  isNew: boolean
  removed?: { reason: string, as_of: string, sources: string[], successor?: Successor }
  /** the DPI status in the base release, or undefined if the system is new */
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

/** Everything a round's changelog shows for one DPI type */
function changelogOf (round: RoundOf, dpiType: DPIType) {
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
  const previous = new Map(round.baseRows[dpiType].map(row => [String(row[keyField.name]), row]))
  const current = new Map(round.systems.filter(system => system.dpiType === dpiType).map(system => [system.id, system]))
  const changesets = round.changesets.get(resource) ?? []
  const pendingIds = new Set(changesets.filter(c => c.folder === pending).map(c => c.id))

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
        cells.push({ field, label: field.title, ...(before !== undefined ? { before } : {}), after: value, valueChanged: before !== value })
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
      const code = placeNamed(String(oldRecord.country))?.code
      const named = remove.reason.match(/\b(?:id|pay|dx)-[a-z]+-\d+\b/g)?.map(id => current.get(id)).find(Boolean)
      const successor: Successor | undefined = remove.duplicate_of && current.get(remove.duplicate_of)
        ? { how: 'duplicate', system: current.get(remove.duplicate_of)! }
        : named ? { how: 'replaced', system: named }
        : createdIn(code)[0] ? { how: 'replaced', system: createdIn(code)[0] } : undefined
      const removal: Change = { changeset: remove.changeset, index: remove.index, kind: 'removed', as_of: remove.as_of, reason: remove.reason, sources: remove.sources, cells: [] }
      const name = nameOf(dpiType, oldRecord)
      changed.push({
        id: key, dpiType, title: name ?? `Unnamed ${nouns[dpiType]} system`, named: !!name, country: String(oldRecord.country),
        isNew: false, removed: { reason: remove.reason, as_of: remove.as_of, sources: remove.sources, ...(successor ? { successor } : {}) },
        before: oldRecord['DPI Status'], criteria: [], renamed: false,
        groups: groupsOf([removal], resource, pendingIds), wording: [], count: 1,
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
      groups: groupsOf(changes.filter(change => change.kind !== 'wording'), resource, pendingIds),
      wording: groupsOf(changes.filter(change => change.kind === 'wording'), resource, pendingIds),
      count: new Set(entries.map(e => `${e.changeset}#${e.index}`)).size,
    })
  }
  changed.sort((a, b) => a.id.localeCompare(b.id))

  // countries by place, named as the systems after the round name them, so a renamed country is one heading
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
  const dpiBefore = new Set([...previous.values()].map(toPreviousRecord).filter(r => r['DPI Status'] === 'DPI').map(r => countryKey(String(r.country))).filter(k => k !== undefined))
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
  return { dpiType, countries, dpiCountries, dpiLike: { before: dpiBefore.size, after: dpiAfter.size }, counts, statusChanged, codebook: round.codebook?.[resource] }
}
export type Changelog = ReturnType<typeof changelogOf>

const cache = new Map<string, Promise<Changelog>>()
/** A round's changelog for a DPI type, worked out once per build */
export function changelog (round: Round, dpiType: DPIType) {
  const key = `${round}/${dpiType}`
  if (!cache.has(key)) cache.set(key, roundOf(round).then(r => changelogOf(r, dpiType)))
  return cache.get(key)!
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
