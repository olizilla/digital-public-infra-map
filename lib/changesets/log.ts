// Read a log: changesets/<resource>/<yyyy>/<id>.toml, checked against the
// changeset schema. Files that can't be used are reported and skipped.

import fs from 'node:fs'
import path from 'node:path'
import { parse, TomlDate } from 'smol-toml'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { reportItem } from './report.ts'
import type { Changeset, DataPackage, ReportItem } from './types.ts'

export const schema = JSON.parse(fs.readFileSync(new URL('./changeset.schema.json', import.meta.url), 'utf8'))

/** A changeset id: the UTC time it was created, and 4 hex digits */
export const CHANGESET_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[0-9a-f]{4}$/
/** The folder for baselines, whose files are named `0000-<name>` */
export const BASELINE_FOLDER = '0000'

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

/**
 * Every changeset in the log, by resource, sorted by id. Only folders named
 * for a resource in the package are read. Problems are pushed to `report`.
 */
export function readLog (log: string, datapackage: DataPackage, report: ReportItem[], now = new Date()): Record<string, Changeset[]> {
  const names = new Set(datapackage.resources.map(resource => resource.name))
  const byResource: Record<string, Changeset[]> = {}
  for (const entry of fs.readdirSync(log).sort()) {
    if (!isDir(path.join(log, entry))) continue
    if (!names.has(entry)) {
      report.push(reportItem('unknown-table', `is a folder in the log, but there's no resource "${entry}" in the package, so its changesets are skipped`, { file: `${entry}/` }))
      continue
    }
    byResource[entry] = readResourceLog(log, entry, report, now)
  }
  return byResource
}

function readResourceLog (log: string, resource: string, report: ReportItem[], now: Date): Changeset[] {
  const folder = path.join(log, resource)
  const seen = new Map<string, string>()
  const changesets: Changeset[] = []
  for (const year of fs.readdirSync(folder).sort()) {
    if (!isDir(path.join(folder, year))) continue
    for (const name of fs.readdirSync(path.join(folder, year)).sort()) {
      if (!name.endsWith('.toml')) continue
      const file = path.join(resource, year, name)
      const full = path.join(log, file)
      const id = name.slice(0, -'.toml'.length)
      const about = { resource, file }

      const baseline = year === BASELINE_FOLDER
      if (baseline ? !id.startsWith(`${BASELINE_FOLDER}-`) : !CHANGESET_ID.test(id)) {
        report.push(reportItem('invalid-changeset', baseline
          ? `the filename of a baseline must start with ${BASELINE_FOLDER}-, so it is skipped`
          : 'the filename is not a changeset id, <UTC timestamp>-<4 hex>, so it is skipped', about))
        continue
      }
      if (seen.has(id)) {
        report.push(reportItem('invalid-changeset', `has the same id as ${seen.get(id)}, so it is skipped`, about))
        continue
      }
      seen.set(id, file)
      if (!baseline) {
        if (id.slice(0, 4) !== year) report.push(reportItem('misplaced', `is in the folder ${year}, not ${id.slice(0, 4)}`, { ...about, changeset: id }))
        if (idTime(id) > now) report.push(reportItem('future-id', 'has a timestamp in the future', { ...about, changeset: id }))
      }

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
      changesets.push({ id, resource, path: full, ...(data as Omit<Changeset, 'id' | 'resource' | 'path'>) })
    }
  }
  return changesets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
