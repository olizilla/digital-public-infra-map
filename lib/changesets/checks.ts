// Turning a failed check on a built table into a report item (D51, D60).
//
// Only values that change are checked: a failing value blocks a merge if a
// changeset introduced it, and is a legacy warning if it was already in the
// baseline snapshot. A changeset that only restates a value, say with new
// sources, doesn't introduce it.

import { reportItem } from './report.ts'
import type { BuildResult, HistoryEntry, ReportItem } from './types.ts'

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
}

/**
 * A report item for a failed check: blocking (`check`) if any of the fields'
 * values was introduced by a change, or a `legacy` warning if they all come
 * from a snapshot. A field with no history, like one with no value, counts as
 * introduced by whatever introduced the row's key: a snapshot, or a create.
 * The item points at the change that introduced the failing field's value.
 */
export function checkItem (result: BuildResult, failure: Failure, keyField: string): ReportItem {
  const row = result.history[failure.resource]?.[failure.key] ?? {}
  const from = (id: string) => introducedBy(row[id]) ?? introducedBy(row[keyField])
  const sources = failure.fields.map(from)
  const legacy = sources.length > 0 && sources.every(entry => entry?.type === 'snapshot')
  const first = sources[0]
  return reportItem(legacy ? 'legacy' : 'check', failure.message, {
    resource: failure.resource,
    key: failure.key,
    field: failure.fields[0],
    ...(first ? { changeset: first.changeset, change: first.change } : {})
  })
}
