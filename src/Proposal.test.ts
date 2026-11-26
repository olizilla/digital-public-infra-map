// The editor's proposals (src/Proposal.ts, D86): the changeset TOML they make, which, without its
// comments (D87), must be what changesetTOML (lib/changesets/draft.ts) writes for the same changes, and the checks before the
// issue opens: a reason and a source for every change (D78), only allowed values, never NA (D73),
// and a warning, not an error, for an evidence date after today (D85), and which changes are ready to
// send, with the receipt's words for them.
// Run with: node --test src/Proposal.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import rootPackage from '../datapackage.json' with { type: 'json' }
import identityRows from '../public/data/2026-11-06/2026-11-06-identity.json' with { type: 'json' }
import paymentRows from '../public/data/2026-11-06/2026-11-06-payment.json' with { type: 'json' }
import exchangeRows from '../public/data/2026-11-06/2026-11-06-exchange.json' with { type: 'json' }
import { changesetTOML } from '../lib/changesets/draft.ts'
import { readChangeset } from '../lib/changesets/log.ts'
import { derivedFields } from './DpiLayer.ts'
import {
  allowedValue, checkProposal, commentText, decodeDraft, editSpec, encodeDraft, firstGraphemes, graphemeCount, issueForm, issueLink, joinParts, linkProblem, MAX_REASON,
  maxUrlLength, notReadyText, proposalChanges, proposalsOf, proposalTOML, proposalTOMLParts, readiness, readyText, sendReadyText, splitParts, totalLine,
  type EditSpec, type FieldEdit, type Proposal
} from './Proposal.ts'

const today = '2026-11-11'
const rows: Record<string, Record<string, unknown>[]> = { identity: identityRows, payment: paymentRows, exchange: exchangeRows }

/** A real system's spec, with every field but the System ID, the place and the derived fields editable, as on the page */
function specOf (resource: string, id: string): EditSpec {
  const pkg = rootPackage.resources.find(r => r.name === resource)!
  const row = rows[resource].find(row => row.system_id === id)!
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  return editSpec(pkg as never, row, { name: String(row.name), type: resource, country: String(row.country) }, editable)
}

const edit = (field: string, value: string, more: Partial<FieldEdit> = {}): FieldEdit => ({
  field, value, reason: 'The operator’s 2026 annual report says so.', sources: ['https://example.org/report-2026.pdf'], as_of: '2026-11-01', ...more
})
const errors = (spec: EditSpec, proposal: Proposal) => checkProposal(spec, proposal, today).filter(p => p.level === 'error')
/** The TOML without the editor's comments: the header line, and each value's `# was "<value>"` (D87) */
const uncommented = (text: string) => text.replace(/^# .*\n/, '').replace(/ {2}# (?:was "(?:[^"\\]|\\.)*"|unchanged)$/gm, '')
/**
 * The TOML without its comments, checked to be exactly what changesetTOML writes, which also checks
 * the schema and reads it back, and the TOML with them to read as the same data
 */
function toml (spec: EditSpec, proposal: Proposal) {
  const commented = proposalTOML(spec, proposal)
  const text = uncommented(commented)
  assert.notEqual(text, commented)
  assert.equal(text, changesetTOML({ changes: proposalChanges(spec, proposal) }))
  assert.deepEqual(readChangeset(commented), readChangeset(text))
  return text
}

test('a value change is an update of one field, with its reason, sources and evidence date', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal = { edits: [edit('interoperability_policy', 'Yes')] }
  assert.deepEqual(checkProposal(spec, proposal, today), [])
  assert.equal(toml(spec, proposal), `[[changes]]
type = "update"
key = "pay-ke-01"
as_of = 2026-11-01
values.interoperability_policy = "Yes"
reason = "The operator’s 2026 annual report says so."
sources = [
  "https://example.org/report-2026.pdf",
]
`)
})

test('each changed field is its own change, in the page’s order', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal = { edits: [edit('qr_code', 'No', { as_of: '2026-10-01' }), edit('realtime_active', 'No')] }
  assert.deepEqual(errors(spec, proposal), [])
  const changes = proposalChanges(spec, proposal)
  assert.deepEqual(changes.map(c => [c.values, c.as_of]), [[{ realtime_active: 'No' }, '2026-11-01'], [{ qr_code: 'No' }, '2026-10-01']])
  toml(spec, proposal)
})

test('a rename changes the name and the URL, and keeps the System ID (D82)', () => {
  const spec = specOf('identity', 'id-bj-01')
  const proposal = { edits: [edit('name', 'Mobile ID'), edit('url', 'https://mobileid.gouv.bj/')] }
  assert.deepEqual(errors(spec, proposal), [])
  const text = toml(spec, proposal)
  assert.match(text, /key = "id-bj-01"\nas_of = 2026-11-01\nvalues.name = "Mobile ID"/)
  assert.match(text, /values.url = "https:\/\/mobileid.gouv.bj\/"/)
  // a URL must be a web address, or Not Found
  assert.match(errors(spec, { edits: [edit('url', 'mobileid.gouv.bj')] })[0].message, /isn’t a web address starting http:\/\/ or https:\/\//)
})

test('a multi-valued field joins its ticked parts in the codebook’s order', () => {
  const pay = specOf('payment', 'pay-ke-01')
  const types = pay.fields.find(f => f.id === 'transaction_types')!
  assert.equal(types.control, 'multi')
  assert.deepEqual(splitParts(types, types.current), ['P2P', 'P2M'])
  assert.equal(joinParts(types, ['P2M', 'G2P', 'P2P']), 'P2P, P2M, G2P')
  // Not Found stands alone
  assert.equal(joinParts(types, ['P2P', 'Not Found']), 'Not Found')
  const proposal = { edits: [edit('transaction_types', 'P2P, P2M, G2P')] }
  assert.deepEqual(errors(pay, proposal), [])
  assert.match(toml(pay, proposal), /values.transaction_types = "P2P, P2M, G2P"/)

  // permitted participants: the codebook lists the combinations, so Public must be among them
  const dx = specOf('exchange', 'dx-ao-01')
  const participants = dx.fields.find(f => f.id === 'permitted_participants')!
  assert.equal(participants.control, 'multi')
  assert.deepEqual(participants.values, ['Public', 'Private', 'Civil', 'Not Found'])
  assert.equal(joinParts(participants, ['Civil', 'Public']), 'Public, Civil')
  assert.deepEqual(errors(dx, { edits: [edit('permitted_participants', 'Public, Civil')] }), [])
  assert.equal(allowedValue(participants, 'Private, Civil'), false)
  assert.equal(errors(dx, { edits: [edit('permitted_participants', 'Private, Civil')] }).length, 1)
})

test('Not Found is a value any researched field can take (D73)', () => {
  const spec = specOf('identity', 'id-bj-01')
  const proposal = { edits: [edit('status', 'Not Found'), edit('funders', 'Not Found'), edit('url', 'Not Found')] }
  assert.deepEqual(errors(spec, proposal), [])
  assert.match(toml(spec, proposal), /values.url = "Not Found"[\s\S]*values.status = "Not Found"[\s\S]*values.funders = "Not Found"/)
  for (const id of ['status', 'claim', 'name', 'url', 'funders']) {
    const field = spec.fields.find(f => f.id === id)!
    assert.ok(field.control === 'text' ? field.notFound : field.values.includes('Not Found'), id)
  }
})

test('removing a system can name its replacement, as duplicate_of', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const remove = { reason: 'Merged into PesaLink 2.0.', sources: ['https://example.org/merger'], as_of: '2026-11-01', duplicate_of: 'pay-ke-02' }
  assert.deepEqual(checkProposal(spec, { edits: [], remove }, today), [])
  assert.equal(toml(spec, { edits: [], remove }), `[[changes]]
type = "remove"
key = "pay-ke-01"
duplicate_of = "pay-ke-02"
as_of = 2026-11-01
reason = "Merged into PesaLink 2.0."
sources = [
  "https://example.org/merger",
]
`)
  // without one, and not with an id of another type, or its own
  assert.doesNotMatch(toml(spec, { edits: [], remove: { ...remove, duplicate_of: undefined } }), /duplicate_of/)
  assert.match(errors(spec, { edits: [], remove: { ...remove, duplicate_of: 'id-ke-01' } })[0].message, /isn’t a payment System ID/)
  assert.match(errors(spec, { edits: [], remove: { ...remove, duplicate_of: 'pay-ke-01' } })[0].message, /another system/)
  // and not with changed values too
  assert.match(errors(spec, { edits: [edit('qr_code', 'No')], remove })[0].message, /not both/)
})

test('a change without a reason is rejected (D78); one without a source isn’t, but a source must be a link (D90)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  assert.deepEqual(errors(spec, { edits: [edit('qr_code', 'No', { reason: '  ' })] }).map(p => p.message), ['QR code based transactions needs a reason.'])
  assert.deepEqual(errors(spec, { edits: [edit('qr_code', 'No', { sources: [] })] }), [])
  assert.match(errors(spec, { edits: [edit('qr_code', 'No', { sources: ['www.example.org'] })] })[0].message, /isn’t a web address/)
  const remove = { reason: '', sources: [], as_of: today }
  assert.deepEqual(errors(spec, { edits: [], remove }).map(p => p.message), ['Removing this system needs a reason.'])
  assert.match(errors(spec, { edits: [] })[0].message, /Nothing to propose/)
})

test('nothing can be set to NA, or to a value the codebook doesn’t allow (D73)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  assert.match(errors(spec, { edits: [edit('qr_code', 'NA')] })[0].message, /can’t be set to NA/)
  assert.match(errors(spec, { edits: [edit('name', 'NA')] })[0].message, /can’t be set to NA/)
  assert.match(errors(spec, { edits: [edit('name', '')] })[0].message, /needs a value/)
  assert.match(errors(spec, { edits: [edit('qr_code', 'Maybe')] })[0].message, /It can be Yes, No or Not Found/)
  // NA is never offered, but a field that is NA now can be given a value
  assert.ok(spec.fields.every(f => !f.values.includes('NA')))
  assert.equal(spec.fields.find(f => f.id === 'interoperability_policy')!.current, 'NA')
})

test('an evidence date after today warns, but doesn’t stop the proposal (D85)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const problems = checkProposal(spec, { edits: [edit('qr_code', 'No', { as_of: '2026-12-01' })] }, today)
  assert.deepEqual(problems.map(p => p.level), ['warning'])
  assert.match(problems[0].message, /after today/)
  assert.match(errors(spec, { edits: [edit('qr_code', 'No', { as_of: '2026-02-31' })] })[0].message, /needs an evidence date/)
})

test('the issue link fills in the form’s fields, and is too long above maxUrlLength (D56)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal = { edits: [edit('qr_code', 'No')] }
  const link = issueLink(spec, proposal)
  const url = new URL(link.url)
  assert.equal(url.searchParams.get('template'), issueForm)
  assert.equal(url.searchParams.get('title'), 'Proposal: PesaLink (pay-ke-01)')
  assert.equal(url.searchParams.get('changeset'), proposalTOML(spec, proposal))
  // the issue holds just the TOML (D87)
  assert.deepEqual([...url.searchParams.keys()], ['template', 'title', 'changeset'])
  assert.equal(link.tooLong, false)
  const long = { edits: [edit('qr_code', 'No', { reason: 'x'.repeat(maxUrlLength) })] }
  assert.equal(issueLink(spec, long).tooLong, true)
  assert.equal(new URL(issueLink(spec, long).blank).searchParams.get('changeset'), null)
})

test('the changeset starts with the system’s name and place, on one line (D87)', () => {
  const spec = specOf('payment', 'pay-gb-02')
  const text = proposalTOML(spec, { edits: [edit('cross_border', 'Yes')] })
  assert.equal(text.split('\n')[0], '# Faster Payments, United Kingdom of Great Britain and Northern Ireland')
  assert.equal(text.split('\n')[1], '[[changes]]')
  // line breaks and control characters in a name can't end the comment
  const odd = { ...spec, name: 'Faster\nPayments\r\n[[changes]]\u2028x\u0000y' }
  const lines = proposalTOML(odd, { edits: [edit('cross_border', 'Yes')] }).split('\n')
  assert.equal(lines[0], '# Faster Payments [[changes]] x y, United Kingdom of Great Britain and Northern Ireland')
  assert.equal(lines[1], '[[changes]]')
  assert.equal(commentText('a\tb\u0085c\u007f'), 'a b c ')
})

test('each changed value says what it was, as a TOML string (D87)', () => {
  const gb = specOf('payment', 'pay-gb-02')
  assert.equal(proposalTOML(gb, { edits: [edit('cross_border', 'Yes')] }), `# Faster Payments, United Kingdom of Great Britain and Northern Ireland
[[changes]]
type = "update"
key = "pay-gb-02"
as_of = 2026-11-01
values.cross_border = "Yes"  # was "No"
reason = "The operator’s 2026 annual report says so."
sources = [
  "https://example.org/report-2026.pdf",
]
`)
  const ke = specOf('payment', 'pay-ke-01')
  const lines = (proposal: Proposal) => proposalTOML(ke, proposal).split('\n').filter(line => line.startsWith('values.'))
  // from NA, to Not Found, and a multi-valued field, each change with its own
  assert.deepEqual(lines({ edits: [edit('interoperability_policy', 'Yes'), edit('url', 'Not Found'), edit('transaction_types', 'P2P, P2M, G2P')] }), [
    'values.url = "Not Found"  # was "https://www.ipsl.co.ke/"',
    'values.interoperability_policy = "Yes"  # was "NA"',
    'values.transaction_types = "P2P, P2M, G2P"  # was "P2P, P2M"'
  ])
  // from Not Found
  const africa = specOf('payment', 'pay-africa-02')
  assert.equal(africa.fields.find(f => f.id === 'annual_volume')!.current, 'Not Found')
  const fromNotFound = { edits: [edit('annual_volume', '2025- 1.2 M')] }
  assert.deepEqual(errors(africa, fromNotFound), [])
  assert.match(proposalTOML(africa, fromNotFound), /^values\.annual_volume = "2025- 1\.2 M" {2}# was "Not Found"$/m)
  toml(africa, fromNotFound)
  // quotes, backslashes and line breaks in the old value stay inside the comment's string
  const odd = { ...ke, fields: ke.fields.map(f => f.id === 'name' ? { ...f, current: 'Pesa "Link"\\\nnew line' } : f) }
  const text = proposalTOML(odd, { edits: [edit('name', 'PesaLink')] })
  assert.match(text, /^values\.name = "PesaLink" {2}# was "Pesa \\"Link\\"\\\\ new line"$/m)
  toml(odd, { edits: [edit('name', 'PesaLink')] })
  // a reason that looks like a values line is left alone, as only the value's line gets a comment
  const tricky = proposalTOML(ke, { edits: [edit('qr_code', 'No', { reason: 'Two lines:\nvalues.qr_code = "Yes"' })] })
  assert.equal(tricky.match(/# was/g)!.length, 1)
  assert.match(tricky, /^values\.qr_code = "No" {2}# was "Yes"$/m)
})

test('a value with a line or paragraph separator keeps its # was comment after it, outside the string', () => {
  // found by src/EditorMatrix.test.ts: a regex's $ ended the line at U+2028, and the comment went inside the value's string
  const spec = specOf('payment', 'pay-gb-02')
  for (const value of ['a b', 'a b']) {
    const proposal = { edits: [edit('name', value)] }
    const text = proposalTOML(spec, proposal)
    assert.ok(text.split('\n').includes(`values.name = "${value}"  # was "Faster Payments"`))
    assert.deepEqual(readChangeset(text), readChangeset(toml(spec, proposal)))
  }
})

test('a remove has only the header comment (D87)', () => {
  const spec = specOf('payment', 'pay-gb-02')
  const remove = { reason: 'A duplicate.', sources: ['https://example.org/dup'], as_of: '2026-11-01', duplicate_of: 'pay-gb-01' }
  const text = proposalTOML(spec, { edits: [], remove })
  assert.deepEqual(text.split('\n').filter(line => line.includes('#')), ['# Faster Payments, United Kingdom of Great Britain and Northern Ireland'])
  assert.equal(uncommented(text), toml(spec, { edits: [], remove }))
})

test('a date in a comment doesn’t trip the bare-date check (S2, D87)', () => {
  const spec = specOf('payment', 'pay-gb-02')
  for (const was of ['2024-10-01', '2024-02-31']) {
    const dated = { ...spec, fields: spec.fields.map(f => f.id === 'name' ? { ...f, current: was } : f) }
    const text = proposalTOML(dated, { edits: [edit('name', 'Faster Payments')] })
    assert.match(text, new RegExp(`# was "${was}"$`, 'm'))
    assert.deepEqual(readChangeset(text), readChangeset(uncommented(text)))
  }
  // where the date isn't in a comment or a string, it's still checked
  assert.throws(() => readChangeset('[[changes]]\ntype = "update"\nkey = "pay-gb-02"\nas_of = 2024-02-31\n'), /not a real calendar date/)
})

test('a draft link round-trips the form’s state, compressed or not (D87)', async () => {
  assert.equal(typeof CompressionStream, 'function')
  const spec = specOf('payment', 'pay-gb-02')
  const proposal: Proposal = { edits: [
    edit('cross_border', 'Yes', { reason: 'Linked to the EU’s SEPA Instant.\nSecond line, “quoted”.', sources: ['https://example.org/a', 'https://example.org/b?x=1&y=2'] }),
    edit('transaction_types', 'P2P, B2B, G2P', { as_of: '2025-12-31' }),
    edit('name', 'Faster Payments Service')
  ] }
  for (const compress of [true, false]) {
    const text = await encodeDraft(spec, proposal, compress)
    assert.match(text, compress ? /^z\.[A-Za-z0-9_-]+$/ : /^j\.[A-Za-z0-9_-]+$/)
    assert.deepEqual(await decodeDraft(spec, text), { ok: true, proposal, ignored: [] })
  }
  const compressed = await encodeDraft(spec, proposal, true)
  assert.ok(compressed.length < (await encodeDraft(spec, proposal, false)).length)
  // a removal, with its replacement
  const remove = { edits: [], remove: { reason: 'A duplicate.', sources: ['https://example.org/dup'], as_of: '2026-11-01', duplicate_of: 'pay-gb-01' } }
  assert.deepEqual(await decodeDraft(spec, await encodeDraft(spec, remove)), { ok: true, proposal: remove, ignored: [] })
})

test('a draft link for another system, or a damaged one, restores nothing (D87)', async () => {
  const gb = specOf('payment', 'pay-gb-02')
  const ke = specOf('payment', 'pay-ke-01')
  const text = await encodeDraft(ke, { edits: [edit('qr_code', 'No')] })
  const foreign = await decodeDraft(gb, text)
  assert.equal(foreign.ok, false)
  assert.match(!foreign.ok ? foreign.message : '', /for another system \(pay-ke-01\), not pay-gb-02/)
  for (const bad of ['', 'z.', 'z.!!!', 'j.e30', 'x.abc', text.slice(0, -6), 'j.' + btoa('{"v":1,"key":"pay-gb-02","edits":"no"}')]) {
    assert.equal((await decodeDraft(gb, bad)).ok, false, bad)
  }
})

test('a draft link’s unknown fields and values the form wouldn’t allow are left out (D87)', async () => {
  const spec = specOf('payment', 'pay-gb-02')
  const state = { v: 1, key: 'pay-gb-02', edits: [
    { field: 'qr_code', value: 'Yes', reason: 'r', sources: ['https://example.org/', 42], as_of: '2026-02-31' },
    { field: 'not_a_field', value: 'Yes' },
    { field: 'system_id', value: 'pay-gb-99' },
    { field: 'cross_border', value: 'NA' },
    { field: 'cross_border', value: 'Maybe' },
    { field: 'realtime_active', value: 'Yes' },
    { field: 'qr_code', value: 'Not Found' },
    { field: 'transaction_types', value: 'B2B, P2P' },
    'nonsense'
  ] }
  const json = JSON.stringify(state)
  const result = await decodeDraft(spec, 'j.' + btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''))
  assert.ok(result.ok)
  // a bad evidence date is left for the form's default, today; a source that isn't text is dropped
  assert.deepEqual(result.proposal, { edits: [{ field: 'qr_code', value: 'Yes', reason: 'r', sources: ['https://example.org/'], as_of: '' }] })
  assert.deepEqual(result.ignored, [
    'not_a_field', 'system_id', 'Cross-border payments', 'Cross-border payments', 'Active real-time payment system present', 'QR code based transactions', 'Types of transactions supported', 'a change'
  ])
})

test('a change is ready once it has an allowed value, a reason and a real date, and no source that isn’t a link (D90)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal: Proposal = { edits: [
    edit('qr_code', 'No', { reason: '', sources: [] }),
    edit('realtime_active', 'No', { as_of: '2026-12-01', sources: [] }),
    edit('url', 'ipsl.co.ke'),
    edit('cross_border', 'No', { sources: ['www.example.org'], as_of: '' })
  ] }
  const state = readiness(spec, proposal, today)
  // a date after today only warns, so realtime_active is ready; the rest wait, in the page's order
  assert.deepEqual(state.ready, { edits: [proposal.edits[1]] })
  assert.deepEqual(state.changes.map(c => [c.field, c.needs]), [
    ['url', ['a working link']],
    ['realtime_active', []],
    ['cross_border', ['a working source link', 'an evidence date']],
    ['qr_code', ['a reason']]
  ])
  // a removal is ready on its own terms, and comes last
  const remove = { reason: 'A duplicate.', sources: ['https://example.org/dup'], as_of: '2026-11-01', duplicate_of: 'pay-ke-99' }
  assert.deepEqual(readiness(spec, { edits: [], remove }, today).ready, { edits: [], remove })
  const unready = readiness(spec, { edits: [], remove: { ...remove, duplicate_of: 'id-ke-01' } }, today)
  assert.deepEqual([unready.ready, unready.changes], [{ edits: [] }, [{ field: 'remove', title: 'Removing this system', needs: ['a valid System ID'] }]])
})

test('the changeset of the ready changes leaves the others out, and keeps its comments (D87)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal: Proposal = { edits: [edit('qr_code', 'No', { reason: ' ' }), edit('interoperability_policy', 'Yes')] }
  const { ready } = readiness(spec, proposal, today)
  assert.equal(proposalTOML(spec, ready), `# PesaLink, Kenya
[[changes]]
type = "update"
key = "pay-ke-01"
as_of = 2026-11-01
values.interoperability_policy = "Yes"  # was "NA"
reason = "The operator’s 2026 annual report says so."
sources = [
  "https://example.org/report-2026.pdf",
]
`)
  toml(spec, ready)
  // the parts the receipt shows, one per change, join to the same text
  const both = { edits: [edit('qr_code', 'No'), edit('interoperability_policy', 'Yes')] }
  const parts = proposalTOMLParts(spec, both)
  assert.deepEqual(parts.changes.map(c => c.field), ['interoperability_policy', 'qr_code'])
  assert.equal(`${parts.header}\n${parts.changes.map(c => c.text).join('\n')}`, proposalTOML(spec, both))
  assert.equal(proposalTOMLParts(spec, { edits: [], remove: { reason: 'r', sources: ['https://example.org/'], as_of: today } }).changes[0].field, 'remove')
})

test('the receipt’s total line says what’s ready and, plainly, what the rest need', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const line = (proposal: Proposal) => totalLine(readiness(spec, proposal, today))
  assert.equal(line({ edits: [] }), 'Nothing ready yet. Change a value, then give its reason.')
  assert.equal(line({ edits: [edit('qr_code', 'No'), edit('cross_border', 'No')] }), '2 changes ready')
  assert.equal(line({ edits: [edit('qr_code', 'No')] }), '1 change ready')
  assert.equal(line({ edits: [edit('qr_code', 'No'), edit('cross_border', 'No', { reason: '', sources: ['example.org'] })] }), '1 change ready · 1 still needs a reason and a working source link')
  assert.equal(line({ edits: [edit('qr_code', 'No', { reason: '' }), edit('cross_border', 'No', { reason: '' })] }), 'Nothing ready yet · 2 changes still need a reason')
  // several that need different things
  assert.equal(line({ edits: [edit('qr_code', 'No', { reason: '' }), edit('cross_border', 'No', { sources: ['ftp://x'] })] }), 'Nothing ready yet · 2 changes still need a reason or a working source link')
  assert.equal(readyText(readiness(spec, { edits: [edit('qr_code', 'No', { reason: '' })] }, today)), 'nothing ready yet')

  // what a partial send says, and its button
  const partial = readiness(spec, { edits: [edit('qr_code', 'No'), edit('cross_border', 'No'), edit('status', 'Suspended', { reason: '' })] }, today)
  assert.equal(notReadyText(partial), '1 change isn’t ready and won’t be sent: Status of Implementation needs a reason.')
  assert.equal(sendReadyText(partial), 'Send the 2 ready changes')
  const one = readiness(spec, { edits: [edit('qr_code', 'No'), edit('status', 'Suspended', { reason: '' }), edit('name', 'PesaLink 2', { sources: ['example.org'], as_of: 'x' })] }, today)
  assert.equal(notReadyText(one), '2 changes aren’t ready and won’t be sent: Payment system name needs a working source link and an evidence date. Status of Implementation needs a reason.')
  assert.equal(sendReadyText(one), 'Send the ready change')
})

// The rules every proposal meets, in the editor and in the check (D89)

/** The errors' messages and the short hints under their inputs */
const said = (spec: EditSpec, proposal: Proposal) => errors(spec, proposal).map(p => [p.message, p.hint])

test('a value: allowed, not NA, not empty, on one line, trimmed first, and a link only if http(s) (D73, D89, D90)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const value = (field: string, v: string) => said(spec, { edits: [edit(field, v)] })
  assert.deepEqual(value('qr_code', 'NA'), [['QR code based transactions can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.', 'NA can’t be chosen: it means not researched yet.']])
  assert.deepEqual(value('transaction_cost', ''), [['Cost of transactions needs a value. If you looked and found nothing, choose Not Found.', 'Give a value, or choose Not Found.']])
  assert.deepEqual(value('transaction_cost', ' \t '), [['Cost of transactions needs a value. If you looked and found nothing, choose Not Found.', 'Give a value, or choose Not Found.']])
  for (const v of ['a\nb', 'a\r\nb', 'a\u0000b', 'a\tb', 'a\u2028b', 'a\u2029b', 'a\u0085b']) {
    assert.deepEqual(value('transaction_cost', v), [['Cost of transactions can’t have a line break, a tab or another control character.', 'Keep it to one line, with no tabs.']], JSON.stringify(v))
  }
  // spaces around a value are trimmed, as reading a changeset trims them, and a value of spaces is empty (D90)
  assert.deepEqual(value('transaction_cost', ' Central Bank '), [])
  assert.deepEqual(value('transaction_cost', '\u00a0Central Bank\n'), [])
  assert.deepEqual(value('qr_code', ' No '), [])
  assert.deepEqual(value('url', ' https://ipsl.co.ke/new '), [])
  assert.deepEqual(proposalChanges(spec, { edits: [edit('transaction_cost', ' Central Bank ', { reason: ' Why. ', sources: [' https://example.org/x '] })] }).map(c => [c.values, c.reason, c.sources]), [[{ transaction_cost: 'Central Bank' }, 'Why.', ['https://example.org/x']]])
  // the value it has now, with spaces, is no change
  assert.deepEqual(value('name', ' PesaLink ').map(([, hint]) => hint), ['This is the value it has now.'])
  assert.deepEqual(value('url', 'ipsl.co.ke'), [['URL: “ipsl.co.ke” isn’t a web address starting http:// or https://.', 'Start the link with https:// or http://']])
  assert.deepEqual(value('url', 'javascript:alert(1)')[0][1], 'Only links starting https:// or http:// can be used.')
  assert.deepEqual(value('url', 'https://ipsl.co.ke/a b')[0][1], 'A link can’t have spaces.')
  assert.deepEqual(value('url', 'Not Found'), [])
  assert.deepEqual(value('qr_code', 'Maybe'), [['QR code based transactions: “Maybe” isn’t a value the codebook allows. It can be Yes, No or Not Found.', 'Choose one of the values above.']])
  assert.match(value('transaction_types', 'P2P; B2X')[0][0]!, /It can be one or more of P2P, B2B, .*, separated by “, ”, or Not Found\.$/)
  // any script, emoji and punctuation is a value, where the codebook has no pattern
  for (const v of ['نظام الدفع الوطني', 'Pago 💸 rápido 👍🏽', 'Cafe\u0301', '<b>"x"</b> # [[changes]]']) assert.deepEqual(value('transaction_cost', v), [], v)
})

test('a reason: required, and at most 500 characters, counted as a person counts them (D78, D89)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const reason = (r: string) => said(spec, { edits: [edit('qr_code', 'No', { reason: r })] })
  assert.equal(MAX_REASON, 500)
  for (const unit of ['a', 'ب', 'ж', '中', '💸', '👍🏽', '👨‍👩‍👧', '🇬🇧', 'e\u0301', 'क्षि']) {
    assert.equal(graphemeCount(unit.repeat(500)), 500, unit)
    assert.deepEqual(reason(unit.repeat(500)), [], unit)
    assert.deepEqual(reason(unit.repeat(501)), [['QR code based transactions: the reason is 501 characters, over the 500 it can be.', 'Keep it to 500 characters (it’s 501).']], unit)
  }
  // spaces around it aren't counted, as they aren't sent
  assert.deepEqual(reason(`  ${'a'.repeat(500)}\n`), [])
  assert.deepEqual(reason(''), [['QR code based transactions needs a reason.', 'Give a reason.']])
  assert.deepEqual(reason(' \n\t '), [['QR code based transactions needs a reason.', 'Give a reason.']])
  // a reason can be over several lines
  assert.deepEqual(reason('Line one.\nLine two.'), [])
  // the first 500, whole: an emoji with a skin tone isn't cut in two
  assert.equal(firstGraphemes('👍🏽'.repeat(600), 500), '👍🏽'.repeat(500))
  assert.equal(readiness(spec, { edits: [edit('qr_code', 'No', { reason: 'a'.repeat(501) })] }, today).changes[0].needs[0], 'a shorter reason')
})

test('a reason counts code points where Intl.Segmenter is missing', async () => {
  const Segmenter = Intl.Segmenter
  try {
    // as in a browser without it
    Reflect.deleteProperty(Intl, 'Segmenter')
    const { graphemeCount: count } = await import(`./Proposal.ts?no-segmenter=${Date.now()}`)
    assert.equal(count('ب'.repeat(500)), 500)
    assert.equal(count('💸'.repeat(500)), 500)
    assert.equal(count('👍🏽'), 2)
  } finally {
    Object.defineProperty(Intl, 'Segmenter', { value: Segmenter, writable: true, configurable: true })
  }
})

test('sources: none, or each an http(s) link, none twice; and a real date (D85, D89, D90)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const sources = (list: string[]) => said(spec, { edits: [edit('qr_code', 'No', { sources: list })] })
  // no public link: the reason says where it came from
  assert.deepEqual(sources([]), [])
  assert.deepEqual(sources([' https://example.org/a ']), [])
  assert.deepEqual(sources(['Interview with a central bank official']).map(([, hint]) => hint), ['A link can’t have spaces.'])
  assert.deepEqual(sources([' https://example.org/a', 'https://example.org/a ']).map(([, hint]) => hint), ['Source 2: listed twice.'])
  // a change with no sources has none in its TOML, as changesetText writes it
  const none = proposalTOML(spec, { edits: [edit('qr_code', 'No', { sources: [] })] })
  assert.doesNotMatch(none, /sources/)
  toml(spec, { edits: [edit('qr_code', 'No', { sources: [] })] })
  assert.deepEqual(sources(['example.org/report']), [['QR code based transactions: “example.org/report” isn’t a web address starting http:// or https://.', 'Start the link with https:// or http://']])
  assert.deepEqual(sources(['https://example.org/a', 'ftp://example.org/b']).map(([, hint]) => hint), ['Source 2: Only links starting https:// or http:// can be used.'])
  assert.deepEqual(sources(['https://example.org/a', 'https://example.org/a']), [['QR code based transactions lists “https://example.org/a” twice.', 'Source 2: listed twice.']])
  assert.deepEqual(sources(['http://example.org/a', 'https://example.org/b']), [])
  assert.equal(linkProblem('https://'), 'This isn’t a complete link.')
  assert.equal(linkProblem('data:text/html,x'), 'Only links starting https:// or http:// can be used.')
  const date = (as_of: string) => said(spec, { edits: [edit('qr_code', 'No', { as_of })] })
  assert.deepEqual(date(''), [['QR code based transactions needs an evidence date.', 'Choose a date.']])
  assert.deepEqual(date('2026-02-29'), [['QR code based transactions needs an evidence date.', 'Choose a real date.']])
  assert.deepEqual(date('2028-02-29'), [])
})

test('a removal or values, not both; a replacement that’s another System ID; each field once (D89)', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const remove = { reason: 'A duplicate.', sources: ['https://example.org/dup'], as_of: '2026-11-01' }
  assert.deepEqual(said(spec, { edits: [], remove: { ...remove, duplicate_of: 'pay-ke-01' } }), [['The replacement, pay-ke-01, is this system. Name another system, or none.', 'Name another system, not this one.']])
  assert.deepEqual(said(spec, { edits: [], remove: { ...remove, duplicate_of: 'id-ke-01' } }), [['“id-ke-01” isn’t a payment System ID, like pay-ke-01.', 'Not a payment System ID, like pay-ke-01.']])
  assert.deepEqual(said(spec, { edits: [], remove: { ...remove, duplicate_of: 'pay-ke-99' } }), [])
  assert.deepEqual(said(spec, { edits: [edit('qr_code', 'No')], remove }), [['A proposal either changes values or removes the system, not both. Undo the changed values, or don’t propose removing it.', 'Undo the changed values, or don’t propose removing it.']])
  assert.deepEqual(said(spec, { edits: [edit('qr_code', 'No'), edit('qr_code', 'Not Found')] }), [['QR code based transactions is changed twice. Change each field once.', 'Changed twice.']])
})

test('the receipt doesn’t count a removal and values as changes ready: a proposal is one or the other', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const state = readiness(spec, { edits: [edit('qr_code', 'No')], remove: { reason: 'A duplicate.', sources: ['https://example.org/dup'], as_of: '2026-11-01' } }, today)
  assert.equal(totalLine(state), 'A proposal either changes values or removes the system, not both.')
  assert.equal(readyText(state), 'a removal or values, not both')
})

test('a changeset’s changes as the editor’s proposals, one per system, for the check (D89)', () => {
  const evidence = { as_of: '2026-11-01', reason: 'r', sources: ['https://example.org/'] }
  const proposals = proposalsOf([
    { type: 'update', key: 'pay-ke-01', values: { qr_code: 'No', status: 'Suspended' }, ...evidence },
    { type: 'remove', key: 'pay-ke-01', duplicate_of: 'pay-ke-02', ...evidence },
    { type: 'update', key: 'pay-ke-02', values: { qr_code: 'Yes' }, as_of: '2026-11-01' },
    { type: 'revert', changeset: 'x' }
  ])
  assert.deepEqual([...proposals.keys()], ['pay-ke-01', 'pay-ke-02'])
  assert.deepEqual(proposals.get('pay-ke-01'), {
    edits: [{ field: 'qr_code', value: 'No', reason: 'r', sources: ['https://example.org/'], as_of: '2026-11-01' }, { field: 'status', value: 'Suspended', reason: 'r', sources: ['https://example.org/'], as_of: '2026-11-01' }],
    remove: { reason: 'r', sources: ['https://example.org/'], as_of: '2026-11-01', duplicate_of: 'pay-ke-02' }
  })
  // no reason or sources is empty, for the rules to refuse
  assert.deepEqual(proposals.get('pay-ke-02'), { edits: [{ field: 'qr_code', value: 'Yes', reason: '', sources: [], as_of: '2026-11-01' }] })
})

// D92: "Still true", a value restated with fresh evidence

const confirmed = (field: string, value: string, more: Partial<FieldEdit> = {}) => edit(field, value, { confirmed: true, ...more })

test('a value confirmed as still true is an update that sets it, with `# unchanged` where an edit has `# was`', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal = { edits: [confirmed('status', 'Implemented'), edit('qr_code', 'No')] }
  // the rule: restating the value is allowed only when it's said to be so, and it needs the same evidence
  assert.deepEqual(errors(spec, proposal), [])
  assert.deepEqual(errors(spec, { edits: [edit('status', 'Implemented')] }).map(p => p.message), ['Status of Implementation is the same as now.'])
  assert.deepEqual(errors(spec, { edits: [confirmed('status', 'Implemented', { reason: '' })] }).map(p => p.message), ['Status of Implementation needs a reason.'])
  assert.deepEqual(errors(spec, { edits: [confirmed('status', 'Implemented', { reason: '  ', as_of: '' })] }).map(p => p.about), ['reason', 'as_of'])
  // the TOML says it, and the changeset is the same as any update that sets the value
  const text = proposalTOML(spec, proposal)
  assert.match(text, /^values\.status = "Implemented" {2}# unchanged$/m)
  assert.match(text, /^values\.qr_code = "No" {2}# was "Yes"$/m)
  assert.equal(toml(spec, proposal), changesetTOML({ changes: proposalChanges(spec, proposal) }))
  assert.deepEqual(proposalChanges(spec, { edits: [confirmed('status', 'Implemented')] })[0].values, { status: 'Implemented' })
  // the receipt shows it among the parts, and a person's plain edit of the same value says it hasn't changed, as before
  const parts = proposalTOMLParts(spec, proposal)
  assert.deepEqual(parts.changes.map(c => c.field), ['status', 'qr_code'])
  assert.match(parts.changes[0].text, /# unchanged/)
})

test('a confirmation can’t be NA or empty, or any value but the one it has', () => {
  const spec = specOf('payment', 'pay-ke-01')
  // NA is never allowed (D73), and a field with no value has nothing to confirm
  assert.match(errors(spec, { edits: [confirmed('interoperability_policy', 'NA')] })[0].message, /can’t be set to NA/)
  // marked confirmed, but with another value: it's an ordinary edit, with its `# was`
  const other = { edits: [confirmed('status', 'Suspended')] }
  assert.deepEqual(errors(spec, other), [])
  assert.match(proposalTOML(spec, other), /^values\.status = "Suspended" {2}# was "Implemented"$/m)
  // Not Found is a value, and can be confirmed
  const notFound = specOf('payment', 'pay-ma-01')
  assert.equal(notFound.fields.find(f => f.id === 'settlement_method')!.current, 'Not Found')
  const again = { edits: [confirmed('settlement_method', 'Not Found')] }
  assert.deepEqual(errors(notFound, again), [])
  assert.match(proposalTOML(notFound, again), /^values\.settlement_method = "Not Found" {2}# unchanged$/m)
})

test('a confirmed change is ready with a reason and a date, and counts with the others', () => {
  const spec = specOf('payment', 'pay-ke-01')
  const waiting = readiness(spec, { edits: [confirmed('status', 'Implemented', { reason: '' })] }, today)
  assert.deepEqual(waiting.changes.map(c => c.needs), [['a reason']])
  assert.equal(waiting.ready.edits.length, 0)
  const state = readiness(spec, { edits: [confirmed('status', 'Implemented'), edit('qr_code', 'No')] }, today)
  assert.equal(readyText(state), '2 changes ready')
  assert.equal(totalLine(state), '2 changes ready')
  assert.equal(state.ready.edits.length, 2)
  assert.equal(sendReadyText(state), 'Send the 2 ready changes')
  // and without sources, as for any change (D90)
  assert.equal(readiness(spec, { edits: [confirmed('status', 'Implemented', { sources: [] })] }, today).ready.edits.length, 1)
})

test('the draft link restores a confirmation, and one that’s no longer the current value is left out', async () => {
  const spec = specOf('payment', 'pay-ke-01')
  const proposal = { edits: [confirmed('status', 'Implemented'), edit('qr_code', 'No')] }
  for (const compress of [true, false]) {
    const text = await encodeDraft(spec, proposal, compress)
    assert.deepEqual(await decodeDraft(spec, text), { ok: true, proposal, ignored: [] })
  }
  // the same value without the mark is the same as now, so it's left out; with the mark but another value it's an edit
  const plain = await decodeDraft(spec, await encodeDraft(spec, { edits: [edit('status', 'Implemented'), edit('qr_code', 'No')] }, false))
  assert.deepEqual(plain, { ok: true, proposal: { edits: [edit('qr_code', 'No')] }, ignored: ['Status of Implementation'] })
  const marked = await decodeDraft(spec, await encodeDraft(spec, { edits: [confirmed('status', 'Suspended')] }, false))
  assert.deepEqual(marked, { ok: true, proposal: { edits: [edit('status', 'Suspended')] }, ignored: [] })
  // and a confirmation of a value that's NA now isn't restored
  const na = await decodeDraft(spec, await encodeDraft(spec, { edits: [confirmed('aml_law', 'NA'), edit('qr_code', 'No')] }, false))
  assert.deepEqual(na, { ok: true, proposal: { edits: [edit('qr_code', 'No')] }, ignored: ['AML Law'] })
})

// D92: the evidence date's note, and the way back to /edit/ from the edit pages (the markup is read as text: the pages need astro)

const page = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')

test('the evidence date says when this was known to be true, as a change may have no source (D90, D92)', () => {
  const evidence = page('./components/edit/Evidence.astro')
  assert.match(evidence, /Evidence date <span[^>]*>when this was known to be true<\/span>/)
  for (const file of ['./components/edit/Evidence.astro', './components/edit/form.ts', './Proposal.ts', './pages/[system]/edit.astro', './pages/edit/new/[resource].astro']) {
    assert.doesNotMatch(page(file), /when the sources? shows? (this|the value) to be true/, file)
  }
})

test('the edit pages link to /edit/, where another system is found or a new one added (D92)', () => {
  assert.match(page('./pages/[system]/edit.astro'), /<a class="ul" href="\/edit\/">Edit another system, or add one<\/a>/)
  assert.match(page('./pages/edit/new/[resource].astro'), /<a href="\/edit\/">Edit the map<\/a>/)
  assert.match(page('./pages/edit/new/[resource].astro'), /href="\/edit\/">Back to search<\/a>/)
})
