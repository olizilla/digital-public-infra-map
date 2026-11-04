// The systems in the current release (src/Release.ts), for the /<system-id> pages.
// They're the same rows as the country pages' (src/Identity.ts etc), by System ID.
// Fields come from datapackage.json and are found by id, never by header.
import slug from 'slug'
import { schemas, resourceNames, fieldById, schemaSource, toRecord, type DPIType, type Schema } from './Schema'
import { normaliseImplementationStatus } from './Status'
import { dpiStatus, nameOf, nouns, type DpiStatus } from './DpiTest'
import { placeNamed } from './Places'
import { pages } from './Records'
import { fixURL } from './Util'
import { releaseHistory, releaseRows } from './Release'

export const dpiTypes = Object.keys(resourceNames) as DPIType[]

export interface System {
  /** the System ID, like `pay-ke-02` */
  id: string
  dpiType: DPIType
  /** the datapackage.json resource name, like `payment` */
  resource: string
  /** the name cell, which may be `NA` */
  name: string
  /** the name to show: the name cell, or a stand-in if it's missing */
  title: string
  country: string
  /** the path of the place's country page, if it has one */
  countryHref?: string
  /** from the DPI test, src/DpiTest.ts */
  dpiStatus: DpiStatus
  /** each cell's text, by field id */
  values: Record<string, string>
  /** the row keyed by field label, with 'DPI Status', as the cards take it (src/Identity.ts etc) */
  record: Record<string, any>
}

function systemsOf (dpiType: DPIType): System[] {
  const schema = schemas[dpiType] as Schema
  const key = schema.primaryKey
  if (key?.length !== 1) throw new Error(`${schemaSource(dpiType)} needs a primaryKey of one field, the System ID`)
  const idField = schema.fields.find(field => field.name === key[0])
  if (!idField) throw new Error(`${schemaSource(dpiType)} primaryKey "${key[0]}" is not one of its fields`)
  const header = (id: string) => fieldById(schema, id).name
  const columns = { country: header('country'), name: header('name') }

  return releaseRows[dpiType].map(row => {
    const values: Record<string, string> = {}
    for (const field of schema.fields) values[field.id] = String(row[field.name] ?? '')
    // the same record as the cards', so the system page can use their components
    const record = toRecord(schema, row, {
      url: (url, get) => fixURL(dpiType, get('country'), url),
      status: normaliseImplementationStatus,
    })
    record['DPI Status'] = dpiStatus(dpiType, record)
    const country = row[columns.country]
    const code = placeNamed(country)?.code
    return {
      id: row[idField.name],
      dpiType,
      resource: resourceNames[dpiType],
      name: row[columns.name],
      title: nameOf(dpiType, record) ?? `Unnamed ${nouns[dpiType]} system`,
      country,
      countryHref: code ? pages.get(code)?.href : undefined,
      dpiStatus: record['DPI Status'],
      values,
      record
    }
  })
}

export const systems = dpiTypes.flatMap(systemsOf)

// A system's page is /<id> and a country's is /<slug(country)>, so they must never meet.
const countrySlugs = new Set([...systems.map(system => slug(system.country)), ...[...pages.values()].map(page => page.href.replaceAll('/', ''))])
const seen = new Set<string>()
for (const { id } of systems) {
  if (!id) throw new Error('A row in the release has no System ID')
  if (seen.has(id)) throw new Error(`System ID "${id}" is used more than once`)
  if (countrySlugs.has(id)) throw new Error(`System ID "${id}" is also a country page path`)
  seen.add(id)
}

/** The path of a system's page */
export const systemHref = (id: string) => `/${id}/`

/**
 * The editor stub, to review the system or, with `fieldId`, edit one value. With the trailing
 * slash, so the query string survives: static hosts (and the link checker) redirect
 * /edit/<id> to /edit/<id>/, which would otherwise come first.
 */
export const editHref = (system: System, fieldId?: string) => `/edit/${system.id}/` + (fieldId ? `?field=${encodeURIComponent(fieldId)}` : '')

/** The history of one of a system's values: every change to it, oldest first, so the last set the current value */
export function historyFor (system: System, fieldId: string) {
  const history = releaseHistory[system.resource]
  return (history?.rows[system.id]?.[fieldId] ?? []).map(entry => {
    const changeset = history.changesets[entry.changeset]
    return { ...entry, reason: changeset?.reasons[entry.change] ?? '', ...(changeset?.author ? { author: changeset.author } : {}) }
  })
}

/** The evidence links for one of a system's values: those of the change that last set or restated it. Links that aren't URLs are left out. */
export function sourcesFor (system: System, fieldId: string) {
  const sources = historyFor(system, fieldId).at(-1)?.sources ?? []
  const bad = sources.filter(url => !URL.canParse(url))
  for (const url of bad) console.log(`${system.id}: ${fieldId} has a source that isn't a URL: ${url.slice(0, 80)}`)
  return sources.filter(url => URL.canParse(url))
}
