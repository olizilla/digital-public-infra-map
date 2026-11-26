// The editor's pages from the next release (src/NextRelease.ts, D93): the release with every changeset waiting in
// changesets/next/ replayed onto it, as the proposal check builds it. A temporary set of pending changesets, in memory
// and in a log of the test's own (never in changesets/next/), shows what each page is made from: a value that's waiting
// is "Current" and the proposal's `# was`; the released one is the note; putting a value back is an ordinary edit, which
// the check reads as pending → released; a pending new system has a page and a link in the index; a pending removal
// has its notice. With nothing pending the pages are as they were. And values with line breaks, which a text box can't
// hold, are the cleaned value from the start, so an untouched row isn't an edit and an edited one proposes the cleaned value.
// Run with: node --test src/NextRelease.test.ts
import '../scripts/site-modules.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import rootPackage from '../datapackage.json' with { type: 'json' }
import identityRows from '../public/data/2026-11-06/2026-11-06-identity.json' with { type: 'json' }
import paymentRows from '../public/data/2026-11-06/2026-11-06-payment.json' with { type: 'json' }
import exchangeRows from '../public/data/2026-11-06/2026-11-06-exchange.json' with { type: 'json' }
import { changesetFromText } from '../lib/changesets/log.ts'
import type { Changeset, DataPackage } from '../lib/changesets/types.ts'
import { proposalCheck } from '../scripts/proposal-check.ts'
import { buildIndex, editHref, placeTables } from './EditIndex.ts'
import { derivedFields } from './DpiLayer.ts'
import { checkProposal, editSpec, oneLine, proposalTOML, readiness, type EditSpec, type Proposal } from './Proposal.ts'
import type { PageData } from './NextRelease.ts'

const { changedFields, nextRelease, pagesOf, stateOf } = await import('./NextRelease.ts')
const { places, placeAliases } = await import('./Places.ts')
const { nameOf, presence } = await import('./DpiTest.ts')
const { recordOf, dpiTypeOf } = await import('../scripts/release-build.ts')

const datapackage = rootPackage as unknown as DataPackage
const released = { identity: identityRows, payment: paymentRows, exchange: exchangeRows } as Record<string, Record<string, unknown>[]>
const now = new Date('2026-11-16T12:00:00Z')
const today = '2026-11-16'

// -- the pending changesets: an update, a new system, and a removal, each as the TOML a proposal would be, in a log of the test's own --
const evidence = 'reason = "The operator’s 2026 report says so."\nsources = ["https://example.org/report-2026"]\n'
const update = (key: string, values: Record<string, string>, asOf = '2026-11-13') =>
  ['[[changes]]', 'type = "update"', `key = "${key}"`, `as_of = ${asOf}`, ...Object.entries(values).map(([id, value]) => `values.${id} = ${JSON.stringify(value)}`), evidence].join('\n')
const create = (key: string, values: Record<string, string>) =>
  ['[[changes]]', 'type = "create"', `key = "${key}"`, 'as_of = 2026-11-13', ...Object.entries(values).map(([id, value]) => `values.${id} = ${JSON.stringify(value)}`), 'reason = "Launched in 2026."\nsources = ["https://example.org/launch"]\n'].join('\n')
const remove = (key: string, duplicate?: string) =>
  ['[[changes]]', 'type = "remove"', `key = "${key}"`, 'as_of = 2026-11-13', ...(duplicate ? [`duplicate_of = "${duplicate}"`] : []), 'reason = "It was a duplicate of PesaLink 2."\nsources = ["https://example.org/dup"]\n'].join('\n')

const files: { resource: string, id: string, text: string }[] = [
  { resource: 'payment', id: '2026-11-13T100000Z-aaaa', text: update('pay-ke-01', { cross_border: 'No' }) },
  { resource: 'payment', id: '2026-11-13T110000Z-bbbb', text: [create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2', status: 'Planned/Piloted' }), update('pay-ke-03', { cross_border: 'Yes' })].join('\n') },
  { resource: 'payment', id: '2026-11-13T120000Z-cccc', text: remove('pay-ke-02', 'pay-ke-03') }
]

/** A log of the test's own with the pending changesets in it, as changesets/next/ is, and the same changesets read */
function logWith (list = files) {
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'next-release-test-'))
  const changesets: Record<string, Changeset[]> = {}
  for (const { resource, id, text } of list) {
    fs.mkdirSync(path.join(log, 'next', resource), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', resource, `${id}.toml`), text)
    const file = path.join('next', resource, `${id}.toml`)
    const changeset = changesetFromText(text, { id, resource, folder: 'next', file, path: path.join(log, file) }, [], now)!
    ;(changesets[resource] ??= []).push(changeset)
  }
  return { log, changesets }
}
const nextOf = (changesets: Record<string, Changeset[]>) => nextRelease({ datapackage, release: '2026-11-06', tables: released, changesets })

const none = nextOf({})
const { log, changesets } = logWith()
const pending = nextOf(changesets)
const pages = pagesOf(pending, released, datapackage)
const page = (id: string, list = pages): PageData => list.find(page => page.id === id)!

/** A page's spec, as the edit page makes it: from the page's row, every field but the System ID, the place and the derived ones editable */
function specOf (data: PageData): EditSpec {
  const resource = datapackage.resources.find(r => r.name === data.resource)!
  const editable = resource.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  const name = data.row.name && data.row.name !== 'NA' ? String(data.row.name) : data.id
  return editSpec(resource as never, data.row, { name, type: data.resource, country: String(data.row.country) }, editable)
}
const field = (spec: EditSpec, id: string) => spec.fields.find(f => f.id === id)!

test('with nothing pending, the next release is the release, row for row, and every system’s page is as it was', () => {
  for (const [resource, rows] of Object.entries(released)) assert.deepEqual(none.tables[resource], rows, resource)
  const list = pagesOf(none, released, datapackage)
  assert.equal(list.length, identityRows.length + paymentRows.length + exchangeRows.length)
  for (const data of list) {
    assert.equal(data.state, 'released')
    assert.deepEqual([data.changed, data.latest, data.removal], [{}, {}, undefined], data.id)
    assert.equal(data.row, none.tables[data.resource].find(row => row.system_id === data.id))
  }
  assert.equal(none.removals.size, 0)
  assert.equal(none.changesets, 0)
})

test('a pending change is the page’s value: "Current", the form’s start and the proposal’s `# was`; the released value is the note', () => {
  const ke = page('pay-ke-01')
  assert.equal(ke.state, 'released')
  assert.equal(ke.row.cross_border, 'No')
  assert.equal(ke.released!.cross_border, 'Yes')
  // the note is for the fields whose next value differs, with the release's; Last updated moves with the pending change's date
  assert.equal(ke.changed.cross_border, 'Yes')
  assert.deepEqual(Object.keys(ke.changed).filter(id => !derivedFields.includes(id)), ['cross_border'])
  assert.equal(ke.changed.last_updated, '2026-10-15')
  assert.equal(ke.row.last_updated, '2026-11-13')
  // its evidence is the pending change's, not the release's
  assert.deepEqual(ke.latest.cross_border, { changeset: '2026-11-13T100000Z-aaaa', as_of: '2026-11-13', reason: 'The operator’s 2026 report says so.', sources: ['https://example.org/report-2026'] })
  assert.equal(ke.latest.name, undefined)
  // the spec starts from the next value, and a change to it says it was that
  const spec = specOf(ke)
  assert.equal(field(spec, 'cross_border').current, 'No')
  const proposal: Proposal = { edits: [{ field: 'name', value: 'PesaLink Kenya', reason: 'Renamed.', sources: ['https://example.org/rename'], as_of: today }, { field: 'cross_border', value: 'Not Found', reason: 'Nothing found.', sources: [], as_of: today }] }
  assert.match(proposalTOML(spec, proposal), /values\.cross_border = "Not Found"  # was "No"/)
  // a system the changesets don't touch is the release's
  assert.deepEqual(page('pay-ke-02').state, 'removed')
  assert.equal(page('pay-br-01').state, 'released')
  assert.deepEqual(page('pay-br-01').changed, {})
})

test('changedFields compares cells as text, and says nothing for a new system or a removed one', () => {
  assert.deepEqual([...changedFields({ a: 1, b: 'x', c: '' }, { a: '1', b: 'y', c: undefined }, ['a', 'b', 'c'])], [['b', 'x']])
  assert.deepEqual([...changedFields(undefined, { a: '1' }, ['a'])], [])
  assert.deepEqual([...changedFields({ a: '1' }, undefined, ['a'])], [])
  assert.equal(stateOf({}, {}), 'released')
  assert.equal(stateOf(undefined, {}), 'new')
  assert.equal(stateOf({}, undefined), 'removed')
  assert.equal(stateOf(undefined, undefined), undefined)
})

test('putting a value back to its released one is an ordinary edit: the editor sees a change, and the check reads pending → released', () => {
  const ke = page('pay-ke-01')
  const proposal: Proposal = { edits: [{ field: 'cross_border', value: 'Yes', reason: 'The earlier report was wrong.', sources: ['https://example.org/correction'], as_of: '2026-11-14' }] }
  // from the release's row, the editor saw "no change"; from the next release's, it's an edit with nothing wrong
  const old = specOf({ ...ke, row: ke.released! })
  assert.deepEqual(checkProposal(old, proposal, today).map(p => p.message), ['Cross-border payments is the same as now.'])
  const spec = specOf(ke)
  assert.deepEqual(checkProposal(spec, proposal, today), [])
  assert.equal(readiness(spec, proposal, today).ready.edits.length, 1)
  // the TOML, as the editor writes it, and the check against the release and the pending changesets
  const toml = proposalTOML(spec, proposal)
  assert.match(toml, /values\.cross_border = "Yes"  # was "No"/)
  const result = proposalCheck(toml, { now, log })
  assert.deepEqual(result.problems, [])
  assert.equal(result.pending, 3)
  assert.deepEqual(result.changes.map(c => [c.key, c.field, c.old, c.new]), [['pay-ke-01', 'cross_border', 'No', 'Yes']])
  // no warning about a stale `# was` or a pending change that would win: the editor and the check agree on the live value
  assert.deepEqual(result.warnings, [])
  // from the release's page the `# was` would have said Yes, and the check, which reads the live value, would warn that it isn't
  const stale = proposalCheck(proposalTOML(old, { edits: [{ ...proposal.edits[0], value: 'Not Found' }] }), { now, log })
  assert.match(stale.warnings.join('\n'), /was “Yes” when this was proposed, and is “No” now/)
})

test('a system a pending changeset creates has an edit page, with no release to compare to, and is linked from the /edit/ index', () => {
  const created = page('pay-ke-03')
  assert.equal(created.state, 'new')
  assert.equal(created.released, undefined)
  assert.deepEqual(created.changed, {})
  assert.equal(created.row.name, 'PesaLink 2')
  assert.equal(created.row.country, 'Kenya')
  assert.equal(created.row.cross_border, 'Yes')
  // its values' evidence is the pending changes'
  assert.equal(created.latest.name.changeset, '2026-11-13T110000Z-bbbb')
  assert.deepEqual(created.latest.name.sources, ['https://example.org/launch'])
  assert.equal(specOf(created).fields.length > 0, true)
  // the index is the next release's (src/EditData.ts): it has the new row, flagged, and no row for the removed system
  const rows = pages.filter(data => data.state !== 'removed').map(data => {
    const record = recordOf(dpiTypeOf[data.resource], data.row)
    return { id: data.id, name: nameOf(dpiTypeOf[data.resource], record) ?? '', country: String(data.row.country), kind: ({ named: 0, unnamed: 1, 'not-found': 2 } as const)[presence(dpiTypeOf[data.resource], record)], pending: data.state === 'new' }
  })
  const index = buildIndex({ places, names: placeAliases, rows })
  const [, payment] = placeTables(index, 'ke')
  assert.deepEqual(payment.rows.map(row => [row.id, row.action, row.href, row.pending]), [['pay-ke-01', 'edit', editHref('pay-ke-01'), false], ['pay-ke-03', 'edit', editHref('pay-ke-03'), true]])
  assert.equal(payment.rows[1].label, 'Edit PesaLink 2')
  // a new row's page counts: the next System ID after it
  const next = buildIndex({ places, names: placeAliases, rows, used: ['pay-ke-01', 'pay-ke-02', 'pay-ke-03'] })
  assert.deepEqual(next.u ?? {}, {})
})

test('a system a pending changeset removes keeps its page, with the removal’s reason and replacement, and is out of the next release', () => {
  const gone = page('pay-ke-02')
  assert.equal(gone.state, 'removed')
  assert.equal(pending.tables.payment.some(row => row.system_id === 'pay-ke-02'), false)
  assert.equal(gone.row, gone.released)
  assert.deepEqual(gone.removal, { changeset: '2026-11-13T120000Z-cccc', as_of: '2026-11-13', reason: 'It was a duplicate of PesaLink 2.', sources: ['https://example.org/dup'], duplicate_of: 'pay-ke-03' })
  // a page each for the release's systems, one fewer for the removed one that has its page, and one more for the new one
  assert.equal(pages.length, identityRows.length + paymentRows.length + exchangeRows.length + 1)
  assert.equal(pages.filter(data => data.state === 'new').length, 1)
  assert.equal(pages.filter(data => data.state === 'removed').length, 1)
  // a pending create and remove of the same system leaves no page; a remove that a revert undoes is no removal
  const gonePending = logWith([
    { resource: 'payment', id: '2026-11-13T110000Z-bbbb', text: create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }) },
    { resource: 'payment', id: '2026-11-13T120000Z-cccc', text: remove('pay-ke-03') },
    { resource: 'payment', id: '2026-11-13T130000Z-dddd', text: remove('pay-ke-01') },
    { resource: 'payment', id: '2026-11-13T140000Z-eeee', text: `[[changes]]\ntype = "revert"\nchangeset = "2026-11-13T130000Z-dddd"\nas_of = 2026-11-14\nreason = "Mistake."\n` }
  ])
  const built = nextOf(gonePending.changesets)
  assert.equal(built.removals.size, 0)
  assert.equal(pagesOf(built, released, datapackage).length, identityRows.length + paymentRows.length + exchangeRows.length)
})

test('the removal that wins is the latest, and a removed system that comes back is a system again', () => {
  const again = logWith([
    { resource: 'payment', id: '2026-11-13T100000Z-aaaa', text: remove('pay-ke-02') },
    { resource: 'payment', id: '2026-11-14T100000Z-bbbb', text: update('pay-ke-02', { cross_border: 'No' }, '2026-11-14') }
  ])
  // an update of a removed row doesn't bring it back: only a create does, so it's still a removal
  const built = nextOf(again.changesets)
  assert.equal(built.removals.get('pay-ke-02')?.changeset, '2026-11-13T100000Z-aaaa')
  const back = logWith([
    { resource: 'payment', id: '2026-11-13T100000Z-aaaa', text: remove('pay-ke-02') },
    { resource: 'payment', id: '2026-11-14T100000Z-bbbb', text: create('pay-ke-02', { country: 'Kenya', name: 'MPesa' }).replace('2026-11-13', '2026-11-14') }
  ])
  const revived = nextOf(back.changesets)
  assert.equal(revived.removals.size, 0)
  assert.equal(pagesOf(revived, released, datapackage).find(data => data.id === 'pay-ke-02')?.state, 'released')
})

// -- values with line breaks (src/LineBreaks.test.ts) --

test('a value with a line break that a pending change replaces is the pending value, and one it leaves is cleaned', () => {
  const touched = logWith([{ resource: 'identity', id: '2026-11-13T100000Z-aaaa', text: update('id-cz-01', { governing_entity: 'Ministry of the Interior' }) }])
  const built = pagesOf(nextOf(touched.changesets), released, datapackage)
  const cz = page('id-cz-01', built)
  // the release's text has the line break, so the note says it as the cleaned line; the page's value is the pending one
  assert.equal(cz.row.governing_entity, 'Ministry of the Interior')
  assert.equal(cz.changed.governing_entity, 'Ministry of the Interior of the Czech\nRepublic')
  assert.equal(oneLine(cz.changed.governing_entity), 'Ministry of the Interior of the Czech Republic')
})
