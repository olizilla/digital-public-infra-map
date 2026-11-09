// Check the built pages' citation meta tags, for Zotero and other reference managers (src/CitationMeta.ts):
// for a fixed set of pages, the tags and values Zotero's "Embedded Metadata" translator needs to make
// the right item (docs/zotero-check.md), and that the citation a page shows says what its tags say.
// It reads dist/, so build first. `npm run zotero:check` saves the same pages in Zotero's own
// translation server, where one is running.
//
// usage: npm run build && npm run citation:check
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const release = fs.readFileSync(path.join(root, 'src', 'ReleaseFiles.ts'), 'utf8').match(/export const release = '([^']+)'/)[1]
// the year the dataset pages' citations give: the release's
const year = release.slice(0, 4)
// the dataset's author, CITATION.cff's
const institute = 'UCL Institute for Innovation and Public Purpose'
// the dataset's title and repository, CITATION.cff's title and publisher. A part of it, a system, a
// country or a map page's DPI type, is titled after it: "DPI Map: Ireland"
const repository = 'DPI Map'
const partTitle = part => `DPI Map: ${part}`
const defaultDescription = 'The first global investigation of digital public infrastructure.'

const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const text = html => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** A built page's head tags: each meta name or property's values, in order, and its canonical link */
function read (page) {
  const file = path.join(dist, page, 'index.html')
  if (!fs.existsSync(file)) throw new Error(`dist/${page}/index.html is missing: run \`npm run build\` first`)
  const html = fs.readFileSync(file, 'utf8')
  const head = html.slice(0, html.indexOf('</head>'))
  const tags = {}
  for (const [, key, content] of head.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)"/g)) (tags[key] ??= []).push(decode(content))
  const canonical = head.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  const title = head.match(/<title>([^<]*)<\/title>/)?.[1]
  return { html, tags, canonical: canonical && decode(canonical), title: title && decode(title) }
}

/** The citation the page shows, as text */
const shown = {
  citeBox: html => text(html.match(/<p data-citation[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
  system: html => text(html.match(/<p class="cite-text">([\s\S]*?)<\/p>/)?.[1] ?? ''),
  // a country's page and the map pages (src/components/SourceAndCite.astro)
  sourceAndCite: html => text(html.match(/<div id="cite">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
  report: html => text(html.match(/referenced as follows:<\/p>\s*<div class="paper-cite not-prose">\s*<p data-citation>([\s\S]*?)<\/p>/)?.[1] ?? '')
}

/** "Eaves, David" → "Eaves, D." */
const initials = name => { const [family, given = ''] = name.split(', '); return `${family}, ${given.split(/\s+/).map(n => n[0] + '.').join(' ')}` }
const one = (tags, name) => tags[name]?.[0]

/**
 * A dataset's authors, as its citation names them, from its citation_author tags: the institute's tag
 * ends in a comma, so Zotero keeps its name as one (src/CitationMeta.ts datasetAuthorTag); a person's
 * is "Family, Given"
 */
const datasetAuthors = t => (t.citation_author ?? []).map(a => a.endsWith(',') ? a.slice(0, -1) : a.split(', ').reverse().join(' ')).join(', ')

/** The citation each kind of page should show, written from its tags */
const fromTags = {
  // APA 7's for a dataset, author first (src/Citation.ts datasetCitation): the year from the date, the
  // version, "[Data set]", the repository and the address. No "Retrieved" date
  dataset: t => [
    `${datasetAuthors(t)}.`,
    `(${one(t, 'citation_publication_date')?.slice(0, 4)}).`,
    `${one(t, 'citation_title')} (Version ${one(t, 'prism.edition')}) [Data set].`,
    `${one(t, 'citation_publisher')}.`,
    one(t, 'citation_public_url')
  ].join(' '),
  report: t => {
    const names = (t.citation_author ?? []).map(initials)
    const authors = names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names.join(' and ')
    return `${authors} (${one(t, 'citation_publication_date').slice(0, 4)}). ${one(t, 'citation_title')}. ${one(t, 'citation_technical_report_institution')}. ${one(t, 'citation_series_title')} ${one(t, 'citation_technical_report_number')}. ISBN: ${one(t, 'citation_isbn')}`
  },
  insight: t => {
    const names = (t.citation_author ?? []).map(initials)
    const authors = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0] ?? ''
    const venue = one(t, 'citation_journal_title') ?? one(t, 'citation_technical_report_institution') ?? one(t, 'prism.publicationName')
    const doi = one(t, 'citation_doi')
    return `${authors} (${one(t, 'citation_publication_date')?.slice(0, 4) ?? 'n.d.'}). ${one(t, 'citation_title')}. ${venue}. ${doi ? `https://doi.org/${doi}` : one(t, 'citation_public_url')}`
  }
}

// a Dataset's tags (src/CitationMeta.ts datasetMeta): eprints.type outranks og:type "website" in the translator.
// The institute is the author, with a trailing comma, so Zotero makes it a single-field creator, not a person.
// The release is the version and the date, and the DPI Map, the platform it's published on, the repository,
// on every dataset page
const dataset = { 'eprints.type': 'dataset', 'DC.type': 'Dataset', 'prism.edition': release, citation_publication_date: release, citation_author: `${institute},`, citation_publisher: repository, 'DC.rights': 'CC BY 4.0' }

/** A map page's status bar's count of DPI-like countries, the number its description should give */
const statusBarDpiLike = html => html.match(/<span class="font-bold">(\d+)<\/span> DPI-like/)?.[1]
/** A map page: a DPI type's systems, cited and described as a view of the dataset. Only the citation's title is "DPI Map: ..." */
const mapPage = (page, title, type) => ({
  page, type: `Dataset (map page, ${type})`, title: `${title} - DPI Map`,
  tags: { ...dataset, citation_title: partTitle(title), citation_public_url: `https://dpimap.org/${page ? `${page}/` : ''}`, 'z.identifier': null },
  description: new RegExp(`^${title} in \\d+ countries researched: \\d+ DPI-like\\. DPI Map, ${release} release\\.$`),
  // the DPI-like count in the description is the one the status bar shows
  check: (html, description) => description.match(/: (\d+) DPI-like/)?.[1] === statusBarDpiLike(html) || `its description's DPI-like count isn't the status bar's, ${statusBarDpiLike(html)}`,
  cite: ['sourceAndCite', 'dataset'],
  citation: `${institute}. (${year}). ${partTitle(title)} (Version ${release}) [Data set]. DPI Map. https://dpimap.org/${page ? `${page}/` : ''}`
})

/**
 * The pages: `tags` each name's expected values (a string for one tag, an array for several, null for none),
 * `cite` how to find the citation the page shows and how to write it from the tags
 */
const pages = [
  {
    page: 'global-state-of-dpi', type: 'Report',
    tags: {
      citation_title: '2025 State of Digital Public Infrastructure Report: A Look at Measurement and Prevalence as DPI Transitions from Experiment to Scale',
      citation_author: ['Fetter, Jordyn', 'Rao, Krisstina', 'Eaves, David'],
      citation_publication_date: '2025',
      citation_technical_report_institution: 'UCL Institute for Innovation and Public Purpose',
      citation_technical_report_number: '2025/06',
      citation_series_title: 'IIPP Policy Report',
      'z.seriesTitle': 'IIPP Policy Report',
      citation_isbn: '978-1-917384-39-1',
      citation_pdf_url: 'https://dpimap.org/iipp-state-of-dpi-report-2025.pdf',
      'eprints.type': null
    },
    cite: ['report', 'report'],
    // as the page showed it before the citation moved to front matter
    citation: 'Fetter, J., Rao, K., and Eaves, D. (2025). 2025 State of Digital Public Infrastructure Report: A Look at Measurement and Prevalence as DPI Transitions from Experiment to Scale. UCL Institute for Innovation and Public Purpose. IIPP Policy Report 2025/06. ISBN: 978-1-917384-39-1'
  },
  {
    page: 'data', type: 'Dataset',
    // the dataset's own title, "DPI Map", not "DPI Map: DPI Map"; the DPI Map as the repository, like the other dataset pages
    tags: { ...dataset, citation_title: 'DPI Map', citation_public_url: 'https://dpimap.org/data', 'z.identifier': null },
    cite: ['citeBox', 'dataset'],
    citation: `${institute}. (${year}). DPI Map (Version ${release}) [Data set]. DPI Map. https://dpimap.org/data`
  },
  {
    page: 'blog/interactions-between-ai-and-dpi', type: 'Journal Article, with a DOI',
    tags: {
      citation_title: 'Interactions Between Artificial Intelligence and Digital Public Infrastructure: Concepts, Benefits, and Challenges',
      citation_author: ['Nagar, Sarosh', 'Eaves, David'],
      citation_publication_date: '2024-12-07',
      citation_journal_title: 'arXiv preprint 2412.05761',
      citation_doi: '10.48550/arXiv.2412.05761',
      citation_public_url: 'https://arxiv.org/abs/2412.05761',
      citation_pdf_url: 'https://arxiv.org/pdf/2412.05761v1',
      citation_technical_report_institution: null
    },
    abstract: /^Artificial intelligence \(AI\) and digital public infrastructure/,
    cite: ['citeBox', 'insight']
  },
  {
    page: 'blog/dpi-a-framework-for-conceptualisation-and-measurement', type: 'Journal Article, with a PDF',
    tags: {
      citation_title: 'Digital Public Infrastructure: a framework for conceptualisation and measurement',
      citation_author: ['Eaves, David', 'Rao, Krisstina'],
      citation_publication_date: '2025-01',
      citation_journal_title: 'UCL Institute for Innovation and Public Purpose, Working Paper Series (IIPP WP 2025-01)',
      citation_public_url: 'https://www.ucl.ac.uk/bartlett/publications/2025/jan/digital-public-infrastructure-framework-conceptualisation-and-measurement',
      citation_pdf_url: 'https://discovery.ucl.ac.uk/id/eprint/10210968/1/Eaves_dpi_conceptualisation_and_measurement.pdf',
      citation_doi: null
    },
    cite: ['citeBox', 'insight']
  },
  {
    page: 'blog/the-economics-of-shared-digital-infrastructures', type: 'Report (Insights)',
    tags: {
      citation_technical_report_institution: 'UCL Institute for Innovation and Public Purpose',
      citation_journal_title: null,
      citation_pdf_url: 'https://discovery.ucl.ac.uk/id/eprint/10211014/1/Eaves_the_economics_of_shared_digital_infrastructures.pdf'
    },
    cite: ['citeBox', 'insight']
  },
  {
    page: 'blog/the-digilocker-story', type: 'Web Page (Insights case study)',
    tags: {
      'prism.publicationName': 'UCL Institute for Innovation and Public Purpose',
      citation_journal_title: null,
      citation_technical_report_institution: null,
      citation_public_url: 'https://www.ucl.ac.uk/bartlett/publications/2025/oct/digilocker-story-how-india-digitising-its-documents'
    },
    cite: ['citeBox', 'insight']
  },
  {
    page: 'dx-be-01', type: 'Dataset (data exchange system)',
    // only the citation's title is "DPI Map: ...", not the page's
    title: 'Federal Service Bus (FSB) · Belgium · DPI Map',
    // the system's ID is the Identifier, and not in the title
    tags: { ...dataset, citation_title: 'DPI Map: Federal Service Bus (FSB), Belgium', 'z.identifier': 'dx-be-01', citation_public_url: 'https://dpimap.org/dx-be-01/', 'DC.identifier': null },
    description: `Federal Service Bus (FSB) is a data exchange system in Belgium. DPI status: DPI-like. DPI Map, ${release} release.`,
    cite: ['system', 'dataset'],
    // cited by the release, not by the record's last update, which the page shows beside its fields
    citation: `${institute}. (${year}). DPI Map: Federal Service Bus (FSB), Belgium (Version ${release}) [Data set]. DPI Map. https://dpimap.org/dx-be-01/`
  },
  {
    page: 'id-in-01', type: 'Dataset (digital ID system)',
    tags: { ...dataset, citation_title: 'DPI Map: Aadhaar, India', 'z.identifier': 'id-in-01', citation_public_url: 'https://dpimap.org/id-in-01/' },
    description: new RegExp(`^Aadhaar is a digital ID system in India\\. DPI status: [^.]+\\. DPI Map, ${release} release\\.$`),
    cite: ['system', 'dataset']
  },
  {
    page: 'belgium', type: 'Dataset (country)', title: 'Belgium - DPI Map',
    tags: { ...dataset, citation_title: 'DPI Map: Belgium', citation_public_url: 'https://dpimap.org/belgium/', 'z.identifier': null },
    description: new RegExp(`Belgium's .* DPI Map, ${release} release\\.$`),
    cite: ['sourceAndCite', 'dataset'],
    citation: `${institute}. (${year}). DPI Map: Belgium (Version ${release}) [Data set]. DPI Map. https://dpimap.org/belgium/`
  },
  mapPage('', 'Digital ID systems', 'the home page'),
  mapPage('digital-payment', 'Digital payment systems', 'payment'),
  mapPage('data-exchange', 'Data exchange systems', 'data exchange'),
  {
    page: 'about', type: 'Web Page',
    tags: { citation_title: null, 'eprints.type': null }
  }
]

const failures = []
for (const p of pages) {
  const fail = message => failures.push(`/${p.page ? `${p.page}/` : ''} (${p.type}): ${message}`)
  const { html, tags, canonical, title } = read(p.page)
  // every page: the site's name, a canonical link, a description of its own, and og:type "website"
  if (one(tags, 'og:site_name') !== 'DPI Map') fail(`og:site_name is ${JSON.stringify(one(tags, 'og:site_name'))}, expected "DPI Map"`)
  if (!canonical || canonical !== one(tags, 'og:url')) fail(`the canonical link ${JSON.stringify(canonical)} isn't og:url ${JSON.stringify(one(tags, 'og:url'))}`)
  if (one(tags, 'og:type') !== 'website') fail(`og:type is ${JSON.stringify(one(tags, 'og:type'))}, expected "website"`)
  const description = one(tags, 'description')
  if (!description || description === defaultDescription) fail('it has no description of its own')
  if (one(tags, 'og:description') !== description || one(tags, 'twitter:description') !== description) fail('og:description and twitter:description are not its description')
  if (p.description && !(p.description instanceof RegExp ? p.description.test(description) : description === p.description)) fail(`description is ${JSON.stringify(description)}, expected ${p.description}`)
  if (p.abstract && !p.abstract.test(one(tags, 'citation_abstract') ?? '')) fail(`citation_abstract is ${JSON.stringify(one(tags, 'citation_abstract'))}`)
  if (p.title && title !== p.title) fail(`its title is ${JSON.stringify(title)}, expected ${JSON.stringify(p.title)}`)
  const checked = p.check?.(html, description ?? '')
  if (typeof checked === 'string') fail(checked)

  for (const [name, want] of Object.entries(p.tags)) {
    const got = tags[name]
    if (want === null) { if (got) fail(`has ${name} ${JSON.stringify(got)}, expected none`); continue }
    const wanted = Array.isArray(want) ? want : [want]
    if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(`${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(wanted)}`)
  }
  if (tags['DC.type'] && !/<link rel="schema\.DC" href="http:\/\/purl\.org\/dc\/elements\/1\.1\/"/.test(html)) fail('it has DC tags and no schema.DC link')

  if (p.cite) {
    const [where, how] = p.cite
    const visible = shown[where](html)
    const written = fromTags[how](tags)
    if (!visible) fail('its citation is missing')
    else if (visible !== written) fail(`the citation it shows and its tags disagree:\n    shown: ${visible}\n    tags:  ${written}`)
    if (p.citation && visible !== p.citation) fail(`the citation it shows changed:\n    shown:    ${visible}\n    expected: ${p.citation}`)
  }
}

if (failures.length) {
  console.log(`citation:check FAILED: ${failures.length} problems\n${failures.map(f => `  ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(`citation:check passed: ${pages.length} pages' citation meta tags, and the citations they show`)
