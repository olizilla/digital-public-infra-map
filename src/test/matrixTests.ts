// The editor against the check, case by case (src/test/matrix.ts): every editable field of all three
// tables on real systems, with every allowed value and the awkward ones, and the evidence, dates, removals
// and several changes at once. For each case the editor would send, through a stand-in for GitHub
// (src/test/mockGithub.ts):
// (a) the check (scripts/proposal-check.ts), on the issue GitHub makes from the editor's link, says it
//     applies, with no problems; so (b) nothing the check refuses gets past the editor; and, as both use
//     the same rules (src/Proposal.ts checkProposal, D89), what the editor refuses, the check refuses too,
//     including proposals written by hand that the form can't make (matrix.ts handWritten);
// (c) the TOML reads back as the same changes, from the editor and from the issue, and a draft link
//     restores the same proposal;
// (d) the check's comment has no raw HTML, no live @mention and no Markdown from anyone's text;
// (e) the link is `tooLong` exactly when it's over 8,000 characters, and then the TOML to paste is complete.
// Changes the editor sends are checked together, a batch per system with each field once, as a proposal
// of several changes, and one by one only if a batch doesn't apply. One case of each kind the editor
// refuses is checked too.
// src/EditorMatrix.<table>.test.ts run it for each table, so node --test runs them at once.
// Run with: node --test 'src/EditorMatrix.*.test.ts'   (MATRIX_OUT=<folder> writes every case's outcome there as JSON)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { changesetFromText, readChangeset } from '../../lib/changesets/index.ts'
import { changesetInIssue } from '../../scripts/proposal-check.ts'
import { checkProposal, decodeDraft, encodeDraft, issueLink, maxUrlLength, proposalChanges, proposalsOf, proposalTOML, type EditSpec, type Proposal } from '../Proposal.ts'
import { issueFromLink, issueFromPaste, MAX_ISSUE_BODY, runCheck, type CheckRun, type MockIssue } from './mockGithub.ts'
import { cases, handWritten, now, specOf, systems, today, type Case } from './matrix.ts'

const log = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-matrix-'))
const specs = new Map<string, EditSpec>()
const spec = (c: { resource: string, system: string }) => {
  if (!specs.has(c.system)) specs.set(c.system, specOf(c.resource, c.system))
  return specs.get(c.system)!
}

/** The issue GitHub makes for a proposal: from the link, or, when that's too long, from pasting the TOML into the blank form */
function issueFor (s: EditSpec, proposal: Proposal): MockIssue {
  const link = issueLink(s, proposal)
  return link.tooLong ? issueFromPaste(link.blank, link.toml) : issueFromLink(link.url)
}

const ZWSP = '​'
/** (d) Nothing in the comment, but its own markup, is live Markdown, HTML or a mention */
function assertInert (comment: string) {
  const [marker, ...lines] = comment.split('\n')
  assert.match(marker, /^<!-- dpimap-proposal-check (sha256=[0-9a-f]{64} checked=\S+ )?-->$/)
  for (const line of lines) {
    const bare = line
      .replace(/\\[\\`*_[\]<>|~&]/g, '')
      .replace(/^(- )?\*\*/, '').replace(/:\*\*/, '')
      .replace(/^\*\*(This can’t be applied as it is:|To check:)\*\*$/, '')
      .replace(/^<sub>(.*)<\/sub>$/, '$1')
      .replace(/^- /, '')
    assert.doesNotMatch(bare, /[`*_[\]<>|~&]/, `live Markdown or HTML in the comment: ${JSON.stringify(line)}`)
    assert.doesNotMatch(line, new RegExp(`@(?!${ZWSP})`), `a live mention in the comment: ${JSON.stringify(line)}`)
  }
}

/** The changes as they read back: what the check reads, without the header and `# was` comments */
const plain = (changes: unknown) => JSON.parse(JSON.stringify(changes))

interface Outcome { area: string, system: string, field: string, name: string, editor: string, problems?: string[], warnings?: string[], editorWarnings?: string[], tooLong?: boolean, urlLength?: number, draft?: string }
const outcomes = new Map<Case, Outcome>()
const outcome = (c: Case) => {
  if (!outcomes.has(c)) {
    const editor = !c.proposal ? 'no change' : c.editor.sends ? 'sends' : `refuses: ${c.editor.errors.map(e => e.message).join(' ')}`
    outcomes.set(c, { area: c.area, system: c.system, field: c.field, name: c.name, editor, ...(c.editor.warnings.length ? { editorWarnings: c.editor.warnings.map(w => w.message) } : {}) })
  }
  return outcomes.get(c)!
}

/** The matrix's tests for the cases of these tables */
export function matrixTests (resources: string[]) {
  const all = cases().filter(c => resources.includes(c.resource))
  test('the editor sends what the rules allow, and refuses the rest', () => {
    for (const c of all) {
      outcome(c)
      if (c.expect) assert.equal(c.editor.sends ? 'sends' : 'refuses', c.expect, `${c.system} ${c.field} ${c.name}: ${c.editor.errors.map(e => e.message).join(' ')}`)
    }
  })

  const sent = all.filter(c => c.proposal && c.editor.sends)
  const formSent = sent.filter(c => !c.name.startsWith('raw '))

  test('(c, e) what the editor sends reads back the same, from its TOML and from the issue, and the link is too long only over the limit', () => {
    // raw duplicate sources don't match the schema, so don't read back: the check refuses them, below
    for (const c of sent.filter(c => c.name !== 'raw duplicates')) {
      const s = spec(c)
      const proposal = c.proposal!
      const changes = plain(proposalChanges(s, proposal))
      const toml = proposalTOML(s, proposal)
      const about = `${c.system} ${c.field} ${c.name}`
      const report: { message: string }[] = []
      const read = changesetFromText(toml, { id: '2026-11-16T120000Z-0000', resource: c.resource, folder: 'next', file: 'x.toml', path: 'x.toml' }, report as never, now)
      assert.ok(read, `${about}: ${report.map(r => r.message).join(' ')}`)
      assert.deepEqual(plain(read?.changes.map(({ ...change }) => change)), changes, about)
      const link = issueLink(s, proposal)
      assert.equal(link.tooLong, link.url.length > maxUrlLength, about)
      assert.equal(link.toml, toml, about)
      Object.assign(outcome(c), { tooLong: link.tooLong, urlLength: link.url.length })
      const issue = issueFor(s, proposal)
      assert.ok(issue.body.length <= MAX_ISSUE_BODY)
      // the issue's TOML is the editor's, so the check's fingerprint is of what the editor wrote
      const inIssue = changesetInIssue(issue.body)
      assert.equal(inIssue, toml, `${about}: the TOML in the issue isn’t the editor’s`)
      assert.deepEqual(plain((readChangeset(inIssue!) as { changes: unknown[] }).changes), changes, about)
    }
  })

  test('(c) a draft link restores what the form would send', async () => {
    for (const c of formSent.filter(c => c.area !== 'multiple')) {
      const s = spec(c)
      for (const compress of [true, false]) {
        const restored = await decodeDraft(s, await encodeDraft(s, c.proposal!, compress))
        const about = `${c.system} ${c.field} ${c.name}`
        assert.ok(restored.ok, about)
        assert.deepEqual(restored.ignored, [], about)
        const want = { ...c.proposal!, edits: c.proposal!.edits.map(e => ({ ...e, sources: [...new Set(e.sources.map(u => u.trim()).filter(Boolean))] })) }
        assert.deepEqual(restored.proposal, want, about)
      }
    }
  })

  /** The changes the editor sends, in batches of one system's changes with each field once, as the check gets them */
  function batches (): Case[][] {
    const out: Case[][] = []
    const open = new Map<string, Case[][]>()
    for (const c of sent) {
      const own = c.area === 'removal' || c.area === 'multiple' || c.name.startsWith('raw ')
      if (own) {
        out.push([c])
        continue
      }
      const mine = open.get(c.system) ?? []
      open.set(c.system, mine)
      let batch = mine.find(b => !b.some(other => other.field === c.field))
      if (!batch) {
        batch = []
        mine.push(batch)
        out.push(batch)
      }
      batch.push(c)
    }
    return out
  }

  const checked: { cases: Case[], run: CheckRun }[] = []

  test('(a, b) every change the editor sends applies, with no problems, in the check of the issue it makes', () => {
    const failures: string[] = []
    for (const batch of batches()) {
      const s = spec(batch[0])
      const proposal: Proposal = batch.length === 1 ? batch[0].proposal! : { edits: batch.flatMap(c => c.proposal!.edits) }
      const run = runCheck(issueFor(s, proposal), { now, log })
      checked.push({ cases: batch, run })
      if (run.result.applies) {
        for (const c of batch) {
          const mine = run.result.warnings.filter(w => batch.length === 1 || w.includes(s.fields.find(f => f.id === c.field)?.title ?? c.field))
          if (mine.length) outcome(c).warnings = mine
        }
        continue
      }
      // one by one, to find which
      for (const c of batch) {
        const one = batch.length === 1 ? run : runCheck(issueFor(s, c.proposal!), { now, log })
        if (batch.length > 1) checked.push({ cases: [c], run: one })
        Object.assign(outcome(c), { problems: one.result.problems, warnings: one.result.warnings })
        if (!one.result.applies && formSent.includes(c)) failures.push(`${c.system} ${c.field} ${c.name}: ${one.result.problems.join(' ')}`)
      }
    }
    assert.deepEqual(failures, [], 'the editor sends these, but the check says they can’t be applied')
  })

  test('(b) what the editor refuses, the check refuses too: one case of each kind', () => {
    // one of each kind of refusal per table, checked as if sent anyway
    const seen = new Set<string>()
    const refused = all.filter(c => c.proposal && !c.editor.sends).filter(c => {
      const kind = `${c.resource} ${c.area} ${c.name.replace(/^allowed .*/, 'allowed')}`
      if (seen.has(kind)) return false
      seen.add(kind)
      return true
    })
    for (const c of refused) {
      const s = spec(c)
      const text = proposalTOML(s, c.proposal!)
      const link = issueLink(s, c.proposal!)
      const issue = link.tooLong ? issueFromPaste(link.blank, text) : issueFromLink(link.url)
      const run = runCheck(issue, { now, log })
      checked.push({ cases: [c], run })
      Object.assign(outcome(c), { problems: run.result.problems, warnings: run.result.warnings })
      assert.equal(run.result.applies, false, `${c.system} ${c.field} ${c.name}: the editor refuses it (${c.editor.errors.map(e => e.message).join(' ')}), but the check applies it`)
    }
  })

  const hand: { system: string, name: string, editor: string[], check: string[] }[] = []
  test('(b) proposals written by hand, which the form can’t make: the editor’s rules and the check both refuse them', () => {
    const own = systems.filter(s => resources.includes(s.resource)).slice(0, 1)
    for (const { resource, id } of own) {
      const s = specOf(resource, id)
      for (const { name, toml } of handWritten(s)) {
        // the editor's rules, on the TOML as the check reads it
        const proposal = proposalsOf((readChangeset(toml) as { changes: never[] }).changes).get(s.key)!
        const errors = checkProposal(s, proposal, today).filter(p => p.level === 'error')
        assert.ok(errors.length, `${id} ${name}: the editor’s rules allow it`)
        const run = runCheck(issueFromLink(issueLink(s, { edits: [] }).blank + `&changeset=${encodeURIComponent(`# ${s.name}\n${toml}`)}`), { now, log })
        checked.push({ cases: [], run })
        assert.equal(run.result.applies, false, `${id} ${name}: the check applies it`)
        hand.push({ system: id, name, editor: errors.map(e => e.message), check: run.result.problems })
      }
    }
  })

  test('(d) the check’s comments are inert: no HTML, no mention, no Markdown from anyone’s text', () => {
    assert.ok(checked.length > 0)
    for (const { cases, run } of checked) {
      try {
        assertInert(run.comment)
      } catch (error) {
        throw new Error(`${cases.map(c => `${c.system} ${c.field} ${c.name}`).join('; ') || 'a hand-written proposal'}: ${(error as Error).message}`)
      }
    }
  })

  test('the matrix’s counts', () => {
    const out = [...all.map(outcome)]
    const by = (key: (o: Outcome) => string) => Object.entries(Object.groupBy(out, key)).map(([k, v]) => `${k} ${v!.length}`).join(', ')
    console.log(`cases ${out.length}: ${by(o => o.area)}; editor: ${by(o => o.editor.split(':')[0])}; checks run ${checked.length}`)
    if (process.env.MATRIX_OUT) fs.writeFileSync(path.join(process.env.MATRIX_OUT, `${resources.join('-')}.json`), JSON.stringify({ cases: out, handWritten: hand }, null, 1))
  })
}
