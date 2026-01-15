// 2025.Q4.CountryDPITracker_Dataset
const sheet = new URL('https://docs.google.com/spreadsheets/d/1AJsuUiupyJGBZH2GDx-NuhMKKZw5Gi5y9oy8CDsxyS8/edit?gid=1765224438#gid=1765224438')
const url = new URL(sheet.pathname + sheet.search, 'https://sheetjson.com')

export async function GET () {
  const res = await fetch(url)
  const txt = await res.text()
  return new Response(txt, { headers: {
    'Content-Type': 'application/json'
  }})
}
