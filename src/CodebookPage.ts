// What the codebook pages show for a variable (src/pages/codebook.astro, the index, and
// src/pages/codebook/[resource]/[field].astro, its own page, both through CodebookVariable.astro):
// one table of every value it can have, each with its definition and the systems that have it,
// then Not Found, a soft No, and NA, not researched yet, and the line that says what kind of variable it is.
//
// The values and their definitions are the dataset's own, verbatim (datapackage.json `categories`
// and `missingValues`). It shows only the values datapackage.json declares: a system whose value
// isn't one of them is in no row. A Yes, No, Not Found or NA whose definition is the codebook's standard one
// is marked standard, so the index can say it once instead of on every variable, and shows the
// standard values' own wording, as the codebook index's "Standard values" box gives it.
import { schemas, missingLabelOf, missingValuesOf, isMissing, type DPIType, type Field, type Schema } from './Schema'
import { codebookVariableOf, meaningsOf } from './Codebook'
import { dpiTest, nouns } from './DpiTest'
import { indicatorsOf } from './Methodology'
import { systems, type System } from './Systems'
import { listValues, listSeparator } from '../scripts/fields.mjs'

/**
 * The value that means the research looked in public sources and found too little to answer (D61):
 * a soft No, not yet a definite one. An ordinary value of each field, unlike NA, the missing value.
 */
export const NOT_FOUND = 'Not Found'

/**
 * What Yes and No mean when a variable doesn't say: the codebook page's own sentence, verbatim.
 * The codebook has no `categories` label for most Yes and No values.
 */
export const yesNoStandard = 'Unless specified otherwise, yes/no values are used to indicate presence or absence of a binary variable.'

type Category = { value: string | number, label?: string }
const categoriesOf = (field: Field) => ((field as Field & { categories?: Category[] }).categories ?? [])

/** Not Found's definition: the label most fields give it in datapackage.json, the codebook's own text */
export const notFoundStandard = (() => {
  const counts = new Map<string, number>()
  for (const schema of Object.values(schemas) as Schema[]) {
    for (const field of schema.fields) {
      const label = categoriesOf(field).find(category => category.value === NOT_FOUND)?.label
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  const [label] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
  if (!label) throw new Error(`No field in datapackage.json defines "${NOT_FOUND}" in its categories`)
  return label
})()

/** NA's definition: its label in the schemas' `missingValues`, "No answer. Not researched yet." */
export const naStandard = (() => {
  const label = missingLabelOf(schemas.id, 'NA')
  if (!label) throw new Error('datapackage.json gives NA no label in missingValues')
  return label
})()

/**
 * Each of the four shared values, in the order the pages show them: its standard definition in the
 * dataset, which a variable's own definition is compared with, and what the pages say it means.
 */
export const standardDefinitions: { value: string, definition: string, text: string }[] = [
  { value: 'Yes', definition: yesNoStandard, text: 'These indicate presence or absence of a property.' },
  { value: 'No', definition: yesNoStandard, text: 'These indicate presence or absence of a property.' },
  { value: NOT_FOUND, definition: notFoundStandard, text: 'Not found. Insufficient information, including where the system is not yet live.' },
  { value: 'NA', definition: naStandard, text: 'No answer. Not researched yet.' }
]
const standardOf = new Map(standardDefinitions.map(standard => [standard.value, standard]))

/** One row of a variable's values table */
export interface ValueRow {
  value: string
  /** the value's definition, verbatim, if the codebook gives one, or the standard value's wording */
  definition?: string
  /** the definition is the standard one for Yes, No, Not Found or NA */
  standard: boolean
  /** Not Found, a soft No: shown after the other values, beside No */
  notFound: boolean
  /** a missing value, like NA, not researched yet: shown last, in grey */
  missing: boolean
  systems: System[]
}

export type ValueKind = 'yesno' | 'categorical' | 'list' | 'text'

/** A category like `Sectoral (…)` stands for any text where the … is */
const matcherOf = (category: string) => category.includes('…')
  ? new RegExp('^' + category.split('…').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$')
  : undefined

const byCountry = (a: System, b: System) => a.country.localeCompare(b.country) || a.title.localeCompare(b.title)

/** The fields whose values decide the DPI test, each with its criterion's label, like `Active` for the status */
function testCriteria (dpiType: DPIType) {
  return new Map(dpiTest(dpiType, {}).map(criterion => [criterion.field, criterion.label]))
}
const criteria = { id: testCriteria('id'), pay: testCriteria('pay'), data: testCriteria('data') }

/** Everything the codebook pages show about one variable */
export function variableView (dpiType: DPIType, field: Field) {
  const schema = schemas[dpiType] as Schema
  const variable = codebookVariableOf(dpiType, field)
  const description = variable?.description || (field as Field & { description?: string }).description || ''
  const ofType = systems.filter(system => system.dpiType === dpiType)
  const missingValues = missingValuesOf(schema)

  // the values it allows: its enum, the values of a multi-valued field's pattern, or its categories
  // where a category stands for many values, like `Sectoral (…)`. Otherwise it's free text.
  const enumValues = field.constraints?.enum?.map(String)
  const listed: string[] | undefined = enumValues ? undefined : listValues(field)
  const categories = categoriesOf(field).map(category => String(category.value))
  const patterned = !enumValues && !listed && categories.some(category => matcherOf(category)) ? categories : undefined
  const allowed = enumValues ?? listed ?? patterned
  const kind: ValueKind = !allowed ? 'text'
    : listed ? 'list'
    : allowed.length === 3 && ['Yes', 'No', NOT_FOUND].every(value => allowed.includes(value)) ? 'yesno'
    : 'categorical'

  const { meaningOf } = meaningsOf(field)
  const categoryMeaning = new Map(categoriesOf(field).map(({ value, label }) => [String(value), label]))
  const definitionOf = (value: string) => meaningOf(value) ?? categoryMeaning.get(value) ?? missingLabelOf(schema, value)

  // the systems with each declared value; a value it doesn't declare is counted in no row
  const matchers = (allowed ?? []).map(value => ({ value, test: matcherOf(value) }))
  const valueFor = (part: string) => matchers.find(({ value, test }) => value === part || test?.test(part))?.value
  const bucket = new Map<string, System[]>()
  const add = (key: string, system: System) => bucket.set(key, [...(bucket.get(key) ?? []), system])
  for (const system of ofType) {
    const value = system.values[field.id] ?? ''
    if (isMissing(schema, value) || value === NOT_FOUND) { add(value, system); continue }
    if (!allowed) continue
    const declared = new Set((listed ? value.split(listSeparator) : [value]).map(valueFor))
    for (const part of declared) if (part) add(part, system)
  }
  for (const list of bucket.values()) list.sort(byCountry)
  const systemsWith = (value: string) => bucket.get(value) ?? []

  const row = (value: string): ValueRow => {
    // a Yes, No, Not Found or NA the codebook doesn't define has the standard definition
    const standard = standardOf.get(value)
    const definition = definitionOf(value) ?? standard?.definition
    const isStandard = !!standard && definition === standard.definition
    return {
      value,
      definition: isStandard ? standard.text : definition,
      standard: isStandard,
      notFound: value === NOT_FOUND,
      missing: missingValues.includes(value),
      systems: systemsWith(value)
    }
  }

  // Not Found and the missing values, like NA, come after the others: Not Found beside No, NA last
  const lastValues = [NOT_FOUND, ...missingValues]
  const substantive = (allowed ?? []).filter(value => !lastValues.includes(value)).map(value => row(value))
  // Not Found is a row when the field declares it; each missing value, like NA, always is
  const notFoundRows = allowed?.includes(NOT_FOUND) || categories.includes(NOT_FOUND) ? [row(NOT_FOUND)] : []
  const missingRows = missingValues.map(value => row(value))
  const rows = [...substantive, ...notFoundRows, ...missingRows]

  // free text: how many systems have a value other than Not Found or NA
  const withValue = ofType.filter(system => {
    const value = system.values[field.id] ?? ''
    return !isMissing(schema, value) && value !== NOT_FOUND
  })

  const indicator = variable?.indicator.trim() ?? ''
  const indicators = indicatorsOf(dpiType, indicator)
  return {
    field,
    variable,
    description,
    kind,
    rows,
    total: ofType.length,
    noun: nouns[dpiType],
    withValue: withValue.length,
    /** the DPI test criterion the field decides, if it does */
    criterion: criteria[dpiType].get(field.id),
    /** the framework's outcome indicators it measures, each with its attribute, usually one or none */
    indicators,
    indicator
  }
}

export type VariableView = ReturnType<typeof variableView>

/** The variable's kind in words, for its meta line: "Yes / No", "One of 4 values", "Free text" */
export function kindLabel (view: VariableView) {
  const values = view.rows.filter(row => !row.notFound && !row.missing).length
  if (view.kind === 'yesno') return 'Yes / No'
  if (view.kind === 'text') return 'Free text'
  return `${view.kind === 'list' ? 'One or more of' : 'One of'} ${values} values`
}

/** "System level" or "Subsystem level", from the codebook's scope, or undefined */
export function scopeLabel (scope?: string) {
  if (scope === 'System') return 'System level'
  if (scope === 'Subsystem') return 'Subsystem level'
}
