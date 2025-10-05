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
Takes an array of DPI system data.
Returns an array with 1 item per Country; the most DPI-like where there is more than 1 system per country.
*/
export function oneSystemPerCountry (arr: DPIData[]) {
  const map = arr.reduce((map, b) => {
    const a = map.get(b.Country)
    map.set(b.Country, mostDpiLike(a, b))
    return map
  }, new Map<string, DPIData | undefined>())
  return [...map.values()]
}
