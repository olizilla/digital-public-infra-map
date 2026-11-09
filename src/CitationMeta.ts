// Citations, and the meta tags that let Zotero and other reference managers save a page as one,
// built from the same data so the tags and the citation a page shows can't drift apart.
// The layout (src/layouts/Layout.astro) writes the tags in the page's head.
//
// The tags are Highwire Press `citation_*` tags, the ones Zotero's "Embedded Metadata" translator
// reads best, plus a few it can't get from Highwire, each noted where it's made. See
// docs/zotero-check.md for what Zotero should make of each kind of page, and
// `npm run citation:check` (scripts/citation-meta-check.mjs), which checks the built pages.
//
// - The State of DPI report, a Zotero Report (reportMeta), from its page's front matter.
// - The Data page, the map pages (/, /digital-payment/, /data-exchange/), a system's page and a
//   country's page, a Zotero Dataset (datasetMeta): the institute as the author, the release as the
//   version and the date, CC BY 4.0 as the rights, the DPI Map as the repository, and on a system's
//   page, its ID as the identifier. Every one but the Data page is titled after the dataset, "DPI Map:
//   Ireland". Their citations are APA 7's for a dataset, author first (src/Citation.ts datasetCitation).
// - Insights landing pages (insightCitation): a Journal Article, a Report or a Web Page by kind.
//
// No astro: imports, so a Node script can load it (scripts/site-modules.ts).
import { abstract, dataset, datasetCitation, siteUrl, type Author } from './Citation'
import { release } from './ReleaseFiles'

/** A `<meta name content>` tag */
export interface MetaTag { name: string, content: string }

const tag = (name: string, content: string | undefined): MetaTag[] => content ? [{ name, content }] : []

/** A person's name, family name first, as Zotero reads `citation_author`: "Eaves, David" */
const inverted = (p: Person) => p.given ? `${p.family}, ${p.given}` : p.family

/** "Eaves, D.": the family name and initials, as the visible citations write a name */
const initialled = (p: Person) => p.given ? `${p.family}, ${p.given.split(/\s+/).map(n => n[0] + '.').join(' ')}` : p.family

export interface Person { family: string, given?: string }

// --- Datasets: the release (/data), and its records (a system's page, a country's page) ---

/**
 * A dataset author's `citation_author`: a person as "Family, Given", like the other pages' authors,
 * and an organisation, the institute, as its name with a comma at the end:
 * "UCL Institute for Innovation and Public Purpose,".
 *
 * The trailing comma is deliberate, a workaround for how Zotero parses names (`cleanAuthor` in
 * zotero/utilities, which the Embedded Metadata translator calls). Zotero splits a name with a comma
 * at the first comma, into last name and first name, and a name without one at its last space, so
 * the bare name would be saved as a person, first name "UCL Institute for Innovation and Public",
 * last name "Purpose". With the comma at the end, nothing follows it: Zotero drops the comma and
 * keeps the whole name as the last name with no first name, which it saves as a single-field
 * creator, the institute's name as one. Only this tag has the comma; the citations the pages
 * show name the institute as CITATION.cff does.
 */
const datasetAuthorTag = (author: Author) => 'name' in author ? `${author.name},` : inverted(author)

/**
 * Tags for a Zotero Dataset. Highwire has no dataset type and no version, so:
 * - `eprints.type` "dataset" makes the item a Dataset. The translator ranks og:type above DC.type,
 *   and every page's og:type is "website", which alone would make it a Web Page; it ranks
 *   eprints.type above both. `DC.type` "Dataset" (DCMI) says the same in the standard vocabulary.
 * - `citation_author` is the institute, as a single-field creator (datasetAuthorTag).
 * - `citation_publication_date` is the release, the date the citation the page shows gives.
 * - `prism.edition` is the version, the release too: the translator copies it to Version.
 * - `citation_publisher` is Zotero's Repository for a Dataset: the DPI Map, CITATION.cff's publisher.
 * - `z.identifier`, where there is one, is Zotero's Identifier, in Zotero's own namespace: the
 *   translator doesn't put `DC.identifier` there.
 * - `DC.rights` is the licence, Zotero's Rights.
 */
function datasetMeta ({ title, url, description, identifier }: { title: string, url: string, description: string, identifier?: string }): MetaTag[] {
  return [
    ...tag('citation_title', title),
    ...dataset.authors.flatMap(author => tag('citation_author', datasetAuthorTag(author))),
    ...tag('citation_publication_date', release),
    ...tag('citation_publisher', dataset.publisher),
    ...tag('citation_public_url', url),
    ...tag('citation_abstract', description),
    ...tag('prism.edition', release),
    ...tag('z.identifier', identifier),
    ...tag('DC.type', 'Dataset'),
    ...tag('eprints.type', 'dataset'),
    ...tag('DC.rights', dataset.rights)
  ]
}

/** "DPI Map, 2026-11-06 release." */
const releaseNote = `${dataset.title}, ${release} release.`

/** The Data page's description: CITATION.cff's abstract, and the release */
export const releaseDescription = `${abstract} ${releaseNote}`

/**
 * The Data page, /data: the release, as CITATION.cff's preferred citation gives it, titled just
 * "DPI Map", the dataset's title, with the DPI Map as the repository, like every dataset page.
 */
export const releaseMeta = (): MetaTag[] => datasetMeta({ title: dataset.title, url: dataset.url, description: releaseDescription })

/**
 * A part of the dataset on its own page, as the page's citation cites it, by the release, like the
 * Data page: a record (a system's page, a country's page) or a map page's DPI type. Its title is
 * the part's after the dataset's, so a reference manager doesn't save a page as just "Ireland": "UCL
 * Institute for Innovation and Public Purpose. (2026). DPI Map: Federal Service Bus (FSB), Belgium
 * (Version 2026-11-06) [Data set]. DPI Map. https://dpimap.org/dx-be-01/". The DPI Map, the
 * platform the data is published on, is the repository, in the citation and the tags, as on the Data
 * page, and the tags give a system's ID (`identifier`, "dx-be-01") as the identifier. Only the
 * citation and its tags have the prefix: the page's own title and description name the part alone.
 * A system's page still shows when its data was last updated, beside its fields; the citation doesn't.
 *
 * `title` is the part's, "Ireland"; `path` the page's path without slashes, "" for the home page.
 */
export function recordCitation ({ title: part, path, identifier }: { title: string, path: string, identifier?: string }) {
  const title = `${dataset.title}: ${part}`
  const url = `${siteUrl}/${path ? `${path}/` : ''}`
  return {
    text: datasetCitation({ title, release, url }),
    meta: (description: string) => datasetMeta({ title, url, description, identifier })
  }
}

const statusWords: Record<string, string> = { DPI: 'DPI-like', WIP: 'WIP, not yet DPI-like', NA: 'NA' }

/** A system page's description: what it is, its DPI status, and the release */
export const systemDescription = ({ title, noun, country, dpiStatus }: { title: string, noun: string, country: string, dpiStatus: string }) =>
  `${title} is a ${noun} system in ${country}. DPI status: ${statusWords[dpiStatus] ?? dpiStatus}. ${releaseNote}`

/**
 * A map page's description (/, /digital-payment/, /data-exchange/): its DPI type's systems, the
 * countries researched and how many are DPI-like, as its status bar counts them, one system per
 * country (src/Util.ts oneSystemPerCountry), and the release
 */
export const mapDescription = ({ title, countries, dpiLike }: { title: string, countries: number, dpiLike: number }) =>
  `${title} in ${countries} countries researched: ${dpiLike} DPI-like. ${releaseNote}`

/** A country page's description: its summary sentence (src/CountryPage.ts), as text, and the release */
export const countryDescription = (summaryHtml: string) =>
  `${summaryHtml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')} ${releaseNote}`

// --- The State of DPI report, from its page's front matter ---

export interface Report {
  authors: Person[]
  /** a year, YYYY-MM or YYYY-MM-DD, as known */
  date: string | number
  title: string
  subtitle?: string
  institution: string
  series: string
  number: string
  isbn: string
  /** the full text, a path on this site */
  pdf: string
}

/** "A, B, and C", as the report's citation lists its authors */
const listed = (names: string[]) => names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names.join(' and ')

/** The report's citation, in parts, so the page can set the title in italics */
export function reportCitation (r: Report) {
  const title = r.subtitle ? `${r.title}: ${r.subtitle}` : r.title
  return {
    authors: `${listed(r.authors.map(initialled))} (${String(r.date).slice(0, 4)}).`,
    title: `${title}.`,
    rest: `${r.institution}. ${r.series} ${r.number}. ISBN: ${r.isbn}`
  }
}

/**
 * Tags for a Zotero Report. `citation_technical_report_institution` makes it a Report. The
 * translator reads `citation_series_title` into Series, a field a Report doesn't have, so Zotero
 * drops it; `z.seriesTitle`, in Zotero's own namespace, fills the Report's Series Title.
 */
export function reportMeta (r: Report, site: URL): MetaTag[] {
  return [
    ...tag('citation_title', r.subtitle ? `${r.title}: ${r.subtitle}` : r.title),
    ...r.authors.flatMap(p => tag('citation_author', inverted(p))),
    ...tag('citation_publication_date', String(r.date)),
    ...tag('citation_technical_report_institution', r.institution),
    ...tag('citation_technical_report_number', r.number),
    ...tag('citation_series_title', r.series),
    ...tag('z.seriesTitle', r.series),
    ...tag('citation_isbn', r.isbn),
    ...tag('citation_pdf_url', new URL(r.pdf, site).href)
  ]
}

// --- Insights landing pages (src/pages/blog/[id].astro) ---

export interface InsightData {
  title: string
  kind: string
  date?: string
  url: string
  authors?: string[]
  publisher?: string
  publication?: string
  doi?: string
  pdf?: string
}

// "Sarosh Nagar" → "Nagar, S.", "R. Gaur" → "Gaur, R."
const citeName = (name: string) => {
  const parts = name.split(/\s+/)
  const last = parts.pop()
  return `${last}, ${parts.map(p => p[0] + '.').join(' ')}`
}

/** "Sarosh Nagar" → family "Nagar", given "Sarosh"; "R. Gaur" → "Gaur", "R.": the last word is the family name, as citeName has it */
const personOf = (name: string): Person => {
  const parts = name.split(/\s+/)
  const family = parts.pop()!
  return parts.length ? { family, given: parts.join(' ') } : { family }
}

/**
 * An entry's citation, and its tags. The citation names where it was published (`publication`, else
 * `publisher`) and links its DOI, else its `url`; the tags give the same, so Zotero's item points at
 * the original work, not at this page. By kind: a `paper` with a `publication` is a Journal Article,
 * a `report` a Report from that institution, anything else a Web Page on that site
 * (`prism.publicationName`, Zotero's Website Title).
 */
export function insightCitation (d: InsightData, abstractText: string) {
  const people = (d.authors ?? []).map(personOf)
  const names = (d.authors ?? []).map(citeName)
  const authorList = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0] ?? ''
  const venue = d.publication || d.publisher || ''
  const text = [
    `${authorList} (${d.date ? d.date.slice(0, 4) : 'n.d.'}).`,
    `${d.title}.`,
    `${venue}.`,
    d.doi ? `https://doi.org/${d.doi}` : d.url
  ].join(' ')
  const type = d.kind === 'paper' && d.publication ? 'journalArticle' : d.kind === 'report' ? 'report' : 'webpage'
  const meta: MetaTag[] = [
    ...tag('citation_title', d.title),
    ...people.flatMap(p => tag('citation_author', inverted(p))),
    ...tag('citation_publication_date', d.date),
    ...(type === 'journalArticle' ? tag('citation_journal_title', venue)
      : type === 'report' ? tag('citation_technical_report_institution', venue)
        : tag('prism.publicationName', venue)),
    ...tag('citation_doi', d.doi),
    ...tag('citation_public_url', d.url),
    ...tag('citation_pdf_url', d.pdf),
    ...tag('citation_abstract', abstractText)
  ]
  return { text, meta, type }
}
