// Pull the codebook tabs from the public Google Sheet and write them to
// src/codebook.json, in the shape the site needs, with anchor ids and
// "Codes explained" already extracted, so the site does no CSV parsing of its
// own. Commit the result, so changes to the sheet show up as a git diff.
//
// Google's export has CRLF line endings and the sheet has stray spaces around
// some cells, so the cells are normalised: LF line endings, every cell trimmed,
// trailing spaces removed from each line inside multi-line cells, and empty
// rows dropped. The text itself is left alone.
//
// see: https://docs.google.com/spreadsheets/d/1XywQ7War3luFLzfuvqdeH-ZH7S_b2jibYk9fOjlcRgs/
//
// usage: npm run codebook:pull
import { writeFile } from 'node:fs/promises'
import Papa from 'papaparse'
import slug from 'slug'

const SHEET_ID = '1XywQ7War3luFLzfuvqdeH-ZH7S_b2jibYk9fOjlcRgs'
// Each tab's gid, and the site's dpiType for it (the key in codebook.json).
const TABS = {
  identity: { gid: 0, dpiType: 'id' },
  payment: { gid: 1849713453, dpiType: 'pay' },
  exchange: { gid: 2085841653, dpiType: 'data' }
}
const JSON_FILE = new URL('../src/codebook.json', import.meta.url)

const cleanCell = (cell) => cell.split('\n').map(line => line.trimEnd()).join('\n').trim()

/** Parse Google's CSV export into rows of trimmed cells, with empty rows dropped. */
function parseSheet (text) {
  // Convert line endings first, so records and multi-line cells both end up with LF.
  const lf = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const { data, errors } = Papa.parse(lf, { newline: '\n' })
  if (errors.length > 0) {
    throw new Error(`Failed to parse CSV: ${errors.map(e => `row ${e.row}: ${e.message}`).join('; ')}`)
  }
  return data
    .map(row => row.map(cleanCell))
    .filter(row => row.some(cell => cell !== ''))
}

/** Parse "Codes explained" into key/value pairs, from lines like `1 = Yes`. */
function parseCodes (text) {
  const re = /^\s*(?<key>[^=]+)=\s*(?<val>.*)$/gm
  return [...text.matchAll(re)].map(({ groups: { key, val } }) => ({ key: key.trim(), value: val.trim() }))
}

/** Turn the sheet rows into the variables the site uses, in sheet order. */
function toVariables (dpiType, [header, ...rows]) {
  const col = (row, name) => {
    const i = header.indexOf(name)
    if (i === -1) throw new Error(`Missing column "${name}" in ${dpiType} tab`)
    return row[i] ?? ''
  }
  return rows
    .filter(row => col(row, 'Variable name') !== '')
    .map(row => {
      const name = col(row, 'Variable name')
      const indicator = col(row, 'Related indicator in Measuring DPI Framework')
      return {
        name,
        anchor: `${dpiType}-${slug(name)}`,
        description: col(row, 'Description'),
        type: col(row, 'Variable type'),
        categories: col(row, 'Range/ Categories'),
        codes: parseCodes(col(row, 'Codes explained')),
        scope: col(row, 'System vs. subsystem level variable'),
        indicator: indicator === 'NA' ? '' : indicator
      }
    })
}

const variables = {}

for (const [name, { gid, dpiType }] of Object.entries(TABS)) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${name} (gid=${gid}): ${res.status} ${res.statusText}`)
  }
  variables[dpiType] = toVariables(dpiType, parseSheet(await res.text()))
}

const json = JSON.stringify(variables, null, 2) + '\n'
await writeFile(JSON_FILE, json)
console.log(`src/codebook.json (${Buffer.byteLength(json)} bytes)`)
