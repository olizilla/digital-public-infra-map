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
import { changesetFromText, changesetId, fieldId, keyField, missingValues, PENDING_FOLDER, readChangeset, readFolders, releaseFolders, schemaErrors } from '../lib/changesets/index.ts'
import type { BuildResult, Change, DataPackage, Field, ReportItem, Resource } from '../lib/changesets/index.ts'
import { derivedFields } from '../src/DpiLayer.ts'
import { allowedText, checkProposal, commentText, editSpec, evidenceProblems, fieldSpec, proposalsOf, sizeProblemOf, valueProblems } from '../src/Proposal.ts'
import {
  buildRelease, checkRelease, dpiTypeOf, earlierFieldsOf, loadBaseline, previousRelease, recordOf, releasesBefore, root, tableRecords, writeRelease,
  type DPIType
} from './release-build.ts'

// the site's modules, which need ./site-modules.ts to load in Node
const { nameOf, nouns } = await import('../src/DpiTest.ts')
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
  /** an update's or addition's field id, and its codebook title (D83) */
  field?: string
  title?: string
  /** the value in the latest release plus changesets/next/, and the proposal's */
  old?: string
  new?: string
  /** a removal's replacement (`duplicate_of`), and its name if it's in the data */
  replacement?: { key: string, system?: string }
  /** a revert's changeset, and how many changes it has */
  changeset?: string
  reverts?: number
}

/** A touched system's DPI status, before and after, where it has one */
export interface SystemEffect { key: string, system: string, dpiType: DPIType, before?: DpiStatus, after?: DpiStatus }

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

/** The DPI table whose System ID pattern `key` matches, if any */
function resourceOfKey (datapackage: DataPackage, key: string): Resource | undefined {
  return datapackage.resources.filter(r => dpiTypeOf[r.name]).find(r => {
    const pattern = keyField(r).constraints?.pattern
    return typeof pattern === 'string' && matches(pattern, key)
  })
}

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
  const problems: string[] = []
  const warnings: string[] = []
  const result: ProposalResult = {
    found: true, applies: false, ...(release ? { release } : {}), pending: 0, problems, warnings, changes: [], dpi: { systems: [], countries: [] },
    sha256: fingerprint(text), checked: now.toISOString()
  }
  const done = () => {
    result.problems = [...new Set(problems)]
    result.warnings = [...new Set(warnings)]
    result.applies = result.problems.length === 0
    return result
  }

  // the TOML, then the schema, in plain words, before the log's own reading, which says the same in the build's words
  let data: unknown
  try {
    data = readChangeset(text)
  } catch (error) {
    const date = (error as Error).message.match(/^line (\d+): (\S+) is not a real calendar date/)
    if (date) problems.push(`The evidence date ${date[2]}, on line ${date[1]}, isn’t a real date.`)
    else if (error instanceof TomlError) problems.push(`The changeset can’t be read at line ${error.line}, column ${error.column} (${error.message.split('\n')[0].replace(/^Invalid TOML document: /, '')}). Open the proposal in the editor again, or fix that line.`)
    else problems.push(`The changeset can’t be read: ${(error as Error).message.split('\n')[0]}.`)
    return done()
  }
  const changes: Record<string, any>[] = isObject(data) && Array.isArray(data.changes) ? data.changes.filter(isObject) : []
  // as the editor and accepting count it (D88, D89)
  const size = sizeProblemOf(text)
  if (size?.level === 'error') problems.push(size.message)

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

  const schema = schemaErrors(data)
  if (schema.length) {
    problems.push(...schema.flatMap(error => schemaProblem(error, data, titleOf) ?? []))
    return done()
  }
  for (const [key, r] of tables) if (!r) problems.push(`${q(key)} isn’t a System ID: it should look like pay-ke-01, id-ke-01 or dx-ke-01.`)
  if (resources.length > 1) problems.push(`It changes systems of more than one type (${and(resources.map(r => r.title as string ?? r.name))}). Propose each type’s changes separately.`)
  // a revert only of a changeset waiting for the next release: a released one is fixed forward (D47, D66)
  changes.forEach((change, i) => {
    if (change.type !== 'revert' || pendingById.has(change.changeset)) return
    const released = releaseFolders(log).find(folder => fs.readdirSync(path.join(log, folder)).some(table => fs.existsSync(path.join(log, folder, table, `${change.changeset}.toml`))))
    problems.push(released
      ? `${nth(i, changes.length)} reverts ${q(change.changeset)}, which was released on ${released}. Only changes waiting for the next release can be reverted: propose a change that fixes it instead.`
      : `${nth(i, changes.length)} reverts ${q(change.changeset)}, which isn’t a changeset waiting for the next release.`)
  })
  if (!resource) {
    if (!keys.length && !reverted.length) problems.push('It doesn’t change any system.')
    return done()
  }
  result.resource = resource.name
  const dpiType = dpiTypeOf[resource.name]
  const keyId = fieldId(keyField(resource))

  // the editor's rules (D89), for each system it changes, on the fields the editor changes: the others,
  // like a derived one, are the build's to refuse, below. A value they refuse isn't refused again by the build
  const editable = resource.schema.fields.map(fieldId).filter(id => id !== keyId && id !== 'country' && !derivedFields.includes(id))
  const ruled = new Set<string>()
  for (const [key, proposal] of proposalsOf(changes as Change[])) {
    if (tables.get(key) !== resource) continue
    const own = { ...proposal, edits: proposal.edits.filter(edit => editable.includes(edit.field)) }
    if (!own.edits.length && !own.remove) continue
    // no current values: a value that's already set is a warning, from the live data, below
    const spec = editSpec(resource as never, { [keyId]: key }, { name: key, type: nouns[dpiType], country: '' }, editable)
    for (const problem of checkProposal(spec, own)) {
      if (problem.level !== 'error') continue
      problems.push(problem.message)
      if (problem.about === 'value') ruled.add(`${key}\0${problem.field}`)
    }
    if (changes.filter(change => change.type === 'remove' && change.key === key).length > 1) problems.push(`It removes ${q(key)} more than once.`)
  }
  // a create or a revert isn't a change the editor makes, but it needs its evidence too (D78, D90), and a
  // create's values meet the editor's rules: the codebook's values, and not NA, which a field it leaves out has
  const blank = editSpec(resource as never, { [keyId]: '' }, { name: '', type: nouns[dpiType], country: '' }, editable)
  changes.forEach((change, i) => {
    if (change.type !== 'create' && change.type !== 'revert') return
    problems.push(...evidenceProblems('', nth(i, changes.length), change).map(problem => problem.message))
    for (const [id, value] of Object.entries((change.type === 'create' ? change.values : undefined) ?? {})) {
      const field = blank.fields.find(field => field.id === id)
      if (!field) continue
      for (const problem of valueProblems(blank, field, String(value))) {
        problems.push(problem.message)
        ruled.add(`${change.key}\0${id}`)
      }
    }
  })

  // the live data: the latest release and changesets/next/, with and without the proposal as one more pending changeset
  const id = changesetId(now)
  const file = path.join(PENDING_FOLDER, resource.name, `${id}.toml`)
  result.pending = Object.values(pending).flat().length
  const proposalReport: ReportItem[] = []
  const proposal = changesetFromText(text, { id, resource: resource.name, folder: PENDING_FOLDER, file, path: path.join(log, file) }, proposalReport, now)
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
  const nameIn = (built: BuildResult, key: string) => {
    const record = recordIn(built, key)
    return record ? nameOf(dpiType, record) ?? key : undefined
  }
  const missing = missingValues(resource)
  const describe = (i: number) => {
    const change = changes[i]
    const ids = Object.keys(change.values ?? {})
    const system = nameIn(before, change.key) ?? change.key
    if (change.type === 'remove') return `Removing ${system}`
    if (change.type === 'create') return `Adding ${change.key}`
    if (change.type === 'revert') return 'The revert'
    return ids.length ? `The change to ${and(ids.map(titleOf))} for ${system}` : nth(i, changes.length)
  }

  // what blocks: the build's report items about the proposal, in plain words
  const about = (item: ReportItem) => item.changeset === id || item.file === file || item.changesets?.includes(id)
  for (const item of after.report.filter(about)) {
    const change = item.change === undefined ? undefined : changes[item.change]
    const where = item.change === undefined ? 'It' : describe(item.change)
    switch (item.kind) {
      case 'invalid-changeset':
        problems.push(/not a real calendar date/.test(item.message) && change
          ? `The evidence date ${q(String(change.as_of))} isn’t a real date (${describe(item.change!)}).`
          : `${where} can’t be read as a change: ${item.message.replace(/, so .* skipped$/, '')}.`)
        break
      case 'invalid-toml':
        problems.push(`The changeset can’t be read: ${item.message.replace(/^is not valid TOML, so it is skipped: /, '')}.`)
        break
      case 'missing-row':
        problems.push(`${q(item.key ?? '')} isn’t a System ID in the data, so there’s no system to ${change?.type === 'remove' ? 'remove' : 'change'}.`)
        break
      case 'check': {
        const value = (item.key && rowOf(after, item.key)?.[item.field ?? '']) ?? ''
        // NA, and any value the editor's rules refuse, is reported above
        if (!missing.includes(value) && !ruled.has(`${item.key}\0${item.field}`)) problems.push(checkProblem(item, fields.get(item.field ?? ''), value, missing))
        break
      }
      case 'unknown-field':
        problems.push(`${q(item.field ?? '')} isn’t a field of ${nouns[dpiType]} systems, so it can’t be set.`)
        break
      case 'legacy-field':
        problems.push(`${q(item.field ?? '')} was a field in the ${item.release} release, but isn’t one now, so it can’t be set.`)
        break
      case 'derived-value':
        problems.push(`${titleOf(item.field ?? '')} is worked out from the data, so it can’t be set.`)
        break
      case 'key-value':
        problems.push(`${where}: the System ID can’t be changed.`)
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
        const name = nameIn(before, item.key ?? '')
        problems.push(`${q(item.key ?? '')} is already a system${name && name !== item.key ? `, ${name}` : ''}, so it can’t be added. Propose changes to it instead, or choose a new System ID.`)
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

  // each change, old → new from the live data
  const was = wasComments(text)
  changes.forEach((change, i) => {
    const key = change.key as string | undefined
    const system = key ? nameIn(before, key) ?? nameIn(after, key) ?? key : undefined
    const base = { change: i, type: change.type, ...(key ? { key } : {}), ...(system ? { system } : {}) }
    if (change.type === 'revert') {
      const target = pendingById.get(change.changeset)
      result.changes.push({ ...base, changeset: change.changeset, ...(target ? { reverts: target.changes.length } : {}) })
      return
    }
    if (change.type === 'remove') {
      const replacement = change.duplicate_of as string | undefined
      const named = replacement && (nameIn(before, replacement) ?? nameIn(after, replacement))
      if (replacement && !named) warnings.push(`${describe(i)} names ${q(replacement)} as its replacement, which isn’t a ${nouns[dpiType]} system in the data.`)
      result.changes.push({ ...base, ...(replacement ? { replacement: { key: replacement, ...(named ? { system: named } : {}) } } : {}) })
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
      if (old === value) warnings.push(`${title} for ${system} is already ${q(value)}, so this change would only add its reason and sources.`)
      else if (newRow && newRow[id] !== value) {
        const winner = after.provenance[resource.name]?.[key!]?.[id]
        warnings.push(`A change waiting for the next release${winner ? `, dated ${winner.as_of},` : ''} sets ${title} for ${system} to ${q(newRow[id])}, so this change wouldn’t show.`)
      }
      const proposed = was.get(`${i}\0${id}`)
      if (proposed !== undefined && old !== undefined && proposed !== old) warnings.push(`${title} for ${system} was ${q(proposed)} when this was proposed, and is ${q(old)} now.`)
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
      key, system: nameIn(before, key) ?? nameIn(after, key) ?? key, dpiType,
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

/** The result for an issue with no changeset in it */
export function notFound (): ProposalResult {
  const release = previousRelease(releasesBefore(PENDING_FOLDER))
  return {
    found: false, applies: false, ...(release ? { release } : {}), pending: 0, warnings: [], changes: [], dpi: { systems: [], countries: [] },
    problems: ['No changeset was found in this issue. Open the proposal from the editor again, or put its changes under “Changeset”, as the editor writes them.']
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
  const text = args.event || args.issue ? changesetInIssue(body) : body
  // the site's modules log what they notice, like a status they don't know, so stdout holds only the JSON
  console.log = console.error
  const result = text === undefined ? notFound() : proposalCheck(text)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
