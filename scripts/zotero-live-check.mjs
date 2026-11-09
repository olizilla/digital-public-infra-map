// Save the built site's pages in Zotero's own translation server and check the items it makes, an
// optional check beside `npm run citation:check`, which reads the tags without Zotero.
//
// It serves dist/ on a free localhost port (or uses BASE, e.g. BASE=http://localhost:4321 for
// `astro preview`), posts each page's address to the translation server's /web endpoint
// (ZOTERO_SERVER, by default http://127.0.0.1:1969, see github.com/zotero/translation-server),
// writes each response to tests/zotero/<page>.json, and checks the item type and key fields.
// With no translation server running, or no dist/, it says so and exits 0: it's optional.
//
// The server returns the item without attachments, so it can't show the PDF Zotero attaches from
// citation_pdf_url; docs/zotero-check.md has the manual check for that.
//
// usage: npm run build && npm run zotero:check
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'tests', 'zotero')
const zotero = (process.env.ZOTERO_SERVER ?? 'http://127.0.0.1:1969').replace(/\/$/, '')

// the release, from the site's own source (src/ReleaseFiles.ts)
const release = fs.readFileSync(path.join(root, 'src', 'ReleaseFiles.ts'), 'utf8').match(/export const release = '([^']+)'/)[1]
// the dataset's author, CITATION.cff's, which the dataset pages give as a single-field creator
const institute = 'UCL Institute for Innovation and Public Purpose'
// a dataset page: the release as its version and date, the DPI Map as its repository, no identifier
const dataset = { itemType: 'dataset', versionNumber: release, date: release, repository: 'DPI Map', rights: 'CC BY 4.0', identifier: undefined }

/**
 * Each page, and what Zotero should make of it: fields to equal (undefined for a field it shouldn't
 * have), and its authors, as "Last, First", or a single-field creator's name
 */
const pages = [
  {
    name: 'report', path: '/global-state-of-dpi/',
    item: {
      itemType: 'report',
      title: '2025 State of Digital Public Infrastructure Report: A Look at Measurement and Prevalence as DPI Transitions from Experiment to Scale',
      date: '2025', institution: 'UCL Institute for Innovation and Public Purpose', reportNumber: '2025/06',
      seriesTitle: 'IIPP Policy Report', ISBN: '9781917384391', url: 'https://dpimap.org/global-state-of-dpi/'
    },
    creators: ['Fetter, Jordyn', 'Rao, Krisstina', 'Eaves, David']
  },
  {
    name: 'data', path: '/data/',
    // the dataset's own title, not "DPI Map: DPI Map", and the DPI Map as the repository, like the other dataset pages
    item: { ...dataset, title: 'DPI Map', url: 'https://dpimap.org/data' },
    creators: [institute]
  },
  {
    name: 'insight-paper-doi', path: '/blog/interactions-between-ai-and-dpi/',
    item: {
      itemType: 'journalArticle',
      title: 'Interactions Between Artificial Intelligence and Digital Public Infrastructure: Concepts, Benefits, and Challenges',
      date: '2024-12-07', publicationTitle: 'arXiv preprint 2412.05761', DOI: '10.48550/arXiv.2412.05761', url: 'https://arxiv.org/abs/2412.05761'
    },
    creators: ['Nagar, Sarosh', 'Eaves, David']
  },
  {
    name: 'insight-paper-pdf', path: '/blog/dpi-a-framework-for-conceptualisation-and-measurement/',
    item: {
      itemType: 'journalArticle',
      title: 'Digital Public Infrastructure: a framework for conceptualisation and measurement',
      date: '2025-01', publicationTitle: 'UCL Institute for Innovation and Public Purpose, Working Paper Series (IIPP WP 2025-01)',
      url: 'https://www.ucl.ac.uk/bartlett/publications/2025/jan/digital-public-infrastructure-framework-conceptualisation-and-measurement'
    },
    creators: ['Eaves, David', 'Rao, Krisstina']
  },
  {
    name: 'insight-report', path: '/blog/the-economics-of-shared-digital-infrastructures/',
    item: {
      itemType: 'report', title: 'The Economics of Shared Digital Infrastructures: A framework for assessing societal value',
      date: '2025-03', institution: 'UCL Institute for Innovation and Public Purpose', url: 'https://www.ucl.ac.uk/bartlett/publications/2025/mar/economics-shared-digital-infrastructures'
    },
    creators: ['Eaves, David', 'Coyle, Diane', 'Vasconcellos, Beatriz', 'Deshmukh, Sumedha']
  },
  {
    name: 'insight-case', path: '/blog/the-digilocker-story/',
    item: {
      itemType: 'webpage', title: 'The DigiLocker Story: How India is digitising its documents', date: '2025-10-20',
      websiteTitle: 'UCL Institute for Innovation and Public Purpose', url: 'https://www.ucl.ac.uk/bartlett/publications/2025/oct/digilocker-story-how-india-digitising-its-documents'
    },
    creators: ['Gaur, Ritul', 'Eaves, David']
  },
  {
    name: 'system-data-exchange', path: '/dx-be-01/',
    // a part of the dataset, titled after it, and dated by the release, not the record's last update
    item: { ...dataset, title: 'DPI Map: Federal Service Bus (FSB), Belgium', identifier: 'dx-be-01', url: 'https://dpimap.org/dx-be-01/' },
    creators: [institute]
  },
  {
    name: 'system-identity', path: '/id-in-01/',
    item: { ...dataset, title: 'DPI Map: Aadhaar, India', identifier: 'id-in-01', url: 'https://dpimap.org/id-in-01/' },
    creators: [institute]
  },
  {
    name: 'country', path: '/belgium/',
    item: { ...dataset, title: 'DPI Map: Belgium', url: 'https://dpimap.org/belgium/' },
    creators: [institute]
  },
  // the map pages, each a DPI type's systems
  { name: 'map-id', path: '/', item: { ...dataset, title: 'DPI Map: Digital ID systems', url: 'https://dpimap.org/' }, creators: [institute] },
  { name: 'map-payment', path: '/digital-payment/', item: { ...dataset, title: 'DPI Map: Digital payment systems', url: 'https://dpimap.org/digital-payment/' }, creators: [institute] },
  { name: 'map-data-exchange', path: '/data-exchange/', item: { ...dataset, title: 'DPI Map: Data exchange systems', url: 'https://dpimap.org/data-exchange/' }, creators: [institute] },
  {
    name: 'about', path: '/about/',
    item: { itemType: 'webpage', title: 'About', websiteTitle: 'DPI Map', url: 'https://dpimap.org/about/' },
    creators: []
  }
]

const types = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' }

/** dist/, as a static host serves it: /about/ is dist/about/index.html */
function serve () {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let file = path.join(dist, decodeURIComponent(url.pathname))
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const reachable = async url => { try { await fetch(url, { signal: AbortSignal.timeout(3000) }); return true } catch { return false } }

/** "Last, First", or a single-field creator's name, so the institute split into a person reads "Purpose, UCL Institute for Innovation and Public" */
const creatorText = c => c.name ?? `${c.lastName}, ${c.firstName}`

if (!await reachable(`${zotero}/`)) {
  console.log(`zotero:check skipped: no Zotero translation server at ${zotero} (set ZOTERO_SERVER to use another)`)
  process.exit(0)
}
let server, base = process.env.BASE?.replace(/\/$/, '')
if (!base) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.log('zotero:check skipped: no dist/ to serve. Run `npm run build` first, or set BASE to a running preview')
    process.exit(0)
  }
  server = await serve()
  base = `http://127.0.0.1:${server.address().port}`
}
fs.mkdirSync(outDir, { recursive: true })
const failures = []
for (const page of pages) {
  const url = base + page.path
  const res = await fetch(`${zotero}/web`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: url })
  const text = await res.text()
  fs.writeFileSync(path.join(outDir, `${page.name}.json`), text.endsWith('\n') ? text : text + '\n')
  if (res.status !== 200) { failures.push(`${page.name} ${page.path}: the translation server answered ${res.status}: ${text.slice(0, 200)}`); continue }
  const item = JSON.parse(text)[0]
  const creators = (item.creators ?? []).map(creatorText)
  console.log(`${page.name} ${page.path}: ${item.itemType}, "${item.title}"${creators.length ? `, by ${creators.join('; ')}` : ''}`)
  for (const [field, want] of Object.entries(page.item)) {
    if (item[field] !== want) failures.push(`${page.name} ${page.path}: ${field} is ${JSON.stringify(item[field])}, expected ${want === undefined ? 'none' : JSON.stringify(want)}`)
  }
  if (JSON.stringify(creators) !== JSON.stringify(page.creators)) failures.push(`${page.name} ${page.path}: creators are ${JSON.stringify(creators)}, expected ${JSON.stringify(page.creators)}`)
  for (const c of item.creators ?? []) if (c.creatorType !== 'author') failures.push(`${page.name} ${page.path}: ${creatorText(c)} is a creator of type ${c.creatorType}, expected author`)
}
server?.close()
if (failures.length) {
  console.log(`\nzotero:check FAILED: ${failures.length} differences\n${failures.map(f => `  ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(`\nzotero:check passed: ${pages.length} pages, responses in tests/zotero/`)
