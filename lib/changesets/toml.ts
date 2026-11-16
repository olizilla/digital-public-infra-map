// A changeset as TOML text, laid out like the importer's: one [[changes]] table per change,
// dotted keys for values, and bare dates. No Node imports, so the editor (/<id>/edit/, D86)
// can write a proposal's changeset in the browser with the same code as the tools.
// draft.ts adds the schema check and the read-back check, which need Node.

import type { Change } from './types.ts'

const ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r' }
// what can't go in a """ string as it is: control characters and backslashes,
// three quotes in a row, and a quote at the very end
const NOT_MULTILINE = /[\x00-\x09\x0b-\x1f\x7f\\]|"""|"$/
// a line that would end a Markdown code fence, as the proposal issue's ```toml block (D87): kept in
// one escaped line instead, so the issue's TOML isn't cut short
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/m

export function tomlString (text: string): string {
  return '"' + [...text].map(ch => ESCAPES[ch] ?? (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f
    ? `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    : ch)).join('') + '"'
}

/** A string that reads better over several lines, if it has several and that's safe */
function tomlText (text: string): string {
  return text.includes('\n') && !NOT_MULTILINE.test(text) && !FENCE_LINE.test(text) ? `"""\n${text}"""` : tomlString(text)
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

/**
 * A changeset as TOML, unchecked. Use changesetTOML (draft.ts) where Node is available: it also
 * checks the data against the schema and that the text reads back as the same data.
 */
export function changesetText (data: ChangesetData): string {
  const head = [
    data.author !== undefined && `author = ${tomlString(data.author)}`,
    data.summary !== undefined && `summary = ${tomlText(data.summary)}`
  ].filter(Boolean)
  return (head.length ? head.join('\n') + '\n\n' : '') + data.changes.map(tomlChange).join('\n')
}

/** Whether `text` is a real calendar date, `YYYY-MM-DD`: one that reads back the same, so not 2026-02-31 (S2) */
export function isCalendarDate (text: string): boolean {
  const [, y, m, d] = text.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  if (!y) return false
  const date = new Date(Date.UTC(+y, +m - 1, +d))
  return date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d
}
