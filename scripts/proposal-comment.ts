// The comment on a proposal issue (D88), from scripts/proposal-check.ts's result: minimal, and never
// "valid" or "approved". If the proposal can't be applied, the problems that stop it, as a short list.
// If it can, one line per change saying what it would do, old → new from the live data, then the DPI effect
// if there is one, then any warnings, as a short list. A hidden marker first, so the Action finds and edits
// its own comment (.github/workflows/proposal-check.yml), and a small footer saying what it was checked against.
// The marker records the SHA-256 of the TOML it checked, and when: accepting the proposal commits it only if
// the issue's TOML still has that fingerprint and wasn't edited after the check (scripts/proposal-accept.ts,
// D88). The time changes the comment on every check, so its last update is always the latest check's.
// When it applies, the comment ends with the exact TOML that was fingerprinted, in a collapsed <details> with a
// fence no backtick run in it can close, and shows each change's reason, sources and date under its line (D96), so
// whoever closes the issue sees what's committed. A comment can be at most 65,536 characters (COMMENT_LIMIT): if the
// TOML would take it over, the comment shows the evidence and says the full changeset is in the issue, and if even that is
// too long, it's cut, and says so.
// Every text is escaped, as a value or a name in a proposal is anyone's text: it can't add Markdown or
// HTML, mention someone or end the comment's marker.
//
// usage: node scripts/proposal-comment.ts [<result.json>|-]    prints the comment's Markdown

import fs from 'node:fs'
import path from 'node:path'
import type { ChangeEffect, ChangeEvidence, ProposalResult, SystemEffect } from './proposal-check.ts'

/**
 * The start of the comment's first line, a hidden marker, by which the Action finds it:
 * `<!-- dpimap-proposal-check sha256=<hex> checked=<time> -->`, or `<!-- dpimap-proposal-check -->` with no TOML
 */
export const MARKER = '<!-- dpimap-proposal-check '

/** The marker line for a check's result, with its fingerprint if it checked some TOML */
export const markerLine = (result: ProposalResult) =>
  `${MARKER}${result.sha256 ? `sha256=${result.sha256} ${result.checked ? `checked=${result.checked} ` : ''}` : ''}-->`

/** The fingerprint in a check comment's marker, and when it was checked, or undefined if the comment has no marker or no fingerprint */
export function commentFingerprint (body: string): { sha256: string, checked?: string } | undefined {
  const [, sha256, checked] = body.split('\n')[0].match(/^<!-- dpimap-proposal-check sha256=([0-9a-f]{64})(?: checked=(\S+))? -->\r?$/) ?? []
  return sha256 ? { sha256, ...(checked ? { checked } : {}) } : undefined
}

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

/**
 * Text as Markdown that shows it as it is, inside a line: on one line, with the punctuation that could
 * start emphasis, code, a link, HTML or an entity escaped, and a zero-width space after each @, so a value
 * can't mention anyone. A line's start isn't escaped: each text goes after "- " or a bold name.
 */
export function md (text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/[\\`*_[\]<>|~&]/g, ch => `\\${ch}`)
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
}

/** The most a comment can be on GitHub, in characters */
export const COMMENT_LIMIT = 65_536

/** Text as a code span, which GitHub doesn't turn into a link or a mention: a run of backticks longer than any inside it around it */
export function code (text: string): string {
  const line = text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
  const fence = '`'.repeat(Math.max(0, ...[...line.matchAll(/`+/g)].map(run => run[0].length)) + 1)
  return /^`|`$/.test(line) ? `${fence} ${line} ${fence}` : `${fence}${line}${fence}`
}

/**
 * The TOML in a collapsed section: a fence of backticks one longer than the longest run in the TOML (at least 3),
 * so nothing in it can end the fence, and nothing in it is escaped
 */
export function tomlDetails (toml: string): string[] {
  const fence = '`'.repeat(Math.max(2, ...[...toml.matchAll(/`+/g)].map(run => run[0].length)) + 1)
  return ['<details><summary>The changeset that closing this commits</summary>', '', `${fence}toml`, toml.replace(/\n$/, ''), fence, '', '</details>']
}

/** A change's evidence, compactly, under its line: "Reason: … · Sources: a, b · As of 2026-11-20", indented, with the reason and date escaped and the sources as plain text, not links */
function evidenceLine (evidence: ChangeEvidence, label?: string): string {
  const sources = evidence.sources.length ? evidence.sources.map(code).join(', ') : 'none'
  return `&nbsp;&nbsp;&nbsp;&nbsp;${label ? `${md(label)}: ` : ''}Reason: ${md(evidence.reason)} · Sources: ${sources} · As of ${md(evidence.as_of)}`
}

/** A release folder's date as the site's changelog says it: "6 Nov 2026" (src/Changes.ts dateOf) */
const dateOf = (folder: string) => new Date(`${folder}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "PesaLink (pay-ke-01)" */
const systemOf = (change: { key?: string, system?: string, unnamed?: string }) =>
  change.unnamed ? `${change.unnamed} (${change.key})` : change.system && change.system !== change.key ? `${change.system} (${change.key})` : change.key ?? 'A system'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * A change's line: "**PesaLink (pay-ke-01):** Status of Implementation, Implemented → Planned/Piloted."
 * A system with no name is said by its place: "**Eritrea, unnamed digital payment system (pay-er-01):** …". A value
 * restated with "Still true" (D92) is a confirmation: "**PesaLink (pay-ke-01):** confirms Status of Implementation is still Implemented."
 * A new system's is one line with its place and all its values, `values`, from its create and the updates to its
 * key that follow (D90, D91): "**New system:** would add PesaLink 2 (pay-ke-03), Kenya, with Payment system name,
 * PesaLink 2; Status of Implementation, Planned/Piloted." With no name, "an unnamed system (pay-ke-03)".
 */
function changeLine (change: ChangeEffect, values: ChangeEffect[] = [change]): string {
  const who = `**${md(systemOf(change))}:**`
  if (change.type === 'remove') {
    const by = change.replacement ? `, replaced by ${md(systemOf(change.replacement))}` : ''
    return `${who} removed${by}.`
  }
  if (change.type === 'revert') return `**Revert:** would undo pending changeset ${md(change.changeset ?? '')}${change.reverts === undefined ? '' : ` (${plural(change.reverts, 'change')})`}.`
  const value = md(change.new ?? '')
  if (change.type === 'create') {
    // the place is the create's Country / Region; the fields are the rest of its values, then the updates to the same key
    const place = values.find(v => v.type === 'create' && v.field === 'country')?.new
    const set = values.filter(v => v.field !== undefined && !(v.type === 'create' && v.field === 'country')).map(v => `${md(v.title ?? '')}, ${md(v.new ?? '')}`)
    const named = change.system && change.system !== change.key
    return `**New system:** would add ${named ? md(change.system!) : 'an unnamed system'} (${md(change.key ?? '')})${place ? `, ${md(place)}` : ''}${set.length ? `, with ${set.join('; ')}` : ''}.`
  }
  const old = change.old === undefined ? '' : md(change.old)
  // a value that's the one it has is "still true" (D92)
  return change.old === change.new
    ? `${who} confirms ${md(change.title ?? '')} is still ${value}.`
    : `${who} ${md(change.title ?? '')}, ${old} → ${value}.`
}

/**
 * What happens to a system's DPI status, in the site's words (DPI-like, in progress, src/CountryPage.ts):
 * "PesaLink would no longer be DPI-like", or undefined if nothing
 */
function statusLine (system: SystemEffect): string | undefined {
  const { before, after } = system
  // a removal or an addition is in its change's line, and the counts say what it does
  if (!before || !after || before === after) return undefined
  // a system with no name is said by its place and kind, and its System ID (D92)
  const name = md(system.unnamed ? `${system.unnamed} (${system.key})` : system.system)
  if (before === 'DPI') return `${name} would no longer be DPI-like`
  if (after === 'DPI') return `${name} would become DPI-like`
  return before === 'WIP' ? `${name} would no longer be in progress` : `${name} would be in progress`
}

/**
 * The comment's Markdown for a check's result. `show` says how much it shows (D96): everything, or without the TOML,
 * or without the evidence too. proposalComment picks the most that fits GitHub's limit.
 */
function commentLines (result: ProposalResult, show: 'all' | 'no-toml' | 'no-evidence'): string[] {
  const lines = [markerLine(result)]
  if (!result.applies) {
    lines.push('**This can’t be applied as it is:**', '', ...result.problems.map(problem => `- ${md(problem)}`))
  } else {
    // a new system is one line: its create's values, then the updates to its key (D91), which have no line of their own
    const created = new Set(result.changes.filter(change => change.type === 'create' && change.key).map(change => change.key))
    const evidenceOf = (change: number) => result.evidence?.find(item => item.change === change)
    const withEvidence = show !== 'no-evidence'
    result.changes.forEach((change, i, all) => {
      if (change.type === 'update' && created.has(change.key)) return
      if (change.type === 'create' && all.findIndex(other => other.change === change.change) !== i) return
      const same = change.type === 'create' ? all.filter(other => other.change === change.change || (other.type === 'update' && other.key === change.key)) : [change]
      lines.push(changeLine(change, same))
      if (!withEvidence) return
      // the evidence goes under the last line of a change that has several (one per value), and a new system's under its one line, each change's own
      if (change.type === 'create') {
        const places = [...new Set(same.map(other => other.change))]
        for (const place of places) {
          const evidence = evidenceOf(place)
          const titles = [...new Set(same.filter(other => other.change === place && other.field !== undefined && !(other.type === 'create' && other.field === 'country')).map(other => other.title ?? ''))]
          if (evidence) lines.push(evidenceLine(evidence, place === change.change ? 'Adding it' : titles.join(', ')))
        }
      } else if (all.findLastIndex(other => other.change === change.change) === i) {
        const evidence = evidenceOf(change.change)
        if (evidence) lines.push(evidenceLine(evidence))
      }
    })
    const effects = [
      ...result.dpi.systems.flatMap(system => statusLine(system) ?? []),
      ...result.dpi.countries.map(c => `countries with a DPI-like ${md(c.noun)} system, ${c.before} → ${c.after}`)
    ]
    if (effects.length) lines.push('', `${effects.join('; ')}.`.replace(/^countries/, 'Countries'))
  }
  if (result.warnings.length) lines.push('', '**To check:**', '', ...result.warnings.map(warning => `- ${md(warning)}`))
  if (result.release && result.found) {
    const waiting = result.pending ? 'and the changes waiting for the next one' : 'with no other changes waiting for the next one'
    lines.push('', `<sub>Checked against the ${dateOf(result.release)} release ${waiting}.</sub>`)
  }
  // a workflow that never ran can't say so (proposal-accept.yml), so the comment says what to expect
  if (result.applies) {
    lines.push('', '<sub>Closing this as completed commits it for the next release, and a line naming the file appears here. If none appears within a few minutes, reopen this and close it again.</sub>')
    if (result.toml !== undefined) lines.push('', ...(show === 'all' ? tomlDetails(result.toml) : ['<sub>The full changeset is in the issue: it’s too long to show here as well.</sub>']))
  }
  return lines
}

/** The comment's Markdown for a check's result, within GitHub's limit */
export function proposalComment (result: ProposalResult): string {
  for (const show of ['all', 'no-toml', 'no-evidence'] as const) {
    const text = commentLines(result, show).join('\n') + '\n'
    if (text.length <= COMMENT_LIMIT) return text
  }
  // still too long, as a huge value or a long list of warnings can make it: cut it, keeping the marker line, and say so
  const note = '\n\n<sub>This comment is cut short to fit GitHub’s limit. The full changeset is in the issue.</sub>\n'
  const lines = commentLines(result, 'no-evidence').join('\n')
  const cut = lines.slice(0, COMMENT_LIMIT - note.length)
  // not in the middle of a surrogate pair
  return (/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut) + note
}

// --- the command line ---

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const input = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 0
  process.stdout.write(proposalComment(JSON.parse(fs.readFileSync(input, 'utf8'))))
}
