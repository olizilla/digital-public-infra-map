// The proposal check (scripts/proposal-check.ts, D88) and its comment (scripts/proposal-comment.ts): what a
// proposal would do, old → new from the live data, and its DPI effect; the problems that stop it applying,
// in plain words, from the same checks as data:check-next (D51, D60, D85); its warnings; and the comment,
// which never says "valid" (D88), with the fingerprint of the TOML it checked in its marker. Checked
// against the 2026-11-06 release and a log of the test's own, so changesets/next/ doesn't change the
// results, and nothing is written in the repo.
// Run with: node --test src/ProposalCheck.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AMBIGUOUS_ISSUE, changesetInIssue, checkIssueBody, fingerprint, issueProblem, notFound, proposalCheck, type ProposalResult } from '../scripts/proposal-check.ts'
import { commitMessage } from '../scripts/proposal-accept.ts'
import { code, COMMENT_LIMIT, commentFingerprint, MARKER, markerLine, proposalComment, tomlDetails } from '../scripts/proposal-comment.ts'
import { evidenceProblems, ISSUE_WRAPPER, MAX_ISSUE_CHARACTERS } from './Proposal.ts'

const now = new Date('2026-11-15T12:00:00Z')
/** An empty log: no pending changesets */
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
const check = (text: string, log = empty) => proposalCheck(text, { now, log })

/** A proposal as the editor writes it (src/Proposal.ts proposalTOML): one update per field */
function update (key: string, values: Record<string, string>, more: { as_of?: string, was?: string } = {}) {
  return [
    '# A system, Somewhere',
    '[[changes]]',
    'type = "update"',
    `key = "${key}"`,
    `as_of = ${more.as_of ?? '2026-11-14'}`,
    ...Object.entries(values).map(([id, value]) => `values.${id} = ${JSON.stringify(value)}${more.was === undefined ? '' : `  # was ${JSON.stringify(more.was)}`}`),
    'reason = "The operator’s 2026 annual report says so."',
    'sources = [',
    '  "https://example.org/report-2026.pdf",',
    ']',
    ''
  ].join('\n')
}

const forbidden = /\bvalid\b|approved|✅/i
/** The comment, checked for D88's rules: the marker first, and never "valid" or "approved" */
function comment (result: ProposalResult) {
  const text = proposalComment(result)
  assert.equal(text.split('\n')[0], markerLine(result))
  assert.ok(text.startsWith(MARKER))
  assert.doesNotMatch(text, forbidden)
  return text
}

test('a value change that flips a system’s DPI status and a country count', () => {
  // Pix is Brazil's only DPI-like payment system
  const result = check(update('pay-br-01', { status: 'Planned/Piloted' }, { was: 'Implemented' }))
  assert.deepEqual(result.problems, [])
  assert.equal(result.applies, true)
  assert.deepEqual(result.changes, [{ change: 0, type: 'update', key: 'pay-br-01', system: 'Pix', field: 'status', title: 'Status of Implementation', old: 'Implemented', new: 'Planned/Piloted' }])
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-br-01', system: 'Pix', dpiType: 'pay', before: 'DPI', after: 'WIP' }])
  assert.equal(result.dpi.countries.length, 1)
  const [count] = result.dpi.countries
  assert.equal(count.dpiType, 'pay')
  assert.equal(count.after, count.before - 1)
  assert.deepEqual(result.warnings, [])
  const text = comment(result)
  assert.match(text, /^\*\*Pix \(pay-br-01\):\*\* Status of Implementation, Implemented → Planned\/Piloted\.$/m)
  assert.match(text, new RegExp(`^Pix would no longer be DPI-like; countries with a DPI-like digital payment system, ${count.before} → ${count.after}\\.$`, 'm'))
  assert.match(text, /<sub>Checked against the 6 Nov 2026 release with no other changes waiting for the next one\.<\/sub>/)
  // a workflow that never ran can't say so, so the comment says what closing does and what to expect
  assert.match(text, /<sub>Closing this as completed commits it for the next release, and a line naming the file appears here\. If none appears within a few minutes, reopen this and close it again\.<\/sub>\n\n<details>/)
  assert.doesNotMatch(text, /To check/)
})

test('a change that doesn’t change a DPI status has no DPI line', () => {
  // PesaLink is in progress either way: a bank association runs it
  const result = check(update('pay-ke-01', { status: 'Planned/Piloted' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-ke-01', system: 'PesaLink', dpiType: 'pay', before: 'WIP', after: 'WIP' }])
  assert.deepEqual(result.dpi.countries, [])
  // its line, and the evidence under it (D96)
  const lines = comment(result).split('\n').filter(line => line && !line.startsWith('<'))
  assert.equal(lines.filter(line => line.startsWith('**')).length, 1)
  assert.match(lines.find(line => line.startsWith('&nbsp;'))!, /^&nbsp;&nbsp;&nbsp;&nbsp;Reason: The operator’s 2026 annual report says so\. · Sources: `https:\/\/example\.org\/report-2026\.pdf` · As of 2026-11-14$/)
})

test('a rename keeps the System ID and says old → new, escaping the new name', () => {
  const result = check(update('pay-ke-01', { name: 'PesaLink 2 *new* <b> @someone' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.changes.map(c => [c.title, c.old, c.new]), [['Payment system name', 'PesaLink', 'PesaLink 2 *new* <b> @someone']])
  const text = comment(result)
  assert.match(text, /^\*\*PesaLink \(pay-ke-01\):\*\* Payment system name, PesaLink → PesaLink 2 \\\*new\\\* \\<b\\> @​someone\.$/m)
})

test('a change with several values, one of them a multi-valued field', () => {
  const result = check(update('pay-ke-01', { cross_border: 'No', transaction_types: 'P2P, P2M, G2P' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.changes.map(c => [c.title, c.old, c.new]), [
    ['Cross-border payments', 'Yes', 'No'],
    ['Types of transactions supported', 'P2P, P2M', 'P2P, P2M, G2P']
  ])
  const lines = comment(result).split('\n').filter(line => line.startsWith('**'))
  assert.deepEqual(lines, [
    '**PesaLink (pay-ke-01):** Cross-border payments, Yes → No.',
    '**PesaLink (pay-ke-01):** Types of transactions supported, P2P, P2M → P2P, P2M, G2P.'
  ])
})

const remove = (key: string, duplicateOf?: string) => [
  '[[changes]]', 'type = "remove"', `key = "${key}"`, ...(duplicateOf ? [`duplicate_of = "${duplicateOf}"`] : []), 'as_of = 2026-11-14',
  'reason = "Merged into its successor."', 'sources = ["https://example.org/merger"]', ''
].join('\n')

test('a remove, with its replacement named', () => {
  const result = check(remove('pay-ke-01', 'pay-ke-02'))
  assert.equal(result.applies, true)
  assert.deepEqual(result.changes, [{ change: 0, type: 'remove', key: 'pay-ke-01', system: 'PesaLink', replacement: { key: 'pay-ke-02', system: 'MPesa' } }])
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-ke-01', system: 'PesaLink', dpiType: 'pay', before: 'WIP' }])
  assert.deepEqual(result.dpi.countries, [])
  assert.match(comment(result), /^\*\*PesaLink \(pay-ke-01\):\*\* removed, replaced by MPesa \(pay-ke-02\)\.$/m)
})

test('removing a country’s only DPI-like system changes the count, and a replacement not in the data is a warning', () => {
  const result = check(remove('pay-br-01', 'pay-br-09'))
  assert.equal(result.applies, true)
  assert.deepEqual(result.warnings, ['Removing Pix names “pay-br-09” as its replacement, which isn’t a digital payment system in the data.'])
  const [count] = result.dpi.countries
  assert.equal(count.after, count.before - 1)
  const text = comment(result)
  assert.match(text, /^\*\*Pix \(pay-br-01\):\*\* removed, replaced by pay-br-09\.$/m)
  assert.match(text, new RegExp(`^Countries with a DPI-like digital payment system, ${count.before} → ${count.after}\\.$`, 'm'))
})

test('an unknown field can’t be applied', () => {
  const result = check(update('pay-ke-01', { colour: 'Blue' }))
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['“colour” isn’t a field of digital payment systems, so it can’t be set.'])
  const text = comment(result)
  assert.equal(text.split('\n')[1], '**This can’t be applied as it is:**')
  assert.doesNotMatch(text, /Closing this as completed/)
  assert.match(text, /^- “colour” isn’t a field of digital payment systems/m)
  // no changes or DPI effect are listed when it can't be applied
  assert.doesNotMatch(text, /→/)
})

test('a value outside the codebook says what the codebook allows', () => {
  const result = check(update('pay-ke-01', { status: 'Live' }))
  assert.deepEqual(result.problems, ['Status of Implementation: “Live” isn’t a value the codebook allows. It can be Planned/Piloted, Implemented, Suspended or Not Found.'])
  const multi = check(update('pay-ke-01', { transaction_types: 'P2P; B2X' }))
  assert.match(multi.problems[0], /^Types of transactions supported: “P2P; B2X” isn’t a value the codebook allows\. It can be one or more of P2P, B2B/)
})

test('NA can’t be set: it means not researched yet (D73, D86)', () => {
  const result = check(update('pay-ke-01', { cross_border: 'NA' }))
  assert.deepEqual(result.problems, ['Cross-border payments can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.'])
})

test('an impossible date can’t be applied (D85)', () => {
  const result = check(update('pay-ke-01', { status: 'Suspended' }, { as_of: '2026-02-31' }))
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['The evidence date 2026-02-31, on line 5, isn’t a real date.'])
})

test('an unknown System ID can’t be applied', () => {
  assert.deepEqual(check(update('pay-ke-99', { status: 'Suspended' })).problems, ['“pay-ke-99” isn’t a System ID in the data, so there’s no system to change.'])
  assert.deepEqual(check(update('kenya-1', { status: 'Suspended' })).problems, ['“kenya-1” isn’t a System ID: it should look like pay-ke-01, id-ke-01 or dx-ke-01.'])
})

test('a date after today is a warning, and it still applies (D85)', () => {
  const result = check(update('pay-ke-01', { cross_border: 'No' }, { as_of: '2026-12-25' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.warnings, ['The change to Cross-border payments for PesaLink is dated 2026-12-25, after today. That’s allowed, but check it’s the date the source shows.'])
  const text = comment(result)
  assert.match(text, /^\*\*To check:\*\*$/m)
  assert.match(text, /^- The change to Cross-border payments for PesaLink is dated 2026-12-25, after today\./m)
})

test('a change older than the row’s Last updated is a warning (D46)', () => {
  const result = check(update('pay-ke-01', { cross_border: 'No' }, { as_of: '2025-01-01' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.warnings, ['The change to Cross-border payments for PesaLink is dated 2025-01-01, before the system’s Last updated, 2026-10-15. It would still replace the value.'])
})

test('TOML that doesn’t parse says where, in plain words', () => {
  const result = check('[[changes]\ntype = "update"\n')
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['The changeset can’t be read at line 1, column 11 (expected end of table array declaration). Open the proposal in the editor again, or fix that line.'])
  assert.match(comment(result), /^- The changeset can’t be read at line 1, column 11/m)
})

test('a changeset that doesn’t match the schema, in plain words (issue #82)', () => {
  const result = check('[[props]]\n')
  assert.deepEqual(result.problems, ['There are no changes in it.', 'It has “props”, which a changeset can’t have.'])
  const missing = check('[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nvalues.status = "Suspended"\nsources = ["not a url"]\n')
  // what the editor's rules say too is said in their words, with the rest (D92): the reason, the source, then the date
  assert.deepEqual(missing.problems, ['Status of Implementation needs a reason.', 'Status of Implementation: “not a url” isn’t a web address starting http:// or https://.', 'Status of Implementation needs an evidence date.'])
  // a changeset that doesn't make sense as one stops there, with every error it has
  const odd = check('[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nreason = "r"\nvalues.status = 3\n[[changes]]\ntype = "nap"\n')
  assert.deepEqual(odd.problems, ['Change 1: the value for Status of Implementation must be text, in quotes.', 'Change 2’s kind, “nap”, isn’t one of update, create, remove or revert.'])
})

test('a body with no TOML block has no changeset, and its comment says so', () => {
  assert.equal(changesetInIssue('### Changeset\n\n_No response_'), undefined)
  assert.equal(changesetInIssue('### Changeset\n\n[[changes]]\ntype = "update"\n'), undefined)
  const result = notFound()
  assert.equal(result.found, false)
  assert.equal(result.applies, false)
  const text = comment(result)
  assert.equal(text, `<!-- dpimap-proposal-check -->\n**This can’t be applied as it is:**\n\n- No changeset was found in this issue. Open the proposal from the editor again, or put its changes under “Changeset”, as the editor writes them.\n`)
})

test('the changeset is the first toml block under ### Changeset, or the first anywhere', () => {
  const toml = '[[changes]]\ntype = "update"\n'
  // the issue form's body, with GitHub's line ends
  assert.equal(changesetInIssue(`### Changeset\r\n\r\n\`\`\`toml\r\n${toml.replaceAll('\n', '\r\n')}\`\`\``), toml)
  // the older form (#83): a Summary with its own block first
  assert.equal(changesetInIssue(`### Summary\n\n\`\`\`toml\nnot this\n\`\`\`\n\n### Changeset\n\n\`\`\`toml\n${toml}\`\`\`\n`), toml)
  // no heading: the first toml block, not another language's
  assert.equal(changesetInIssue(`Hello\n\n\`\`\`js\nalert(1)\n\`\`\`\n\`\`\`\`toml\n${toml}\`\`\`\`\n\`\`\`toml\nnot this\n\`\`\``), toml)
})

test('old values are the live data’s: the release plus changesets/next/, and a later pending change wins', () => {
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', 'payment', '2026-11-13T100000Z-abcd.toml'), update('pay-ke-01', { cross_border: 'Not Found' }, { as_of: '2026-11-13' }))
    // the `# was` comment is what the editor saw; the live value is the pending change's
    const result = check(update('pay-ke-01', { cross_border: 'No' }, { as_of: '2026-11-14', was: 'Yes' }), log)
    assert.equal(result.applies, true)
    assert.equal(result.pending, 1)
    assert.deepEqual(result.changes.map(c => [c.old, c.new]), [['Not Found', 'No']])
    assert.deepEqual(result.warnings, ['Cross-border payments for PesaLink was “Yes” when this was proposed, and is “Not Found” now.'])
    assert.match(comment(result), /<sub>Checked against the 6 Nov 2026 release and the changes waiting for the next one\.<\/sub>/)
    // dated before the pending change, it wouldn't show
    const older = check(update('pay-ke-01', { cross_border: 'No' }, { as_of: '2026-11-12' }), log)
    assert.deepEqual(older.warnings, ['A change waiting for the next release, dated 2026-11-13, sets Cross-border payments for PesaLink to “Not Found”, so this change wouldn’t show.'])
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
})

test('a proposal with no reason can’t be applied: proposals need one now (D78, D89)', () => {
  const result = check('[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nvalues.cross_border = "No"\nreason = ""\n')
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['Cross-border payments needs a reason.'])
})

test('a proposal with no sources applies, with a gentle word that the reason should say where it came from (D90)', () => {
  const none = '[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nvalues.cross_border = "No"\nreason = "Interview with a central bank official, October 2026."\n'
  for (const toml of [none, none + 'sources = []\n']) {
    const result = check(toml)
    assert.deepEqual(result.problems, [])
    assert.deepEqual(result.warnings, ['A change has no source links: the reason should say where it came from.'])
    assert.match(comment(result), /^- A change has no source links: the reason should say where it came from\.$/m)
  }
  // with a source, no word
  assert.deepEqual(check(update('pay-ke-01', { cross_border: 'No' })).warnings, [])
})

test('values, reasons and sources are trimmed as the changeset is read, not refused (D90)', () => {
  const toml = '[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nvalues.name = "  PesaLink 2\\t"\nreason = "  Renamed. \\n"\nsources = ["  https://example.org/x  "]\n'
  const result = check(toml)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.changes.map(c => [c.old, c.new]), [['PesaLink', 'PesaLink 2']])
  // a value of spaces is still empty
  assert.deepEqual(check(toml.replace('  PesaLink 2\\t', ' \\t ')).problems, ['Payment system name needs a value. If you looked and found nothing, choose Not Found.'])
})

test('a derived field can’t be set, nor systems of two types at once (D31, D48)', () => {
  assert.deepEqual(check(update('pay-ke-01', { last_updated: '2026-11-14' })).problems, ['Last updated is worked out from the data, so it can’t be set.'])
  const two = check(update('pay-ke-01', { cross_border: 'No' }) + '\n' + update('id-ke-01', { biometrics: 'Yes' }).replace(/^# .*\n/, ''))
  assert.equal(two.applies, false)
  assert.match(two.problems[0], /^It changes systems of more than one type/)
})

test('the comment’s marker records the SHA-256 of the exact TOML checked, and when (D88)', () => {
  const toml = update('pay-ke-01', { status: 'Planned/Piloted' })
  const result = check(toml)
  assert.equal(result.sha256, fingerprint(toml))
  assert.match(result.sha256!, /^[0-9a-f]{64}$/)
  assert.equal(result.checked, now.toISOString())
  // a proposal that can't be applied has one too
  assert.equal(check('[[props]]\n').sha256, fingerprint('[[props]]\n'))
  const text = comment(result)
  assert.equal(text.split('\n')[0], `<!-- dpimap-proposal-check sha256=${fingerprint(toml)} checked=2026-11-15T12:00:00.000Z -->`)
  assert.deepEqual(commentFingerprint(text), { sha256: fingerprint(toml), checked: '2026-11-15T12:00:00.000Z' })
  // any change to the text changes it, even a comment or a line end
  assert.notEqual(fingerprint(toml + '\n'), result.sha256)
  assert.notEqual(fingerprint(toml.replace('# A system', '# Another system')), result.sha256)
  // no TOML, no fingerprint, and the marker is the one comments had before
  assert.equal(commentFingerprint(proposalComment(notFound())), undefined)
  assert.equal(commentFingerprint('<!-- dpimap-proposal-check -->\nHello'), undefined)
  // only on the first line, and only the whole marker
  assert.equal(commentFingerprint(`Hello\n<!-- dpimap-proposal-check sha256=${'a'.repeat(64)} -->`), undefined)
  assert.equal(commentFingerprint(`<!-- dpimap-proposal-check sha256=${'a'.repeat(63)} -->`), undefined)
  assert.deepEqual(commentFingerprint(`<!-- dpimap-proposal-check sha256=${'a'.repeat(64)} -->`), { sha256: 'a'.repeat(64) })
})

test.after(() => fs.rmSync(empty, { recursive: true, force: true }))

test('a reason with a line that would end the issue’s code fence still reaches the check whole', async () => {
  // found by src/EditorMatrix.test.ts: a reason over several lines went in a """ string as it is, so a
  // line of ``` in it ended GitHub's ```toml block early, and the check got half the TOML
  const { changesetText } = await import('../lib/changesets/toml.ts')
  for (const reason of ['Before\n```\nafter', 'Before\n   ````\nafter', 'Before\n~~~\nafter']) {
    const text = '# PesaLink, Kenya\n' + changesetText({ changes: [{ type: 'update', key: 'pay-ke-01', as_of: '2026-11-14', values: { qr_code: 'No' }, reason, sources: ['https://example.org/x'] }] })
    // as GitHub's issue form renders the field, with its value trimmed
    const body = `### Changeset\n\n\`\`\`toml\n${text.trim()}\n\`\`\``
    assert.equal(changesetInIssue(body), text)
    const result = check(text)
    assert.deepEqual(result.problems, [])
    assert.equal(result.applies, true)
  }
})

test('a hand-written proposal meets exactly the editor’s rules: what the form can’t make, the check refuses (D89)', () => {
  const evidence = 'reason = "The operator’s 2026 annual report says so."\nsources = ["https://example.org/report-2026.pdf"]\n'
  const updates = (values: string, more = evidence) => `[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\n${values}\n${more}`
  const removal = (more = '') => `[[changes]]\ntype = "remove"\nkey = "pay-ke-01"\n${more}as_of = 2026-11-14\n${evidence}`
  const refused = (toml: string) => {
    const result = check(toml)
    assert.equal(result.applies, false, toml)
    comment(result)
    return result.problems
  }
  assert.deepEqual(refused(updates('values.name = "   "')), ['Payment system name needs a value. If you looked and found nothing, choose Not Found.'])
  assert.deepEqual(refused(updates('values.name = "Pesa\\u0000Link"')), ['Payment system name can’t have a line break, a tab or another control character.'])
  assert.deepEqual(refused(updates('values.name = "Pesa\\nLink"')), ['Payment system name can’t have a line break, a tab or another control character.'])
  assert.deepEqual(refused(removal('duplicate_of = "pay-ke-01"\n')), ['The replacement, pay-ke-01, is this system. Name another system, or none.'])
  assert.deepEqual(refused(removal('duplicate_of = "id-ke-01"\n')), ['“id-ke-01” isn’t a digital payment System ID, like pay-ke-01.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"') + removal()), ['A proposal either changes values or removes the system, not both. Undo the changed values, or don’t propose removing it.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"') + updates('values.qr_code = "Yes"')), ['QR code based transactions is changed twice. Change each field once.'])
  assert.equal(refused(removal() + removal())[0], 'It removes “pay-ke-01” more than once.')
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "  "\nsources = ["https://example.org/x"]\n')), ['QR code based transactions needs a reason.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"', `reason = "${'ب'.repeat(501)}"\nsources = ["https://example.org/x"]\n`)), ['QR code based transactions: the reason is 501 characters, over the 500 it can be.'])
  // a source that isn't a link, or is there twice, as the editor says it (D92)
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "A reason."\nsources = ["example.org/report"]\n')), ['QR code based transactions: “example.org/report” isn’t a web address starting http:// or https://.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "A reason."\nsources = ["https://example.org/x", "https://example.org/x"]\n')), ['QR code based transactions lists “https://example.org/x” twice.'])
  // and 500 characters in any script, a reason over several lines, or a later date, apply
  for (const reason of ['a'.repeat(500), 'ب'.repeat(500), '👍🏽'.repeat(500), 'Line one.\nLine two.']) {
    assert.equal(check(updates('values.qr_code = "No"', `reason = ${JSON.stringify(reason)}\nsources = ["https://example.org/x"]\n`)).applies, true)
  }
})

// Adding a system and reverting a pending changeset, which a proposal can do when they hold up (D47, D90)

/** A create, as a person would write it */
const create = (key: string, values: Record<string, string>, evidence = 'reason = "Launched in 2026, as the operator announced."\nsources = ["https://example.org/launch"]\n') => [
  '[[changes]]', 'type = "create"', `key = "${key}"`, 'as_of = 2026-11-14',
  ...Object.entries(values).map(([id, value]) => `values.${id} = ${JSON.stringify(value)}`), evidence
].join('\n')
/** A revert of `changeset` */
const revert = (changeset: string, evidence = 'reason = "Proposed by mistake."\n') => `[[changes]]\ntype = "revert"\nchangeset = "${changeset}"\nas_of = 2026-11-14\n${evidence}`

test('a new system with a well-formed, unused System ID, its place and a reason applies, and says it would add it (D90)', () => {
  const result = check(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2', status: 'Planned/Piloted' }))
  assert.deepEqual(result.problems, [])
  assert.equal(result.resource, 'payment')
  assert.deepEqual(result.changes.map(c => [c.type, c.key, c.system, c.field, c.new]), [
    ['create', 'pay-ke-03', 'PesaLink 2', 'country', 'Kenya'], ['create', 'pay-ke-03', 'PesaLink 2', 'name', 'PesaLink 2'], ['create', 'pay-ke-03', 'PesaLink 2', 'status', 'Planned/Piloted']
  ])
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-ke-03', system: 'PesaLink 2', dpiType: 'pay', after: 'WIP' }])
  const text = comment(result)
  assert.match(text, /^\*\*New system:\*\* would add PesaLink 2 \(pay-ke-03\), Kenya, with Payment system name, PesaLink 2; Status of Implementation, Planned\/Piloted\.$/m)
  assert.equal(text.split('\n').filter(line => line.startsWith('**')).length, 1)
  // with no sources, the reason says where it came from
  assert.deepEqual(check(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }, 'reason = "A tip-off from the operator, November 2026."\n')).problems, [])
})

test('a new system can’t reuse a System ID, be badly formed or in the wrong place, set NA, or come without a reason (D90)', () => {
  const problems = (toml: string, log = empty) => {
    const result = check(toml, log)
    assert.equal(result.applies, false, toml)
    comment(result)
    return result.problems
  }
  assert.deepEqual(problems(create('pay-ke-01', { country: 'Kenya', name: 'PesaLink' })), ['“pay-ke-01” is already a system, PesaLink, so it can’t be added. Propose changes to it instead, or choose a new System ID.'])
  assert.deepEqual(problems(create('pay-kenya-3', { country: 'Kenya', name: 'PesaLink 2' })), ['“pay-kenya-3” isn’t a System ID: it should look like pay-ke-01, id-ke-01 or dx-ke-01.'])
  assert.match(problems(create('pay-gb-99', { country: 'Kenya', name: 'PesaLink 2' })).join(' '), /System ID/)
  assert.deepEqual(problems(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2', status: 'NA' })), ['Status of Implementation can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.'])
  assert.deepEqual(problems(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }, 'reason = ""\n')), ['The change needs a reason.'])
  // nor one waiting for the next release
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', 'payment', '2026-11-13T100000Z-abcd.toml'), create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }))
    assert.deepEqual(problems(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink Two' }), log), ['“pay-ke-03” is already a system, PesaLink 2, so it can’t be added. Propose changes to it instead, or choose a new System ID.'])
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
})

test('a revert of a pending changeset applies, and says it would undo it; a released or unknown one can’t (D47, D90)', () => {
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    // Pix, Brazil's only DPI-like payment system, waits to become Planned/Piloted, in a changeset of two changes
    const pending = '2026-11-13T100000Z-abcd'
    fs.writeFileSync(path.join(log, 'next', 'payment', `${pending}.toml`), update('pay-br-01', { status: 'Planned/Piloted' }) + '\n' + update('pay-ke-01', { qr_code: 'No' }))
    const result = check(revert(pending, 'reason = "Proposed by mistake."\nsources = ["https://example.org/why"]\n'), log)
    assert.deepEqual(result.problems, [])
    assert.equal(result.resource, 'payment')
    assert.deepEqual(result.changes, [{ change: 0, type: 'revert', changeset: pending, reverts: 2 }])
    // undoing it brings Pix back as DPI-like
    assert.deepEqual(result.dpi.systems.map(s => [s.key, s.before, s.after]), [['pay-br-01', 'WIP', 'DPI'], ['pay-ke-01', 'WIP', 'WIP']])
    const text = comment(result)
    assert.match(text, /^\*\*Revert:\*\* would undo pending changeset 2026-11-13T100000Z-abcd \(2 changes\)\.$/m)
    assert.match(text, /^Pix would become DPI-like; countries with a DPI-like digital payment system, \d+ → \d+\.$/m)
    // with no sources, no word is needed: the reason says why
    assert.deepEqual(check(revert(pending), log).warnings, [])
    assert.deepEqual(check(revert(pending, 'reason = ""\n'), log).problems, ['The change needs a reason.'])
    assert.deepEqual(check(revert('2026-11-13T100000Z-ffff'), log).problems, ['The change reverts “2026-11-13T100000Z-ffff”, which isn’t a changeset waiting for the next release.'])
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
  // a released changeset is fixed forward (D66)
  const released = fs.readdirSync(path.join(import.meta.dirname, '..', 'changesets', '2026-11-06', 'payment'))[0].replace(/\.toml$/, '')
  assert.deepEqual(check(revert(released), path.join(import.meta.dirname, '..', 'changesets')).problems, [`The change reverts “${released}”, which was released on 2026-11-06. Only changes waiting for the next release can be reverted: propose a change that fixes it instead.`])
})

// A new system as the editor makes it (D91): a create with the place and a reason, then an update for each field, on the same key

/** An update of one field of a new system, as the editor writes it */
const field = (key: string, id: string, value: string, evidence = 'reason = "Said so in the announcement."\nsources = ["https://example.org/announce"]\n') =>
  `[[changes]]\ntype = "update"\nkey = "${key}"\nas_of = 2026-11-14\nvalues.${id} = ${JSON.stringify(value)}\n${evidence}`
/** The create the editor writes: the place and a reason, no fields */
const top = (key: string, country = 'Kenya') => create(key, { country }, 'reason = "A second scheme, announced in November 2026."\nsources = ["https://example.org/announce"]\n')
const newSystem = (key: string, fields: [string, string][], country = 'Kenya') => [top(key, country), ...fields.map(([id, value]) => field(key, id, value))].join('\n')

test('a create followed by updates to its key applies, and is one line in the comment, with its place and fields (D91)', () => {
  const result = check(newSystem('pay-ke-03', [['name', 'PesaLink 2'], ['status', 'Planned/Piloted']]))
  assert.deepEqual(result.problems, [])
  assert.equal(result.applies, true)
  assert.deepEqual(result.changes.map(c => [c.change, c.type, c.key, c.field, c.new]), [[0, 'create', 'pay-ke-03', 'country', 'Kenya'], [1, 'update', 'pay-ke-03', 'name', 'PesaLink 2'], [2, 'update', 'pay-ke-03', 'status', 'Planned/Piloted']])
  const text = comment(result)
  assert.match(text, /^\*\*New system:\*\* would add PesaLink 2 \(pay-ke-03\), Kenya, with Payment system name, PesaLink 2; Status of Implementation, Planned\/Piloted\.$/m)
  assert.equal(text.split('\n').filter(line => line.startsWith('**')).length, 1)
  assert.deepEqual(result.warnings, [])
})

test('a new system needs no name or status: with neither it’s “an unnamed system” in the comment (D91)', () => {
  const result = check(newSystem('pay-ke-03', [['interoperability_policy', 'Yes'], ['qr_code', 'No']]))
  assert.deepEqual(result.problems, [])
  assert.equal(result.applies, true)
  const text = comment(result)
  assert.match(text, /^\*\*New system:\*\* would add an unnamed system \(pay-ke-03\), Kenya, with .+, Yes; QR code based transactions, No\.$/m)
  assert.doesNotMatch(text, /^\*\*pay-ke-03/m)
  // fields in the create itself count too, as pay-cz-02 could have had them
  assert.equal(check(create('pay-ke-03', { country: 'Kenya', qr_code: 'No' })).applies, true)
})

test('a new system with only its place and reason, and no field, can’t be applied (D91)', () => {
  const result = check(top('pay-ke-03'))
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['“pay-ke-03”: A new system needs at least one field filled in, with its reason: its name, status or any other.'])
  assert.match(comment(result), /^\*\*This can’t be applied as it is:\*\*$/m)
  // with a field on another key, it still has none of its own
  assert.equal(check(top('pay-ke-03') + '\n' + field('pay-ke-01', 'qr_code', 'No')).applies, false)
})

test('each field of a new system meets the editor’s rules, and its update needs a reason (D89, D91)', () => {
  const problems = (toml: string) => { const r = check(toml); assert.equal(r.applies, false, toml); return r.problems }
  assert.deepEqual(problems(newSystem('pay-ke-03', [['status', 'NA']])), ['Status of Implementation can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.'])
  assert.deepEqual(problems(newSystem('pay-ke-03', [['status', 'Whenever']])).length, 1)
  assert.deepEqual(problems(top('pay-ke-03') + '\n' + field('pay-ke-03', 'qr_code', 'No', 'reason = ""\n')), ['QR code based transactions needs a reason.'])
  assert.deepEqual(problems(create('pay-ke-03', { country: 'Kenya' }, 'reason = ""\n') + '\n' + field('pay-ke-03', 'qr_code', 'No')), ['Change 1 needs a reason.'])
  // the same field twice
  assert.match(problems(newSystem('pay-ke-03', [['qr_code', 'No'], ['qr_code', 'Yes']])).join(' '), /QR code based transactions is changed twice/)
  // an update to a system that isn't in the data and isn't created here
  assert.match(problems(top('pay-ke-03') + '\n' + field('pay-ke-03', 'qr_code', 'No') + '\n' + field('pay-ke-04', 'qr_code', 'No')).join(' '), /pay-ke-04/)
})

test('a new system’s System ID that’s taken, in the release or waiting for the next one, is refused, not renumbered (D91)', () => {
  const taken = (toml: string, log = empty) => { const r = check(toml, log); assert.equal(r.applies, false, toml); return r.problems }
  assert.deepEqual(taken(newSystem('pay-ke-01', [['qr_code', 'No']])), ['“pay-ke-01” is already a system, PesaLink, so it can’t be added. Propose changes to it instead, or choose a new System ID.'])
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', 'payment', '2026-11-13T100000Z-abcd.toml'), newSystem('pay-ke-03', [['qr_code', 'No']]))
    assert.deepEqual(taken(newSystem('pay-ke-03', [['qr_code', 'Yes']]), log), ['“pay-ke-03” is already a system, so it can’t be added. Propose changes to it instead, or choose a new System ID.'])
    // the next one after it is free
    assert.equal(check(newSystem('pay-ke-04', [['qr_code', 'Yes']]), log).applies, true)
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
})

test('a place that has a row with no name is gently asked whether this should fill it in instead (D91)', () => {
  // Eritrea’s only payment row, pay-er-01, has no name and no status
  const result = check(newSystem('pay-er-02', [['qr_code', 'No']], 'Eritrea'))
  assert.deepEqual(result.problems, [])
  assert.equal(result.applies, true)
  assert.ok(result.warnings.includes('Eritrea, unnamed digital payment system (pay-er-01): should this fill it in instead?'), result.warnings.join(' | '))
  assert.match(comment(result), /^- Eritrea, unnamed digital payment system \(pay-er-01\): should this fill it in instead\?$/m)
  // not for a place whose rows are named, or another table's unnamed row
  assert.ok(!check(newSystem('pay-ke-03', [['qr_code', 'No']])).warnings.some(w => /no name/.test(w)))
  assert.ok(!check(newSystem('pay-gb-03', [['qr_code', 'No']], 'United Kingdom')).warnings.some(w => /no name/.test(w)))
  // nor for an update to a system, or the unnamed row itself
  assert.ok(!check(update('pay-er-01', { qr_code: 'No' })).warnings.some(w => /no name/.test(w)))
  // a row waiting for the next release counts, and a new system with a name of its own is still asked
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', 'payment', '2026-11-13T100000Z-abcd.toml'), newSystem('pay-ke-03', [['qr_code', 'No']]))
    assert.ok(check(newSystem('pay-ke-04', [['name', 'Another']]), log).warnings.includes('Kenya, unnamed digital payment system (pay-ke-03): should this fill it in instead?'))
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
})

test('a System ID that was used for a system that’s since been removed is refused, and the next free one named (D82, D91)', () => {
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  const write = (folder: string, name: string, toml: string) => {
    fs.mkdirSync(path.join(log, folder, 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, folder, 'payment', `${name}.toml`), toml)
  }
  /** a system created, then removed: nothing is left of it in the data */
  const gone = (key: string) => newSystem(key, [['qr_code', 'No']]) + '\n' + `[[changes]]\ntype = "remove"\nkey = "${key}"\nas_of = 2026-11-14\nreason = "It never launched."\n`
  try {
    // removed in a changeset waiting for the next release
    write('next', '2026-11-13T100000Z-abcd', gone('pay-ke-03'))
    const pending = check(newSystem('pay-ke-03', [['qr_code', 'Yes']]), log)
    assert.equal(pending.applies, false)
    assert.deepEqual(pending.problems, ['pay-ke-03 was used for a system that was removed; System IDs aren’t reused. Choose pay-ke-04.'])
    assert.match(comment(pending), /^- pay-ke-03 was used for a system that was removed; System IDs aren’t reused\. Choose pay-ke-04\.$/m)
    assert.equal(check(newSystem('pay-ke-04', [['qr_code', 'Yes']]), log).applies, true)
    // removed in a released changeset, a number higher still
    write('2026-11-06', '2026-11-04T100000Z-beef', gone('pay-ke-07'))
    assert.deepEqual(check(newSystem('pay-ke-07', [['qr_code', 'Yes']]), log).problems, ['pay-ke-07 was used for a system that was removed; System IDs aren’t reused. Choose pay-ke-08.'])
    // the later numbers still skip the highest ever used
    assert.deepEqual(check(newSystem('pay-ke-03', [['qr_code', 'Yes']]), log).problems, ['pay-ke-03 was used for a system that was removed; System IDs aren’t reused. Choose pay-ke-08.'])
    assert.equal(check(newSystem('pay-ke-08', [['qr_code', 'Yes']]), log).applies, true)
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
  // no log of its own: the real one has nothing removed, so the next ID is free
  assert.equal(check(newSystem('pay-ke-03', [['qr_code', 'Yes']]), path.join(import.meta.dirname, '..', 'changesets')).applies, true)
})

// D92: every problem in one comment

/** A change, written by hand, with its parts as given */
const change = (key: string, lines: string[], evidence = ['reason = "The operator’s report says so."', 'sources = ["https://example.org/report"]']) =>
  ['[[changes]]', 'type = "update"', `key = "${key}"`, ...lines, ...evidence, ''].join('\n')

test('a forbidden value and a source that isn’t a link are both in one comment (D92)', () => {
  const toml = change('pay-ke-01', ['as_of = 2026-11-14', 'values.status = "NA"'], ['reason = "Checked."', 'sources = ["kba.co.ke"]'])
  const result = check(toml)
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, [
    'Status of Implementation can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.',
    'Status of Implementation: “kba.co.ke” isn’t a web address starting http:// or https://.'
  ])
  const lines = comment(result).split('\n').filter(line => line.startsWith('- '))
  assert.equal(lines.length, 2)
  // fixing one leaves the other, and fixing both leaves none
  assert.equal(check(toml.replace('kba.co.ke', 'https://kba.co.ke')).problems.length, 1)
  assert.equal(check(toml.replace('kba.co.ke', 'https://kba.co.ke').replace('"NA"', '"Suspended"')).applies, true)
})

test('every change’s problems are listed, by change, the value before its evidence, each once (D92)', () => {
  const toml = [
    change('pay-ke-01', ['as_of = 2026-11-14', 'values.status = "NA"', 'values.qr_code = "Maybe"'], ['reason = ""', 'sources = ["kba.co.ke", "kba.co.ke"]']),
    change('pay-ke-99', ['as_of = 2026-11-14', 'values.status = "Implemented"']),
    change('pay-er-01', ['as_of = 2026-11-14', 'values.cross_border = "Yes"'], ['reason = "r"', 'sources = ["https://example.org/ok", "nope"]']),
    change('pay-ke-01', ['as_of = 2026-02-31', 'values.status = "Suspended"']),
    change('id-ke-01', ['as_of = 2026-11-14', 'values.status = "Suspended"'])
  ].join('\n')
  const result = check(toml)
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, [
    // the proposal as a whole, then each change, its own problems, its values', then its evidence's
    'It changes systems of more than one type (payment and identity). Propose each type’s changes separately.',
    'Status of Implementation can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.',
    'QR code based transactions: “Maybe” isn’t a value the codebook allows. It can be Yes, No or Not Found.',
    'Status of Implementation needs a reason.',
    'QR code based transactions needs a reason.',
    'Status of Implementation: “kba.co.ke” isn’t a web address starting http:// or https://.',
    'QR code based transactions: “kba.co.ke” isn’t a web address starting http:// or https://.',
    '“pay-ke-99” isn’t a System ID in the data, so there’s no system to change.',
    'Cross-border payments: “nope” isn’t a web address starting http:// or https://.',
    'Status of Implementation is changed twice. Change each field once.',
    'The evidence date 2026-02-31, on line 29, isn’t a real date.',
    '“id-ke-01” isn’t a System ID in the data, so there’s no system to change.'
  ])
  // each once
  assert.equal(new Set(result.problems).size, result.problems.length)
  assert.deepEqual(check(toml).problems, result.problems)
  const text = comment(result)
  assert.equal(text.split('\n').filter(line => line.startsWith('- ')).length, result.problems.length)
})

test('an unreal date and a forbidden value are both reported, and so are data problems with rule problems (D92)', () => {
  const dated = check(update('pay-ke-01', { status: 'NA', cross_border: 'Maybe' }, { as_of: '2026-02-31' }))
  assert.deepEqual(dated.problems, [
    'Status of Implementation can’t be set to NA, which means not researched yet. If you looked and found nothing, choose Not Found.',
    'Cross-border payments: “Maybe” isn’t a value the codebook allows. It can be Yes, No or Not Found.',
    'The evidence date 2026-02-31, on line 5, isn’t a real date.'
  ])
  // a row that isn't there, a value the codebook refuses and a source that isn't a link
  const missing = check(change('pay-ke-99', ['as_of = 2026-11-14', 'values.status = "Live"'], ['reason = "r"', 'sources = ["x"]']))
  assert.deepEqual(missing.problems, [
    '“pay-ke-99” isn’t a System ID in the data, so there’s no system to change.',
    'Status of Implementation: “Live” isn’t a value the codebook allows. It can be Planned/Piloted, Implemented, Suspended or Not Found.',
    'Status of Implementation: “x” isn’t a web address starting http:// or https://.'
  ])
  // a new system whose ID is taken, with a bad value and no reason
  const taken = check(create('pay-ke-01', { country: 'Kenya', qr_code: 'Maybe' }, 'reason = ""\n'))
  assert.equal(taken.problems.length, 3)
  assert.match(taken.problems[0], /^“pay-ke-01” is already a system, PesaLink/)
  assert.match(taken.problems[1], /^QR code based transactions: “Maybe”/)
  assert.equal(taken.problems[2], 'The change needs a reason.')
  // TOML that can't be read, or a changeset that isn't one, still stops at once
  assert.equal(check('[[changes]\n').problems.length, 1)
})

// D92: a row with no name is said by its place

test('a row with no name is named by its place and kind wherever the comment names it (D92)', () => {
  // pay-er-01 has no name and no status
  const result = check(update('pay-er-01', { status: 'Implemented' }, { as_of: '2026-10-01' }))
  assert.equal(result.applies, true)
  assert.equal(result.changes[0].unnamed, 'Eritrea, unnamed digital payment system')
  // accepting still names it by its System ID, as it always has
  assert.equal(result.changes[0].system, 'pay-er-01')
  assert.equal(commitMessage(7, result, 'changesets/next/payment/x.toml').subject, 'data: accepted proposal #7, pay-er-01')
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-er-01', system: 'pay-er-01', unnamed: 'Eritrea, unnamed digital payment system', dpiType: 'pay', before: 'NA', after: result.dpi.systems[0].after }])
  assert.deepEqual(result.warnings, ['The change to Status of Implementation for Eritrea, unnamed digital payment system (pay-er-01) is dated 2026-10-01, before the system’s Last updated, 2026-10-15. It would still replace the value.'])
  const text = comment(result)
  assert.match(text, /^\*\*Eritrea, unnamed digital payment system \(pay-er-01\):\*\* Status of Implementation, NA → Implemented\.$/m)
  assert.match(text, /^Eritrea, unnamed digital payment system \(pay-er-01\) would (?:become DPI-like|be in progress)/m)
  assert.match(text, /^- The change to Status of Implementation for Eritrea, unnamed digital payment system \(pay-er-01\) is dated 2026-10-01/m)
  // a removal, and the same for another kind of system
  assert.match(comment(check(remove('pay-er-01'))), /^\*\*Eritrea, unnamed digital payment system \(pay-er-01\):\*\* removed\.$/m)
  const id = check(update('id-gf-01', { biometrics: 'Yes' }))
  assert.match(comment(id), /^\*\*French Guiana, unnamed digital ID system \(id-gf-01\):\*\* /m)
  // a stale `# was`, and a replacement without a name, say it too
  const stale = check(update('pay-er-01', { status: 'Implemented' }, { was: 'Suspended' }))
  assert.deepEqual(stale.warnings, ['Status of Implementation for Eritrea, unnamed digital payment system (pay-er-01) was “Suspended” when this was proposed, and is “NA” now.'])
  assert.match(comment(check(remove('pay-ke-01', 'pay-er-01'))), /^\*\*PesaLink \(pay-ke-01\):\*\* removed, replaced by Eritrea, unnamed digital payment system \(pay-er-01\)\.$/m)
  // named systems are as they were
  assert.match(comment(check(update('pay-ke-01', { qr_code: 'No' }))), /^\*\*PesaLink \(pay-ke-01\):\*\* QR code based transactions, Yes → No\.$/m)
})

// D92: a value confirmed as still true

test('a value that’s still true is a confirmation, with no warning and no DPI effect (D92)', () => {
  const toml = update('pay-ke-01', { status: 'Implemented', cross_border: 'Yes' }, { was: undefined }).replace(/^(values\.\w+ = .*)$/gm, '$1  # unchanged')
  const result = check(toml)
  assert.equal(result.applies, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.changes.map(c => [c.title, c.old, c.new]), [['Status of Implementation', 'Implemented', 'Implemented'], ['Cross-border payments', 'Yes', 'Yes']])
  assert.deepEqual(result.dpi.countries, [])
  const text = comment(result)
  assert.match(text, /^\*\*PesaLink \(pay-ke-01\):\*\* confirms Status of Implementation is still Implemented\.$/m)
  assert.match(text, /^\*\*PesaLink \(pay-ke-01\):\*\* confirms Cross-border payments is still Yes\.$/m)
  // the TOML under the line is the one thing here that says `# unchanged`
  assert.doesNotMatch(text.slice(0, text.indexOf('<details>')), /unchanged|already|would only add|To check/)
  // no DPI line: PesaLink's status is as it was
  assert.doesNotMatch(text, /DPI-like|in progress|Countries/)
  // the comment is also not needed to read it so: a hand-written update that sets the value is a confirmation too
  assert.match(comment(check(update('pay-ke-01', { status: 'Implemented' }))), /confirms Status of Implementation is still Implemented\./)
})

test('a confirmation of a Not Found value, and of an unnamed system’s, reads the same (D92)', () => {
  assert.match(comment(check(update('pay-ma-01', { settlement_method: 'Not Found' }))), /^\*\*[^*]*\(pay-ma-01\):\*\* confirms Settlement method is still Not Found\.$/m)
  assert.match(comment(check(update('pay-er-01', { realtime_active: 'No' }))), /^\*\*Eritrea, unnamed digital payment system \(pay-er-01\):\*\* confirms /m)
})

test('a `# unchanged` on a value that isn’t the live value any more is a gentle warning, like a stale `# was` (D92)', () => {
  const toml = update('pay-ke-01', { status: 'Suspended' }).replace(/^(values\.status = .*)$/m, '$1  # unchanged')
  const result = check(toml)
  assert.equal(result.applies, true)
  assert.deepEqual(result.warnings, ['Status of Implementation for PesaLink was proposed as still “Suspended”, but is “Implemented” now.'])
  assert.match(comment(result), /^\*\*PesaLink \(pay-ke-01\):\*\* Status of Implementation, Implemented → Suspended\.$/m)
  assert.match(comment(result), /^- Status of Implementation for PesaLink was proposed as still “Suspended”, but is “Implemented” now\.$/m)
})

test('the other warnings stay for a confirmation: a later pending change that sets the value, and a stale `# was` (D92)', () => {
  const log = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-test-'))
  try {
    fs.mkdirSync(path.join(log, 'next', 'payment'), { recursive: true })
    fs.writeFileSync(path.join(log, 'next', 'payment', '2026-11-13T100000Z-abcd.toml'), update('pay-ke-01', { status: 'Suspended' }, { as_of: '2026-11-15' }))
    const result = check(update('pay-ke-01', { status: 'Suspended' }, { as_of: '2026-11-14' }), log)
    // it's confirming what's waiting for the next release: the live value
    assert.deepEqual(result.warnings, [])
    const later = check(update('pay-ke-01', { status: 'Implemented' }, { as_of: '2026-11-14' }), log)
    assert.deepEqual(later.warnings, ['A change waiting for the next release, dated 2026-11-15, sets Status of Implementation for PesaLink to “Suspended”, so this change wouldn’t show.'])
  } finally {
    fs.rmSync(log, { recursive: true, force: true })
  }
})

// D96: the review's findings. Crafted inputs are from the adversarial review of the proposal pipeline.

/** An issue body as GitHub's form makes it, with `toml` as the changeset */
const issueBody = (text: string) => `### Changeset\n\n\`\`\`toml\n${text.trim()}\n\`\`\``
const suspended = (reason: string, source: string) => [
  '# PesaLink, Kenya', '[[changes]]', 'type = "update"', 'key = "pay-ke-01"', 'as_of = 2026-11-20', 'values.status = "Suspended"  # was "Implemented"',
  `reason = "${reason}"`, 'sources = [', `  "${source}",`, ']', ''
].join('\n')
const shown = suspended('Suspended per central bank notice', 'https://www.centralbank.go.ke/notice')
const hidden = suspended('PesaLink’s operators were arrested for fraud, see the court filing. Avoid this system.', 'https://evil.example/phishing-page')

test('an issue with a changeset in a hidden comment, or with two changeset blocks, is refused by the check (D96)', () => {
  // the review's hidden_body.md: GitHub shows the second block, the first was the one checked and committed
  const hiddenBody = `### Changeset\n\n<!--\n\`\`\`toml\nauthor = "Oli Evans <oli.evans@gmail.com>"\n${hidden}\`\`\`\n-->\n\n\`\`\`toml\n${shown}\`\`\`\n`
  const twoBlocks = `### Changeset\n\n\`\`\`toml\n${shown}\`\`\`\n\nAnd:\n\n\`\`\`toml\n${hidden}\`\`\`\n`
  const refusals = [
    hiddenBody, twoBlocks,
    // tildes, indentation up to 3 spaces, a longer fence, an info string, CRLF, a quote
    `${issueBody(shown)}\n\n~~~toml\n${hidden}~~~\n`,
    `${issueBody(shown)}\n\n   \`\`\`toml\n${hidden}   \`\`\`\n`,
    `${issueBody(shown)}\n\n\`\`\`\`TOML\n${hidden}\`\`\`\`\n`,
    `${issueBody(shown)}\n\n\`\`\`toml title="x"\n${hidden}\`\`\`\n`,
    `${issueBody(shown)}\n\n> \`\`\`toml\n> ${hidden.replaceAll('\n', '\n> ')}\n> \`\`\`\n`,
    issueBody(shown).replaceAll('\n', '\r\n') + '\r\n\r\n```toml\r\n' + hidden.replaceAll('\n', '\r\n') + '```\r\n',
    // an unclosed second block
    `${issueBody(shown)}\n\n\`\`\`toml\n${hidden}`,
    // hidden content anywhere, even with one block
    `${issueBody(shown)}\n\n<!-- not rendered -->`, `<!--\n-->\n${issueBody(shown)}`, `${issueBody(shown)}\n\n<details><summary>x</summary>more</details>`, `${issueBody(shown)}\n<DETAILS>`
  ]
  for (const body of refusals) {
    assert.equal(issueProblem(body), AMBIGUOUS_ISSUE, body)
    const result = checkIssueBody(body, { now, log: empty })
    assert.equal(result.applies, false, body)
    assert.deepEqual(result.problems, [AMBIGUOUS_ISSUE])
    assert.equal(result.sha256, undefined)
    const text = comment(result)
    // the comment escapes the backticks, as it escapes every text
    assert.match(text, /^- This issue has more than one changeset block, or hidden content\. Keep one \\`\\`\\`toml block and nothing hidden, so what’s reviewed is what’s committed\.$/m)
    assert.doesNotMatch(text, /sha256=/)
  }
  // the editor's own bodies, and another language's block, are fine
  for (const body of [issueBody(shown), issueBody(shown) + '\n\n```js\nalert(1)\n```\n', `### Summary\n\n_No response_\n\n${issueBody(shown)}`, '### Changeset\n\n_No response_']) {
    assert.equal(issueProblem(body), undefined, body)
  }
  const ok = checkIssueBody(issueBody(shown), { now, log: empty })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.applies, true)
  assert.equal(checkIssueBody('### Changeset\n\n_No response_', { now, log: empty }).found, false)
})

test('what the editor writes never has hidden markup: it refuses it in what a person types (D96)', () => {
  assert.match(evidenceProblems('status', 'The change', { reason: 'See <!-- this', sources: [], as_of: '2026-11-14' })[0].message, /^The change: the reason can’t have “<!--” or “<details”, which hide text in an issue\.$/)
  assert.equal(evidenceProblems('status', 'The change', { reason: 'See <DETAILS> this', sources: [], as_of: '2026-11-14' }).length, 1)
  assert.equal(evidenceProblems('status', 'The change', { reason: 'See <b>this</b>', sources: [], as_of: '2026-11-14' }).length, 0)
  assert.equal(evidenceProblems('status', 'The change', { reason: 'ok', sources: ['https://example.org/<details>'], as_of: '2026-11-14' }).length, 1)
  // so the check refuses the same in a proposal's TOML, with the same sentence
  const result = check(update('pay-ke-01', { qr_code: 'No' }).replace('annual report says so.', 'annual report <!-- says so.'))
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['QR code based transactions: the reason can’t have “<!--” or “<details”, which hide text in an issue.'])
  assert.deepEqual(check(update('pay-ke-01', { name: 'Pesa<details>Link' })).problems, ['Payment system name can’t have “<!--” or “<details”, which hide text in an issue.'])
})

test('the editor’s own issue body for a proposal is accepted by the issue rules (D96)', () => {
  const body = issueBody(update('pay-ke-01', { status: 'Planned/Piloted' }, { was: 'Implemented' }) + '\n')
  assert.equal(issueProblem(body), undefined)
  assert.equal(checkIssueBody(body, { now, log: empty }).applies, true)
})

test('the comment ends with the TOML it fingerprinted, collapsed, and each change’s evidence under its line (D96)', () => {
  const toml = update('pay-ke-01', { cross_border: 'No', transaction_types: 'P2P, P2M, G2P' }, {})
    + '\n' + [
      '[[changes]]', 'type = "update"', 'key = "pay-ke-01"', 'as_of = 2026-11-10', 'values.name = "PesaLink 2"',
      'reason = "Renamed *by* the <b>operator</b> @someone."', 'sources = ["https://example.org/a_b", "https://example.org/c*d"]', ''
    ].join('\n')
  const result = check(toml)
  assert.deepEqual(result.problems, [])
  assert.equal(result.toml, toml)
  const text = comment(result)
  const lines = text.split('\n')
  // the TOML is the end, in a collapsed section, exactly as fingerprinted
  const open = '<details><summary>The changeset that closing this commits</summary>'
  assert.equal(lines.at(-2), '</details>')
  assert.equal(lines[lines.indexOf(open) + 1], '')
  assert.equal(lines[lines.indexOf(open) + 2], '```toml')
  assert.ok(text.endsWith(`\n\`\`\`toml\n${toml.replace(/\n$/, '')}\n\`\`\`\n\n</details>\n`))
  assert.equal(fingerprint(toml), commentFingerprint(text)!.sha256)
  // the evidence: one under the two lines of the first change, one under the second; sources are code spans, not links
  const above = text.slice(0, text.indexOf(open))
  assert.match(above, /^\*\*PesaLink \(pay-ke-01\):\*\* Cross-border payments, Yes → No\.\n\*\*PesaLink \(pay-ke-01\):\*\* Types of transactions supported, P2P, P2M → P2P, P2M, G2P\.\n&nbsp;&nbsp;&nbsp;&nbsp;Reason: The operator’s 2026 annual report says so\. · Sources: `https:\/\/example\.org\/report-2026\.pdf` · As of 2026-11-14\n/m)
  assert.match(above, /^&nbsp;&nbsp;&nbsp;&nbsp;Reason: Renamed \\\*by\\\* the \\<b\\>operator\\<\/b\\> @​someone\. · Sources: `https:\/\/example\.org\/a_b`, `https:\/\/example\.org\/c\*d` · As of 2026-11-10$/m)
  assert.equal(above.split('&nbsp;').length > 2, true)
  assert.deepEqual(result.evidence!.map(e => [e.change, e.as_of, e.sources.length]), [[0, '2026-11-14', 1], [1, '2026-11-10', 2]])
  // a change with no sources says none; a remove's and a new system's evidence are shown too
  assert.match(comment(check(update('pay-ke-01', { name: 'X' }).replace(/sources = \[\n.*\n\]\n/, ''))), / · Sources: none · As of 2026-11-14$/m)
  assert.match(comment(check(remove('pay-ke-01', 'pay-ke-02'))), /^&nbsp;&nbsp;&nbsp;&nbsp;Reason: Merged into its successor\. · Sources: `https:\/\/example\.org\/merger` · As of 2026-11-14$/m)
  const created = comment(check(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }) + '\n' + update('pay-ke-03', { status: 'Planned/Piloted' }).replace(/^#.*\n/, '')))
  assert.match(created, /^&nbsp;&nbsp;&nbsp;&nbsp;Adding it: Reason: Launched in 2026, as the operator announced\. · Sources: `https:\/\/example\.org\/launch` · As of 2026-11-14$/m)
  assert.match(created, /^&nbsp;&nbsp;&nbsp;&nbsp;Status of Implementation: Reason: The operator’s 2026 annual report says so\./m)
  // a comment for a proposal that can't be applied has no TOML and no evidence
  assert.doesNotMatch(comment(check(update('pay-ke-01', { status: 'Bogus' }))), /<details>|&nbsp;/)
})

test('TOML can’t break out of the comment’s fence, whatever backticks it has (D96)', () => {
  assert.deepEqual(tomlDetails('a\n').slice(2, 3), ['```toml'])
  for (const run of [3, 4, 5, 9]) {
    const ticks = '`'.repeat(run)
    // a reason over several lines (a TOML """ string), with lines that are fences, a closing tag and Markdown
    const toml = [
      '# A system, Somewhere', '[[changes]]', 'type = "update"', 'key = "pay-ke-01"', 'as_of = 2026-11-14', 'values.qr_code = "No"',
      'reason = """', `Before ${ticks} in a line`, ticks, `${ticks}toml`, `${ticks}${ticks}`, '~~~', '</details>', '[click](https://evil.example) @olizilla', 'after"""',
      'sources = ["https://example.org/x"]', ''
    ].join('\n')
    const result = check(toml)
    assert.equal(result.applies, true, result.problems.join(' '))
    const text = comment(result)
    const lines = text.split('\n')
    const start = lines.findIndex(line => /^`{3,}toml$/.test(line) && lines[lines.indexOf(line) - 1] === '')
    const fence = lines[start].slice(0, -4)
    assert.ok(fence.length > run, `a fence of ${fence.length} for a run of ${run}`)
    // the fence's end is the last line before </details>, no line of the TOML is one, and the TOML between is whole
    const end = lines.lastIndexOf(fence)
    assert.equal(lines[end + 2], '</details>')
    assert.ok(!lines.slice(start + 1, end).some(line => /^`{3,}\s*$/.test(line) && line.length >= fence.length))
    assert.equal(lines.slice(start + 1, end).join('\n') + '\n', toml)
  }
  // code spans for sources: a source with backticks
  assert.equal(code('https://x.org/a`b'), '``https://x.org/a`b``')
  assert.equal(code('`a`'), '`` `a` ``')
})

test('the comment stays within GitHub’s 65,536 characters, at the TOML size limit (D96)', () => {
  const base = update('pay-ke-01', { qr_code: 'No' })
  // plain letters reach GitHub's limit first: the largest TOML an issue can hold, with the form's wrapper
  const fill = (n: number) => base + `# ${'x'.repeat(n)}\n`
  // the issue body is at most 65,536 characters: the form's wrapper and the trimmed TOML
  const n = MAX_ISSUE_CHARACTERS - ISSUE_WRAPPER.length - base.trim().length - '\n# '.length
  assert.equal(ISSUE_WRAPPER.length + fill(n).trim().length, MAX_ISSUE_CHARACTERS)
  const largest = check(fill(n))
  assert.equal(largest.applies, true, largest.problems.join(' '))
  assert.ok(check(fill(n + 1)).problems.length > 0)
  const text = comment(largest)
  assert.ok(text.length <= COMMENT_LIMIT, `${text.length} characters`)
  assert.doesNotMatch(text, /<details>/)
  assert.match(text, /The full changeset is in the issue/)
  assert.match(text, /Reason: The operator’s 2026 annual report says so\./)
  assert.equal(commentFingerprint(text)!.sha256, fingerprint(fill(n)))
  // a TOML that fits is shown; just over the comment's limit, it isn't
  const small = comment(check(fill(40_000)))
  assert.ok(small.length <= COMMENT_LIMIT && small.includes('<details>'))
  // 64 KB of a 2-byte character is 32,768 characters, which fits with its evidence
  assert.ok(comment(check(base + `# ${'é'.repeat(32_000)}\n`)).length <= COMMENT_LIMIT)
  // anything else that makes it too long is cut, with the marker first and a note
  const huge = { ...check(base), warnings: Array.from({ length: 3000 }, (_, i) => `Warning ${i} ${'w'.repeat(40)}`) }
  const cut = proposalComment(huge)
  assert.ok(cut.length <= COMMENT_LIMIT)
  assert.equal(cut.split('\n')[0], markerLine(huge))
  assert.match(cut, /cut short to fit GitHub’s limit/)
})

test('a proposal can’t name its author or have a summary: attribution isn’t the changeset’s to say (D96)', () => {
  const body = update('pay-ke-01', { status: 'Suspended' })
  // the review's B_author.toml
  const toml = `author = "Oli Evans <oli.evans@gmail.com>"\nsummary = "<script>alert(1)</script> [click](https://evil.example) @olizilla"\n${body}`
  const result = check(toml)
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, [
    'A proposal can’t name its author: attribution, when the map uses it, comes from the account that opened the issue, not from the changeset.',
    'A proposal can’t have a summary: each change’s reason says why. Take the summary out.'
  ])
  const text = comment(result)
  assert.doesNotMatch(text, /script|evil|@(?!​)/)
  assert.deepEqual(check(`author = "A Person <a@example.org>"\n${body}`).problems.length, 1)
  assert.deepEqual(check(`summary = "Why"\n${body}`).problems.length, 1)
  assert.equal(check(body).applies, true)
})

test('an update can’t change a system’s country, but a new system sets it (D96)', () => {
  // the review's D_country.toml
  const toml = '[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-20\nvalues.country = "Uganda"\nreason = "r"\nsources = ["https://example.org/notice"]\n'
  const result = check(toml)
  assert.equal(result.applies, false)
  assert.deepEqual(result.problems, ['A system’s place can’t change: its System ID names it. Propose a new system in the right place, and remove this one.'])
  assert.equal(check(update('pay-ke-01', { country: 'Uganda', status: 'Suspended' })).applies, false)
  const created = check(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' }))
  assert.deepEqual(created.problems, [])
  assert.equal(created.applies, true)
})

test('a new System ID has exactly two digits (D96)', () => {
  for (const key of ['pay-ke-100', 'pay-ke-99999999', 'pay-ke-007']) {
    const result = check(create(key, { country: 'Kenya', name: 'PesaLink 2' }))
    assert.equal(result.applies, false, key)
    assert.deepEqual(result.problems, [`“${key}”: a new System ID ends in exactly two digits, like pay-ke-03.`])
  }
  assert.equal(check(create('pay-ke-03', { country: 'Kenya', name: 'PesaLink 2' })).applies, true)
  assert.equal(check(create('id-ke-04', { country: 'Kenya', name: 'x' })).applies, true)
  // a one-digit one isn't a System ID at all
  assert.equal(check(create('pay-ke-3', { country: 'Kenya', name: 'PesaLink 2' })).applies, false)
})

test('a field id that’s on Object.prototype is just not a field, with no “was a field in” (D96)', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const result = check(`[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nvalues.${id} = "x"\nreason = "r"\nsources = ["https://example.org/x"]\n`)
    assert.equal(result.applies, false, id)
    assert.doesNotMatch(result.problems.join(' '), /function|was a field in/, id)
  }
  assert.deepEqual(check('[[changes]]\ntype = "update"\nkey = "pay-ke-01"\nas_of = 2026-11-14\nvalues.constructor = "x"\nreason = "r"\nsources = ["https://example.org/x"]\n').problems, ['“constructor” isn’t a field of digital payment systems, so it can’t be set.'])
})
