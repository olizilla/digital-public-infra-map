// take a topojson and add a DPI status

import slug from 'slug'
import { writeFileSync } from 'node:fs'
import features from '../public/features.json' with { type: 'json' }
import id from '../public/data/2024-11-19.identity.json' with { type: 'json' }
import data from '../public/pages/data/2024-11-19.exchange.json' with { type: 'json' }
import pay from '../public/pages/data/2024-11-19.payment.json' with { type: 'json' }

export function fixStatus(raw) {
  if (!raw) return 'Unknown'
  if (raw.match(/Operating at scale/i)) return 'Active'
  if (raw.match(/Planned/i)) return 'Plan'
  return 'Unknown'
}

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

const payMap = new Map()
pay.forEach(row => {
  const country = row['Country/ Region']
  const status = fixStatus(row['Status of payment system implementation'])
  payMap.set(country, status)
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
  const pay = payMap.get(name) ?? 'NA'
  props.status = { id, data, pay }
  props.name = name
  props.slug = slug(name)
  return geom
})

features.objects.world.geometries = updated

writeFileSync('../public/features-mod.json', JSON.stringify(features))
