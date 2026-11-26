// /data/latest/dpimap.xlsx: the release the site shows (src/ReleaseFiles.ts) as one workbook, made at
// build time from the release's JSON, which is the canonical format (D67). Not committed, and nothing
// on the site links to it yet. public/_headers (written by data:build) has it saved as
// dpimap-<release>.xlsx. Uploaded to Drive and opened with Sheets, it is the release's Google Sheet.
//
// Six sheets (D97): About, a sheet for each of the release's tables, named as the changes pages name the
// DPI types, then Fields and Evidence.
// - A table sheet's columns are the JSON's keys, the field ids, in order, with each field's title, the
//   codebook's name for it, as the header (D83), and its values are the JSON's: numbers as numbers, and the
//   rest as text. A missing value is NA, as in the JSON. Each header links to the field's codebook page, and
//   each System ID to the system's page. The header row and the System ID column are frozen, and the header
//   row has a filter. Nothing else is added to the data.
// - Fields has a row for each column of the table sheets: its sheet, its header, its field id, its codebook
//   page, its definition and the values it allows (blank for free text).
// - Evidence has a row for each citation (src/Evidence.ts): a current value in a table sheet, other than NA
//   and other than the place (the Place column) or a derived field, and one of its sources, with the value's reason and date, which are those the system's page shows. A
//   value with no source yet has one row, with Source blank. Each Claim, <System ID>/<field id>, links to the
//   field on the system's page.
// Links are to https://dpimap.org, wherever the site is built, so they work in a downloaded copy.
import type { APIRoute } from 'astro'
import ExcelJS from 'exceljs'
import { citation, release, releasePackage, releaseTables } from '../../../ReleaseFiles'
import { schemas, resourceNames, changeTitles, type DPIType, type Field } from '../../../Schema'
import { variablePath } from '../../../Codebook'
import { systemHref } from '../../../Systems'
import { allowedValuesOf, cellValue, columnsOf, definitionOf, dpiTypes, evidenceRows, link } from '../../../Evidence'

/** The widest a column gets, in characters, so long text doesn't make huge columns */
const MAX_WIDTH = 50
/** The widest the Reason and Source columns get */
const MAX_TEXT_WIDTH = 60
/** The widest the Fields sheet's Definition column gets */
const MAX_DEFINITION_WIDTH = 80
const linkFont = { color: { argb: 'FF0563C1' }, underline: true }

/** What a missing value or a category means, from the release's datapackage.json (D73) */
function meaning (value: string) {
  for (const resource of releasePackage.resources) {
    const schema = resource.schema as { missingValues?: unknown[], fields: { categories?: unknown[] }[] }
    const labelled = [...(schema.missingValues ?? []), ...schema.fields.flatMap(field => field.categories ?? [])]
    for (const entry of labelled) {
      if (typeof entry === 'object' && entry && (entry as { value: unknown }).value === value && (entry as { label?: string }).label) return (entry as { label: string }).label
    }
  }
  throw new Error(`public/data/${release}/datapackage.json doesn't say what "${value}" means`)
}

function aboutSheet (workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('About')
  const datapackage = link(`/data/${release}/datapackage.json`)
  // a label and its text, which links to `href` if there is one
  const lines: ([string, string, string?] | [])[] = [
    ['Citation', citation],
    ['Licence', 'Creative Commons Attribution 4.0 International (CC BY 4.0): you may share and adapt the data, with credit.', 'https://creativecommons.org/licenses/by/4.0/'],
    ['Data', link('/data/'), link('/data/')],
    ['Codebook', link('/codebook/'), link('/codebook/')],
    [],
    ['NA', meaning('NA')],
    ['Not Found', meaning('Not Found')],
    [],
    ['Canonical data', "The release's JSON files and its datapackage.json are the canonical data. This workbook is a convenience copy. The JSON's keys are field ids: the Fields sheet gives each column's id."],
    ['datapackage.json', datapackage, datapackage],
    [],
    ['Table sheets', `${dpiTypes.map(dpiType => changeTitles[dpiType]).join(', ')}: the release's data, a row for each system.`],
    ['Fields', 'Defines each column of the table sheets: its field id, its codebook page, its definition and the values it allows.'],
    ['Evidence', "Gives each value's reason, date and sources."],
    ['Evidence claims', "A Claim is <System ID>/<field id>, and links to that value on the system's page."],
    ['Evidence sources', 'There is a row for each source of a value. A blank Source means the value has no source yet.']
  ]
  sheet.addRow([`DPI Map: the ${release} release`]).font = { bold: true, size: 14 }
  sheet.addRow([])
  for (const [label, text, href] of lines) {
    const row = sheet.addRow(label === undefined ? [] : [label, href ? { text, hyperlink: href } : text])
    if (label !== undefined) row.getCell(1).font = { bold: true }
    if (href) row.getCell(2).font = linkFont
  }
  sheet.getColumn(1).width = 18
  sheet.getColumn(2).width = 100
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
}

/** A column of a table sheet, for the Fields sheet */
interface Column { sheet: string, field: Field, href: string }

/** A table's sheet. Returns its columns. */
function tableSheet (workbook: ExcelJS.Workbook, dpiType: DPIType): Column[] {
  const rows = releaseTables[resourceNames[dpiType]]
  const fields = schemas[dpiType].fields as Field[]
  const header = columnsOf(rows)
  const fieldNamed = (name: string) => {
    const field = fields.find(field => field.name === name)
    if (!field) throw new Error(`"${name}" in the ${release} ${resourceNames[dpiType]} JSON is not a field in its datapackage.json`)
    return field
  }
  const keyColumn = header.findIndex(name => fieldNamed(name).id === 'system_id')
  const sheetName = changeTitles[dpiType]
  // the header row and the System ID column stay in view, and the header row has a filter
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', xSplit: keyColumn + 1, ySplit: 1 }], autoFilter: { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } } })
  // every field has a codebook page, including those the codebook doesn't cover (src/pages/codebook/[resource]/[field].astro)
  const columns = header.map(name => {
    const field = fieldNamed(name)
    return { sheet: sheetName, field, href: link(variablePath(dpiType, field)) }
  })

  // the JSON's keys are field ids, so the header is each field's title (D83)
  sheet.addRow(columns.map(({ field, href }) => ({ text: field.title, hyperlink: href })))
  sheet.getRow(1).font = { bold: true, ...linkFont }
  for (const row of rows) {
    const values = header.map(name => cellValue(row[name]))
    const id = values[keyColumn]
    const added = sheet.addRow(values.map((value, i) => i === keyColumn && typeof value === 'string' && value !== 'NA' ? { text: value, hyperlink: link(systemHref(value)) } : value))
    added.getCell(keyColumn + 1).font = id === 'NA' ? {} : linkFont
  }
  header.forEach((name, i) => {
    const longest = Math.max(columns[i].field.title.length, ...rows.map(row => String(row[name] ?? 'NA').length))
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), MAX_WIDTH)
  })
  return columns
}

/** Each table sheet's columns, in sheet then column order: its header, its field id, its codebook page, its definition and its allowed values (D83, D97) */
function fieldsSheet (workbook: ExcelJS.Workbook, columns: Column[]) {
  const sheet = workbook.addWorksheet('Fields', { views: [{ state: 'frozen', ySplit: 1 }] })
  const header = ['Sheet', 'Column', 'Field id', 'Codebook', 'Definition', 'Allowed values']
  const cells = columns.map(column => {
    const dpiType = dpiTypes.find(dpiType => changeTitles[dpiType] === column.sheet)!
    return [column.sheet, column.field.title, column.field.id, column.href, definitionOf(dpiType, column.field), allowedValuesOf(dpiType, column.field)]
  })
  sheet.addRow(header).font = { bold: true }
  for (const [name, title, id, href, definition, allowed] of cells) sheet.addRow([name, title, id, { text: href, hyperlink: href }, definition, allowed]).getCell(4).font = linkFont
  // the links are as wide as they need to be, so they read whole
  header.forEach((text, i) => {
    const longest = Math.max(text.length, ...cells.map(row => row[i].length)) + 2
    sheet.getColumn(i + 1).width = i === 3 ? longest : Math.min(longest, i === 4 ? MAX_DEFINITION_WIDTH : MAX_WIDTH)
  })
}

/** The Evidence sheet: a row for each citation, in the order src/Evidence.ts gives (D97) */
function evidenceSheet (workbook: ExcelJS.Workbook) {
  const rows = evidenceRows()
  const sheet = workbook.addWorksheet('Evidence', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], autoFilter: { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } } })
  // each column's header and its widest allowed width, in characters. Nothing wraps, so a row is one line tall.
  const columns = [
    ['Claim', 50], ['Table', 20], ['System', 40], ['Place', 30], ['Field', 50], ['Value', 40], ['As of', 12], ['Reason', MAX_TEXT_WIDTH], ['Source', MAX_TEXT_WIDTH]
  ] as const
  sheet.addRow(columns.map(([header]) => header)).font = { bold: true }
  for (const row of rows) {
    const added = sheet.addRow([
      { text: row.claim, hyperlink: row.claimHref },
      row.table,
      row.system,
      row.place,
      { text: row.field, hyperlink: row.fieldHref },
      row.value,
      row.asOf ? new Date(`${row.asOf}T00:00:00Z`) : null,
      row.reason,
      row.source ? { text: row.source, hyperlink: row.source } : null
    ])
    for (const column of [1, 5, 9]) if (added.getCell(column).value) added.getCell(column).font = linkFont
    added.getCell(7).numFmt = 'yyyy-mm-dd'
  }
  const lengths = columns.map(([header]) => header.length)
  for (const row of rows) {
    ;[row.claim, row.table, row.system, row.place, row.field, String(row.value), row.asOf, row.reason, row.source].forEach((text, i) => {
      lengths[i] = Math.max(lengths[i], text.length)
    })
  }
  columns.forEach(([, widest], i) => { sheet.getColumn(i + 1).width = Math.min(lengths[i] + 2, widest) })
}

export const GET: APIRoute = async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DPI Map'
  // the release's date, so a rebuild of the same release makes the same workbook
  workbook.created = workbook.modified = new Date(`${release}T00:00:00Z`)
  aboutSheet(workbook)
  const columns = (Object.keys(resourceNames) as DPIType[]).flatMap(dpiType => tableSheet(workbook, dpiType))
  fieldsSheet(workbook, columns)
  evidenceSheet(workbook)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } })
}
