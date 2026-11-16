// Accepting a proposal (scripts/proposal-accept.ts, D88): every reason to refuse and the accept, the
// fingerprint, the path, which no text in the issue can steer, the commit message, which names no one (D69),
// the size limit, and writing and committing the one file, in a git repo of the test's own with a stand-in
// for data:check. The checks run against the 2026-11-06 release and an empty log, so changesets/next/
// doesn't change the results, and nothing is written in the repo.
// Run with: node --test src/ProposalAccept.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CHANGESET_ID } from '../lib/changesets/index.ts'
import { changesetInIssue, proposalCheck } from '../scripts/proposal-check.ts'
import { proposalComment } from '../scripts/proposal-comment.ts'
import { ISSUE_WRAPPER } from './Proposal.ts'
import {
  AcceptError, applyProposal, BOT, changesetPath, checkComment, commitMessage, decide, FAILED, fileText, MAX_BYTES, MAX_ISSUE_CHARACTERS, onlyNewFile,
  REASONS, refusalComment, verifyCommit, type Comment, type DecideInput, type IssueEvent
} from '../scripts/proposal-accept.ts'

const now = new Date('2026-11-15T12:00:00Z')
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-accept-test-'))
const check = (text: string) => proposalCheck(text, { now: new Date('2026-11-15T11:00:00Z'), log: empty })

/** A proposal as the editor writes it (D87): a header comment, and a `# was` comment on the value */
const toml = [
  '# PesaLink, Kenya',
  '[[changes]]',
  'type = "update"',
  'key = "pay-ke-01"',
  'as_of = 2026-11-14',
  'values.status = "Planned/Piloted"  # was "Implemented"',
  'reason = "The operator’s 2026 annual report says so."',
  'sources = [',
  '  "https://example.org/report-2026.pdf",',
  ']',
  ''
].join('\n')
const body = (text: string) => `### Changeset\n\n\`\`\`toml\n${text}\`\`\`\n`

/** The closing event: closed as completed by a teammate, `bob`, an hour after it was checked */
function event (more: { action?: string, state_reason?: string | null, labels?: string[], author?: string, sender?: string, body?: string } = {}): IssueEvent {
  return {
    action: more.action ?? 'closed',
    issue: {
      number: 83,
      body: more.body ?? body(toml),
      state_reason: more.state_reason === undefined ? 'completed' : more.state_reason,
      closed_at: '2026-11-15T12:00:00Z',
      user: { login: more.author ?? 'alice' },
      labels: (more.labels ?? ['proposal']).map(name => ({ name }))
    },
    sender: { login: more.sender ?? 'bob' }
  }
}

/** The check's comment, as the check workflow posts it for `text` */
const commentFor = (text: string, more: Partial<Comment> = {}): Comment => ({
  user: BOT, body: proposalComment(check(text)), updated_at: '2026-11-15T11:00:30Z', ...more
})

const checked = check(toml)
/** Everything as it is when a teammate accepts: no edit since an hour before it was closed */
function input (more: Partial<DecideInput> = {}): DecideInput {
  const e = more.event ?? event()
  const text = 'toml' in more ? more.toml : changesetInIssue(String(e.issue?.body ?? ''))
  return { event: e, role: 'triage', comment: commentFor(toml), lastEditedAt: '2026-11-15T10:59:00Z', toml: text, check: checked, now, ...more }
}
const refused = (reason: string, reopen = true) => ({ action: 'refuse', reason, reopen })

test('a proposal closed as completed by a teammate, checked and left alone, is accepted', () => {
  assert.equal(checked.applies, true)
  assert.deepEqual(decide(input()), { action: 'accept' })
  for (const role of ['triage', 'write', 'maintain', 'admin']) assert.deepEqual(decide(input({ role })), { action: 'accept' })
  // never edited
  assert.deepEqual(decide(input({ lastEditedAt: null })), { action: 'accept' })
})

test('closed as not planned, not a proposal, or by a pull request: refused, and left closed', () => {
  assert.deepEqual(decide(input({ event: event({ state_reason: 'not_planned' }) })), refused(REASONS.notCompleted, false))
  assert.deepEqual(decide(input({ event: event({ state_reason: null }) })), refused(REASONS.notCompleted, false))
  assert.deepEqual(decide(input({ event: event({ action: 'reopened' }) })), refused(REASONS.notCompleted, false))
  assert.deepEqual(decide(input({ event: event({ labels: ['bug'] }) })), refused(REASONS.notProposal, false))
  // a pull request or a commit that closes it has its changes already
  assert.deepEqual(decide(input({ closer: 'PullRequest' })), refused(REASONS.closedBy, false))
  assert.deepEqual(decide(input({ closer: 'Commit' })), refused(REASONS.closedBy, false))
  assert.deepEqual(decide(input({ closer: null })), { action: 'accept' })
})

test('closed by its author, or by someone without triage access: refused and reopened', () => {
  const byAuthor = decide(input({ event: event({ sender: 'alice' }) }))
  assert.deepEqual(byAuthor, refused('Proposals need to be accepted by someone other than the person who proposed them.'))
  // even an admin can't accept their own
  assert.deepEqual(decide(input({ event: event({ sender: 'alice' }), role: 'admin' })), byAuthor)
  for (const role of ['read', 'none', '', null, undefined, 'custom-role']) assert.deepEqual(decide(input({ role })), refused(REASONS.role))
  assert.deepEqual(decide(input({ event: { ...event(), sender: null } })), refused(REASONS.author))
})

test('no changeset in the issue, or one too large, over 64 KB or GitHub’s 65,536 characters: refused', () => {
  assert.deepEqual(decide(input({ event: event({ body: '### Changeset\n\n_No response_' }) })), refused(REASONS.noChangeset))
  const big = toml + `# ${'x'.repeat(MAX_BYTES)}\n`
  assert.deepEqual(decide(input({ event: event({ body: body(big) }), comment: commentFor(big), check: undefined })), refused(REASONS.tooLarge))
  // bytes, not characters: 32 KB of a two-byte character is too large
  const wide = `# ${'é'.repeat(MAX_BYTES / 2)}\n`
  assert.ok(wide.length < MAX_BYTES)
  assert.deepEqual(decide(input({ toml: wide })), refused(REASONS.tooLarge))
  // exactly 64 KB of a two-byte character isn't over, and a byte more is
  const twoByte = (n: number) => `#${'é'.repeat(n)}\n`
  assert.equal(Buffer.byteLength(twoByte(32_767)), MAX_BYTES)
  assert.notDeepEqual(decide(input({ toml: twoByte(32_767) })), refused(REASONS.tooLarge))
  assert.deepEqual(decide(input({ toml: twoByte(32_767) + '#' })), refused(REASONS.tooLarge))
  // plain letters reach GitHub's 65,536 characters first, with the form's wrapper around the TOML (D89)
  const ascii = (n: number) => '#'.repeat(n) + '\n'
  assert.equal(ISSUE_WRAPPER.length + ascii(65_509).trim().length, MAX_ISSUE_CHARACTERS)
  assert.notDeepEqual(decide(input({ toml: ascii(65_509) })), refused(REASONS.tooLarge))
  assert.deepEqual(decide(input({ toml: ascii(65_510) })), refused(REASONS.tooLarge))
  assert.ok(Buffer.byteLength(ascii(65_510)) < MAX_BYTES)
})

test('the fingerprint: the check’s comment must be the bot’s, for the TOML as it is now', () => {
  // a match is above; a missing comment
  assert.deepEqual(decide(input({ comment: undefined })), refused(REASONS.notChecked))
  // a comment with the marker, but not the bot's
  assert.deepEqual(decide(input({ comment: { ...commentFor(toml), user: 'mallory' } })), refused(REASONS.notChecked))
  // the bot's comment from before it had a fingerprint
  assert.deepEqual(decide(input({ comment: commentFor(toml, { body: '<!-- dpimap-proposal-check -->\nHello\n' }) })), refused(REASONS.notChecked))
  // a mismatch: the comment is for another version, even one that only differs in a comment
  const other = toml.replace('# PesaLink, Kenya', '# PesaLink, Kenya (edited)')
  assert.deepEqual(decide(input({ comment: commentFor(other) })), refused(REASONS.otherVersion))
  assert.deepEqual(decide(input({ event: event({ body: body(other) }) })), refused(REASONS.otherVersion))
  // the fresh check must be of the same TOML too
  assert.deepEqual(decide(input({ check: check(other) })), refused(REASONS.notChecked))
  assert.deepEqual(decide(input({ check: undefined })), refused(REASONS.notChecked))
})

test('the check’s comment is found as the check workflow finds it: the bot’s, with the marker', () => {
  const mine = commentFor(toml)
  const comments: Comment[] = [
    { user: 'mallory', body: `<!-- dpimap-proposal-check sha256=${'0'.repeat(64)} -->\n`, updated_at: '2026-11-15T11:59:00Z' },
    { user: BOT, body: 'Committed as …', updated_at: '2026-11-15T11:59:00Z' },
    mine
  ]
  assert.equal(checkComment(comments), mine)
  assert.equal(checkComment(comments.slice(0, 2)), undefined)
})

test('edited after the check, or less than 5 minutes before closing, or after: refused', () => {
  assert.deepEqual(decide(input({ lastEditedAt: '2026-11-15T11:01:00Z' })), refused(REASONS.editedAfterCheck))
  // the check updated its comment after the edit, but the edit was 4 minutes before closing
  const late = input({ lastEditedAt: '2026-11-15T11:56:00Z', comment: commentFor(toml, { updated_at: '2026-11-15T11:56:40Z' }) })
  assert.deepEqual(decide(late), refused('This was edited just before it was closed. Please read the latest version and close it again.'))
  // 5 minutes is enough
  assert.deepEqual(decide({ ...late, lastEditedAt: '2026-11-15T11:55:00Z' }), { action: 'accept' })
  // edited after it was closed
  assert.deepEqual(decide(input({ lastEditedAt: '2026-11-15T12:01:00Z', comment: commentFor(toml, { updated_at: '2026-11-15T12:01:30Z' }) })), refused(REASONS.editedJustBefore))
  // a time that can't be read refuses
  assert.deepEqual(decide(input({ lastEditedAt: 'yesterday' })), refused(REASONS.editedAfterCheck))
  assert.deepEqual(decide(input({ comment: commentFor(toml, { updated_at: undefined }) })), refused(REASONS.editedAfterCheck))
})

test('a proposal the check says can’t be applied: refused, with its problems, escaped', () => {
  const bad = toml.replace('Planned/Piloted', 'Live <b>@someone</b>')
  const result = check(bad)
  assert.equal(result.applies, false)
  const decision = decide(input({ event: event({ body: body(bad) }), comment: commentFor(bad), check: result }))
  assert.deepEqual(decision, refused(REASONS.cantApply))
  assert.equal(refusalComment(decision as never, result),
    'This can’t be applied as it is now, so it wasn’t committed:\n\n- Status of Implementation: “Live \\<b\\>@​someone\\</b\\>” isn’t a value the codebook allows. It can be Planned/Piloted, Implemented, Suspended or Not Found.\n')
  // another reason is one sentence
  assert.equal(refusalComment(refused(REASONS.author) as never), `${REASONS.author}\n`)
})

test('every reason is one plain sentence or two, with no one’s name', () => {
  for (const reason of Object.values(REASONS)) {
    assert.match(reason, /^[A-Z].*[.:]$/)
    assert.doesNotMatch(reason, /alice|bob|@/)
  }
})

test('the path is built from the checked table and a new id, and nothing in the issue can steer it', () => {
  const id = '2026-11-15T120000Z-ab12'
  assert.equal(changesetPath('payment', id), 'changesets/next/payment/2026-11-15T120000Z-ab12.toml')
  assert.equal(changesetPath(checked.resource!, id), 'changesets/next/payment/2026-11-15T120000Z-ab12.toml')
  for (const resource of ['../payment', 'payment/../..', 'places', 'payment/x', '', 'constructor', '__proto__']) assert.throws(() => changesetPath(resource, id), /not a DPI table/)
  for (const bad of ['../../x', '2026-11-15T120000Z-ab12/../../x', '2026-11-15T120000Z-AB12', 'x']) assert.throws(() => changesetPath('payment', bad), /not a changeset id/)

  // a System ID with a path in it isn't a System ID, so the check finds no table, and it's refused
  const sneaky = toml.replace('pay-ke-01', 'pay-../../x')
  const result = check(sneaky)
  assert.equal(result.applies, false)
  assert.equal(result.resource, undefined)
  assert.deepEqual(decide(input({ event: event({ body: body(sneaky) }), comment: commentFor(sneaky), check: result })), refused(REASONS.cantApply))

  // the header comment says identity, but the key is a payment system's: the table is the key's
  const misleading = toml.replace('# PesaLink, Kenya', '# identity/../../../etc, Kenya\n# [identity]')
  const table = check(misleading)
  assert.equal(table.applies, true)
  assert.equal(table.resource, 'payment')
  assert.equal(changesetPath(table.resource!, id), 'changesets/next/payment/2026-11-15T120000Z-ab12.toml')
})

test('the file is the TOML as written, comments and all, with a newline at the end (D87)', () => {
  assert.equal(fileText(toml), toml)
  assert.equal(fileText('a = 1'), 'a = 1\n')
  assert.match(fileText(toml), /^# PesaLink, Kenya\n/)
  assert.match(fileText(toml), /# was "Implemented"$/m)
})

test('the commit message names the system and the issue, and no person (D69)', () => {
  const message = commitMessage(83, checked, 'changesets/next/payment/2026-11-15T120000Z-ab12.toml')
  assert.deepEqual(message, {
    subject: 'data: accepted proposal #83, PesaLink (pay-ke-01)',
    body: 'Accepted from #83. Adds changesets/next/payment/2026-11-15T120000Z-ab12.toml.'
  })
  // a system name with an @ or a # can't mention or link anything, and stays on one line
  const named = commitMessage(5, { ...checked, changes: [{ change: 0, type: 'create', key: 'pay-ke-99', system: 'Pay @alice #12\nnext line' }] }, 'f')
  assert.equal(named.subject, 'data: accepted proposal #5, Pay alice 12 next line (pay-ke-99)')
  const two = commitMessage(5, { ...checked, changes: [{ change: 0, type: 'update', key: 'pay-ke-01', system: 'PesaLink' }, { change: 1, type: 'update', key: 'pay-ke-01', system: 'PesaLink' }, { change: 2, type: 'remove', key: 'pay-ke-02', system: 'MPesa' }] }, 'f')
  assert.equal(two.subject, 'data: accepted proposal #5, PesaLink (pay-ke-01) and 1 more')
})

test('git status must list the one new file and nothing else', () => {
  const file = 'changesets/next/payment/2026-11-15T120000Z-ab12.toml'
  assert.equal(onlyNewFile(`?? ${file}\n`, file), true)
  assert.equal(onlyNewFile(`?? ${file}\n M datapackage.json\n`, file), false)
  assert.equal(onlyNewFile(` M ${file}\n`, file), false)
  assert.equal(onlyNewFile('?? changesets/next/payment/\n', file), false)
  assert.equal(onlyNewFile('', file), false)
})

/** A git repo of the test's own, with one commit */
function repo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-accept-repo-'))
  const git = (...args: string[]) => {
    const ran = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(ran.status, 0, ran.stderr)
    return ran.stdout
  }
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'github-actions[bot]')
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
  git('config', 'commit.gpgsign', 'false')
  fs.mkdirSync(path.join(dir, 'changesets', 'next'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'changesets', 'next', 'README.md'), 'Pending\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'init')
  return { dir, git }
}
const passes = () => ({ status: 0, stdout: 'data:check passed\n', stderr: '' })
const file = 'changesets/next/payment/2026-11-15T120000Z-ab12.toml'
const message = { subject: 'data: accepted proposal #83, PesaLink (pay-ke-01)', body: `Accepted from #83. Adds ${file}.` }

test('a dry run writes the file, checks with it in place, and leaves the checkout as it was', () => {
  const { dir, git } = repo()
  try {
    let seen = ''
    const result = applyProposal({ root: dir, file, toml, message, dryRun: true, dataCheck: () => { seen = fs.readFileSync(path.join(dir, file), 'utf8'); return passes() } })
    assert.equal(seen, toml)
    assert.deepEqual(result, { dataCheck: 'data:check passed\n' })
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
    assert.equal(fs.existsSync(path.join(dir, 'changesets', 'next', 'payment')), false)
    assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('accepting commits the one file, as written, with the message', () => {
  const { dir, git } = repo()
  try {
    const { sha } = applyProposal({ root: dir, file, toml, message, dataCheck: passes })
    assert.equal(sha, git('rev-parse', 'HEAD').trim())
    assert.equal(git('show', '--format=%an%n%B', '--no-patch', 'HEAD'), `github-actions[bot]\n${message.subject}\n\n${message.body}\n\n`)
    assert.equal(git('diff', '--name-status', 'HEAD~1', 'HEAD'), `A\t${file}\n`)
    assert.equal(git('show', `HEAD:${file}`), toml)
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
    // and it verifies after a rebase
    verifyCommit({ root: dir, file, dataCheck: passes })
    assert.throws(() => verifyCommit({ root: dir, file: file.replace('ab12', 'cd34'), dataCheck: passes }), AcceptError)
    assert.throws(() => verifyCommit({ root: dir, file, dataCheck: () => ({ status: 1, stdout: 'FAILED', stderr: '' }) }), (e: AcceptError) => e.reason === FAILED.dataCheck)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a commit that changes another file doesn’t verify', () => {
  const { dir, git } = repo()
  try {
    fs.mkdirSync(path.join(dir, 'changesets', 'next', 'payment'))
    fs.writeFileSync(path.join(dir, file), toml)
    fs.writeFileSync(path.join(dir, 'changesets', 'next', 'README.md'), 'Changed\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'two files')
    assert.throws(() => verifyCommit({ root: dir, file, dataCheck: passes }), /HEAD doesn't just add/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing is committed if the checkout isn’t clean, the data check fails or anything else changes', () => {
  const { dir, git } = repo()
  try {
    // a change before it starts
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'x')
    assert.throws(() => applyProposal({ root: dir, file, toml, message, dataCheck: passes }), /has changes before/)
    assert.equal(fs.existsSync(path.join(dir, file)), false)
    fs.rmSync(path.join(dir, 'stray.txt'))
    // the data check fails
    assert.throws(() => applyProposal({ root: dir, file, toml, message, dataCheck: () => ({ status: 1, stdout: 'data:check FAILED\n', stderr: '' }) }),
      (e: AcceptError) => e instanceof AcceptError && e.reason === FAILED.dataCheck)
    // something else changes while it checks
    assert.throws(() => applyProposal({ root: dir, file, toml, message, dataCheck: () => { fs.writeFileSync(path.join(dir, 'changesets', 'next', 'README.md'), 'Changed\n'); return passes() } }),
      /git status isn't just/)
    git('checkout', '--quiet', '--', '.')
    // each time the file is removed, and there's no commit
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
    assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1')
    // a file that's already there isn't overwritten
    fs.mkdirSync(path.join(dir, 'changesets', 'next', 'payment'))
    fs.writeFileSync(path.join(dir, file), 'already\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'already')
    assert.throws(() => applyProposal({ root: dir, file, toml, message, dataCheck: passes }), /EEXIST/)
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), 'already\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a new id is a changeset id', () => {
  assert.match(path.basename(changesetPath('identity', '2026-11-15T120000Z-0f0f'), '.toml'), CHANGESET_ID)
})

test.after(() => fs.rmSync(empty, { recursive: true, force: true }))
