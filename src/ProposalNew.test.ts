// A new system's proposal (src/Proposal.ts, D91): one changeset, a create with the place and a reason, then an
// update for each field filled in, on the same key; needing no name or status, but at least one field. The
// rules, the TOML (which, without its comments, is what changesetTOML writes), which parts are ready, the
// draft link, which keeps the place and table, and that the check accepts what the form makes.
// Run with: node --test src/ProposalNew.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import rootPackage from '../datapackage.json' with { type: 'json' }
import { changesetTOML } from '../lib/changesets/draft.ts'
import { readChangeset } from '../lib/changesets/log.ts'
import { proposalCheck } from '../scripts/proposal-check.ts'
import { derivedFields } from './DpiLayer.ts'
import {
  checkProposal, decodeDraft, draftPlace, encodeDraft, issueLink, issueTitle, MAX_REASON, newSpec, notReadyText, NEEDS_A_FIELD, proposalChanges, proposalTOML, readiness,
  readyText, sendReadyText, specForPlace, totalLine, type CreateEdit, type EditSpec, type FieldEdit, type Proposal
} from './Proposal.ts'

const today = '2026-11-16'
const now = new Date('2026-11-16T12:00:00Z')
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-new-test-'))

/** A new system's form for Kenya, as the page makes it: every editable field empty */
function specFor (resource: string, key: string, code = 'ke', country = 'Kenya'): EditSpec {
  const pkg = rootPackage.resources.find(r => r.name === resource)!
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  return specForPlace(newSpec(pkg as never, { type: resource === 'payment' ? 'digital payment' : resource }, editable), { code, country, key })
}
const spec = specFor('payment', 'pay-ke-03')

const create: CreateEdit = { reason: 'A second instant payment scheme, announced by the central bank.', sources: ['https://example.org/announce'], as_of: '2026-11-10' }
const edit = (field: string, value: string, more: Partial<FieldEdit> = {}): FieldEdit => ({ field, value, reason: 'Said so in the announcement.', sources: ['https://example.org/announce'], as_of: '2026-11-10', ...more })
const errors = (proposal: Proposal, s = spec) => checkProposal(s, proposal, today).filter(problem => problem.level === 'error')
const uncommented = (text: string) => text.replace(/^# .*\n/, '')

test('a new system’s form starts empty: no current values, a place, a System ID and no way to set NA', () => {
  assert.equal(spec.isNew, true)
  assert.deepEqual([spec.key, spec.country, spec.place, spec.name], ['pay-ke-03', 'Kenya', 'ke', 'New system'])
  assert.ok(spec.fields.length > 15)
  assert.ok(spec.fields.every(field => field.current === ''))
  assert.ok(!spec.fields.some(field => ['system_id', 'country', 'last_updated', 'count_for_dpi', 'iso3'].includes(field.id)))
  assert.deepEqual(spec.missing, ['NA'])
})

test('a create and an update for each field, on the same key, as pay-cz-02 was made', () => {
  const proposal = { create, edits: [edit('status', 'Planned/Piloted'), edit('name', 'PesaLink 2', { sources: [] })] }
  assert.deepEqual(errors(proposal), [])
  const changes = proposalChanges(spec, proposal)
  // in the page's order: the name before the status
  assert.deepEqual(changes.map(change => [change.type, change.key, change.values]), [
    ['create', 'pay-ke-03', { country: 'Kenya' }], ['update', 'pay-ke-03', { name: 'PesaLink 2' }], ['update', 'pay-ke-03', { status: 'Planned/Piloted' }]
  ])
  assert.equal(proposalTOML(spec, proposal), `# PesaLink 2, Kenya
[[changes]]
type = "create"
key = "pay-ke-03"
as_of = 2026-11-10
values.country = "Kenya"
reason = "A second instant payment scheme, announced by the central bank."
sources = [
  "https://example.org/announce",
]

[[changes]]
type = "update"
key = "pay-ke-03"
as_of = 2026-11-10
values.name = "PesaLink 2"
reason = "Said so in the announcement."

[[changes]]
type = "update"
key = "pay-ke-03"
as_of = 2026-11-10
values.status = "Planned/Piloted"
reason = "Said so in the announcement."
sources = [
  "https://example.org/announce",
]
`)
  // no `# was` comments, and without the header it's what changesetTOML writes, which reads back as the same changes
  const text = proposalTOML(spec, proposal)
  assert.doesNotMatch(text, /# was/)
  assert.equal(uncommented(text), changesetTOML({ changes }))
  assert.deepEqual(readChangeset(text), readChangeset(uncommented(text)))
})

test('until it has a name its header says "New system", and the issue’s title says what kind and where', () => {
  const proposal = { create, edits: [edit('realtime_active', 'Yes')] }
  assert.match(proposalTOML(spec, proposal), /^# New system, Kenya\n\[\[changes\]\]\ntype = "create"/)
  assert.equal(issueTitle(spec, proposal), 'Proposal: New digital payment system, Kenya (pay-ke-03)')
  const named = { create, edits: [edit('name', ' PesaLink 2 ')] }
  assert.match(proposalTOML(spec, named), /^# PesaLink 2, Kenya\n/)
  assert.equal(issueTitle(spec, named), 'Proposal: PesaLink 2, Kenya (pay-ke-03)')
  const link = issueLink(spec, proposal)
  assert.equal(new URL(link.url).searchParams.get('title'), 'Proposal: New digital payment system, Kenya (pay-ke-03)')
  assert.equal(link.toml, proposalTOML(spec, proposal))
  // a place named with a newline or control characters can't end the header comment
  assert.doesNotMatch(proposalTOML({ ...spec, country: 'Ken\nya' }, proposal).split('\n')[0], /\n/)
})

test('a new system needs no name or status, but a reason for adding it and at least one field', () => {
  // a field that isn't the name or status
  assert.deepEqual(errors({ create, edits: [edit('realtime_active', 'Yes')] }), [])
  assert.deepEqual(errors({ create, edits: [edit('url', 'https://example.org/scheme')] }), [])
  // only the top section
  const [only] = errors({ create, edits: [] })
  assert.deepEqual([only.field, only.about, only.message, only.need], ['create', 'value', NEEDS_A_FIELD, 'at least one field'])
  // the top section's own evidence: a reason, up to 500 characters, optional sources that are http(s) links, a real date
  const create2 = (more: Partial<CreateEdit>) => ({ create: { ...create, ...more }, edits: [edit('realtime_active', 'Yes')] })
  assert.deepEqual(errors(create2({ reason: '  ' })).map(p => [p.field, p.about, p.message]), [['create', 'reason', 'Adding the system needs a reason.']])
  assert.deepEqual(errors(create2({ reason: 'r'.repeat(MAX_REASON) })), [])
  assert.deepEqual(errors(create2({ reason: '💸'.repeat(MAX_REASON) })), [])
  assert.equal(errors(create2({ reason: 'r'.repeat(MAX_REASON + 1) }))[0].about, 'reason')
  assert.deepEqual(errors(create2({ sources: [] })), [])
  assert.deepEqual(errors(create2({ sources: ['  https://example.org/x  '] })), [])
  assert.equal(errors(create2({ sources: ['example.org'] }))[0].about, 'sources')
  assert.equal(errors(create2({ sources: ['https://a.example.org', 'https://a.example.org'] }))[0].about, 'sources')
  assert.equal(errors(create2({ as_of: '2026-02-30' }))[0].about, 'as_of')
  assert.equal(checkProposal(spec, create2({ as_of: '2026-11-17' }), today).find(p => p.about === 'as_of')?.level, 'warning')
  // each field's own value and evidence are as on any edit page: never NA, one of the codebook's values, a reason
  assert.equal(errors({ create, edits: [edit('status', 'NA')] })[0].about, 'value')
  assert.equal(errors({ create, edits: [edit('status', 'Whenever')] })[0].about, 'value')
  assert.equal(errors({ create, edits: [edit('status', 'Implemented', { reason: '' })] })[0].about, 'reason')
  assert.equal(errors({ create, edits: [edit('status', 'Implemented'), edit('status', 'Planned/Piloted')] })[0].message, 'Status of Implementation is changed twice. Change each field once.')
  // a new system can't also be removed
  assert.ok(errors({ create, edits: [edit('status', 'Implemented')], remove: { reason: 'r', sources: [], as_of: '2026-11-10' } }).some(p => p.message === 'A new system can’t be removed in the same proposal.'))
})

test('what’s ready: the top section and at least one field; fields that aren’t are left out', () => {
  const total = (proposal: Proposal) => totalLine(readiness(spec, proposal, today))
  // nothing typed
  const none = readiness(spec, { create: { reason: '', sources: [], as_of: today }, edits: [] }, today)
  assert.deepEqual(none.ready, { edits: [] })
  assert.equal(totalLine(none), 'Nothing ready yet. Give a reason for adding it, then fill in at least one field.')
  assert.equal(readyText(none), 'nothing ready yet')
  // a reason, no field
  assert.equal(total({ create, edits: [] }), 'Nothing ready yet. Fill in at least one field.')
  // a field, but no reason for the system
  const noReason = readiness(spec, { create: { ...create, reason: '' }, edits: [edit('status', 'Implemented')] }, today)
  assert.deepEqual(noReason.ready, { edits: [] })
  assert.equal(totalLine(noReason), 'Nothing ready yet · the new system still needs a reason')
  // both
  const ready = readiness(spec, { create, edits: [edit('status', 'Implemented'), edit('url', 'https://example.org/scheme')] }, today)
  assert.deepEqual(ready.ready.create, create)
  assert.equal(ready.ready.edits.length, 2)
  assert.equal(totalLine(ready), '2 fields ready')
  assert.equal(readyText(ready), '2 fields ready')
  // a field with no reason is left out, and the confirmation says so
  const some = readiness(spec, { create, edits: [edit('status', 'Implemented'), edit('url', 'https://example.org/scheme', { reason: '' })] }, today)
  assert.deepEqual(some.ready.edits.map(e => e.field), ['status'])
  assert.equal(totalLine(some), '1 field ready · 1 field needs a reason')
  assert.equal(notReadyText(some), `1 change isn’t ready and won’t be sent: ${spec.fields.find(f => f.id === 'url')!.title} needs a reason.`)
  assert.equal(sendReadyText(some), 'Send the new system with its ready field')
  // fields with no reason, and nothing to send
  const stuck = readiness(spec, { create, edits: [edit('status', 'Implemented', { reason: '' })] }, today)
  assert.deepEqual(stuck.ready, { edits: [] })
  assert.equal(totalLine(stuck), 'Nothing ready yet · 1 field needs a reason')
  // only what's ready is in the TOML
  assert.match(proposalTOML(spec, ready.ready), /^# New system, Kenya\n/)
  assert.equal(proposalChanges(spec, ready.ready).length, 3)
})

test('a draft link keeps the place and the table, and a reason for adding it, and not the System ID', async () => {
  const proposal = { create, edits: [edit('status', 'Planned/Piloted')] }
  const text = await encodeDraft(spec, proposal)
  assert.deepEqual(await draftPlace(text), { place: 'ke', resource: 'payment' })
  const restored = await decodeDraft(spec, text)
  assert.deepEqual(restored, { ok: true, proposal, ignored: [] })
  // the System ID is the page's suggestion on the day it's opened
  const later = specFor('payment', 'pay-ke-04')
  assert.deepEqual(await decodeDraft(later, text), { ok: true, proposal, ignored: [] })
  assert.deepEqual(await decodeDraft(spec, await encodeDraft(spec, proposal, false)), { ok: true, proposal, ignored: [] })
  // another place, or another table, or one for a system that already exists, restores nothing
  const other = await decodeDraft(specFor('payment', 'pay-ng-01', 'ng', 'Nigeria'), text)
  assert.deepEqual(other, { ok: false, message: 'This draft link is for another place, so nothing was restored.' })
  const identity = await decodeDraft(specFor('identity', 'id-ke-02'), text)
  assert.equal(identity.ok, false)
  assert.match((identity as { message: string }).message, /another kind of system/)
  const system = await decodeDraft({ ...spec, isNew: undefined, key: 'pay-ke-01' }, text)
  assert.equal(system.ok, false)
  // a draft of just the reason, with no field yet, restores it
  const reason = await decodeDraft(spec, await encodeDraft(spec, { create, edits: [] }))
  assert.deepEqual(reason, { ok: true, proposal: { create, edits: [] }, ignored: [] })
  // a draft with nothing in it, a value the form wouldn't allow and garbage
  assert.equal((await decodeDraft(spec, await encodeDraft(spec, { create: { reason: '', sources: [], as_of: today }, edits: [] }))).ok, false)
  const bad = await decodeDraft(spec, await encodeDraft(spec, { create, edits: [edit('status', 'Whenever'), edit('url', 'https://example.org/scheme')] }))
  assert.deepEqual(bad.ok && [bad.proposal.edits.map(e => e.field), bad.ignored], [['url'], ['Status of Implementation']])
  assert.equal((await decodeDraft(spec, 'z.garbage!!')).ok, false)
  assert.equal(await draftPlace('z.garbage!!'), undefined)
  // a system's own draft has no place to open a new form at
  assert.equal(await draftPlace(await encodeDraft({ ...spec, isNew: undefined, key: 'pay-ke-01' }, { edits: [edit('status', 'Implemented')] })), undefined)
})

test('what the form makes is accepted by the check as one new system, whether or not it has a name or status', () => {
  const log = empty
  const check = (proposal: Proposal) => proposalCheck(proposalTOML(spec, proposal), { now, log })
  const named = check({ create, edits: [edit('name', 'PesaLink 2'), edit('status', 'Planned/Piloted')] })
  assert.deepEqual(named.problems, [])
  assert.equal(named.applies, true)
  assert.equal(named.resource, 'payment')
  // no name or status: only the indicators and a legal field
  const unnamed = check({ create, edits: [edit('interoperability_policy', 'Yes'), edit('qr_code', 'No')] })
  assert.deepEqual(unnamed.problems, [])
  assert.equal(unnamed.applies, true)
  // only the top section is the editor's refusal, and the check's too
  const top = proposalCheck(proposalTOML(spec, { create, edits: [] }), { now, log })
  assert.equal(top.applies, false)
  assert.deepEqual(top.problems, [`“pay-ke-03”: ${NEEDS_A_FIELD}`])
})
