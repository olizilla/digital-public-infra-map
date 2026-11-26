// Recheck mode (D94, src/components/edit/recheck.ts): the edit page shows no "Still true" control until the person switches to recheck
// mode, `?recheck`; then each row that can be confirmed has a checkbox in the place Undo uses. The rules the page and its script
// share are tried here without a browser: which rows can be confirmed, which of Undo and the checkbox a row shows in each mode and
// state, the mode in the address, and a draft opening in the mode. (The page's own markup and the rows not moving are in
// the browser flows.) A confirmation is the same proposal as with the D92 links, so what it sends is tried there.
// Run with: node --test src/Recheck.test.ts
import '../scripts/site-modules.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import rootPackage from '../datapackage.json' with { type: 'json' }
import identityRows from '../public/data/2026-11-06/2026-11-06-identity.json' with { type: 'json' }
import paymentRows from '../public/data/2026-11-06/2026-11-06-payment.json' with { type: 'json' }
import type { DataPackage } from '../lib/changesets/types.ts'
import { derivedFields } from './DpiLayer.ts'
import { checkProposal, decodeDraft, editSpec, encodeDraft, newSpec, proposalTOML, type EditSpec, type Proposal } from './Proposal.ts'
import { canConfirm, hasConfirmations, recheckInSearch, searchWithRecheck, slotOf, type Slot } from './components/edit/recheck.ts'

const datapackage = rootPackage as unknown as DataPackage
const today = '2026-11-16'

function specOf (resource: string, rows: Record<string, unknown>[], id: string): EditSpec {
  const pkg = datapackage.resources.find(r => r.name === resource)!
  const row = rows.find(row => row.system_id === id)!
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  return editSpec(pkg as never, row, { name: id, type: resource, country: String(row.country) }, editable)
}
const pay = specOf('payment', paymentRows, 'pay-ke-01')
const field = (spec: EditSpec, id: string) => spec.fields.find(f => f.id === id)!

/** What the page does for a row, as form.ts does it: the row's state and the mode, then which control it shows */
const slot = (id: string, state: { recheck?: boolean, changed?: boolean, confirming?: boolean }, spec = pay): Slot =>
  slotOf({ canConfirm: canConfirm(field(spec, id), spec.isNew), recheck: false, changed: false, confirming: false, ...state })

test('the rows that can be confirmed are those with a value set, as the check reads it: not NA, empty, or with line breaks, and none on a new system', () => {
  const confirmable = pay.fields.filter(f => canConfirm(f))
  assert.ok(confirmable.length > 10)
  assert.ok(pay.fields.some(f => !canConfirm(f)), 'some rows are NA or empty')
  // a value set and on one line is confirmable, as long as the codebook allows it: every such row here
  for (const f of pay.fields) {
    if (f.current.trim() === '' || f.current === 'NA' || f.multiline) assert.equal(canConfirm(f), false, `${f.id} (${f.current})`)
  }
  assert.equal(canConfirm(field(pay, 'name')), true)
  assert.equal(canConfirm(field(pay, 'status')), true)
  assert.equal(canConfirm({ ...field(pay, 'name'), current: 'NA' }), false)
  assert.equal(canConfirm({ ...field(pay, 'name'), current: '' }), false)
  assert.equal(canConfirm({ ...field(pay, 'name'), current: 'A B', multiline: true }), false)
  assert.equal(canConfirm({ ...field(pay, 'status'), current: 'Not a status' }), false)
  assert.equal(canConfirm(field(pay, 'name'), true), false)
  const place = newSpec(datapackage.resources.find(r => r.name === 'payment')! as never, { type: 'payment' }, pay.fields.map(f => f.id))
  assert.equal(place.isNew, true)
  assert.equal(place.fields.filter(f => canConfirm(f, place.isNew)).length, 0)
  assert.equal(place.fields.filter(f => canConfirm(f)).length, 0, 'a new system has no current values either')
})

test('by default no row shows a confirm control; in recheck mode only the rows that can be confirmed do', () => {
  const none = pay.fields.filter(f => slot(f.id, {}) !== 'none')
  assert.deepEqual(none, [])
  const shown = pay.fields.filter(f => slot(f.id, { recheck: true }) === 'confirm').map(f => f.id)
  assert.deepEqual(shown, pay.fields.filter(f => canConfirm(f)).map(f => f.id))
  for (const f of pay.fields.filter(f => !canConfirm(f))) assert.equal(slot(f.id, { recheck: true }), 'none', f.id)
})

test('ticking Still true confirms a row (the box stays), unticking cancels it; Undo is for edits, in either mode', () => {
  // ticked: the row is changed and confirming, and shows its checkbox, ticked, rather than Undo
  assert.equal(slot('name', { recheck: true, changed: true, confirming: true }), 'confirm')
  // unticked: the row is as it was, and in recheck mode shows an unticked box
  assert.equal(slot('name', { recheck: true }), 'confirm')
  // an edit, in either mode, is Undo's, and turns a confirmation into an ordinary edit: changed, no longer confirming
  assert.equal(slot('name', { recheck: true, changed: true }), 'undo')
  assert.equal(slot('name', { changed: true }), 'undo')
  // a row that can't be confirmed is Undo's when edited, and nothing otherwise, in recheck mode too
  const missing = pay.fields.find(f => !canConfirm(f) && f.control === 'text')!
  assert.equal(slot(missing.id, { recheck: true, changed: true }), 'undo')
  assert.equal(slot(missing.id, { recheck: true }), 'none')
})

test('leaving recheck mode keeps the confirmations, with their checkboxes to undo them, and hides the other boxes', () => {
  const state = { name: { changed: true, confirming: true }, status: {} }
  for (const recheck of [true, false]) assert.equal(slot('name', { ...state.name, recheck }), 'confirm', `name, recheck ${recheck}`)
  assert.equal(slot('status', { ...state.status, recheck: true }), 'confirm')
  assert.equal(slot('status', { ...state.status, recheck: false }), 'none')
  // unticked outside the mode, the row is as it was and its box goes
  assert.equal(slot('name', { recheck: false }), 'none')
  // and the proposal, which the form reads from the rows and not from the mode, is the same in both
  const proposal: Proposal = { edits: [{ field: 'name', value: field(pay, 'name').current, confirmed: true, reason: 'Checked on the operator’s site.', sources: ['https://example.org/x'], as_of: today }] }
  assert.deepEqual(checkProposal(pay, proposal, today), [])
  assert.match(proposalTOML(pay, proposal), /# unchanged/)
})

test('?recheck opens the page in the mode, and switching writes it to the address, with the other parameters kept', () => {
  assert.equal(recheckInSearch(''), false)
  assert.equal(recheckInSearch('?field=status'), false)
  assert.equal(recheckInSearch('?recheck'), true)
  assert.equal(recheckInSearch('?recheck='), true)
  assert.equal(recheckInSearch('?field=status&recheck'), true)
  assert.equal(recheckInSearch('?recheck=1'), true)
  assert.equal(recheckInSearch('?recheck=0'), false)
  assert.equal(recheckInSearch('?recheck=false'), false)
  assert.equal(recheckInSearch('?rechecked'), false)
  assert.equal(searchWithRecheck('', true), '?recheck')
  assert.equal(searchWithRecheck('?recheck', false), '')
  assert.equal(searchWithRecheck('?field=status', true), '?field=status&recheck')
  assert.equal(searchWithRecheck('?field=status&recheck', false), '?field=status')
  assert.equal(searchWithRecheck('?recheck=1&field=status', true), '?field=status&recheck')
  assert.equal(searchWithRecheck('?recheck', true), '?recheck')
  assert.equal(searchWithRecheck('', false), '')
  for (const on of [true, false]) assert.equal(recheckInSearch(searchWithRecheck('?field=name', on)), on)
})

test('a draft with a confirmation opens in recheck mode, and one without leaves the mode alone; the confirmation survives the link', async () => {
  const confirmed: Proposal = { edits: [{ field: 'status', value: field(pay, 'status').current, confirmed: true, reason: 'Still live.', sources: [], as_of: today }] }
  const edited: Proposal = { edits: [{ field: 'name', value: 'PesaLink 2', reason: 'Renamed.', sources: [], as_of: today }] }
  const restored = await decodeDraft(pay, await encodeDraft(pay, confirmed))
  assert.ok(restored.ok)
  assert.equal(hasConfirmations(restored.proposal), true)
  assert.deepEqual(restored.proposal, confirmed)
  const plain = await decodeDraft(pay, await encodeDraft(pay, edited))
  assert.ok(plain.ok)
  assert.equal(hasConfirmations(plain.proposal), false)
  assert.equal(hasConfirmations({ edits: [] }), false)
  assert.equal(hasConfirmations({ edits: [...confirmed.edits, ...edited.edits] }), true)
  // a value that was confirmed and then edited is an ordinary edit, which a draft says
  const changed: Proposal = { edits: [{ ...confirmed.edits[0], value: 'Planned', confirmed: undefined }] }
  assert.equal(hasConfirmations(changed), false)
})
