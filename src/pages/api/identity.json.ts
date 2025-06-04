// id sheet - DPI Map_Raw Data_31032025
// olizilla fork. 3 header rows deleted
const url = 'https://sheetjson.com/spreadsheets/d/1VtQt-J2C7qrxcCM1H_1w1h8QkNjw6-8wnOSf6jQUjTE/edit?gid=693371714#gid=693371714'

export async function GET () {
  const res = await fetch(url)
  const txt = await res.text()
  return new Response(txt, { headers: {
    'Content-Type': 'application/json'
  }})
}
