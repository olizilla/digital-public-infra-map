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
import { changesetInIssue, fingerprint, notFound, proposalCheck, type ProposalResult } from '../scripts/proposal-check.ts'
import { commentFingerprint, MARKER, markerLine, proposalComment } from '../scripts/proposal-comment.ts'

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
  assert.match(text, /<sub>Closing this as completed commits it for the next release, and a line naming the file appears here\. If none appears within a few minutes, reopen this and close it again\.<\/sub>\n$/)
  assert.doesNotMatch(text, /To check/)
})

test('a change that doesn’t change a DPI status has no DPI line', () => {
  // PesaLink is in progress either way: a bank association runs it
  const result = check(update('pay-ke-01', { status: 'Planned/Piloted' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.dpi.systems, [{ key: 'pay-ke-01', system: 'PesaLink', dpiType: 'pay', before: 'WIP', after: 'WIP' }])
  assert.deepEqual(result.dpi.countries, [])
  assert.equal(comment(result).split('\n').filter(line => line && !line.startsWith('<')).length, 1)
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

test('a change older than the row’s Last updated, and a value that’s already set, are warnings (D46)', () => {
  const result = check(update('pay-ke-01', { cross_border: 'Yes' }, { as_of: '2025-01-01' }))
  assert.equal(result.applies, true)
  assert.deepEqual(result.warnings, [
    'The change to Cross-border payments for PesaLink is dated 2025-01-01, before the system’s Last updated, 2026-10-15. It would still replace the value.',
    'Cross-border payments for PesaLink is already “Yes”, so this change would only add its reason and sources.'
  ])
  assert.match(comment(result), /Cross-border payments, Yes \(unchanged\)\./)
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
  assert.deepEqual(missing.problems, ['The change has no evidence date.', 'The change has no reason.', 'The change: “not a url” isn’t a web address starting http:// or https://.'])
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
  assert.deepEqual(check(toml.replace('  PesaLink 2\\t', ' \\t ')).problems, ['Payment system name needs a value. If you looked and found nothing, tick Not Found.'])
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
  assert.deepEqual(refused(updates('values.name = "   "')), ['Payment system name needs a value. If you looked and found nothing, tick Not Found.'])
  assert.deepEqual(refused(updates('values.name = "Pesa\\u0000Link"')), ['Payment system name can’t have a line break, a tab or another control character.'])
  assert.deepEqual(refused(updates('values.name = "Pesa\\nLink"')), ['Payment system name can’t have a line break, a tab or another control character.'])
  assert.deepEqual(refused(removal('duplicate_of = "pay-ke-01"\n')), ['The replacement, pay-ke-01, is this system. Name another system, or none.'])
  assert.deepEqual(refused(removal('duplicate_of = "id-ke-01"\n')), ['“id-ke-01” isn’t a digital payment System ID, like pay-ke-01.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"') + removal()), ['A proposal either changes values or removes the system, not both. Undo the changed values, or don’t propose removing it.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"') + updates('values.qr_code = "Yes"')), ['QR code based transactions is changed twice. Change each field once.'])
  assert.equal(refused(removal() + removal())[0], 'It removes “pay-ke-01” more than once.')
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "  "\nsources = ["https://example.org/x"]\n')), ['QR code based transactions needs a reason.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"', `reason = "${'ب'.repeat(501)}"\nsources = ["https://example.org/x"]\n`)), ['QR code based transactions: the reason is 501 characters, over the 500 it can be.'])
  // the schema's own words, for a source that isn't a link or is there twice
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "A reason."\nsources = ["example.org/report"]\n')), ['The change: “example.org/report” isn’t a web address starting http:// or https://.'])
  assert.deepEqual(refused(updates('values.qr_code = "No"', 'reason = "A reason."\nsources = ["https://example.org/x", "https://example.org/x"]\n')), ['The change lists a source twice.'])
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
  assert.match(text, /^\*\*New system:\*\* would add PesaLink 2 \(pay-ke-03\), with Country \/ Region, Kenya; Payment system name, PesaLink 2; Status of Implementation, Planned\/Piloted\.$/m)
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
