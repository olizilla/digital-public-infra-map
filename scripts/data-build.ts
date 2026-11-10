// Build a data release (D45, D50, D66).
//
// Release N+1 is release N's tables, public/data/<N>/<N>-<resource>.json, plus
// the changesets in changesets/<N+1>/ (when re-cutting a release that isn't
// published yet) and changesets/next/, replayed with lib/changesets. A change
// always replaces the value in release N, and one dated before its row's Last
// updated there is reported (D46). Release N is the newest release folder before
// this one with JSON for every table, or --previous. It writes public/data/<release>/:
// - <release>-<resource>.json, the canonical tables (D67), one row per line, keyed by field id (D83)
// - places.csv and place-names.csv, copied
// - datapackage.json: the root one, with paths to the files in this folder
// No table CSVs: the site makes a workbook of the tables, /data/latest/dpimap.xlsx, from the JSON
// (src/pages/data/latest/dpimap.xlsx.ts).
//
// The DPI layer (D48, src/DpiLayer.ts): Last updated is the row's newest as_of, as
// YYYY-MM-DD (D49), Count for DPI is from the DPI test in src/DpiTest.ts, the same
// code the site uses, the ISO 3166-1 codes are from the row's place in
// public/data/places.csv (D68), and a new system goes below the last system for its
// place, by src/Places.ts.
//
// It then checks the release with scripts/validate.mjs. A failing value blocks
// only if a changeset introduced it, and one from release N is a legacy
// warning (D60). It writes a report of everything it skipped or found, and of
// every system whose DPI status changed since release N, to
// reports/data-build-<release>.md, which isn't published or committed (reports/ is in
// .gitignore: every build rewrites it). Values for fields that
// aren't in the root datapackage.json are reported as legacy, if an earlier
// release had the field, or else as unknown (D51).
//
// The root datapackage.json is the next release's codebook (D71), so the build reads it
// and writes it into the release. The site's modules it uses for the DPI test and places
// read the codebook of the release the site shows (src/ReleaseFiles.ts).
//
// Removed systems have no page, so it redirects each System ID that was in an
// earlier release and isn't in this one to its country page (D64), in
// public/_redirects between marker comments. Another block there redirects
// /data/latest/<file> to the newest release's files (D71), and a block in public/_headers saves
// /data/latest/dpimap.xlsx as dpimap-<release>.xlsx (D67).
//
// Cutting a release moves changesets/next/* into changesets/<release>/. This script doesn't
// move them. Until they're moved it reads both folders, so the release includes them.
//
// It always writes the release, and exits 1 if anything blocks a merge (D51).
//
// usage: npm run data:build -- --release 2026-11-06 [--previous 2026-03-31]
//
// --check (npm run data:check) writes nothing in the repo. It rebuilds the release that
// src/ReleaseFiles.ts points at, or --release, in a temporary folder, from the previous release and
// the changesets in changesets/<release>/ only, as they were when it was cut, so pending
// changesets in changesets/next/ don't count, and with the release's own datapackage.json, not
// the root one, which may have moved on to the next release (D71). It compares the result with public/data/<release>/
// and exits 1 on any difference, or if anything blocks a merge. This catches a DPI test
// changed without a rebuild, a released changeset edited after the cut, and other drift.
// It also fails if CITATION.cff's version or date-released isn't the release the site shows (src/Citation.ts).

import './site-modules.ts'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import slug from 'slug'
import {
  build, checkItem, countByKind, fieldId, formatReport, keyField, KIND_TITLES, missingValue, missingValues, PENDING_FOLDER, readFolders, RELEASE_FOLDER
} from '../lib/changesets/index.ts'
import type { Baseline, DataPackage, Field, ReportItem, Row, Table } from '../lib/changesets/index.ts'
import { baselineReason, derivedFields, lastUpdatedAsOf } from '../src/DpiLayer.ts'

// the site's modules, which need ./site-modules.ts to load in Node
const { dpiStatus, dpiTest, implementationStatus, nameOf, passesDpiTest, presence, valueOf } = await import('../src/DpiTest.ts')
const { resourceNames, schemas, toRecord } = await import('../src/Schema.ts')
const { normaliseImplementationStatus, statusSort } = await import('../src/Status.js')
const { isRegion, placeNamed } = await import('../src/Places.ts')
const { oneSystemPerCountry } = await import('../src/Util.ts')
type DPIType = keyof typeof resourceNames

const root = path.resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({ options: { release: { type: 'string' }, previous: { type: 'string' }, check: { type: 'boolean' } } })
const check = !!args.check
// in check mode the release defaults to the one the site shows (src/ReleaseFiles.ts)
const release = args.release ?? (check ? fs.readFileSync(path.join(root, 'src', 'ReleaseFiles.ts'), 'utf8').match(/export const release = '([^']+)'/)?.[1] : undefined)
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
if (!isDate(release) || (args.previous && !isDate(args.previous))) {
  console.error('usage: npm run data:build -- --release YYYY-MM-DD [--previous YYYY-MM-DD] [--check]')
  process.exit(2)
}

const dataDir = path.join(root, 'public', 'data')
const releaseDir = path.join(dataDir, release!)
// the codebook: the root one, the next release's, or in check mode the release's own (D71)
const datapackage: DataPackage = JSON.parse(fs.readFileSync(check ? path.join(releaseDir, 'datapackage.json') : path.join(root, 'datapackage.json'), 'utf8'))
// check mode builds into a temporary folder, to compare with the release and to run scripts/validate.mjs on
const out = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'data-check-')) : releaseDir
const reportPath = path.join(root, 'reports', `data-build-${release}.md`)
// files that are copied into the release as they are
const copied = ['public/data/places.csv', 'public/data/place-names.csv']

const dpiTypeOf = Object.fromEntries(Object.entries(resourceNames).map(([dpiType, name]) => [name, dpiType])) as Record<string, DPIType>
const resourceOf = (name: string) => datapackage.resources.find(r => r.name === name)!

/** A row keyed by field name, which is the field's id (D83), as the release's JSON has it */
const byName = (fields: Field[], row: Row) => Object.fromEntries(fields.map(field => [field.name, row[fieldId(field)]]))

/** A row as the site's record for it, keyed by field id, with its 'DPI Status' (see src/Identity.ts) */
function recordOf (dpiType: DPIType, row: Record<string, unknown>) {
  const record = toRecord(schemas[dpiType], row, { status: normaliseImplementationStatus })
  record['DPI Status'] = dpiStatus(dpiType, record)
  return record
}

/** The release folders before this one, oldest first */
const earlierReleases = fs.readdirSync(dataDir).filter(d => RELEASE_FOLDER.test(d) && d < release!).sort()

/** The latest release folder before this one with JSON for every table */
function previousRelease () {
  return earlierReleases.filter(d => Object.keys(dpiTypeOf).every(name => fs.existsSync(path.join(dataDir, d, `${d}-${name}.json`)))).at(-1)
}
const previous = args.previous ?? previousRelease()
const readJSON = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

// release N: its tables, and the evidence for its values if it has a file of them
let baseline: Baseline | undefined
if (previous) {
  const sourcesPath = path.join(dataDir, previous, `${previous}-sources.json`)
  baseline = {
    id: previous,
    reason: baselineReason(previous),
    tables: Object.fromEntries(datapackage.resources
      .map(r => [r.name, path.join(dataDir, previous, `${previous}-${r.name}.json`)])
      .filter(([, file]) => fs.existsSync(file))
      .map(([name, file]) => [name, readJSON(file)])),
    ...(fs.existsSync(sourcesPath) ? { sources: readJSON(sourcesPath) } : {})
  }
}

// each field an earlier release had, by id and by name, with the newest release that had it,
// from the releases' datapackage.json and the keys of their JSON (the 2024-11-19 release names it <date>.<resource>.json)
const earlierFields: Record<string, Record<string, string>> = {}
for (const d of earlierReleases) {
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

// the changesets: this release's folder, if it isn't published yet, and the pending ones, as one set
const readReport: ReportItem[] = []
const changesets = readFolders(path.join(root, 'changesets'), check ? [release!] : [release!, PENDING_FOLDER], datapackage, readReport)

/**
 * A row's ISO 3166-1 alpha-3 code, from its place's iso3 in public/data/places.csv, as src/Places.ts matches it (D68).
 * Only alpha-3: it's what other datasets join on, and three letters can't be mistaken for the missing value, NA. The
 * alpha-2 code is already the place part of each country's System ID. A region has none. Kosovo's XKX is user-assigned,
 * not official ISO, and matches the World Bank's. A code left out is the missing value, so a place that isn't matched has none.
 */
function isoCodes (country: string) {
  const place = placeNamed(country)
  if (!place || isRegion(place)) return {}
  return place.iso3 ? { iso3: place.iso3.toUpperCase() } : {}
}

const result = build({
  datapackage,
  baseline,
  layers: [changesets],
  report: readReport,
  baselineAsOf: lastUpdatedAsOf,
  earlierFields,
  derive: {
    fields: Object.fromEntries(Object.keys(dpiTypeOf).map(name => [name, derivedFields])),
    values: (name, row, { asOf }) => {
      const record = toRecord(schemas[dpiTypeOf[name]], byName(resourceOf(name).schema.fields, row))
      return {
        ...(asOf ? { last_updated: asOf } : {}),
        count_for_dpi: passesDpiTest(dpiTest(dpiTypeOf[name], record)) ? '1' : '0',
        ...isoCodes(row.country)
      }
    }
  },
  // a new system goes below the last system for its place (D46), so aliases group with their place
  rowGroup: (_resource, row) => placeNamed(row.country)?.code ?? row.country
})

/** A cell as JSON, as the earlier releases had it: numbers for integer and number fields, else text */
function jsonValue (field: Field, value: string, missing: string[]) {
  if (missing.includes(value)) return value
  if ((field.type === 'integer' || field.type === 'number') && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

function tableRecords (table: Table) {
  const missing = missingValues(table.resource)
  return table.rows.map(row => Object.fromEntries(table.fields.map(field => [field.name, jsonValue(field, row[fieldId(field)], missing)])))
}

/**
 * A table's JSON, one row per line, so a diff of two releases reads like a CSV's: [ on its own line,
 * then each row as compact JSON, then ]. From the 2026-11-06 release on; earlier releases keep their bytes.
 */
const tableJSON = (records: Record<string, unknown>[]) => `[\n${records.map(record => JSON.stringify(record)).join(',\n')}\n]\n`

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

// --- redirects for removed systems (D64) ---

/** Every System ID in an earlier release's table, with its place in the newest release that has it */
function earlierRows (name: string) {
  const resource = resourceOf(name)
  const key = keyField(resource).name
  const country = resource.schema.fields.find(f => fieldId(f) === 'country')?.name
  const rows = new Map<string, string>()
  for (const d of earlierReleases.toReversed()) {
    const file = path.join(dataDir, d, `${d}-${name}.json`)
    if (!fs.existsSync(file)) continue
    for (const row of readJSON(file) as Record<string, unknown>[]) {
      const id = row[key]
      if (typeof id === 'string' && id && !rows.has(id)) rows.set(id, country ? String(row[country] ?? '') : '')
    }
  }
  return [...rows].map(([key, country]) => ({ key, country }))
}

// each place's country page, as src/Records.ts names it: after the first row for the place,
// in its order, of the places with a system (src/pages/[country].astro)
const countryPages = new Map<string, string>()
for (const [name, table] of Object.entries(result.tables)) {
  const dpiType = dpiTypeOf[name]
  if (!dpiType) continue
  const records = tableRecords(table).map(row => recordOf(dpiType, row)).sort(statusSort)
  for (const record of records) {
    const code = placeNamed(record.country)?.code
    if (code && presence(dpiType, record) !== 'not-found' && !countryPages.has(code)) countryPages.set(code, `/${slug(record.country)}/`)
  }
}
const redirects: string[] = []
for (const [name, table] of Object.entries(result.tables)) {
  if (!dpiTypeOf[name]) continue
  const keyId = fieldId(keyField(table.resource))
  const built = new Set(table.rows.map(row => row[keyId]))
  for (const { key, country } of earlierRows(name)) {
    if (built.has(key)) continue
    const target = countryPages.get(placeNamed(country)?.code ?? '') ?? '/'
    redirects.push(`/${key} ${target} 302`, `/${key}/ ${target} 302`)
  }
}
// --- /data/latest/, a stable address for the current release's files (D71) ---

// The block points at the release data:build built, so building a release is the only step: the
// release PR builds it and points the site at it (src/ReleaseFiles.ts), and both go live when it
// merges. If the block followed the release the site shows, switching the site would need another
// data:build to move it, and /data/latest/ would stay on the old release until then. Rebuilding an
// older release doesn't move it back: it points at the newest release folder, which is this one
// unless a later release has been built. Its files take stable names, without the date, like
// latest/identity.json for <date>/<date>-identity.json. 302s, as the target moves with each release.
// The workbook, /data/latest/dpimap.xlsx, is made by the site (src/pages/data/latest/dpimap.xlsx.ts), and
// no release file has its name, so it's never redirected: a redirect there would shadow the site's file.
const latest = fs.readdirSync(dataDir)
  .filter(d => RELEASE_FOLDER.test(d) && d >= release! && fs.existsSync(path.join(dataDir, d, 'datapackage.json')))
  .sort().at(-1) ?? release!
const latestFiles = latest === release && !check ? written : fs.readdirSync(path.join(dataDir, latest))
const latestRedirects = latestFiles
  .filter(file => file === 'datapackage.json' || file.endsWith('.csv') || file.startsWith(`${latest}-`))
  .map(file => ({ file, name: file.replace(`${latest}-`, '') }))
  .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  .map(({ file, name }) => `/data/latest/${name} /data/${latest}/${file} 302`)

const redirectsPath = path.join(root, 'public', '_redirects')
/** `text` with the lines between `markers` replaced by `lines`, or with them added at the end */
function replaceBlock (text: string, markers: [string, string], lines: string[]) {
  const block = [markers[0], ...lines, markers[1]].join('\n')
  const [start, end] = markers.map(marker => text.indexOf(marker))
  return start !== -1 && end > start
    ? text.slice(0, start) + block + text.slice(end + markers[1].length)
    : text.replace(/\n*$/, text ? '\n' : '') + block + '\n'
}
const before = fs.existsSync(redirectsPath) ? fs.readFileSync(redirectsPath, 'utf8') : ''
const after = replaceBlock(
  replaceBlock(before, ['# removed systems (generated by data:build)', '# end removed systems'], redirects),
  ['# latest release (generated by data:build)', '# end latest release'],
  [`# /data/latest/ is the ${latest} release`, ...latestRedirects]
)
if (!check) fs.writeFileSync(redirectsPath, after)

// The workbook is saved with the release's date, like dpimap-2026-11-06.xlsx, by the same release as
// the /data/latest/ redirects, which the release PR points the site at too (Cloudflare Pages _headers)
const headersPath = path.join(root, 'public', '_headers')
const headersBefore = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8') : ''
const headersAfter = replaceBlock(headersBefore, ['# latest release (generated by data:build)', '# end latest release'], [
  '/data/latest/dpimap.xlsx',
  `\tContent-Disposition: attachment; filename="dpimap-${latest}.xlsx"`
])
if (!check) fs.writeFileSync(headersPath, headersAfter)

// check the release. A failing value blocks if a changeset introduced it, and is a legacy warning if it's from the baseline (D60)
const validate = (...flags: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts', 'validate.mjs'), path.join(out, 'datapackage.json'), ...flags], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const checked = JSON.parse(validate('--json').stdout) as {
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
  const item = checkItem(result, { resource: problem.resource, key: problem.key ?? '', fields, message: `${value}${problem.message}${missing}` }, resource ? fieldId(keyField(resource)) : '')
  result.report.push({ ...item, key: problem.key, field: id ?? problem.column })
}
const summary = validate().stdout
const validateSummary = summary.slice(summary.indexOf('\nSummary') + 1)

// legacy warnings by table and field, for tightening the data release by release (D60)
const legacy = result.report.filter(item => item.kind === 'legacy')
const legacyCounts = new Map<string, number>()
for (const item of legacy) legacyCounts.set(`${item.resource}\0${item.field}`, (legacyCounts.get(`${item.resource}\0${item.field}`) ?? 0) + 1)
const legacyLines = [
  '## Legacy warnings by field',
  '',
  `${legacy.length} values from the baseline fail a check. They don't block a merge (D60), and each release reports how many are left.`,
  '',
  '| Table | Field | Values |',
  '|---|---|---|',
  ...[...legacyCounts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k.split('\0')[0]} | \`${k.split('\0')[1]}\` | ${n} |`),
  ''
]

// --- DPI status changes since the previous release ---

/** Release N's records, by System ID */
function previousRecords (name: string): Map<string, Record<string, any>> {
  const dpiType = dpiTypeOf[name]
  const rows = (baseline?.tables[name] ?? []) as Record<string, any>[]
  if (rows.some(row => row.system_id === undefined)) throw new Error(`${previous}-${name}.json has rows with no System ID`)
  return new Map(rows.map(row => [row.system_id, recordOf(dpiType, { ...row })]))
}

interface StatusChange { dpiType: DPIType, id: string, name: string, old?: string, new?: string, criteria: string }
const changes: StatusChange[] = []
const added: StatusChange[] = []
const removed: StatusChange[] = []
const headline: { dpiType: DPIType, old: number, new: number }[] = []
const statusText = (record?: Record<string, any>) => record && `${record['DPI Status']} (${record.count_for_dpi})`

if (previous) {
  for (const [name, table] of Object.entries(result.tables)) {
    const dpiType = dpiTypeOf[name]
    if (!dpiType) continue
    const before = previousRecords(name)
    const after = new Map(tableRecords(table).map(row => [row.system_id as string, recordOf(dpiType, row)]))
    const nameFor = (record: Record<string, any>) => nameOf(dpiType, record) ?? '(unnamed)'
    for (const [id, now] of after) {
      const then = before.get(id)
      if (!then) {
        added.push({ dpiType, id, name: nameFor(now), new: statusText(now), criteria: '' })
        continue
      }
      if (then['DPI Status'] === now['DPI Status'] && then.count_for_dpi === now.count_for_dpi) continue
      const was = new Map(dpiTest(dpiType, then).map(c => [c.label, c.value]))
      const criteria = dpiTest(dpiType, now).filter(c => was.get(c.label) !== c.value).map(c => `${c.label}: ${was.get(c.label)} → ${c.value}`)
      const status = [implementationStatus(valueOf(dpiType, then, 'status')), implementationStatus(valueOf(dpiType, now, 'status'))]
      if (status[0] !== status[1]) criteria.push(`Status: ${status[0]} → ${status[1]}`)
      changes.push({ dpiType, id, name: nameFor(now), old: statusText(then), new: statusText(now), criteria: criteria.join('; ') || '(none: Count for DPI only)' })
    }
    for (const [id, then] of before) {
      if (!after.has(id)) removed.push({ dpiType, id, name: nameFor(then), old: statusText(then), criteria: '' })
    }
    const countries = (records: Iterable<Record<string, any>>) => oneSystemPerCountry([...records] as any).filter(row => row?.['DPI Status'] === 'DPI').length
    headline.push({ dpiType, old: countries(before.values()), new: countries(after.values()) })
  }
}

const typeName: Record<DPIType, string> = { id: 'Digital ID', pay: 'Payment', data: 'Data exchange' }
const statusLines = previous ? [
  `## DPI status changes since ${previous}`,
  '',
  `Every system whose DPI status (DPI, WIP or NA) or Count for DPI differs between the ${previous} release and this build, by System ID. ` +
  'Both come from the DPI test in src/DpiTest.ts. The criteria are the DPI test\'s, plus the implementation status when it changed.',
  '',
  '### Countries with a DPI-like system',
  '',
  'The headline count on the home page: places that are countries, not regions, with at least one system that passes the DPI test.',
  '',
  `| Type | ${previous} | ${release} |`,
  '|---|---|---|',
  ...headline.map(h => `| ${typeName[h.dpiType]} | ${h.old} | ${h.new} |`),
  '',
  `### Systems whose status changed: ${changes.length}`,
  '',
  '| System ID | Name | Was | Now | What changed |',
  '|---|---|---|---|---|',
  ...changes.map(c => `| ${c.id} | ${c.name} | ${c.old} | ${c.new} | ${c.criteria} |`),
  '',
  `### New systems: ${added.length}`,
  '',
  ...added.map(c => `- ${c.id}, ${c.name}: ${c.new}`),
  '',
  `### Removed systems: ${removed.length}`,
  '',
  ...removed.map(c => `- ${c.id}, ${c.name}: was ${c.old}`),
  ''
] : ['## DPI status changes', '', 'There is no earlier release to compare with.', '']

const counts = countByKind(result.report)
const blocking = result.report.filter(item => item.blocking).length
const tableLines = Object.entries(result.tables).map(([name, table]) => `- ${name}: ${table.rows.length} rows, from ${result.changesets[name].length} changesets`)

const body = formatReport(result.report, `Data build: the ${release} release`)
const firstSection = body.indexOf('\n## ')
if (!check) fs.mkdirSync(path.dirname(reportPath), { recursive: true })
const reportText = [
  body.slice(0, firstSection).replace('\n\n', `\n\nBuilt by \`npm run data:build -- --release ${release}\` into \`public/data/${release}/\`, from ${previous ? `the ${previous} release` : 'no earlier release'} and the changesets in \`changesets/${release}/\` and \`changesets/${PENDING_FOLDER}/\`.\n\n${tableLines.join('\n')}\n\n`),
  ...statusLines,
  ...legacyLines,
  body.slice(firstSection + 1),
  '## scripts/validate.mjs on the release',
  '',
  'Its failures are listed above, as values that fail a check or as legacy warnings, each with the changeset that introduced the value.',
  '',
  '```',
  validateSummary.trimEnd(),
  '```',
  ''
].join('\n')
if (!check) fs.writeFileSync(reportPath, reportText)

if (check) {
  const LIMIT = 20
  const problems: string[] = []
  const show = (v: unknown) => { const t = JSON.stringify(v) ?? 'undefined'; return t.length > 80 ? t.slice(0, 77) + '...' : t }
  /** Rows keyed by System ID: the rows only one side has, and the cells that differ */
  const compareRows = (file: string, key: string, disk: Record<string, unknown>[], rebuilt: Record<string, unknown>[]) => {
    const index = (rows: Record<string, unknown>[]) => new Map(rows.map((row, i) => [String(row[key] ?? `(row ${i + 1})`), row]))
    const a = index(disk)
    const b = index(rebuilt)
    for (const id of b.keys()) if (!a.has(id)) problems.push(`${file}: ${id} is missing on disk, and the rebuild has it`)
    for (const id of a.keys()) if (!b.has(id)) problems.push(`${file}: ${id} is on disk, and the rebuild doesn't have it`)
    for (const [id, was] of a) {
      const now = b.get(id)
      if (!now) continue
      for (const column of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (was[column] !== now[column]) problems.push(`${file}: ${id}, "${column}": on disk ${show(was[column])}, rebuilt ${show(now[column])}`)
      }
    }
  }
  const readText = (dir: string, name: string) => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : undefined
  for (const name of fs.readdirSync(out).sort()) {
    const file = `public/data/${release}/${name}`
    const was = readText(releaseDir, name)
    const now = readText(out, name)!
    if (was === undefined) { problems.push(`${file}: is missing on disk`); continue }
    if (was === now) continue
    const before = problems.length
    const table = result.tables[name.replace(`${release}-`, '').replace(/\.json$/, '')]
    const key = table && keyField(table.resource).name
    try {
      if (name.endsWith('.json') && table) compareRows(file, key!, JSON.parse(was), JSON.parse(now))
    } catch (e) {
      problems.push(`${file}: can't be compared (${(e as Error).message})`)
    }
    // the same rows and columns, but the file's text differs (formatting, order, or another file)
    if (problems.length === before) problems.push(`${file}: differs from the rebuild${table ? ' in its formatting or the order of its rows' : ''}`)
  }
  // a file the rebuild doesn't write, like a table's CSV, which releases no longer carry (D67)
  for (const name of fs.readdirSync(releaseDir).sort()) {
    if (!written.includes(name)) problems.push(`public/data/${release}/${name}: is on disk, and the rebuild doesn't write it`)
  }
  const blockers = result.report.filter(item => item.blocking)
  fs.rmSync(out, { recursive: true, force: true })
  // CITATION.cff's version and release date are the release the site shows (src/Citation.ts)
  const { release: siteRelease } = await import('../src/ReleaseFiles.ts')
  const { citationFileProblems } = await import('../src/Citation.ts')
  const citationProblems = citationFileProblems(siteRelease)

  const lines: string[] = []
  const list = (title: string, items: string[]) => {
    if (!items.length) return
    lines.push('', `${title}: ${items.length}`, ...items.slice(0, LIMIT).map(l => `  ${l}`))
    if (items.length > LIMIT) lines.push(`  ...and ${items.length - LIMIT} more`)
  }
  list(`public/data/${release}/ differs from the rebuild`, problems)
  list('Blocking items in the build', blockers.map(item => `${item.resource ?? ''} ${item.key ?? ''} ${item.field ?? ''}: ${item.message}`.replace(/\s+/g, ' ').trim()))
  list('CITATION.cff is not the release the site shows', citationProblems)
  if (lines.length) {
    const rebuild = problems.length > 0 || blockers.length > 0
    console.log(rebuild
      ? `data:check FAILED: public/data/${release}/ is not what the previous release (${previous ?? 'none'}) and changesets/${release}/ build.${lines.join('\n')}`
      : `data:check FAILED: CITATION.cff doesn't match the release.${lines.join('\n')}`)
    if (rebuild) console.log(`\nRebuild it with: npm run data:build -- --release ${release}`)
    if (citationProblems.length) console.log(`\nSet version and date-released in CITATION.cff to ${siteRelease}.`)
    process.exit(1)
  }
  console.log(`data:check passed: public/data/${release}/ is what the previous release (${previous ?? 'none'}) and changesets/${release}/ build.`)
  process.exit(0)
}

console.log(`Wrote public/data/${release}/: ${written.join(', ')}`)
console.log(`Wrote ${redirects.length / 2} removed systems' redirects to ${path.relative(root, redirectsPath)}`)
console.log(`Wrote ${latestRedirects.length} redirects from /data/latest/ to the ${latest} release to ${path.relative(root, redirectsPath)}`)
console.log(`Wrote /data/latest/dpimap.xlsx's filename, dpimap-${latest}.xlsx, to ${path.relative(root, headersPath)}`)
for (const line of tableLines) console.log(line)
console.log(`\n${blocking} blocking item${blocking === 1 ? '' : 's'}, ${result.report.length - blocking} not blocking`)
for (const { kind, blocking, count } of counts) console.log(`  ${blocking ? 'blocks' : 'note  '}  ${String(count).padStart(5)}  ${KIND_TITLES[kind]}`)
if (previous) {
  console.log(`\n${changes.length} systems changed DPI status since ${previous}, ${added.length} new, ${removed.length} removed`)
  for (const h of headline) console.log(`  countries with a DPI-like ${typeName[h.dpiType]} system: ${h.old} -> ${h.new}`)
}
console.log(`\nReport: ${path.relative(root, reportPath)}`)
process.exitCode = blocking ? 1 : 0
