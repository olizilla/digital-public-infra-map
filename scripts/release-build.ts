// The core of a data release's build (D45, D50, D66), shared by scripts/data-build.ts and the
// proposal check, scripts/proposal-check.ts (D88), so both build and check the next release the same way.
//
// Release N+1 is release N's tables, public/data/<N>/<N>-<resource>.json, plus changesets, replayed with
// lib/changesets. A change always replaces the value in release N, and one dated before its row's Last
// updated there is reported (D46).
//
// The DPI layer (D48, src/DpiLayer.ts): Last updated is the row's newest as_of, as YYYY-MM-DD (D49),
// Count for DPI is from the DPI test in src/DpiTest.ts, the same code the site uses, the ISO 3166-1 codes
// are from the row's place in public/data/places.csv (D68), and a new system goes below the last system for
// its place, by src/Places.ts.
//
// checkRelease checks a written release with scripts/validate.mjs. A failing value blocks only if a
// changeset introduced it, and one from release N is a legacy warning (D60).

import './site-modules.ts'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { checkItem, datedBy, fieldId, keyField, missingValue, RELEASE_FOLDER } from '../lib/changesets/index.ts'
import type { Baseline, BuildResult, DataPackage, Table } from '../lib/changesets/index.ts'
import { baselineReason } from '../src/DpiLayer.ts'

// the site's modules, which need ./site-modules.ts to load in Node
const { dpiStatus } = await import('../src/DpiTest.ts')
const { resourceNames, schemas, toRecord } = await import('../src/Schema.ts')
const { normaliseImplementationStatus } = await import('../src/Status.js')
export type DPIType = keyof typeof resourceNames

// The build itself is in src/BuildRelease.ts, which the editor's pages also use (D93): it needs no files
export const { buildRelease, dpiTypeOf, tableRecords } = await import('../src/BuildRelease.ts')
export type { ReleaseBuild } from '../src/BuildRelease.ts'

export const root = path.resolve(import.meta.dirname, '..')
export const dataDir = path.join(root, 'public', 'data')
/** Files that are copied into the release as they are */
export const copied = ['public/data/places.csv', 'public/data/place-names.csv']

export const readJSON = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** A row as the site's record for it, keyed by field id, with its 'DPI Status' (see src/Identity.ts) */
export function recordOf (dpiType: DPIType, row: Record<string, unknown>) {
  const record = toRecord(schemas[dpiType], row, { status: normaliseImplementationStatus })
  record['DPI Status'] = dpiStatus(dpiType, record)
  return record
}

/** The release folders before `release`, oldest first */
export const releasesBefore = (release: string) => fs.readdirSync(dataDir).filter(d => RELEASE_FOLDER.test(d) && d < release).sort()

/** The latest of `releases` with JSON for every table */
export function previousRelease (releases: string[]) {
  return releases.filter(d => Object.keys(dpiTypeOf).every(name => fs.existsSync(path.join(dataDir, d, `${d}-${name}.json`)))).at(-1)
}

/** Release `previous` as the baseline: its tables, and the evidence for its values if it has a file of them */
export function loadBaseline (previous: string, datapackage: DataPackage): Baseline {
  const sourcesPath = path.join(dataDir, previous, `${previous}-sources.json`)
  return {
    id: previous,
    reason: baselineReason(previous),
    tables: Object.fromEntries(datapackage.resources
      .map(r => [r.name, path.join(dataDir, previous, `${previous}-${r.name}.json`)])
      .filter(([, file]) => fs.existsSync(file))
      .map(([name, file]) => [name, readJSON(file)])),
    ...(fs.existsSync(sourcesPath) ? { sources: readJSON(sourcesPath) } : {})
  }
}

/**
 * Each field an earlier release had, by id and by name, with the newest release that had it,
 * from the releases' datapackage.json and the keys of their JSON (the 2024-11-19 release names it <date>.<resource>.json),
 * so a value for a field that isn't in the package is reported as legacy, not unknown (D51)
 */
export function earlierFieldsOf (releases: string[], datapackage: DataPackage) {
  const earlierFields: Record<string, Record<string, string>> = {}
  for (const d of releases) {
    const had = (name: string, field: string) => { (earlierFields[name] ??= {})[field] = d }
    const packagePath = path.join(dataDir, d, 'datapackage.json')
    if (fs.existsSync(packagePath)) {
      for (const r of (readJSON(packagePath) as DataPackage).resources) for (const f of r.schema?.fields ?? []) [fieldId(f), f.name].forEach(id => had(r.name, id))
    }
    for (const r of datapackage.resources) {
      const file = [`${d}-${r.name}.json`, `${d}.${r.name}.json`].map(f => path.join(dataDir, d, f)).find(f => fs.existsSync(f))
      if (!file) continue
      const rows = readJSON(file)
      if (!Array.isArray(rows)) continue
      for (const row of rows) for (const key of Object.keys(row)) had(r.name, key)
    }
  }
  return earlierFields
}

/**
 * A table's JSON, one row per line, so a diff of two releases reads like a CSV's: [ on its own line,
 * then each row as compact JSON, then ]. From the 2026-11-06 release on; earlier releases keep their bytes.
 */
const tableJSON = (records: Record<string, unknown>[]) => `[\n${records.map(record => JSON.stringify(record)).join(',\n')}\n]\n`

/**
 * Write the release into `out`:
 * - <release>-<resource>.json, the canonical tables (D67), one row per line, keyed by field id (D83)
 * - places.csv and place-names.csv, copied
 * - datapackage.json: the codebook, with paths to the files in this folder (D50)
 * Returns the files written.
 */
export function writeRelease (out: string, release: string, result: BuildResult, datapackage: DataPackage): string[] {
  fs.mkdirSync(out, { recursive: true })
  const written: string[] = []
  const write = (name: string, text: string) => {
    fs.writeFileSync(path.join(out, name), text)
    written.push(name)
  }

  // each resource's file in the release: a table's dated JSON, or a copied file's name
  const releasePaths: Record<string, string> = {}
  for (const [name, table] of Object.entries(result.tables)) {
    write(releasePaths[name] = `${release}-${name}.json`, tableJSON(tableRecords(table)))
  }
  for (const file of copied) {
    write(path.basename(file), fs.readFileSync(path.join(root, file), 'utf8'))
    const resource = datapackage.resources.find(r => path.basename(r.path ?? '') === path.basename(file))
    if (resource) releasePaths[resource.name] = path.basename(file)
  }

  // the release's own datapackage.json, whose paths are the files in this folder (D50). The root's table paths
  // are the next release's draft, public/data/next/<resource>.json, so each path is set here, not taken from the root's
  const releasePackage = structuredClone(datapackage)
  // the root's $comment says it describes the next release, which isn't true of a release's copy
  delete (releasePackage as { $comment?: string }).$comment
  // a release's copy carries its release date as its version, just after the homepage
  {
    const { $schema, name, title, homepage, ...rest } = releasePackage as unknown as Record<string, unknown>
    for (const key of Object.keys(releasePackage)) delete (releasePackage as unknown as Record<string, unknown>)[key]
    Object.assign(releasePackage, { $schema, name, title, homepage, version: release, ...rest })
  }
  for (const resource of releasePackage.resources) {
    const file = releasePaths[resource.name]
    if (!file || !written.includes(file)) throw new Error(`resource "${resource.name}" has no file in the release`)
    resource.path = file
  }
  write('datapackage.json', JSON.stringify(releasePackage, null, 2) + '\n')
  return written
}

/** scripts/validate.mjs on the release written in `out` */
export const validate = (out: string, ...flags: string[]) =>
  spawnSync(process.execPath, [path.join(root, 'scripts', 'validate.mjs'), path.join(out, 'datapackage.json'), ...flags], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/**
 * Check the release written in `out` with scripts/validate.mjs, adding each failure to the build's report.
 * A failing value blocks if a changeset introduced it, and is a legacy warning if it's from the baseline (D60).
 */
export function checkRelease (out: string, result: BuildResult, datapackage: DataPackage) {
  const checked = JSON.parse(validate(out, '--json').stdout) as {
    errors: number
    problems: { resource: string, row?: number | string, key?: string, column: string, value?: string, message: string }[]
  }
  for (const problem of checked.problems) {
    const resource = datapackage.resources.find(r => r.name === problem.resource)
    const idOf = (id: string) => resource?.schema.fields.some(f => fieldId(f) === id) ? [id] : []
    const field = resource?.schema.fields.find(f => f.name === problem.column)
    const id = field && fieldId(field)
    // the place check reads the System ID and the Country / Region, so it's introduced by whichever changed last
    const fields = id === 'system_id' && /place/.test(problem.message) ? [id, ...idOf('country')] : id ? [id] : []
    const history = problem.key && id ? result.history[problem.resource]?.[problem.key]?.[id] : undefined
    const value = problem.value === undefined ? '' : `${JSON.stringify(problem.value)} `
    const missing = resource && problem.value === missingValue(resource) && !history ? ' (no value was set)' : ''
    // Last updated is derived from the row's newest as_of, so its failure is that change's, not the row's introducer's (S2)
    const derivedFrom = id === 'last_updated' && problem.key ? datedBy(result.provenance[problem.resource]?.[problem.key]) : undefined
    const item = checkItem(result, { resource: problem.resource, key: problem.key ?? '', fields, message: `${value}${problem.message}${missing}`, ...(derivedFrom ? { derivedFrom } : {}) }, resource ? fieldId(keyField(resource)) : '')
    result.report.push({ ...item, key: problem.key, field: id ?? problem.column })
  }
}
