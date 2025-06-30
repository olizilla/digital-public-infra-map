// CountryDPITracker_Dataset
const sheet = new URL('https://docs.google.com/spreadsheets/d/1w9Kikr6lWyr5HpdgCa_JcQVAQhwJxVBTEGDumjPeNAI/edit?gid=63832391#gid=63832391')
const url = new URL(sheet.pathname + sheet.search, 'https://sheetjson.com')

export async function GET () {
  const res = await fetch(url)
  const txt = await res.text()
  return new Response(txt, { headers: {
    'Content-Type': 'application/json'
  }})
}
