// A proposal from the editor, /<id>/edit/ (D86, D87): what can be changed in each field, the checks a
// proposal must pass, its changeset as TOML, and the GitHub issue that carries it (D56).
// Each changed field is its own update, with its own reason, sources if any (D90) and evidence date (D78, D85);
// removing the system is a remove, which may name the system that replaces it (`duplicate_of`).
// Only the changes that are ready, with all they need, are sent (readiness).
// A draft link carries the form's state in the URL's fragment (D87).
// The rules a proposal meets are here once, checkProposal, which the editor uses and so does
// scripts/proposal-check.ts, on any proposal's TOML, so a hand-written one meets exactly the editor's (D89).
// The changeset has no id or filename, which are assigned when it's accepted (D58), and no
// author (D69).
// No astro: imports and nothing that needs Node, as the page's script runs it in the browser,
// and node --test loads it (src/Proposal.test.ts).
import { changesetText, isCalendarDate, tomlString } from '../lib/changesets/toml.ts'
import type { Change } from '../lib/changesets/types.ts'
import { listSeparator, listValues } from '../scripts/fields.mjs'

/** The site's repository, as `repository-code` in CITATION.cff */
export const repository = 'https://github.com/olizilla/digital-public-infra-map'
/** The issue form a proposal opens, .github/ISSUE_TEMPLATE/data-proposal.yml. Its one field is `changeset`, the TOML (D87). */
export const issueForm = 'data-proposal.yml'
/** Longer issue links can fail, so above this the TOML is copied for the person to paste (D56) */
export const maxUrlLength = 8000

/** How a field is edited: radio buttons of its values, checkboxes of a multi-valued field's parts, or a text box */
export type Control = 'choice' | 'multi' | 'text'

/** What a field allows, and its current value, for the editor */
export interface FieldSpec {
  id: string
  /** the codebook's name for the field, its label (D83) */
  title: string
  control: Control
  /** choice: the allowed values. multi: the parts a value lists, then the values that stand alone */
  values: string[]
  /** multi: the values that must be the whole cell, like Not Found */
  alone: string[]
  /** multi: the allowed values, when the codebook lists every combination of parts */
  combinations?: string[]
  /** the pattern a value must match as a whole, as Data Package's `pattern` */
  pattern?: string
  /** text: whether Not Found is allowed, for a box to tick */
  notFound: boolean
  /** the cell's text in the release the site shows */
  current: string
}

/** A system and its fields, as the editor needs them */
export interface EditSpec {
  /** the System ID: the changes' `key` */
  key: string
  /** the table, like `payment`: the folder in changesets/ */
  resource: string
  /** the system's name as the site shows it */
  name: string
  /** its DPI type, like `Payment` */
  type: string
  country: string
  /** the System ID's pattern, which a replacement's id must match */
  idPattern?: string
  /** the schema's missing values, like NA, which nothing can be set to (D73) */
  missing: string[]
  /** the fields that can be changed, in the page's order, which is the changeset's */
  fields: FieldSpec[]
}

/** A field of a datapackage.json resource, as far as the editor reads it */
interface PackageField {
  name: string
  title?: string
  constraints?: { enum?: unknown[], pattern?: string }
}
type MissingValue = string | { value: string }
interface PackageResource {
  name: string
  schema: { fields: PackageField[], missingValues?: MissingValue[], primaryKey?: string | string[] }
}

export const NOT_FOUND = 'Not Found'

/** Whether `value` matches a Data Package pattern, which must match the whole value, as scripts/validate.mjs checks it */
const matches = (pattern: string, value: string) => new RegExp(`^(?:${pattern})$`, 'u').test(value)

/**
 * A field's spec: radio buttons for an enum; checkboxes for a multi-valued field, whose pattern lists
 * its parts (transaction types) or whose enum lists their combinations (permitted participants);
 * otherwise a text box, checked against the field's pattern if it has one.
 */
export function fieldSpec (field: PackageField, current: string): FieldSpec {
  const base = { id: field.name, title: field.title ?? field.name, current, alone: [], notFound: false }
  const enumValues = field.constraints?.enum?.map(String)
  const pattern = field.constraints?.pattern
  if (enumValues?.some(value => value.includes(listSeparator))) {
    // the parts in the order the combinations give them, so ticked parts join as the codebook writes them
    const parts = [...new Set(enumValues.flatMap(value => value.includes(listSeparator) ? value.split(listSeparator) : []))]
    const alone = enumValues.filter(value => !parts.includes(value) && !value.includes(listSeparator))
    return { ...base, control: 'multi', values: [...parts, ...alone], alone, combinations: enumValues }
  }
  if (enumValues) return { ...base, control: 'choice', values: enumValues }
  const listed: string[] | undefined = listValues(field)
  if (listed && pattern) {
    // a value that can't start a list, like Not Found, must be the whole cell
    const alone = listed.filter(value => !matches(pattern, `${value}${listSeparator}${listed[0]}`))
    return { ...base, control: 'multi', values: listed, alone, pattern }
  }
  return { ...base, control: 'text', values: [], ...(pattern ? { pattern } : {}), notFound: !pattern || matches(pattern, NOT_FOUND) }
}

/**
 * A system's spec, from its resource in the root datapackage.json (the next release's codebook, which
 * pending changesets are checked against, D71) and its row. `editable` is the ids of the fields that can
 * be changed, in the page's order; the rest (the System ID, the place and the derived fields) are left out.
 */
export function editSpec (resource: PackageResource, row: Record<string, unknown>, about: { name: string, type: string, country: string }, editable: string[]): EditSpec {
  const key = [resource.schema.primaryKey ?? []].flat()[0]
  if (!key) throw new Error(`resource "${resource.name}" has no primaryKey`)
  const fields = editable.map(id => {
    const field = resource.schema.fields.find(field => field.name === id)
    if (!field) throw new Error(`no field "${id}" in resource "${resource.name}" of the root datapackage.json`)
    return fieldSpec(field, String(row[id] ?? ''))
  })
  const idPattern = resource.schema.fields.find(field => field.name === key)?.constraints?.pattern
  return {
    key: String(row[key]),
    resource: resource.name,
    ...about,
    ...(idPattern ? { idPattern } : {}),
    missing: (resource.schema.missingValues ?? ['']).map(missing => typeof missing === 'string' ? missing : missing.value),
    fields
  }
}

/** A multi-valued field's value from the parts that are ticked, in the codebook's order */
export function joinParts (spec: FieldSpec, ticked: string[]): string {
  const alone = ticked.find(value => spec.alone.includes(value))
  return alone ?? spec.values.filter(value => ticked.includes(value) && !spec.alone.includes(value)).join(listSeparator)
}

/** The parts of a multi-valued field's value, as ticked boxes. Text that isn't a part ticks nothing. */
export const splitParts = (spec: FieldSpec, value: string) =>
  spec.alone.includes(value) ? [value] : value.split(listSeparator).filter(part => spec.values.includes(part))

/** Whether the codebook allows `value` in a field. Missing values, like NA, never are (D73). */
export function allowedValue (spec: FieldSpec, value: string, missing: string[] = []): boolean {
  if (value === '' || missing.includes(value)) return false
  if (spec.control === 'choice') return spec.values.includes(value)
  if (spec.combinations) return spec.combinations.includes(value)
  return spec.pattern === undefined || matches(spec.pattern, value)
}

/** One changed field: its new value and the evidence for it */
export interface FieldEdit {
  field: string
  value: string
  reason: string
  sources: string[]
  /** the evidence date, YYYY-MM-DD: when the sources show the value to be true (D65, D85) */
  as_of: string
}

/** Removing the system, optionally naming the system that replaces it */
export interface RemoveEdit {
  reason: string
  sources: string[]
  as_of: string
  /** the System ID of the system it duplicates or that replaces it */
  duplicate_of?: string
}

export interface Proposal {
  edits: FieldEdit[]
  remove?: RemoveEdit
}

/** A problem with a proposal: an error stops it being sent, a warning doesn't. `field` is a field id, or `remove`. */
export interface Problem {
  level: 'error' | 'warning'
  field?: string
  /** the part of the change it's about */
  about?: 'value' | 'reason' | 'sources' | 'as_of' | 'duplicate_of'
  /** the problem in a sentence that names the field, as the check's comment says it */
  message: string
  /** the problem said shortly, for the line under its input in the editor, which says which field it is (D89) */
  hint?: string
  /** what the change still needs, for the receipt's total line, if not needWords' */
  need?: string
}

// The rules for a proposal (D89): one set, in the editor (its readiness and the line under each input)
// and in scripts/proposal-check.ts, which checks a proposal issue's TOML, hand-written or not, by the
// same rules, and adds only what needs the data, like whether the system exists. Each rule says what's
// wrong in plain words. Values, reasons and sources are trimmed first, as reading any changeset trims
// them, rather than refused for stray spaces; and sources are optional, as not every source has a public
// link, but each one given must be an http(s) link (D90).

/** The most a reason can be, in characters as a person counts them: graphemes, so a letter with accents, an Arabic letter or an emoji is one (D89) */
export const MAX_REASON = 500
/** The most a proposal's TOML can be, in UTF-8 bytes: what accepting it takes (scripts/proposal-accept.ts, D88) */
export const MAX_BYTES = 64 * 1024
/** The most an issue's body can be on GitHub, in characters, as its error says ("maximum is 65536 characters") */
export const MAX_ISSUE_CHARACTERS = 65_536
/**
 * What GitHub's issue form puts around the TOML in the issue's body (.github/ISSUE_TEMPLATE/data-proposal.yml,
 * `render: toml`): `### Changeset`, a blank line and the ```toml fence before it, and the closing fence after.
 * The TOML itself is trimmed.
 */
export const ISSUE_WRAPPER = '### Changeset\n\n```toml\n\n```'

const segmenter = typeof Intl === 'object' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined
/** Text's graphemes, or, where Intl.Segmenter is missing, its code points */
export const graphemes = (text: string): string[] => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : [...text]
/** How many characters text is, as a person counts them */
export const graphemeCount = (text: string) => graphemes(text).length
/** The first `n` characters of text, as a person counts them */
export const firstGraphemes = (text: string, n: number) => graphemes(text).slice(0, Math.max(0, n)).join('')
/** Text's size in UTF-8 bytes, as accepting counts a proposal's TOML */
export const byteSize = (text: string) => new TextEncoder().encode(text).length

/**
 * A proposal's size, both ways it's limited: its TOML in UTF-8 bytes, as accepting counts it, and the issue
 * body GitHub would make of it, in characters (UTF-16 code units, as a browser counts a text box's; never
 * fewer than GitHub counts), with the form's wrapper. The editor, the check and accepting all count with this.
 */
export const proposalSize = (toml: string) => ({ bytes: byteSize(toml), characters: ISSUE_WRAPPER.length + toml.trim().length })

/**
 * Whether a proposal's TOML is too large (D88, D89): over MAX_BYTES, or an issue body over GitHub's
 * MAX_ISSUE_CHARACTERS, whichever comes first. Plain letters reach GitHub's limit first, and other scripts and
 * emoji, of two to four bytes a character, the 64 KB. An error over either, and a warning from 7/8 of
 * either, so the person knows before they add more. The editor, the check and accepting use this one count.
 */
export function sizeProblemOf (toml: string): Problem | undefined {
  const { bytes, characters } = proposalSize(toml)
  if (bytes > MAX_BYTES) return { level: 'error', message: tooLargeText(bytes) }
  if (characters > MAX_ISSUE_CHARACTERS) return { level: 'error', message: `The proposal is ${characters.toLocaleString('en-GB')} characters as a GitHub issue, over the ${MAX_ISSUE_CHARACTERS.toLocaleString('en-GB')} an issue can be. Send some of its changes now, and the rest in another proposal.` }
  if (bytes > MAX_BYTES * 7 / 8 || characters > MAX_ISSUE_CHARACTERS * 7 / 8) {
    return { level: 'warning', message: `The proposal is ${Math.ceil(bytes / 1024)} KB, near the most a proposal can be.` }
  }
}

/** What a proposal over MAX_BYTES says, in the editor and the check */
export const tooLargeText = (bytes: number) =>
  `The proposal is ${Math.ceil(bytes / 1024)} KB, over the ${MAX_BYTES / 1024} KB a proposal can be. Send some of its changes now, and the rest in another proposal.`

/** A source as the changeset schema allows it: an http(s) URL with no spaces */
export const isSourceUrl = (url: string) => /^https?:\/\/\S+$/.test(url) && URL.canParse(url)

/** What's wrong with a link, shortly, or undefined if it's an http(s) URL (D89) */
export function linkProblem (url: string): string | undefined {
  if (isSourceUrl(url)) return undefined
  if (/\s/.test(url.trim())) return 'A link can’t have spaces.'
  if (/^https?:\/\//i.test(url.trim())) return 'This isn’t a complete link.'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(javascript|data|vbscript|file|mailto|tel|blob):/i.test(url)) return 'Only links starting https:// or http:// can be used.'
  return 'Start the link with https:// or http://'
}

/** Line breaks, tabs and other control characters, and the line and paragraph separators, none of which a value can have */
const controlCharacters = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/

/** Sources as typed: trimmed, blanks dropped, each once */
export const cleanSources = (sources: string[]) => [...new Set(sources.map(url => url.trim()).filter(Boolean))]

/** Today's date where the person is, as YYYY-MM-DD: the default evidence date */
export function localDate (now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "a, b or c" */
const or = (values: string[]) => values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`

/** "a, b and c" */
const and = (values: string[]) => values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`

/** What the codebook allows in a field, as a sentence after saying a value isn't allowed: " It can be Yes, No or Not Found." */
export function allowedText (field: FieldSpec, missing: string[] = []): string {
  const values = field.values.filter(value => !missing.includes(value))
  if (field.control === 'choice') return ` It can be ${or(values)}.`
  if (field.combinations) return ` It can be ${or(field.combinations)}.`
  if (field.control === 'multi') {
    const alone = field.alone.length ? `, or ${or(field.alone)}` : ''
    return ` It can be one or more of ${and(values.filter(value => !field.alone.includes(value)))}, separated by “, ”${alone}.`
  }
  if (isLinkField(field)) return ` It must be a web address starting http:// or https://${matches(field.pattern!, NOT_FOUND) ? `, or ${NOT_FOUND}` : ''}.`
  return ''
}

/** Whether a field holds a web address, as the URL field's pattern does */
const isLinkField = (field: FieldSpec) => field.control === 'text' && field.pattern !== undefined && matches(field.pattern, 'https://example.org/')

/**
 * The problems with a change's evidence (D78, D85, D89, D90): a reason, of at most MAX_REASON characters;
 * sources if there are any, as a source may have no public link, which the reason then says where it came
 * from, but each one given an http(s) link, none twice; and a real evidence date. The reason and sources are
 * trimmed first, as reading a changeset trims them (lib/changesets/log.ts). `what` names the change.
 */
export function evidenceProblems (field: string, what: string, edit: { reason?: string, sources?: string[], as_of?: string }, today?: string): Problem[] {
  const problems: Problem[] = []
  const error = (about: Problem['about'], message: string, hint: string, need?: string) => problems.push({ level: 'error', field, about, message, hint, ...(need ? { need } : {}) })
  const reason = (edit.reason ?? '').trim()
  const sources = (edit.sources ?? []).map(url => url.trim())
  const asOf = edit.as_of ?? ''
  const length = graphemeCount(reason)
  if (!reason) error('reason', `${what} needs a reason.`, 'Give a reason.')
  else if (length > MAX_REASON) error('reason', `${what}: the reason is ${length} characters, over the ${MAX_REASON} it can be.`, `Keep it to ${MAX_REASON} characters (it’s ${length}).`, 'a shorter reason')
  sources.forEach((url, i) => {
    const problem = linkProblem(url)
    const which = sources.length > 1 ? `Source ${i + 1}: ` : ''
    if (problem) error('sources', `${what}: “${commentText(url)}” isn’t a web address starting http:// or https://.`, which + problem, 'a working source link')
    else if (sources.indexOf(url) < i) error('sources', `${what} lists “${commentText(url)}” twice.`, `${which}listed twice.`, 'a working source link')
  })
  if (!isCalendarDate(asOf)) error('as_of', `${what} needs an evidence date.`, asOf ? 'Choose a real date.' : 'Choose a date.')
  // a later date is sometimes meant, so it's a warning, as in data:check (D85)
  else if (today && asOf > today) problems.push({ level: 'warning', field, about: 'as_of', message: `${what} is dated ${asOf}, after today. That’s allowed, but check it’s the date the source shows.`, hint: 'After today: check it’s the date the source shows.' })
  return problems
}

/**
 * The problems with a field's new value (D73, D89, D90): one the codebook allows, never NA, not empty, on one
 * line, and a link only if http(s). It's trimmed first, as reading a changeset trims every value
 * (lib/changesets/log.ts), so spaces around it are never a problem, but a value of spaces is empty.
 */
export function valueProblems (spec: EditSpec, field: FieldSpec, untrimmed: string): Problem[] {
  const value = untrimmed.trim()
  const error = (message: string, hint: string, need?: string): Problem[] => [{ level: 'error', field: field.id, about: 'value', message, hint, ...(need ? { need } : {}) }]
  const nothing = field.notFound ? `If you looked and found nothing, ${field.control === 'text' ? 'tick' : 'choose'} ${NOT_FOUND}.` : ''
  if (spec.missing.includes(value)) return error(`${field.title} can’t be set to ${value}, which means not researched yet. If you looked and found nothing, choose ${NOT_FOUND}.`, `${value} can’t be chosen: it means not researched yet.`)
  if (!value) return error(`${field.title} needs a value.${nothing ? ` ${nothing}` : ''}`, field.control === 'text' ? `Give a value${field.notFound ? `, or tick ${NOT_FOUND}` : ''}.` : 'Choose a value.')
  if (controlCharacters.test(value)) return error(`${field.title} can’t have a line break, a tab or another control character.`, 'Keep it to one line, with no tabs.')
  if (value === field.current) return error(`${field.title} is the same as now.`, 'This is the value it has now.')
  if (isLinkField(field) && value !== NOT_FOUND && linkProblem(value)) return error(`${field.title}: “${value}” isn’t a web address starting http:// or https://.`, linkProblem(value)!, 'a working link')
  if (!allowedValue(field, value, spec.missing)) {
    return error(`${field.title}: “${commentText(value)}” isn’t a value the codebook allows.${allowedText(field, spec.missing)}`, field.control === 'choice' ? 'Choose one of the values above.' : 'Not a value the codebook allows.')
  }
  return []
}

/**
 * What's wrong with a proposal, if anything, by the rules every proposal meets, in the editor and in the
 * check (D89): each change's value (valueProblems) and evidence (evidenceProblems); a removal's
 * replacement, a System ID that isn't this system's; a removal or values, not both; and each field
 * once. `today` is the person's date, YYYY-MM-DD, for the warning about a later evidence date; without
 * it, there's no warning. The check gives fields no current value, so no value is "the same as now":
 * a value that's already set is its warning, from the live data.
 */
export function checkProposal (spec: EditSpec, proposal: Proposal, today?: string): Problem[] {
  const problems: Problem[] = []
  if (!proposal.edits.length && !proposal.remove) problems.push({ level: 'error', message: 'Nothing to propose yet: change a value, or propose removing this system.' })
  if (proposal.edits.length && proposal.remove) {
    problems.push({ level: 'error', message: 'A proposal either changes values or removes the system, not both. Undo the changed values, or don’t propose removing it.', hint: 'Undo the changed values, or don’t propose removing it.' })
  }
  const seen = new Set<string>()
  for (const edit of proposal.edits) {
    const field = spec.fields.find(field => field.id === edit.field)
    if (!field) {
      problems.push({ level: 'error', field: edit.field, message: `“${commentText(edit.field)}” can’t be changed here.` })
      continue
    }
    if (seen.has(field.id)) problems.push({ level: 'error', field: field.id, about: 'value', message: `${field.title} is changed twice. Change each field once.`, hint: 'Changed twice.' })
    seen.add(field.id)
    problems.push(...valueProblems(spec, field, edit.value), ...evidenceProblems(field.id, field.title, edit, today))
  }
  if (proposal.remove) {
    const remove = proposal.remove
    problems.push(...evidenceProblems('remove', 'Removing this system', remove, today))
    const replacement = remove.duplicate_of
    const error = (message: string, hint: string) => problems.push({ level: 'error', field: 'remove', about: 'duplicate_of', message, hint })
    if (replacement !== undefined) {
      if (replacement === spec.key) error(`The replacement, ${spec.key}, is this system. Name another system, or none.`, 'Name another system, not this one.')
      else if (spec.idPattern && !matches(spec.idPattern, replacement)) error(`“${commentText(replacement)}” isn’t a ${spec.type} System ID, like ${spec.key}.`, `Not a ${spec.type} System ID, like ${spec.key}.`)
    }
  }
  return problems
}

/**
 * A changeset's changes as proposals, one for each system they change (D89): each value an update sets
 * is an edit with the update's reason, sources and date, and a remove is the removal. This is how the
 * check reads a proposal's TOML, hand-written or not, to apply the editor's rules to it. Creates and
 * reverts aren't changes the editor makes, so they're left out.
 */
export function proposalsOf (changes: Change[]): Map<string, Proposal> {
  const proposals = new Map<string, Proposal>()
  for (const change of changes) {
    if (typeof change.key !== 'string' || (change.type !== 'update' && change.type !== 'remove')) continue
    const proposal = proposals.get(change.key) ?? { edits: [] }
    proposals.set(change.key, proposal)
    const evidence = { reason: change.reason ?? '', sources: change.sources ?? [], as_of: change.as_of ?? '' }
    if (change.type === 'update') {
      for (const [field, value] of Object.entries(change.values ?? {})) proposal.edits.push({ field, value: String(value), ...evidence })
    } else if (!proposal.remove) {
      // a second removal of the same system is the check's to refuse
      proposal.remove = { ...evidence, ...(change.duplicate_of !== undefined ? { duplicate_of: change.duplicate_of } : {}) }
    }
  }
  return proposals
}

/**
 * The proposal's changes: an update per changed field, in the page's order, or a remove. Values, reasons
 * and sources are trimmed, as reading a changeset trims them (D90), and a change with no sources has none,
 * which changesetText leaves out.
 */
export function proposalChanges (spec: EditSpec, proposal: Proposal): Change[] {
  const order = (edit: FieldEdit) => spec.fields.findIndex(field => field.id === edit.field)
  const sourcesOf = (sources: string[]) => {
    const trimmed = sources.map(url => url.trim())
    return trimmed.length ? { sources: trimmed } : {}
  }
  const updates: Change[] = proposal.edits.toSorted((a, b) => order(a) - order(b)).map(edit => ({
    type: 'update',
    key: spec.key,
    as_of: edit.as_of,
    values: { [edit.field]: edit.value.trim() },
    reason: edit.reason.trim(),
    ...sourcesOf(edit.sources)
  }))
  const remove = proposal.remove
  return remove
    ? [...updates, {
        type: 'remove',
        key: spec.key,
        ...(remove.duplicate_of ? { duplicate_of: remove.duplicate_of } : {}),
        as_of: remove.as_of,
        reason: remove.reason.trim(),
        ...sourcesOf(remove.sources)
      }]
    : updates
}

/** Text for a comment, on one line: control characters and line breaks, which could end it, become spaces */
export const commentText = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ')

/**
 * The proposal's changeset in parts: its header comment, `# <system>, <place>`, and each change's
 * TOML with the field it changes, or `remove`, so the editor's receipt can show them one by one
 * (D87). proposalTOML joins them.
 */
export function proposalTOMLParts (spec: EditSpec, proposal: Proposal): { header: string, changes: { field: string, text: string }[] } {
  const changes = proposalChanges(spec, proposal).map(change => {
    // one change at a time, which changesetText joins as it joins them all
    const text = changesetText({ changes: [change] })
    const [id] = Object.keys(change.values ?? {})
    const field = spec.fields.find(field => field.id === id)
    if (!field) return { field: 'remove', text }
    // the first line that starts `values.` is the value's: only the reason, after it, can span lines.
    // Lines are split at \n only, as TOML's are: a regex's ^ and $ would also split a value at U+2028
    const was = `  # was ${tomlString(commentText(field.current || 'NA'))}`
    const lines = text.split('\n')
    const at = lines.findIndex(line => line.startsWith('values.'))
    lines[at] += was
    return { field: field.id, text: lines.join('\n') }
  })
  return { header: `# ${commentText(spec.name)}, ${commentText(spec.country)}`, changes }
}

/**
 * The proposal's changeset, as TOML (lib/changesets/toml.ts): what goes in the issue, and what
 * accepting it commits, as written (D87). It's changesetText's, with comments for people reading it:
 * a first line `# <system>, <place>`, and after each changed value `# was <the value the form
 * started from>`, as a TOML string, like the value. Take the comments out and it's exactly what
 * changesetTOML writes (src/Proposal.test.ts).
 */
export function proposalTOML (spec: EditSpec, proposal: Proposal): string {
  const { header, changes } = proposalTOMLParts(spec, proposal)
  return `${header}\n` + changes.map(change => change.text).join('\n')
}

// Which changes are ready to send (D86, D87). The editor sends only the ready ones, and its receipt
// shows only them; the others wait in the form and in the draft link.

/** What a change still needs, in words, by the part a problem is about, in the order a row asks for them */
export const needWords: Record<NonNullable<Problem['about']>, string> = {
  value: 'an allowed value', reason: 'a reason', sources: 'a working source link', as_of: 'an evidence date', duplicate_of: 'a valid System ID'
}

/** The order the total line names what changes need in: a row's, top to bottom */
const needOrder = [needWords.value, 'a working link', needWords.reason, 'a shorter reason', needWords.sources, needWords.as_of, needWords.duplicate_of]

/** A change in the form: the field it changes, or `remove`, its label, and what it still needs, in words. It's ready when `needs` is empty. */
export interface ChangeState {
  field: string
  title: string
  needs: string[]
}

export interface Readiness {
  /** the ready changes: what's sent */
  ready: Proposal
  /** every change, ready or not, in the page's order, the removal last */
  changes: ChangeState[]
}

/**
 * Which of a proposal's changes are ready: those with no error of their own, so an allowed value, a
 * reason and a real evidence date (D73, D78, D85); sources are optional, but one that isn't a working link
 * stops it (D90). A warning, like a date
 * after today, doesn't stop one. Problems that aren't about one change, like changing values and
 * removing the system at once, are checkProposal's to report on the ready proposal.
 */
export function readiness (spec: EditSpec, proposal: Proposal, today: string): Readiness {
  const errors = checkProposal(spec, proposal, today).filter(problem => problem.level === 'error' && problem.field)
  const order = Object.keys(needWords)
  const needsOf = (field: string) => {
    const mine = errors.filter(problem => problem.field === field).sort((a, b) => order.indexOf(a.about ?? 'value') - order.indexOf(b.about ?? 'value'))
    return [...new Set(mine.map(problem => problem.need ?? needWords[problem.about ?? 'value']))]
  }
  const at = (edit: FieldEdit) => spec.fields.findIndex(field => field.id === edit.field)
  const edits = proposal.edits.toSorted((a, b) => at(a) - at(b))
  const changes = edits.map(edit => ({ field: edit.field, title: spec.fields.find(field => field.id === edit.field)?.title ?? edit.field, needs: needsOf(edit.field) }))
  const remove = proposal.remove && { field: 'remove', title: 'Removing this system', needs: needsOf('remove') }
  if (remove) changes.push(remove)
  const ready = edits.filter(edit => !needsOf(edit.field).length)
  return { ready: remove && !remove.needs.length ? { edits: ready, remove: proposal.remove } : { edits: ready }, changes }
}

const changesText = (n: number) => `${n} change${n === 1 ? '' : 's'}`
/** Whether the form both changes values and removes the system, which a proposal can't (D89) */
const bothKinds = (changes: ChangeState[]) => changes.some(change => change.field === 'remove') && changes.some(change => change.field !== 'remove')

/** How many changes are ready, as the receipt's summary on a phone says it: "2 changes ready" */
export function readyText ({ changes }: Readiness): string {
  if (bothKinds(changes)) return 'a removal or values, not both'
  const ready = changes.filter(change => !change.needs.length).length
  return ready ? `${changesText(ready)} ready` : 'nothing ready yet'
}

/**
 * The receipt's total line: how many changes are ready, and what the rest still need, in plain words,
 * like "1 change ready · 1 still needs a reason and a source". Several that need different things
 * "need a reason or a source".
 */
export function totalLine (state: Readiness): string {
  const waiting = state.changes.filter(change => change.needs.length)
  const ready = state.changes.length - waiting.length
  if (!state.changes.length) return 'Nothing ready yet. Change a value, then give its reason.'
  // not "2 changes ready": they can't be sent together
  if (bothKinds(state.changes)) return 'A proposal either changes values or removes the system, not both.'
  if (!waiting.length) return readyText(state)
  const needs = [...new Set(waiting.flatMap(change => change.needs))].sort((a, b) => needOrder.indexOf(a) - needOrder.indexOf(b))
  const same = waiting.every(change => change.needs.length === needs.length)
  const rest = `still ${waiting.length === 1 ? 'needs' : 'need'} ${same ? and(needs) : or(needs)}`
  return ready ? `${readyText(state)} · ${waiting.length} ${rest}` : `Nothing ready yet · ${changesText(waiting.length)} ${rest}`
}

/** Why sending now leaves some changes out: "1 change isn’t ready and won’t be sent: Status needs a reason." */
export function notReadyText ({ changes }: Readiness): string {
  const waiting = changes.filter(change => change.needs.length)
  return `${changesText(waiting.length)} ${waiting.length === 1 ? 'isn’t' : 'aren’t'} ready and won’t be sent: ` +
    waiting.map(change => `${change.title} needs ${and(change.needs)}.`).join(' ')
}

/** The button that sends only the ready changes: "Send the 2 ready changes" */
export const sendReadyText = ({ ready }: Readiness) => {
  const n = ready.edits.length + (ready.remove ? 1 : 0)
  return n === 1 ? 'Send the ready change' : `Send the ${n} ready changes`
}

/** Whether a proposal is too large, as the check and accepting count it (sizeProblemOf): an error, or a warning near the limit */
export const sizeProblem = (spec: EditSpec, proposal: Proposal): Problem | undefined => sizeProblemOf(proposalTOML(spec, proposal))

export const issueTitle = (spec: EditSpec) => `Proposal: ${spec.name} (${spec.key})`

/**
 * The link to a new issue with the form filled in: GitHub fills an issue form's fields from query
 * parameters named by their ids. The issue holds just the TOML (D87). Over maxUrlLength it's `tooLong`, and `blank` is the form with only
 * its title, for pasting the TOML into (D56).
 */
export function issueLink (spec: EditSpec, proposal: Proposal) {
  const form = `${repository}/issues/new?template=${issueForm}`
  const query = (params: Record<string, string>) => Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')
  const title = issueTitle(spec)
  const toml = proposalTOML(spec, proposal)
  const url = form + query({ title, changeset: toml })
  return { url, tooLong: url.length > maxUrlLength, blank: form + query({ title }), title, toml }
}

// A draft link, /<id>/edit/#draft=<text> (D87): the form's state, to finish later or pass on. It's in
// the fragment, which browsers never send to a server. The text is `z.` and the state's JSON
// compressed with deflate-raw, or, where CompressionStream is missing, `j.` and the JSON as it is,
// either one base64url.

/** What a draft link holds: the System ID, and each changed field and the removal as the form has them */
interface DraftState {
  v: 1
  key: string
  edits: FieldEdit[]
  remove?: RemoveEdit
}

/** The most a draft's JSON can be, so a link can't make the page unpack something huge */
const maxDraftBytes = 1_000_000

function toBase64url (bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64url (text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0))
}

/** Bytes through a CompressionStream or DecompressionStream, up to maxDraftBytes */
async function through (bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxDraftBytes) {
      await reader.cancel()
      throw new Error('too big')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** A draft link's text for a proposal: compressed, unless `compress` is false or the browser can't */
export async function encodeDraft (spec: EditSpec, proposal: Proposal, compress = typeof CompressionStream === 'function'): Promise<string> {
  const state: DraftState = { v: 1, key: spec.key, edits: proposal.edits, ...(proposal.remove ? { remove: proposal.remove } : {}) }
  const json = new TextEncoder().encode(JSON.stringify(state))
  return compress ? `z.${toBase64url(await through(json, new CompressionStream('deflate-raw')))}` : `j.${toBase64url(json)}`
}

/** A draft restored: its proposal and the fields left out, or why it can't be */
export type DraftResult = { ok: true, proposal: Proposal, ignored: string[] } | { ok: false, message: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const textOf = (value: unknown) => typeof value === 'string' ? value : ''

/** A change's evidence from a draft: text where there should be text, and no evidence date unless it's a real one, so the form keeps today */
const evidenceFrom = (state: Record<string, unknown>) => ({
  reason: textOf(state.reason),
  sources: cleanSources(Array.isArray(state.sources) ? state.sources.filter(url => typeof url === 'string') : []),
  as_of: typeof state.as_of === 'string' && isCalendarDate(state.as_of) ? state.as_of : ''
})

/** Whether the form can hold `value` as a change to `field`: a value the codebook allows, not the current one, that its inputs can show */
function formAllows (spec: EditSpec, field: FieldSpec, value: string): boolean {
  if (valueProblems(spec, field, value).length) return false
  if (field.control !== 'multi') return true
  // ticks for the value, which aren't the ticks the form starts with
  return joinParts(field, splitParts(field, value)) === value && value !== joinParts(field, splitParts(field, field.current))
}

/**
 * The proposal in a draft link's text, if it's for this system. Fields this page can't change, values
 * the form wouldn't allow, and a field given twice are left out, and named in `ignored`.
 */
export async function decodeDraft (spec: EditSpec, text: string): Promise<DraftResult> {
  const unreadable = { ok: false, message: 'The draft in this link couldn’t be read, so nothing was restored.' } as const
  let state: unknown
  try {
    const [, format, data] = text.match(/^([zj])\.(.*)$/s) ?? []
    if (!format || text.length > maxDraftBytes) return unreadable
    if (format === 'z' && typeof DecompressionStream !== 'function') return { ok: false, message: 'This browser can’t read the draft in this link, so nothing was restored. Try another browser.' }
    const bytes = format === 'z' ? await through(fromBase64url(data), new DecompressionStream('deflate-raw')) : fromBase64url(data)
    state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return unreadable
  }
  if (!isObject(state) || state.v !== 1 || !Array.isArray(state.edits)) return unreadable
  if (state.key !== spec.key) {
    const key = typeof state.key === 'string' && /^[\w-]{1,40}$/.test(state.key) ? ` (${state.key})` : ''
    return { ok: false, message: `This draft link is for another system${key}, not ${spec.key}, so nothing was restored.` }
  }
  const edits: FieldEdit[] = []
  const ignored: string[] = []
  for (const edit of state.edits) {
    const id = isObject(edit) ? textOf(edit.field) : ''
    const field = spec.fields.find(field => field.id === id)
    if (!isObject(edit) || !field || typeof edit.value !== 'string' || !formAllows(spec, field, edit.value) || edits.some(earlier => earlier.field === id)) {
      ignored.push(field?.title ?? (id ? commentText(id).slice(0, 40) : 'a change'))
      continue
    }
    edits.push({ field: field.id, value: edit.value, ...evidenceFrom(edit) })
  }
  let remove: RemoveEdit | undefined
  if (isObject(state.remove)) {
    const replacement = textOf(state.remove.duplicate_of).trim()
    remove = { ...evidenceFrom(state.remove), ...(replacement ? { duplicate_of: replacement } : {}) }
  }
  if (!edits.length && !remove) return { ok: false, message: 'The draft in this link has nothing this page can restore, so nothing was restored.' }
  return { ok: true, proposal: remove ? { edits, remove } : { edits }, ignored }
}
