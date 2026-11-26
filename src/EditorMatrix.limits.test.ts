// How long a proposal can be, end to end: a reason of at most 500 characters, counted as a person counts
// them (D89), the editor's link (8,000 characters, then the TOML to copy and paste, D56), GitHub's issue
// body (65,536 characters, with the form's wrapper), and accepting (64 KB of TOML, D88): whichever comes
// first, counted once (src/Proposal.ts sizeProblemOf), so the editor stops at it, and the check and accepting refuse, alike.
// Through the stand-in for GitHub (src/test/mockGithub.ts), with the real check and decide().
// Run with: node --test src/EditorMatrix.limits.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_BYTES, REASONS, tooLarge } from '../scripts/proposal-accept.ts'
import { proposalCheck } from '../scripts/proposal-check.ts'
import { byteSize, checkProposal, issueLink, MAX_ISSUE_CHARACTERS, MAX_REASON, maxUrlLength, proposalSize, proposalTOML, sizeProblem, tooLargeText, type Proposal } from './Proposal.ts'
import { issueFromLink, issueFromPaste, MAX_ISSUE_BODY, runAccept, runCheck } from './test/mockGithub.ts'
import { evidence, specOf, today, validValue } from './test/matrix.ts'

const log = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-limits-'))
const spec = specOf('payment', 'pay-gb-02')
/** One change, cross_border, with a reason of `n` times `unit` */
const one = (unit: string, n: number): Proposal => ({ edits: [{ field: 'cross_border', value: 'Yes', ...evidence, as_of: '2026-11-14', reason: unit.repeat(n) }] })
/** Every field changed, each with a reason of `n` times `unit` */
const every = (unit: string, n: number): Proposal => ({ edits: spec.fields.map(f => ({ field: f.id, value: validValue(f, spec.missing), ...evidence, reason: unit.repeat(n) })) })
const errors = (proposal: Proposal) => checkProposal(spec, proposal, today).filter(p => p.level === 'error')
const units = { ASCII: 'a', Arabic: 'ب', emoji: '💸', 'emoji with a skin tone': '👍🏽' }

test('a reason of 500 characters is allowed in any script, and 501 isn’t, in the editor and the check', () => {
  const sizes: Record<string, { bytes: number, url: number, tooLong: boolean }> = {}
  for (const [name, unit] of Object.entries(units)) {
    const fits = one(unit, MAX_REASON)
    assert.deepEqual(errors(fits), [], name)
    const link = issueLink(spec, fits)
    sizes[name] = { bytes: byteSize(link.toml), url: link.url.length, tooLong: link.tooLong }
    // in a link if it fits, or pasted; either way the check applies it
    const issue = link.tooLong ? issueFromPaste(link.blank, link.toml) : issueFromLink(link.url)
    assert.equal(runCheck(issue, { log }).result.applies, true, name)
    const over = one(unit, MAX_REASON + 1)
    assert.match(errors(over)[0].message, /the reason is 501 characters, over the 500/, name)
    const longer = issueLink(spec, over)
    const check = runCheck(longer.tooLong ? issueFromPaste(longer.blank, longer.toml) : issueFromLink(longer.url), { log }).result
    assert.deepEqual(check.problems, ['Cross-border payments: the reason is 501 characters, over the 500 it can be.'], name)
  }
  console.log('a 500-character reason:', JSON.stringify(sizes))
  // plain letters, Arabic and a simple emoji fit in a link; an emoji with a skin tone is 8 bytes, 24 in a link, so 500 don't
  assert.deepEqual(Object.values(sizes).map(s => s.tooLong), [false, false, false, true])
  assert.ok(sizes.emoji.url <= maxUrlLength)
})

test('from 8,000 characters to 64 KB: pasted, checked and accepted', () => {
  const proposal = every('a', MAX_REASON)
  assert.deepEqual(errors(proposal), [])
  const link = issueLink(spec, proposal)
  assert.equal(link.tooLong, true)
  assert.ok(byteSize(link.toml) <= MAX_BYTES)
  assert.equal(sizeProblem(spec, proposal), undefined)
  const issue = issueFromPaste(link.blank, link.toml)
  assert.equal(runCheck(issue, { log }).result.applies, true)
  assert.deepEqual(runAccept(issue, { login: 'bob', role: 'triage' }, { log }).decision, { action: 'accept' })
})

test('over 64 KB of TOML, the editor stops it, the check refuses it and accepting refuses it, counted the same way', () => {
  // every field with 500 emoji with a skin tone: within the reason's limit, but over 64 KB of TOML
  const proposal = every('👍🏽', MAX_REASON)
  assert.deepEqual(errors(proposal), [])
  const link = issueLink(spec, proposal)
  const bytes = byteSize(link.toml)
  assert.ok(bytes > MAX_BYTES && bytes === Buffer.byteLength(link.toml, 'utf8'))
  assert.deepEqual(sizeProblem(spec, proposal), { level: 'error', message: tooLargeText(bytes) })
  // the issue can be made, as it's under 65,536 characters
  const issue = issueFromPaste(link.blank, link.toml)
  assert.ok(issue.body.length < MAX_ISSUE_BODY)
  assert.deepEqual(runCheck(issue, { log }).result.problems, [tooLargeText(bytes)])
  assert.deepEqual(runAccept(issue, { login: 'bob', role: 'triage' }, { log }).decision, { action: 'refuse', reason: REASONS.tooLarge, reopen: true })
  // near the limit, about 58 KB, the editor warns, and sends it
  const near = every('👍🏽', 300)
  assert.ok(byteSize(issueLink(spec, near).toml) > MAX_BYTES * 7 / 8)
  assert.equal(sizeProblem(spec, near)?.level, 'warning')
  assert.equal(sizeProblem(spec, every('👍🏽', 200)), undefined)
})

test('plain letters over 64 KB: the editor stops it before GitHub’s 65,536 characters would', () => {
  const proposal: Proposal = { edits: [{ field: 'name', value: 'n'.repeat(66_000), ...evidence }] }
  assert.deepEqual(errors(proposal), [])
  assert.equal(sizeProblem(spec, proposal)?.level, 'error')
  const link = issueLink(spec, proposal)
  assert.throws(() => issueFromPaste(link.blank, link.toml), /over GitHub's 65536/)
})

test('at the edge of each limit, the editor, the check and accepting agree: plain letters reach GitHub’s characters first, Arabic the 64 KB', () => {
  /** A rename to `value`, with nothing else */
  const rename = (value: string): Proposal => ({ edits: [{ field: 'name', value, ...evidence, as_of: '2026-11-14' }] })
  const base = proposalSize(proposalTOML(spec, rename('')))
  const edges = {
    // plain letters: one byte and one character each, so 65,536 characters with the wrapper come before 64 KB
    'plain letters': { unit: 'n', fits: 'n'.repeat(MAX_ISSUE_CHARACTERS - base.characters) },
    // Arabic: two bytes and one character each, so 64 KB comes first, at about 32,700 letters (one plain letter evens the bytes)
    Arabic: { unit: 'ب', fits: 'ب'.repeat(Math.floor((MAX_BYTES - base.bytes) / 2)) + ((MAX_BYTES - base.bytes) % 2 ? 'n' : '') }
  }
  for (const [name, { fits }] of Object.entries(edges)) {
    for (const [value, over] of [[fits, false], [fits + 'n', true]] as const) {
      const proposal = rename(value)
      const toml = proposalTOML(spec, proposal)
      const size = proposalSize(toml)
      const about = `${name}, ${over ? 'one over' : 'at the edge'}: ${size.bytes} bytes, ${size.characters} characters`
      if (name === 'plain letters') assert.equal(size.characters, MAX_ISSUE_CHARACTERS + (over ? 1 : 0), about)
      else assert.equal(size.bytes, MAX_BYTES + (over ? 1 : 0), about)
      assert.deepEqual(errors(proposal), [], about)
      // the editor blocks it, or only warns that it's near
      assert.equal(sizeProblem(spec, proposal)?.level, over ? 'error' : 'warning', about)
      // the check refuses it, or applies it
      const problems = proposalCheck(toml, { now: new Date('2026-11-16T12:00:00Z'), log }).problems
      assert.deepEqual(problems, over ? [sizeProblem(spec, proposal)!.message] : [], about)
      // accepting refuses it, counted the same way
      assert.equal(tooLarge(toml), over, about)
      const link = issueLink(spec, proposal)
      if (over) {
        if (name === 'plain letters') assert.throws(() => issueFromPaste(link.blank, link.toml), /over GitHub's 65536/, about)
        continue
      }
      // at the edge, GitHub takes the issue, and it's accepted
      const issue = issueFromPaste(link.blank, link.toml)
      assert.ok(issue.body.length <= MAX_ISSUE_BODY, about)
      assert.deepEqual(runAccept(issue, { login: 'bob', role: 'triage' }, { log }).decision, { action: 'accept' }, about)
    }
  }
})
