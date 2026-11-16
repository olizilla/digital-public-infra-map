// The comment on a proposal issue (D88), from scripts/proposal-check.ts's result: minimal, and never
// "valid" or "approved". If the proposal can't be applied, the problems that stop it, as a short list.
// If it can, one line per change saying what it would do, old → new from the live data, then the DPI effect
// if there is one, then any warnings, as a short list. A hidden marker first, so the Action finds and edits
// its own comment (.github/workflows/proposal-check.yml), and a small footer saying what it was checked against.
// The marker records the SHA-256 of the TOML it checked, and when: accepting the proposal commits it only if
// the issue's TOML still has that fingerprint and wasn't edited after the check (scripts/proposal-accept.ts,
// D88). The time changes the comment on every check, so its last update is always the latest check's.
// Every text is escaped, as a value or a name in a proposal is anyone's text: it can't add Markdown or
// HTML, mention someone or end the comment's marker.
//
// usage: node scripts/proposal-comment.ts [<result.json>|-]    prints the comment's Markdown

import fs from 'node:fs'
import path from 'node:path'
import type { ChangeEffect, ProposalResult, SystemEffect } from './proposal-check.ts'

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

/** A release folder's date as the site's changelog says it: "6 Nov 2026" (src/Changes.ts dateOf) */
const dateOf = (folder: string) => new Date(`${folder}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "PesaLink (pay-ke-01)" */
const systemOf = (change: { key?: string, system?: string }) => change.system && change.system !== change.key ? `${change.system} (${change.key})` : change.key ?? 'A system'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * A change's line: "**PesaLink (pay-ke-01):** Status of Implementation, Implemented → Planned/Piloted."
 * A new system's is one line with all its values, `values` (D90): "**New system:** would add PesaLink 2
 * (pay-ke-03), with Country, Kenya; Payment system name, PesaLink 2."
 */
function changeLine (change: ChangeEffect, values: ChangeEffect[] = [change]): string {
  const who = `**${md(systemOf(change))}:**`
  if (change.type === 'remove') {
    const by = change.replacement ? `, replaced by ${md(systemOf({ key: change.replacement.key, system: change.replacement.system }))}` : ''
    return `${who} removed${by}.`
  }
  if (change.type === 'revert') return `**Revert:** would undo pending changeset ${md(change.changeset ?? '')}${change.reverts === undefined ? '' : ` (${plural(change.reverts, 'change')})`}.`
  const value = md(change.new ?? '')
  if (change.type === 'create') {
    const set = values.filter(v => v.field !== undefined).map(v => `${md(v.title ?? '')}, ${md(v.new ?? '')}`)
    return `**New system:** would add ${md(systemOf(change))}${set.length ? `, with ${set.join('; ')}` : ''}.`
  }
  const old = change.old === undefined ? '' : md(change.old)
  return change.old === change.new
    ? `${who} ${md(change.title ?? '')}, ${value} (unchanged).`
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
  const name = md(system.system)
  if (before === 'DPI') return `${name} would no longer be DPI-like`
  if (after === 'DPI') return `${name} would become DPI-like`
  return before === 'WIP' ? `${name} would no longer be in progress` : `${name} would be in progress`
}

/** The comment's Markdown for a check's result */
export function proposalComment (result: ProposalResult): string {
  const lines = [markerLine(result)]
  if (!result.applies) {
    lines.push('**This can’t be applied as it is:**', '', ...result.problems.map(problem => `- ${md(problem)}`))
  } else {
    // a new system's values are one line, with the first of them
    lines.push(...result.changes.flatMap((change, i, all) => change.type !== 'create'
      ? [changeLine(change)]
      : all.findIndex(other => other.change === change.change) === i ? [changeLine(change, all.filter(other => other.change === change.change))] : []))
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
  if (result.applies) lines.push('', '<sub>Closing this as completed commits it for the next release, and a line naming the file appears here. If none appears within a few minutes, reopen this and close it again.</sub>')
  return lines.join('\n') + '\n'
}

// --- the command line ---

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const input = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 0
  process.stdout.write(proposalComment(JSON.parse(fs.readFileSync(input, 'utf8'))))
}
