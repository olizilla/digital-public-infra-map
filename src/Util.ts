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
