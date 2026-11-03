import { isRegion, placeNamed } from './Places'

// log and try to fix bad urls. A cell should hold one URL; for one with several,
// which npm run validate warns about, use the first and drop the others.
export function fixURL(dpiType: string, country: string, value: string) {
  if (value === 'NA') return 'NA'
  const url = String(value).trim().split(/\s+/)[0]
  try {
    const ok = new URL(url)
    return ok.toString()
  } catch (err) {
    console.log(`${dpiType}: ${country} has bad URL ${url}`)
    try {
      const fix = new URL(`https://${url}`)
      return fix.toString()
    } catch (err) {
      return 'NA'
    }
  }
}

/** A "dd/mm/yy" date, as in the Last updated column, or undefined if it isn't one */
export function parseDMY (date: string) {
  const [d, m, y] = date.split('/').map(Number)
  if (!d || !m || y === undefined || Number.isNaN(y)) return undefined
  return new Date(Date.UTC(2000 + (y % 100), m - 1, d))
}

interface DPIData {
  Country: string,
  'DPI Status': 'DPI' | 'WIP' | 'NA'
}

const DPIStatusOrder = {
  'DPI': 2,
  'WIP': 1,
  'NA': 0
}

function mostDpiLike(a?: DPIData, b?: DPIData) {
  if (!a && !b) return undefined
  if (!a && b) return b
  if (a && !b) return a
  if (DPIStatusOrder[a["DPI Status"]] < DPIStatusOrder[b["DPI Status"]]) return b
  return a
}

/*
Takes an array of DPI system data.
Returns an array with 1 item per Country; the most DPI-like where there is more than 1 system per country.
Regions, like Europe, are skipped: they are not countries.
*/
export function oneSystemPerCountry (arr: DPIData[]) {
  const map = arr.reduce((map, b) => {
    const place = placeNamed(b.Country)
    if (place && isRegion(place)) return map
    const key = place?.code ?? b.Country.trim().toLowerCase()
    const a = map.get(key)
    map.set(key, mostDpiLike(a, b))
    return map
  }, new Map<string, DPIData | undefined>())
  return [...map.values()]
}
