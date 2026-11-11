// Read a log: changesets/<folder>/<resource>/<id>.toml, checked against the
// changeset schema. A folder is a release date, holding the changesets released
// with it, or `next`, holding the pending ones (D66). Files that can't be used
// are reported and skipped.

import fs from 'node:fs'
import path from 'node:path'
import { parse, TomlDate } from 'smol-toml'
import { Ajv2020 } from 'ajv/dist/2020.js'
// imported, not read from a path, so the library still finds it once a bundler has moved it
import schema from './changeset.schema.json' with { type: 'json' }
import { reportItem } from './report.ts'
import type { Changeset, DataPackage, ReportItem } from './types.ts'

export { schema }

/** A changeset id: the UTC time it was created, and 4 hex digits */
export const CHANGESET_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[0-9a-f]{4}$/
/** The folder of a release: its date */
export const RELEASE_FOLDER = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
/** The folder of pending changesets, which the next release will include */
export const PENDING_FOLDER = 'next'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const check = ajv.compile(schema)

/** Whether `text` is a real calendar date, `YYYY-MM-DD`: one that reads back the same, so not 2026-02-31 (S2) */
export function isCalendarDate (text: string): boolean {
  const [, y, m, d] = text.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  if (!y) return false
  const date = new Date(Date.UTC(+y, +m - 1, +d))
  return date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d
}

// TOML's strings and comments, which can hold any text, or else a bare date or the date of a date-time
const DATE_TOKENS = /"""(?:[^\\]|\\[\s\S])*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'|#[^\n]*|(?<![\w.-])(\d{4}-\d{2}-\d{2})(?![\d-])/g

/**
 * The data in a changeset's TOML, as the schema checks it: bare TOML dates
 * become `YYYY-MM-DD` (D39), and other dates and times ISO 8601 text.
 * Throws if it isn't valid TOML, which includes a bare date that isn't a real
 * one: smol-toml rolls `2026-02-31` over to 2026-03-03, a typo that would read
 * as a different, valid date, so the raw text is checked for them (S2).
 */
export function readChangeset (text: string): unknown {
  const data = parse(text)
  for (const match of text.matchAll(DATE_TOKENS)) {
    if (match[1] === undefined || isCalendarDate(match[1])) continue
    const line = text.slice(0, match.index).split('\n').length
    throw new Error(`line ${line}: ${match[1]} is not a real calendar date`)
  }
  return plain(data)
}

function plain (value: unknown): unknown {
  if (value instanceof TomlDate) return value.toISOString()
  if (Array.isArray(value)) return value.map(plain)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  }
  return value
}

/** The ways `data` doesn't match the changeset schema, as messages. Empty if it does. */
export function validateChangeset (data: unknown): string[] {
  if (check(data)) return []
  return (check.errors ?? [])
    // the if/then branches repeat the real error, so leave them out
    .filter(error => error.keyword !== 'if')
    .map(error => `${error.instancePath || '/'} ${error.message}${error.params && 'allowedValues' in error.params ? ` (${(error.params.allowedValues as unknown[]).join(', ')})` : ''}${error.params && 'additionalProperty' in error.params ? ` (${error.params.additionalProperty})` : ''}`)
}

/** The time in a changeset id */
export function idTime (id: string): Date {
  const [, y, mo, d, h, mi, s] = id.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z/)!
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
}

/**
 * Whether a change's `as_of` is later than expected, which is a warning, not a block, as a future
 * date is sometimes meant (S2). It's expected no later than today, and no later than the changeset:
 * a pending changeset's id's timestamp, the UTC day it was created, or a released one's release
 * folder's date. A released one may be later than its id: 11 changes in changesets/2026-11-06/ are
 * dated 2026-11-06, release-day fixes added to changesets drafted on 11-04, before the release was
 * published. Returns what it's later than, or undefined.
 */
export function laterThanExpected (asOf: string, id: string, folder: string, now: Date): string | undefined {
  const today = now.toISOString().slice(0, 10)
  const released = RELEASE_FOLDER.test(folder)
  const changeset = released ? folder : id.slice(0, 10)
  if (asOf > changeset) return released ? `its release, ${folder}` : `the changeset's id, created ${changeset}`
  if (asOf > today) return `today, ${today}`
  return undefined
}

const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false

/** The release folders in a log, oldest first */
export function releaseFolders (log: string): string[] {
  if (!isDir(log)) return []
  return fs.readdirSync(log).filter(name => RELEASE_FOLDER.test(name) && isDir(path.join(log, name))).sort()
}

export interface ReadOptions {
  /** For checking that ids aren't in the future. Defaults to now. */
  now?: Date
  /** `<resource>/<id>` -> the file it was read from, to catch an id used twice, across folders too */
  seen?: Map<string, string>
}

/**
 * Every changeset in some folders of the log, as one set, by resource, sorted
 * by id. A folder that doesn't exist is empty. Only resource folders named in
 * the package are read. Problems are pushed to `report`.
 */
export function readFolders (log: string, folders: string[], datapackage: DataPackage, report: ReportItem[], options: ReadOptions = {}): Record<string, Changeset[]> {
  const names = new Set(datapackage.resources.map(resource => resource.name))
  const seen = options.seen ?? new Map<string, string>()
  const byResource: Record<string, Changeset[]> = {}
  for (const folder of folders) {
    if (!isDir(path.join(log, folder))) continue
    for (const entry of fs.readdirSync(path.join(log, folder)).sort()) {
      if (!isDir(path.join(log, folder, entry))) continue
      if (!names.has(entry)) {
        report.push(reportItem('unknown-table', `is a folder in the log, but there's no resource "${entry}" in the package, so its changesets are skipped`, { file: `${folder}/${entry}/` }))
        continue
      }
      byResource[entry] = [...(byResource[entry] ?? []), ...readResource(log, folder, entry, report, options.now ?? new Date(), seen)]
    }
  }
  for (const changesets of Object.values(byResource)) changesets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return byResource
}

function readResource (log: string, folder: string, resource: string, report: ReportItem[], now: Date, seen: Map<string, string>): Changeset[] {
  const changesets: Changeset[] = []
  for (const name of fs.readdirSync(path.join(log, folder, resource)).sort()) {
    if (!name.endsWith('.toml')) continue
    const file = path.join(folder, resource, name)
    const full = path.join(log, file)
    const id = name.slice(0, -'.toml'.length)
    const about = { resource, file }

    if (!CHANGESET_ID.test(id)) {
      report.push(reportItem('invalid-changeset', 'the filename is not a changeset id, <UTC timestamp>-<4 hex>, so it is skipped', about))
      continue
    }
    if (seen.has(`${resource}/${id}`)) {
      report.push(reportItem('invalid-changeset', `has the same id as ${seen.get(`${resource}/${id}`)}, so it is skipped`, about))
      continue
    }
    seen.set(`${resource}/${id}`, file)
    if (idTime(id) > now) report.push(reportItem('future-id', 'has a timestamp in the future', { ...about, changeset: id }))

    let data
    try {
      data = readChangeset(fs.readFileSync(full, 'utf8'))
    } catch (error) {
      report.push(reportItem('invalid-toml', `is not valid TOML, so it is skipped: ${(error as Error).message.split('\n')[0]}`, about))
      continue
    }
    const errors = validateChangeset(data)
    if (errors.length) {
      report.push(reportItem('invalid-changeset', `does not match the changeset schema, so it is skipped: ${errors.join('; ')}`, about))
      continue
    }
    // an as_of that isn't a real calendar date blocks, like a schema failure (S2)
    const changes = (data as Changeset).changes
    const undated = changes.flatMap((change, i) => change.as_of === undefined || isCalendarDate(change.as_of) ? [] : [{ change: i, key: change.key, as_of: change.as_of }])
    if (undated.length) {
      for (const { change, key, as_of } of undated) {
        report.push(reportItem('invalid-changeset', `as_of ${JSON.stringify(as_of)} is not a real calendar date, so the changeset is skipped`, { ...about, changeset: id, change, ...(key ? { key } : {}) }))
      }
      continue
    }
    // one later than expected is a warning, and the change still applies
    changes.forEach((change, i) => {
      const later = change.as_of && laterThanExpected(change.as_of, id, folder, now)
      if (later) report.push(reportItem('future-as-of', `is dated ${change.as_of}, later than ${later}, and still applies`, { ...about, changeset: id, change: i, ...(change.key ? { key: change.key } : {}) }))
    })
    const snapshot = (data as Changeset).changes.findIndex(change => change.type === 'snapshot')
    if (snapshot !== -1) {
      report.push(reportItem('invalid-changeset', 'has a snapshot, which a changeset can no longer hold: the baseline is the previous release, so it is skipped', { ...about, changeset: id, change: snapshot }))
      continue
    }
    changesets.push({ id, resource, folder, path: full, ...(data as Omit<Changeset, 'id' | 'resource' | 'folder' | 'path'>) })
  }
  return changesets
}
