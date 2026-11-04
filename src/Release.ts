// The data release the site shows (D45): the folder public/data/<release>/, written by
// `npm run data:build -- --release <release>`, and the history of its cells, which the
// build writes to src/data/ because it isn't published. To switch the site to a new
// release, change the date here, in each path.
import identity from '../public/data/2026-11-06/2026-11-06-identity.json'
import payment from '../public/data/2026-11-06/2026-11-06-payment.json'
import exchange from '../public/data/2026-11-06/2026-11-06-exchange.json'
import history from './data/history-2026-11-06.json'
import type { HistoryJSON } from '../lib/changesets/output.ts'
import type { DPIType } from './Schema'

export const release = '2026-11-06'

/** Each table's rows, keyed by column header, as in the release's JSON */
export const releaseRows: Record<DPIType, Record<string, any>[]> = { id: identity, pay: payment, data: exchange }

/** Each table's history, by resource name: every change to every cell, from the changeset log */
export const releaseHistory = history as unknown as Record<string, HistoryJSON>
