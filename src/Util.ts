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

type DPIData = {
  Country: string,
  'DPI Status': 'DPI' | 'WIP' | 'NA'
}

export function oneSystemPerCountry (arr: DPIData[]) {
  const copy = [...arr].reverse() // flip the order so the more dpi like system overwrites
  const dedupe = [...new Map(copy.map(row => [row.Country, row])).values()]
  return dedupe.reverse() // be kind rewind
}
