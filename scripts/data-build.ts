// Build a data release from the changeset log (D45, D50).
//
// Replays changesets/<resource>/ onto its baseline with lib/changesets, for
// each table in the root datapackage.json that has a log, and writes
// public/data/<release>/:
// - <resource>.csv, and <release>-<resource>.json in the earlier releases' format
// - places.csv and place-names.csv, copied
// - datapackage.json: the root one, with paths to the files in this folder
// It writes every cell's history, for the site's system pages, to
// src/data/history-<release>.json, which isn't published.
//
// The DPI layer (D48): Last updated is the row's newest as_of, as YYYY-MM-DD
// (D49), Count for DPI is from the DPI test in src/DpiTest.ts, the same code
// the site uses, and a new system goes below the last system for its place,
// by src/Places.ts.
//
// It then checks the release with scripts/validate.mjs. A failing value blocks
// only if a changeset introduced it, and one from the baseline is a legacy
// warning (D60). It writes a report of everything it skipped or found, and of
// every system whose DPI status changed since the previous release, to
// reports/data-build-<release>.md, which isn't published.
//
// Removed systems have no page, so it redirects each System ID that was in the
// baseline and isn't in the release to its country page (D64), in public/_redirects
// between marker comments.
//
// It always writes the release, and exits 1 if anything blocks a merge (D51).
//
// usage: npm run data:build -- --release 2026-11-06 [--previous 2026-03-31]

import './site-modules.ts'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import slug from 'slug'
import {
  build, checkItem, countByKind, fieldId, formatReport, historyJSON, keyField, KIND_TITLES, missingValue, missingValues, parseCSVRecords, tableCSV
} from '../lib/changesets/index.ts'
import type { DataPackage, Field, Row, Table } from '../lib/changesets/index.ts'

// the site's modules, which need ./site-modules.ts to load in Node
const { dpiStatus, dpiTest, implementationStatus, nameOf, passesDpiTest, presence, valueOf } = await import('../src/DpiTest.ts')
const { resourceNames, schemas, toRecord } = await import('../src/Schema.ts')
const { normaliseImplementationStatus, statusSort } = await import('../src/Status.js')
const { placeNamed } = await import('../src/Places.ts')
const { oneSystemPerCountry } = await import('../src/Util.ts')
type DPIType = keyof typeof resourceNames

const root = path.resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({ options: { release: { type: 'string' }, previous: { type: 'string' } } })
const release = args.release
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
if (!isDate(release) || (args.previous && !isDate(args.previous))) {
  console.error('usage: npm run data:build -- --release YYYY-MM-DD [--previous YYYY-MM-DD]')
  process.exit(2)
}

const datapackage: DataPackage = JSON.parse(fs.readFileSync(path.join(root, 'datapackage.json'), 'utf8'))
const dataDir = path.join(root, 'public', 'data')
const out = path.join(dataDir, release!)
const historyPath = path.join(root, 'src', 'data', `history-${release}.json`)
const reportPath = path.join(root, 'reports', `data-build-${release}.md`)
// files that are copied into the release as they are
const copied = ['public/data/places.csv', 'public/data/place-names.csv']

const dpiTypeOf = Object.fromEntries(Object.entries(resourceNames).map(([dpiType, name]) => [name, dpiType])) as Record<string, DPIType>
const resourceOf = (name: string) => datapackage.resources.find(r => r.name === name)!

/** A row keyed by column header, as the site's JSON has it */
const byName = (fields: Field[], row: Row) => Object.fromEntries(fields.map(field => [field.name, row[fieldId(field)]]))

/** A row as the site's record for it, keyed by label, with its 'DPI Status' (see src/Identity.ts) */
function recordOf (dpiType: DPIType, row: Record<string, unknown>) {
  const record = toRecord(schemas[dpiType], row, { status: normaliseImplementationStatus })
  record['DPI Status'] = dpiStatus(dpiType, record)
  return record
}

/** A baseline row's Last updated, dd/mm/yy, as YYYY-MM-DD: the as_of of its cells (D7) */
function lastUpdated (_resource: string, row: Row): string | undefined {
  const [, d, m, y] = row.last_updated?.match(/^(\d{2})\/(\d{2})\/(\d{2})$/) ?? []
  return y ? `20${y}-${m}-${d}` : undefined
}

const derived = ['last_updated', 'dpi_count']
const result = build({
  datapackage,
  log: path.join(root, 'changesets'),
  snapshotAsOf: lastUpdated,
  derive: {
    fields: Object.fromEntries(Object.keys(dpiTypeOf).map(name => [name, derived])),
    values: (name, row, { asOf }) => {
      const record = toRecord(schemas[dpiTypeOf[name]], byName(resourceOf(name).schema.fields, row))
      return {
        ...(asOf ? { last_updated: asOf } : {}),
        dpi_count: passesDpiTest(dpiTest(dpiTypeOf[name], record)) ? '1' : '0'
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

// the earlier releases' CSVs are Google Sheets exports: \r\n between rows, and none at the end
const csvStyle = { eol: '\r\n', finalEol: false }

fs.mkdirSync(out, { recursive: true })
const written: string[] = []
const write = (name: string, text: string) => {
  fs.writeFileSync(path.join(out, name), text)
  written.push(name)
}

for (const [name, table] of Object.entries(result.tables)) {
  write(`${name}.csv`, tableCSV(table, csvStyle))
  write(`${release}-${name}.json`, JSON.stringify(tableRecords(table)))
}
for (const file of copied) write(path.basename(file), fs.readFileSync(path.join(root, file), 'utf8'))

// the release's own datapackage.json, whose paths are the files in this folder (D50)
const releasePackage = structuredClone(datapackage)
for (const resource of releasePackage.resources) {
  const file = path.basename(resource.path!)
  if (!written.includes(file)) throw new Error(`resource "${resource.name}" has no file in the release: ${file}`)
  resource.path = file
}
write('datapackage.json', JSON.stringify(releasePackage, null, 2) + '\n')
// the history isn't published: it's for the site build (D45)
fs.rmSync(path.join(out, 'history.json'), { force: true })
fs.mkdirSync(path.dirname(historyPath), { recursive: true })
fs.writeFileSync(historyPath, JSON.stringify(Object.fromEntries(Object.keys(result.tables).map(name => [name, historyJSON(result, name)]))))

// --- redirects for removed systems (D64) ---

/** The keys of the rows in a resource's baseline snapshots, with each row's place, in order */
function baselineRows (name: string) {
  const resource = resourceOf(name)
  const key = keyField(resource).name
  const country = resource.schema.fields.find(f => fieldId(f) === 'country')?.name
  const rows: { key: string, country: string }[] = []
  for (const changeset of result.changesets[name] ?? []) {
    for (const change of changeset.changes) {
      if (change.type !== 'snapshot' || !change.table) continue
      const { records } = parseCSVRecords(fs.readFileSync(path.join(path.dirname(changeset.path), change.table), 'utf8'))
      for (const record of records) if (record[key]) rows.push({ key: record[key], country: country ? record[country] : '' })
    }
  }
  return rows
}

// each place's country page, as src/Records.ts names it: after the first row for the place,
// in its order, of the places with a system (src/pages/[country].astro)
const countryPages = new Map<string, string>()
for (const [name, table] of Object.entries(result.tables)) {
  const dpiType = dpiTypeOf[name]
  if (!dpiType) continue
  const records = tableRecords(table).map(row => recordOf(dpiType, row)).sort(statusSort)
  for (const record of records) {
    const code = placeNamed(record.Country)?.code
    if (code && presence(dpiType, record) !== 'not-found' && !countryPages.has(code)) countryPages.set(code, `/${slug(record.Country)}/`)
  }
}
const redirects: string[] = []
for (const [name, table] of Object.entries(result.tables)) {
  if (!dpiTypeOf[name]) continue
  const keyId = fieldId(keyField(table.resource))
  const built = new Set(table.rows.map(row => row[keyId]))
  for (const { key, country } of baselineRows(name)) {
    if (built.has(key)) continue
    const target = countryPages.get(placeNamed(country)?.code ?? '') ?? '/'
    redirects.push(`/${key} ${target} 302`, `/${key}/ ${target} 302`)
  }
}
const redirectsPath = path.join(root, 'public', '_redirects')
const markers = ['# removed systems (generated by data:build)', '# end removed systems']
const before = fs.existsSync(redirectsPath) ? fs.readFileSync(redirectsPath, 'utf8') : ''
const block = [markers[0], ...redirects, markers[1]].join('\n')
const [start, end] = markers.map(marker => before.indexOf(marker))
const after = start !== -1 && end > start
  ? before.slice(0, start) + block + before.slice(end + markers[1].length)
  : before.replace(/\n*$/, before ? '\n' : '') + block + '\n'
fs.writeFileSync(redirectsPath, after)

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

/** The latest release folder before this one with JSON for every table */
function previousRelease () {
  return fs.readdirSync(dataDir)
    .filter(d => isDate(d) && d < release! && Object.keys(dpiTypeOf).every(name => fs.existsSync(path.join(dataDir, d, `${d}-${name}.json`))))
    .sort().at(-1)
}
const previous = args.previous ?? previousRelease()

/**
 * The previous release's records, by System ID. A release from before System IDs (like 2026-03-31)
 * gets them from the baseline snapshot, which is that release plus System IDs, row for row.
 */
function previousRecords (name: string): Map<string, Record<string, any>> {
  const dpiType = dpiTypeOf[name]
  const rows: Record<string, any>[] = JSON.parse(fs.readFileSync(path.join(dataDir, previous!, `${previous}-${name}.json`), 'utf8'))
  if (rows.every(row => row['System ID'] === undefined)) {
    const baseline = `changesets/${name}/0000/${name}.csv`
    const { records } = parseCSVRecords(fs.readFileSync(path.join(root, baseline), 'utf8'))
    const fields = resourceOf(name).schema.fields
    const header = (id: string) => fields.find(f => fieldId(f) === id)!.name
    rows.forEach((row, i) => {
      const same = records[i] && ['country', 'name'].every(id => String(row[header(id)]) === records[i][header(id)])
      if (!same || rows.length !== records.length) throw new Error(`${previous}-${name}.json is not ${baseline} row for row, so its rows have no System IDs`)
      row['System ID'] = records[i][header('system_id')]
    })
  }
  return new Map(rows.map(row => [row['System ID'], recordOf(dpiType, row)]))
}

interface StatusChange { dpiType: DPIType, id: string, name: string, old?: string, new?: string, criteria: string }
const changes: StatusChange[] = []
const added: StatusChange[] = []
const removed: StatusChange[] = []
const headline: { dpiType: DPIType, old: number, new: number }[] = []
const countLabel = 'Count for DPI'
const statusText = (record?: Record<string, any>) => record && `${record['DPI Status']} (${record[countLabel]})`

if (previous) {
  for (const [name, table] of Object.entries(result.tables)) {
    const dpiType = dpiTypeOf[name]
    if (!dpiType) continue
    const before = previousRecords(name)
    const after = new Map(tableRecords(table).map(row => [row['System ID'] as string, recordOf(dpiType, row)]))
    const nameFor = (record: Record<string, any>) => nameOf(dpiType, record) ?? '(unnamed)'
    for (const [id, now] of after) {
      const then = before.get(id)
      if (!then) {
        added.push({ dpiType, id, name: nameFor(now), new: statusText(now), criteria: '' })
        continue
      }
      if (then['DPI Status'] === now['DPI Status'] && then[countLabel] === now[countLabel]) continue
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
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, [
  body.slice(0, firstSection).replace('\n\n', `\n\nBuilt by \`npm run data:build -- --release ${release}\` into \`public/data/${release}/\`.\n\n${tableLines.join('\n')}\n\n`),
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
].join('\n'))

console.log(`Wrote public/data/${release}/: ${written.join(', ')}`)
console.log(`Wrote ${path.relative(root, historyPath)}`)
console.log(`Wrote ${redirects.length / 2} removed systems' redirects to ${path.relative(root, redirectsPath)}`)
for (const line of tableLines) console.log(line)
console.log(`\n${blocking} blocking item${blocking === 1 ? '' : 's'}, ${result.report.length - blocking} not blocking`)
for (const { kind, blocking, count } of counts) console.log(`  ${blocking ? 'blocks' : 'note  '}  ${String(count).padStart(5)}  ${KIND_TITLES[kind]}`)
if (previous) {
  console.log(`\n${changes.length} systems changed DPI status since ${previous}, ${added.length} new, ${removed.length} removed`)
  for (const h of headline) console.log(`  countries with a DPI-like ${typeName[h.dpiType]} system: ${h.old} -> ${h.new}`)
}
console.log(`\nReport: ${path.relative(root, reportPath)}`)
process.exitCode = blocking ? 1 : 0
