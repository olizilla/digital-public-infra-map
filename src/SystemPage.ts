// What a system's page (/<system-id>, src/pages/[system].astro) shows beyond its values:
// the fields grouped by attribute, each value's evidence and history, the change log,
// and the verdict sentence from the DPI test. All of it comes from the release and its
// per-cell history (src/Release.ts), through src/Systems.ts.
import { schemas, fieldById, labelOf, missingLabelOf, missingValuesOf, type DPIType, type Field } from './Schema'
import { codebookVariableOf, meaningsOf } from './Codebook'
import { dpiTest, statusOf, type Criterion } from './DpiTest'
import { historyFor, sourcesFor, type System } from './Systems'
import { baselineRelease, changesetRelease } from './Release'
import { parseDate } from './Util'
import { listValues } from '../scripts/fields.mjs'
import { attributeOfIndicator } from './Methodology'

/** The dataset snapshot the history starts from: the 2026-03-31 release (src/Release.ts) */
export const snapshotDate = baselineRelease

/** "2025-09-03" as "Sep 2025", or the text as it is if it isn't a date */
export function monthYear (date: string) {
  return parseDate(date)?.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) ?? date
}

/**
 * The branch the changeset links point at: the one Cloudflare Pages is building, so a
 * preview links to files on its own branch, which may not be on main yet.
 */
const sourceBranch = process.env.CF_PAGES_BRANCH || 'main'

/** A released changeset's file on GitHub: changesets/<release>/<resource>/<id>.toml */
export function changesetUrl (resource: string, id: string) {
  const release = changesetRelease(resource, id)
  if (!release) throw new Error(`${resource} changeset ${id} is not in a release, so it has no link`)
  return `https://github.com/olizilla/digital-public-infra-map/blob/${sourceBranch}/changesets/${release}/${resource}/${id}.toml`
}

/** An author in git's format, `Name <email>`, as the name alone */
export const authorName = (author?: string) => author?.replace(/\s*<[^>]*>\s*$/, '').trim() || undefined

/** A URL's host, without `www.` */
export const domainOf = (url: string) => URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : url

/** A URL without its scheme, and readable where it's percent-encoded, for showing in full */
export function shortUrl (url: string) {
  let text = url
  try { text = decodeURI(url) } catch {}
  return text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

const validUrls = (urls: string[] = []) => urls.filter(url => URL.canParse(url))

// --- fields, by attribute ---

/** Kinds of field the page doesn't list: the System ID, the place, and the derived fields */
const notListed = new Set(['hidden', 'country', 'updated', 'count'])
/** Whether the page lists a field, so it has a row to link to */
export const isListed = (field: Field) => !notListed.has(field.site.kind)
/** Within an attribute: yes/no flags, then the name and website, then text fields */
const kindRank: Record<string, number> = { flag: 0, name: 1, url: 2, text: 3 }

/** The attribute a field's framework indicator measures, 1 to 6, or 0 if it has none (src/Methodology.ts) */
function attributeOf (dpiType: DPIType, field: Field) {
  return attributeOfIndicator(dpiType, codebookVariableOf(dpiType, field)?.indicator ?? '')
}

/** The fields the page lists, by attribute id (0 for "About the system"), each in display order */
export function fieldsByAttribute (dpiType: DPIType) {
  const byAttribute = new Map<number, Field[]>()
  ;(schemas[dpiType].fields as Field[])
    .map((field, index) => ({ field, index, attribute: attributeOf(dpiType, field) }))
    .filter(({ field }) => !notListed.has(field.site.kind))
    .sort((a, b) => {
      const order = (f: Field) => 'order' in f.site ? f.site.order : 0
      return a.attribute - b.attribute || kindRank[a.field.site.kind] - kindRank[b.field.site.kind] || order(a.field) - order(b.field) || a.index - b.index
    })
    .forEach(({ field, attribute }) => byAttribute.set(attribute, [...(byAttribute.get(attribute) ?? []), field]))
  return byAttribute
}

/** What a field means: its definition, how it's coded, and the framework indicator it measures */
export function meaningOf (dpiType: DPIType, field: Field) {
  const variable = codebookVariableOf(dpiType, field)
  const description = variable?.description || (field as Field & { description?: string }).description || ''
  const missing = missingValuesOf(schemas[dpiType])[0] ?? 'NA'
  const enumValues = field.constraints?.enum?.map(String)
  const listed: string[] | undefined = enumValues ? undefined : listValues(field)
  const allowed = enumValues ?? listed
  const { meaningOf } = meaningsOf(field)
  const or = (values: string[]) => values.length === 1 ? values[0] : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`
  // D37, D61: NA is the missing value, and Not Found is a value
  const missingMeaning = meaningOf(missing) ?? missingLabelOf(schemas[dpiType], missing) ?? 'no answer: not researched yet'
  const rule = allowed && `Coded ${listed ? 'one or more of ' : ''}${or(allowed)}; ${missing}: ${missingMeaning.replace(/\.$/, '')}.`
  const codes = (allowed ?? []).flatMap(value => {
    const meaning = meaningOf(value)
    return meaning ? [{ value, meaning }] : []
  })
  const indicator = variable?.indicator.match(/^\s*\d+\.\d/) ? variable.indicator.trim() : undefined
  return { description, codebook: !!variable, rule, codes, indicator }
}

// --- a value's history ---

export interface HistoryItem {
  changeset: string
  type: string
  as_of: string
  value: string
  /** the value before this change, if there was one and it changed */
  previous?: string
  valueChanged: boolean
  /** the change's sources that are URLs */
  sources: string[]
  reason: string
  author?: string
}

/** How the value got where it is, for the field's summary line */
export type Provenance =
  | { kind: 'snapshot' }
  | { kind: 'changed' | 'added' | 'source' | 'restated', date: string }

/**
 * Everything the page shows about one of a system's values: its history, newest first,
 * how many changesets changed it, where it came from, and its evidence, each link with where it came from.
 */
export function storyOf (system: System, fieldId: string) {
  const oldestFirst = historyFor(system, fieldId)
  const items: HistoryItem[] = oldestFirst.map((entry, i) => ({
    changeset: entry.changeset,
    type: entry.type,
    as_of: entry.as_of,
    value: entry.value,
    ...(i > 0 && entry.valueChanged ? { previous: oldestFirst[i - 1].value } : {}),
    valueChanged: entry.valueChanged,
    sources: validUrls(entry.sources),
    reason: entry.reason.trim(),
    ...(entry.author ? { author: entry.author } : {})
  }))
  const last = items.at(-1)
  const provenance: Provenance | undefined = !last
    ? undefined
    : last.type === 'snapshot' ? { kind: 'snapshot' }
    // the first value the field had, as when a system is created
    : { kind: last.type === 'create' || items.length === 1 ? 'added' : last.valueChanged ? 'changed' : last.sources.length ? 'source' : 'restated', date: last.as_of }
  // each link, with the change that first gave it
  const evidence = sourcesFor(system, fieldId).map(url => ({ url, from: items.find(item => item.sources.includes(url))! }))
  return {
    history: items.toReversed(),
    changes: items.filter(item => item.type !== 'snapshot').length,
    provenance,
    evidence,
  }
}

// --- the change log ---

export interface LogItem {
  changeset: string
  date: string
  author?: string
  /** a created system's first changeset */
  created: boolean
  /** fields whose value it changed */
  changed: Field[]
  /** fields whose value it kept and gave sources */
  sourced: Field[]
  /** fields whose value it restated, with no sources */
  restated: Field[]
}

/**
 * The changesets that touched a system, newest first, and the snapshot it started from, if any:
 * how many of its fields the snapshot had, and when they were researched.
 */
export function changeLogOf (system: System) {
  const items = new Map<string, LogItem>()
  let snapshot: { fields: number, researched: string } | undefined
  for (const field of schemas[system.dpiType].fields as Field[]) {
    for (const entry of historyFor(system, field.id)) {
      if (entry.type === 'snapshot') {
        snapshot = { fields: (snapshot?.fields ?? 0) + (isListed(field) ? 1 : 0), researched: entry.as_of || snapshot?.researched || '' }
        continue
      }
      const item = items.get(entry.changeset) ?? { changeset: entry.changeset, date: '', created: false, changed: [], sourced: [], restated: [], ...(entry.author ? { author: entry.author } : {}) }
      if (entry.as_of > item.date) item.date = entry.as_of
      if (entry.type === 'create') item.created = true
      ;(entry.valueChanged ? item.changed : entry.sources?.length ? item.sourced : item.restated).push(field)
      items.set(entry.changeset, item)
    }
  }
  const log = [...items.values()].sort((a, b) => b.date.localeCompare(a.date) || b.changeset.localeCompare(a.changeset))
  return { log, snapshot }
}

/** A short title for a change log entry, like "Changed: Governing entity" or "Changed 5 fields" */
export function logTitle (item: LogItem) {
  const fields = (n: number) => `${n} field${n === 1 ? '' : 's'}`
  if (item.created) return { text: `Added this system, with ${fields(item.changed.filter(isListed).length)}` }
  const { changed, sourced, restated } = item
  const only = (list: Field[]) => list.length === 1 && changed.length + sourced.length + restated.length === 1
  if (only(changed)) return { text: 'Changed: ', field: changed[0] }
  if (only(sourced)) return { text: 'Source added: ', field: sourced[0] }
  if (only(restated)) return { text: 'Value unchanged: ', field: restated[0] }
  // a restatement with no sources isn't a source added (code review S9)
  const parts = [
    ...(changed.length ? [`changed ${fields(changed.length)}`] : []),
    ...(sourced.length ? [`sources added to ${fields(sourced.length)}`] : []),
    ...(restated.length ? [`${fields(restated.length)} unchanged`] : [])
  ]
  const text = parts.join(', ')
  return { text: text[0].toUpperCase() + text.slice(1) }
}

// --- the verdict ---

/** The page's anchor for a field's row */
export const fieldAnchor = (fieldId: string) => `f-${fieldId}`

/**
 * The DPI test as a sentence: "DPI-like", or "Not yet DPI-like" with the reasons, each
 * linking to the field it's about. The implementation status comes first.
 */
export function verdictOf (dpiType: DPIType, record: Record<string, any>) {
  const criteria = dpiTest(dpiType, record)
  if (criteria.every(c => c.value === 'Yes')) return { passes: true, reasons: [] }
  const reasons: { text: string, field: string, after: string }[] = []
  // "it isn’t active yet", "it’s suspended", "there isn’t enough information on its status" (Not Found) or "its status isn’t recorded" (NA)
  const { reason } = statusOf(dpiType, record)
  if (reason) reasons.push({ text: reason.text, field: 'status', after: reason.after })
  // each failing criterion by its field's name, as in the codebook, and what the field says: "is No" for
  // a Yes/No answer, or the value itself where the test reads a value (Operator, Sector-specific / Cross-sectoral)
  for (const c of criteria.filter((c: Criterion) => c.field !== 'status' && c.value !== 'Yes')) {
    const field = fieldById(schemas[dpiType], c.field as never)
    const value = String(record[c.field] ?? '')
    const after = !value || value === 'NA' ? ' isn’t recorded' : /^no\b/i.test(value) ? ' is No' : ` is ${value}`
    reasons.push({ text: labelOf(field), field: c.field, after })
  }
  return { passes: false, reasons }
}

/** The joiner before the i-th of n items: "a, b and c" */
export const joiner = (i: number, n: number) => i === 0 ? '' : i === n - 1 ? ' and ' : ', '
