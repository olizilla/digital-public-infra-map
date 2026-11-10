// The DPI layer (D48): what lib/changesets needs to know about this package to
// replay changesets onto a release, shared by the data build (scripts/data-build.ts)
// and the history on system pages (src/Release.ts). No imports, so both can load it.

/**
 * The fields the build computes, never taken from a changeset: Last updated, from the row's newest as_of,
 * Count for DPI, from the DPI test, and the ISO 3166-1 codes, from the row's place in public/data/places.csv (D68)
 */
export const derivedFields = ['last_updated', 'count_for_dpi', 'iso3']

/**
 * A release row's Last updated as YYYY-MM-DD: the as_of of its cells (D7). Releases up to
 * 2026-03-31 wrote it dd/mm/yy, and later ones YYYY-MM-DD (D49).
 */
export function lastUpdatedAsOf (_resource: string, row: Record<string, string>): string | undefined {
  const text = row.last_updated ?? ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const [, d, m, y] = text.match(/^(\d{2})\/(\d{2})\/(\d{2})$/) ?? []
  return y ? `20${y}-${m}-${d}` : undefined
}

/** Why a release is the baseline, as its values' reason in their history */
export const baselineReason = (release: string) =>
  `The ${release} release, public/data/${release}/. Each cell's date is its row's Last updated.`
