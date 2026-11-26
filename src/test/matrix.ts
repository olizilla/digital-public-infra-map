// The editor's test matrix (src/EditorMatrix.test.ts, src/test/ProposalDryRun.test.ts): proposals for real
// systems from the 2026-11-06 release, generated from the root datapackage.json's fields, and what the
// editor makes of each, as the page would: the value its inputs give (a text box is trimmed, form.ts
// valueOf), checkProposal and readiness (src/Proposal.ts), and the TOML and issue link it sends.
import rootPackage from '../../datapackage.json' with { type: 'json' }
import identityRows from '../../public/data/2026-11-06/2026-11-06-identity.json' with { type: 'json' }
import paymentRows from '../../public/data/2026-11-06/2026-11-06-payment.json' with { type: 'json' }
import exchangeRows from '../../public/data/2026-11-06/2026-11-06-exchange.json' with { type: 'json' }
import { derivedFields } from '../DpiLayer.ts'
import {
  checkProposal, cleanSources, editSpec, joinParts, NOT_FOUND, readiness,
  type EditSpec, type FieldEdit, type FieldSpec, type Problem, type Proposal, type RemoveEdit
} from '../Proposal.ts'

/** The day the matrix is checked on, as the editor's `today` and the check's `now` */
export const today = '2026-11-16'
export const now = new Date('2026-11-16T12:00:00Z')

const rows: Record<string, Record<string, unknown>[]> = { identity: identityRows, payment: paymentRows, exchange: exchangeRows }
const types: Record<string, string> = { identity: 'Identity', payment: 'Payment', exchange: 'Data exchange' }

/** The systems: per table, one with many values, and unnamed ones and ones with many NA */
export const systems = [
  { resource: 'identity', id: 'id-kh-01', why: 'many values' },
  { resource: 'payment', id: 'pay-gb-02', why: 'many values' },
  { resource: 'exchange', id: 'dx-ee-01', why: 'many values' },
  { resource: 'payment', id: 'pay-er-01', why: 'unnamed' },
  { resource: 'identity', id: 'id-gf-01', why: 'unnamed, all NA' },
  { resource: 'exchange', id: 'dx-to-01', why: 'many NA' }
]

/** A real system's spec, every field but the System ID, the place and the derived fields editable, as on the page */
export function specOf (resource: string, id: string): EditSpec {
  const pkg = rootPackage.resources.find(r => r.name === resource)!
  const row = rows[resource].find(row => row.system_id === id)
  if (!row) throw new Error(`no ${id} in ${resource}`)
  const editable = pkg.schema.fields.map(f => f.name).filter(name => !['system_id', 'country', ...derivedFields].includes(name))
  const name = row.name && row.name !== 'NA' ? String(row.name) : `${types[resource]} system in ${row.country}`
  return editSpec(pkg as never, row, { name, type: types[resource], country: String(row.country) }, editable)
}

/** Another system of the same table, for a removal's replacement */
export const otherSystem = (resource: string, id: string) => String(rows[resource].find(row => row.system_id !== id)!.system_id)

export const evidence = { reason: 'The operator’s 2026 annual report says so.', sources: ['https://example.org/report-2026.pdf'], as_of: '2026-11-01' }

/**
 * The value the editor's inputs give for what's typed or ticked: a text box is trimmed, an empty box over NA
 * leaves it as it was, as does the value it started with (form.ts valueOf). Undefined if that's no change.
 */
export function formValue (field: FieldSpec, typed: string, missing: string[]): string | undefined {
  if (field.control !== 'text') return typed === field.current ? undefined : typed
  const value = typed.trim()
  if ((value === '' && missing.includes(field.current)) || value === field.current.trim()) return undefined
  return value
}

/** A valid new value for a field, other than its current one */
export function validValue (field: FieldSpec, missing: string[]): string {
  const options = field.control === 'choice' ? field.values
    : field.combinations ? field.combinations
      : field.control === 'multi' ? [...field.values.filter(v => !field.alone.includes(v)), ...field.alone]
        : field.pattern ? ['https://example.org/new', 'Cross-sectoral', 'Sectoral (Health)', NOT_FOUND] : ['A new value', 'Another new value']
  const value = options.find(v => v !== field.current && !missing.includes(v) && (field.control !== 'text' || !field.pattern || new RegExp(`^(?:${field.pattern})$`, 'u').test(v)))
  if (value === undefined) throw new Error(`no valid value for ${field.id}`)
  return value
}

const isURLField = (field: FieldSpec) => field.pattern !== undefined && /https\?/.test(field.pattern)

/** Text values to try in a text box: what's typed */
export const textValues: Record<string, string> = {
  'Not Found': NOT_FOUND,
  NA: 'NA',
  empty: '',
  'whitespace only': ' \t ',
  'leading and trailing spaces': '  Padded value  ',
  '5,000 characters': 'x'.repeat(5000),
  emoji: 'Pago 💸 rápido 👍🏽',
  'RTL Arabic': 'نظام الدفع الوطني',
  'combining marks': 'Cafe\u0301 Zoe\u0308',
  'double quote': 'The "best" system',
  backslash: 'C:\\path\\to',
  tab: 'a\tb',
  '"""': 'a """ b',
  "'''": "a ''' b",
  '#': '# not a comment',
  ']': 'a ] b',
  '[[changes]]': '[[changes]]',
  NUL: 'a\u0000b',
  'U+2028': 'a\u2028b',
  backticks: '```',
  'HTML and mention': '<b>bold</b> <img src=x onerror=alert(1)> @olizilla',
  Markdown: '**x** [a](b) _y_ `z` ~~s~~ | &amp;'
}
/** Values only a draft link or a hand-made proposal can give, as a text box can't hold them */
export const rawTextValues: Record<string, string> = {
  'raw leading and trailing spaces': '  Padded value  ',
  'raw whitespace only': '   ',
  'raw newline': 'line one\nline two',
  'raw CRLF': 'line one\r\nline two'
}
export const urlValues: Record<string, string> = {
  'http://': 'http://example.org/system',
  'https://': 'https://example.org/system?x=1&y=2#z',
  'javascript:': 'javascript:alert(1)',
  'data:': 'data:text/html,x',
  'ftp://': 'ftp://x',
  'no scheme': 'example.org',
  'URL with a space': 'https://example.org/a b',
  '3,000-character URL': 'https://example.org/' + 'a'.repeat(2980)
}

export interface Case {
  area: 'value' | 'reason' | 'sources' | 'date' | 'removal' | 'multiple'
  system: string
  resource: string
  /** the field, or remove */
  field: string
  name: string
  /** what the form gives: undefined if the input is no change */
  proposal?: Proposal
  /** what the editor makes of it */
  editor: { sends: boolean, errors: Problem[], warnings: Problem[] }
  /** the expected outcome, where the rules say it: the editor sends it, or refuses it */
  expect?: 'sends' | 'refuses'
}

function judge (spec: EditSpec, proposal: Proposal) {
  const problems = checkProposal(spec, proposal, today)
  const state = readiness(spec, proposal, today)
  const errors = problems.filter(p => p.level === 'error')
  const all = state.changes.length
  const ready = state.ready.edits.length + (state.ready.remove ? 1 : 0)
  // the editor sends it when every change is ready and nothing about the whole proposal stops it
  return { sends: errors.length === 0 && ready === all && all > 0, errors, warnings: problems.filter(p => p.level === 'warning') }
}

const edit = (field: string, value: string, more: Partial<FieldEdit> = {}): FieldEdit => ({ field, value, ...evidence, ...more })

/** Every case: values for each field of each system, then evidence, dates, removals and several changes at once */
export function cases (): Case[] {
  const out: Case[] = []
  const add = (spec: EditSpec, c: Omit<Case, 'editor' | 'system' | 'resource'>) => {
    out.push({ ...c, system: spec.key, resource: spec.resource, editor: c.proposal ? judge(spec, c.proposal) : { sends: false, errors: [], warnings: [] } })
  }
  for (const { resource, id } of systems) {
    const spec = specOf(resource, id)
    for (const field of spec.fields) {
      const value = (name: string, typed: string, expect?: Case['expect'], raw = false) => {
        const v = raw ? (typed === field.current ? undefined : typed) : formValue(field, typed, spec.missing)
        add(spec, { area: 'value', field: field.id, name, proposal: v === undefined ? undefined : { edits: [edit(field.id, v)] }, expect: v === undefined ? undefined : expect })
      }
      if (field.control === 'choice') {
        for (const v of field.values) value(`allowed ${v}`, v, v === field.current ? undefined : 'sends')
        value('NA', 'NA', 'refuses')
        value('empty', '', 'refuses')
        value('not a value', 'Maybe', 'refuses')
      } else if (field.control === 'multi') {
        const parts = field.values.filter(v => !field.alone.includes(v))
        const options = field.combinations ?? [...parts, joinParts(field, parts.slice(0, 2)), joinParts(field, parts)]
        for (const v of options) value(`allowed ${v}`, v, v === field.current ? undefined : 'sends')
        for (const alone of field.alone) {
          value(`${alone} alone`, alone, alone === field.current ? undefined : 'sends')
          value(`${alone} with ${parts[0]}`, `${alone}, ${parts[0]}`, 'refuses')
          value(`${parts[0]} with ${alone}`, `${parts[0]}, ${alone}`, 'refuses')
        }
        // the codebook's order isn't the only one the pattern allows
        if (!field.combinations) value('raw parts out of order', [...parts].slice(0, 2).reverse().join(', '))
        value('NA', 'NA', 'refuses')
        value('empty', '', 'refuses')
      } else {
        const url = isURLField(field)
        for (const [name, typed] of Object.entries(textValues)) {
          // a value on one line, trimmed, is any text where the codebook has no pattern (D89)
          const expect = ['NA', 'empty', 'whitespace only', 'tab', 'NUL', 'U+2028'].includes(name) ? 'refuses'
            : name === 'Not Found' ? (field.notFound ? 'sends' : 'refuses')
              : url ? 'refuses' : field.pattern ? undefined : 'sends'
          value(name, typed, expect)
        }
        // spaces around a value are trimmed, by the rules and on reading (D90); spaces alone, or a value over several lines, aren't a value (D89)
        for (const [name, typed] of Object.entries(rawTextValues)) {
          value(name, typed, name !== 'raw leading and trailing spaces' ? 'refuses' : url ? 'refuses' : field.pattern ? undefined : 'sends', true)
        }
        if (url) for (const [name, typed] of Object.entries(urlValues)) value(name, typed, ['http://', 'https://', '3,000-character URL'].includes(name) ? 'sends' : 'refuses')
        if (field.id === 'sectoral') {
          value('Cross-sectoral', 'Cross-sectoral', 'sends')
          value('Sectoral (Health)', 'Sectoral (Health)', 'sends')
          value('Sectoral ()', 'Sectoral ()', 'refuses')
          value('Sectoral without brackets', 'Sectoral', 'refuses')
        }
      }
    }
  }

  // evidence, dates, removals and several changes, on the first three systems, one per table
  for (const { resource, id } of systems.slice(0, 3)) {
    const spec = specOf(resource, id)
    const choices = spec.fields.filter(f => f.control === 'choice')
    let n = 0
    // each on its own choice field, so they can be checked together
    const one = (area: Case['area'], name: string, more: Partial<FieldEdit>, expect?: Case['expect'], form = true) => {
      const field = choices[n++ % choices.length]
      const e = edit(field.id, validValue(field, spec.missing), more)
      // the form trims nothing in a reason, and cleans the sources (form.ts evidenceOf)
      if (form) e.sources = cleanSources(e.sources)
      add(spec, { area, field: field.id, name, proposal: { edits: [e] }, expect })
    }
    one('reason', 'empty', { reason: '' }, 'refuses')
    one('reason', 'whitespace only', { reason: ' \n\t ' }, 'refuses')
    // at most MAX_REASON characters, as a person counts them: Arabic letters and emoji count as one each (D89)
    one('reason', '500 characters', { reason: 'r'.repeat(500) }, 'sends')
    one('reason', '501 characters', { reason: 'r'.repeat(501) }, 'refuses')
    one('reason', '500 Arabic letters', { reason: 'ب'.repeat(500) }, 'sends')
    one('reason', '500 emoji with skin tones', { reason: '👍🏽'.repeat(500) }, 'sends')
    one('reason', '501 emoji', { reason: '💸'.repeat(501) }, 'refuses')
    one('reason', '500 letters with combining accents', { reason: 'e\u0301'.repeat(500) }, 'sends')
    one('reason', '10,000 characters', { reason: 'r'.repeat(10_000) }, 'refuses')
    one('reason', 'Markdown', { reason: '**x** [a](b) _y_ `z`' }, 'sends')
    one('reason', 'HTML', { reason: '<script>alert(1)</script> <img src=x onerror=alert(1)>' }, 'sends')
    one('reason', '@mention', { reason: '@olizilla please look, cc @someone' }, 'sends')
    one('reason', 'leading and trailing spaces', { reason: '  padded reason  ' }, 'sends')
    one('reason', 'several lines', { reason: 'line one\nline two' }, 'sends')
    one('reason', 'several lines with a ``` fence line', { reason: 'line one\n```\nline two' }, 'sends')
    one('reason', 'several lines with ~~~ and ````', { reason: 'line one\n~~~\n````\nline two' }, 'sends')
    one('reason', 'several lines with ### Changeset', { reason: 'line one\n### Changeset\n```toml\nline two' }, 'sends')
    one('reason', 'several lines with """', { reason: 'a\n"""\nb' }, 'sends')
    one('reason', 'several lines ending with "', { reason: 'a\nb"' }, 'sends')
    one('reason', 'CRLF', { reason: 'a\r\nb' }, 'sends')
    one('reason', 'NUL and U+2028', { reason: 'a\u0000b\u2028c' }, 'sends')
    one('reason', 'emoji, RTL and combining marks', { reason: '💸 نظام Cafe\u0301' }, 'sends')
    // sources are optional: with no public link, the reason says where it came from (D90)
    one('sources', 'none', { sources: [] }, 'sends')
    one('sources', 'a blank', { sources: ['  '] }, 'sends')
    one('sources', 'none, and the reason says where it came from', { sources: [], reason: 'Interview with a central bank official, October 2026.' }, 'sends')
    one('sources', 'a raw blank', { sources: ['  '] }, 'refuses', false)
    one('sources', 'raw spaces around a link', { sources: ['  https://example.org/x  '] }, 'sends', false)
    one('sources', 'duplicates, as the form cleans them', { sources: ['https://a.example.org/x', ' https://a.example.org/x '] }, 'sends')
    one('sources', 'raw duplicates', { sources: ['https://a.example.org/x', 'https://a.example.org/x'] }, 'refuses', false)
    one('sources', 'no scheme', { sources: ['example.org/report'] }, 'refuses')
    one('sources', 'javascript:', { sources: ['javascript:alert(1)'] }, 'refuses')
    one('sources', 'http://', { sources: ['http://example.org/x'] }, 'sends')
    one('sources', 'a space', { sources: ['https://example.org/a b'] }, 'refuses')
    one('sources', 'a description', { sources: ['Interview with a central bank official'] }, 'refuses')
    one('sources', 'a good link and a bad one', { sources: ['https://example.org/a', 'www.example.org/b'] }, 'refuses')
    one('sources', 'several', { sources: ['https://a.example.org/1', 'https://b.example.org/2', 'http://c.example.org/3'] }, 'sends')
    one('date', 'today', { as_of: today }, 'sends')
    one('date', 'tomorrow (warns)', { as_of: '2026-11-17' }, 'sends')
    one('date', '2028-02-29 (warns)', { as_of: '2028-02-29' }, 'sends')
    one('date', '2026-02-29', { as_of: '2026-02-29' }, 'refuses')
    one('date', '1999-01-01', { as_of: '1999-01-01' }, 'sends')
    one('date', 'empty', { as_of: '' }, 'refuses')
    one('date', 'not a date', { as_of: '16/11/2026' }, 'refuses')

    const remove = (name: string, more: Partial<RemoveEdit>, expect: Case['expect'], edits: FieldEdit[] = []) =>
      add(spec, { area: 'removal', field: 'remove', name, proposal: { edits, remove: { ...evidence, ...more } }, expect })
    remove('no replacement', {}, 'sends')
    remove('a valid replacement', { duplicate_of: otherSystem(resource, id) }, 'sends')
    remove('a nonexistent replacement', { duplicate_of: id.replace(/-\w\w-\d+$/, '-zz-99') }, 'sends')
    remove('a badly formed replacement', { duplicate_of: 'not an id' }, 'refuses')
    remove('another table’s System ID', { duplicate_of: resource === 'identity' ? 'pay-gb-02' : 'id-kh-01' }, 'refuses')
    remove('itself', { duplicate_of: id }, 'refuses')
    remove('no reason', { reason: '' }, 'refuses')
    remove('no source', { sources: [] }, 'sends')
    remove('plus an edit', {}, 'refuses', [edit(choices[0].id, validValue(choices[0], spec.missing))])

    const several = choices.slice(0, 3).map(f => edit(f.id, validValue(f, spec.missing), { reason: `Why ${f.id} changed.` }))
    add(spec, { area: 'multiple', field: several.map(e => e.field).join(','), name: 'three changes', proposal: { edits: several }, expect: 'sends' })
    const everything = spec.fields.map(f => edit(f.id, validValue(f, spec.missing)))
    add(spec, { area: 'multiple', field: 'every field', name: 'every field at once', proposal: { edits: everything }, expect: 'sends' })
    add(spec, { area: 'multiple', field: choices[0].id, name: 'one field twice', proposal: { edits: [several[0], { ...several[0] }] }, expect: 'refuses' })
  }
  return out
}

/**
 * Proposals written by hand, as TOML, that the form can't make, which the editor's rules and the check
 * both refuse (D89): a value that's spaces, or has a NUL or a line break; a removal that names the system
 * itself, or comes with changed values; a field changed twice; no reason, a reason over 500 characters, a
 * source twice, or one that isn't an http(s) link. Spaces around a value or a source, and no sources, are
 * fine (D90): src/ProposalCheck.test.ts.
 */
export function handWritten (spec: EditSpec): { name: string, toml: string }[] {
  const choice = spec.fields.find(f => f.control === 'choice')!
  const key = spec.key
  const evidence = 'reason = "The operator’s 2026 annual report says so."\nsources = ["https://example.org/report-2026.pdf"]\n'
  const update = (values: string, more = evidence) => `[[changes]]\ntype = "update"\nkey = "${key}"\nas_of = 2026-11-01\n${values}\n${more}`
  const remove = (more = '') => `[[changes]]\ntype = "remove"\nkey = "${key}"\n${more}as_of = 2026-11-01\n${evidence}`
  const allowed = `values.${choice.id} = ${JSON.stringify(validValue(choice, spec.missing))}`
  return [
    { name: 'a value of spaces', toml: update('values.name = "   "') },
    { name: 'a value with a NUL', toml: update('values.name = "a\\u0000b"') },
    { name: 'a value with a newline', toml: update('values.name = "line one\\nline two"') },
    { name: 'a value over several lines', toml: update('values.name = """\nline one\nline two"""') },
    { name: 'a value with U+2028', toml: update('values.name = "a\\u2028b"') },
    { name: 'a removal naming itself', toml: remove(`duplicate_of = "${key}"\n`) },
    { name: 'a removal and a changed value', toml: update(allowed) + remove() },
    { name: 'a field changed twice', toml: update(allowed) + update(allowed) },
    { name: 'no reason', toml: update(allowed, 'reason = ""\nsources = ["https://example.org/x"]\n') },
    { name: 'a reason of spaces', toml: update(allowed, 'reason = "   "\nsources = ["https://example.org/x"]\n') },
    { name: 'a 501-character reason', toml: update(allowed, `reason = "${'a'.repeat(501)}"\nsources = ["https://example.org/x"]\n`) },
    { name: 'a source twice', toml: update(allowed, 'reason = "A reason."\nsources = ["https://example.org/x", "https://example.org/x"]\n') },
    { name: 'a source with no scheme', toml: update(allowed, 'reason = "A reason."\nsources = ["example.org/report"]\n') },
    { name: 'a blank source', toml: update(allowed, 'reason = "A reason."\nsources = ["  "]\n') }
  ]
}
