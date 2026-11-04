// Write a new changeset, for tools and checks that suggest a fix (D48). The
// TOML is laid out like the importer's: one [[changes]] table per change,
// dotted keys for values, and bare dates.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readChangeset, validateChangeset } from './log.ts'
import type { Change } from './types.ts'

const ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r' }
// what can't go in a """ string as it is: control characters and backslashes,
// three quotes in a row, and a quote at the very end
const NOT_MULTILINE = /[\x00-\x09\x0b-\x1f\x7f\\]|"""|"$/

export function tomlString (text: string): string {
  return '"' + [...text].map(ch => ESCAPES[ch] ?? (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f
    ? `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    : ch)).join('') + '"'
}

/** A string that reads better over several lines, if it has several and that's safe */
function tomlText (text: string): string {
  return text.includes('\n') && !NOT_MULTILINE.test(text) ? `"""\n${text}"""` : tomlString(text)
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/
const tomlKey = (key: string) => BARE_KEY.test(key) ? key : tomlString(key)

function tomlChange (change: Change): string {
  const lines = ['[[changes]]']
  for (const name of ['type', 'key', 'duplicate_of', 'changeset'] as const) {
    if (change[name] !== undefined) lines.push(`${name} = ${tomlString(change[name])}`)
  }
  // a bare TOML date, which reading turns back into this text
  if (change.as_of !== undefined) lines.push(`as_of = ${change.as_of}`)
  for (const [id, value] of Object.entries(change.values ?? {})) lines.push(`values.${tomlKey(id)} = ${tomlString(value)}`)
  if (change.reason !== undefined) lines.push(`reason = ${tomlText(change.reason)}`)
  for (const name of ['table', 'sources_file'] as const) {
    if (change[name] !== undefined) lines.push(`${name} = ${tomlString(change[name])}`)
  }
  if (change.sources?.length) lines.push('sources = [', ...change.sources.map(url => `  ${tomlString(url)},`), ']')
  return lines.join('\n') + '\n'
}

export interface ChangesetData { author?: string, summary?: string, changes: Change[] }

/** A changeset as TOML. Throws if it doesn't match the schema, or wouldn't read back as the same data. */
export function changesetTOML (data: ChangesetData): string {
  const errors = validateChangeset(data)
  if (errors.length) throw new Error(`not a valid changeset: ${errors.join('; ')}`)
  const head = [
    data.author !== undefined && `author = ${tomlString(data.author)}`,
    data.summary !== undefined && `summary = ${tomlText(data.summary)}`
  ].filter(Boolean)
  const text = (head.length ? head.join('\n') + '\n\n' : '') + data.changes.map(tomlChange).join('\n')
  if (canonical(readChangeset(text)) !== canonical(data)) throw new Error('the TOML does not read back as the same data')
  return text
}

/** JSON with each object's keys sorted, to compare data whatever its key order */
function canonical (value: unknown): string {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : v)
}

/** A new changeset id: the UTC time, to the second, and 4 random hex digits (D7, D33) */
export function changesetId (now = new Date()): string {
  const time = now.toISOString().replace(/\.\d+Z$/, 'Z').replaceAll(':', '')
  return `${time}-${crypto.randomBytes(2).toString('hex')}`
}

export interface DraftOptions {
  /** The log folder */
  log: string
  /** The table the changes apply to */
  resource: string
  author?: string
  summary?: string
  now?: Date
}

/**
 * Write a changeset of `changes` to the log, at <log>/<resource>/<yyyy>/<id>.toml,
 * with a new id that isn't already used. Returns its id and path.
 */
export function draftChangeset (changes: Change[], options: DraftOptions): { id: string, path: string, text: string } {
  const text = changesetTOML({
    ...(options.author !== undefined ? { author: options.author } : {}),
    ...(options.summary !== undefined ? { summary: options.summary } : {}),
    changes
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = changesetId(options.now)
    const file = path.join(options.log, options.resource, id.slice(0, 4), `${id}.toml`)
    if (fs.existsSync(file)) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, { flag: 'wx' })
    return { id, path: file, text }
  }
  throw new Error(`no free changeset id for ${options.now?.toISOString() ?? 'now'}`)
}
