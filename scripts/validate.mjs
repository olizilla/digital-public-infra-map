// Check the shape of datapackage.json, then each resource's CSV, at its
// `path`, against the resource's schema.
// Prints one line per problem, tab separated, then a summary per resource
// that counts, for each column, the values found that aren't allowed.
// A cell in the schema's `missingValues` (NA) is unknown, which is fine unless
// the field is `required`. A field with `unique` must not repeat a value, and
// the schema's `primaryKey` is always required and unique, even if its fields
// don't say so. A `foreignKeys` entry must refer to a value in another resource.
// A resource with a `system_id` field has its ids checked against the places in
// public/data/places.csv: the id's place must be a code there, and the same
// place as the row's Country / Region, which can be a name from places.csv or
// public/data/place-names.csv.
// Exits 1 if there are any errors. If the package is invalid, the CSVs aren't checked.
//
// usage: npm run validate

import fs from 'node:fs'
import Papa from 'papaparse'
import { listSeparator, listValues } from './fields.mjs'

const root = new URL('../', import.meta.url)

const read = path => fs.readFileSync(new URL(path, root), 'utf8')
const readJSON = path => JSON.parse(read(path))

const packagePath = 'datapackage.json'
const datapackage = readJSON(packagePath)

/** The resource name and field id a path in the package is about, like `(payment, "operator")` */
function whereIs (path) {
  const [, r, f] = path.match(/^\/resources\/(\d+)(?:\/schema\/fields\/(\d+))?/) ?? []
  const resource = datapackage.resources?.[r]
  const id = resource?.schema?.fields?.[f]?.id
  const names = [resource?.name, id && JSON.stringify(id)].filter(Boolean)
  return names.length ? ` (${names.join(', ')})` : ''
}

/**
 * What the site and this script rely on, beyond the standard: each resource has
 * a CSV at a relative path inside the repo and its schema inline, and each field
 * has a unique snake_case `id` and a `title`. As [path, message]
 */
function checkPackage () {
  const problems = []
  if (!Array.isArray(datapackage.resources)) return [['/resources', 'must be a list']]
  datapackage.resources.forEach((resource, r) => {
    const base = `/resources/${r}`
    const { path, schema } = resource
    if (typeof path !== 'string' || path.startsWith('/') || /[:\\]/.test(path) || path.split('/').includes('..')) {
      problems.push([`${base}/path`, 'must be a relative path inside the repo, without ..'])
    }
    if (typeof schema !== 'object' || !Array.isArray(schema?.fields)) {
      problems.push([`${base}/schema`, 'must be inline, with a list of fields'])
      return
    }
    const seen = new Map()
    schema.fields.forEach((field, i) => {
      const at = `${base}/schema/fields/${i}`
      if (typeof field.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field.id)) {
        problems.push([`${at}/id`, 'must be snake_case, like dpi_count'])
      } else if (seen.has(field.id)) {
        problems.push([`${at}/id`, `is the same as ${base}/schema/fields/${seen.get(field.id)}`])
      } else {
        seen.set(field.id, i)
      }
      if (typeof field.title !== 'string' || field.title === '') {
        problems.push([`${at}/title`, 'must be the codebook\'s variable name, or a label if the codebook doesn\'t cover it'])
      }
    })
  })
  return problems
}

/** Check the package's shape. Prints the problems and returns how many. */
function validatePackage () {
  const problems = checkPackage()
  for (const [path, message] of problems) {
    console.log(`${packagePath}\t${path}${whereIs(path)}\t${message}`)
  }
  return problems.length
}

/** Parse `value` as a date in a strptime-style format like `%d/%m/%y` */
function parseDate (value, format = '%Y-%m-%d') {
  const parts = { '%d': '(\\d{2})', '%m': '(\\d{2})', '%y': '(\\d{2})', '%Y': '(\\d{4})' }
  const order = []
  const source = format
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%[dmyY]/g, token => { order.push(token); return parts[token] })
  const match = value.match(new RegExp(`^${source}$`))
  if (!match) return null
  const got = Object.fromEntries(order.map((token, i) => [token, Number(match[i + 1])]))
  const year = got['%Y'] ?? 2000 + got['%y']
  const date = new Date(Date.UTC(year, got['%m'] - 1, got['%d']))
  // reject dates that roll over, like 31/02/25
  if (date.getUTCMonth() !== got['%m'] - 1 || date.getUTCDate() !== got['%d']) return null
  return date
}

/** Cast a non-empty cell to the field's type. Returns undefined if it can't be. */
function cast (field, value) {
  switch (field.type) {
    case 'string': return value
    case 'integer': return /^-?\d+$/.test(value) ? Number(value) : undefined
    case 'number': return value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined
    case 'date': return parseDate(value, field.format) ?? undefined
    default: throw new Error(`unsupported type "${field.type}" for field "${field.id}"`)
  }
}

/** The rows of a resource's CSV, or undefined if the package has no such resource or its CSV is missing */
const tables = new Map()
function rowsOf (name) {
  if (!tables.has(name)) {
    const resource = datapackage.resources.find(resource => resource.name === name)
    const found = resource && fs.existsSync(new URL(resource.path, root))
    const csv = found && read(resource.path).replace(/^\uFEFF/, '')
    tables.set(name, found ? Papa.parse(csv, { header: true, skipEmptyLines: true }).data : undefined)
  }
  return tables.get(name)
}

/** The place codes in places.csv, and place name -> code, from places.csv then place-names.csv */
let places
function placesOf () {
  const rows = rowsOf('places') ?? []
  const aliases = rowsOf('place_names') ?? []
  places ??= {
    codes: new Set(rows.map(row => row.code)),
    byName: new Map([...rows.map(row => [row.name, row.code]), ...aliases.map(row => [row.dpimap_name, row.code])])
  }
  return places
}

const quoteAll = values => values.map(value => JSON.stringify(value)).join(', ')

/**
 * The problem with a multi-valued cell whose field allows `values`, or
 * undefined if it's fine: the values that aren't allowed, and any separator
 * other than ", ". `tally` lists them for the summary.
 */
function checkList (value, values) {
  const notAllowed = []
  let separated = true
  for (const item of value.split(listSeparator)) {
    if (values.includes(item)) continue
    // like "B2B. P2G" or "P2P,G2P", values separated by something else
    const parts = item.split(/\s*[,.;]\s*/)
    if (parts.length > 1) separated = false
    notAllowed.push(...parts.filter(part => !values.includes(part)))
  }
  const messages = []
  const tally = [...notAllowed]
  if (notAllowed.length === 1) messages.push(`has ${JSON.stringify(notAllowed[0])}, which is not an allowed value`)
  if (notAllowed.length > 1) messages.push(`has ${quoteAll(notAllowed)}, which are not allowed values`)
  if (!separated) {
    messages.push(`is not separated by ${JSON.stringify(listSeparator)}`)
    tally.push('(wrong separator)')
  }
  return messages.length ? { message: messages.join(', and '), tally } : undefined
}

/**
 * The problems with one cell, as a list of `{ message, tally }`, where
 * `tally` is the values the summary counts, if any.
 * `missingValues` (like NA, for unknown) pass unless the field is required.
 * An empty cell is always a problem: it's not a missing value, just missing.
 */
function checkCell (field, value, missingValues) {
  const { required, enum: allowed, pattern } = field.constraints ?? {}
  if (value === undefined || value === '') {
    return [{ message: `empty cell, use ${missingValues[0] ?? 'a missing value'} for unknown`, tally: ['(empty)'] }]
  }
  if (missingValues.includes(value)) {
    return required ? [{ message: `is required, so must not be ${value}`, tally: [value] }] : []
  }
  const typed = cast(field, value)
  if (typed === undefined) {
    return [{ message: `is not a valid ${field.type}${field.format ? ` (${field.format})` : ''}` }]
  }
  const problems = []
  if (allowed && !allowed.includes(typed)) {
    problems.push({ message: 'is not an allowed value', tally: [value] })
  }
  if (pattern && !new RegExp(`^(?:${pattern})$`, 'u').test(value)) {
    const values = listValues(field)
    const problem = values && checkList(value, values)
    problems.push(problem ?? { message: `does not match the pattern ${pattern}` })
  }
  return problems
}

/** The names of the schema's `primaryKey` fields. Table Schema allows a single name or a list. */
const primaryKeyOf = schema => [schema.primaryKey ?? []].flat()

function validate ({ name: dataset, path, schema }) {
  const errors = []
  const report = (row, country, column, value, message, tally = []) => {
    errors.push({ column, tally })
    console.log(`${dataset}\trow ${row}\t${country}\t${JSON.stringify(column)}\t${value === undefined ? '-' : JSON.stringify(value)} ${message}`)
  }
  if (!fs.existsSync(new URL(path, root))) {
    report('-', '-', '-', undefined, `no CSV at ${path}`)
    return { dataset, rows: 0, errors, schema }
  }
  const csv = read(path).replace(/^\uFEFF/, '')
  const { data: rows, meta, errors: parseErrors } = Papa.parse(csv, { header: true, skipEmptyLines: true })

  for (const e of parseErrors) {
    report(e.row === undefined ? '-' : e.row + 2, '-', '-', undefined, `CSV parse error: ${e.message}`)
  }

  const names = schema.fields.map(field => field.name)
  for (const name of names.filter(name => !meta.fields.includes(name))) {
    report(1, '-', name, undefined, 'column is in the schema but missing from the data')
  }
  for (const header of meta.fields.filter(header => !names.includes(header))) {
    report(1, '-', header, undefined, 'column is in the data but not in the schema')
  }

  // Table Schema's default is [''], but here an empty cell is an error, see checkCell
  const missingValues = schema.missingValues ?? []
  const countryField = schema.fields.find(field => field.id === 'country')
  const fields = schema.fields.filter(field => meta.fields.includes(field.name))
  const primaryKey = primaryKeyOf(schema)
  for (const name of primaryKey.filter(name => !names.includes(name))) {
    report(1, '-', name, undefined, 'primaryKey names a field that is not in the schema')
  }
  // the columns whose values must not repeat: each `unique` field, and the primary key as a whole
  const uniques = fields.filter(field => field.constraints?.unique).map(field => [field.name])
  const keyInData = primaryKey.length > 0 && primaryKey.every(name => meta.fields.includes(name))
  if (keyInData && !uniques.some(names => names.join() === primaryKey.join())) uniques.push(primaryKey)
  const foreignKeys = schema.foreignKeys ?? []
  // for each foreign key, the values its referenced fields have
  const referenced = foreignKeys.map(({ reference }) => {
    const rows = rowsOf(reference.resource)
    if (!rows) report('-', '-', '-', undefined, `foreignKeys refers to resource "${reference.resource}", which is not in the package or has no CSV`)
    return new Set((rows ?? []).map(row => JSON.stringify([reference.fields].flat().map(name => row[name]))))
  })
  const systemIdField = schema.fields.find(field => field.id === 'system_id')
  const { codes, byName } = placesOf()
  // for each of uniques, value -> the row it was first seen in
  const firstSeen = uniques.map(() => new Map())
  rows.forEach((row, i) => {
    // the sheet's row number: row 1 is the header
    const rowNumber = i + 2
    const country = row[countryField?.name] || '-'
    for (const field of fields) {
      const checked = primaryKey.includes(field.name) ? { ...field, constraints: { ...field.constraints, required: true } } : field
      for (const { message, tally } of checkCell(checked, row[field.name], missingValues)) {
        report(rowNumber, country, field.name, row[field.name], message, tally)
      }
    }
    // an empty or missing value is already reported above, so only repeats and references are looked at here
    const isMissing = value => value === undefined || value === '' || missingValues.includes(value)
    foreignKeys.forEach(({ fields: names, reference }, n) => {
      const values = names.map(name => row[name])
      if (values.some(isMissing) || referenced[n].has(JSON.stringify(values))) return
      report(rowNumber, country, names.join(' + '), values.join(' + '), `is not a ${[reference.fields].flat().join(' + ')} in ${reference.resource}`, [values.join(' + ')])
    })
    // the place in the System ID must be a known place, and the one the row's Country / Region is
    const id = row[systemIdField?.name]
    const place = isMissing(id) ? undefined : id.split('-')[1]
    const named = row[countryField?.name]
    const expected = !countryField || isMissing(named) ? undefined : byName.get(named)
    if (place && !codes.has(place)) {
      report(rowNumber, country, systemIdField.name, id, `has place ${JSON.stringify(place)}, which is not a code in public/data/places.csv`, [id])
    } else if (place && countryField && !isMissing(named) && expected === undefined) {
      report(rowNumber, country, countryField.name, named, 'is not a known place name, add it to public/data/place-names.csv or fix the name', [named])
    } else if (place && expected !== place) {
      report(rowNumber, country, systemIdField.name, id, `has place ${JSON.stringify(place)}, but ${JSON.stringify(named)} is ${JSON.stringify(expected)}`, [id])
    }
    uniques.forEach((names, n) => {
      const values = names.map(name => row[name])
      if (values.some(isMissing)) return
      const key = JSON.stringify(values)
      if (firstSeen[n].has(key)) {
        const value = values.join(' + ')
        report(rowNumber, country, names.join(' + '), value, `is not unique, it repeats row ${firstSeen[n].get(key)}`, [value])
      } else {
        firstSeen[n].set(key, rowNumber)
      }
    })
  })

  return { dataset, rows: rows.length, errors, schema }
}

const packageErrors = validatePackage()
if (packageErrors > 0) {
  console.log(`\n${packageErrors} error${packageErrors === 1 ? '' : 's'} in ${packagePath}. Fix them to check the CSVs.`)
  process.exit(1)
}

const results = datapackage.resources.map(validate)

console.log('\nSummary')
console.log(`\npackage: ${packagePath}, with ${results.length} resources, OK`)
for (const { dataset, rows, errors, schema } of results) {
  console.log(`\n${dataset}: ${rows} rows, ${errors.length} error${errors.length === 1 ? '' : 's'}`)
  // column -> { count, tally: value -> count }
  const byColumn = new Map()
  for (const { column, tally } of errors) {
    const entry = byColumn.get(column) ?? { count: 0, tally: new Map() }
    entry.count++
    for (const value of tally) entry.tally.set(value, (entry.tally.get(value) ?? 0) + 1)
    byColumn.set(column, entry)
  }
  for (const [column, { count, tally }] of byColumn) {
    const field = schema.fields.find(field => field.name === column)
    const { enum: allowed, pattern } = field?.constraints ?? {}
    const values = allowed ?? (field && listValues(field))
    const hint = values ? ` (allowed: ${values.join(', ')})` : pattern ? ` (pattern: ${pattern})` : ''
    console.log(`  ${JSON.stringify(column)}: ${count}${hint}`)
    // the values found instead, most common first
    for (const [value, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n}\t${value.startsWith('(') ? value : JSON.stringify(value)}`)
    }
  }
}

const total = results.reduce((sum, { errors }) => sum + errors.length, 0)
console.log(`\n${total === 0 ? 'OK' : `${total} errors`}`)
process.exitCode = total === 0 ? 0 : 1
