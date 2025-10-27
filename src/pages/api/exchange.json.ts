// 2025.Q3.CountryDPITracker_Dataset
const sheet = new URL('https://docs.google.com/spreadsheets/d/168wnnvAk7N_FxAlVUR9HGwKUxMQWx53rLeaWhS90R8Y/edit?gid=2001514806#gid=2001514806')
const url = new URL(sheet.pathname + sheet.search, 'https://sheetjson.com')

export async function GET () {
  const res = await fetch(url)
  const txt = await res.text()
  return new Response(txt, { headers: {
    'Content-Type': 'application/json'
  }})
}
