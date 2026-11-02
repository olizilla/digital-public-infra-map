// The DPI test: the criteria a system must meet to count as DPI-like, per DPI type.
// See /methodology/. This is the one place that decides whether a system is DPI:
// its DPI Status comes from these criteria. The data's 'Count for DPI' column must
// agree, and checkDpiCounts, run at build start (astro.config.mjs), fails the build if not.
import { schemas, fieldById, labelOf, type DPIType, type Field } from './Schema'
import { findVariable } from './Codebook'
import { normaliseImplementationStatus } from './Status'

export type YesNoNA = 'Yes' | 'No' | 'NA'
export type ImplStatus = 'Active' | 'Pilot' | 'NA'
export type DpiStatus = 'DPI' | 'WIP' | 'NA'
type SystemRecord = Record<string, any>

export interface Criterion {
  label: string
  value: YesNoNA
  /** shown after the label, e.g. "pilot" */
  note?: string
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
  return text(record[labelOf(fieldById(schemas[dpiType], id as never))])
}

/** 'Active', 'Pilot' or 'NA' */
export function implementationStatus (value: unknown): ImplStatus {
  const s = normaliseImplementationStatus(text(value))
  return s === 'Active' || s === 'Pilot' ? s : 'NA'
}

/** 'Yes', 'No' or 'NA' for a flag value, or undefined if it isn't a clean yes or no, like a note */
export function yesNo (value: unknown): YesNoNA | undefined {
  const s = text(value)
  if (s === 'NA') return 'NA'
  if (/^yes\b/i.test(s)) return 'Yes'
  if (/^no\b/i.test(s)) return 'No'
  return undefined
}

export function dpiTest (dpiType: DPIType, record: SystemRecord): Criterion[] {
  const get = (id: string) => valueOf(dpiType, record, id)
  const status = implementationStatus(get('status'))
  const active: Criterion = {
    label: 'Active',
    value: status === 'Active' ? 'Yes' : status === 'NA' ? 'NA' : 'No',
    note: status === 'Pilot' ? 'pilot' : undefined
  }
  if (dpiType === 'id') {
    return [
      active,
      { label: 'Claims a digital ID', value: yesNo(get('claim')) ?? 'NA' },
      { label: 'Digital authentication', value: yesNo(get('digital_auth')) ?? 'NA' },
      { label: 'Used across 2+ sectors', value: yesNo(get('sectoral_use_cases')) ?? 'NA' },
    ]
  }
  if (dpiType === 'pay') {
    const operator = get('operator')
    return [
      active,
      { label: 'Real-time payments', value: yesNo(get('realtime_active')) ?? 'NA' },
      { label: 'Operated by the central bank', value: operator === 'NA' ? 'NA' : /central/i.test(operator) ? 'Yes' : 'No' },
    ]
  }
  const sectoral = get('sectoral')
  return [
    active,
    { label: 'Cross-sectoral', value: sectoral === 'NA' ? 'NA' : sectoral === 'Cross-sectoral' ? 'Yes' : 'No' },
  ]
}

export const passesDpiTest = (criteria: Criterion[]) => criteria.every(c => c.value === 'Yes')

/** 'DPI' if the system passes the DPI test, 'WIP' if it's active or a pilot but doesn't pass, otherwise 'NA' */
export function dpiStatus (dpiType: DPIType, record: SystemRecord): DpiStatus {
  if (passesDpiTest(dpiTest(dpiType, record))) return 'DPI'
  return implementationStatus(valueOf(dpiType, record, 'status')) === 'NA' ? 'NA' : 'WIP'
}

/** A message for each system whose 'Count for DPI' disagrees with the DPI test. There's no good reason for any. */
export function checkDpiCounts (records: Record<DPIType, SystemRecord[]>) {
  const problems: string[] = []
  for (const dpiType of Object.keys(records) as DPIType[]) {
    const countLabel = labelOf(fieldById(schemas[dpiType], 'dpi_count'))
    for (const record of records[dpiType]) {
      const criteria = dpiTest(dpiType, record)
      const passes = passesDpiTest(criteria)
      if (passes === (record[countLabel] === 1)) continue
      const id = record['System ID'] ?? `${record.Country} / ${nameOf(dpiType, record) ?? 'unnamed'}`
      problems.push(
        `${dpiType} system "${id}": 'Count for DPI' is ${record[countLabel]}, ` +
        `but the DPI test says it ${passes ? 'passes' : 'fails'}: ` +
        criteria.map(c => `${c.label}=${c.value}`).join(', ')
      )
    }
  }
  return problems
}

/** The attribute number of the codebook indicator a field measures, e.g. 3 for "3.2 ...", or 0 */
function attributeOf (dpiType: DPIType, field: Field) {
  const variable = findVariable(dpiType, field.title)
  const match = variable?.indicator?.match(/^\s*(\d+)\./)
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

export interface DisplayValue { label: string, value: string, flag?: YesNoNA }

/** A system's display fields split into yes/no flags and text values */
export function displayValues (dpiType: DPIType, record: SystemRecord) {
  const flags: DisplayValue[] = []
  const texts: DisplayValue[] = []
  for (const field of displayFields(dpiType)) {
    const label = labelOf(field)
    const value = text(record[label])
    const flag = field.site.kind === 'flag' ? yesNo(value) : undefined
    if (flag) flags.push({ label, value, flag })
    else texts.push({ label, value })
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
