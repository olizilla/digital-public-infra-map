import { isRegion, placeNamed } from './Places'

// log and try to fix bad urls. A cell should hold one URL; for one with several,
// which npm run validate warns about, use the first and drop the others.
export function fixURL(dpiType: string, country: string, value: string) {
  // missing, or researched and not found (D61): not a URL, so no link
  if (value === 'NA' || value === 'Not Found') return value
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

/** A value as a link: only a real http(s) URL whose host has a dot, so "NA" and "Not Found" stay text */
export function webLink (value: string) {
  return /^https?:\/\/[^/\s]+\.[^/\s]+/.test(value) && URL.canParse(value) ? value : undefined
}

/**
 * A Last updated date, or undefined if it isn't one: "YYYY-MM-DD" from the 2026-11-06
 * release on (D49), or "dd/mm/yy" as in earlier releases
 */
export function parseDate (date: string) {
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
  const [d, m, y] = date.split('/').map(Number)
  if (!d || !m || y === undefined || Number.isNaN(y)) return undefined
  return new Date(Date.UTC(2000 + (y % 100), m - 1, d))
}

interface DPIData {
  country: string,
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
    const place = placeNamed(b.country)
    if (place && isRegion(place)) return map
    const key = place?.code ?? b.country.trim().toLowerCase()
    const a = map.get(key)
    map.set(key, mostDpiLike(a, b))
    return map
  }, new Map<string, DPIData | undefined>())
  return [...map.values()]
}
