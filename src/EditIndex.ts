// The editor's index (D91): what /edit/ and /edit/new/<table>/ need to know about places and systems,
// small enough to embed in the page as JSON: the places (code, the name the data uses for it, its region,
// and its other names, to search by) and each system's row (System ID, name, whether it has one).
// Rows are the next release's: the release's with the changesets waiting in changesets/next/ replayed onto them (D93), so a
// system that's been proposed and not yet released can be found, and the next System ID counts it.
// A row's type and place are in its System ID, `<type>-<place>-<number>`, so they aren't repeated.
// Search, what to do about a place in each table, and the next System ID are here too, which the pages' scripts
// and the tests run.
// No astro: imports and no other modules, as the pages' scripts run it in the browser and node --test loads it.

/** A DPI type, as the System ID's first part: `id`, `pay` or `dx`. Not Schema's `data`: this file imports nothing. */
export type TypeId = 'id' | 'pay' | 'dx'

/** What each table is called where the site names it, and where it's kept: Schema's resourceNames, nouns and typeLabels (src/EditIndex.test.ts checks they agree) */
export const tables: Record<TypeId, { resource: string, noun: string, label: string }> = {
  id: { resource: 'identity', noun: 'digital ID', label: 'Digital ID' },
  pay: { resource: 'payment', noun: 'digital payment', label: 'Digital payment' },
  dx: { resource: 'exchange', noun: 'data exchange', label: 'Data exchange' }
}
export const typeIds = Object.keys(tables) as TypeId[]

/** Whether a row has a name (0), is a system with no name (1), or has no name and nothing to show it's a system (2): presence() in src/DpiTest.ts */
export type Kind = 0 | 1 | 2

/** [code, the name the data uses, the region's code or '', ...its other names] */
export type IndexPlace = [code: string, name: string, parent: string, ...others: string[]]
/** [System ID, name or '', kind, 1 if it's waiting in changesets/next/ and not in the release yet] */
export type IndexRow = [id: string, name: string, kind: Kind, pending?: 1]

export interface EditIndex {
  p: IndexPlace[]
  r: IndexRow[]
  /**
   * The highest number a System ID has ever had, by `<type>-<place>`, where that's higher than any row's: a system
   * that was removed, which its ID must never be reused for. Usually empty.
   */
  u?: Record<string, number>
}

/** What the index is made from: places.csv, place-names.csv and each row of the systems, as the page reads them */
export interface IndexInput {
  places: { code: string, name: string, parent?: string }[]
  names: { dpimap_name: string, code: string }[]
  rows: { id: string, /** the name cell, '' for none */ name: string, /** the Country / Region cell */ country: string, kind: Kind, pending: boolean }[]
  /** every System ID ever used: see usedIds. Without it, only the rows' are. */
  used?: Iterable<string>
}

/**
 * Every System ID that has ever been used, which is never used again (D82): the `key` of every change in every
 * changeset, released and pending, whatever its type (an update, a remove, or the changeset a revert names are
 * all of systems that were), and every System ID in each release's tables from the first that has them,
 * 2026-03-31, on. `changes` are changesets' changes and `releases` the System IDs of each release's tables.
 */
export function usedIds (changes: Iterable<{ key?: unknown }>, releases: Iterable<string>): Set<string> {
  const used = new Set<string>(releases)
  for (const change of changes) if (typeof change.key === 'string' && parseId(change.key)) used.add(change.key)
  return used
}

/** The highest number used in each `<type>-<place>` by these System IDs */
export function highestNumbers (ids: Iterable<string>): Map<string, number> {
  const highest = new Map<string, number>()
  for (const id of ids) {
    const parsed = parseId(id)
    if (parsed) highest.set(`${parsed.type}-${parsed.place}`, Math.max(highest.get(`${parsed.type}-${parsed.place}`) ?? 0, parsed.number))
  }
  return highest
}

/** The next System ID for a place in a table after every one in `used`: one more than the highest, with at least two digits */
export const nextFreeId = (used: Iterable<string>, type: string, place: string) =>
  `${type}-${place}-${String((highestNumbers(used).get(`${type}-${place}`) ?? 0) + 1).padStart(2, '0')}`

/** The place and number of a System ID, like pay-lac-02: `lac` and 2 */
export function parseId (id: string): { type: string, place: string, number: number } | undefined {
  const [, type, place, number] = id.match(/^([a-z]+)-([a-z]+)-(\d+)$/) ?? []
  return type ? { type, place, number: Number(number) } : undefined
}

/**
 * The index. A place's name is the one the data uses for it, as a new row's Country / Region must be: the
 * most common one in its rows, or else the first name place-names.csv gives it, or the name in places.csv.
 * Its other names, from both files, are for searching.
 */
export function buildIndex (input: IndexInput): EditIndex {
  const used = new Map<string, Map<string, number>>()
  for (const row of input.rows) {
    const place = parseId(row.id)?.place
    if (!place || !row.country) continue
    const counts = used.get(place) ?? new Map<string, number>()
    counts.set(row.country, (counts.get(row.country) ?? 0) + 1)
    used.set(place, counts)
  }
  const p = input.places.map(place => {
    const counts = [...(used.get(place.code) ?? [])].sort((a, b) => b[1] - a[1])
    const aliases = input.names.filter(name => name.code === place.code).map(name => name.dpimap_name)
    const name = counts[0]?.[0] ?? aliases[0] ?? place.name
    const others = [...new Set([place.name, ...aliases, ...counts.map(([country]) => country)])].filter(other => other !== name)
    return [place.code, name, place.parent ?? '', ...others] as IndexPlace
  })
  const r = input.rows.map(row => {
    const entry: IndexRow = [row.id, row.name, row.kind]
    if (row.pending) entry.push(1)
    return entry
  })
  // an ID used for a system that's gone: its number is kept, where it's above the rows' own
  const current = highestNumbers(input.rows.map(row => row.id))
  const u: Record<string, number> = {}
  for (const [prefix, number] of highestNumbers(input.used ?? [])) if (number > (current.get(prefix) ?? 0)) u[prefix] = number
  return { p, r, ...(Object.keys(u).length ? { u } : {}) }
}

/** The index for some of the tables only, as the new-system pages, one for each, need */
export const indexFor = (index: EditIndex, types: TypeId[]): EditIndex => ({
  p: index.p,
  r: index.r.filter(([id]) => types.includes(parseId(id)?.type as TypeId)),
  ...(index.u ? { u: Object.fromEntries(Object.entries(index.u).filter(([prefix]) => types.includes(prefix.split('-')[0] as TypeId))) } : {})
})

const placeByCode = (index: EditIndex, code: string) => index.p.find(place => place[0] === code)

/** A place by its code, as `?place=` gives it, or undefined if there's no such place */
export const findPlace = (index: EditIndex, code: string | null | undefined) => code ? placeByCode(index, code) : undefined

/** The place's name, as the data uses it, and its region's name if it has one */
export function placeNames (index: EditIndex, place: IndexPlace) {
  const region = place[2] ? placeByCode(index, place[2])?.[1] : undefined
  return { name: place[1], ...(region ? { region } : {}) }
}

/**
 * The next free System ID for a place in a table, `<type>-<place>-<NN>`: one more than the highest number ever
 * used, so a number that's gone, even a removed system's, is never used again (D82), at least two digits. It
 * counts the rows in the index, the release's and the pending ones, and the numbers it keeps of IDs no row has.
 */
export function nextSystemId (index: EditIndex, type: TypeId, place: string): string {
  const rows = index.r.map(([id]) => parseId(id)).filter(id => id?.type === type && id.place === place).map(id => id!.number)
  const highest = Math.max(0, index.u?.[`${type}-${place}`] ?? 0, ...rows)
  return `${type}-${place}-${String(highest + 1).padStart(2, '0')}`
}

/** A place's rows in a table, by System ID */
export const rowsOf = (index: EditIndex, type: TypeId, place: string) =>
  index.r.filter(([id]) => { const parsed = parseId(id); return parsed?.type === type && parsed.place === place })
    .sort((a, b) => a[0] < b[0] ? -1 : 1)

/** Where a system's editor is */
export const editHref = (id: string) => `/${id}/edit/`
/** Where the form to add a system is, for a place: the place is read from the query string in the browser */
export const newHref = (type: TypeId, place: string) => `/edit/new/${tables[type].resource}/?place=${encodeURIComponent(place)}`

/** One of a place's rows, and what can be done with it */
export interface PlaceRow {
  id: string
  name: string
  kind: Kind
  pending: boolean
  /** 'edit' a named system, or 'fill' in a row with no name: a pending one too, as it has an edit page like any (D93) */
  action: 'edit' | 'fill'
  label: string
  href: string
}

/** A table's part of a place: its rows, and the link to add another system, as a smaller one if a row with no name should be filled in first (D91) */
export interface PlaceTable {
  type: TypeId
  label: string
  rows: PlaceRow[]
  add: { label: string, href: string, secondary: boolean }
}

/**
 * What can be done about a place, table by table (D91). A row with no name is filled in rather than added
 * to: its main action is "Fill in <id>", and adding a system is a smaller link. A named system is edited. A
 * place with no row in a table can have one added. A row waiting in changesets/next/ is edited or filled in like
 * the others (D93): the index is the next release's, and it has an edit page.
 */
export function placeTables (index: EditIndex, place: string): PlaceTable[] {
  return typeIds.map(type => {
    const { noun, label } = tables[type]
    const rows = rowsOf(index, type, place).map(([id, name, kind, pending]): PlaceRow => kind === 0
      ? { id, name, kind, pending: pending === 1, action: 'edit', label: `Edit ${name}`, href: editHref(id) }
      : { id, name, kind, pending: pending === 1, action: 'fill', label: `Fill in ${id}`, href: editHref(id) })
    const href = newHref(type, place)
    const add = rows.some(row => row.action === 'fill') ? { label: 'A different system? Add a new one', href, secondary: true }
      : rows.length ? { label: `Add another ${noun} system`, href, secondary: false }
        : { label: `Add a ${noun} system`, href, secondary: false }
    return { type, label, rows, add }
  })
}

/** The place's rows in a table that have no name: a new system there should probably fill one in instead (D91) */
export const unnamedRows = (index: EditIndex, type: TypeId, place: string) =>
  rowsOf(index, type, place).filter(([, , kind]) => kind !== 0).map(([id, name, kind, pending]) => ({ id, name, kind, pending: pending === 1 }))

/** Text as it's searched: without accents or capitals, and with a single space between words */
export const normalise = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s'’]+/g, ' ').trim()

/** How well a name matches a query, from 0 (the best) to 3, or undefined if it doesn't */
function rank (name: string, query: string): number | undefined {
  const text = normalise(name)
  if (text === query) return 0
  if (text.startsWith(query)) return 1
  if (text.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(query)) || text.includes(` ${query}`)) return 2
  return text.includes(query) ? 3 : undefined
}

export interface PlaceHit { place: IndexPlace, rank: number }
export interface SystemHit { row: IndexRow, rank: number }

export interface SearchResult {
  places: PlaceHit[]
  systems: SystemHit[]
  /** matching systems not in `systems`, for "and 12 more: keep typing" */
  more: number
}

/** The most places and systems a search lists */
export const MAX_PLACES = 8
export const MAX_SYSTEMS = 12

/**
 * Search the index: places by their names and other names, or their code; systems by name or System ID. Best matches
 * first, then A to Z. A query of one character finds nothing.
 */
export function search (index: EditIndex, text: string): SearchResult {
  const query = normalise(text)
  if (query.length < 2) return { places: [], systems: [], more: 0 }
  const places: PlaceHit[] = []
  for (const place of index.p) {
    const ranks = place.slice(3).concat(place[1]).map(name => rank(name, query)).filter(n => n !== undefined)
    if (place[0] === query) ranks.push(0)
    if (ranks.length) places.push({ place, rank: Math.min(...ranks) })
  }
  places.sort((a, b) => a.rank - b.rank || a.place[1].localeCompare(b.place[1]))
  const systems: SystemHit[] = []
  for (const row of index.r) {
    const ranks = [rank(row[0], query), row[1] ? rank(row[1], query) : undefined].filter(n => n !== undefined)
    if (ranks.length) systems.push({ row, rank: Math.min(...ranks) })
  }
  systems.sort((a, b) => a.rank - b.rank || a.row[0].localeCompare(b.row[0]))
  return { places: places.slice(0, MAX_PLACES), systems: systems.slice(0, MAX_SYSTEMS), more: Math.max(0, systems.length - MAX_SYSTEMS) }
}
