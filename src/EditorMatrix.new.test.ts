// The editor's new-system form against the check (src/test/matrix.ts, D91), for each table: a new system for
// Kenya with each field filled in alone, then every field at once, through the stand-in for GitHub
// (src/test/mockGithub.ts): the issue GitHub makes from the form's link, and the check on it, which says it
// applies, with no problems, as one new system, whether or not it has a name or status; the TOML reads back as
// the changes the form made, the draft link restores them with the place, and what the form refuses (only the
// top section, no reason, no field) the check refuses too.
// Run with: node --test src/EditorMatrix.new.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import rootPackage from '../datapackage.json' with { type: 'json' }
import { changesetInIssue } from '../scripts/proposal-check.ts'
import { derivedFields } from './DpiLayer.ts'
import { checkProposal, decodeDraft, encodeDraft, issueLink, newSpec, proposalChanges, proposalsOf, readiness, specForPlace, type EditSpec, type Proposal } from './Proposal.ts'
import { issueFromLink, issueFromPaste, runCheck, type MockIssue } from './test/mockGithub.ts'
import { evidence, now, today, validValue } from './test/matrix.ts'
import { readChangeset } from '../lib/changesets/index.ts'

const resources = [['identity', 'id-ke-'], ['payment', 'pay-ke-'], ['exchange', 'dx-ke-']] as const

/** The form for a new system in Kenya, with the System ID after the release's last */
function formFor (resource: string, prefix: string): EditSpec {
  const pkg = rootPackage.resources.find(r => r.name === resource)!
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  return specForPlace(newSpec(pkg as never, { type: resource }, editable), { code: 'ke', country: 'Kenya', key: `${prefix}${resource === 'payment' ? '03' : '02'}` })
}

const create = { reason: 'A second scheme, announced by the central bank in November 2026.', sources: ['https://example.org/announce'], as_of: '2026-11-10' }

function issueFor (spec: EditSpec, proposal: Proposal): MockIssue {
  const link = issueLink(spec, proposal)
  return link.tooLong ? issueFromPaste(link.blank, link.toml) : issueFromLink(link.url)
}

for (const [resource, prefix] of resources) {
  const spec = formFor(resource, prefix)
  /** What the form sends, checked end to end */
  const sends = async (name: string, proposal: Proposal) => {
    assert.deepEqual(checkProposal(spec, proposal, today).filter(p => p.level === 'error'), [], name)
    const state = readiness(spec, proposal, today)
    assert.equal(state.ready.edits.length, proposal.edits.length, name)
    const issue = issueFor(spec, proposal)
    const toml = changesetInIssue(issue.body)!
    // (a) the check applies it, as one new system
    const run = runCheck(issue, { now })
    assert.deepEqual(run.result.problems, [], name)
    assert.equal(run.needsChanges, false, name)
    assert.equal(run.result.resource, resource)
    assert.equal(run.comment.split('\n').filter(line => line.startsWith('**New system:**')).length, 1, name)
    assert.match(run.comment, new RegExp(`\\*\\*New system:\\*\\* would add (an unnamed system|.+) \\(${spec.key}\\), Kenya(, with .+)?\\.`), name)
    assert.equal(run.comment.split('\n').filter(line => line.startsWith(`**`) && !line.startsWith('**New system:**') && !line.startsWith('**To check:**')).length, 0, name)
    // (c) the TOML reads back as the form's changes, and the proposal rules read the updates as its edits
    assert.deepEqual(JSON.parse(JSON.stringify(readChangeset(toml))), JSON.parse(JSON.stringify({ changes: proposalChanges(spec, proposal) })), name)
    const read = proposalsOf(readChangeset(toml).changes as never).get(spec.key)!
    assert.deepEqual(read.edits.map(e => [e.field, e.value]).sort(), proposal.edits.map(e => [e.field, e.value.trim()]).sort(), name)
    // the draft restores the same proposal, with the place
    assert.deepEqual(await decodeDraft(spec, await encodeDraft(spec, proposal)), { ok: true, proposal, ignored: [] }, name)
    return run
  }
  const edits = spec.fields.map(field => ({ field: field.id, value: validValue(field, spec.missing), ...evidence }))

  test(`${resource}: a new system in Kenya with each field filled in alone is applied by the check, with no name or status needed`, async () => {
    for (const edit of edits) {
      const run = await sends(edit.field, { create, edits: [edit] })
      if (!['name', 'status'].includes(edit.field)) assert.match(run.comment, /would add an unnamed system/, edit.field)
    }
  })

  test(`${resource}: a new system with every field filled in at once is applied by the check`, async () => {
    const run = await sends('every field', { create, edits })
    assert.ok(run.result.changes.length > edits.length)
  })

  test(`${resource}: what the form refuses, the check refuses too`, () => {
    const refuses = (name: string, proposal: Proposal, problem: RegExp) => {
      assert.ok(checkProposal(spec, proposal, today).some(p => p.level === 'error'), name)
      assert.equal(readiness(spec, proposal, today).ready.edits.length, 0, `${name}: nothing is ready`)
      const run = runCheck(issueFor(spec, proposal), { now })
      assert.equal(run.needsChanges, true, name)
      assert.match(run.result.problems.join(' '), problem, name)
    }
    // only the top section, even though the form would never send it
    refuses('only the top section', { create, edits: [] }, /needs at least one field/)
    refuses('no reason for the system', { create: { ...create, reason: '' }, edits: [edits[0]] }, /needs a reason/)
    refuses('a reason over 500 characters', { create: { ...create, reason: 'r'.repeat(501) }, edits: [edits[0]] }, /500/)
    refuses('a source that isn’t a link', { create: { ...create, sources: ['example.org'] }, edits: [edits[0]] }, /http/)
    refuses('a field with no reason', { create, edits: [{ ...edits[0], reason: '' }] }, /needs a reason/)
  })
}
