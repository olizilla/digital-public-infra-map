// Check a proposal (D56, D88): a changeset from the editor (D86, D87), as the TOML in a `proposal` issue.
// It says what the proposal would do, in plain words, for the comment that scripts/proposal-comment.ts
// writes, and never says it's valid (D88): either the problems that stop it applying, or each change, old →
// new, and its DPI effect, with any warnings.
//
// The proposal is checked as one more pending changeset, with a temporary id timestamped now (ids are
// assigned on acceptance, D58), on top of the latest release and the changesets in changesets/next/, as
// data:check-next builds them (scripts/release-build.ts), with the root datapackage.json, the next
// codebook (D71). So what blocks it is what would block the merge once it's accepted (D51, D60): TOML
// that can't be read, a changeset that doesn't match the schema, an as_of that isn't a real date (D85), an
// update or remove of a row that doesn't exist, and a value it sets that fails scripts/validate.mjs. For a
// proposal, a value the build would skip also blocks: a field that isn't in the codebook (D51), a derived
// one (D48) or the System ID, as do changes to more than one table (D31) and TOML too large to accept:
// over 64 KB, or GitHub's 65,536-character issue body (src/Proposal.ts sizeProblemOf, D88, D89).
// And a proposal, hand-written or not, meets exactly the editor's rules (src/Proposal.ts checkProposal,
// D89): an allowed value, never NA (D73, D86), not empty and on one line, trimmed first as reading any
// changeset trims it (D90); a reason, of at most 500 characters (D78, now required); sources if any, each
// an http(s) link, none twice (D90: a source may have no public link, and the reason then says where it
// came from); a real date; a removal's replacement that's another System ID; a removal or values, not
// both; and each field once. This check adds only what needs the data.
// A proposal may also add a system or revert a pending changeset, when they hold up (D90): a create's
// System ID is well formed for its table, with its place (scripts/validate.mjs), and isn't a system in
// the release or waiting for the next one, and its values meet the editor's rules; a revert names a
// changeset in changesets/next/, as reverts are only within the unreleased set (D47, D66); and each has
// a reason, as every change does.
// The warnings are what the build warns about, an as_of later than today (D85) and a change older than its
// row's Last updated (D46), and a value that's already what it would be, a later pending change that sets
// the same value, a `# was` comment (D87) that isn't the live value any more, and, gently, changes with
// no source links, whose reason should say where they came from (D90).
// Old values are the live data's: the latest release plus changesets/next/, not the `# was` comments.
// The DPI effect is each touched system's DPI status before and after, from src/DpiTest.ts, and the
// countries with a DPI-like system of each type, counted as the site counts them (src/Util.ts
// oneSystemPerCountry), where either changes.
//
// A proposal is one changeset, in one place, as GitHub shows it (D96): an issue body with more than one TOML
// block, or with an HTML comment or a `<details>` anywhere, is refused (issueProblem), so what a reviewer
// sees is what's checked and committed.
// A proposal can't name its author or have a summary: attribution would come from the account that opened the
// issue, never from text in the changeset (D96).
// It can't change a system's country either: its System ID names its place (D96).
// A new System ID ends in exactly two digits, though the release's pattern takes more (D96).
//
// The result has the SHA-256 of the exact TOML it checked, and when, which the comment records in its
// marker, so accepting the proposal (scripts/proposal-accept.ts, D88) commits only the TOML that was checked.
//
// It writes nothing in the repo: the build it checks goes in a temporary folder, which it removes.
//
// usage: npm run proposal:check -- [<file>|-] [--issue]          the TOML, or with --issue an issue body, from a file or stdin
//        node scripts/proposal-check.ts --event "$GITHUB_EVENT_PATH"  the body of the event's issue
// It prints the result as JSON (ProposalResult). Run scripts/proposal-comment.ts on it for the comment.

import './site-modules.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { TomlError } from 'smol-toml'
import { changesetFromText, changesetId, fieldId, keyField, missingValues, PENDING_FOLDER, readChangeset, readFolders, releaseFolders, schemaErrors, unrealDates } from '../lib/changesets/index.ts'
import type { BuildResult, Change, DataPackage, Field, ReportItem, Resource } from '../lib/changesets/index.ts'
import { derivedFields } from '../src/DpiLayer.ts'
import { nextFreeId, usedIds } from '../src/EditIndex.ts'
import { changesetText } from '../lib/changesets/toml.ts'
import { allowedText, checkProposal, commentText, editSpec, evidenceProblems, fieldSpec, HIDDEN_MARKUP, NEEDS_A_FIELD, oneLine, proposalsOf, sizeProblemOf, valueProblems } from '../src/Proposal.ts'
import {
  buildRelease, checkRelease, dataDir, dpiTypeOf, earlierFieldsOf, loadBaseline, previousRelease, recordOf, releasesBefore, root, tableRecords, writeRelease,
  type DPIType
} from './release-build.ts'

// the site's modules, which need ./site-modules.ts to load in Node
const { nameOf, nouns, presence } = await import('../src/DpiTest.ts')
const { oneSystemPerCountry } = await import('../src/Util.ts')

type DpiStatus = 'DPI' | 'WIP' | 'NA'

/** One value a change sets, a removal, an addition or a revert, with the system's name and the old value from the live data */
export interface ChangeEffect {
  /** the change's place in the changeset, from 0 */
  change: number
  type: Change['type']
  /** the System ID */
  key?: string
  /** the system's name in the live data, or the System ID if it has none */
  system?: string
  /** if it has no name: its place as the data names it and its kind, "Eritrea, unnamed digital payment system" (D92), which the comment says it by. `system` stays the System ID, which accepting names it by */
  unnamed?: string
  /** an update's or addition's field id, and its codebook title (D83) */
  field?: string
  title?: string
  /** the value in the latest release plus changesets/next/, and the proposal's */
  old?: string
  new?: string
  /** a removal's replacement (`duplicate_of`), and its name if it's in the data */
  replacement?: { key: string, system?: string, unnamed?: string }
  /** a revert's changeset, and how many changes it has */
  changeset?: string
  reverts?: number
}

/** A change's reason, sources and evidence date, as the TOML has them (trimmed, as reading a changeset trims them) */
export interface ChangeEvidence { change: number, reason: string, sources: string[], as_of: string }

/** A touched system's DPI status, before and after, where it has one */
export interface SystemEffect {
  key: string
  /** its name, or its System ID if it has none */
  system: string
  /** if it has no name: its place as the data names it and its kind, "Eritrea, unnamed digital payment system" (D92) */
  unnamed?: string
  dpiType: DPIType
  before?: DpiStatus
  after?: DpiStatus
}

/** For a DPI type, how many countries have a DPI-like system, before and after */
export interface CountryCount { dpiType: DPIType, noun: string, before: number, after: number }

export interface ProposalResult {
  /** whether the input had a changeset: false for an issue with no ```toml block */
  found: boolean
  /** whether it would apply as it is: no problems */
  applies: boolean
  /** the release it's checked against, and how many changesets wait in changesets/next/ */
  release?: string
  pending: number
  /** the table it changes */
  resource?: string
  problems: string[]
  warnings: string[]
  changes: ChangeEffect[]
  dpi: { systems: SystemEffect[], countries: CountryCount[] }
  /** each change's evidence as the TOML has it, by its place in the changeset, for the comment to show under its line (D96) */
  evidence?: ChangeEvidence[]
  /** the exact TOML it checked, which the fingerprint is of, for the comment to show (D96) */
  toml?: string
  /** the SHA-256 of the TOML it checked, as hex, and when it checked it, as ISO 8601: none if there was no TOML */
  sha256?: string
  checked?: string
}

export interface CheckOptions {
  /** the time the proposal is checked, which its temporary id and the later-than-today warning use */
  now?: Date
  /** the log, changesets/ by default */
  log?: string
}

/** "a, b and c" */
const and = (values: string[]) => values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
/** A value in curly quotes, on one line and not too long, for a sentence */
const q = (value: string) => {
  const line = commentText(value)
  return `“${line.length > 120 ? line.slice(0, 119) + '…' : line}”`
}
/** Whether `value` matches a Data Package pattern, which must match the whole value, as scripts/validate.mjs checks it */
const matches = (pattern: string, value: string) => new RegExp(`^(?:${pattern})$`, 'u').test(value)
const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The SHA-256 of a proposal's TOML, exactly as checked, as hex: its fingerprint in the check's comment (D88) */
export const fingerprint = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

/** What the check and accepting say of an issue body that isn't one changeset, all of it shown (D96) */
export const AMBIGUOUS_ISSUE = 'This issue has more than one changeset block, or hidden content. Keep one ```toml block and nothing hidden, so what’s reviewed is what’s committed.'

/** A line that opens a TOML code block, as GitHub might show it: in a quote or a list too, and with any info after `toml`, which the changeset's own reader doesn't take */
const TOML_FENCE = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})[ \t]*toml\b/i

/**
 * Whether an issue body is one changeset and nothing hidden (D96), or why not, in a sentence. GitHub shows an issue's
 * Markdown, and the changeset is read from its text, so the two must be the same thing: the body can't have more than one
 * TOML block (```toml or ~~~toml), or an HTML comment (`<!--`) or `<details` anywhere, which a reader doesn't see
 * or sees closed. The editor's own issues have neither: it refuses those in what a person types (src/Proposal.ts HIDDEN_MARKUP).
 * Checked on the body as it is, for the check and again, on its own, for accepting.
 */
export function issueProblem (body: string): string | undefined {
  if (HIDDEN_MARKUP.test(body)) return AMBIGUOUS_ISSUE
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  let blocks = 0
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(TOML_FENCE)
    if (!open) continue
    if (++blocks > 1) return AMBIGUOUS_ISSUE
    // what's inside a block isn't another block: on to its end, or the end of the body if it's never closed
    const close = new RegExp(`^[ \\t>]*${open[1][0] === '`' ? '`' : '~'}{${open[1].length},}\\s*$`)
    const end = lines.findIndex((line, n) => n > i && close.test(line))
    if (end === -1) break
    i = end
  }
  return undefined
}

/** The check of an issue's body: refused if it's ambiguous (issueProblem), the changeset's check if it has one, or no changeset found */
export function checkIssueBody (body: string, options: CheckOptions = {}): ProposalResult {
  const problem = issueProblem(body)
  if (problem) return notFound(problem)
  const text = changesetInIssue(body)
  return text === undefined ? notFound() : proposalCheck(text, options)
}

/**
 * The changeset in a proposal issue's body: the first ```toml block after the `### Changeset` heading that
 * GitHub writes for the issue form's field, or the first ```toml block anywhere if there's no such heading.
 * Undefined if there's none. It's read as text and never run.
 */
export function changesetInIssue (body: string): string | undefined {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const heading = lines.findIndex(line => /^ {0,3}#{1,6}\s+Changeset\s*#*\s*$/i.test(line))
  for (let i = heading === -1 ? 0 : heading + 1; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*toml\s*$/i)
    if (!open) continue
    const fence = open[1]
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
    const end = lines.findIndex((line, n) => n > i && close.test(line))
    // an unclosed block runs to the end of the body, as in Markdown
    return lines.slice(i + 1, end === -1 ? undefined : end).join('\n') + '\n'
  }
  return undefined
}

/**
 * The `# was "<value>"` comment the editor writes after each changed value (D87), by change and field id.
 * The TOML string is read as JSON, which reads the editor's strings (lib/changesets/toml.ts tomlString).
 */
function wasComments (text: string): Map<string, string> {
  const was = new Map<string, string>()
  let change = -1
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[\[\s*changes\s*\]\]/.test(line)) change++
    const [, id, value] = line.match(/^\s*values\.([a-z][a-z0-9_]*)\s*=.*#\s*was\s+("(?:[^"\\]|\\.)*")\s*$/) ?? []
    if (!id) continue
    try {
      was.set(`${change}\0${id}`, JSON.parse(value))
    } catch {}
  }
  return was
}

/** The values marked `# unchanged`, "Still true" (D92), by change and field id */
function unchangedComments (text: string): Set<string> {
  const unchanged = new Set<string>()
  let change = -1
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[\[\s*changes\s*\]\]/.test(line)) change++
    const [, id] = line.match(/^\s*values\.([a-z][a-z0-9_]*)\s*=.*"\s*#\s*unchanged\s*$/) ?? []
    if (id) unchanged.add(`${change}\0${id}`)
  }
  return unchanged
}

/**
 * The changeset as the build can read it, with what the editor's rules report instead made harmless (D92): a
 * change with no reason has an empty one, a source that isn't an http(s) link or is listed twice is left
 * out, and an evidence date that isn't a date's shape is today. The rules report each of those, with the
 * rest of the problems, and the build can still look for what needs the data. What's still wrong with the
 * schema after this can't be read, and stops the check.
 */
function readable (data: unknown, today: string): unknown {
  if (!isObject(data) || !Array.isArray(data.changes)) return data
  return {
    ...data,
    changes: data.changes.map(change => {
      if (!isObject(change) || !['create', 'update', 'remove', 'revert'].includes(change.type)) return change
      const out = { ...change }
      if (out.reason === undefined) out.reason = ''
      if (out.as_of === undefined || (typeof out.as_of === 'string' && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(out.as_of))) out.as_of = today
      if (Array.isArray(out.sources)) out.sources = [...new Set(out.sources.filter(url => typeof url === 'string' && /^https?:\/\/\S+$/.test(url)))]
      return out
    })
  }
}

/** The DPI table whose System ID pattern `key` matches, if any */
function resourceOfKey (datapackage: DataPackage, key: string): Resource | undefined {
  return datapackage.resources.filter(r => dpiTypeOf[r.name]).find(r => {
    const pattern = keyField(r).constraints?.pattern
    return typeof pattern === 'string' && matches(pattern, key)
  })
}

/** The parts of a change a problem is about, in the order they're listed: the change itself (does its system exist), its value, then its evidence (D92) */
const parts = { change: 0, value: 1, reason: 2, sources: 3, as_of: 4, duplicate_of: 5 }

/** "the 3rd change", or "the change" if there's one */
const nth = (i: number, count: number) => count === 1 ? 'The change' : `Change ${i + 1}`

/** A schema error in plain words, or undefined to leave it out as another error repeats it */
function schemaProblem (error: ReturnType<typeof schemaErrors>[number], data: unknown, titleOf: (id: string) => string): string | undefined {
  const changes = isObject(data) && Array.isArray(data.changes) ? data.changes : []
  const [, n, part, sub] = error.instancePath.match(/^\/changes\/(\d+)(?:\/([^/]+))?(?:\/(.+))?$/) ?? []
  const params = error.params as Record<string, any>
  if (n === undefined) {
    if (error.instancePath === '/changes' && error.keyword === 'minItems') return 'There are no changes in it.'
    if (error.instancePath === '/changes' && error.keyword === 'type') return 'Its changes aren’t written as a list of changes.'
    if (error.keyword === 'required' && params.missingProperty === 'changes') return 'There are no changes in it.'
    if (error.keyword === 'additionalProperties') return `It has ${q(params.additionalProperty)}, which a changeset can’t have.`
    if (error.instancePath === '/author') return 'Its author must be written as Name <email>, or left out.'
    if (error.instancePath === '/summary') return 'Its summary must be text, or left out.'
    return `It doesn’t have the shape of a changeset (${error.instancePath || 'the whole'}: ${error.message}).`
  }
  const which = nth(Number(n), changes.length)
  const needs: Record<string, string> = { key: 'doesn’t say which system it’s for (its System ID)', as_of: 'has no evidence date', reason: 'has no reason', values: 'has no values to change', type: 'doesn’t say what kind of change it is', changeset: 'doesn’t say which changeset it reverts' }
  if (part === undefined) {
    if (error.keyword === 'required') return `${which} ${needs[params.missingProperty] ?? `has no ${params.missingProperty}`}.`
    if (error.keyword === 'additionalProperties') return `${which} has ${q(params.additionalProperty)}, which ${changes[Number(n)]?.type ? `a change of type ${q(String(changes[Number(n)].type))}` : 'a change'} can’t have.`
    if (error.keyword === 'type') return `${which} isn’t written as a change.`
  }
  if (part === 'type') return `${which}’s kind, ${q(String(changes[Number(n)]?.type))}, isn’t one of update, create, remove or revert.`
  if (part === 'key') return `${which}’s System ID must be text, and not empty.`
  if (part === 'duplicate_of') return `${which}’s replacement must be a System ID, as text.`
  if (part === 'as_of') return `${which}’s evidence date must be a date like 2026-11-15.`
  if (part === 'reason') return `${which}’s reason must be text.`
  if (part === 'changeset') return `${which} must name the changeset it reverts by its id.`
  if (part === 'sources') {
    if (error.keyword === 'pattern') return `${which}: ${q(String(changes[Number(n)]?.sources?.[Number(sub)]))} isn’t a web address starting http:// or https://.`
    if (error.keyword === 'uniqueItems') return `${which} lists a source twice.`
    return `${which}’s sources must be a list of web addresses.`
  }
  if (part === 'values') {
    // a field id that can't be one, like "Status": the pattern error inside it repeats it
    if (error.keyword === 'propertyNames') return `${which} sets ${q(String(params.propertyName))}, which isn’t a field.`
    if (error.keyword === 'pattern') return undefined
    if (error.keyword === 'minProperties') return `${which} has no values to change.`
    if (sub !== undefined && error.keyword === 'type') return `${which}: the value for ${titleOf(sub)} must be text, in quotes.`
    return `${which}’s values must be a field and its value, each on its own line.`
  }
  return `${which} isn’t a change the data can take (${error.instancePath}: ${error.message}).`
}

/** A failed scripts/validate.mjs check on a value the proposal sets, in plain words, with what the codebook allows */
function checkProblem (item: ReportItem, field: Field | undefined, value: string, missing: string[]): string {
  const title = field?.title as string ?? item.field ?? 'A value'
  const message = item.message
  if (/is required, so must not be/.test(message)) return `${title} can’t be ${value}.`
  if (/empty cell/.test(message)) return `${title} can’t be empty. If you looked and found nothing, use Not Found.`
  if (/is not a valid (integer|number)/.test(message)) return `${title}: ${q(value)} isn’t a number.`
  if (/is not a valid date/.test(message)) return `${title}: ${q(value)} isn’t a date like 2026-11-15.`
  if (/is not unique/.test(message)) return `${title}: ${q(value)} is already another system’s.`
  if (field && /not an allowed value|not allowed values|does not match the pattern|is not separated by/.test(message)) {
    const spec = fieldSpec({ name: field.name, title, constraints: field.constraints as never }, '')
    return `${title}: ${q(value)} isn’t a value the codebook allows.${allowedText(spec, missing)}`
  }
  return `${title}: ${q(value)} ${message.replace(/^".*?" /, '')}.`
}

/**
 * What a proposal would do, or what stops it applying: `text` is its changeset's TOML. Builds the next
 * release twice in memory, from the latest release and changesets/next/, without and with the proposal.
 */
export function proposalCheck (text: string, options: CheckOptions = {}): ProposalResult {
  const now = options.now ?? new Date()
  const log = options.log ?? path.join(root, 'changesets')
  const datapackage: DataPackage = JSON.parse(fs.readFileSync(path.join(root, 'datapackage.json'), 'utf8'))
  const releases = releasesBefore(PENDING_FOLDER)
  const release = previousRelease(releases)
  // Every problem it can find, in one list (D92): each with the change it's about (-1 for the proposal as a
  // whole) and which part of it, so they come out in the changeset's order, the change's own problems,
  // then its value's, then its evidence's, and each said once. Only what stops later checks from running, TOML
  // that can't be read or a changeset the schema can't make sense of, ends the check early.
  const found: { change: number, part: number, message: string }[] = []
  const warnings: string[] = []
  const result: ProposalResult = {
    found: true, applies: false, ...(release ? { release } : {}), pending: 0, problems: [], warnings, changes: [], dpi: { systems: [], countries: [] },
    evidence: [], toml: text, sha256: fingerprint(text), checked: now.toISOString()
  }
  /** a problem about a change (or, with -1, the whole proposal), and the part of it, as `parts` orders them */
  const problem = (message: string, change = -1, part: keyof typeof parts = 'change') => found.push({ change, part: parts[part], message })
  const done = () => {
    result.problems = [...new Set(found.map((item, seq) => ({ ...item, seq })).sort((a, b) => a.change - b.change || a.part - b.part || a.seq - b.seq).map(item => item.message))]
    result.warnings = [...new Set(warnings)]
    result.applies = result.problems.length === 0
    return result
  }

  // the TOML, then the schema, in plain words, before the log's own reading, which says the same in the build's words.
  // A date that isn't a real one is reported, each of them, and stands in as today, so the rest can be checked
  const today = now.toISOString().slice(0, 10)
  let work = text
  for (const date of unrealDates(text).toReversed()) {
    const change = (text.slice(0, date.index).match(/^\s*\[\[\s*changes\s*\]\]/gm) ?? []).length - 1
    problem(`The evidence date ${date.date}, on line ${date.line}, isn’t a real date.`, change, 'as_of')
    work = work.slice(0, date.index) + today + work.slice(date.index + date.date.length)
  }
  let data: unknown
  try {
    data = readChangeset(work)
  } catch (error) {
    if (error instanceof TomlError) problem(`The changeset can’t be read at line ${error.line}, column ${error.column} (${error.message.split('\n')[0].replace(/^Invalid TOML document: /, '')}). Open the proposal in the editor again, or fix that line.`)
    else problem(`The changeset can’t be read: ${(error as Error).message.split('\n')[0]}.`)
    return done()
  }
  const changes: Record<string, any>[] = isObject(data) && Array.isArray(data.changes) ? data.changes.filter(isObject) : []
  // A proposal names no author and has no summary (D96), which the editor never writes. Free text in a changeset that
  // said who proposed it would let anyone claim to be anyone. If the map shows attribution one day (a GitHub account,
  // or an ATProto contributor), accepting must write `author` from a verified identity, the account that opened the
  // issue or a signed or OAuth-verified DID, and never take it from the TOML.
  if (isObject(data)) {
    if (Object.hasOwn(data, 'author')) problem('A proposal can’t name its author: attribution, when the map uses it, comes from the account that opened the issue, not from the changeset.')
    if (Object.hasOwn(data, 'summary')) problem('A proposal can’t have a summary: each change’s reason says why. Take the summary out.')
  }
  // as the editor and accepting count it (D88, D89)
  const size = sizeProblemOf(text)
  if (size?.level === 'error') problem(size.message)

  // the changesets waiting for the next release, which a revert can name (D47)
  const readReport: ReportItem[] = []
  const pending = readFolders(log, [PENDING_FOLDER], datapackage, readReport, { now })
  const pendingById = new Map(Object.values(pending).flat().map(c => [c.id, c]))
  const reverted = [...new Set(changes.flatMap(change => change.type === 'revert' && typeof change.changeset === 'string' ? [change.changeset] : []))]

  // the table: the one whose System IDs the changes' keys look like, or a revert's changeset's (D31: one table per changeset)
  const keys = [...new Set(changes.flatMap(change => typeof change.key === 'string' ? [change.key] : []))]
  const tables = new Map(keys.map(key => [key, resourceOfKey(datapackage, key)]))
  const revertTables = reverted.flatMap(id => datapackage.resources.filter(r => r.name === pendingById.get(id)?.resource))
  const resources = [...new Set([...tables.values(), ...revertTables].filter(r => r !== undefined))]
  const resource = resources[0]
  const fieldsOf = (r?: Resource) => new Map((r?.schema.fields ?? []).map(f => [fieldId(f), f]))
  const fields = fieldsOf(resource)
  const titleOf = (id: string) => fields.get(id)?.title as string | undefined ?? q(id)

  // the schema: what the editor's rules report below (a missing reason, a source that isn't a link, a date that isn't a date) doesn't stop the
  // check, as the build is given the changeset without them (D92). What's left that doesn't match stops it, with all the errors, in plain words
  const proposalData = readable(data, today)
  if (schemaErrors(proposalData).length) {
    for (const error of schemaErrors(data)) {
      const message = schemaProblem(error, data, titleOf)
      if (message) problem(message, Number(error.instancePath.match(/^\/changes\/(\d+)/)?.[1] ?? -1))
    }
    return done()
  }
  changes.forEach((change, i) => {
    const key = change.key
    if (typeof key === 'string' && !tables.get(key)) problem(`${q(key)} isn’t a System ID: it should look like pay-ke-01, id-ke-01 or dx-ke-01.`, i)
  })
  if (resources.length > 1) problem(`It changes systems of more than one type (${and(resources.map(r => r.title as string ?? r.name))}). Propose each type’s changes separately.`)
  // a revert only of a changeset waiting for the next release: a released one is fixed forward (D47, D66)
  changes.forEach((change, i) => {
    if (change.type !== 'revert' || pendingById.has(change.changeset)) return
    const released = releaseFolders(log).find(folder => fs.readdirSync(path.join(log, folder)).some(table => fs.existsSync(path.join(log, folder, table, `${change.changeset}.toml`))))
    problem(released
      ? `${nth(i, changes.length)} reverts ${q(change.changeset)}, which was released on ${released}. Only changes waiting for the next release can be reverted: propose a change that fixes it instead.`
      : `${nth(i, changes.length)} reverts ${q(change.changeset)}, which isn’t a changeset waiting for the next release.`, i)
  })
  // a system's place is part of its System ID, so an update can't move it: the build takes it, and data:check then fails (D96)
  changes.forEach((change, i) => {
    if (change.type === 'update' && isObject(change.values) && Object.hasOwn(change.values, 'country')) problem('A system’s place can’t change: its System ID names it. Propose a new system in the right place, and remove this one.', i, 'value')
  })
  // a new System ID has exactly two digits (-03), though the release's pattern takes more (D96)
  changes.forEach((change, i) => {
    if (change.type !== 'create' || typeof change.key !== 'string' || !tables.get(change.key) || /-[0-9]{2}$/.test(change.key)) return
    problem(`${q(change.key)}: a new System ID ends in exactly two digits, like pay-ke-03.`, i)
  })
  // the evidence of a change to no table the check knows, which has no value to check: its reason, sources and date, as the editor asks
  changes.forEach((change, i) => {
    if (change.type !== 'update' && change.type !== 'remove' && change.type !== 'revert') return
    if (change.type !== 'revert' && typeof change.key === 'string' && tables.get(change.key)) return
    if (change.type === 'revert' && pendingById.has(change.changeset)) return
    for (const found of evidenceProblems('', nth(i, changes.length), change)) problem(found.message, i, found.about ?? 'change')
  })
  if (!resource) {
    if (!keys.length && !reverted.length) problem('It doesn’t change any system.')
    return done()
  }
  result.resource = resource.name
  const dpiType = dpiTypeOf[resource.name]
  const keyId = fieldId(keyField(resource))

  // the editor's rules (D89), for each system it changes, on the fields the editor changes: the others,
  // like a derived one, are the build's to refuse, below. A value they refuse isn't refused again by the build
  const editableOf = (r: Resource) => r.schema.fields.map(fieldId).filter(id => id !== fieldId(keyField(r)) && id !== 'country' && !derivedFields.includes(id))
  const editable = editableOf(resource)
  const ruled = new Set<string>()
  for (const [key, proposal] of proposalsOf(changes as Change[], true)) {
    // each type's systems by its own table's rules, though only the first table's go on to the build (more than one is a problem already)
    const own = tables.get(key)
    if (!own) continue
    const ownEditable = editableOf(own)
    const ownKey = fieldId(keyField(own))
    const ownType = dpiTypeOf[own.name]
    const ruledEdits = { ...proposal, edits: proposal.edits.filter(edit => ownEditable.includes(edit.field)) }
    if (!ruledEdits.edits.length && !ruledEdits.remove) continue
    // no current values: a value that's already set is a warning, from the live data, below
    const spec = editSpec(own as never, { [ownKey]: key }, { name: key, type: nouns[ownType], country: '' }, ownEditable)
    for (const found of checkProposal(spec, ruledEdits)) {
      if (found.level !== 'error') continue
      problem(found.message, found.change, found.about ?? 'change')
      if (found.about === 'value') ruled.add(`${key}\0${found.field}`)
    }
    const removals = changes.flatMap((change, i) => change.type === 'remove' && change.key === key ? [i] : [])
    if (removals.length > 1) problem(`It removes ${q(key)} more than once.`, removals[1])
  }
  // an update of fields the editor doesn't change has no value for the rules to check, but its evidence is the same
  changes.forEach((change, i) => {
    const own = typeof change.key === 'string' ? tables.get(change.key) : undefined
    if (change.type !== 'update' || !own || Object.keys(change.values ?? {}).some(id => editableOf(own).includes(id))) return
    for (const found of evidenceProblems('', nth(i, changes.length), change)) problem(found.message, i, found.about ?? 'change')
  })
  // a create or a revert isn't a change the editor makes, but it needs its evidence too (D78, D90), and a
  // create's values meet the editor's rules: the codebook's values, and not NA, which a field it leaves out has
  const blank = editSpec(resource as never, { [keyId]: '' }, { name: '', type: nouns[dpiType], country: '' }, editable)
  changes.forEach((change, i) => {
    if (change.type !== 'create' && change.type !== 'revert') return
    for (const found of evidenceProblems('', nth(i, changes.length), change)) problem(found.message, i, found.about ?? 'change')
    for (const [id, value] of Object.entries((change.type === 'create' ? change.values : undefined) ?? {})) {
      const field = blank.fields.find(field => field.id === id)
      if (!field) continue
      for (const found of valueProblems(blank, field, String(value))) {
        problem(found.message, i, 'value')
        ruled.add(`${change.key}\0${id}`)
      }
    }
  })

  // the live data: the latest release and changesets/next/, with and without the proposal as one more pending changeset
  const id = changesetId(now)
  const file = path.join(PENDING_FOLDER, resource.name, `${id}.toml`)
  result.pending = Object.values(pending).flat().length
  const proposalReport: ReportItem[] = []
  // the changeset the build reads: as it is, or, if the rules report what the schema wouldn't take, without it
  const buildText = schemaErrors(data).length ? changesetText(proposalData as never) : work
  const proposal = changesetFromText(buildText, { id, resource: resource.name, folder: PENDING_FOLDER, file, path: path.join(log, file) }, proposalReport, now)
  const baseline = release ? loadBaseline(release, datapackage) : undefined
  const earlierFields = earlierFieldsOf(releases, datapackage)
  const before = buildRelease({ datapackage, baseline, earlierFields, changesets: pending, report: [...readReport] })
  const withProposal = { ...pending, [resource.name]: [...(pending[resource.name] ?? []), ...(proposal ? [proposal] : [])] }
  const after = buildRelease({ datapackage, baseline, earlierFields, changesets: withProposal, report: [...readReport, ...proposalReport] })
  // the build, written to a temporary folder for scripts/validate.mjs, as data:check-next does
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-check-'))
  try {
    writeRelease(out, PENDING_FOLDER, after, datapackage)
    checkRelease(out, after, datapackage)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }

  const rowOf = (built: BuildResult, key: string) => built.tables[resource.name]?.rows.find(row => row[keyId] === key)
  const recordIn = (built: BuildResult, key: string) => {
    const table = built.tables[resource.name]
    const row = table && tableRecords({ ...table, rows: table.rows.filter(row => row[keyId] === key) })[0]
    return row && recordOf(dpiType, row)
  }
  /** a system's name, or the System ID if it has none, or nothing if it isn't there */
  const named = (built: BuildResult, key: string) => {
    const record = recordIn(built, key)
    return record ? nameOf(dpiType, record) ?? key : undefined
  }
  /** a row with no name is said by its place, as the data names it, and its kind (D92): "Eritrea, unnamed digital payment system" */
  const nameIn = (built: BuildResult, key: string) => {
    const name = named(built, key)
    const place = name === key ? rowOf(built, key)?.country : undefined
    return place ? `${place}, unnamed ${nouns[dpiType]} system` : name
  }
  /** a system's place and kind, "Eritrea, unnamed digital payment system", if it's there with no name and the data has its place */
  const unnamedPlace = (key: string) => {
    const built = [before, after].find(built => unnamedIn(built, key))
    const name = built && nameIn(built, key)
    return name && name !== key ? name : undefined
  }
  /** whether a system is there with no name */
  const unnamedIn = (built: BuildResult, key: string) => {
    const record = recordIn(built, key)
    return record !== undefined && nameOf(dpiType, record) === undefined
  }
  /** a system as a sentence names it: its name, or if it has none, its place and kind with its System ID: "Eritrea, unnamed digital payment system (pay-er-01)" */
  const labelOf = (key: string, builds = [before, after]) => {
    const built = builds.find(built => nameIn(built, key) !== undefined)
    const name = built && nameIn(built, key)
    return built && unnamedIn(built, key) && name !== key ? `${name} (${key})` : name ?? key
  }
  const missing = missingValues(resource)
  const describe = (i: number) => {
    const change = changes[i]
    const ids = Object.keys(change.values ?? {})
    const system = labelOf(change.key, [before])
    if (change.type === 'remove') return `Removing ${system}`
    if (change.type === 'create') return `Adding ${change.key}`
    if (change.type === 'revert') return 'The revert'
    return ids.length ? `The change to ${and(ids.map(titleOf))} for ${system}` : nth(i, changes.length)
  }

  // what blocks: the build's report items about the proposal, in plain words
  const about = (item: ReportItem) => item.changeset === id || item.file === file || item.changesets?.includes(id)
  for (const item of after.report.filter(about)) {
    const change = item.change === undefined ? undefined : changes[item.change]
    // the change it's about, in the changeset's order
    const at = item.change ?? -1
    const where = item.change === undefined ? 'It' : describe(item.change)
    switch (item.kind) {
      case 'invalid-changeset':
        problem(/not a real calendar date/.test(item.message) && change
          ? `The evidence date ${q(String(change.as_of))} isn’t a real date (${describe(item.change!)}).`
          : `${where} can’t be read as a change: ${item.message.replace(/, so .* skipped$/, '')}.`, at, /not a real calendar date/.test(item.message) ? 'as_of' : 'change')
        break
      case 'invalid-toml':
        problem(`The changeset can’t be read: ${item.message.replace(/^is not valid TOML, so it is skipped: /, '')}.`)
        break
      case 'missing-row':
        problem(`${q(item.key ?? '')} isn’t a System ID in the data, so there’s no system to ${change?.type === 'remove' ? 'remove' : 'change'}.`, at)
        break
      case 'check': {
        const value = (item.key && rowOf(after, item.key)?.[item.field ?? '']) ?? ''
        // NA, and any value the editor's rules refuse, is reported above
        if (!missing.includes(value) && !ruled.has(`${item.key}\0${item.field}`)) problem(checkProblem(item, fields.get(item.field ?? ''), value, missing), at, 'value')
        break
      }
      case 'unknown-field':
        problem(`${q(item.field ?? '')} isn’t a field of ${nouns[dpiType]} systems, so it can’t be set.`, at, 'value')
        break
      case 'legacy-field':
        problem(`${q(item.field ?? '')} was a field in the ${item.release} release, but isn’t one now, so it can’t be set.`, at, 'value')
        break
      case 'derived-value':
        problem(`${titleOf(item.field ?? '')} is worked out from the data, so it can’t be set.`, at, 'value')
        break
      case 'key-value':
        problem(`${where}: the System ID can’t be changed.`, at, 'value')
        break
      case 'future-as-of':
        warnings.push(`${where} is dated ${change?.as_of}, after today. That’s allowed, but check it’s the date the source shows.`)
        break
      case 'older-change': {
        const dated = item.message.match(/Last updated in \S+, (\d{4}-\d{2}-\d{2})/)?.[1]
        warnings.push(`${where} is dated ${change?.as_of}, before the system’s Last updated${dated ? `, ${dated}` : ''}. It would still replace the value.`)
        break
      }
      case 'create-exists': {
        // a proposal adds a new system: one that's there is changed with updates (D90)
        const name = named(before, item.key ?? '')
        problem(`${q(item.key ?? '')} is already a system${name && name !== item.key ? `, ${name}` : ''}, so it can’t be added. Propose changes to it instead, or choose a new System ID.`, at)
        break
      }
      case 'no-effect':
      case 'revert-unknown':
        warnings.push(`${where} would do nothing: ${item.message.replace(/, so it does nothing$/, '')}.`)
        break
      default:
        warnings.push(`${where}: ${item.message}.`)
    }
  }

  // a new system (D91) is a create, and updates to its key in the same changeset, as the editor makes it: it needs at
  // least one field, which needn't be its name or status, and, gently, a place that has a row in this table with no
  // name might want that filled in instead
  // System IDs are never reused (D82), so a create's ID may not be one a system that's gone had: the key of any change
  // in any changeset, released or pending, or in a release's tables
  const released = readFolders(log, releaseFolders(log), datapackage, [], { now })
  const inReleases = releases.filter(folder => folder >= '2026-03-31').flatMap(folder => Object.keys(dpiTypeOf).flatMap(name => {
    const file = path.join(dataDir, folder, `${folder}-${name}.json`)
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[]).flatMap(row => typeof row[keyId] === 'string' ? [row[keyId] as string] : []) : []
  }))
  const used = usedIds([...Object.values(released), ...Object.values(pending)].flat().flatMap(changeset => changeset.changes), inReleases)
  for (const change of changes.filter(change => change.type === 'create' && typeof change.key === 'string' && tables.get(change.key) === resource)) {
    const key = change.key as string
    if (!rowOf(before, key) && used.has(key)) {
      const [, type, place] = key.match(/^([a-z]+)-([a-z]+)-\d+$/) ?? []
      problem(`${key} was used for a system that was removed; System IDs aren’t reused. Choose ${nextFreeId(used, type, place)}.`, changes.indexOf(change))
      continue
    }
    if (rowOf(before, key)) continue
    const fieldIds = [change, ...changes.filter(other => other.type === 'update' && other.key === key)]
      .flatMap(own => Object.keys(own.values ?? {})).filter(id => id !== 'country' && id !== keyId)
    if (!fieldIds.length) problem(`${q(key)}: ${NEEDS_A_FIELD}`, changes.indexOf(change))
    const place = key.match(/^([a-z]+-[a-z]+)-\d+$/)?.[1]
    const table = before.tables[resource.name]
    const unnamed = place && table ? tableRecords(table).filter(row => String(row[keyId]).startsWith(`${place}-`) && presence(dpiType, recordOf(dpiType, row)) !== 'named').map(row => String(row[keyId])) : []
    for (const id of unnamed) warnings.push(`${labelOf(id, [before])}: should this fill it in instead?`)
  }

  // each change, old → new from the live data
  const was = wasComments(text)
  const unchanged = unchangedComments(text)
  changes.forEach((change, i) => {
    result.evidence!.push({
      change: i, reason: typeof change.reason === 'string' ? change.reason.trim() : '',
      sources: Array.isArray(change.sources) ? change.sources.filter((url): url is string => typeof url === 'string').map(url => url.trim()) : [], as_of: String(change.as_of ?? '')
    })
    const key = change.key as string | undefined
    // a new system is said by its name, or its System ID until it has one (D91): its line says the rest
    const system = key ? named(before, key) ?? named(after, key) ?? key : undefined
    const label = key ? labelOf(key) : undefined
    // a row with no name is said by its place and kind, `unnamed`, while `system` stays its System ID, which accepting names it by
    const place = key && change.type !== 'create' ? unnamedPlace(key) : undefined
    const base = { change: i, type: change.type, ...(key ? { key } : {}), ...(system ? { system } : {}), ...(place ? { unnamed: place } : {}) }
    if (change.type === 'revert') {
      const target = pendingById.get(change.changeset)
      result.changes.push({ ...base, changeset: change.changeset, ...(target ? { reverts: target.changes.length } : {}) })
      return
    }
    if (change.type === 'remove') {
      const replacement = change.duplicate_of as string | undefined
      const replacedBy = replacement && (named(before, replacement) ?? named(after, replacement))
      if (replacement && !replacedBy) warnings.push(`${describe(i)} names ${q(replacement)} as its replacement, which isn’t a ${nouns[dpiType]} system in the data.`)
      const replacementPlace = replacement && unnamedPlace(replacement)
      result.changes.push({ ...base, ...(replacement ? { replacement: { key: replacement, ...(replacedBy ? { system: replacedBy } : {}), ...(replacementPlace ? { unnamed: replacementPlace } : {}) } } : {}) })
    }
    const oldRow = key ? rowOf(before, key) : undefined
    const newRow = key ? rowOf(after, key) : undefined
    for (const [id, value] of Object.entries((change.values ?? {}) as Record<string, string>)) {
      const old = oldRow?.[id]
      const title = titleOf(id)
      result.changes.push({ ...base, field: id, title, ...(old !== undefined && change.type !== 'create' ? { old } : {}), new: value })
      if (!fields.has(id) || derivedFields.includes(id) || id === keyId || !oldRow && change.type !== 'create') continue
      // NA, which no one sets a value back to (D73, D86), is the editor's rules', above
      if (missing.includes(value)) continue
      // a value that's already what it would be is "still true" (D92): a confirmation, with no warning of its own
      if (old !== value && newRow && newRow[id] !== value) {
        const winner = after.provenance[resource.name]?.[key!]?.[id]
        warnings.push(`A change waiting for the next release${winner ? `, dated ${winner.as_of},` : ''} sets ${title} for ${label} to ${q(newRow[id])}, so this change wouldn’t show.`)
      }
      // the editor writes `# was` on one line, as it shows a value with line breaks (D93)
      const proposed = was.get(`${i}\0${id}`)
      if (proposed !== undefined && old !== undefined && proposed !== oneLine(old)) warnings.push(`${title} for ${label} was ${q(proposed)} when this was proposed, and is ${q(old)} now.`)
      // marked `# unchanged`, but the live value is another one now
      if (unchanged.has(`${i}\0${id}`) && old !== undefined && old !== value) warnings.push(`${title} for ${label} was proposed as still ${q(value)}, but is ${q(old)} now.`)
    }
  })

  // with no source links, the reason should say where it came from (D90): a gentle word, not a problem
  const unsourced = changes.filter(change => change.type !== 'revert' && !change.sources?.length).length
  if (unsourced) warnings.push(`${unsourced === 1 ? 'A change has' : `${unsourced} changes have`} no source links: the reason should say where ${unsourced === 1 ? 'it' : 'they'} came from.`)

  // the DPI effect: each touched system's status, and the countries with a DPI-like system of each type,
  // with the systems a reverted changeset touches
  const revertedKeys = reverted.flatMap(id => pendingById.get(id)?.changes.flatMap(change => change.key ? [change.key] : []) ?? [])
  for (const key of [...new Set([...keys.filter(key => tables.get(key) === resource), ...revertedKeys])]) {
    const [then, now] = [recordIn(before, key), recordIn(after, key)]
    if (!then && !now) continue
    result.dpi.systems.push({
      key, system: named(before, key) ?? named(after, key) ?? key, ...(unnamedPlace(key) ? { unnamed: unnamedPlace(key) } : {}), dpiType,
      ...(then ? { before: then['DPI Status'] } : {}), ...(now ? { after: now['DPI Status'] } : {})
    })
  }
  for (const [name, type] of Object.entries(dpiTypeOf)) {
    const count = (built: BuildResult) => {
      const table = built.tables[name]
      const records = table ? tableRecords(table).map(row => recordOf(type, row)) : []
      return oneSystemPerCountry(records as never).filter(row => row?.['DPI Status'] === 'DPI').length
    }
    const [then, now] = [count(before), count(after)]
    if (then !== now) result.dpi.countries.push({ dpiType: type, noun: nouns[type], before: then, after: now })
  }
  return done()
}

/** The result for an issue with no changeset in it, or with a `problem` that stops it being read as one (issueProblem) */
export function notFound (problem?: string): ProposalResult {
  const release = previousRelease(releasesBefore(PENDING_FOLDER))
  return {
    found: false, applies: false, ...(release ? { release } : {}), pending: 0, warnings: [], changes: [], dpi: { systems: [], countries: [] },
    problems: [problem ?? 'No changeset was found in this issue. Open the proposal from the editor again, or put its changes under “Changeset”, as the editor writes them.']
  }
}

// --- the command line ---

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { issue: { type: 'boolean' }, event: { type: 'string' } } })
  if (positionals.length > 1 || (args.event && positionals.length)) {
    console.error('usage: npm run proposal:check -- [<file>|-] [--issue]\n       node scripts/proposal-check.ts --event <GitHub event JSON>')
    process.exit(2)
  }
  const input = positionals[0] && positionals[0] !== '-' ? positionals[0] : 0
  // an issue's body is data: it's read from the event's file, never passed through a shell (D56)
  const body = args.event ? String(JSON.parse(fs.readFileSync(args.event, 'utf8')).issue?.body ?? '') : fs.readFileSync(input, 'utf8')
  // the site's modules log what they notice, like a status they don't know, so stdout holds only the JSON
  console.log = console.error
  const result = args.event || args.issue ? checkIssueBody(body) : proposalCheck(body)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
