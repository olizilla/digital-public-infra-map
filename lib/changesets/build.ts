// Replay a log of changesets into tables (D46, D47).
//
// - Reverted changesets are dropped first, resolving reverts in id order.
// - A cell's value comes from the change with the latest `as_of`, with ties
//   broken by changeset id, then by the change's place in its changeset.
// - Whether a row exists comes from its latest create, remove or snapshot, in
//   the same order. An update or remove needs the row to exist at that point:
//   after the changes that come before it in the log.
// - Rows keep the order of their snapshot. A new row goes after the last row in
//   its group, removed or not, so a replacement takes the place of the system it
//   replaces. Removed rows are dropped.
//
// Nothing here knows about any particular package: the caller says which
// fields are derived, how rows group, and what date a snapshot row has.

import fs from 'node:fs'
import path from 'node:path'
import { parseCSVRecords } from './csv.ts'
import { readLog } from './log.ts'
import { reportItem } from './report.ts'
import type { BuildOptions, BuildResult, Change, Changeset, Field, HistoryEntry, Provenance, ReportItem, Resource, Row, Table } from './types.ts'

/** A field's id: its `id`, or else its `name` */
export const fieldId = (field: Field): string => field.id ?? field.name

/** The schema's missingValues as text, whose default is [""] (D38). Each may be text, or `{ value, label }` */
export const missingValues = (resource: Resource): string[] =>
  (resource.schema.missingValues ?? ['']).map(missing => typeof missing === 'string' ? missing : missing.value)

/** The value for a cell with no value: the first of the schema's missingValues (D36, D38) */
export const missingValue = (resource: Resource): string => missingValues(resource)[0]

/** The single field that is the resource's primary key */
export function keyField (resource: Resource): Field {
  const names = [resource.schema.primaryKey ?? []].flat()
  if (names.length !== 1) throw new Error(`resource "${resource.name}" needs a primaryKey of one field to be built from a log`)
  const field = resource.schema.fields.find(field => field.name === names[0])
  if (!field) throw new Error(`resource "${resource.name}" has a primaryKey, "${names[0]}", that is not one of its fields`)
  return field
}

/** Where a change sits in the log: compared by as_of, then changeset id, then index */
interface Point { as_of: string, changeset: string, change: number }

const after = (a: Point, b: Point) =>
  a.as_of !== b.as_of ? a.as_of > b.as_of : a.changeset !== b.changeset ? a.changeset > b.changeset : a.change > b.change

/**
 * The changesets left once reverts are applied (D47). A changeset counts if no
 * changeset that counts reverts it. Reverts only name earlier changesets, so
 * deciding from the newest down means a revert of a revert restores the original.
 */
export function unreverted (changesets: Changeset[], report: ReportItem[]): Changeset[] {
  const ids = new Set(changesets.map(c => c.id))
  const revertedBy = new Map<string, string[]>()
  for (const c of changesets) {
    c.changes.forEach((change, i) => {
      if (change.type !== 'revert') return
      const target = change.changeset!
      if (!ids.has(target) || target >= c.id) {
        report.push(reportItem('revert-unknown', `reverts ${target}, which is not earlier in this log, so it does nothing`, { resource: c.resource, changeset: c.id, change: i }))
        return
      }
      revertedBy.set(target, [...(revertedBy.get(target) ?? []), c.id])
    })
  }
  const counts = new Map<string, boolean>()
  for (const c of [...changesets].reverse()) {
    counts.set(c.id, !(revertedBy.get(c.id) ?? []).some(by => counts.get(by)))
  }
  return changesets.filter(c => counts.get(c.id))
}

interface Cell { value: string, point: Point, provenance: Provenance }

/** Replay one resource's log */
function replay (resource: Resource, changesets: Changeset[], options: BuildOptions, report: ReportItem[]) {
  const name = resource.name
  const key = keyField(resource)
  const keyId = fieldId(key)
  const byId = new Map(resource.schema.fields.map(field => [fieldId(field), field]))
  const byName = new Map(resource.schema.fields.map(field => [field.name, field]))
  const derived = new Set(options.derive?.fields[name] ?? [])

  // key -> the latest create, remove or snapshot, and whether it says the row exists
  const existence = new Map<string, Point & { exists: boolean }>()
  // key -> field id -> the latest value
  const cells = new Map<string, Map<string, Cell>>()
  // key -> field id -> every value, in log order
  const changes = new Map<string, Map<string, Cell[]>>()
  // the snapshots' rows in order, then new rows in the order they were created
  const snapshotOrder: string[] = []
  const created: string[] = []
  const inSnapshot = new Set<string>()
  // field id -> the changesets that set it, and how many values, for fields not in the package
  const pending = new Map<string, { changesets: Set<string>, count: number }>()

  const exists = (k: string) => existence.get(k)?.exists ?? false

  /** Record that a row exists, or not. Returns false if a newer create, remove or snapshot already decided it. */
  const setExistence = (k: string, point: Point, value: boolean) => {
    const current = existence.get(k)
    if (current && !after(point, current)) return false
    existence.set(k, { ...point, exists: value })
    return true
  }

  const setCell = (k: string, id: string, value: string, point: Point, provenance: Provenance) => {
    const row = cells.get(k) ?? new Map<string, Cell>()
    cells.set(k, row)
    const current = row.get(id)
    const cell = { value, point, provenance }
    if (!current || after(point, current.point)) row.set(id, cell)
    const all = changes.get(k) ?? new Map<string, Cell[]>()
    changes.set(k, all)
    all.set(id, [...(all.get(id) ?? []), cell])
  }

  const addPending = (id: string, changeset: string) => {
    const entry = pending.get(id) ?? { changesets: new Set(), count: 0 }
    entry.changesets.add(changeset)
    entry.count++
    pending.set(id, entry)
  }

  const provenanceOf = (c: Changeset, i: number, change: Change): Provenance => ({
    changeset: c.id,
    change: i,
    type: change.type,
    as_of: change.as_of!,
    reason: change.reason ?? '',
    sources: change.sources ?? [],
    ...(c.author ? { author: c.author } : {})
  })

  const applyValues = (c: Changeset, i: number, change: Change, point: Point) => {
    const provenance = provenanceOf(c, i, change)
    // a create sets the key cell
    if (change.type === 'create') setCell(change.key!, keyId, change.key!, point, provenance)
    const about = { resource: name, changeset: c.id, change: i, key: change.key }
    for (const [id, value] of Object.entries(change.values ?? {})) {
      if (id === keyId) {
        report.push(reportItem('key-value', `sets the key field, which a change can't do, so the value ${JSON.stringify(value)} is skipped`, { ...about, field: id }))
      } else if (derived.has(id)) {
        report.push(reportItem('derived-value', `sets a derived field, which the build computes, so the value ${JSON.stringify(value)} is skipped`, { ...about, field: id }))
      } else if (!byId.has(id)) {
        addPending(id, c.id)
      } else {
        setCell(change.key!, id, value, point, provenance)
      }
    }
  }

  const applySnapshot = (c: Changeset, i: number, change: Change) => {
    const dir = path.dirname(c.path)
    const about = { resource: name, changeset: c.id, change: i }
    const tablePath = path.join(dir, change.table!)
    if (!fs.existsSync(tablePath)) {
      report.push(reportItem('invalid-changeset', `its table, ${change.table}, does not exist, so the snapshot is skipped`, about))
      return
    }
    // key -> field id -> the evidence links
    const sources = new Map<string, Map<string, string[]>>()
    if (change.sources_file) {
      const sourcesPath = path.join(dir, change.sources_file)
      if (!fs.existsSync(sourcesPath)) {
        report.push(reportItem('invalid-changeset', `its sources_file, ${change.sources_file}, does not exist, so the snapshot has no sources`, about))
      } else {
        for (const s of parseCSVRecords(fs.readFileSync(sourcesPath, 'utf8')).records) {
          if (s.resource !== undefined && s.resource !== name) continue
          const byField = sources.get(s.key) ?? new Map<string, string[]>()
          sources.set(s.key, byField)
          byField.set(s.field, [...(byField.get(s.field) ?? []), s.url])
        }
      }
    }
    const { header, records } = parseCSVRecords(fs.readFileSync(tablePath, 'utf8'))
    // each column's field id: by its name in the package, or else its id
    const columns = header.map(h => fieldId(byName.get(h) ?? byId.get(h) ?? { name: h }))
    for (const record of records) {
      const row: Row = Object.fromEntries(header.map((h, n) => [columns[n], record[h]]))
      const k = row[keyId]
      if (k === undefined || k === '') {
        report.push(reportItem('snapshot-row', `has a row with no ${key.name}, so the row is skipped`, about))
        continue
      }
      const asOf = options.snapshotAsOf?.(name, row) ?? ''
      if (asOf === '') report.push(reportItem('snapshot-row', 'has no date, so its values lose to any change', { ...about, key: k }))
      const point = { as_of: asOf, changeset: c.id, change: i }
      setExistence(k, point, true)
      if (!inSnapshot.has(k)) { inSnapshot.add(k); snapshotOrder.push(k) }
      const author = c.author ? { author: c.author } : {}
      for (const id of columns) {
        // a snapshot is a published table, so it has derived columns: they're not reported
        if (derived.has(id)) continue
        if (!byId.has(id)) { addPending(id, c.id); continue }
        const provenance: Provenance = { changeset: c.id, change: i, type: 'snapshot', as_of: asOf, reason: change.reason ?? '', sources: sources.get(k)?.get(id) ?? [], ...author }
        setCell(k, id, row[id], point, provenance)
      }
    }
  }

  for (const c of changesets) {
    c.changes.forEach((change, i) => {
      const point = { as_of: change.as_of ?? '', changeset: c.id, change: i }
      const about = { resource: name, changeset: c.id, change: i, key: change.key }
      switch (change.type) {
        case 'snapshot':
          applySnapshot(c, i, change)
          break
        case 'create':
          if (exists(change.key!)) report.push(reportItem('create-exists', 'creates a row that already exists, so it acts as an update', about))
          if (!setExistence(change.key!, point, true)) report.push(reportItem('no-effect', 'creates a row, but a newer remove says it does not exist', about))
          if (!inSnapshot.has(change.key!) && !created.includes(change.key!)) created.push(change.key!)
          applyValues(c, i, change, point)
          break
        case 'update':
          if (!exists(change.key!)) {
            report.push(reportItem('missing-row', 'updates a row that does not exist at that point, so it is skipped', about))
            break
          }
          applyValues(c, i, change, point)
          break
        case 'remove':
          if (!exists(change.key!)) {
            report.push(reportItem('missing-row', 'removes a row that does not exist at that point, so it is skipped', about))
            break
          }
          if (!setExistence(change.key!, point, false)) report.push(reportItem('no-effect', 'removes a row, but a newer create or snapshot says it exists', about))
          break
        case 'revert':
          // applied before the replay, in unreverted()
          break
      }
    })
  }

  for (const [id, { changesets: ids, count }] of pending) {
    report.push(reportItem('pending-field', `has ${count} value${count === 1 ? '' : 's'} for a field id that is not in the package, so they are skipped until the field is added`, {
      resource: name, field: id, count, changesets: [...ids]
    }))
  }

  return { existence, cells, changes, inSnapshot, order: [...snapshotOrder, ...created] }
}

/** A cell's history, from its values in log order: sorted by what decides the value, so the last is current */
function historyOf (cells: Cell[]): HistoryEntry[] {
  const sorted = [...cells].sort((a, b) => after(a.point, b.point) ? 1 : after(b.point, a.point) ? -1 : 0)
  return sorted.map((cell, n) => ({ ...cell.provenance, value: cell.value, valueChanged: n === 0 || cell.value !== sorted[n - 1].value }))
}

/** Replay the log onto its baseline, and build each table that has a folder in the log */
export function build (options: BuildOptions): BuildResult {
  const { datapackage, log, derive, rowGroup } = options
  const report: ReportItem[] = []
  const logs = readLog(log, datapackage, report, options.now)
  const tables: Record<string, Table> = {}
  const provenance: BuildResult['provenance'] = {}
  const history: BuildResult['history'] = {}

  for (const [name, changesets] of Object.entries(logs)) {
    const resource = datapackage.resources.find(r => r.name === name)!
    const fields = resource.schema.fields
    const missing = missingValue(resource)
    const derived = new Set(derive?.fields[name] ?? [])
    const { existence, cells, changes, order, inSnapshot } = replay(resource, unreverted(changesets, report), options, report)
    const tableProvenance: Record<string, Record<string, Provenance>> = {}
    const tableHistory: Record<string, Record<string, HistoryEntry[]>> = {}

    const built = new Map<string, Row>()
    // the group of every row, removed or not, so a new row can take the place of a removed one
    const groupOf = new Map<string, string | undefined>()
    for (const k of order) {
      if (!existence.get(k)?.exists) {
        const values = Object.fromEntries([...(cells.get(k) ?? [])].map(([id, cell]) => [id, cell.value]))
        groupOf.set(k, rowGroup?.(name, values))
        continue
      }
      const rowCells = cells.get(k) ?? new Map<string, Cell>()
      const row: Row = {}
      const rowProvenance: Record<string, Provenance> = {}
      let asOf = ''
      for (const field of fields) {
        const id = fieldId(field)
        const cell = derived.has(id) ? undefined : rowCells.get(id)
        row[id] = cell?.value ?? missing
        if (cell) {
          rowProvenance[id] = cell.provenance
          if (cell.point.as_of > asOf) asOf = cell.point.as_of
        }
      }
      if (derived.size) {
        const values = derive!.values(name, { ...row }, { key: k, asOf, provenance: rowProvenance })
        for (const field of fields) {
          const id = fieldId(field)
          if (derived.has(id)) row[id] = values[id] ?? missing
        }
      }
      built.set(k, row)
      groupOf.set(k, rowGroup?.(name, row))
      tableProvenance[k] = rowProvenance
      tableHistory[k] = {}
      for (const field of fields) {
        const id = fieldId(field)
        const all = changes.get(k)?.get(id)
        if (all && !derived.has(id)) tableHistory[k][id] = historyOf(all)
      }
    }

    // snapshot rows keep their order, and each new row goes after the last row in its group,
    // counting removed rows, then removed rows are dropped
    const keys: string[] = []
    const groups: (string | undefined)[] = []
    for (const k of order) {
      const group = groupOf.get(k)
      const at = !inSnapshot.has(k) && group !== undefined ? groups.lastIndexOf(group) : -1
      if (at === -1) {
        keys.push(k)
        groups.push(group)
      } else {
        keys.splice(at + 1, 0, k)
        groups.splice(at + 1, 0, group)
      }
    }

    tables[name] = { resource, fields, rows: keys.filter(k => built.has(k)).map(k => built.get(k)!) }
    provenance[name] = tableProvenance
    history[name] = tableHistory
  }
  return { tables, provenance, history, changesets: logs, report }
}
