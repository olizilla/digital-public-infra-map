// How to cite the DPI Map, from CITATION.cff, read at build time so it's written down once: the
// dataset's title, its author, its publisher (the repository), licence and address. The Data page's
// citation and the workbook's (src/ReleaseFiles.ts), the pages' "Cite this page" lines and their
// citation meta tags (src/CitationMeta.ts) all take them from here, and the citations are all
// written by datasetCitation, below.
//
// The version and date are the release the site shows (`release` in src/ReleaseFiles.ts), not
// CITATION.cff's: `npm run data:check` fails if CITATION.cff's `version` or `date-released`
// (top level or in `preferred-citation`) is not that release, so update them with each release.
//
// CITATION.cff is YAML. It's parsed with js-yaml, the YAML parser Astro itself depends on.
// No astro: imports, so the data build can load it in Node (scripts/site-modules.ts).
import { load } from 'js-yaml'
import cffText from '../CITATION.cff?raw'

type CffPerson = { name?: string, 'given-names'?: string, 'family-names'?: string }
type CffEntity = { name: string }

/** One of the dataset's authors: an organisation, by its `name`, or a person, by family and given names */
export type Author = { name: string } | { family: string, given?: string }

const cff = load(cffText) as Record<string, any>
// the citation CITATION.cff asks for, else the file's own fields
const preferred: Record<string, any> = cff['preferred-citation'] ?? cff

/** A YAML date (unquoted) arrives as a Date; a quoted one as a string */
const dateText = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : value === undefined ? undefined : String(value)

/** A CITATION.cff author: an entity (an organisation) has a `name`, a person `family-names` and `given-names` */
const authorOf = (person: CffPerson): Author => person.name ? { name: person.name } : { family: person['family-names'] ?? '', given: person['given-names'] }

/** An organisation's name, or a person's given and family names */
const nameOf = (author: Author) => 'name' in author ? author.name : [author.given, author.family].filter(Boolean).join(' ')

/** "CC-BY-4.0" → "CC BY 4.0": a Creative Commons SPDX licence id, as the licence is usually written */
export const licenceLabel = (spdx: string) => /^CC-/.test(spdx) ? spdx.replace(/-/g, ' ') : spdx

const licence: string = preferred.license ?? cff.license

// the repository: CFF 1.2.0 has a `publisher`, an entity, in a reference such as `preferred-citation`, not at the top level
const publisher = preferred.publisher as CffEntity | undefined
if (!publisher?.name) throw new Error('CITATION.cff has no preferred-citation.publisher.name, the repository the dataset pages cite ("DPI Map")')

/** The DPI Map as a dataset, as CITATION.cff's `preferred-citation` gives it */
export const dataset = {
  /** "DPI Map" */
  title: String(preferred.title),
  /** the institute, an organisation: { name: "UCL Institute for Innovation and Public Purpose" } */
  authors: (preferred.authors as CffPerson[]).map(authorOf),
  /** the repository, the platform the data is published on, `preferred-citation.publisher`: "DPI Map" */
  publisher: publisher.name,
  /** the Data page, "https://dpimap.org/data" */
  url: String(preferred.url),
  /** the SPDX id, "CC-BY-4.0" */
  licence,
  /** "CC BY 4.0" */
  rights: licenceLabel(licence)
}

/** What the dataset is, CITATION.cff's `abstract` */
export const abstract = String(cff.abstract ?? '').replace(/\s+/g, ' ').trim()

/** The site's address, CITATION.cff's top-level `url`, without a trailing slash: "https://dpimap.org" */
export const siteUrl = String(cff.url).replace(/\/$/, '')

/** The DPI Map's author(s) as a citation names them: "UCL Institute for Innovation and Public Purpose" */
export const datasetAuthor = dataset.authors.map(nameOf).join(', ')

/** A citation's element, ending in one full stop: APA doesn't add one where the text already ends in one */
const element = (text: string) => text.endsWith('.') ? text : `${text}.`

/**
 * The DPI Map's citation, or a part's of it (a system's page, a country's page, a map page), as
 * APA 7 cites a dataset, author first, as plain text: the author, the year, the title with the version and
 * "[Data set]", the repository (CITATION.cff's publisher, "DPI Map") and the address. The release is
 * both the version and the date, so the year is the release's.
 *
 * - The Data page and the workbook: "UCL Institute for Innovation and Public Purpose. (2026). DPI Map
 *   (Version 2026-11-06) [Data set]. DPI Map. https://dpimap.org/data".
 * - A part, its title after the dataset's (src/CitationMeta.ts recordCitation): "UCL Institute for
 *   Innovation and Public Purpose. (2026). DPI Map: Belgium (Version 2026-11-06) [Data set]. DPI Map.
 *   https://dpimap.org/belgium/".
 *
 * No "Retrieved" date: the version names the release cited, and Zotero adds its own access date.
 */
export const datasetCitation = ({ title, release, url }: { title: string, release: string, url: string }) =>
  [element(datasetAuthor), `(${release.slice(0, 4)}).`, `${title} (Version ${release}) [Data set].`, element(dataset.publisher), url].join(' ')

/** Where CITATION.cff's version or release date isn't `release`, for `npm run data:check` */
export function citationFileProblems (release: string): string[] {
  const problems: string[] = []
  const fields: [string, unknown][] = [
    ['version', cff.version],
    ['date-released', cff['date-released']],
    ['preferred-citation.version', cff['preferred-citation']?.version],
    ['preferred-citation.date-released', cff['preferred-citation']?.['date-released']]
  ]
  for (const [field, value] of fields) {
    if (field.startsWith('preferred-citation') && !cff['preferred-citation']) continue
    const text = dateText(value)
    if (text !== release) problems.push(`CITATION.cff: ${field} is ${text === undefined ? 'missing' : `"${text}"`}, and the site shows the ${release} release (src/ReleaseFiles.ts)`)
  }
  return problems
}
