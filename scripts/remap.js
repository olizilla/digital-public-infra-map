// take a topojson and add a DPI status

import slug from 'slug'
import { writeFileSync } from 'node:fs'
import features from '../public/features.json' with { type: 'json' }
import id from '../public/data/2025-03-31/2025-03-31-identity.json' with { type: 'json' }
import data from '../public/data/2025-03-31/2025-03-31-exchange.json' with { type: 'json' }
import pay from '../public/data/2025-03-31/2025-03-31-payment.json' with { type: 'json' }
import { normaliseStatus } from '../src/Status.js'

const nameMap = new Map([
  ['Democratic Republic of Congo', 'Congo'],
  ['Russia', 'Russian Federation'],
  ['United States', 'United States of America'],
  ['United Kingdom', 'United Kingdom of Great Britain and Northern Ireland'],
  ['Czechia', 'Czech Republic'],
  ['Timor', 'Timor-Leste'],
  ['Cape Verde', 'Cabo Verde'],
  ['Micronesia (country)', 'Micronesia (Federated States of)'],
  ['West Bank', 'State of Palestine'],
  // ['Western Sahara'] Morocco has claimed authority over Western Sahara since 1975, but the United Nations (UN) does not recognize Moroccan control, calling Western Sahara a “non-self-governing territory.”
])

const idMap = new Map()
id.forEach(row => {
  const country = row['Country']
  const status = row['Status of implementation']
  idMap.set(country, normaliseStatus(status))
})

const payMap = new Map()
pay.forEach(row => {
  const country = row['Country/ Region']
  const status = row['Status of payment system implementation']
  payMap.set(country, normaliseStatus(status))
})

const dataMap = new Map()
data.forEach(row => {
  const country = row['Country']
  const status = row['Status of implementation']
  dataMap.set(country, normaliseStatus(status))
})

const { geometries } = features.objects.world
const updated = geometries.map(geom => {
  const props = geom.properties
  const name = nameMap.get(props.name) ?? props.name 
  const id = idMap.get(name) ?? 'NA'
  const data = dataMap.get(name) ?? 'NA'
  const pay = payMap.get(name) ?? 'NA'
  props.status = { id, data, pay }
  props.name = name
  props.slug = slug(name)
  return geom
})

features.objects.world.geometries = updated

writeFileSync('../public/features-mod.json', JSON.stringify(features))
