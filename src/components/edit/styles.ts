// Tailwind classes the editor's components share (/<id>/edit/, D86), so its inputs look alike
// without adding to src/styles/global.css.

/** A text box, text area or date: white, a zinc border, and a blue ring only for focus */
export const inputClass = 'w-full min-w-0 rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-sm leading-5 text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-0 focus:outline-blue-300 disabled:bg-zinc-50 disabled:text-muted'

/** The small label above an input */
export const labelClass = 'text-ui font-medium text-strong'

/** A note after a label, like "required" */
export const noteClass = 'pl-1 font-normal text-muted'

/**
 * A choice among text values: a radio button or checkbox, hidden, with its label after it as a small rounded
 * rectangle, the height and type size of the YES/NO/NF pills beside it (EditRow), and a touch size on a phone
 * (about 34px tall). Not the site's rounded chip (global.css), which is the changelog's filter. `data-orig`
 * marks a value the data already has, so a choice shows apart a value kept (light, with a strong border),
 * added (dark) and removed (struck through)
 */
export const choiceClass = [
  'inline-block rounded-md border border-line-strong bg-white px-2 py-px text-xs narrow:px-2.5 narrow:py-1.5 narrow:text-[13px] narrow:leading-5 text-muted whitespace-nowrap cursor-pointer hover:border-zinc-400',
  // chosen now and not in the data: added, in dark
  'peer-checked:border-zinc-700 peer-checked:bg-zinc-700 peer-checked:text-white',
  // in the data and still chosen: kept, light with a strong border
  'peer-checked:data-orig:border-zinc-500 peer-checked:data-orig:bg-zinc-100 peer-checked:data-orig:text-ink',
  // in the data but unticked: removed, struck through
  'data-orig:[input:not(:checked)+&]:line-through',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-blue-300',
].join(' ')

/** A button beside the main one (.button-blue), like the copy buttons: its shape and size, white with a zinc border */
export const buttonClass = 'rounded-lg border border-line-strong bg-white px-3 py-2 text-sm leading-5 font-semibold text-strong hover:border-zinc-500 cursor-pointer'

/** A plain text button, like Undo */
export const textButtonClass = 'text-ui text-secondary ul cursor-pointer'

/**
 * The line under an input of a changed row, kept for its error, so an error shows without moving the
 * layout (D89): one line tall even when empty. An error is red, a warning, like a later date, amber.
 */
export const errorLineClass = 'min-h-4.5 text-xs leading-4.5 text-red-700 data-[level=warning]:text-amber-800'
