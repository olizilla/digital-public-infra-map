// The changelog's rounds (D81): which changesets each changelog shows, and the release whose rows they
// apply to. A round is a release's changesets, those in changesets/<date>/, against the release before
// it, or the pending ones in changesets/next/ against the release the site shows. So a release's
// changelog never changes once it's out, and pending changes never count towards a published release.
// No astro: imports, so node --test can load it (src/ChangeRounds.test.ts).

/** The pending round's name, the folder its changesets are in, as PENDING_FOLDER in lib/changesets/log.ts */
export const pending = 'next'

/** A round: a release's date, like `2026-11-06`, or `next` for the pending changesets */
export type Round = string

/** What a round needs to know of a changeset in the changesets collection (src/ChangesetLoader.ts) */
export interface RoundEntry { status: 'released' | 'pending', release: string | null }

/** Whether a changeset is in a round: released in its release, or pending for `next` */
export const inRound = (entry: RoundEntry, round: Round) => round === pending
  ? entry.status === 'pending'
  : entry.status === 'released' && entry.release === round

/**
 * The release a round's changes apply to: for `next`, `latest`, the release the site shows; for a
 * release, the one just before it in `releases`, the release folders with JSON for every table, as
 * `npm run data:build` finds it. Undefined if there's none.
 */
export const baseOf = (round: Round, releases: string[], latest: string) => round === pending
  ? latest
  : releases.filter(folder => folder < round).sort().at(-1)

/**
 * The releases with a changelog, newest first: those released with changesets, up to the release the
 * site shows, that are in `releases` and have a release before them. Releases made from the
 * spreadsheets have no changesets, so no changelog.
 */
export const releaseRounds = (entries: RoundEntry[], releases: string[], latest: string): Round[] =>
  [...new Set(entries.filter(entry => entry.status === 'released' && entry.release).map(entry => entry.release!))]
    .filter(date => date <= latest && releases.includes(date) && baseOf(date, releases, latest) !== undefined)
    .sort()
    .reverse()
