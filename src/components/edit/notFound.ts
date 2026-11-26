// Not Found on a text row (D95), the part of the row's behaviour that needs no browser, so it can be tried without one
// (src/NotFound.test.ts). A text row's value is Not Found while its button is on, and otherwise what's in the box; the box is never
// disabled. Typing means a value; emptying the box of a row whose value is Not Found means Not Found again; and otherwise Not Found
// is only ever set by clicking the button (form.ts).
import { NOT_FOUND } from '../../Proposal.ts'

/**
 * Whether a text row's Not Found button is on after the person changes the box (typing, deleting, pasting). A value typed turns it
 * off. An empty box turns it on, back to the row as it was loaded, only on a row whose current value is Not Found; on any other row,
 * deleting the text leaves an empty value (which the check asks to be a value or Not Found), and the button stays as it was.
 */
export function notFoundAfterTyping ({ current, text, on }: { current: string, text: string, on: boolean }): boolean {
  if (text.trim() !== '') return false
  return current === NOT_FOUND ? true : on
}
