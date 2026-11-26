// The editor's index (src/EditIndex.ts, D91): the next System ID, what's embedded in /edit/ and /edit/new/<table>/,
// searching it, and what each place's table offers: fill in a row with no name, edit a named system, or add one.
// Run with: node --test src/EditIndex.test.ts
import '../scripts/site-modules.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import identityRows from '../public/data/2026-11-06/2026-11-06-identity.json' with { type: 'json' }
import paymentRows from '../public/data/2026-11-06/2026-11-06-payment.json' with { type: 'json' }
import exchangeRows from '../public/data/2026-11-06/2026-11-06-exchange.json' with { type: 'json' }
import rootPackage from '../datapackage.json' with { type: 'json' }
import {
  buildIndex, findPlace, highestNumbers, indexFor, newHref, nextFreeId, nextSystemId, parseId, placeNames, placeTables, rowsOf, search, tables, typeIds, unnamedRows, usedIds,
  type EditIndex, type IndexInput, type Kind
} from './EditIndex.ts'

const { places, placeAliases } = await import('./Places.ts')
const { resourceNames } = await import('./Schema.ts')
const { nouns, presence } = await import('./DpiTest.ts')
const { recordOf } = await import('../scripts/release-build.ts')

type Row = IndexInput['rows'][number]
const row = (id: string, more: Partial<Row> = {}): Row => ({ id, name: 'A system', country: 'Kenya', kind: 0, pending: false, ...more })
const fixtureInput = (rows: Row[]): IndexInput => ({
  places: [{ code: 'ke', name: 'Kenya', parent: 'africa' }, { code: 'africa', name: 'Africa', parent: 'world' }, { code: 'lac', name: 'Latin America and the Caribbean' }, { code: 'europe', name: 'Europe' }, { code: 'cz', name: 'Czechia', parent: 'europe' }, { code: 'ng', name: 'Nigeria' }],
  names: [{ dpimap_name: 'Czech Republic', code: 'cz' }],
  rows
})
const fixture = (rows: Row[]): EditIndex => buildIndex(fixtureInput(rows))

test('the next System ID is one more than the highest used, with two digits', () => {
  assert.equal(nextSystemId(fixture([]), 'pay', 'ke'), 'pay-ke-01')
  assert.equal(nextSystemId(fixture([row('pay-ke-01'), row('pay-ke-02')]), 'pay', 'ke'), 'pay-ke-03')
  assert.equal(nextSystemId(fixture([row('pay-ke-08')]), 'pay', 'ke'), 'pay-ke-09')
  assert.equal(nextSystemId(fixture([row('pay-ke-09')]), 'pay', 'ke'), 'pay-ke-10')
  // more than two digits when it has to be, as the System ID's pattern allows
  assert.equal(nextSystemId(fixture([row('pay-ke-99')]), 'pay', 'ke'), 'pay-ke-100')
})

test('a gap is left alone: a number that’s gone isn’t used again', () => {
  assert.equal(nextSystemId(fixture([row('pay-ng-01'), row('pay-ng-03')]), 'pay', 'ng'), 'pay-ng-04')
  assert.equal(nextSystemId(fixture([row('pay-ng-02')]), 'pay', 'ng'), 'pay-ng-03')
})

test('a system waiting in changesets/next/ counts, so two proposals don’t suggest the same ID', () => {
  const index = fixture([row('pay-ke-01'), row('pay-ke-02', { pending: true }), row('pay-ke-03', { pending: true, name: '', kind: 2 })])
  assert.equal(nextSystemId(index, 'pay', 'ke'), 'pay-ke-04')
})

test('a removed system’s number is never used again: the highest ever used, not the highest row, sets the next ID (D82)', () => {
  // pay-ke-03 was removed, in a release or pending: no row has it, but a change or an earlier release does
  const rows = [row('pay-ke-01'), row('pay-ke-02')]
  const used = usedIds([{ key: 'pay-ke-03' }, { key: 'pay-ke-01' }, { key: 'pay-ng-02' }, { key: 'not an id' }, {}], ['pay-ke-01', 'pay-ke-02', 'id-ke-01'])
  assert.deepEqual([...used].sort(), ['id-ke-01', 'pay-ke-01', 'pay-ke-02', 'pay-ke-03', 'pay-ng-02'])
  const index = buildIndex({ ...fixtureInput(rows), used })
  assert.deepEqual(index.u, { 'pay-ke': 3, 'id-ke': 1, 'pay-ng': 2 })
  assert.equal(nextSystemId(index, 'pay', 'ke'), 'pay-ke-04')
  // a place with no row at all, whose only system was removed
  assert.equal(nextSystemId(index, 'pay', 'ng'), 'pay-ng-03')
  assert.equal(nextSystemId(index, 'id', 'ke'), 'id-ke-02')
  assert.equal(nextSystemId(index, 'id', 'ng'), 'id-ng-01')
  // only what the rows don't already show is kept, so the index stays small, and a table's own index keeps its own
  assert.equal(buildIndex({ ...fixtureInput(rows), used: ['pay-ke-01', 'pay-ke-02'] }).u, undefined)
  assert.deepEqual(indexFor(index, ['id']).u, { 'id-ke': 1 })
  assert.deepEqual(indexFor(index, ['pay']).u, { 'pay-ke': 3, 'pay-ng': 2 })
  assert.equal(nextSystemId(indexFor(index, ['pay']), 'pay', 'ke'), 'pay-ke-04')
  // a pending row above the removed one wins, and a removed one above a gap does
  assert.equal(nextSystemId(buildIndex({ ...fixtureInput([...rows, row('pay-ke-05', { pending: true })]), used }), 'pay', 'ke'), 'pay-ke-06')
  assert.equal(nextFreeId(used, 'pay', 'ke'), 'pay-ke-04')
  assert.equal(nextFreeId(used, 'dx', 'lac'), 'dx-lac-01')
  assert.equal(highestNumbers(['pay-lac-04', 'pay-lac-02']).get('pay-lac'), 4)
})

test('regions, other tables and other places are counted apart', () => {
  const index = fixture([row('pay-lac-04'), row('id-lac-01'), row('pay-la-07'), row('id-europe-01'), row('dx-europe-02'), row('pay-ke-05'), row('dx-ke-03'), row('id-ke-02')])
  assert.equal(nextSystemId(index, 'pay', 'lac'), 'pay-lac-05')
  assert.equal(nextSystemId(index, 'id', 'lac'), 'id-lac-02')
  assert.equal(nextSystemId(index, 'dx', 'lac'), 'dx-lac-01')
  assert.equal(nextSystemId(index, 'id', 'europe'), 'id-europe-02')
  assert.equal(nextSystemId(index, 'dx', 'europe'), 'dx-europe-03')
  assert.equal(nextSystemId(index, 'pay', 'europe'), 'pay-europe-01')
  assert.equal(nextSystemId(index, 'pay', 'ke'), 'pay-ke-06')
  assert.equal(nextSystemId(index, 'dx', 'ke'), 'dx-ke-04')
  assert.equal(nextSystemId(index, 'id', 'ke'), 'id-ke-03')
  assert.deepEqual(parseId('pay-lac-04'), { type: 'pay', place: 'lac', number: 4 })
  assert.equal(parseId('pay-lac'), undefined)
})

test('the index has each place’s name as the data uses it, its other names, its region and each row’s kind', () => {
  const index = fixture([row('pay-ke-01'), row('pay-ke-02', { name: '', kind: 2, pending: true }), row('pay-cz-01', { country: 'Czech Republic' }), row('pay-cz-02', { country: 'Czech Republic', name: '', kind: 1 })])
  assert.deepEqual(index.p.find(p => p[0] === 'cz'), ['cz', 'Czech Republic', 'europe', 'Czechia'])
  assert.deepEqual(index.p.find(p => p[0] === 'ke'), ['ke', 'Kenya', 'africa'])
  // no row, so the first name place-names.csv gives it, or else places.csv's
  assert.equal(buildIndex({ places: [{ code: 'cz', name: 'Czechia' }], names: [{ dpimap_name: 'Czech Republic', code: 'cz' }], rows: [] }).p[0][1], 'Czech Republic')
  assert.equal(findPlace(index, 'ng')![1], 'Nigeria')
  // the name its rows use wins, as the most common one
  assert.equal(buildIndex({ places: [{ code: 'lac', name: 'Latin America and the Caribbean' }], names: [{ dpimap_name: 'Caribbean', code: 'lac' }], rows: [row('pay-lac-01', { country: 'Latin America and the Caribbean' })] }).p[0][1], 'Latin America and the Caribbean')
  assert.deepEqual(index.r, [['pay-ke-01', 'A system', 0], ['pay-ke-02', '', 2, 1], ['pay-cz-01', 'A system', 0], ['pay-cz-02', '', 1]])
  assert.deepEqual(placeNames(index, findPlace(index, 'ke')!), { name: 'Kenya', region: 'Africa' })
  assert.equal(findPlace(index, 'zz'), undefined)
  assert.equal(findPlace(index, null), undefined)
  // a table's own index keeps the places and only its rows
  assert.deepEqual(indexFor(index, ['pay']).r.length, 4)
  assert.deepEqual(indexFor(fixture([row('pay-ke-01'), row('id-ke-01')]), ['id']).r, [['id-ke-01', 'A system', 0]])
})

test('a place’s table: fill in a row with no name, edit a named system, add another, or add the first', () => {
  const index = fixture([
    row('pay-ke-01'), row('pay-ke-02', { name: 'PesaLink' }),
    row('id-ke-01', { name: '', kind: 2 }),
    row('dx-ke-01', { name: '', kind: 1 }), row('dx-ke-02'),
    row('pay-ng-01', { name: '', kind: 2, pending: true, country: 'Nigeria' })
  ])
  const [id, pay, dx] = placeTables(index, 'ke')
  assert.deepEqual(pay.rows.map(r => [r.action, r.label, r.href]), [['edit', 'Edit A system', '/pay-ke-01/edit/'], ['edit', 'Edit PesaLink', '/pay-ke-02/edit/']])
  assert.deepEqual(pay.add, { label: 'Add another digital payment system', href: '/edit/new/payment/?place=ke', secondary: false })
  // only a row with no name: filling it in is the main action, and adding a system a smaller one
  assert.deepEqual(id.rows.map(r => [r.action, r.label, r.href]), [['fill', 'Fill in id-ke-01', '/id-ke-01/edit/']])
  assert.deepEqual(id.add, { label: 'A different system? Add a new one', href: '/edit/new/identity/?place=ke', secondary: true })
  // a row with no name beside a named one is still filled in
  assert.deepEqual(dx.rows.map(r => r.action), ['fill', 'edit'])
  assert.equal(dx.add.secondary, true)
  // no row
  const none = placeTables(index, 'cz')
  assert.deepEqual(none.map(t => [t.label, t.add.label, t.add.href, t.add.secondary]), [
    ['Digital ID', 'Add a digital ID system', '/edit/new/identity/?place=cz', false],
    ['Digital payment', 'Add a digital payment system', '/edit/new/payment/?place=cz', false],
    ['Data exchange', 'Add a data exchange system', '/edit/new/exchange/?place=cz', false]
  ])
  // a pending row has an edit page like any (D93): its row with no name is filled in, and another system can be added
  const [, ngPay] = placeTables(index, 'ng')
  assert.deepEqual(ngPay.rows.map(r => [r.action, r.href, r.pending]), [['fill', '/pay-ng-01/edit/', true]])
  assert.deepEqual([ngPay.add.label, ngPay.add.secondary], ['A different system? Add a new one', true])
  assert.equal(newHref('dx', 'lac'), '/edit/new/exchange/?place=lac')
})

test('the rows with no name in a table, to say to fill one in instead', () => {
  const index = fixture([row('pay-ke-01'), row('pay-ke-02', { name: '', kind: 2 }), row('pay-ke-03', { name: '', kind: 1, pending: true }), row('id-ke-01', { name: '', kind: 2 })])
  assert.deepEqual(unnamedRows(index, 'pay', 'ke'), [{ id: 'pay-ke-02', name: '', kind: 2, pending: false }, { id: 'pay-ke-03', name: '', kind: 1, pending: true }])
  assert.deepEqual(unnamedRows(index, 'dx', 'ke'), [])
  assert.deepEqual(rowsOf(index, 'pay', 'ke').map(r => r[0]), ['pay-ke-01', 'pay-ke-02', 'pay-ke-03'])
})

test('search finds places by any of their names, systems by name or System ID, without capitals or accents', () => {
  const index = fixture([row('pay-ke-01', { name: 'PesaLink' }), row('pay-ke-02', { name: 'Mobile Pésa' }), row('id-cz-01', { name: 'Czech eID', country: 'Czech Republic' }), row('pay-ng-01', { name: '', kind: 2, country: 'Nigeria' })])
  const placeCodes = (text: string) => search(index, text).places.map(hit => hit.place[0])
  assert.deepEqual(placeCodes('kenya'), ['ke'])
  assert.deepEqual(placeCodes('KEN'), ['ke'])
  assert.deepEqual(placeCodes('czechia'), ['cz'])
  assert.deepEqual(placeCodes('Czech Rep'), ['cz'])
  assert.deepEqual(placeCodes('latin'), ['lac'])
  assert.deepEqual(placeCodes('ke'), ['ke'])
  assert.deepEqual(placeCodes('x'), [])
  assert.deepEqual(placeCodes(''), [])
  assert.deepEqual(placeCodes('atlantis'), [])
  const ids = (text: string) => search(index, text).systems.map(hit => hit.row[0])
  assert.deepEqual(ids('pay-ke-01'), ['pay-ke-01'])
  assert.deepEqual(ids('pay-ke'), ['pay-ke-01', 'pay-ke-02'])
  assert.deepEqual(ids('pesa'), ['pay-ke-01', 'pay-ke-02'])
  assert.deepEqual(ids('mobile pesa'), ['pay-ke-02'])
  assert.deepEqual(ids('ID-CZ'), ['id-cz-01'])
  assert.deepEqual(ids('nobody'), [])
  // a place and a system can both match
  assert.deepEqual(placeCodes('czech'), ['cz'])
  assert.deepEqual(ids('czech'), ['id-cz-01'])
  const many = fixture(Array.from({ length: 30 }, (_, i) => row(`pay-ke-${String(i + 1).padStart(2, '0')}`)))
  const found = search(many, 'pay-ke')
  assert.equal(found.systems.length, 12)
  assert.equal(found.more, 18)
})

test('the tables are the site’s: resource, noun and System ID prefix', () => {
  const dataPackageIds = Object.fromEntries(rootPackage.resources.filter(r => r.schema.fields.some(f => f.name === 'system_id')).map(r => [r.name, (r.schema.fields.find(f => f.name === 'system_id')!.constraints as { pattern: string }).pattern.split('-')[0]]))
  const byType = { id: 'id', pay: 'pay', data: 'dx' } as const
  for (const [dpiType, prefix] of Object.entries(byType)) {
    const table = tables[prefix]
    assert.equal(table.resource, resourceNames[dpiType as keyof typeof resourceNames], prefix)
    assert.equal(table.noun, nouns[dpiType as keyof typeof nouns], prefix)
    assert.equal(dataPackageIds[table.resource], prefix)
  }
  assert.deepEqual(typeIds, ['id', 'pay', 'dx'])
})

/** The release's rows as the page makes the index from them */
const released = [['id', identityRows], ['pay', paymentRows], ['dx', exchangeRows]] as const
const real = buildIndex({
  places,
  names: placeAliases,
  rows: released.flatMap(([prefix, rows]) => (rows as Record<string, any>[]).map(row => {
    const dpiType = ({ id: 'id', pay: 'pay', dx: 'data' } as const)[prefix]
    const kind = { named: 0, unnamed: 1, 'not-found': 2 }[presence(dpiType, recordOf(dpiType, row) as never)] as Kind
    return { id: row.system_id, name: row.name === 'NA' ? '' : row.name, country: row.country, kind, pending: false }
  }))
})

test('the real index is small: every place and system of the release, under 10 KB gzipped', () => {
  assert.equal(real.p.length, places.length)
  assert.equal(real.r.length, identityRows.length + paymentRows.length + exchangeRows.length)
  const gzipped = zlib.gzipSync(JSON.stringify(real)).length
  assert.ok(gzipped < 10_000, `${gzipped} bytes gzipped`)
})

test('the real index uses the data’s names for places, and every row’s place is one it has', () => {
  const names = new Map(real.p.map(place => [place[0], place[1]]))
  for (const rows of [identityRows, paymentRows, exchangeRows] as Record<string, any>[][]) {
    for (const r of rows) {
      const place = parseId(r.system_id)!.place
      assert.ok(names.has(place), r.system_id)
      assert.equal(names.get(place), r.country === names.get(place) ? r.country : names.get(place))
    }
  }
  assert.equal(names.get('cz'), 'Czech Republic')
  assert.equal(names.get('ke'), 'Kenya')
  assert.equal(names.get('lac'), 'Latin America and the Caribbean')
  // a place with no rows is named as places.csv does, or place-names.csv
  const noRows = real.p.find(place => !real.r.some(([id]) => parseId(id)!.place === place[0]))!
  assert.ok(noRows[1])
  assert.deepEqual(search(real, 'czechia').places.map(hit => hit.place[0]), ['cz'])
  assert.deepEqual(search(real, 'czech republic').places.map(hit => hit.place[0]), ['cz'])
})

test('Eritrea’s only payment row has no name, so it’s filled in; Kenya’s are named, so another can be added; a place with none can add one', () => {
  const er = placeTables(real, 'er').find(t => t.type === 'pay')!
  assert.deepEqual(er.rows.map(r => [r.id, r.action, r.label]), [['pay-er-01', 'fill', 'Fill in pay-er-01']])
  assert.deepEqual(er.add, { label: 'A different system? Add a new one', href: '/edit/new/payment/?place=er', secondary: true })
  const ke = placeTables(real, 'ke').find(t => t.type === 'pay')!
  assert.ok(ke.rows.length >= 1 && ke.rows.every(r => r.action === 'edit'))
  assert.equal(ke.add.label, 'Add another digital payment system')
  assert.equal(nextSystemId(real, 'pay', 'ke'), `pay-ke-${String(ke.rows.length + 1).padStart(2, '0')}`)
  const none = real.p.find(place => !real.r.some(([id]) => parseId(id)!.type === 'pay' && parseId(id)!.place === place[0]))!
  assert.equal(placeTables(real, none[0]).find(t => t.type === 'pay')!.add.label, 'Add a digital payment system')
  assert.equal(nextSystemId(real, 'pay', none[0]), `pay-${none[0]}-01`)
  // a System ID and a system’s name
  assert.deepEqual(search(real, 'pay-er-01').systems.map(hit => hit.row[0]), ['pay-er-01'])
  assert.ok(search(real, 'pesalink').systems.some(hit => hit.row[0] === 'pay-ke-01'))
})
