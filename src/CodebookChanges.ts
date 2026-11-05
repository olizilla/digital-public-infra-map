// What changed in the codebook between two datapackage.json files: the previous release's
// (public/data/<previous>/datapackage.json) and this one's. For the changelog pages, which show it
// per DPI type beside the data's changes (src/pages/changes/). It compares each resource's fields by
// id: the fields added and removed, the allowed values added and removed, the definitions and value
// meanings reworded, and the missing values. It reads only the two packages, so it works for any pair.
import { listValues } from '../scripts/fields.mjs'
import { meaningsOf } from './Codebook'
import type { Field, MissingValue } from './Schema'

/** A field of a datapackage.json resource, with the codebook properties this reads */
type PackageField = Omit<Field, 'site'> & { description?: string }
interface PackageResource { name: string, schema?: { fields?: PackageField[], missingValues?: MissingValue[] } }
export interface Package { resources: PackageResource[] }

/** A field as either package has it */
export interface FieldRef {
  id: string
  /** the codebook's variable name */
  title: string
  /** the column header, which can differ from the title */
  name: string
  description: string
}

export interface AddedField extends FieldRef {
  /** removed fields it replaces, as its definition says */
  replaces: FieldRef[]
}

export interface RemovedField extends FieldRef {
  replacedBy: FieldRef[]
}

/** A value newly allowed, or no longer allowed, on one or more fields, with what it means */
export interface ValueGroup {
  value: string
  meaning?: string
  fields: FieldRef[]
}

/** A field's definition, or a value's meaning, before and after */
export interface Reworded {
  field: FieldRef
  /** the value whose meaning changed, or undefined for the field's definition */
  value?: string
  before: string
  after: string
}

/** A missing value, like NA, that was added, removed or given a new label */
export interface MissingChange {
  value: string
  before?: { label?: string }
  after?: { label?: string }
}

export interface ResourceChanges {
  fields: { before: number, after: number }
  added: AddedField[]
  removed: RemovedField[]
  valuesAdded: ValueGroup[]
  valuesRemoved: ValueGroup[]
  /** how many fields in both gain an allowed value, and lose one */
  fieldsGaining: number
  fieldsLosing: number
  definitions: Reworded[]
  meanings: Reworded[]
  missing: MissingChange[]
  /** whether anything changed */
  any: boolean
}

const refOf = (field: PackageField): FieldRef => ({ id: field.id, title: field.title, name: field.name, description: field.description ?? '' })

/**
 * The top-level alternatives of a regex, like `https?://\S+` and `Not Found` in `https?://\S+|Not Found`,
 * or undefined if a group isn't closed.
 */
function alternatives (pattern: string) {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') i++
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === '|' && depth === 0) {
      out.push(pattern.slice(start, i))
      start = i + 1
    }
  }
  out.push(pattern.slice(start))
  return depth === 0 ? out : undefined
}
const literal = /^(?:\\.|[^\\|()[\]{}*+?.^$])+$/

/**
 * The values a field allows by name: its enum, the values of a multi-valued field's pattern, or the
 * plain-text alternatives of any other pattern, like `Not Found` in `https?://\S+|Not Found`.
 */
export function allowedValues (field: PackageField): string[] {
  const listed = field.constraints?.enum?.map(String) ?? listValues(field)
  if (listed) return listed
  const pattern = field.constraints?.pattern
  return (pattern ? alternatives(pattern) ?? [] : []).filter(text => literal.test(text)).map(text => text.replace(/\\(.)/g, '$1'))
}

/**
 * Whether an added field replaces a removed one, as the added field's definition says: it
 * "replaces" the removed field by its title, or replaces the variable "of the same name" and has the
 * removed field's title.
 */
function replaces (added: PackageField, removed: PackageField) {
  const said = added.description?.match(/\breplaces\b(.*)/s)?.[1]
  if (said === undefined) return false
  return said.includes(removed.title) || (/\bof the same name\b/.test(said) && added.title === removed.title)
}

/** Group fields' values by value and meaning, in the order first seen */
function group (entries: { field: FieldRef, value: string, meaning?: string }[]): ValueGroup[] {
  const groups = new Map<string, ValueGroup>()
  for (const { field, value, meaning } of entries) {
    const key = JSON.stringify([value, meaning ?? null])
    const found = groups.get(key)
    if (found) found.fields.push(field)
    else groups.set(key, { value, ...(meaning !== undefined ? { meaning } : {}), fields: [field] })
  }
  // the values on the most fields first
  return [...groups.values()].sort((a, b) => b.fields.length - a.fields.length)
}

const missingOf = (list: MissingValue[] = ['']) => new Map(list.map(m => typeof m === 'string' ? [m, {}] : [m.value, m.label !== undefined ? { label: m.label } : {}]))

/** What changed in one resource's schema between two packages */
export function resourceChanges (before: PackageResource | undefined, after: PackageResource | undefined): ResourceChanges {
  const old = before?.schema?.fields ?? []
  const now = after?.schema?.fields ?? []
  const oldById = new Map(old.map(f => [f.id, f]))
  const nowById = new Map(now.map(f => [f.id, f]))
  const addedFields = now.filter(f => !oldById.has(f.id))
  const removedFields = old.filter(f => !nowById.has(f.id))

  const added = addedFields.map(f => ({ ...refOf(f), replaces: removedFields.filter(r => replaces(f, r)).map(refOf) }))
  const removed = removedFields.map(r => ({ ...refOf(r), replacedBy: addedFields.filter(f => replaces(f, r)).map(refOf) }))

  const gained: { field: FieldRef, value: string, meaning?: string }[] = []
  const lost: typeof gained = []
  const definitions: Reworded[] = []
  const meanings: Reworded[] = []
  for (const f of now) {
    const o = oldById.get(f.id)
    if (!o) continue
    const ref = refOf(f)
    const [was, is] = [allowedValues(o), allowedValues(f)]
    const meaningNow = meaningsOf(f as Field).meaningOf
    const meaningThen = meaningsOf(o as Field).meaningOf
    for (const value of is) if (!was.includes(value)) gained.push({ field: ref, value, meaning: meaningNow(value) })
    for (const value of was) if (!is.includes(value)) lost.push({ field: ref, value, meaning: meaningThen(value) })
    if ((o.description ?? '') !== (f.description ?? '')) definitions.push({ field: ref, before: o.description ?? '', after: f.description ?? '' })
    for (const value of is) {
      if (!was.includes(value)) continue
      const [then, nowMeaning] = [meaningThen(value) ?? '', meaningNow(value) ?? '']
      if (then !== nowMeaning) meanings.push({ field: ref, value, before: then, after: nowMeaning })
    }
  }

  const [missingThen, missingNow] = [missingOf(before?.schema?.missingValues), missingOf(after?.schema?.missingValues)]
  const missing: MissingChange[] = []
  for (const value of new Set([...missingThen.keys(), ...missingNow.keys()])) {
    const [b, a] = [missingThen.get(value), missingNow.get(value)]
    if (!b || !a || b.label !== a.label) missing.push({ value, ...(b ? { before: b } : {}), ...(a ? { after: a } : {}) })
  }

  const fieldsGaining = new Set(gained.map(g => g.field.id)).size
  const fieldsLosing = new Set(lost.map(g => g.field.id)).size
  return {
    fields: { before: old.length, after: now.length },
    added, removed,
    valuesAdded: group(gained), valuesRemoved: group(lost),
    fieldsGaining, fieldsLosing,
    definitions, meanings, missing,
    any: added.length + removed.length + gained.length + lost.length + definitions.length + meanings.length + missing.length > 0,
  }
}

/** What changed in each resource's schema between two packages, by resource name */
export function codebookChanges (before: Package, after: Package): Record<string, ResourceChanges> {
  const names = [...new Set([...after.resources, ...before.resources].map(r => r.name))]
  return Object.fromEntries(names.map(name => [name, resourceChanges(before.resources.find(r => r.name === name), after.resources.find(r => r.name === name))]))
}

/** One run of a word diff: text in both, only before (`del`), or only after (`ins`) */
export interface DiffPart { kind: 'same' | 'del' | 'ins', text: string }

/** A word-level diff of two texts, by the longest common run of words */
export function wordDiff (before: string, after: string): DiffPart[] {
  // words, runs of spaces and punctuation, so "systems)." and "systems." share "systems"
  const tokens = (text: string) => text.split(/(\s+|[^\s\p{L}\p{N}'’-]+)/u).filter(token => token !== '')
  const a = tokens(before)
  const b = tokens(after)
  // lengths of the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('del', a[i++])
    else push('ins', b[j++])
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('ins', b[j++])
  // a run of changes, with only spaces between them, reads better as one: all it removes, then all it adds
  const out: DiffPart[] = []
  let k = 0
  while (k < parts.length) {
    if (parts[k].kind === 'same') { out.push(parts[k++]); continue }
    let del = ''
    let ins = ''
    while (k < parts.length && (parts[k].kind !== 'same' || (/^\s+$/.test(parts[k].text) && parts[k + 1] && parts[k + 1].kind !== 'same'))) {
      const p = parts[k++]
      if (p.kind !== 'ins') del += p.text
      if (p.kind !== 'del') ins += p.text
    }
    // a space between what it removes and what it adds, so they don't run together
    if (del && ins && !/\s$/.test(del) && !/^\s/.test(ins)) del += ' '
    if (del) out.push({ kind: 'del', text: del })
    if (ins) out.push({ kind: 'ins', text: ins })
  }
  return out.filter(p => p.text !== '')
}
