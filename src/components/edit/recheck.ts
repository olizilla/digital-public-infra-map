// Recheck mode (D94), the editor's page-level way to say "still true" (D92): off, the edit page shows no confirm control at all;
// on, each row that can be confirmed has a "Still true" checkbox in the place Undo uses. The rules are here, apart from the page,
// so they can be tried without a browser (src/Recheck.test.ts); EditRow.astro draws the controls and form.ts keeps them in step.
//
// The mode is the page's, in the address as `?recheck` (`/<id>/edit/?recheck`), which the page keeps with history.replaceState when
// the mode is switched, so a link to the page in the mode is the address bar. A draft link (#draft=) doesn't carry it: it opens
// in the mode if the draft holds a confirmation, which is what it is for. Leaving the mode never drops one: a confirmed row keeps
// its checkbox, ticked, for as long as it's confirmed, so it can be unticked, and only the unconfirmed rows lose theirs.
import { allowedValue, hasControlCharacters, type FieldSpec, type Proposal } from '../../Proposal.ts'

/** The query parameter that opens a page in recheck mode */
export const RECHECK_PARAM = 'recheck'

/**
 * Whether a field's value can be restated as still true, as the check reads it (D92): on an existing system, a value that's set (not NA
 * or empty), on one line, and one the codebook allows (Not Found too). Not on a new system's form, which has nothing to confirm.
 */
export function canConfirm (field: FieldSpec, isNew = false): boolean {
  const missing = field.current.trim() === '' || field.current === 'NA'
  return !isNew && !missing && !field.multiline && !hasControlCharacters(field.current) && allowedValue(field, field.current, ['NA'])
}

/** Whether a page's query string, `location.search`, asks for recheck mode. `?recheck=0` and `?recheck=false` don't. */
export function recheckInSearch (search: string): boolean {
  const value = new URLSearchParams(search).get(RECHECK_PARAM)
  return value !== null && !['0', 'false', 'off', 'no'].includes(value.toLowerCase())
}

/** A query string with the mode on or off, as `location.search` has it (a leading `?`, or empty), and the other parameters as they were */
export function searchWithRecheck (search: string, on: boolean): string {
  const rest = new URLSearchParams(search)
  rest.delete(RECHECK_PARAM)
  const text = rest.toString()
  return on ? `?${text ? `${text}&` : ''}${RECHECK_PARAM}` : text ? `?${text}` : ''
}

/** Whether a draft has a confirmation in it, so that opening it should open the page in recheck mode */
export const hasConfirmations = (proposal: Proposal): boolean => proposal.edits.some(edit => edit.confirmed === true)

/** What a row shows in the place Undo has: the Still true checkbox, Undo, or nothing */
export type Slot = 'confirm' | 'undo' | 'none'

/**
 * What a row shows in that place. A confirmed row always shows its checkbox, ticked, in either mode, so it can be unticked; an
 * edited row shows Undo; an unchanged row that can be confirmed shows an unticked checkbox, in recheck mode only. The rest, the
 * rows that can't be confirmed and the unchanged ones outside the mode, show nothing.
 */
export function slotOf ({ canConfirm, recheck, changed, confirming }: { canConfirm: boolean, recheck: boolean, changed: boolean, confirming: boolean }): Slot {
  if (confirming) return canConfirm ? 'confirm' : 'undo'
  if (changed) return 'undo'
  return recheck && canConfirm ? 'confirm' : 'none'
}
