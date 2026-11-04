// The shapes the library works with. A Data Package (https://datapackage.org)
// describes the tables, and a log of changesets says what goes in them.

export interface Field {
  /** The column header */
  name: string
  /** A stable id for the field, which changesets use. Defaults to `name`. */
  id?: string
  type?: string
  format?: string
  constraints?: Record<string, unknown>
  [property: string]: unknown
}

/** A missing value: Data Package v2 allows text, or text with a label that says what it means */
export type MissingValue = string | { value: string, label?: string }

export interface TableSchema {
  fields: Field[]
  primaryKey?: string | string[]
  missingValues?: MissingValue[]
  [property: string]: unknown
}

export interface Resource {
  name: string
  path?: string
  schema: TableSchema
  [property: string]: unknown
}

export interface DataPackage {
  resources: Resource[]
  [property: string]: unknown
}

/** A change's type. `snapshot` is not written in changesets any more: history entries use it for the baseline's values. */
export type ChangeType = 'create' | 'update' | 'remove' | 'revert' | 'snapshot'

/** One change in a changeset, as the changeset schema describes it, with `as_of` as `YYYY-MM-DD` */
export interface Change {
  type: ChangeType
  key?: string
  as_of?: string
  reason?: string
  sources?: string[]
  /** Field id -> the cell's text */
  values?: Record<string, string>
  duplicate_of?: string
  /** For a revert: the id of the changeset it reverts */
  changeset?: string
  /** For a snapshot, no longer read: the CSV of rows, relative to the changeset file */
  table?: string
  /** For a snapshot, no longer read: the CSV of evidence (key, field, url), relative to the changeset file */
  sources_file?: string
}

/** A changeset file that parsed and matched the schema */
export interface Changeset {
  /** The filename, without `.toml` */
  id: string
  /** The table it applies to: the name of its folder in the log */
  resource: string
  /** The folder of the log it was read from: a release date, or `next` for pending changesets */
  folder: string
  /** Where it was read from */
  path: string
  author?: string
  summary?: string
  changes: Change[]
}

/** Where a cell's value came from */
export interface Provenance {
  changeset: string
  /** The change's index in the changeset */
  change: number
  /** The change's type, or `snapshot` for a value from the baseline */
  type: ChangeType
  /** `YYYY-MM-DD`, or "" if a baseline row has no date */
  as_of: string
  reason: string
  sources: string[]
  author?: string
}

/** One change to a cell, in the cell's history */
export interface HistoryEntry extends Provenance {
  /** The value the change gave the cell */
  value: string
  /** Whether the value differs from the entry before. False when a change only restates it, as with new sources. The first entry is true. */
  valueChanged: boolean
}

/** A built row: field id -> the cell's text */
export type Row = Record<string, string>

export interface Table {
  resource: Resource
  /** The output columns, in the package's order */
  fields: Field[]
  rows: Row[]
}

/**
 * What a report item is about. Whether a kind blocks a merge is in `BLOCKING`
 * in report.ts, following D51.
 */
export type ReportKind =
  | 'invalid-toml'
  | 'invalid-changeset'
  | 'missing-row'
  | 'check'
  | 'legacy'
  | 'older-change'
  | 'unknown-table'
  | 'legacy-field'
  | 'unknown-field'
  | 'derived-value'
  | 'key-value'
  | 'create-exists'
  | 'no-effect'
  | 'revert-unknown'
  | 'future-id'
  | 'snapshot-row'

export interface ReportItem {
  kind: ReportKind
  blocking: boolean
  message: string
  resource?: string
  /** The file, relative to the log folder */
  file?: string
  changeset?: string
  change?: number
  key?: string
  field?: string
  /** For a legacy or unknown field: the changesets that set it */
  changesets?: string[]
  /** For a legacy or unknown field: how many values it has */
  count?: number
  /** For a legacy field: the newest earlier release that had it */
  release?: string
}

export interface DeriveContext {
  /** The row's key */
  key: string
  /** The newest `as_of` of the row's output cells, as `YYYY-MM-DD` ("" if none has a date) */
  asOf: string
  /** Where each of the row's (non-derived) cells came from */
  provenance: Record<string, Provenance>
}

export interface Derive {
  /** Resource name -> the ids of the fields the caller computes. Log values for them are skipped. */
  fields: Record<string, string[]>
  /** The derived values for one built row, by field id. A field left out gets the missing value. */
  values: (resource: string, row: Row, context: DeriveContext) => Record<string, string>
}

/** A previous release's tables, which the changesets are applied to */
export interface Baseline {
  /** The release, like `2026-03-31`: the `changeset` of its values in history entries */
  id: string
  /** Resource name -> the release's rows, keyed by field name, as in its JSON */
  tables: Record<string, Record<string, unknown>[]>
  /** The evidence for its values */
  sources?: { resource: string, key: string, field: string, url: string }[]
  /** Why it is the baseline, as its values' reason in history entries */
  reason?: string
}

export interface BuildOptions {
  datapackage: DataPackage
  /** The previous release. Without one, every row comes from a create. */
  baseline?: Baseline
  /**
   * Sets of changesets, each by resource, applied in order on the baseline. A change in a set
   * always replaces the value before it (D46). Within a set the latest `as_of` wins, with ties
   * broken by changeset id. The data build has one set: the release's folder and `next/`.
   * History has one per release.
   */
  layers: Record<string, Changeset[]>[]
  /** Items found while reading the changesets, which the report starts with */
  report?: ReportItem[]
  derive?: Derive
  /** A new row goes after the last row in the same group. Rows with no group go at the end. */
  rowGroup?: (resource: string, row: Row) => string | undefined
  /** The `as_of` of a baseline row's cells, as `YYYY-MM-DD`, or undefined if it has none */
  baselineAsOf?: (resource: string, row: Row) => string | undefined
  /**
   * Resource name -> field id or name -> the newest earlier release that had the field, so a
   * value for a field that isn't in the package is reported as legacy, not unknown
   */
  earlierFields?: Record<string, Record<string, string>>
}

export interface BuildResult {
  /** Resource name -> its built table, for each resource in the baseline or with changesets */
  tables: Record<string, Table>
  /** Resource name -> key -> field id -> where the value came from */
  provenance: Record<string, Record<string, Record<string, Provenance>>>
  /**
   * Resource name -> key -> field id -> every change to the cell, oldest first: in the order
   * that decides its value (the baseline, then each layer in turn, by as_of, then changeset id,
   * then the change's index), so the last entry set the current value. For the built rows,
   * without derived cells or reverted changesets.
   */
  history: Record<string, Record<string, Record<string, HistoryEntry[]>>>
  /** The changesets that were replayed, by resource, layer by layer, each in id order */
  changesets: Record<string, Changeset[]>
  /** The baseline's id and reason, if there was one */
  baseline?: { id: string, reason: string }
  report: ReportItem[]
}
