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

/**
 * The data in a changeset's TOML, as the schema checks it: bare TOML dates
 * become `YYYY-MM-DD` (D39), and other dates and times ISO 8601 text.
 * Throws if it isn't valid TOML.
 */
export function readChangeset (text: string): unknown {
  return plain(parse(text))
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
    const snapshot = (data as Changeset).changes.findIndex(change => change.type === 'snapshot')
    if (snapshot !== -1) {
      report.push(reportItem('invalid-changeset', 'has a snapshot, which a changeset can no longer hold: the baseline is the previous release, so it is skipped', { ...about, changeset: id, change: snapshot }))
      continue
    }
    changesets.push({ id, resource, folder, path: full, ...(data as Omit<Changeset, 'id' | 'resource' | 'folder' | 'path'>) })
  }
  return changesets
}
