// take a topojson and add a DPI status

// import process from 'node:process'
import { writeFileSync } from 'node:fs'
import features from '../public/features.json' with { type: 'json' }
import id from '../src/digital-id.json' with { type: 'json' }
import data from '../src/data-exchange.json' with { type: 'json' }

const nameMap = new Map([
  ['Democratic Republic of Congo', 'Congo'],
  ['Russia', 'Russian Federation'],
  ['United States', 'United States of America'],
  ['United Kingdom', 'United Kingdom of Great Britain and Northern Ireland'],
  ['Czechia', 'Czech Republic'],
  // ['Western Sahara'] Morocco has claimed authority over Western Sahara since 1975, but the United Nations (UN) does not recognize Moroccan control, calling Western Sahara a “non-self-governing territory.”
])

const idMap = new Map()
id.forEach(row => {
  const country = row['Country']
  const status = row['Status of implementation']
  idMap.set(country, status)
})

const dataMap = new Map()
data.forEach(row => {
  const country = row['Country']
  const status = row['Status of implementation']
  dataMap.set(country, status)
})

const { geometries } = features.objects.world
const updated = geometries.map(geom => {
  const props = geom.properties
  const name = nameMap.get(props.name) ?? props.name
  const id = idMap.get(name) ?? 'NA'
  const data = dataMap.get(name) ?? 'NA'
  props.status = { id, data }
  props.name = name
  return geom
})

features.objects.world.geometries = updated

writeFileSync('../public/features-mod.json', JSON.stringify(features))
