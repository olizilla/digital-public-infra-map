// log and try to fix bad urls
export function fixURL(dpiType: string, country: string, url: string) {
  if (url === 'NA') return 'NA'
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
Names (lowercase) of rows in the data that are regions rather than countries, so must not be counted as countries.
Hand-maintained until the data has ISO country codes, which can replace this list.
*/
export const NonCountryRegions = [
  'africa',
  'asia',
  'caribbean',
  'central america, caribbean',
  'eastern caribbean',
  'europe',
  'european union',
  'middle east'
]

/*
Takes an array of DPI system data.
Returns an array with 1 item per Country; the most DPI-like where there is more than 1 system per country.
*/
export function oneSystemPerCountry (arr: DPIData[]) {
  const map = arr.reduce((map, b) => {
    const key = b.Country.trim().toLowerCase()
    if (NonCountryRegions.includes(key)){
      // skip regions. they are not countries.
      return map
    }
    const a = map.get(key)
    map.set(key, mostDpiLike(a, b))
    return map
  }, new Map<string, DPIData | undefined>())
  return [...map.values()]
}
