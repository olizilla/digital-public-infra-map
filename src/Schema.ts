import datapackage from '../datapackage.json'
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
    enum?: (string | number)[]
    pattern?: string
  }
  /** from src/SiteFields.ts */
  site: SiteField
}

export interface Schema<Id extends string = string> {
  missingValues?: string[]
  fields: Field<Id>[]
}

/** The datapackage.json resource for each dpiType */
export const resourceNames = {
  id: 'identity',
  pay: 'payment',
  data: 'exchange'
} as const satisfies Record<string, ResourceName>

export type DPIType = keyof typeof resourceNames
type IdOf<D extends DPIType> = FieldId<typeof resourceNames[D]>

/** Where a dpiType's schema lives, for error messages */
export const schemaSource = (dpiType: DPIType) => `datapackage.json resource "${resourceNames[dpiType]}"`

/**
 * The resource's schema, with each field's entry from src/SiteFields.ts.
 * Throws if the two don't have the same field ids, or flag and text fields don't have a unique order.
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
    if (!fields.some(field => field.id === id)) throw new Error(`${where} has "${id}", which is not a field id in ${schemaSource(dpiType)}`)
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

/** The label the site shows for a field */
export const labelOf = (field: Field) => field.site.label ?? field.title

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
 * Turn a row keyed by raw column header into a record keyed by field label.
 * `transforms` maps a field id to a function that fixes up its value. It is
 * passed `get`, to read another field of the same row by id.
 */
export function toRecord<Id extends string> (schema: Schema<Id>, row: Record<string, unknown>, transforms: NoInfer<Transforms<Id>> = {}) {
  const get = (id: Id) => row[fieldById(schema, id).name]
  const record: Record<string, any> = {}
  for (const field of schema.fields) {
    const transform = transforms[field.id]
    const value = row[field.name]
    record[labelOf(field)] = transform ? transform(value, get) : value
  }
  return record
}

/** Labels of the fields of `kind` shown on cards, in display `order`. */
export function displayTitles (schema: Schema, kind: 'flag' | 'text') {
  const order = (field: Field) => 'order' in field.site ? field.site.order : 0
  return schema.fields
    .filter(field => field.site.kind === kind)
    .sort((a, b) => order(a) - order(b))
    .map(labelOf)
}

/** Labels of the text fields shown in a card's summary */
export function headlineTitles (schema: Schema) {
  const headlines = new Set(schema.fields.filter(f => 'headline' in f.site && f.site.headline).map(labelOf))
  return displayTitles(schema, 'text').filter(title => headlines.has(title))
}

/** Labels of the text fields shown only when a card is expanded */
export function otherTextTitles (schema: Schema) {
  const headlines = new Set(headlineTitles(schema))
  return displayTitles(schema, 'text').filter(title => !headlines.has(title))
}
