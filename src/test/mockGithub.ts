// A stand-in for GitHub, for testing the editor's proposals end to end (D56, D87, D88): the issue that
// GitHub's form makes from the editor's prefilled link, the `issues` events the workflows get, the
// context .github/workflows/proposal-accept.yml gathers from the API, and the two workflows' scripts run
// on them, as the workflows run them. The check and its comment are the real ones
// (scripts/proposal-check.ts, scripts/proposal-comment.ts); accepting is the real decide(), and for an
// accept, the real applyProposal() as a dry run, with the real data:check, in a temporary clone of the
// repo, so the checkout here never changes.
//
// What it assumes of GitHub (to be confirmed by a live trial): an issue form's textarea with
// `render: toml` comes out as `### <label>`, a blank line, and the value, trimmed, in a ```toml fence
// (issues #82, #83); its labels come from the form's `labels:`; an empty value is `_No response_`; and
// the body can be at most 65,536 characters.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { changesetInIssue, checkIssueBody, issueProblem, proposalCheck, type ProposalResult } from '../../scripts/proposal-check.ts'
import { proposalComment } from '../../scripts/proposal-comment.ts'
import {
  applyProposal, BOT, changesetPath, checkComment, commitMessage, decide, tooLarge, type Comment, type Context, type Decision, type IssueEvent
} from '../../scripts/proposal-accept.ts'
import { changesetId } from '../../lib/changesets/index.ts'
import { MAX_ISSUE_CHARACTERS } from '../Proposal.ts'
import { root } from '../../scripts/release-build.ts'

/** GitHub's limit on an issue's body, in characters */
export const MAX_ISSUE_BODY = MAX_ISSUE_CHARACTERS

export interface MockIssue {
  number: number
  title: string
  body: string
  labels: string[]
  /** the author's login */
  user: string
  template?: string
}

/** The form's label and labels, read from .github/ISSUE_TEMPLATE/<template> */
function formOf (template: string) {
  const text = fs.readFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', template), 'utf8')
  const labels = [...(text.match(/^labels:\s*\[(.*)\]\s*$/m)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1])
  const title = text.match(/^title:\s*"(.*)"\s*$/m)?.[1] ?? ''
  // the textareas, by id: their label and render language
  const fields = [...text.matchAll(/- type: textarea\n\s+id: (\S+)\n\s+attributes:\n\s+label: (.+)\n(?:\s+description: .*\n)?(?:\s+render: (\S+))?/g)]
    .map(([, id, label, render]) => ({ id, label: label.trim(), render }))
  return { labels, title, fields }
}

/**
 * The issue GitHub makes from the editor's link: its title, and its body as the form renders it, each
 * field `### <label>`, a blank line, then the value, trimmed, in a fence of its `render` language, or
 * `_No response_` if it's empty. Throws if the body is over GitHub's limit, which GitHub refuses.
 */
export function issueFromLink (url: string, more: { number?: number, user?: string } = {}): MockIssue {
  const link = new URL(url)
  const params = link.searchParams
  const template = params.get('template') ?? ''
  const form = formOf(template)
  const body = form.fields.map(field => {
    const value = (params.get(field.id) ?? '').trim()
    const shown = value === '' ? '_No response_' : field.render ? `\`\`\`${field.render}\n${value}\n\`\`\`` : value
    return `### ${field.label}\n\n${shown}`
  }).join('\n\n')
  if (body.length > MAX_ISSUE_BODY) throw new Error(`the issue body is ${body.length} characters, over GitHub's ${MAX_ISSUE_BODY}`)
  return { number: more.number ?? 100, title: params.get('title') ?? form.title, body, labels: form.labels, user: more.user ?? 'alice', template }
}

/** The issue made by pasting `toml` into the blank form, as the editor's too-long fallback asks (D56) */
export function issueFromPaste (blankUrl: string, toml: string, more: { number?: number, user?: string } = {}): MockIssue {
  const url = new URL(blankUrl)
  url.searchParams.set('changeset', toml)
  return issueFromLink(url.href, more)
}

const issueJSON = (issue: MockIssue, extra: Record<string, unknown> = {}) => ({
  number: issue.number,
  title: issue.title,
  body: issue.body,
  user: { login: issue.user },
  labels: issue.labels.map(name => ({ name })),
  ...extra
})

/** An `issues` event, as GitHub sends it, by its parts the workflows read */
export const openedEvent = (issue: MockIssue): IssueEvent => ({ action: 'opened', issue: issueJSON(issue, { state: 'open' }), sender: { login: issue.user } })
export const editedEvent = (issue: MockIssue, sender = issue.user): IssueEvent => ({ action: 'edited', issue: issueJSON(issue, { state: 'open' }), sender: { login: sender } })
export function closedEvent (issue: MockIssue, sender: string, state_reason: 'completed' | 'not_planned' | 'duplicate' | null = 'completed', closedAt = new Date()): IssueEvent {
  return { action: 'closed', issue: issueJSON(issue, { state: 'closed', state_reason, closed_at: closedAt.toISOString() }), sender: { login: sender } }
}

/** Whether the check workflow runs for an event, as its `if:` says (issue labels include `proposal`) */
export const checkRuns = (event: IssueEvent) => (event.issue?.labels ?? []).some(label => (typeof label === 'string' ? label : label.name) === 'proposal')

export interface CheckRun {
  result: ProposalResult
  /** the bot's comment, by the real comment code */
  comment: string
  /** whether the workflow labels it needs-changes */
  needsChanges: boolean
}

/** The check workflow on an issue: the real check, on the TOML in its body as the workflow reads it, and its comment */
export function runCheck (issue: MockIssue, options: { now?: Date, log?: string } = {}): CheckRun {
  const result = checkIssueBody(issue.body, options)
  return { result, comment: proposalComment(result), needsChanges: !result.applies }
}

/** Who closes the issue, and how */
export interface Closer {
  login: string
  /** their role_name from the collaborator permission API, or null for none */
  role: string | null
  state_reason?: 'completed' | 'not_planned' | null
  /** what closed it: PullRequest or Commit, or null for a person (GraphQL's ClosedEvent closer) */
  closer?: string | null
  /** when it's closed: by default now, an hour after the check */
  closedAt?: Date
  /** when the body was last edited, or null if never (GraphQL lastEditedAt) */
  lastEditedAt?: Date | null
  /** the check's comment, if not the check of the issue as it is now */
  comment?: Comment | null
}

export interface AcceptRun {
  decision: Decision
  context: Context
  /** for an accept: the file it would add, and the dry run's data:check output */
  file?: string
  subject?: string
  dataCheck?: string
  /** an accept whose dry run failed: why */
  error?: string
}

/** A clone of this checkout's HEAD, for dry runs, with node_modules linked in and kept out of git status */
export function tempClone (dir = process.env.PROPOSAL_CLONE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-clone-'))): string {
  const clone = path.join(dir, 'repo')
  if (!fs.existsSync(clone)) {
    const ran = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', root, clone], { encoding: 'utf8' })
    if (ran.status !== 0) throw new Error(`git clone failed: ${ran.stderr}`)
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(clone, 'node_modules'))
    fs.appendFileSync(path.join(clone, '.git', 'info', 'exclude'), '\nnode_modules\n')
  }
  return clone
}

/**
 * The accept workflow on the closing of an issue, checked at `checkedAt` (an hour before it's closed, by
 * default): the context it gathers, decide(),
 * and for an accept, applyProposal() as a dry run in `clone` with the real data:check
 */
export function runAccept (issue: MockIssue, closer: Closer, options: { clone?: string, checkedAt?: Date, log?: string } = {}): AcceptRun {
  const closedAt = closer.closedAt ?? new Date()
  const checkedAt = options.checkedAt ?? new Date(closedAt.getTime() - 60 * 60 * 1000)
  const posted: Comment = { user: BOT, body: runCheck(issue, { now: checkedAt, log: options.log }).comment, updated_at: new Date(checkedAt.getTime() + 30_000).toISOString() }
  const comments = closer.comment === null ? [] : [closer.comment ?? posted]
  const context: Context = { role: closer.role, comments, lastEditedAt: closer.lastEditedAt ? closer.lastEditedAt.toISOString() : null, closer: closer.closer ?? null }
  const event = closedEvent(issue, closer.login, closer.state_reason === undefined ? 'completed' : closer.state_reason as never, closedAt)
  const toml = changesetInIssue(issue.body)
  // the check, run again at closing, as the workflow does
  const check = toml !== undefined && !tooLarge(toml) && !issueProblem(issue.body) ? proposalCheck(toml, { now: closedAt, log: options.log }) : undefined
  const decision = decide({ event, role: context.role, comment: checkComment(context.comments), lastEditedAt: context.lastEditedAt, closer: context.closer, toml, check, now: closedAt })
  if (decision.action !== 'accept' || !options.clone) return { decision, context }
  const file = changesetPath(check!.resource!, changesetId(closedAt))
  const message = commitMessage(issue.number, check!, file)
  try {
    const { dataCheck } = applyProposal({ root: options.clone, file, toml: toml!, message, dryRun: true })
    return { decision, context, file, subject: message.subject, dataCheck }
  } catch (error) {
    return { decision, context, file, subject: message.subject, error: (error as Error).message }
  }
}
