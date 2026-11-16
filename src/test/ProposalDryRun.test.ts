// Accepting what the editor sends, end to end, as a dry run: a sample of the matrix's cases
// (src/test/matrix.ts) across the tables and kinds of change, each through the stand-in for GitHub
// (src/test/mockGithub.ts): the issue from the editor's link, the check and its comment, then closing it
// as completed by a teammate, decide(), and applyProposal() as a dry run, with the real data:check, in a
// temporary clone of this checkout. Then each way accepting refuses. With PROPOSAL_FLOW_URLS=<file>, it
// also takes the issue links captured from the browser, a JSON list of { flow, url } or { flow, toml }.
// It's slower than the site's tests, as each accept runs the full data:check.
// Run with: npm run test:proposals
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AcceptError, applyProposal, FAILED, REASONS } from '../../scripts/proposal-accept.ts'
import { issueForm, issueLink, repository, type EditSpec, type Proposal } from '../Proposal.ts'
import { issueFromLink, issueFromPaste, runAccept, runCheck, tempClone, type Closer, type MockIssue } from './mockGithub.ts'
import { cases, specOf, type Case } from './matrix.ts'

const clone = tempClone()
const teammate: Closer = { login: 'bob', role: 'triage' }

function issueFor (spec: EditSpec, proposal: Proposal): MockIssue {
  const link = issueLink(spec, proposal)
  return link.tooLong ? issueFromPaste(link.blank, link.toml) : issueFromLink(link.url)
}

/** A dry-run accept that passes data:check, and leaves the clone as it was */
function assertAccepted (issue: MockIssue, about: string) {
  const run = runAccept(issue, teammate, { clone })
  assert.deepEqual(run.decision, { action: 'accept' }, about)
  assert.equal(run.error, undefined, `${about}: ${run.error}`)
  assert.match(run.file!, /^changesets\/next\/(identity|payment|exchange)\/\d{4}-\d{2}-\d{2}T\d{6}Z-[0-9a-f]{4}\.toml$/)
  assert.match(run.subject!, /^data: accepted proposal #\d+, /)
  assert.doesNotMatch(run.subject!, /[@#](?!\d)/)
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: clone, encoding: 'utf8' })
  assert.equal(status.stdout, '', `${about}: the clone isn’t clean after the dry run`)
  return run
}

// the sample: on the three systems with many values and an unnamed one, a value of each kind, a long
// reason that needs pasting, HTML in a reason, a removal and several changes at once
const wanted: [string, (c: Case) => boolean][] = [
  ['a choice', c => c.area === 'value' && c.name.startsWith('allowed ') && !c.name.includes(',') && c.field === 'status'],
  ['a multi-valued field', c => c.area === 'value' && ['transaction_types', 'permitted_participants', 'sectoral'].includes(c.field) && c.name !== 'Not Found'],
  ['emoji in the name', c => c.field === 'name' && c.name === 'emoji'],
  ['an https URL', c => c.field === 'url' && c.name === 'https://'],
  ['Not Found in a text field', c => ['governing_entity', 'architecture', 'transaction_cost'].includes(c.field) && c.name === 'Not Found'],
  ['a reason of 500 emoji, which needs pasting', c => c.name === '500 emoji with skin tones'],
  ['a removal', c => c.area === 'removal' && c.name === 'a valid replacement'],
  ['three changes', c => c.name === 'three changes']
]
const sent = cases().filter(c => c.proposal && c.editor.sends && !c.name.startsWith('raw '))
const sample: Case[] = []
for (const system of ['id-kh-01', 'pay-gb-02', 'dx-ee-01']) {
  for (const [, pick] of wanted) {
    const found = sent.find(c => c.system === system && pick(c))
    if (found) sample.push(found)
  }
}
sample.push(...sent.filter(c => c.system === 'pay-er-01' && c.field === 'name' && c.name === 'RTL Arabic'))
sample.push(...sent.filter(c => c.system === 'id-gf-01' && c.field === 'status').slice(0, 1))

test('the sample covers the tables and kinds of change', () => {
  assert.ok(sample.length >= 20, `only ${sample.length}`)
  assert.deepEqual(new Set(sample.map(c => c.resource)), new Set(['identity', 'payment', 'exchange']))
})

for (const c of sample) {
  test(`accepted as a dry run, with data:check passing: ${c.system} ${c.field} ${c.name}`, () => {
    const spec = specOf(c.resource, c.system)
    const issue = issueFor(spec, c.proposal!)
    const check = runCheck(issue)
    assert.equal(check.needsChanges, false, check.result.problems.join(' '))
    assertAccepted(issue, `${c.system} ${c.field} ${c.name}`)
  })
}

test('each way accepting refuses, and whether it reopens', () => {
  const c = sample[0]
  const spec = specOf(c.resource, c.system)
  const issue = issueFor(spec, c.proposal!)
  const closedAt = new Date()
  const minutes = (n: number) => new Date(closedAt.getTime() - n * 60_000)
  const refused = (closer: Partial<Closer>, reason: string, reopen = true) =>
    assert.deepEqual(runAccept(issue, { ...teammate, closedAt, ...closer }, { clone }).decision, { action: 'refuse', reason, reopen }, reason)
  refused({ login: issue.user }, REASONS.author)
  for (const role of ['read', null, 'some custom role']) refused({ role }, REASONS.role)
  refused({ state_reason: 'not_planned' }, REASONS.notCompleted, false)
  refused({ closer: 'PullRequest' }, REASONS.closedBy, false)
  refused({ closer: 'Commit' }, REASONS.closedBy, false)
  // edited 2 minutes before closing, after the check an hour before: the comment is older than the edit
  refused({ lastEditedAt: minutes(2) }, REASONS.editedAfterCheck)
  // edited, then checked again straight away, then closed within 5 minutes
  const checkedAt = minutes(3)
  assert.deepEqual(runAccept(issue, { ...teammate, closedAt, lastEditedAt: minutes(3.5) }, { clone, checkedAt }).decision, { action: 'refuse', reason: REASONS.editedJustBefore, reopen: true })
  // the comment is about other TOML: the issue was edited and the check hasn't caught up
  const other = issueFor(spec, { edits: c.proposal!.edits.map(e => ({ ...e, reason: `${e.reason} Edited.` })) })
  refused({ comment: { user: 'github-actions[bot]', body: runCheck(other).comment, updated_at: minutes(30).toISOString() } }, REASONS.otherVersion)
  // no check comment, or one by someone else
  refused({ comment: null }, REASONS.notChecked)
  refused({ comment: { user: 'mallory', body: runCheck(issue).comment, updated_at: minutes(30).toISOString() } }, REASONS.notChecked)
  // the issue's TOML can't be applied
  const broken: MockIssue = { ...issue, body: issue.body.replace(/^as_of = .*$/m, 'as_of = 2026-02-29') }
  assert.deepEqual(runAccept(broken, { ...teammate, closedAt }, { clone }).decision, { action: 'refuse', reason: REASONS.cantApply, reopen: true })
  // no changeset in it at all
  assert.deepEqual(runAccept({ ...issue, body: '### Changeset\n\n_No response_' }, { ...teammate, closedAt }, { clone }).decision, { action: 'refuse', reason: REASONS.noChangeset, reopen: true })
  // and the same issue, by a teammate, is accepted
  assert.deepEqual(runAccept(issue, { ...teammate, closedAt }, { clone }).decision, { action: 'accept' })
})

test('the dry run’s data:check is the real one: a value the codebook doesn’t allow fails it, and leaves the clone clean', () => {
  const toml = '[[changes]]\ntype = "update"\nkey = "pay-gb-02"\nas_of = 2026-11-14\nvalues.status = "Bogus"\nreason = "A test."\nsources = ["https://example.org/x"]\n'
  assert.throws(() => applyProposal({ root: clone, file: 'changesets/next/payment/2026-11-14T000000Z-0bad.toml', toml, message: { subject: 's', body: 'b' }, dryRun: true }),
    (error: AcceptError) => error.reason === FAILED.dataCheck)
  assert.equal(spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: clone, encoding: 'utf8' }).stdout, '')
})

// D90: a change with no source links, a new system and a revert of a pending changeset, each accepted as a
// dry run. The revert's changeset is committed to its own clone first, as one waiting in changesets/next/.
const evidence = { reason: 'Interview with a central bank official, October 2026.', sources: [], as_of: '2026-11-14' }

test('a change with no source links is accepted as a dry run, with data:check passing, and has no sources in its TOML (D90)', () => {
  const spec = specOf('payment', 'pay-gb-02')
  const issue = issueFor(spec, { edits: [{ field: 'status', value: 'Suspended', ...evidence }] })
  assert.doesNotMatch(issue.body, /sources/)
  assert.equal(runCheck(issue).needsChanges, false)
  assertAccepted(issue, 'no sources')
})

/** The issue for TOML a person wrote, pasted into the blank form */
const pasted = (title: string, toml: string) => issueFromPaste(`${repository}/issues/new?template=${issueForm}&title=${encodeURIComponent(title)}`, toml)

test('a new system is accepted as a dry run, with data:check passing (D90)', () => {
  const issue = pasted('Proposal: PesaLink 2', '# PesaLink 2, Kenya\n[[changes]]\ntype = "create"\nkey = "pay-ke-03"\nas_of = 2026-11-14\nvalues.country = "Kenya"\nvalues.name = "PesaLink 2"\nvalues.status = "Planned/Piloted"\nreason = "The operator announced a second network in November 2026."\nsources = [\n  "https://example.org/pesalink-2",\n]\n')
  const check = runCheck(issue)
  assert.equal(check.needsChanges, false, check.result.problems.join(' '))
  assert.match(check.comment, /^\*\*New system:\*\* would add PesaLink 2 \(pay-ke-03\), with /m)
  const run = assertAccepted(issue, 'a new system')
  assert.equal(run.subject, 'data: accepted proposal #100, PesaLink 2 (pay-ke-03)')
  assert.match(run.file!, /^changesets\/next\/payment\//)
})

test('a revert of a pending changeset is accepted as a dry run, with data:check passing (D47, D90)', () => {
  const own = tempClone(fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-revert-')))
  const git = (...args: string[]) => {
    const ran = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd: own, encoding: 'utf8' })
    assert.equal(ran.status, 0, ran.stderr)
    return ran.stdout
  }
  try {
    const id = '2026-11-15T090000Z-beef'
    fs.mkdirSync(path.join(own, 'changesets', 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(own, 'changesets', 'next', 'payment', `${id}.toml`), '[[changes]]\ntype = "update"\nkey = "pay-gb-02"\nas_of = 2026-11-15\nvalues.status = "Suspended"\nreason = "A mistake."\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'a pending changeset')
    const issue = pasted('Proposal: revert', `[[changes]]\ntype = "revert"\nchangeset = "${id}"\nas_of = 2026-11-16\nreason = "Proposed by mistake: the system is still running."\n`)
    const log = path.join(own, 'changesets')
    const check = runCheck(issue, { log })
    assert.equal(check.needsChanges, false, check.result.problems.join(' '))
    assert.match(check.comment, /^\*\*Revert:\*\* would undo pending changeset 2026-11-15T090000Z-beef \(1 change\)\.$/m)
    const run = runAccept(issue, teammate, { clone: own, log })
    assert.deepEqual(run.decision, { action: 'accept' })
    assert.equal(run.error, undefined, run.error)
    assert.match(run.file!, /^changesets\/next\/payment\//)
    assert.equal(run.subject, `data: accepted proposal #100, revert of ${id}`)
    assert.match(run.dataCheck!, /data:check passed for the pending round/)
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
  } finally {
    fs.rmSync(path.dirname(own), { recursive: true, force: true })
  }
})

const flows = process.env.PROPOSAL_FLOW_URLS
if (flows) {
  const captured: { flow: string, system?: string, url?: string, toml?: string }[] = JSON.parse(fs.readFileSync(flows, 'utf8'))
  for (const flow of captured.filter(f => f.url?.startsWith(`${repository}/issues/new`) || f.toml)) {
    test(`from the browser, checked and accepted as a dry run: ${flow.flow}`, () => {
      const blank = `${repository}/issues/new?template=${issueForm}&title=${encodeURIComponent(`Proposal: ${flow.system}`)}`
      const issue = flow.url ? issueFromLink(flow.url) : issueFromPaste(blank, flow.toml!)
      const check = runCheck(issue)
      assert.equal(check.needsChanges, false, check.result.problems.join(' '))
      assertAccepted(issue, flow.flow)
    })
  }
}
