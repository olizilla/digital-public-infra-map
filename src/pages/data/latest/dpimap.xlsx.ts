// /data/latest/dpimap.xlsx: the release the site shows (src/ReleaseFiles.ts) as one workbook, made at
// build time from the release's JSON, which is the canonical format (D67). Not committed, and nothing
// on the site links to it yet. public/_headers (written by data:build) has it saved as
// dpimap-<release>.xlsx. Uploaded to Drive and opened with Sheets, it is the release's Google Sheet.
//
// An About sheet comes first, then a sheet for each of the release's tables, named as the changes pages
// name the DPI types. Its columns are the JSON's keys, in order, with the keys as the header, and its
// values are the JSON's: numbers as numbers, and the rest as text. A missing value is NA, as in the JSON. Each header links to the field's codebook page, and
// each System ID to the system's page. Links are to https://dpimap.org, wherever the site is built, so
// they work in a downloaded copy.
import type { APIRoute } from 'astro'
import ExcelJS from 'exceljs'
import { citation, release, releasePackage, releaseTables } from '../../../ReleaseFiles'
import { schemas, resourceNames, type DPIType, type Field } from '../../../Schema'
import { variablePath } from '../../../Codebook'
import { systemHref } from '../../../Systems'
import { changeTitles } from '../../../Changes'

const origin = 'https://dpimap.org'
const link = (path: string) => new URL(path, origin).href

/** The widest a column gets, in characters, so long text doesn't make huge columns */
const MAX_WIDTH = 50
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
    ['Canonical data', "The release's JSON files and its datapackage.json are the canonical data. This workbook is a convenience copy."],
    ['datapackage.json', datapackage, datapackage]
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

function tableSheet (workbook: ExcelJS.Workbook, dpiType: DPIType) {
  const rows = releaseTables[resourceNames[dpiType]]
  const fields = schemas[dpiType].fields as Field[]
  const header = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const fieldNamed = (name: string) => {
    const field = fields.find(field => field.name === name)
    if (!field) throw new Error(`"${name}" in the ${release} ${resourceNames[dpiType]} JSON is not a field in its datapackage.json`)
    return field
  }
  const keyColumn = header.findIndex(name => fieldNamed(name).id === 'system_id')
  const sheet = workbook.addWorksheet(changeTitles[dpiType], { views: [{ state: 'frozen', ySplit: 1 }] })

  // every field has a codebook page, including those the codebook doesn't cover (src/pages/codebook/[resource]/[field].astro)
  sheet.addRow(header.map(name => ({ text: name, hyperlink: link(variablePath(dpiType, fieldNamed(name))) })))
  sheet.getRow(1).font = { bold: true, ...linkFont }
  for (const row of rows) {
    const values = header.map(name => {
      const value = row[name]
      return value === undefined || value === null ? 'NA' : typeof value === 'number' ? value : typeof value === 'string' ? value : JSON.stringify(value)
    })
    const id = values[keyColumn]
    const added = sheet.addRow(values.map((value, i) => i === keyColumn && typeof value === 'string' && value !== 'NA' ? { text: value, hyperlink: link(systemHref(value)) } : value))
    added.getCell(keyColumn + 1).font = id === 'NA' ? {} : linkFont
  }
  header.forEach((name, i) => {
    const longest = Math.max(name.length, ...rows.map(row => String(row[name] ?? 'NA').length))
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), MAX_WIDTH)
  })
}

export const GET: APIRoute = async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DPI Map'
  // the release's date, so a rebuild of the same release makes the same workbook
  workbook.created = workbook.modified = new Date(`${release}T00:00:00Z`)
  aboutSheet(workbook)
  for (const dpiType of Object.keys(resourceNames) as DPIType[]) tableSheet(workbook, dpiType)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } })
}
