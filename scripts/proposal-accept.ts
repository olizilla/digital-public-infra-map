// Accept a proposal (D88): when someone on the team closes a `proposal` issue as completed, commit its
// changeset to changesets/next/ on the default branch, for the next release. Closing it as not planned
// declines it, and nothing happens. .github/workflows/proposal-accept.yml runs this on the closing event.
//
// decide() says whether to accept, from the event, the closer's role, the check's comment
// (scripts/proposal-comment.ts), the body's last edit and a fresh check (scripts/proposal-check.ts). It
// accepts only if the issue was closed as completed, by a person, not by a pull request or a commit (a batch
// PR that closes its proposals has their changes already), and has the `proposal` label; the closer isn't its
// author and has triage access or more; the TOML isn't too large: at most 64 KB, and an issue body of at most
// GitHub's 65,536 characters, counted as the editor and the check count it (src/Proposal.ts sizeProblemOf); the check's comment, by
// github-actions[bot], has the fingerprint of the TOML as it is now; the body wasn't edited after the
// comment's last update, nor in the 5 minutes before it was closed (or since), so whoever closed it read
// what's committed; and the check, run again now, says it can be applied. Otherwise it refuses, with one
// plain sentence for the issue, and the workflow reopens it.
//
// To accept, it writes exactly one new file, changesets/next/<resource>/<id>.toml, with the issue's TOML as
// written, comments and all (D87), and a new id (D58). The resource is the table of the System ID the check
// checked, from datapackage.json, never text from the issue. It runs the full data:check with the file in
// place, makes sure git sees that one new file and nothing else, and commits it as "data: accepted
// proposal #<n>, <system> (<System ID>)". Nothing names the proposer or whoever accepted it (D69).
//
// usage: npm run proposal:accept -- --event <event.json> --context <context.json> [--dry-run]
//        node scripts/proposal-accept.ts --verify <result.json>      after a rebase, before pushing again
// The context is what the workflow gathers from the API: { role, comments, lastEditedAt, closer } (Context). It
// prints the result as JSON (Result). With --dry-run it does everything but commit, then removes the file.
// --verify checks that HEAD adds that one file and nothing else, and that data:check still passes.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { CHANGESET_ID, changesetId, PENDING_FOLDER } from '../lib/changesets/index.ts'
import { changesetInIssue, fingerprint, proposalCheck, type ProposalResult } from './proposal-check.ts'
import { commentFingerprint, MARKER, md } from './proposal-comment.ts'
import { dpiTypeOf, root } from './release-build.ts'
import { MAX_BYTES, MAX_ISSUE_CHARACTERS, sizeProblemOf } from '../src/Proposal.ts'

/** The largest TOML it accepts, in bytes and as an issue's characters: the editor's limits too, which it warns near (D89) */
export { MAX_BYTES, MAX_ISSUE_CHARACTERS }

/** Whether the TOML is too large to accept, as the editor and the check count it */
export const tooLarge = (toml: string) => sizeProblemOf(toml)?.level === 'error'
/** How long before closing the body must have been left alone */
export const QUIET_MS = 5 * 60 * 1000
/** The roles that can accept: triage access or more */
export const ROLES = ['triage', 'write', 'maintain', 'admin']
/** The check's comment's author: the workflows' built-in token */
export const BOT = 'github-actions[bot]'

/** The parts of an `issues` event it reads */
export interface IssueEvent {
  action?: string
  issue?: {
    number?: number
    body?: string | null
    state_reason?: string | null
    closed_at?: string | null
    user?: { login?: string } | null
    labels?: ({ name?: string } | string)[]
  }
  sender?: { login?: string } | null
}

/** A comment on the issue, as the workflow gathers it */
export interface Comment { user?: string, body?: string, updated_at?: string }

/** What the workflow gathers from the API before this runs */
export interface Context {
  /** the closer's role, `role_name` from the collaborator permission API, or null if they have none */
  role: string | null
  /** the issue's comments by github-actions[bot] */
  comments: Comment[]
  /** when the body was last edited, from GraphQL, or null if it never was */
  lastEditedAt: string | null
  /** what closed it, from GraphQL's last ClosedEvent: its closer's type, like PullRequest or Commit, or null for a person */
  closer?: string | null
}

export interface DecideInput {
  event: IssueEvent
  role: string | null | undefined
  /** the check's comment, checkComment(comments) */
  comment: Comment | undefined
  lastEditedAt: string | null | undefined
  /** Context.closer */
  closer?: string | null
  /** the TOML in the issue's body now, changesetInIssue(body) */
  toml: string | undefined
  /** the check, run again on that TOML now */
  check: ProposalResult | undefined
  now: Date
}

/** Accept, or refuse with a sentence for the issue; `reopen` is false when closing it didn't ask to accept it, which leaves it closed */
export type Decision = { action: 'accept' } | { action: 'refuse', reason: string, reopen: boolean }

export const REASONS = {
  notCompleted: 'This was closed as not planned, so nothing was committed.',
  notProposal: 'This isn’t a proposal, so nothing was committed.',
  closedBy: 'This was closed by a pull request or a commit, so nothing was committed from here.',
  author: 'Proposals need to be accepted by someone other than the person who proposed them.',
  role: 'Proposals can only be accepted by the team: closing one as completed needs triage access or more.',
  noChangeset: 'There’s no changeset in this issue, so there’s nothing to commit.',
  tooLarge: `The changeset is too large to accept from an issue: over ${MAX_BYTES / 1024} KB, or over the ${MAX_ISSUE_CHARACTERS.toLocaleString('en-GB')} characters an issue can be. Please split it into smaller proposals.`,
  notChecked: 'This hasn’t been checked, so it wasn’t committed. Please edit the issue to check it, read the check’s comment, and close it again.',
  otherVersion: 'The check’s comment is about another version of the changeset. Please wait for the check to update it, read it, and close it again.',
  editedAfterCheck: 'This was edited after it was last checked. Please wait for the check’s comment to update, read it, and close it again.',
  editedJustBefore: 'This was edited just before it was closed. Please read the latest version and close it again.',
  cantApply: 'This can’t be applied as it is now, so it wasn’t committed:',
  noTable: 'The check couldn’t tell which table this changes, so it wasn’t committed.'
}

const time = (value: string | null | undefined) => value ? Date.parse(value) : NaN
const labelsOf = (event: IssueEvent) => (event.issue?.labels ?? []).map(label => typeof label === 'string' ? label : label?.name)

/** The check's comment: the first by github-actions[bot] that starts with the marker, as the check workflow finds it */
export function checkComment (comments: Comment[]): Comment | undefined {
  return comments.find(c => c.user === BOT && typeof c.body === 'string' && c.body.startsWith(MARKER))
}

/** Whether to accept the proposal that the event closed (D88): see the top of this file */
export function decide (input: DecideInput): Decision {
  const { event, role, comment, lastEditedAt, closer, toml, check, now } = input
  const refuse = (reason: string, reopen = true): Decision => ({ action: 'refuse', reason, reopen })
  const issue = event.issue ?? {}
  // closing it as not planned declines it, and an issue that isn't a proposal isn't ours: leave both closed
  if (event.action !== 'closed' || issue.state_reason !== 'completed') return refuse(REASONS.notCompleted, false)
  if (!labelsOf(event).includes('proposal')) return refuse(REASONS.notProposal, false)
  // a pull request or a commit that closes it, like a batch of planned changes, has its changes already
  if (closer) return refuse(REASONS.closedBy, false)

  const sender = event.sender?.login
  if (!sender || sender === issue.user?.login) return refuse(REASONS.author)
  if (!role || !ROLES.includes(role)) return refuse(REASONS.role)

  if (toml === undefined) return refuse(REASONS.noChangeset)
  if (tooLarge(toml)) return refuse(REASONS.tooLarge)

  // what was checked is what's committed, and whoever closed it saw the check of the latest version
  if (!comment || comment.user !== BOT || typeof comment.body !== 'string' || !comment.body.startsWith(MARKER)) return refuse(REASONS.notChecked)
  const checked = commentFingerprint(comment.body)
  if (!checked) return refuse(REASONS.notChecked)
  if (checked.sha256 !== fingerprint(toml)) return refuse(REASONS.otherVersion)
  const commented = time(comment.updated_at)
  const closed = issue.closed_at ? time(issue.closed_at) : now.getTime()
  // a time that can't be read refuses, as a comparison with NaN is always false
  if (Number.isNaN(commented) || Number.isNaN(closed)) return refuse(REASONS.editedAfterCheck)
  if (lastEditedAt) {
    const edited = time(lastEditedAt)
    if (Number.isNaN(edited) || edited > commented) return refuse(REASONS.editedAfterCheck)
    // an edit after closing is too late too
    if (closed - edited < QUIET_MS) return refuse(REASONS.editedJustBefore)
  }

  if (!check || check.sha256 !== fingerprint(toml)) return refuse(REASONS.notChecked)
  if (!check.applies) return refuse(REASONS.cantApply)
  if (!check.resource) return refuse(REASONS.noTable)
  return { action: 'accept' }
}

/** The comment that says why it was refused: the sentence, and the problems if it can't be applied, escaped */
export function refusalComment (decision: Decision & { action: 'refuse' }, check?: ProposalResult): string {
  const problems = decision.reason === REASONS.cantApply ? check?.problems ?? [] : []
  return [decision.reason, ...(problems.length ? ['', ...problems.map(problem => `- ${md(problem)}`)] : [])].join('\n') + '\n'
}

/**
 * The changeset's path in the repo, changesets/next/<resource>/<id>.toml, with `/`. The resource must be a DPI
 * table in datapackage.json and the id a changeset id, or it throws, so nothing else can be written.
 */
export function changesetPath (resource: string, id: string): string {
  if (!Object.hasOwn(dpiTypeOf, resource) || !/^[a-z][a-z0-9_-]*$/.test(resource)) throw new Error(`not a DPI table: ${JSON.stringify(resource)}`)
  if (!CHANGESET_ID.test(id)) throw new Error(`not a changeset id: ${JSON.stringify(id)}`)
  const file = `changesets/${PENDING_FOLDER}/${resource}/${id}.toml`
  const pending = path.join(root, 'changesets', PENDING_FOLDER)
  if (path.relative(pending, path.resolve(root, file)) !== path.join(resource, `${id}.toml`)) throw new Error(`not in changesets/${PENDING_FOLDER}/: ${file}`)
  return file
}

/** The file's text: the issue's TOML as written, ending with a newline */
export const fileText = (toml: string) => toml.endsWith('\n') ? toml : `${toml}\n`

/** A name for a commit message: on one line, not too long, and with no @ or #, so it can't mention or link anything */
const plain = (text: string) => {
  const line = text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/[@#]/g, '').replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * The commit message: "data: accepted proposal #<n>, <system> (<System ID>)", or for a revert "…, revert of
 * <changeset>", and a body naming the file.
 * The systems are the check's, from the data. It names no person (D69).
 */
export function commitMessage (number: number, check: ProposalResult, file: string): { subject: string, body: string } {
  const systems = [...new Map(check.changes.filter(c => c.key).map(c => [c.key!, c.system ?? c.key!])).entries()]
  const [key, name] = systems[0] ?? []
  // a revert names no system: the changeset it reverts (D90)
  const reverted = check.changes.find(c => c.type === 'revert' && c.changeset)?.changeset
  const first = key ? (plain(name) && plain(name) !== key ? `${plain(name)} (${plain(key)})` : plain(key)) : reverted ? `revert of ${plain(reverted)}` : 'no system'
  const more = systems.length > 1 ? ` and ${systems.length - 1} more` : ''
  return { subject: `data: accepted proposal #${number}, ${first}${more}`, body: `Accepted from #${number}. Adds ${file}.` }
}

/** Whether `git status --porcelain --untracked-files=all` lists exactly one new file, `file`, and nothing else */
export const onlyNewFile = (porcelain: string, file: string) => porcelain.replace(/\n+$/, '') === `?? ${file}`

/** A command's result, as spawnSync gives it */
export interface Ran { status: number | null, stdout: string, stderr: string }
export type Run = (command: string, args: string[]) => Ran

/** Runs a command in `cwd`, never through a shell */
export const runIn = (cwd: string): Run => (command, args) => {
  const ran = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (ran.error) throw ran.error
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr }
}

/** A step that failed after accepting, with a sentence for the issue */
export class AcceptError extends Error {
  reason: string
  constructor (message: string, reason: string) {
    super(message)
    this.reason = reason
  }
}

export const FAILED = {
  dataCheck: 'This passed its check, but not the full data check with it in place, so it wasn’t committed.',
  other: 'This was accepted, but it couldn’t be committed.'
}

export interface ApplyOptions {
  /** the repo */
  root: string
  /** its path in the repo, from changesetPath */
  file: string
  /** the issue's TOML */
  toml: string
  message: { subject: string, body: string }
  dryRun?: boolean
  run?: Run
  /** the full data check, `npm run data:check`, with the file in place */
  dataCheck?: () => Ran
}

/**
 * Write the changeset, run the full data check with it in place, make sure it's the only change, and commit it,
 * or with dryRun remove it. The checkout must be clean to start. If anything fails, it removes the file and throws
 * an AcceptError. Returns the commit's SHA, or undefined for a dry run, and the data check's output.
 */
export function applyProposal (options: ApplyOptions): { sha?: string, dataCheck: string } {
  const run = options.run ?? runIn(options.root)
  const dataCheck = options.dataCheck ?? (() => run(process.execPath, [path.join('scripts', 'data-build.ts'), '--check']))
  const git = (...args: string[]) => {
    const ran = run('git', args)
    if (ran.status !== 0) throw new AcceptError(`git ${args[0]} failed: ${ran.stderr.trim()}`, FAILED.other)
    return ran.stdout
  }
  const status = () => git('status', '--porcelain', '--untracked-files=all')
  const full = path.join(options.root, options.file)
  // the folder, if it's new, so a dry run leaves nothing behind
  const folder = path.dirname(full)
  const newFolder = !fs.existsSync(folder)

  if (status() !== '') throw new AcceptError('the checkout has changes before the changeset is written', FAILED.other)
  let written = false
  let committed = false
  try {
    fs.mkdirSync(folder, { recursive: true })
    // never over a file that's there
    fs.writeFileSync(full, fileText(options.toml), { flag: 'wx' })
    written = true
    const checked = dataCheck()
    const output = `${checked.stdout}${checked.stderr}`
    if (checked.status !== 0) throw new AcceptError(`data:check failed:\n${output}`, FAILED.dataCheck)
    const after = status()
    if (!onlyNewFile(after, options.file)) throw new AcceptError(`git status isn't just ${options.file}:\n${after}`, FAILED.other)
    if (options.dryRun) return { dataCheck: output }
    git('add', '--', options.file)
    git('commit', '--quiet', '-m', options.message.subject, '-m', options.message.body)
    committed = true
    return { sha: git('rev-parse', 'HEAD').trim(), dataCheck: output }
  } finally {
    if (written && !committed) fs.rmSync(full, { force: true })
    if (newFolder && !committed) fs.rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * After a rebase onto the default branch: HEAD adds `file` and changes nothing else, the checkout is
 * clean, and the full data check passes with what's there now. Throws an AcceptError if not.
 */
export function verifyCommit (options: { root: string, file: string, run?: Run, dataCheck?: () => Ran }): void {
  const run = options.run ?? runIn(options.root)
  const dataCheck = options.dataCheck ?? (() => run(process.execPath, [path.join('scripts', 'data-build.ts'), '--check']))
  const changed = run('git', ['diff', '--name-status', '--no-renames', 'HEAD~1', 'HEAD'])
  if (changed.status !== 0 || changed.stdout.replace(/\n+$/, '') !== `A\t${options.file}`) throw new AcceptError(`HEAD doesn't just add ${options.file}:\n${changed.stdout}${changed.stderr}`, FAILED.other)
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'])
  if (status.status !== 0 || status.stdout !== '') throw new AcceptError(`the checkout isn't clean:\n${status.stdout}`, FAILED.other)
  const checked = dataCheck()
  if (checked.status !== 0) throw new AcceptError(`data:check failed:\n${checked.stdout}${checked.stderr}`, FAILED.dataCheck)
}

/** What the command prints, as JSON, for the workflow */
export interface Result {
  action: 'accept' | 'refuse' | 'failed'
  number?: number
  /** a refusal's or failure's sentence, and the comment to post */
  reason?: string
  comment?: string
  reopen?: boolean
  /** an acceptance's file, its id and table, and the commit, which a dry run doesn't make */
  file?: string
  id?: string
  resource?: string
  sha?: string
  dryRun?: boolean
}

// --- the command line ---

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const { values: args } = parseArgs({ options: { event: { type: 'string' }, context: { type: 'string' }, 'dry-run': { type: 'boolean' }, verify: { type: 'string' } } })
  const print = (result: Result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  // the site's modules log what they notice, so stdout holds only the JSON
  console.log = console.error

  if (args.verify) {
    const accepted: Result = JSON.parse(fs.readFileSync(args.verify, 'utf8'))
    try {
      verifyCommit({ root, file: changesetPath(accepted.resource ?? '', accepted.id ?? '') })
      print(accepted)
    } catch (error) {
      console.error((error as Error).message)
      print({ ...accepted, action: 'failed', reason: (error as AcceptError).reason ?? FAILED.other })
      process.exit(1)
    }
    process.exit(0)
  }

  if (!args.event || !args.context) {
    console.error('usage: npm run proposal:accept -- --event <event.json> --context <context.json> [--dry-run]\n       node scripts/proposal-accept.ts --verify <result.json>')
    process.exit(2)
  }
  // the issue's body is data: it's read from the event's file, never passed through a shell (D56)
  const event: IssueEvent = JSON.parse(fs.readFileSync(args.event, 'utf8'))
  const context: Context = JSON.parse(fs.readFileSync(args.context, 'utf8'))
  const number = Number(event.issue?.number)
  const now = new Date()
  const toml = changesetInIssue(String(event.issue?.body ?? ''))
  const check = toml !== undefined && !tooLarge(toml) ? proposalCheck(toml, { now }) : undefined
  const decision = decide({ event, role: context.role, comment: checkComment(context.comments ?? []), lastEditedAt: context.lastEditedAt, closer: context.closer, toml, check, now })
  if (decision.action === 'refuse') {
    print({ action: 'refuse', number, reason: decision.reason, reopen: decision.reopen, comment: refusalComment(decision, check) })
    process.exit(0)
  }

  // the id is assigned now (D58), and the table is the checked System ID's
  const id = changesetId(now)
  const file = changesetPath(check!.resource!, id)
  const message = commitMessage(number, check!, file)
  try {
    const { sha, dataCheck } = applyProposal({ root, file, toml: toml!, message, dryRun: args['dry-run'] })
    console.error(dataCheck.trimEnd())
    if (args['dry-run']) console.error(`\nDry run: it would commit ${file}, as "${message.subject}", with:\n${fileText(toml!)}`)
    print({ action: 'accept', number, file, id, resource: check!.resource, ...(sha ? { sha } : {}), ...(args['dry-run'] ? { dryRun: true } : {}) })
  } catch (error) {
    console.error((error as Error).message)
    const reason = (error as AcceptError).reason ?? FAILED.other
    print({ action: 'failed', number, file, id, resource: check!.resource, reason, reopen: true, comment: `${reason}\n` })
    process.exit(1)
  }
}
