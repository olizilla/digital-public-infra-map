// Write built tables and their provenance.

import { fieldId } from './build.ts'
import { writeCSV } from './csv.ts'
import type { CSVStyle } from './csv.ts'
import type { BuildResult, Table } from './types.ts'

/** A table as CSV, with the fields' names as the header */
export function tableCSV (table: Table, style?: CSVStyle): string {
  const ids = table.fields.map(fieldId)
  return writeCSV([table.fields.map(field => field.name), ...table.rows.map(row => ids.map(id => row[id]))], style)
}

/** A history entry as JSON: the reason and author are under the changeset, once each */
export interface HistoryEntryJSON {
  changeset: string
  change: number
  type: string
  as_of: string
  value: string
  valueChanged: boolean
  sources?: string[]
}

export interface HistoryJSON {
  /** Changeset id -> its author and summary, if any, and each change's reason by index */
  changesets: Record<string, { author?: string, summary?: string, reasons: string[] }>
  /** Row key -> field id -> every change to the cell, oldest first, so the last set its value */
  rows: Record<string, Record<string, HistoryEntryJSON[]>>
}

/**
 * The history of every cell of a table, as JSON-ready data: for each row key
 * and field id, every change to the cell in the order that decides its value,
 * each with its changeset, the change's index, its type, as_of, value, whether
 * the value changed, and its sources. The reasons, authors and summaries are
 * under `changesets`, once each. Derived cells have no entry.
 */
export function historyJSON (result: BuildResult, resource: string): HistoryJSON {
  const table = result.history[resource] ?? {}
  const used = new Set<string>()
  const rows: HistoryJSON['rows'] = {}
  for (const [key, cells] of Object.entries(table)) {
    rows[key] = {}
    for (const [id, entries] of Object.entries(cells)) {
      rows[key][id] = entries.map(e => {
        used.add(e.changeset)
        return { changeset: e.changeset, change: e.change, type: e.type, as_of: e.as_of, value: e.value, valueChanged: e.valueChanged, ...(e.sources.length ? { sources: e.sources } : {}) }
      })
    }
  }
  const changesets = Object.fromEntries((result.changesets[resource] ?? [])
    .filter(c => used.has(c.id))
    .map(c => [c.id, {
      ...(c.author ? { author: c.author } : {}),
      ...(c.summary ? { summary: c.summary } : {}),
      reasons: c.changes.map(change => change.reason ?? '')
    }]))
  return { changesets, rows }
}
