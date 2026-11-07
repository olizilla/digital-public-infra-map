// Read and write CSV (RFC 4180). Writing quotes only the cells that need it, and
// the line endings can match the source's, so a table that didn't change is
// written back byte for byte.

/** The rows of a CSV, as lists of cells. Blank lines are skipped. */
export function parseCSV (text: string): string[][] {
  text = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    cell = ''
  }
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (ch === '"') { quoted = false; i++; continue }
      cell += ch
      i++
      continue
    }
    if (ch === '"') { quoted = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r' && text[i + 1] === '\n') { endRow(); i += 2; continue }
    if (ch === '\n' || ch === '\r') { endRow(); i++; continue }
    cell += ch
    i++
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

/** The rows of a CSV with a header row, as header -> cell. Missing cells are "". */
export function parseCSVRecords (text: string): { header: string[], records: Record<string, string>[] } {
  const [header = [], ...rows] = parseCSV(text)
  const records = rows.map(row => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])))
  return { header, records }
}

const needsQuotes = /[",\r\n]/

function csvCell (value: string): string {
  return needsQuotes.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export interface CSVStyle {
  /** What ends a row. Defaults to \n. */
  eol?: string
  /** Whether the last row ends with `eol` too. Defaults to true. */
  finalEol?: boolean
}

/** A CSV with one line per row */
export function writeCSV (rows: string[][], { eol = '\n', finalEol = true }: CSVStyle = {}): string {
  const text = rows.map(row => row.map(csvCell).join(',')).join(eol)
  return finalEol && rows.length ? text + eol : text
}
