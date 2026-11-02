// Key the map's shapes (public/features.json, TopoJSON) by our place codes, and
// add a point for each place the map has no shape for, so the site can find any
// place on the map by its code. The shapes are from Our World in Data's world map,
// keyed by ISO 3166-1 alpha-3: this turns each of those into a code with the
// iso3 column of public/data/places.csv. Ids that are already place codes are
// kept, so running it again changes nothing, and a new map with ISO ids can be
// dropped in and run through it. Fails if an id isn't a place.
//
// usage: node scripts/map-features.mjs [public/features.json]

import fs from 'node:fs'

const path = process.argv[2] ?? 'public/features.json'

/** The map's ids that aren't ISO 3166-1 alpha-3 codes, as place codes */
const nonIsoIds = {
  XXK: 'xk', // Kosovo
  PSX: 'ps', // the West Bank, as State of Palestine
}

/** Places with no shape on the map: [longitude, latitude] near their centre */
const points = {
  bl: [-62.83, 17.9], // Saint Barthélemy
  bq: [-68.26, 12.18], // Bonaire, Sint Eustatius and Saba: Bonaire
  cw: [-68.99, 12.17], // Curaçao
  fo: [-6.91, 61.89], // Faroe Islands
  gp: [-61.55, 16.25], // Guadeloupe
  hk: [114.17, 22.32], // Hong Kong
  im: [-4.55, 54.24], // Isle of Man
  io: [72.42, -7.33], // British Indian Ocean Territory: Diego Garcia
  mo: [113.54, 22.19], // Macao
  mq: [-61.02, 14.64], // Martinique
  va: [12.45, 41.9], // Vatican City
}

/** The rows of a CSV with a header row: quoted cells, no line breaks in cells */
function rows (csv) {
  const cells = line => [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(m => m[1]?.replace(/""/g, '"') ?? m[2])
  const [header, ...lines] = csv.trim().split(/\r?\n/).map(cells)
  return lines.map(line => Object.fromEntries(header.map((name, i) => [name, line[i]])))
}

const places = rows(fs.readFileSync('public/data/places.csv', 'utf8'))
const byCode = new Map(places.map(place => [place.code, place]))
const byIso3 = new Map(places.filter(place => place.iso3 !== 'NA').map(place => [place.iso3, place]))

const topology = JSON.parse(fs.readFileSync(path, 'utf8'))
const shapes = topology.objects.world.geometries.filter(g => g.type !== 'Point')
const unknown = []
for (const shape of shapes) {
  const place = byCode.get(shape.id) ?? byCode.get(nonIsoIds[shape.id]) ?? byIso3.get(shape.id)
  if (place) shape.id = place.code
  else unknown.push(`${shape.id} (${shape.properties?.name})`)
}
if (unknown.length) {
  console.error(`No place for these ids: ${unknown.join(', ')}. Add them to public/data/places.csv, or to nonIsoIds.`)
  process.exit(1)
}
const shaped = new Set(shapes.map(shape => shape.id))
for (const code of Object.keys(points)) {
  if (shaped.has(code)) console.warn(`${code} has a shape now, so its point isn't needed`)
}
const pointShapes = Object.entries(points)
  .filter(([code]) => !shaped.has(code) && byCode.has(code))
  .map(([code, coordinates]) => ({ type: 'Point', coordinates, id: code, properties: { name: byCode.get(code).name } }))
topology.objects.world.geometries = [...shapes, ...pointShapes]

/**
 * JSON formatted as prettier does, so the file's diffs stay small: two space
 * indents, and a value on one line when it fits in 80 columns, except a list
 * of several lists (or objects) with several items each, which always breaks.
 */
function format (value, indent = '', key = '', comma = 0) {
  const flat = JSON.stringify(value).replace(/,(?=["{[\d-])/g, ', ').replace(/":/g, '": ').replace(/^\{(.+)\}$/, '{ $1 }')
  const size = v => Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0
  const breaks = Array.isArray(value) && value.length > 1 && value.every(v => size(v) > 1 && Array.isArray(v) === Array.isArray(value[0]))
  if (value === null || typeof value !== 'object' || (!breaks && indent.length + key.length + flat.length + comma <= 80)) return flat
  const inner = indent + '  '
  const last = (i, all) => i === all.length - 1 ? 0 : 1
  const items = Array.isArray(value)
    ? value.map((v, i, all) => inner + format(v, inner, '', last(i, all)))
    : Object.entries(value).map(([k, v], i, all) => `${inner}${JSON.stringify(k)}: ${format(v, inner, `${JSON.stringify(k)}: `, last(i, all))}`)
  return `${Array.isArray(value) ? '[' : '{'}\n${items.join(',\n')}\n${indent}${Array.isArray(value) ? ']' : '}'}`
}
fs.writeFileSync(path, format(topology) + '\n')
console.log(`${shapes.length} shapes keyed by place code, and ${pointShapes.length} points, in ${path}`)
