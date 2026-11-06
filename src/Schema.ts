// The schema of each DPI table, from the datapackage.json of the release the site shows (D71, src/ReleaseFiles.ts)
import rootPackage from '../datapackage.json'
import { release, releasePackage as datapackage } from './ReleaseFiles'
import { placeLabel } from './Places'
import { siteFields, type SiteField, type ResourceName, type FieldId } from './SiteFields'

export type { Kind } from './SiteFields'

/** A column in the data, as described by a resource's schema in datapackage.json, plus how the site shows it */
export interface Field<Id extends string = string> {
  /** the column header in the data */
  name: string
  /** stable snake_case id. Code refers to fields by id, never by header */
  id: Id
  /** the codebook's variable name, if the codebook covers the field */
  title: string
  type: string
  format?: string
  constraints?: {
    required?: boolean
    unique?: boolean
    enum?: (string | number)[]
    pattern?: string
  }
  /** from src/SiteFields.ts */
  site: SiteField
}

/** A missing value, like `NA`: Data Package v2 allows text, or text with a label that says what it means */
export type MissingValue = string | { value: string, label?: string }

export interface Schema<Id extends string = string> {
  missingValues?: MissingValue[]
  /** column headers (field names) that together identify a row */
  primaryKey?: string[]
  fields: Field<Id>[]
}

/** The datapackage.json resource for each dpiType */
export const resourceNames = {
  id: 'identity',
  pay: 'payment',
  data: 'exchange'
} as const satisfies Record<string, ResourceName>

export type DPIType = keyof typeof resourceNames

/** How a system's type is named on its page */
export const typeLabels: Record<DPIType, string> = {
  id: 'Digital ID',
  pay: 'Payment',
  data: 'Data Exchange'
}
type IdOf<D extends DPIType> = FieldId<typeof resourceNames[D]>

/** Where a dpiType's schema lives, for error messages */
export const schemaSource = (dpiType: DPIType) => `public/data/${release}/datapackage.json resource "${resourceNames[dpiType]}"`

/**
 * The resource's schema, with each field's entry from src/SiteFields.ts.
 * Throws if a field has no entry, or an entry is for a field that's in neither the release's datapackage.json
 * nor the root one, the next release's (D71), or flag and text fields don't have a unique order.
 */
function schemaOf<D extends DPIType> (dpiType: D) {
  const name = resourceNames[dpiType]
  const resource = datapackage.resources.find(resource => resource.name === name)
  if (!resource) throw new Error(`No ${schemaSource(dpiType)}`)
  const fields = resource.schema.fields as unknown as Omit<Field, 'site'>[]
  const site: Record<string, SiteField> = siteFields[name]
  const where = `src/SiteFields.ts siteFields.${name}`
  for (const field of fields) {
    if (!site[field.id]) throw new Error(`Field "${field.id}" in ${schemaSource(dpiType)} has no entry in ${where}`)
  }
  const orders = new Set<string>()
  for (const [id, entry] of Object.entries(site)) {
    // an entry may be for a field of the next release, which only the root datapackage.json has yet
    const next = rootPackage.resources.find(resource => resource.name === name)?.schema.fields ?? []
    if (!fields.some(field => field.id === id) && !next.some(field => field.id === id)) {
      throw new Error(`${where} has "${id}", which is not a field id in ${schemaSource(dpiType)} or the root datapackage.json`)
    }
    if (entry.kind === 'flag' || entry.kind === 'text') {
      const key = `${entry.kind} ${entry.order}`
      if (!Number.isInteger(entry.order) || orders.has(key)) throw new Error(`${where}.${id} needs an order that no other ${entry.kind} field has`)
      orders.add(key)
    }
  }
  return {
    ...resource.schema,
    fields: fields.map(field => ({ ...field, site: site[field.id] }))
  } as Schema<IdOf<D>>
}

export const schemas = {
  id: schemaOf('id'),
  pay: schemaOf('pay'),
  data: schemaOf('data')
}

/** The schema's missing values as text, like `NA`. The default is `[""]`, as in Data Package (D38). */
export const missingValuesOf = (schema: Schema) =>
  (schema.missingValues ?? ['']).map(missing => typeof missing === 'string' ? missing : missing.value)

/** What a missing value means, from its label in the schema, if it has one */
export function missingLabelOf (schema: Schema, value: string) {
  for (const missing of schema.missingValues ?? []) {
    if (typeof missing !== 'string' && missing.value === value) return missing.label
  }
}

/**
 * Whether a cell has no value: it's one of the schema's missing values, like `NA` (D36, D38).
 * An empty cell is missing only if the schema says so: with `["NA"]`, `""` is an empty string.
 */
export const isMissing = (schema: Schema, value?: string) => value === undefined || missingValuesOf(schema).includes(value)

/**
 * The label the site shows for a field, outside the changelog, which uses the codebook's `title`.
 * The Country / Region field is "Region" or "Country" by the system's `place`, its value in that field.
 */
export const labelOf = (field: Field, place?: string) =>
  field.site.kind === 'country' ? placeLabel(place ?? '') : field.site.label ?? field.title

/** The field's variable name in the codebook, or undefined if the codebook doesn't cover it */
export const codebookNameOf = (field: Field) => field.site.codebook === false ? undefined : field.title

/** The field with `id`. Throws if there isn't one, so a typo fails the build. */
export function fieldById<Id extends string> (schema: Schema<Id>, id: NoInfer<Id>) {
  const field = schema.fields.find(field => field.id === id)
  if (!field) {
    const dpiType = (Object.keys(schemas) as DPIType[]).find(dpiType => schemas[dpiType] === schema)
    throw new Error(`No field with id "${id}" in ${dpiType ? schemaSource(dpiType) : 'schema'}`)
  }
  return field
}

type Transforms<Id extends string> = Partial<Record<Id, (value: any, get: (id: Id) => any) => unknown>>

/**
 * Turn a row keyed by raw column header into a record keyed by field id, like `record.country`.
 * `transforms` maps a field id to a function that fixes up its value. It is
 * passed `get`, to read another field of the same row by id.
 */
export function toRecord<Id extends string> (schema: Schema<Id>, row: Record<string, unknown>, transforms: NoInfer<Transforms<Id>> = {}) {
  const get = (id: Id) => row[fieldById(schema, id).name]
  const record: Record<string, any> = {}
  for (const field of schema.fields) {
    const transform = transforms[field.id]
    const value = row[field.name]
    // the site's data may predate the System ID column
    if (field.site.kind === 'hidden' && value === undefined) continue
    record[field.id] = transform ? transform(value, get) : value
  }
  return record as Partial<Record<Id, any>> & Record<string, any>
}
