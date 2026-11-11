// Turning a failed check on a built table into a report item (D51, D60).
//
// Only values that change are checked: a failing value blocks a merge if a
// changeset introduced it, and is a legacy warning if it was already in the
// baseline, the previous release. A changeset that only restates a value, say with new
// sources, doesn't introduce it.

import { reportItem } from './report.ts'
import type { BuildResult, HistoryEntry, Provenance, ReportItem } from './types.ts'

/** The entry that gave a cell its current value: the newest that changed it, since later ones only restate it */
export function introducedBy (entries: HistoryEntry[] = []): HistoryEntry | undefined {
  for (let n = entries.length - 1; n >= 0; n--) if (entries[n].valueChanged) return entries[n]
  return undefined
}

export interface Failure {
  resource: string
  key: string
  /** The ids of the fields the check read. The first is the one that failed. */
  fields: string[]
  message: string
  /**
   * For a derived field, which has no history: the change its value is derived from, like
   * `datedBy` for a field derived from the row's newest as_of. Used in place of the first field's history.
   */
  derivedFrom?: Provenance
}

/**
 * The cell a row's date comes from: the one with the newest as_of, which a derived Last updated
 * is (S2). On a tie, a change's cell rather than the baseline's, then the latest changeset.
 */
export function datedBy (row: Record<string, Provenance> = {}): Provenance | undefined {
  const later = (a: Provenance, b: Provenance) =>
    a.as_of !== b.as_of ? a.as_of > b.as_of
      : (a.type === 'snapshot') !== (b.type === 'snapshot') ? b.type === 'snapshot'
          : a.changeset !== b.changeset ? a.changeset > b.changeset : a.change > b.change
  let newest: Provenance | undefined
  for (const cell of Object.values(row)) if (!newest || later(cell, newest)) newest = cell
  return newest
}

/**
 * A report item for a failed check: blocking (`check`) if any of the fields'
 * values was introduced by a change, or a `legacy` warning if they all come
 * from the baseline (type `snapshot`). A derived field counts as introduced by the change it's
 * derived from, `derivedFrom`, if the failure says. Otherwise a field with no history, like one with
 * no value, counts as introduced by whatever introduced the row's key: the baseline, or a create.
 * The item points at the change that introduced the failing field's value.
 */
export function checkItem (result: BuildResult, failure: Failure, keyField: string): ReportItem {
  const row = result.history[failure.resource]?.[failure.key] ?? {}
  const from = (id: string) => introducedBy(row[id]) ?? introducedBy(row[keyField])
  const sources: (Provenance | undefined)[] = failure.fields.map((id, n) => n === 0 && failure.derivedFrom ? failure.derivedFrom : from(id))
  const legacy = sources.length > 0 && sources.every(entry => entry?.type === 'snapshot')
  const first = sources[0]
  return reportItem(legacy ? 'legacy' : 'check', failure.message, {
    resource: failure.resource,
    key: failure.key,
    field: failure.fields[0],
    ...(first ? { changeset: first.changeset, change: first.change } : {})
  })
}
