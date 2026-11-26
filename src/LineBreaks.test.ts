// Values with line breaks (src/Proposal.ts oneLine, D93). 20 released values, in 15 systems, have line breaks or tabs, which a
// value can't have, so the form holds them as one clean line: a row the person hasn't touched stays untouched (it isn't an edit, in
// the form, the receipt or a draft link), "Still true" isn't offered for it, and editing it proposes the cleaned value, which the
// check reads as old → new.
// Run with: node --test src/LineBreaks.test.ts
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
import type { DataPackage } from '../lib/changesets/types.ts'
import { proposalCheck } from '../scripts/proposal-check.ts'
import { derivedFields } from './DpiLayer.ts'
import { checkProposal, decodeDraft, editSpec, encodeDraft, fieldSpec, oneLine, proposalTOML, readiness, type EditSpec, type Proposal } from './Proposal.ts'

const datapackage = rootPackage as unknown as DataPackage
const released = { identity: identityRows, payment: paymentRows, exchange: exchangeRows } as Record<string, Record<string, unknown>[]>
const now = new Date('2026-11-16T12:00:00Z')
const today = '2026-11-16'

/** A released system's spec, as the edit page makes it: every field but the System ID, the place and the derived ones editable */
function specOf (resource: string, id: string): EditSpec {
  const pkg = datapackage.resources.find(r => r.name === resource)!
  const row = released[resource].find(row => row.system_id === id)!
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  return editSpec(pkg as never, row, { name: id, type: resource, country: String(row.country) }, editable)
}
const field = (spec: EditSpec, id: string) => spec.fields.find(f => f.id === id)!

test('oneLine: line breaks, tabs and the Unicode separators become single spaces, and the ends are trimmed', () => {
  assert.equal(oneLine('Ministry of the Interior of the Czech\nRepublic'), 'Ministry of the Interior of the Czech Republic')
  assert.equal(oneLine('a\r\nb'), 'a b')
  assert.equal(oneLine('a\tb'), 'a b')
  assert.equal(oneLine(`a\u2028b\u2029c`), 'a b c')
  assert.equal(oneLine('a\n\nb\n'), 'a b')
  assert.equal(oneLine('a \n b'), 'a b')
  assert.equal(oneLine('  a  b  '), 'a  b')
  assert.equal(oneLine('https://a.example/\nhttps://b.example/'), 'https://a.example/ https://b.example/')
  assert.equal(oneLine(''), '')
  assert.equal(oneLine('\n'), '')
})

/** Every released value with a line break, a tab or another control character: [resource, System ID, field id, value] */
const multiline = Object.entries(released).flatMap(([resource, rows]) => rows.flatMap(row =>
  Object.entries(row).flatMap(([id, value]) => typeof value === 'string' && /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value) ? [[resource, String(row.system_id), id, value] as const] : [])))

test('the release has 20 values with line breaks, in 15 systems, and each is one clean line in the spec, flagged, and not a value to restate', () => {
  assert.equal(multiline.length, 20)
  assert.equal(new Set(multiline.map(([, id]) => id)).size, 15)
  for (const [resource, id, fieldId, value] of multiline) {
    const f = datapackage.resources.find(r => r.name === resource)!.schema.fields.find(f => f.name === fieldId)!
    const spec = fieldSpec(f as never, value)
    assert.equal(spec.current, oneLine(value), `${id} ${fieldId}`)
    assert.doesNotMatch(spec.current, /[\x00-\x1f\x7f-\x9f\u2028\u2029]/, `${id} ${fieldId}`)
    assert.equal(spec.multiline, true)
  }
  // a value on one line has no flag, and is the cell as it is
  for (const [resource, rows] of Object.entries(released)) {
    const pkg = datapackage.resources.find(r => r.name === resource)!
    for (const row of rows.slice(0, 40)) for (const f of pkg.schema.fields) {
      const value = String(row[f.name] ?? '')
      if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value)) continue
      const spec = fieldSpec(f as never, value)
      assert.equal(spec.current, value)
      assert.equal(spec.multiline, undefined)
    }
  }
})

test('a row with a line break is untouched on load, and so is its draft link; editing it proposes the cleaned value, old → new in the check', async () => {
  assert.equal(released.identity.find(row => row.system_id === 'id-cz-01')!.governing_entity, 'Ministry of the Interior of the Czech\nRepublic')
  const spec = specOf('identity', 'id-cz-01')
  const entity = field(spec, 'governing_entity')
  assert.deepEqual([entity.current, entity.multiline], ['Ministry of the Interior of the Czech Republic', true])
  // untouched: the form's value (the cleaned one) is the current value, so there's no change and nothing to send
  assert.deepEqual(readiness(spec, { edits: [] }, today).changes, [])
  // typing the cleaned value back, or a trim of it, is no change either: it's the same as now
  assert.deepEqual(checkProposal(spec, { edits: [{ field: 'governing_entity', value: entity.current, reason: 'r', sources: [], as_of: today }] }, today).map(p => p.message), ['Governing entity is the same as now.'])
  // "Still true" isn't for it, in the form or in a draft link
  const confirmed: Proposal = { edits: [{ field: 'governing_entity', value: entity.current, confirmed: true, reason: 'Still so.', sources: ['https://example.org/x'], as_of: today }] }
  assert.deepEqual(checkProposal(spec, confirmed, today).map(p => p.message), ['Governing entity is the same as now.'])
  const draft = await decodeDraft(spec, await encodeDraft(spec, confirmed))
  assert.equal(draft.ok, false)
  // another field's edit restores from a draft link as usual, with this one untouched
  const other: Proposal = { edits: [{ field: 'name', value: 'Czech eID', reason: 'Renamed.', sources: [], as_of: today }] }
  const restored = await decodeDraft(spec, await encodeDraft(spec, other))
  assert.ok(restored.ok && restored.proposal.edits.length === 1)
  // editing it proposes the cleaned value, with the cleaned `# was`; the check reads the cell's own text as the old value
  const edited: Proposal = { edits: [{ field: 'governing_entity', value: 'Ministry of the Interior (Czechia)', reason: 'Renamed in 2026.', sources: ['https://example.org/moi'], as_of: '2026-11-14' }] }
  assert.deepEqual(checkProposal(spec, edited, today), [])
  const toml = proposalTOML(spec, edited)
  assert.match(toml, /values\.governing_entity = "Ministry of the Interior \(Czechia\)"  # was "Ministry of the Interior of the Czech Republic"/)
  const result = proposalCheck(toml, { now, log: fs.mkdtempSync(path.join(os.tmpdir(), 'next-release-empty-')) })
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.changes.map(c => [c.key, c.field, c.old, c.new]), [['id-cz-01', 'governing_entity', 'Ministry of the Interior of the Czech\nRepublic', 'Ministry of the Interior (Czechia)']])
  // the check compares the `# was` with the cell on one line, as the editor wrote it, so there's no warning
  assert.deepEqual(result.warnings, [])
  // a `# was` that isn't the live value, on one line or not, still warns
  const stale = proposalCheck(toml.replace('# was "Ministry of the Interior of the Czech Republic"', '# was "Ministry of Interior"'), { now, log: fs.mkdtempSync(path.join(os.tmpdir(), 'next-release-empty-')) })
  assert.deepEqual(stale.warnings, ['Governing entity for eDoklady was “Ministry of Interior” when this was proposed, and is “Ministry of the Interior of the Czech Republic” now.'])
})

