// Helpers for reading field definitions in datapackage.json, shared by the scripts.

/** The separator between values in a multi-valued cell */
export const listSeparator = ', '

/**
 * For a multi-valued field, the values it allows: the alternatives in its
 * pattern, which is `(a|b)(, (a|b))*`. Else undefined.
 */
export function listValues (field) {
  const pattern = field.constraints?.pattern
  const group = pattern?.match(/^\(((?:\\.|[^()\\])*)\)/)?.[1]
  if (group === undefined || pattern !== `(${group})(${listSeparator}(${group}))*`) return undefined
  return group.split(/(?<!\\)\|/).map(x => x.replace(/\\(.)/g, '$1'))
}
