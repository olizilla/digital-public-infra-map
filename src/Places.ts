// The places in public/data/places.csv, and the names the data uses for them
// from public/data/place-names.csv. A place's code is the place part of a
// System ID: a lower case ISO 3166-1 alpha-2 code, or a region slug like europe.
// It's also the id of the place's shape on the map, in public/features.json.
import placesCSV from '../public/data/places.csv?raw'
import namesCSV from '../public/data/place-names.csv?raw'

export interface Place {
  code: string
  name: string
  /** ISO 3166-1 alpha-3. Regions and Kosovo have none. */
  iso3?: string
  /** The code of the region the place is in, from UN M49. World has none. */
  parent?: string
}

/** The rows of a CSV with a header row, as objects. Enough for these files: quoted cells, no line breaks in cells. */
export function csvRows (csv: string): Record<string, string>[] {
  const cells = (line: string) => [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(m => m[1]?.replace(/""/g, '"') ?? m[2])
  const [header, ...lines] = csv.trim().split(/\r?\n/).map(cells)
  return lines.map(line => Object.fromEntries(header.map((name, i) => [name, line[i]])))
}

const value = (cell: string) => cell === 'NA' ? undefined : cell
export const places: Place[] = csvRows(placesCSV).map(({ code, name, iso3, parent }) => ({ code, name, iso3: value(iso3), parent: value(parent) }))

const byCode = new Map(places.map(place => [place.code, place]))
const byName = new Map(places.map(place => [place.name, place]))
for (const { dpimap_name, code } of csvRows(namesCSV)) byName.set(dpimap_name, byCode.get(code)!)

export const placeByCode = (code: string) => byCode.get(code)

/** The place a Country / Region name in the data refers to */
export const placeNamed = (name: string) => byName.get(name)

/** A region, like Europe, rather than a country or territory */
export const isRegion = (place: Place) => place.code.length !== 2

/** The label for a system's Country / Region value: "Region" or "Country", or "Country / Region" if it isn't a known place */
export function placeLabel (name: string) {
  const place = placeNamed(name)
  return !place ? 'Country / Region' : isRegion(place) ? 'Region' : 'Country'
}

/** Whether `place` is in the region `code`, directly or through a sub-region */
export function isIn (place: Place, code: string): boolean {
  const parent = place.parent && byCode.get(place.parent)
  return !!parent && (parent.code === code || isIn(parent, code))
}
