// Replay changesets onto a baseline, the previous release, to build tables (D46, D47, D66).
//
// - The changesets come in layers: the data build has one, the release's
//   changesets and the pending ones, and history has one per release.
// - Reverted changesets are dropped first, within each layer, resolving reverts
//   in id order.
// - A change always replaces the value in the layers below it, and the
//   baseline's. Within a layer, a cell's value comes from the change with the
//   latest `as_of`, with ties broken by changeset id, then by the change's place
//   in its changeset. A change older than its row's date in the baseline is
//   reported, but still applies.
// - Whether a row exists comes from its latest create or remove, in the same
//   order, or else from the baseline. An update or remove needs the row to exist
//   at that point: after the changes that come before it.
// - Rows keep the baseline's order. A new row goes after the last row in its
//   group, removed or not, so a replacement takes the place of the system it
//   replaces. Removed rows are dropped.
//
// Nothing here knows about any particular package: the caller says which
// fields are derived, how rows group, and what date a baseline row has.

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

/** A release's cell as text: its JSON has numbers for integer and number fields */
const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value)

/** Where a change sits: compared by layer (0 is the baseline), then as_of, then changeset id, then index */
interface Point { layer: number, as_of: string, changeset: string, change: number }

const after = (a: Point, b: Point) =>
  a.layer !== b.layer ? a.layer > b.layer : a.as_of !== b.as_of ? a.as_of > b.as_of : a.changeset !== b.changeset ? a.changeset > b.changeset : a.change > b.change

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

/** Replay one resource's layers of changesets onto its baseline rows */
function replay (resource: Resource, baselineRows: Record<string, unknown>[], layers: Changeset[][], options: BuildOptions, report: ReportItem[]) {
  const name = resource.name
  const key = keyField(resource)
  const keyId = fieldId(key)
  const byId = new Map(resource.schema.fields.map(field => [fieldId(field), field]))
  const byName = new Map(resource.schema.fields.map(field => [field.name, field]))
  const derived = new Set(options.derive?.fields[name] ?? [])
  const baseline = options.baseline

  // key -> the latest create or remove, or the baseline, and whether it says the row exists
  const existence = new Map<string, Point & { exists: boolean }>()
  // key -> field id -> the latest value
  const cells = new Map<string, Map<string, Cell>>()
  // key -> field id -> every value, in log order
  const changes = new Map<string, Map<string, Cell[]>>()
  // the baseline's rows in order, then new rows in the order they were created
  const baselineOrder: string[] = []
  const created: string[] = []
  const inBaseline = new Set<string>()
  // key -> the as_of of the row's cells in the baseline
  const baselineAsOf = new Map<string, string>()
  // field id -> the changesets that set it, and how many values, for fields not in the package
  const notInPackage = new Map<string, { changesets: Set<string>, count: number }>()

  const exists = (k: string) => existence.get(k)?.exists ?? false

  /** Record that a row exists, or not. Returns false if a newer create or remove already decided it. */
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

  const addNotInPackage = (id: string, changeset: string) => {
    const entry = notInPackage.get(id) ?? { changesets: new Set(), count: 0 }
    entry.changesets.add(changeset)
    entry.count++
    notInPackage.set(id, entry)
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
        addNotInPackage(id, c.id)
      } else {
        setCell(change.key!, id, value, point, provenance)
      }
    }
  }

  // the baseline: the previous release's rows, keyed by field name
  if (baseline) {
    const sources = new Map<string, Map<string, string[]>>()
    for (const s of baseline.sources ?? []) {
      if (s.resource !== name) continue
      const byField = sources.get(s.key) ?? new Map<string, string[]>()
      sources.set(s.key, byField)
      byField.set(s.field, [...(byField.get(s.field) ?? []), s.url])
    }
    const about = { resource: name, changeset: baseline.id }
    const dropped = new Map<string, number>()
    for (const record of baselineRows) {
      const row: Row = {}
      for (const [header, value] of Object.entries(record)) {
        const field = byName.get(header)
        if (field) row[fieldId(field)] = cellText(value)
        else dropped.set(header, (dropped.get(header) ?? 0) + 1)
      }
      const k = row[keyId]
      if (k === undefined || k === '') {
        report.push(reportItem('snapshot-row', `has a row with no ${key.name}, so the row is skipped`, about))
        continue
      }
      const asOf = options.baselineAsOf?.(name, row) ?? ''
      if (asOf === '') report.push(reportItem('snapshot-row', 'has no date', { ...about, key: k }))
      baselineAsOf.set(k, asOf)
      const point = { layer: 0, as_of: asOf, changeset: baseline.id, change: 0 }
      setExistence(k, point, true)
      if (!inBaseline.has(k)) { inBaseline.add(k); baselineOrder.push(k) }
      for (const id of Object.keys(row)) {
        // a release has derived columns: they're computed again
        if (derived.has(id)) continue
        const provenance: Provenance = { changeset: baseline.id, change: 0, type: 'snapshot', as_of: asOf, reason: baseline.reason ?? '', sources: sources.get(k)?.get(id) ?? [] }
        setCell(k, id, row[id], point, provenance)
      }
    }
    for (const [header, count] of dropped) {
      report.push(reportItem('legacy-field', `is a column of the baseline, ${baseline.id}, but not a field in the package, so its ${count} value${count === 1 ? ' is' : 's are'} dropped`, {
        resource: name, field: header, count, release: baseline.id
      }))
    }
  }

  layers.forEach((changesets, n) => {
    for (const c of unreverted(changesets, report)) {
      c.changes.forEach((change, i) => {
        const point = { layer: n + 1, as_of: change.as_of ?? '', changeset: c.id, change: i }
        const about = { resource: name, changeset: c.id, change: i, key: change.key }
        if (change.type !== 'revert' && inBaseline.has(change.key!) && change.as_of! < baselineAsOf.get(change.key!)!) {
          report.push(reportItem('older-change', `is dated ${change.as_of}, before the row's Last updated in ${baseline!.id}, ${baselineAsOf.get(change.key!)}, and still replaces its values (D46)`, about))
        }
        switch (change.type) {
          case 'create':
            if (exists(change.key!)) report.push(reportItem('create-exists', 'creates a row that already exists, so it acts as an update', about))
            if (!setExistence(change.key!, point, true)) report.push(reportItem('no-effect', 'creates a row, but a newer remove says it does not exist', about))
            if (!inBaseline.has(change.key!) && !created.includes(change.key!)) created.push(change.key!)
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
            if (!setExistence(change.key!, point, false)) report.push(reportItem('no-effect', 'removes a row, but a newer create says it exists', about))
            break
          case 'revert':
            // applied before the replay, in unreverted()
            break
        }
      })
    }
  })

  for (const [id, { changesets: ids, count }] of notInPackage) {
    const release = options.earlierFields?.[name]?.[id]
    const values = `${count} value${count === 1 ? '' : 's'}`
    report.push(release
      ? reportItem('legacy-field', `has ${values} for a field that was in the ${release} release but is not in the package, so they are skipped`, { resource: name, field: id, count, changesets: [...ids], release })
      : reportItem('unknown-field', `has ${values} for a field id that has never been in the package, perhaps a typo, so they are skipped`, { resource: name, field: id, count, changesets: [...ids] }))
  }

  return { existence, cells, changes, inBaseline, order: [...baselineOrder, ...created] }
}

/** A cell's history, from its values in log order: sorted by what decides the value, so the last is current */
function historyOf (cells: Cell[]): HistoryEntry[] {
  const sorted = [...cells].sort((a, b) => after(a.point, b.point) ? 1 : after(b.point, a.point) ? -1 : 0)
  return sorted.map((cell, n) => ({ ...cell.provenance, value: cell.value, valueChanged: n === 0 || cell.value !== sorted[n - 1].value }))
}

/** Replay the layers of changesets onto the baseline, and build each table in either */
export function build (options: BuildOptions): BuildResult {
  const { datapackage, baseline, derive, rowGroup } = options
  const report: ReportItem[] = [...(options.report ?? [])]
  const tables: Record<string, Table> = {}
  const provenance: BuildResult['provenance'] = {}
  const history: BuildResult['history'] = {}
  const replayed: BuildResult['changesets'] = {}
  const names = [...new Set([...Object.keys(baseline?.tables ?? {}), ...options.layers.flatMap(Object.keys)])].sort()

  for (const name of names) {
    const resource = datapackage.resources.find(r => r.name === name)
    if (!resource) continue
    const fields = resource.schema.fields
    const missing = missingValue(resource)
    const derived = new Set(derive?.fields[name] ?? [])
    const layers = options.layers.map(layer => layer[name] ?? [])
    replayed[name] = layers.flat()
    const { existence, cells, changes, order, inBaseline } = replay(resource, baseline?.tables[name] ?? [], layers, options, report)
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

    // baseline rows keep their order, and each new row goes after the last row in its group,
    // counting removed rows, then removed rows are dropped
    const keys: string[] = []
    const groups: (string | undefined)[] = []
    for (const k of order) {
      const group = groupOf.get(k)
      const at = !inBaseline.has(k) && group !== undefined ? groups.lastIndexOf(group) : -1
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
  return { tables, provenance, history, changesets: replayed, report, ...(baseline ? { baseline: { id: baseline.id, reason: baseline.reason ?? '' } } : {}) }
}
