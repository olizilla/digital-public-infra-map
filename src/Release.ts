// The data release the site shows (D45), set in src/ReleaseFiles.ts, and the history of its cells (D66):
// the 2026-03-31 release, the baseline, then the changesets released with each release up to
// this one, from the changesets collection (src/content.config.ts), replayed by lib/changesets
// as the data build does, with the release's datapackage.json (D71). Pending changesets, in
// changesets/next/, aren't in it.
import { getCollection } from 'astro:content'
import { build } from '../lib/changesets/build.ts'
import { historyJSON } from '../lib/changesets/output.ts'
import type { HistoryJSON } from '../lib/changesets/output.ts'
import type { Changeset, DataPackage } from '../lib/changesets/types.ts'
import baselineIdentity from '../public/data/2026-03-31/2026-03-31-identity.json'
import baselinePayment from '../public/data/2026-03-31/2026-03-31-payment.json'
import baselineExchange from '../public/data/2026-03-31/2026-03-31-exchange.json'
import baselineSources from '../public/data/2026-03-31/2026-03-31-sources.json'
import { baselineReason, derivedFields, lastUpdatedAsOf } from './DpiLayer'
import type { DPIType } from './Schema'
import { release, releasePackage, releaseTables } from './ReleaseFiles'

export { release }

/** Each table's rows, keyed by column header, as in the release's JSON */
export const releaseRows: Record<DPIType, Record<string, any>[]> = { id: releaseTables.identity, pay: releaseTables.payment, data: releaseTables.exchange }

/** The release the history starts from: the first with System IDs, and evidence for its values */
export const baselineRelease = '2026-03-31'

const released = (await getCollection('changesets', entry => entry.data.status === 'released' && entry.data.release! <= release))
  .map(({ data }): Changeset => ({
    id: data.changeset,
    resource: data.resource,
    folder: data.release!,
    path: '',
    ...(data.author !== undefined ? { author: data.author } : {}),
    ...(data.summary !== undefined ? { summary: data.summary } : {}),
    changes: data.changes as unknown as Changeset['changes']
  }))

/** One set of changesets per release, oldest first, each by resource in id order */
const layers = [...new Set(released.map(c => c.folder))].sort().map(folder => {
  const byResource: Record<string, Changeset[]> = {}
  for (const c of released.filter(c => c.folder === folder)) (byResource[c.resource] ??= []).push(c)
  for (const changesets of Object.values(byResource)) changesets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return byResource
})

const result = build({
  datapackage: releasePackage as DataPackage,
  baseline: {
    id: baselineRelease,
    reason: baselineReason(baselineRelease),
    tables: { identity: baselineIdentity, payment: baselinePayment, exchange: baselineExchange },
    sources: baselineSources
  },
  layers,
  baselineAsOf: lastUpdatedAsOf,
  // derived cells have no history, and their values aren't needed here
  derive: { fields: Object.fromEntries(releasePackage.resources.map(r => [r.name, derivedFields])), values: () => ({}) }
})

/** Each table's history, by resource name: every change to every cell, from the 2026-03-31 release on */
export const releaseHistory: Record<string, HistoryJSON> = Object.fromEntries(Object.keys(result.tables).map(name => [name, historyJSON(result, name)]))

const folderOf = new Map(released.map(c => [`${c.resource}/${c.id}`, c.folder]))

/** The release a changeset came out in, which is its folder in changesets/ */
export const changesetRelease = (resource: string, id: string) => folderOf.get(`${resource}/${id}`)
