// The build of a release's tables (D45, D50, D66), shared by the data build and the proposal check
// (scripts/release-build.ts, which re-exports it) and by the editor's pages, which show what the
// next release will be (src/NextRelease.ts, D93): release N's tables plus the changesets, replayed with
// lib/changesets, with the DPI layer's derived fields (D48, src/DpiLayer.ts).
//
// No astro: imports and nothing from the file system, so Node can load it (scripts/site-modules.ts)
// and the site's build can too. Reading the files, and writing the result, are the scripts'.
import { build, fieldId, missingValues } from '../lib/changesets/build.ts'
import type { Baseline, BuildResult, Changeset, DataPackage, Field, ReportItem, Row, Table } from '../lib/changesets/types.ts'
import { derivedFields, lastUpdatedAsOf } from './DpiLayer'
import { dpiTest, passesDpiTest } from './DpiTest'
import { isRegion, placeNamed } from './Places'
import { resourceNames, schemas, toRecord, type DPIType } from './Schema'

/** The DPI type of each DPI table, by resource name */
export const dpiTypeOf = Object.fromEntries(Object.entries(resourceNames).map(([dpiType, name]) => [name, dpiType])) as Record<string, DPIType>

/** A row keyed by field name, which is the field's id (D83), as the release's JSON has it */
const byName = (fields: Field[], row: Row) => Object.fromEntries(fields.map(field => [field.name, row[fieldId(field)]]))

/**
 * A row's ISO 3166-1 alpha-3 code, from its place's iso3 in public/data/places.csv, as src/Places.ts matches it (D68).
 * Only alpha-3: it's what other datasets join on, and three letters can't be mistaken for the missing value, NA. The
 * alpha-2 code is already the place part of each country's System ID. A region has none. Kosovo's XKX is user-assigned,
 * not official ISO, and matches the World Bank's. A code left out is the missing value, so a place that isn't matched has none.
 */
function isoCodes (country: string) {
  const place = placeNamed(country)
  if (!place || isRegion(place)) return {}
  return place.iso3 ? { iso3: place.iso3.toUpperCase() } : {}
}

export interface ReleaseBuild {
  /** The codebook the release is built with: the root datapackage.json, or a release's own */
  datapackage: DataPackage
  /** Release N, if there is one */
  baseline?: Baseline
  earlierFields: Record<string, Record<string, string>>
  /** The changesets, by resource, as one set */
  changesets: Record<string, Changeset[]>
  /** Items found while reading them */
  report: ReportItem[]
}

/** Build release N+1's tables, with the DPI layer's derived fields */
export function buildRelease ({ datapackage, baseline, earlierFields, changesets, report }: ReleaseBuild): BuildResult {
  const resourceOf = (name: string) => datapackage.resources.find(r => r.name === name)!
  return build({
    datapackage,
    baseline,
    layers: [changesets],
    report,
    baselineAsOf: lastUpdatedAsOf,
    earlierFields,
    derive: {
      fields: Object.fromEntries(Object.keys(dpiTypeOf).map(name => [name, derivedFields])),
      values: (name, row, { asOf }) => {
        const record = toRecord(schemas[dpiTypeOf[name]], byName(resourceOf(name).schema.fields, row))
        return {
          ...(asOf ? { last_updated: asOf } : {}),
          count_for_dpi: passesDpiTest(dpiTest(dpiTypeOf[name], record)) ? '1' : '0',
          ...isoCodes(row.country)
        }
      }
    },
    // a new system goes below the last system for its place (D46), so aliases group with their place
    rowGroup: (_resource, row) => placeNamed(row.country)?.code ?? row.country
  })
}

/** A cell as JSON, as the earlier releases had it: numbers for integer and number fields, else text */
function jsonValue (field: Field, value: string, missing: string[]) {
  if (missing.includes(value)) return value
  if ((field.type === 'integer' || field.type === 'number') && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

/** A built table's rows as the release's JSON has them, keyed by field name */
export function tableRecords (table: Table) {
  const missing = missingValues(table.resource)
  return table.rows.map(row => Object.fromEntries(table.fields.map(field => [field.name, jsonValue(field, row[fieldId(field)], missing)])))
}
