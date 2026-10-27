// Report where the codebook (src/codebook.json) and the data's columns
// (the resources' schemas in datapackage.json) disagree, for each dataset.
// A field is matched to a codebook variable by its `title`. The headers in the
// latest snapshot are the ground truth, so this is a to-do list for the codebook.
// Prints markdown, with each difference in a diff block, codebook first.
// It's a report, not a check: it always exits 0.
//
// usage: npm run codebook:check

import fs from 'node:fs'
import { listValues } from './fields.mjs'

const root = new URL('../', import.meta.url)
const readJSON = path => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'))

// resource name -> the dataset's key in codebook.json
const datasets = { identity: 'id', payment: 'pay', exchange: 'data' }
const datapackage = readJSON('datapackage.json')
const codebook = readJSON('src/codebook.json')

/** The codebook's "Range/ Categories" as a list, without NA, which the schemas treat as missing. */
function categories (text) {
  return text.split(/\n|,\s*/).map(x => x.trim()).filter(x => x !== '' && x !== 'NA')
}

/**
 * The values a field allows: its `enum`, or for a multi-valued field, the
 * alternatives in its pattern, which is `(a|b)(, (a|b))*`. Else undefined.
 */
function allowedValues (field) {
  const allowed = field.constraints?.enum
  return allowed ? allowed.map(String) : listValues(field)
}

/** `s` with spaces at the ends or doubled, tabs, non-breaking and other odd spaces made visible */
function visible (s) {
  return s
    .replace(/^ +| +$| {2,}/g, spaces => '␠'.repeat(spaces.length))
    .replace(/\t/g, '⇥')
    .replace(/\u00a0/g, '⍽')
    .replace(/[\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g, c => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`)
}

function distance (a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}

// Each step hides one kind of difference. A step that brings the strings closer names a kind they have.
const steps = [
  ['trailing space', s => s.trimEnd()],
  ['leading space', s => s.trimStart()],
  ['tab', s => s.replace(/\t/g, ' ')],
  ['non-breaking space', s => s.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')],
  ['invisible character', s => s.replace(/[\u200b-\u200d\u2028\u2029\ufeff]/g, '')],
  ['doubled space', s => s.replace(/ {2,}/g, ' ')],
  ['curly quotes', s => s.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"')],
  ['case', s => s.toLowerCase()],
  ['punctuation', s => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()]
]

/** The kinds of difference between `a` and `b`, like "trailing space, case" */
function kinds (a, b) {
  const found = []
  for (const [kind, step] of steps) {
    if (a === b) break
    const [x, y] = [step(a), step(b)]
    if (distance(x, y) < distance(a, b)) found.push(kind)
    a = x
    b = y
  }
  if (a === b) return found.join(', ')
  // when the text is different anyway, the smaller differences are noise
  return distance(a, b) <= 2 ? [...found, 'spelling'].join(', ') : 'different text'
}

/** `s` with all the kinds of difference hidden */
const normalise = s => steps.reduce((s, [, step]) => step(s), s)

/** A diff block of the codebook's values, then the others */
function diff (codebookValues, others, otherLabel) {
  const width = Math.max('codebook'.length, otherLabel.length) + 2
  return [
    '```diff',
    ...codebookValues.map(value => `- ${'codebook:'.padEnd(width)}${visible(value)}`),
    ...others.map(value => `+ ${`${otherLabel}:`.padEnd(width)}${visible(value)}`),
    '```'
  ].join('\n')
}

/**
 * Pair each of `as` with the closest of `bs`, if they're close enough to be
 * the same thing written differently. Returns [a, b] pairs, with undefined for no match.
 */
function pair (as, bs) {
  const left = [...bs]
  const pairs = as.map(a => {
    const scored = left
      .map(b => ({ b, d: distance(normalise(a), normalise(b)) }))
      .filter(({ b, d }) => d <= Math.max(2, Math.floor(Math.min(a.length, b.length) / 4)))
      .sort((x, y) => x.d - y.d)
    const b = scored[0]?.b
    if (b !== undefined) left.splice(left.indexOf(b), 1)
    return [a, b]
  })
  return [...pairs, ...left.map(b => [undefined, b])]
}

const q = JSON.stringify
const out = []
const section = (title, items) => {
  out.push(`### ${title}\n`)
  out.push(items.length ? items.join('\n\n') : '(none)')
  out.push('')
}
/** One item: a heading line with the kind of difference, then a diff block */
const item = (heading, codebookValue, other, otherLabel) => {
  const kind = codebookValue === undefined ? 'not in the codebook'
    : other === undefined ? `not in the ${otherLabel}`
      : kinds(codebookValue, other)
  return `${heading} (${kind})\n${diff([codebookValue].filter(x => x !== undefined), [other].filter(x => x !== undefined), otherLabel)}`
}

out.push('Legend: ␠ space at the end or doubled, ⇥ tab, ⍽ non-breaking space, <U+…> other invisible character.')

for (const [dataset, dpiType] of Object.entries(datasets)) {
  const resource = datapackage.resources.find(resource => resource.name === dataset)
  if (!resource) throw new Error(`No datapackage.json resource "${dataset}"`)
  const { fields } = resource.schema
  const variables = codebook[dpiType]
  const names = new Set(variables.map(variable => variable.name))
  const covered = fields.filter(field => names.has(field.title))
  const uncovered = fields.filter(field => !names.has(field.title))

  out.push(`\n## ${dataset}\n\ndatapackage.json resource "${dataset}", codebook tab "${dpiType}"\n`)

  section('a) Headers that differ from the codebook variable name', covered
    .filter(field => field.name !== field.title)
    .map(field => item(`\`${field.id}\``, field.title, field.name, 'data')))

  // a title that's not a variable is either a column the codebook doesn't cover,
  // or a variable that's been renamed, so pair them up where they're close
  const titles = new Set(fields.map(field => field.title))
  const unused = variables.map(variable => variable.name).filter(name => !titles.has(name))
  section('b) Field titles that aren\'t a codebook variable, and codebook variables with no field', pair(unused, uncovered.map(field => field.title))
    .map(([name, title]) => {
      const field = fields.find(field => field.title === title)
      return item(field ? `\`${field.id}\`` : 'codebook variable', name, title, 'title')
    }))

  const differences = []
  for (const field of covered) {
    const variable = variables.find(variable => variable.name === field.title)
    const inCodebook = categories(variable.categories)
    const allowed = allowedValues(field)
    if (!allowed) {
      if (inCodebook.length) {
        const rule = field.constraints?.pattern ? `a pattern, ${q(field.constraints.pattern)}` : 'no allowed values'
        differences.push(`\`${field.id}\`: codebook lists ${inCodebook.map(q).join(', ')}, schema has ${rule}`)
      }
      continue
    }
    const codebookOnly = inCodebook.filter(x => !allowed.includes(x))
    const schemaOnly = allowed.filter(x => !inCodebook.includes(x))
    const pairs = pair(codebookOnly, schemaOnly)
    for (const [a, b] of pairs.filter(([a, b]) => a !== undefined && b !== undefined)) {
      differences.push(item(`\`${field.id}\``, a, b, 'schema'))
    }
    // the values with no close match go together, as they may be the same values split differently
    const unpaired = pairs.filter(([a, b]) => a === undefined || b === undefined)
    if (unpaired.length) {
      const a = unpaired.map(([a]) => a).filter(x => x !== undefined)
      const b = unpaired.map(([, b]) => b).filter(x => x !== undefined)
      const kind = !a.length ? 'not in the codebook' : !b.length ? 'not in the schema' : 'different values'
      differences.push(`\`${field.id}\` (${kind})\n${diff(a, b, 'schema')}`)
    }
  }
  section('c) Codebook categories that differ from the schema\'s allowed values (NA left out)', differences)
}

console.log(out.join('\n'))
