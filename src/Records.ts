// Every system, by DPI type, and each place's country page.
import slug from 'slug'
import { IDs } from './Identity'
import { Payments } from './Payment'
import { DataExchanges } from './DataExchange'
import { placeNamed } from './Places'
import type { DPIType } from './Schema'

export const records: Record<DPIType, Record<string, any>[]> = { id: IDs, pay: Payments, data: DataExchanges }

/** Each place's country page, by place code. A page is named after the data's name for its place. */
export const pages = new Map<string, { name: string, href: string }>()
for (const row of Object.values(records).flat()) {
  const code = placeNamed(row.Country)?.code
  if (code && !pages.has(code)) pages.set(code, { name: row.Country, href: `/${slug(row.Country)}/` })
}
