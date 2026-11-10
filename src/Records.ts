// Every system, by DPI type, and each place's country page.
import slug from 'slug'
import { IDs } from './Identity'
import { Payments } from './Payment'
import { DataExchanges } from './DataExchange'
import { placeNamed } from './Places'
import { presence } from './DpiTest'
import type { DPIType } from './Schema'

export const records: Record<DPIType, Record<string, any>[]> = { id: IDs, pay: Payments, data: DataExchanges }

/**
 * The places, by the data's name for them, that have a country page: those with
 * a system in at least one of the three DPI types. A place where every row is
 * 'not-found' has no page, and nothing links to it.
 */
export const placesWithPages = new Set<string>()
for (const dpiType of Object.keys(records) as DPIType[]) {
  for (const row of records[dpiType]) {
    if (presence(dpiType, row) !== 'not-found') placesWithPages.add(row.country)
  }
}

/** Each place's country page, by place code. A page is named after the data's name for its place. */
export const pages = new Map<string, { name: string, href: string }>()
for (const row of Object.values(records).flat()) {
  const code = placeNamed(row.country)?.code
  if (code && placesWithPages.has(row.country) && !pages.has(code)) pages.set(code, { name: row.country, href: `/${slug(row.country)}/` })
}
