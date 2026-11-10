// Helpers for reading field definitions in datapackage.json, shared by the scripts.

/** The separator between values in a multi-valued cell */
export const listSeparator = ', '

/** A regex alternative that is plain text, like `Not Found`: no unescaped special characters */
const literal = /^(?:\\.|[^\\|()[\]{}*+?.^$])+$/

/** The alternatives in a regex like `a|b` */
const split = text => text.split(/(?<!\\)\|/)
const unescape = text => text.replace(/\\(.)/g, '$1')

/**
 * For a multi-valued field, the values it allows: the alternatives in its
 * pattern, which is `(a|b)(, (a|b))*`, then any that must be the whole cell,
 * like `Not Found` in `(a|b)(, (a|b))*|Not Found`. Else undefined.
 */
export function listValues (field) {
  const pattern = field.constraints?.pattern
  const group = pattern?.match(/^\(((?:\\.|[^()\\])*)\)/)?.[1]
  if (group === undefined) return undefined
  const list = `(${group})(${listSeparator}(${group}))*`
  if (!pattern.startsWith(list)) return undefined
  const rest = pattern.slice(list.length)
  const whole = rest === '' ? [] : rest.startsWith('|') ? split(rest.slice(1)) : undefined
  if (!whole?.every(value => literal.test(value))) return undefined
  return [...split(group), ...whole].map(unescape)
}

/**
 * The schema's `missingValues` as text, or undefined if it has none. Data
 * Package v2 allows each as a string, or as `{ value, label }` with what it means.
 */
export const missingValueStrings = schema => schema.missingValues?.map(missing => typeof missing === 'string' ? missing : missing.value)
