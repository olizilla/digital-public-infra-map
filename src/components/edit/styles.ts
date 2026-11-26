// Tailwind classes the editor's components share (/<id>/edit/, D86), so its inputs look alike
// without adding to src/styles/global.css.

/** A text box, text area or date: white, a zinc border, and a blue ring only for focus */
export const inputClass = 'w-full min-w-0 rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-sm leading-5 text-ink placeholder:text-faint focus:outline-2 focus:outline-offset-0 focus:outline-blue-300 disabled:bg-zinc-50 disabled:text-muted'

/** The small label above an input */
export const labelClass = 'text-ui font-medium text-strong'

/** A note after a label, like "required" */
export const noteClass = 'pl-1 font-normal text-muted'

/** What a choice shows for chosen, kept and removed (the options of a field with a few text values) */
const choiceStates = [
  // chosen now and not in the data: added, in dark
  'peer-checked:border-zinc-700 peer-checked:bg-zinc-700 peer-checked:text-white',
  // in the data and still chosen: kept, light with a strong border
  'peer-checked:data-orig:border-zinc-500 peer-checked:data-orig:bg-zinc-100 peer-checked:data-orig:text-ink',
  // in the data but unticked: removed, struck through
  'data-orig:[input:not(:checked)+&]:line-through',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-blue-300',
]

/**
 * A choice among text values: a radio button or checkbox, hidden, with its label after it as a small rounded
 * rectangle, the height and type size of the YES/NO/NF pills beside it (EditRow), and a touch size on a phone
 * (about 34px tall). Not the site's rounded chip (global.css), which is the changelog's filter. `data-orig`
 * marks a value the data already has, so a choice shows apart a value kept (light, with a strong border),
 * added (dark) and removed (struck through)
 */
export const choiceClass = [
  'inline-block rounded-md border border-line-strong bg-white px-2 py-px text-xs narrow:px-2.5 narrow:py-1.5 narrow:text-[13px] narrow:leading-5 text-muted whitespace-nowrap cursor-pointer hover:border-zinc-400',
  ...choiceStates,
].join(' ')

/** The light red a Not Found pill takes when it's chosen (NF in a yes/no row, EditRow, and a text row's button, boxChoiceClass), so they match exactly */
export const notFoundOn = 'peer-checked:border-nf-line peer-checked:bg-nf'

/**
 * Not Found on a text row (D95): a button beside the text box, as tall as the box (34px, `min-h-8.5`: a 20px line, 6px of padding and a
 * border, as inputClass has), and centred in that height, rather than the options' small size. It's a pill's two states and no more,
 * as the YES/NO/NF pills have: on (the value is Not Found), the light red of the NF pill; off, white and grey, whether or not the row's
 * value was Not Found when the page loaded (a pill shows a deselected current value no differently either)
 */
export const boxChoiceClass = [
  'flex min-h-8.5 items-center rounded-md border border-line-strong bg-white px-2.5 text-xs narrow:text-[13px] leading-5 text-muted whitespace-nowrap cursor-pointer hover:border-zinc-400',
  'peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-blue-300',
  notFoundOn,
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

/**
 * One of the two modes of the edit page, Edit and Recheck (D94), a segmented control of two radio buttons (hidden, `peer`) with
 * their words as small segments: quiet, the chosen one white with ink text, the other muted. It's not the values' choiceClass,
 * which is dark when chosen and could be mistaken for a value
 */
export const modeClass = [
  'inline-block rounded px-2.5 py-px text-ui font-medium text-muted whitespace-nowrap cursor-pointer hover:text-ink narrow:px-3 narrow:py-1',
  'peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-sm',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-blue-300',
].join(' ')
