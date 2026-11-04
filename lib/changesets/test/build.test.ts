import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  build, changesetTOML, CHANGESET_ID, checkItem, draftChangeset, formatReport, historyJSON, parseCSV,
  readChangeset, tableCSV, validateChangeset, writeCSV
} from '../index.ts'
import type { BuildOptions, DataPackage, ReportItem } from '../index.ts'

const here = path.dirname(new URL(import.meta.url).pathname)
const datapackage: DataPackage = JSON.parse(fs.readFileSync(path.join(here, 'datapackage.json'), 'utf8'))
const log = path.join(here, 'log')
const now = new Date('2026-03-01T00:00:00Z')

// the toy package's derived field: the row's newest as_of
const options: BuildOptions = {
  datapackage,
  log,
  now,
  snapshotAsOf: (_, row) => row.updated,
  rowGroup: (_, row) => row.place,
  derive: {
    fields: { things: ['updated'] },
    values: (_, __, context) => ({ updated: context.asOf })
  }
}

const byKey = (rows: Record<string, string>[]) => Object.fromEntries(rows.map(row => [row.thing_id, row]))
const kinds = (report: ReportItem[]) => report.map(item => `${item.kind}${item.changeset ? ` ${item.changeset}` : ''}${item.file && !item.changeset ? ` ${item.file}` : ''}`).sort()

/** A log folder in a temp dir with the toy baseline, for writing changesets into */
function tempLog () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changesets-'))
  fs.cpSync(path.join(log, 'things', '0000'), path.join(dir, 'things', '0000'), { recursive: true })
  return dir
}

describe('build', () => {
  const result = build(options)
  const things = result.tables.things
  const rows = byKey(things.rows)

  it('builds the tables that have a folder in the log', () => {
    assert.deepEqual(Object.keys(result.tables), ['things'])
  })

  it('outputs exactly the package fields, in order', () => {
    assert.deepEqual(things.fields.map(field => field.id), ['thing_id', 'place', 'name', 'colour', 'updated'])
    for (const row of things.rows) assert.deepEqual(Object.keys(row), ['thing_id', 'place', 'name', 'colour', 'updated'])
  })

  it('takes the value with the latest as_of, ties broken by changeset id', () => {
    assert.equal(rows['t-b-1'].colour, 'spotty')
  })

  it('keeps a baseline value over a back-fill older than it', () => {
    assert.equal(rows['t-a-1'].colour, 'red')
  })

  it('keeps the baseline order, puts a new row after the last of its group, and drops removed rows', () => {
    assert.deepEqual(things.rows.map(row => row.thing_id), ['t-a-1', 't-b-1', 't-a-2', 't-a-3', 't-d-1'])
  })

  it('gives a field with no value the first missing value', () => {
    assert.equal(rows['t-a-3'].colour, 'NA')
  })

  it('reads missingValues in the labelled form too', () => {
    const labelled = structuredClone(datapackage)
    labelled.resources[0].schema.missingValues = [{ value: 'NA', label: 'Not yet researched' }]
    assert.equal(byKey(build({ ...options, datapackage: labelled }).tables.things.rows)['t-a-3'].colour, 'NA')
  })

  it('derives fields from the row, with its newest as_of', () => {
    assert.equal(rows['t-a-1'].updated, '2026-01-01')
    assert.equal(rows['t-b-1'].updated, '2026-05-01')
    assert.equal(rows['t-a-3'].updated, '2026-06-01')
  })

  it('records where each cell came from', () => {
    const provenance = result.provenance.things
    assert.deepEqual(provenance['t-b-1'].colour, {
      changeset: '2026-02-03T000000Z-0003', change: 0, type: 'update', as_of: '2026-05-01', reason: 'Same day, later changeset.', sources: []
    })
    assert.deepEqual(provenance['t-a-1'].colour, {
      changeset: '0000-baseline',
      change: 0,
      type: 'snapshot',
      as_of: '2026-01-01',
      reason: 'The toy table as published.',
      sources: ['https://example.org/apple', 'https://example.org/apple-2']
    })
    assert.equal(provenance['t-d-1'].colour.change, 1)
    assert.equal(provenance['t-a-1'].updated, undefined, 'derived cells have no provenance')
  })

  it('records the author, if the changeset has one', () => {
    const baseline = build({ ...options, log: tempLog() })
    assert.equal(baseline.provenance.things['t-a-1'].name.author, undefined)
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-01', values: { name: 'Crab apple' }, reason: '' }],
      { log: dir, resource: 'things', author: 'Ada <ada@example.org>', now })
    assert.equal(build({ ...options, log: dir }).provenance.things['t-a-1'].name.author, 'Ada <ada@example.org>')
  })

  it('skips and reports what it cannot use, and says what blocks', () => {
    assert.deepEqual(kinds(result.report), [
      'derived-value 2026-02-02T000000Z-0002',
      'invalid-changeset things/2026/2026-02-08T000000Z-0008.toml',
      'invalid-toml things/2026/2026-02-07T000000Z-0007.toml',
      'missing-row 2026-02-06T000000Z-0006',
      'pending-field',
      'unknown-table ghosts/'
    ])
    const blocking = result.report.filter(item => item.blocking).map(item => item.kind).sort()
    assert.deepEqual(blocking, ['invalid-changeset', 'invalid-toml', 'missing-row'])
  })

  it('lists a pending field with the changesets that set it', () => {
    const pending = result.report.find(item => item.kind === 'pending-field')!
    assert.equal(pending.field, 'weight')
    assert.equal(pending.count, 2)
    assert.deepEqual(pending.changesets, ['2026-02-02T000000Z-0002', '2026-02-09T000000Z-0009'])
    assert.match(formatReport(result.report), /weight/)
  })

  it('writes the baseline back byte for byte when nothing changed it', () => {
    const dir = tempLog()
    const { tables } = build({ ...options, log: dir, derive: undefined })
    assert.equal(tableCSV(tables.things), fs.readFileSync(path.join(log, 'things', '0000', 'things.csv'), 'utf8'))
  })

  it('records every change to a cell, in the order that decides its value', () => {
    const colour = result.history.things['t-b-1'].colour
    assert.deepEqual(colour.map(e => [e.changeset, e.value, e.valueChanged]), [
      ['0000-baseline', 'yellow', true],
      ['2026-02-02T000000Z-0002', 'brown', true],
      ['2026-02-03T000000Z-0003', 'spotty', true]
    ])
    assert.deepEqual(colour[1].sources, ['https://example.org/banana'])
    assert.equal(colour[1].reason, 'Bananas go brown.')
    // a back-fill older than the baseline comes first, and the baseline's value is current
    assert.deepEqual(result.history.things['t-a-1'].colour.map(e => [e.changeset, e.value]), [
      ['2026-02-01T000000Z-0001', 'green'],
      ['0000-baseline', 'red']
    ])
    assert.equal(result.history.things['t-a-1'].updated, undefined, 'derived cells have no history')
    assert.equal(result.history.things['t-c-1'], undefined, 'removed rows have no history')
  })

  it('marks a change that only restates a value', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-01', values: { colour: 'red' }, reason: 'Better evidence.', sources: ['https://example.org/red'] }],
      { log: dir, resource: 'things', now })
    const colour = build({ ...options, log: dir }).history.things['t-a-1'].colour
    assert.deepEqual(colour.map(e => [e.type, e.value, e.valueChanged]), [['snapshot', 'red', true], ['update', 'red', false]])
  })

  it('writes the history as JSON with each changeset once', () => {
    const history = historyJSON(result, 'things')
    const colour = history.rows['t-b-1'].colour
    assert.equal(colour.at(-1)!.changeset, '2026-02-03T000000Z-0003')
    assert.deepEqual(colour[1], { changeset: '2026-02-02T000000Z-0002', change: 0, type: 'update', as_of: '2026-05-01', value: 'brown', valueChanged: true, sources: ['https://example.org/banana'] })
    assert.deepEqual(history.changesets['2026-02-03T000000Z-0003'], { reasons: ['Same day, later changeset.'] })
    assert.equal(history.changesets['2026-02-06T000000Z-0006'], undefined, 'no cell has its value')
  })
})

describe('checkItem (D60)', () => {
  const failure = (key: string, fields: string[]) => ({ resource: 'things', key, fields, message: 'fails' })

  it('blocks on a value a change introduced', () => {
    const result = build(options)
    const item = checkItem(result, failure('t-b-1', ['colour']), 'thing_id')
    assert.equal(item.kind, 'check')
    assert.equal(item.blocking, true)
    assert.equal(item.changeset, '2026-02-03T000000Z-0003')
  })

  it('warns, without blocking, on a value from the baseline', () => {
    const item = checkItem(build(options), failure('t-a-2', ['colour']), 'thing_id')
    assert.equal(item.kind, 'legacy')
    assert.equal(item.blocking, false)
    assert.equal(item.changeset, '0000-baseline')
  })

  it('treats a restated baseline value as legacy, and a check on several fields as introduced if any is', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-2', as_of: '2026-06-01', values: { colour: 'green', name: 'Avocado pear' }, reason: '' }],
      { log: dir, resource: 'things', now })
    const result = build({ ...options, log: dir })
    assert.equal(checkItem(result, failure('t-a-2', ['colour']), 'thing_id').kind, 'legacy')
    assert.equal(checkItem(result, failure('t-a-2', ['colour', 'name']), 'thing_id').kind, 'check')
  })

  it('counts a field with no value as introduced with its row', () => {
    const result = build(options)
    assert.equal(checkItem(result, failure('t-a-3', ['colour']), 'thing_id').kind, 'check', 'a created row')
  })
})

describe('revert', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 1, 10, 0, 0, s))
  const update = { type: 'update' as const, key: 't-a-1', as_of: '2026-06-01', values: { colour: 'blue' }, reason: '' }
  const revert = (id: string) => ({ type: 'revert' as const, changeset: id, as_of: '2026-06-02', reason: '' })

  it('drops the changes of a reverted changeset', () => {
    const dir = tempLog()
    const first = draftChangeset([update], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([revert(first.id)], { log: dir, resource: 'things', now: at(2) })
    assert.equal(byKey(build({ ...options, log: dir }).tables.things.rows)['t-a-1'].colour, 'red')
  })

  it('restores the original when a revert is reverted', () => {
    const dir = tempLog()
    const first = draftChangeset([update], { log: dir, resource: 'things', now: at(1) })
    const second = draftChangeset([revert(first.id)], { log: dir, resource: 'things', now: at(2) })
    draftChangeset([revert(second.id)], { log: dir, resource: 'things', now: at(3) })
    assert.equal(byKey(build({ ...options, log: dir }).tables.things.rows)['t-a-1'].colour, 'blue')
  })

  it('reports a revert of a changeset that is not earlier in the log', () => {
    const dir = tempLog()
    draftChangeset([revert('2026-01-01T000000Z-ffff')], { log: dir, resource: 'things', now: at(1) })
    const { report } = build({ ...options, log: dir })
    assert.deepEqual(report.map(item => [item.kind, item.blocking]), [['revert-unknown', false]])
  })
})

describe('rows that do or do not exist', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 1, 10, 0, 0, s))

  it('blocks an update after a remove', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-a-1', as_of: '2026-06-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-02', values: { colour: 'blue' }, reason: '' }], { log: dir, resource: 'things', now: at(2) })
    const { report, tables } = build({ ...options, log: dir })
    assert.deepEqual(report.map(item => [item.kind, item.blocking]), [['missing-row', true]])
    assert.equal(byKey(tables.things.rows)['t-a-1'], undefined)
  })

  it('lets a row be created and updated in one changeset', () => {
    const dir = tempLog()
    draftChangeset([
      { type: 'create', key: 't-e-1', as_of: '2026-06-01', values: { place: 'E' }, reason: '' },
      { type: 'update', key: 't-e-1', as_of: '2026-06-01', values: { name: 'Elderberry' }, reason: '' }
    ], { log: dir, resource: 'things', now: at(1) })
    const { report, tables } = build({ ...options, log: dir })
    assert.deepEqual(report, [])
    assert.equal(byKey(tables.things.rows)['t-e-1'].name, 'Elderberry')
  })

  it('puts a new row in the place of a removed row in its group', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-c-1', as_of: '2026-06-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([{ type: 'create', key: 't-x-1', as_of: '2026-06-01', values: { place: 'X' }, reason: '' }], { log: dir, resource: 'things', now: at(2) })
    draftChangeset([{ type: 'create', key: 't-c-2', as_of: '2026-06-01', values: { place: 'C' }, reason: '' }], { log: dir, resource: 'things', now: at(3) })
    const { tables } = build({ ...options, log: dir })
    assert.deepEqual(tables.things.rows.map(row => row.thing_id), ['t-a-1', 't-b-1', 't-a-2', 't-c-2', 't-x-1'])
  })

  it('reports a remove older than the row\'s snapshot, which has no effect', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-a-2', as_of: '2026-02-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    const { report, tables } = build({ ...options, log: dir })
    assert.deepEqual(report.map(item => item.kind), ['no-effect'])
    assert.ok(byKey(tables.things.rows)['t-a-2'])
  })
})

describe('changesets', () => {
  it('reads bare TOML dates as YYYY-MM-DD', () => {
    const data = readChangeset('[[changes]]\ntype = "update"\nkey = "k"\nas_of = 2026-09-17\nvalues.x = "1"\nreason = ""\n') as { changes: { as_of: string }[] }
    assert.equal(data.changes[0].as_of, '2026-09-17')
    assert.deepEqual(validateChangeset(data), [])
  })

  it('checks the author format', () => {
    const changes = [{ type: 'remove', key: 'k', as_of: '2026-01-01', reason: '' }]
    assert.deepEqual(validateChangeset({ author: 'Ada Lovelace <did:example:123>', changes }), [])
    assert.notDeepEqual(validateChangeset({ author: 'ada@example.org', changes }), [])
  })

  it('drafts a changeset with a valid, unused id, that reads back as the same data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changesets-'))
    const now = new Date('2026-11-02T14:22:05.123Z')
    const changes = [{
      type: 'update' as const,
      key: 't-a-1',
      as_of: '2026-11-01',
      values: { colour: 'say "red"\\', name: 'two\nlines' },
      reason: 'Line one.\nLine two.',
      sources: ['https://example.org/a']
    }]
    const a = draftChangeset(changes, { log: dir, resource: 'things', summary: 'Why', now })
    const b = draftChangeset(changes, { log: dir, resource: 'things', now })
    assert.match(a.id, CHANGESET_ID)
    assert.ok(a.id.startsWith('2026-11-02T142205Z-'))
    assert.notEqual(a.id, b.id)
    assert.equal(a.path, path.join(dir, 'things', '2026', `${a.id}.toml`))
    assert.deepEqual(readChangeset(fs.readFileSync(a.path, 'utf8')), { summary: 'Why', changes })
  })

  it('refuses to draft a changeset that does not match the schema', () => {
    assert.throws(() => changesetTOML({ changes: [{ type: 'update', key: 'k', as_of: '2026-01-01', values: {} } as never] }))
  })
})

describe('csv', () => {
  it('round-trips quotes, commas and new lines', () => {
    const rows = [['a', 'b,c', 'say "hi"'], ['line\none', '', ' x ']]
    assert.deepEqual(parseCSV(writeCSV(rows)), rows)
    assert.equal(writeCSV(rows), 'a,"b,c","say ""hi"""\n"line\none",, x \n')
  })

  it('can end rows with \\r\\n and leave the last one open, like a Google Sheets export', () => {
    const rows = [['a', 'b'], ['line\none', 'c']]
    const text = writeCSV(rows, { eol: '\r\n', finalEol: false })
    assert.equal(text, 'a,b\r\n"line\none",c')
    assert.deepEqual(parseCSV(text), rows)
  })
})
