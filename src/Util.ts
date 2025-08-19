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

/*
Takes an array of DPI system data.
Returns an array with 1 item per Country; the most DPI-like where there is more than 1 system per country.
*/
export function oneSystemPerCountry (arr: DPIData[]) {
  const map = arr.reduce((map, row) => {
    const val = map.get(row.Country)
    if (val && val["DPI Status"] === 'DPI') {
      // we already have a DPI-like entry so move on
      return map
    }
    if (val && val["DPI Status"] === row["DPI Status"]) {
      // the new one isn't more dpi-like so move on
      return map
    }
    // the new row is the first, or more dpi-like, so include it.
    map.set(row.Country, row)
    return map
  }, new Map<string, DPIData>())
  return [...map.values()]
}
