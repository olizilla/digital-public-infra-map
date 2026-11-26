// The Evidence sheet's rows and the Fields sheet's definitions (src/Evidence.ts, D97): one row for each source of
// each current value that isn't NA, a blank row for a value with none, no derived fields, and the system page's
// sources and dates, which come from historyFor and sourcesFor (src/Systems.ts). The workbook is built from these.
// Run with: node --test src/Evidence.test.ts
import '../scripts/site-modules.ts'
import './test/astroContent.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { allowedValuesOf, cellValue, columnsOf, definitionOf, dpiTypes, evidenceRows } = await import('./Evidence.ts')
const { systems, historyFor, sourcesFor } = await import('./Systems.ts')
const { releaseTables } = await import('./ReleaseFiles.ts')
const { changeTitles, resourceNames, schemas } = await import('./Schema.ts')
const { changesetRelease } = await import('./Release.ts')
const { derivedFields } = await import('./DpiLayer.ts')

const rows = evidenceRows()
const byClaim = Map.groupBy(rows, row => row.claim)
const systemOf = (id: string) => systems.find(system => system.id === id)!
const sheetValue = (id: string, fieldId: string) => {
  const system = systemOf(id)
  const field = schemas[system.dpiType].fields.find(field => field.id === fieldId)!
  return releaseTables[resourceNames[system.dpiType]].find(row => row.system_id === id)![field.name]
}

test('a row for each source of each value that has a value, and one with no source for a value with none', () => {
  let values = 0
  let expected = 0
  let unsourced = 0
  for (const dpiType of dpiTypes) {
    const table = releaseTables[resourceNames[dpiType]]
    for (const row of table) {
      for (const name of columnsOf(table)) {
        if (['system_id', 'country', ...derivedFields].includes(name)) continue
        const value = row[name]
        if (value === undefined || value === null || value === 'NA' || value === '') continue
        const system = systemOf(row.system_id)
        const sources = sourcesFor(system, name)
        values++
        expected += Math.max(1, sources.length)
        if (!sources.length) unsourced++
        assert.equal(byClaim.get(`${row.system_id}/${name}`)?.length, Math.max(1, sources.length), `${row.system_id}/${name}`)
      }
    }
  }
  assert.equal(byClaim.size, values)
  assert.equal(rows.length, expected)
  assert.equal(rows.filter(row => row.source === '').length, unsourced)
  assert.ok(unsourced > 0 && rows.length > values, 'the release has values with no source, and values with several')
})

test('NA and empty values have no rows, and Not Found is a value', () => {
  assert.ok(rows.every(row => row.value !== 'NA' && String(row.value).trim() !== ''))
  assert.ok(rows.some(row => row.value === 'Not Found'))
  // a system's NA field has no claim
  const na = releaseTables.payment.find(row => row.status === 'NA')
  if (na) assert.equal(byClaim.has(`${na.system_id}/status`), false)
})

test('the System ID, the place and the derived fields have no rows', () => {
  for (const id of ['system_id', 'country', ...derivedFields]) assert.equal(rows.filter(row => row.claim.endsWith(`/${id}`)).length, 0, id)
})

test('a value with two sources has two rows, in its history order, with the same date and reason', () => {
  const claim = [...byClaim].find(([, group]) => group.length === 2)
  assert.ok(claim)
  const [id, fieldId] = claim[0].split('/')
  const sources = sourcesFor(systemOf(id), fieldId)
  assert.equal(sources.length, 2)
  assert.deepEqual(claim[1].map(row => row.source), sources)
  assert.equal(claim[1][0].asOf, claim[1][1].asOf)
  assert.equal(claim[1][0].reason, claim[1][1].reason)
})

test('every row has the date and sources the system page shows for its value', () => {
  for (const [claim, group] of byClaim) {
    const [id, fieldId] = claim.split('/')
    const system = systemOf(id)
    const last = historyFor(system, fieldId).at(-1)!
    const sources = sourcesFor(system, fieldId)
    assert.deepEqual(group.map(row => row.source), sources.length ? sources : [''], claim)
    for (const row of group) {
      assert.equal(row.asOf, last.as_of, claim)
      assert.match(row.asOf, /^\d{4}-\d{2}-\d{2}$/, claim)
      assert.equal(row.value, sheetValue(id, fieldId), claim)
    }
  }
})

test('a value only in the 31 Mar sheet is dated by its row\'s Last updated, with a short reason', () => {
  const claim = [...byClaim.keys()].find(claim => {
    const [id, fieldId] = claim.split('/')
    const history = historyFor(systemOf(id), fieldId)
    return history.length === 1 && history[0].type === 'snapshot'
  })!
  const [id, fieldId] = claim.split('/')
  const [row] = byClaim.get(claim)!
  assert.equal(row.reason, 'From the 31 Mar 2026 release')
  assert.equal(row.asOf, historyFor(systemOf(id), fieldId)[0].as_of)
  assert.ok(historyFor(systemOf(id), fieldId)[0].reason.length > row.reason.length)
})

test('a value restated in 2026-11-06 has that change\'s date, reason and sources', () => {
  const claim = [...byClaim.keys()].find(claim => {
    const [id, fieldId] = claim.split('/')
    const system = systemOf(id)
    const history = historyFor(system, fieldId)
    const last = history.at(-1)!
    return history.length > 1 && last.type === 'update' && !last.valueChanged && changesetRelease(system.resource, last.changeset) === '2026-11-06'
  })
  assert.ok(claim, 'the release restates some value')
  const [id, fieldId] = claim.split('/')
  const system = systemOf(id)
  const history = historyFor(system, fieldId)
  const last = history.at(-1)!
  for (const row of byClaim.get(claim)!) {
    assert.equal(row.asOf, last.as_of)
    assert.notEqual(row.asOf, history[0].as_of)
    assert.equal(row.reason, last.reason.trim().replace(/\s*\n\s*/g, ' '))
    assert.ok(row.reason !== 'From the 31 Mar 2026 release')
  }
  assert.deepEqual(byClaim.get(claim)!.map(row => row.source), sourcesFor(system, fieldId).length ? sourcesFor(system, fieldId) : [''])
})

test('a claim links to its field on the system page, and a field to its codebook page', () => {
  const row = rows.find(row => row.claim.startsWith('pay-') && row.claim.endsWith('/operator'))!
  const [id] = row.claim.split('/')
  assert.equal(row.claimHref, `https://dpimap.org/${id}/#f-operator`)
  assert.equal(row.fieldHref, 'https://dpimap.org/codebook/payment/operator/')
  assert.equal(row.field, 'Operator')
  assert.equal(row.table, changeTitles.pay)
  assert.equal(row.place, sheetValue(id, 'country'))
  const links = rows.filter(row => !/^https:\/\/dpimap\.org\/[\w-]+\/#f-\w+$/.test(row.claimHref) || !/^https:\/\/dpimap\.org\/codebook\/(identity|payment|exchange)\/\w+\/$/.test(row.fieldHref))
  assert.equal(links.length, 0)
})

test('an unnamed system is NA, a named one has its name, and the tables are in sheet order', () => {
  const rowsOf = (id: string) => rows.filter(row => row.claim.startsWith(`${id}/`))
  const unnamed = releaseTables.payment.find(row => (row.name ?? 'NA') === 'NA' && rowsOf(row.system_id).length)!
  assert.ok(unnamed)
  assert.ok(rowsOf(unnamed.system_id).every(row => row.system === 'NA'))
  const named = releaseTables.identity.find(row => row.name && row.name !== 'NA')!
  assert.ok(rowsOf(named.system_id).every(row => row.system === named.name))
  const tables = [...new Set(rows.map(row => row.table))]
  assert.deepEqual(tables, dpiTypes.map(dpiType => changeTitles[dpiType]))
  assert.deepEqual(rows.map(row => row.table), [...rows.map(row => row.table)].sort((a, b) => tables.indexOf(a) - tables.indexOf(b)))
})

test('a value is as the table sheet has it: a number is a number, the rest text', () => {
  assert.equal(cellValue(3), 3)
  assert.equal(cellValue('Yes'), 'Yes')
  assert.equal(cellValue(undefined), 'NA')
  assert.equal(cellValue(null), 'NA')
  assert.equal(cellValue(['a']), '["a"]')
})

test('the Fields sheet has each field\'s definition and its allowed values, blank for free text', () => {
  const field = (dpiType: 'id' | 'pay' | 'data', id: string) => schemas[dpiType].fields.find(field => field.id === id)!
  assert.match(definitionOf('pay', field('pay', 'operator')), /operator/i)
  assert.match(allowedValuesOf('pay', field('pay', 'operator')), /^Central bank, .*, Not Found$/)
  assert.equal(allowedValuesOf('id', field('id', 'claim')), 'Yes, No, Not Found')
  assert.equal(allowedValuesOf('pay', field('pay', 'name')), '')
  assert.equal(allowedValuesOf('pay', field('pay', 'transaction_types')), 'P2P, B2B, P2M, B2P, G2P, B2G, Other, Not Found')
  assert.match(allowedValuesOf('data', field('data', 'sectoral')), /Cross-sectoral/)
  for (const dpiType of dpiTypes) for (const f of schemas[dpiType].fields) assert.equal(typeof definitionOf(dpiType, f), 'string')
})
