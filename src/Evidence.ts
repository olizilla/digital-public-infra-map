// What the release workbook (src/pages/data/latest/dpimap.xlsx.ts, D97) is made of beyond its table sheets:
// the Evidence sheet's rows, and the Fields sheet's definitions and allowed values. Kept apart from the
// workbook code so a test can check them. It has no astro: imports itself, but reads the release's history
// (src/Release.ts) through src/Systems.ts, so a test needs a stand-in for astro:content (src/test/astroContent.ts).
//
// The evidence is the system page's. Each current value, with its sources, is read with historyFor and
// sourcesFor (src/Systems.ts), as the page's field rows are: the date and reason are those of the change that
// last set or restated the value (D92), and its sources are that change's links that are URLs.
import { changeTitles, resourceNames, schemas, type DPIType, type Field } from './Schema'
import { codebookVariableOf, variablePath } from './Codebook'
import { fieldAnchor } from './SystemPage'
import { historyFor, sourcesFor, systemHref, systems, type System } from './Systems'
import { baselineRelease } from './Release'
import { derivedFields } from './DpiLayer'
import { releaseTables } from './ReleaseFiles'

/** Where the workbook's links point, whatever host builds it, so they work in a downloaded copy */
export const origin = 'https://dpimap.org'
export const link = (path: string) => new URL(path, origin).href

export const dpiTypes = Object.keys(resourceNames) as DPIType[]

/** A table's columns, in its JSON's key order: the keys of any of its rows, which are field ids (D83) */
export const columnsOf = (rows: Record<string, any>[]) => [...new Set(rows.flatMap(row => Object.keys(row)))]

/** A cell of a table sheet: a missing value is `NA`, a number is a number, and the rest is text */
export function cellValue (value: unknown): string | number {
  return value === undefined || value === null ? 'NA' : typeof value === 'number' ? value : typeof value === 'string' ? value : JSON.stringify(value)
}

/** What the Evidence sheet says about a value that's from the baseline release, rather than a change */
const baselineText = `From the ${new Date(`${baselineRelease}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} release`

/** One citation: a current value and one of its sources, or none */
export interface EvidenceRow {
  /** `<System ID>/<field id>` */
  claim: string
  claimHref: string
  /** the table's sheet name */
  table: string
  /** the name cell, or `NA` */
  system: string
  /** the country / region cell */
  place: string
  /** the field's title */
  field: string
  fieldHref: string
  value: string | number
  /** YYYY-MM-DD: when the value was last set or restated. Empty if the history has no date. */
  asOf: string
  reason: string
  /** a URL, or empty if the value has no source yet */
  source: string
}

/**
 * The fields whose values the Evidence sheet doesn't cover: the System ID, which names the row, the place, which
 * is part of the System ID and is the sheet's Place column, and the derived fields
 */
const notEvidenced = new Set(['system_id', 'country', ...derivedFields])

/**
 * The Evidence sheet's rows: for each table, in sheet order, each system in the sheet's row order and each of
 * its fields in the sheet's column order, a row for each source of each value that isn't NA or empty
 * ("Not Found" is a value). A value with no source gets one row, with no source.
 */
export function evidenceRows (): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  for (const dpiType of dpiTypes) {
    const table = releaseTables[resourceNames[dpiType]]
    const fields = schemas[dpiType].fields as Field[]
    const columns = columnsOf(table).map(name => fields.find(field => field.name === name)!).filter(field => !notEvidenced.has(field.id))
    const byId = new Map(systems.filter(system => system.dpiType === dpiType).map(system => [system.id, system]))
    for (const row of table) {
      const system = byId.get(row[fields.find(field => field.id === 'system_id')!.name])!
      for (const field of columns) {
        const value = cellValue(row[field.name])
        if (value === 'NA' || (typeof value === 'string' && value.trim() === '')) continue
        rows.push(...citationsOf(system, field, value, row))
      }
    }
  }
  return rows
}

/** The rows for one value: one for each of its sources, or one with none */
function citationsOf (system: System, field: Field, value: string | number, row: Record<string, any>): EvidenceRow[] {
  const last = historyFor(system, field.id).at(-1)
  const sources = sourcesFor(system, field.id)
  const base = {
    claim: `${system.id}/${field.id}`,
    claimHref: link(`${systemHref(system.id)}#${fieldAnchor(field.id)}`),
    table: changeTitles[system.dpiType],
    system: String(cellValue(row.name)),
    place: String(cellValue(row.country)),
    field: field.title,
    fieldHref: link(variablePath(system.dpiType, field)),
    value,
    asOf: last?.as_of ?? '',
    // a baseline value's history entry carries the long sentence about the release's files, which isn't for this sheet
    reason: !last ? '' : last.type === 'snapshot' ? baselineText : last.reason.trim().replace(/\s*\n\s*/g, ' ')
  }
  return (sources.length ? sources : ['']).map(source => ({ ...base, source }))
}

/** A field's definition as plain text: the codebook's, or the schema's for a field the codebook doesn't cover */
export function definitionOf (dpiType: DPIType, field: Field) {
  return (codebookVariableOf(dpiType, field)?.description || (field as Field & { description?: string }).description || '').trim()
}

/** The values a field allows, in codebook order, joined with ", ". Empty for free text. */
export function allowedValuesOf (dpiType: DPIType, field: Field) {
  const listed = codebookVariableOf(dpiType, field)?.categories.split('\n').filter(Boolean)
  const categories = (field as Field & { categories?: { value: string | number }[] }).categories?.map(category => String(category.value))
  return (listed?.length ? listed : field.constraints?.enum?.map(String) ?? categories ?? []).join(', ')
}
