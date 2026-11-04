// Report items: what the build skipped or found, and whether each blocks a merge.

import type { ReportItem, ReportKind } from './types.ts'

/**
 * Whether each kind of item blocks a merge. Following D51, only a file that
 * isn't valid TOML or doesn't match the changeset schema, an update or remove
 * for a row that doesn't exist at that point, and a current value that fails a
 * check block. Following D60, a failing value only blocks if a changeset set it:
 * one that was already in the baseline is a legacy warning. Everything else is
 * reported and skipped.
 */
export const BLOCKING: Record<ReportKind, boolean> = {
  'invalid-toml': true,
  'invalid-changeset': true,
  'missing-row': true,
  check: true,
  legacy: false,
  'older-change': false,
  'unknown-table': false,
  'legacy-field': false,
  'unknown-field': false,
  'derived-value': false,
  'key-value': false,
  'create-exists': false,
  'no-effect': false,
  'revert-unknown': false,
  'future-id': false,
  'snapshot-row': false
}

/** What each kind means, for the report's headings */
export const KIND_TITLES: Record<ReportKind, string> = {
  'invalid-toml': 'Files that are not valid TOML',
  'invalid-changeset': 'Files that are not valid changesets',
  'missing-row': 'Updates and removes for rows that do not exist at that point',
  check: 'Values that fail a check',
  legacy: 'Legacy warnings: values from the baseline that fail a check',
  'older-change': 'Changes dated before their row\'s Last updated in the previous release, which still replace its values',
  'unknown-table': 'Folders for tables that are not in the package',
  'legacy-field': 'Legacy fields: values for fields from an earlier release that are not in the package',
  'unknown-field': 'Unknown fields: values for field ids that have never been in the package',
  'derived-value': 'Values for derived fields, which the build computes',
  'key-value': 'Values for the key field, which a change cannot set',
  'create-exists': 'Creates for rows that already exist',
  'no-effect': 'Creates and removes that lose to a newer one',
  'revert-unknown': 'Reverts of changesets that are not earlier in the same set',
  'future-id': 'Changeset ids with a timestamp in the future',
  'snapshot-row': 'Baseline rows that were skipped or have no date'
}

export function reportItem (kind: ReportKind, message: string, about: Omit<ReportItem, 'kind' | 'blocking' | 'message'> = {}): ReportItem {
  return { kind, blocking: BLOCKING[kind], message, ...about }
}

/** How many items there are of each kind, blocking kinds first */
export function countByKind (report: ReportItem[]): { kind: ReportKind, blocking: boolean, count: number }[] {
  const counts = new Map<ReportKind, number>()
  for (const { kind } of report) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return (Object.keys(BLOCKING) as ReportKind[])
    .filter(kind => counts.has(kind))
    .map(kind => ({ kind, blocking: BLOCKING[kind], count: counts.get(kind)! }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
}

const where = (item: ReportItem) => [
  item.resource,
  item.changeset && (item.change === undefined ? item.changeset : `${item.changeset} change ${item.change}`),
  item.file && !item.changeset ? item.file : undefined,
  item.key,
  item.field && `\`${item.field}\``
].filter(Boolean).join(', ')

/** The report as Markdown: counts, then every item, grouped by kind */
export function formatReport (report: ReportItem[], title = 'Build report'): string {
  const lines = [`# ${title}`, '']
  const counts = countByKind(report)
  const blocking = report.filter(item => item.blocking).length
  lines.push(`${blocking} blocking item${blocking === 1 ? '' : 's'}, ${report.length - blocking} not blocking.`, '')
  if (counts.length) {
    lines.push('| Kind | Blocks a merge | Items |', '|---|---|---|')
    for (const { kind, blocking, count } of counts) lines.push(`| ${KIND_TITLES[kind]} | ${blocking ? 'yes' : 'no'} | ${count} |`)
    lines.push('')
  }
  for (const { kind } of counts) {
    lines.push(`## ${KIND_TITLES[kind]}`, '')
    const items = report.filter(item => item.kind === kind)
    if (kind === 'legacy-field' || kind === 'unknown-field') {
      const legacy = kind === 'legacy-field'
      lines.push(`| Table | Field | Values | Changesets |${legacy ? ' Last in |' : ''}`, `|---|---|---|---|${legacy ? '---|' : ''}`)
      for (const item of items) lines.push(`| ${item.resource} | \`${item.field}\` | ${item.count} | ${item.changesets?.length ?? 0} |${legacy ? ` ${item.release} |` : ''}`)
      const set = items.filter(item => item.changesets?.length)
      if (set.length) lines.push('', 'The changesets that set them:', '')
      for (const item of set) lines.push(`- ${item.resource}, \`${item.field}\`: ${item.changesets!.join(', ')}`)
    } else {
      for (const item of items) lines.push(`- ${where(item)}: ${item.message}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
