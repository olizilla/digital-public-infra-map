// The DPI test: the criteria a system must meet to count as DPI-like, per DPI type.
// See /methodology/. This is the one place that decides whether a system is DPI:
// its DPI Status comes from these criteria. The data's Count for DPI column (dpi_count) must
// agree: `npm run data:build` derives it from these criteria, and `npm run data:check` (D48)
// fails if the release's files don't match a rebuild.
import { schemas, fieldById, labelOf, type DPIType, type Field } from './Schema'
import { codebookVariableOf } from './Codebook'
import { normaliseImplementationStatus } from './Status'

/** a flag's answer: Yes, No, Not Found (insufficient information, including where the system isn't live yet) or NA (no answer: not researched yet), D61 */
export type YesNoNA = 'Yes' | 'No' | 'Not Found' | 'NA'
export type ImplStatus = 'Active' | 'Pilot' | 'Suspended' | 'NA'
export type DpiStatus = 'DPI' | 'WIP' | 'NA'
/** A system's row as the site uses it, by field id (src/Schema.ts toRecord), with its 'DPI Status' */
type SystemRecord = Record<string, any>

export interface Criterion {
  label: string
  value: YesNoNA
  /** shown after the label, e.g. "pilot" */
  note?: string
  /** the id of the field the criterion reads */
  field: string
}

/** Fields the DPI test already shows, so they are left out of the list of fields */
const testedFields: Record<DPIType, string[]> = {
  id: ['claim', 'digital_auth', 'sectoral_use_cases', 'status'],
  pay: ['realtime_active', 'operator', 'status'],
  data: ['sectoral', 'status'],
}

/** Kinds of field shown elsewhere on a card, or not at all */
const notDisplayed = new Set(['hidden', 'country', 'count', 'name', 'url', 'updated'])

/** The value as a trimmed string, or 'NA' when it's missing or empty */
export function text (value: unknown): string {
  if (value === undefined || value === null) return 'NA'
  return String(value).trim() || 'NA'
}

/** The value of the field with `id`, as text */
export function valueOf (dpiType: DPIType, record: SystemRecord, id: string) {
  return text(record[fieldById(schemas[dpiType], id as never).id])
}

/** 'Active', 'Pilot', 'Suspended' or 'NA' */
export function implementationStatus (value: unknown): ImplStatus {
  const s = normaliseImplementationStatus(text(value))
  return s === 'Active' || s === 'Pilot' || s === 'Suspended' ? s : 'NA'
}

/** The system's implementation status, shown on its own line above the DPI test criteria */
export function statusOf (dpiType: DPIType, record: SystemRecord): { status: ImplStatus, label: string } {
  const status = implementationStatus(valueOf(dpiType, record, 'status'))
  return { status, label: status === 'Pilot' ? 'Pilot/Planned' : status }
}

/** 'Yes', 'No', 'Not Found' or 'NA' for a flag value, or undefined if it isn't a clean answer, like a note */
export function yesNo (value: unknown): YesNoNA | undefined {
  const s = text(value)
  if (s === 'NA') return 'NA'
  if (/^not found$/i.test(s)) return 'Not Found'
  if (/^yes\b/i.test(s)) return 'Yes'
  if (/^no\b/i.test(s)) return 'No'
  return undefined
}

export function dpiTest (dpiType: DPIType, record: SystemRecord): Criterion[] {
  const get = (id: string) => valueOf(dpiType, record, id)
  // a criterion that is a field's own Yes/No answer is named by the field, as in the codebook
  const named = (id: string) => labelOf(fieldById(schemas[dpiType], id as never))
  const status = implementationStatus(get('status'))
  const active: Criterion = {
    label: 'Active',
    value: status === 'Active' ? 'Yes' : status === 'NA' ? 'NA' : 'No',
    note: status === 'Pilot' ? 'pilot' : undefined,
    field: 'status'
  }
  if (dpiType === 'id') {
    return [
      active,
      { label: named('claim'), value: yesNo(get('claim')) ?? 'NA', field: 'claim' },
      { label: named('digital_auth'), value: yesNo(get('digital_auth')) ?? 'NA', field: 'digital_auth' },
      { label: named('sectoral_use_cases'), value: yesNo(get('sectoral_use_cases')) ?? 'NA', field: 'sectoral_use_cases' },
    ]
  }
  if (dpiType === 'pay') {
    const operator = get('operator')
    return [
      active,
      { label: named('realtime_active'), value: yesNo(get('realtime_active')) ?? 'NA', field: 'realtime_active' },
      // the operator as the data has it: the test passes when it includes a central bank
      { label: operator === 'NA' ? named('operator') : `${named('operator')}: ${operator}`, value: operator === 'NA' ? 'NA' : operator === 'Not Found' ? 'Not Found' : /central/i.test(operator) ? 'Yes' : 'No', field: 'operator' },
    ]
  }
  const sectoral = get('sectoral')
  return [
    active,
    { label: 'Cross-sectoral', value: sectoral === 'NA' ? 'NA' : sectoral === 'Not Found' ? 'Not Found' : sectoral === 'Cross-sectoral' ? 'Yes' : 'No', field: 'sectoral' },
  ]
}

export const passesDpiTest = (criteria: Criterion[]) => criteria.every(c => c.value === 'Yes')

/** 'DPI' if the system passes the DPI test, 'WIP' if it's active or a pilot but doesn't pass, otherwise 'NA'. A suspended system is 'NA'. */
export function dpiStatus (dpiType: DPIType, record: SystemRecord): DpiStatus {
  if (passesDpiTest(dpiTest(dpiType, record))) return 'DPI'
  const status = implementationStatus(valueOf(dpiType, record, 'status'))
  return status === 'NA' || status === 'Suspended' ? 'NA' : 'WIP'
}

/**
 * The attribute number of the codebook indicator a field measures, e.g. 3 for "3.2 ...", or 0.
 * The indicator is the field's `frameworkIndicator` in datapackage.json.
 */
function attributeOf (dpiType: DPIType, field: Field) {
  const variable = codebookVariableOf(dpiType, field)
  const match = variable?.indicator.match(/^\s*(\d+)\./)
  return match ? Number(match[1]) : 0
}

/**
 * The fields a card lists, in display order: grouped by the attribute their
 * codebook indicator measures, then by their order in src/SiteFields.ts.
 * Fields the DPI test already shows are left out.
 */
export function displayFields (dpiType: DPIType): Field[] {
  const schema = schemas[dpiType]
  const order = (f: Field) => 'order' in f.site ? f.site.order : 0
  return schema.fields
    .map((field, index) => ({ field, index, attribute: attributeOf(dpiType, field) }))
    .filter(({ field }) => !notDisplayed.has(field.site.kind) && !testedFields[dpiType].includes(field.id))
    .sort((a, b) => a.attribute - b.attribute || order(a.field) - order(b.field) || a.index - b.index)
    .map(({ field }) => field)
}

export interface DisplayValue { label: string, value: string, flag?: YesNoNA, /** the field's id */ id: string }

/** A system's display fields split into yes/no flags and text values */
export function displayValues (dpiType: DPIType, record: SystemRecord) {
  const flags: DisplayValue[] = []
  const texts: DisplayValue[] = []
  for (const field of displayFields(dpiType)) {
    const label = labelOf(field)
    const value = text(record[field.id])
    const flag = field.site.kind === 'flag' ? yesNo(value) : undefined
    if (flag) flags.push({ label, value, flag, id: field.id })
    else texts.push({ label, value, id: field.id })
  }
  return { flags, texts, count: flags.length + texts.length }
}

/** The system's name, or undefined if the data has none */
export function nameOf (dpiType: DPIType, record: SystemRecord) {
  const name = valueOf(dpiType, record, 'name')
  return name === 'NA' ? undefined : name
}

/**
 * 'named', 'unnamed' when the data has a system but not its name,
 * or 'not-found' when researchers found no system at all.
 */
export function presence (dpiType: DPIType, record: SystemRecord): 'named' | 'unnamed' | 'not-found' {
  if (nameOf(dpiType, record)) return 'named'
  return implementationStatus(valueOf(dpiType, record, 'status')) === 'NA' ? 'not-found' : 'unnamed'
}

export const nouns: Record<DPIType, string> = { id: 'digital ID', pay: 'digital payment', data: 'data exchange' }
