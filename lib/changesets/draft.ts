// Write a new changeset, for tools and checks that suggest a fix (D48). The
// TOML is laid out like the importer's: one [[changes]] table per change,
// dotted keys for values, and bare dates (toml.ts, which the editor shares).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PENDING_FOLDER, readChangeset, validateChangeset } from './log.ts'
import { changesetText, type ChangesetData } from './toml.ts'
import type { Change } from './types.ts'

export { tomlString, type ChangesetData } from './toml.ts'

/** A changeset as TOML. Throws if it doesn't match the schema, or wouldn't read back as the same data. */
export function changesetTOML (data: ChangesetData): string {
  const errors = validateChangeset(data)
  if (errors.length) throw new Error(`not a valid changeset: ${errors.join('; ')}`)
  const text = changesetText(data)
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
  /** The folder in the log: `next`, for pending changesets, unless it says otherwise */
  folder?: string
  author?: string
  summary?: string
  now?: Date
}

/**
 * Write a changeset of `changes` to the log, as a pending one, at <log>/next/<resource>/<id>.toml,
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
    const file = path.join(options.log, options.folder ?? PENDING_FOLDER, options.resource, `${id}.toml`)
    if (fs.existsSync(file)) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, { flag: 'wx' })
    return { id, path: file, text }
  }
  throw new Error(`no free changeset id for ${options.now?.toISOString() ?? 'now'}`)
}
