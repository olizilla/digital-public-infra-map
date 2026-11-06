import slug from 'slug'
import { releasePackage as datapackage } from './ReleaseFiles'
import { schemas, schemaSource, labelOf, codebookNameOf, resourceNames, typeLabels, type DPIType, type Field } from './Schema'
import { listValues } from '../scripts/fields.mjs'

export type { DPIType }

/** A value of a field, and what it means, as in a Table Schema `categories` list */
interface Category {
  value: string | number
  label?: string
}

/** The codebook properties of a field in datapackage.json, beyond what src/Schema.ts reads */
type CodebookField = Field & {
  /** the variable's definition */
  description?: string
  /** Table Schema v2: the field's values, each with its meaning as the `label` */
  categories?: Category[]
  /**
   * The old codebook's own list of values and their meanings, kept verbatim where it didn't match
   * the field's values. The current datapackage.json no longer uses it (every field has one
   * `categories` list), but the 2026-03-31 release's package does, so codebook changes can still
   * read what its meanings were.
   */
  codebookCategories?: Category[]
  /** "System" or "Subsystem": whether the variable describes the whole system or one of its parts */
  scope?: string
  /** the codebook's variable type, like Binary, Categorical or Nominal */
  variableType?: string
  /** the related indicator(s) in the Measuring DPI Framework */
  frameworkIndicator?: string
}

/** A codebook variable: a field of datapackage.json that the codebook covers, in the shape the site shows */
export interface CodebookVariable {
  /** the field's `title` */
  name: string
  /** the variable's id on /codebook, like `id-claim-of-digital-id` */
  anchor: string
  description: string
  type: string
  /** the values the field allows, one per line, or '' if it allows any text */
  categories: string
  /** the values that have a meaning, with the meaning */
  codes: { key: string, value: string }[]
  scope: string
  indicator: string
}

function variableOf (dpiType: DPIType, field: CodebookField): CodebookVariable {
  const allowed = field.constraints?.enum ?? listValues(field) ?? []
  return {
    name: field.title,
    anchor: `${dpiType}-${slug(field.title)}`,
    description: field.description ?? '',
    type: field.variableType ?? '',
    categories: allowed.join('\n'),
    codes: (field.codebookCategories ?? field.categories ?? [])
      .filter(category => category.label !== undefined)
      .map(category => ({ key: String(category.value), value: category.label! })),
    scope: field.scope ?? '',
    indicator: field.frameworkIndicator ?? ''
  }
}

/**
 * The codebook variables for each dpiType, in the schema's field order, built
 * from the release's datapackage.json (D71, src/ReleaseFiles.ts). Fields marked `codebook: false` in src/SiteFields.ts are left out.
 */
export const codebook = Object.fromEntries(
  (Object.keys(schemas) as DPIType[]).map(dpiType => [
    dpiType,
    (schemas[dpiType].fields as Field[])
      .filter(field => codebookNameOf(field) !== undefined)
      .map(field => variableOf(dpiType, field))
  ])
) as Record<DPIType, CodebookVariable[]>

// Each variable's anchor must be unique, so a link to it can't land on another variable.
for (const dpiType of Object.keys(codebook) as DPIType[]) {
  const anchors = new Set<string>()
  for (const { name, anchor } of codebook[dpiType]) {
    if (anchors.has(anchor)) throw new Error(`Codebook variable "${name}" (${dpiType}) has the same anchor as another, "${anchor}". Give one of the fields a different title.`)
    anchors.add(anchor)
  }
}

/** The path of a field's variable page, like `/codebook/payment/status/` */
export const variablePath = (dpiType: DPIType, field: Field) => `/codebook/${resourceNames[dpiType]}/${field.id}/`

function findVariable (dpiType: DPIType, name: string) {
  return codebook[dpiType].find(variable => variable.name === name)
}

/** The field's codebook variable, or undefined if the codebook doesn't cover it */
export function codebookVariableOf (dpiType: DPIType, field: Field) {
  const name = codebookNameOf(field)
  return name === undefined ? undefined : findVariable(dpiType, name)
}

/**
 * The path of the variable page for a card label, like `/codebook/payment/status`, via the schema field with that label.
 * @throws if the field has no codebook variable
 */
export function codebookPathForLabel (dpiType: DPIType, label: string) {
  const field = (schemas[dpiType]?.fields as Field[] | undefined)?.find(field => labelOf(field) === label)
  const variable = field && codebookVariableOf(dpiType, field)
  if (!variable) {
    const source = dpiType in schemas ? schemaSource(dpiType) : 'datapackage.json'
    throw new Error(
      `Broken codebook link: dpiType "${dpiType}", label "${label}" has no codebook variable. ` +
      (field
        ? `Field "${field.id}" is marked \`codebook: false\` in src/SiteFields.ts. Remove that if the codebook covers it, or don't link this label.`
        : `No field in ${source} has that label.`)
    )
  }
  return variablePath(dpiType, field)
}

/** The schema field described by the codebook variable with this name, or undefined if there isn't one */
export function fieldOfVariable (dpiType: DPIType, name: string) {
  return (schemas[dpiType].fields as Field[]).find(field => codebookNameOf(field) === name)
}

const normalise = (text: string) => text.replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim()

/**
 * Whether a `codebookCategories` entry describes `value`: the same text, ignoring spacing, the value
 * as an abbreviation in brackets, like `(P2P) Person-to-Person` or `Central bank digital currencies (CBDC)`,
 * or the value with its expansion in brackets, like `Private PSP (Payment Service Provider)`.
 */
const describes = (key: string, value: string) =>
  normalise(key) === normalise(value) || key.startsWith(`(${value}) `) || key.endsWith(` (${value})`) || key.startsWith(`${value} (`)

/**
 * What a field's values mean. `categories` gives each allowed value's meaning directly. Where the
 * codebook's values don't match the field's, they're in `codebookCategories` as written, so each
 * is matched to a value by `describes`; `unmatched` are those that describe no allowed value.
 */
export function meaningsOf (field: Field) {
  const { categories, codebookCategories } = field as CodebookField
  const allowed = (field.constraints?.enum ?? listValues(field) ?? []).map(String)
  if (!codebookCategories) {
    const byValue = new Map((categories ?? []).map(({ value, label }) => [String(value), label]))
    return { meaningOf: (value: string) => byValue.get(value), unmatched: [] as Category[] }
  }
  const matchOf = (value: string) => codebookCategories.find(category => describes(String(category.value), value))
  return {
    meaningOf: (value: string) => matchOf(value)?.label,
    unmatched: codebookCategories.filter(category => !allowed.some(value => describes(String(category.value), value)))
  }
}

/** The GitHub issue form for proposing a codebook change, .github/ISSUE_TEMPLATE/codebook-proposal.yml */
const proposalForm = 'https://github.com/olizilla/digital-public-infra-map/issues/new?template=codebook-proposal.yml'

/**
 * A link to the codebook proposal form. GitHub fills in a form's text fields (input and textarea)
 * from query parameters named by field id, but not its dropdowns, so the DPI system goes in the title.
 */
export function proposalUrl (dpiType?: DPIType, field?: Field) {
  if (!dpiType || !field) return proposalForm
  const params = {
    title: `Codebook: ${typeLabels[dpiType]}, ${field.title}`,
    variable: `${field.title} (${field.id})`
  }
  return proposalForm + Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')
}

/**
 * A retired field and its rule, from `retiredFields` in datapackage.json (D7). None are recorded
 * yet, so the shape may change: `id` is the retired field id, with `rule: "ignore"`, or `mapTo`
 * naming the field its values now live in, with a map of old value to new.
 */
export interface RetiredField {
  resource?: string
  id: string
  rule?: string
  mapTo?: string
  values?: Record<string, string>
  [key: string]: unknown
}

/** The `retiredFields` entries that concern a field: retired fields mapped to it */
export function historyOf (dpiType: DPIType, field: Field): RetiredField[] {
  const name = resourceNames[dpiType]
  const resource = datapackage.resources.find(r => r.name === name) as { retiredFields?: RetiredField[] } | undefined
  const entries = [
    ...((datapackage as { retiredFields?: RetiredField[] }).retiredFields ?? []).filter(entry => entry.resource === name),
    ...(resource?.retiredFields ?? [])
  ]
  return entries.filter(entry => entry.id === field.id || entry.mapTo === field.id)
}
