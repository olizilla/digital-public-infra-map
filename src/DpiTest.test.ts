// What a system's Status of implementation means (src/DpiTest.ts statusOf): Not Found (researched,
// insufficient information) is kept apart from NA (no answer: not researched yet) and shown as itself,
// D61, but the DPI test counts it as NA, so it changes no system's DPI status.
// Run with: node --test src/DpiTest.test.ts
import '../scripts/site-modules.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { dpiStatus, dpiTest, presence, statusMeaning, statusOf } = await import('./DpiTest.ts')

/** A digital ID system that passes the rest of the DPI test, with this status */
const id = (status: string, more: Record<string, string> = {}) => ({ name: 'National ID', claim: 'Yes', digital_auth: 'Yes', sectoral_use_cases: 'Yes', status, ...more })
const active = (record: Record<string, string>) => dpiTest('id', record).find(c => c.field === 'status')

test('each status: how the DPI test counts it, the test card and the verdict', () => {
  const cases = [
    ['Implemented', { status: 'Active', counts: 'Active', label: 'Active', card: 'Active', pill: 'yes', reason: undefined }],
    ['Planned/Piloted', { status: 'Pilot', counts: 'Pilot', label: 'Pilot/Planned', card: 'Pilot/Planned', pill: 'wip', reason: { text: 'it isn’t active yet', after: '' } }],
    ['Suspended', { status: 'Suspended', counts: 'Suspended', label: 'Suspended', card: 'Suspended', pill: 'no', reason: { text: 'it’s suspended', after: '' } }],
    ['Not Found', { status: 'Not Found', counts: 'NA', label: 'Not Found', card: 'Not Found', pill: 'nf', reason: { text: 'there isn’t enough information on its status', after: '' } }],
    ['NA', { status: 'NA', counts: 'NA', label: 'NA', card: 'Unknown', pill: 'na', reason: { text: 'its status', after: ' isn’t recorded' } }],
  ] as const
  for (const [value, meaning] of cases) {
    const { reason, ...rest } = statusMeaning(value)
    const { reason: expected, ...expectedRest } = meaning
    assert.deepEqual(rest, expectedRest, value)
    assert.deepEqual(reason, expected, value)
  }
})

test('a record holds its status normalised, and it means the same', () => {
  for (const [value, normalised] of [['Implemented', 'Active'], ['Planned/Piloted', 'Pilot'], ['Suspended', 'Suspended'], ['Not Found', 'Not Found'], ['NA', 'NA']]) {
    assert.deepEqual(statusOf('id', { status: normalised }), statusMeaning(value), value)
  }
  assert.equal(statusMeaning(' not found ').status, 'Not Found')
  assert.equal(statusMeaning('').status, 'NA')
  assert.equal(statusMeaning(undefined).status, 'NA')
  assert.equal(statusMeaning('Inactive').counts, 'NA', 'Inactive isn’t Active')
})

test('DPI-like and in progress', () => {
  assert.equal(dpiStatus('id', id('Implemented')), 'DPI')
  assert.equal(active(id('Implemented'))?.value, 'Yes')
  // active but failing another criterion, or a pilot: in progress
  assert.equal(dpiStatus('id', id('Implemented', { claim: 'No' })), 'WIP')
  assert.equal(dpiStatus('id', id('Planned/Piloted')), 'WIP')
  assert.deepEqual([active(id('Planned/Piloted'))?.value, active(id('Planned/Piloted'))?.note], ['No', 'pilot'])
  assert.equal(dpiStatus('id', id('Suspended')), 'NA')
  assert.equal(active(id('Suspended'))?.value, 'No')
})

test('Not Found counts in the DPI test exactly as NA does', () => {
  for (const more of [{}, { claim: 'No' }, { name: 'NA' }] as Record<string, string>[]) {
    const [notFound, na] = [id('Not Found', more), id('NA', more)]
    assert.equal(dpiStatus('id', notFound), 'NA')
    assert.equal(dpiStatus('id', notFound), dpiStatus('id', na))
    assert.deepEqual(dpiTest('id', notFound), dpiTest('id', na))
    assert.equal(presence('id', notFound), presence('id', na))
  }
  // a row without a name whose status is Not Found or NA is one where the research found no system; a suspended one is a system
  assert.equal(presence('id', id('Not Found', { name: 'NA' })), 'not-found')
  assert.equal(presence('id', id('Suspended', { name: 'NA' })), 'unnamed')
  assert.equal(presence('id', id('Planned/Piloted', { name: 'NA' })), 'unnamed')
})
