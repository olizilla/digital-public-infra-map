import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  build, changesetTOML, CHANGESET_ID, checkItem, datedBy, describeItem, draftChangeset, formatReport, historyJSON, isCalendarDate, laterThanExpected, parseCSV,
  readChangeset, readFolders, releaseFolders, tableCSV, validateChangeset, withFiles, writeCSV
} from '../index.ts'
import type { Baseline, BuildOptions, DataPackage, ReportItem } from '../index.ts'

const here = path.dirname(new URL(import.meta.url).pathname)
const readJSON = (file: string) => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'))
const datapackage: DataPackage = readJSON('datapackage.json')
const log = path.join(here, 'log')
// the toy log's ids and release folder come no earlier than the as_of in them, which reading checks (S2)
const now = new Date('2026-10-01T00:00:00Z')

// the previous release
const baseline: Baseline = {
  id: '2026-01-31',
  reason: 'The toy table as published.',
  tables: { things: readJSON('baseline/things.json') },
  sources: readJSON('baseline/sources.json')
}

// the toy package's derived field: the row's newest as_of
const options: Omit<BuildOptions, 'layers'> = {
  datapackage,
  baseline,
  baselineAsOf: (_, row) => row.updated,
  rowGroup: (_, row) => row.place,
  derive: {
    fields: { things: ['updated'] },
    values: (_, __, context) => ({ updated: context.asOf })
  }
}

/** Build from a log's release folders and next/, as one set */
function buildLog (dir: string, more: Partial<BuildOptions> = {}) {
  const report: ReportItem[] = []
  const layer = readFolders(dir, [...releaseFolders(dir), 'next'], datapackage, report, { now })
  return build({ ...options, layers: [layer], report, ...more })
}

const byKey = (rows: Record<string, string>[]) => Object.fromEntries(rows.map(row => [row.thing_id, row]))
const kinds = (report: ReportItem[]) => report.map(item => `${item.kind}${item.changeset ? ` ${item.changeset}` : ''}${item.file && !item.changeset ? ` ${item.file}` : ''}`).sort()

/** An empty log folder in a temp dir, for writing changesets into */
const tempLog = () => fs.mkdtempSync(path.join(os.tmpdir(), 'changesets-'))

describe('build', () => {
  const result = buildLog(log)
  const things = result.tables.things
  const rows = byKey(things.rows)

  it('builds the tables in the baseline or the log', () => {
    assert.deepEqual(Object.keys(result.tables), ['things'])
  })

  it('outputs exactly the package fields, in order', () => {
    assert.deepEqual(things.fields.map(field => field.id), ['thing_id', 'place', 'name', 'colour', 'updated'])
    for (const row of things.rows) assert.deepEqual(Object.keys(row), ['thing_id', 'place', 'name', 'colour', 'updated'])
  })

  it('takes the value with the latest as_of, ties broken by changeset id', () => {
    assert.equal(rows['t-b-1'].colour, 'spotty')
  })

  it('replaces a baseline value with a change older than it, and reports the change (D46)', () => {
    assert.equal(rows['t-a-1'].colour, 'green')
    const older = result.report.filter(item => item.kind === 'older-change')
    assert.deepEqual(older.map(item => [item.changeset, item.key, item.blocking]), [['2026-07-01T000000Z-0001', 't-a-1', false]])
  })

  it('lets a change in a later set replace a newer one in an earlier set', () => {
    const dir = tempLog()
    const first = draftChangeset([{ type: 'update', key: 't-a-2', as_of: '2026-09-01', values: { colour: 'black' }, reason: '' }], { log: dir, resource: 'things', folder: '2026-09-15', now: new Date('2026-09-10T00:00:00Z') })
    draftChangeset([{ type: 'update', key: 't-a-2', as_of: '2026-08-01', values: { colour: 'brown' }, reason: '' }], { log: dir, resource: 'things', now })
    const report: ReportItem[] = []
    const layers = [['2026-09-15'], ['next']].map(folders => readFolders(dir, folders, datapackage, report, { now }))
    const built = build({ ...options, layers })
    assert.equal(byKey(built.tables.things.rows)['t-a-2'].colour, 'brown')
    assert.deepEqual(built.history.things['t-a-2'].colour.map(e => e.value), ['green', 'black', 'brown'])
    assert.equal(built.changesets.things[0].id, first.id)
    assert.equal(built.changesets.things[0].folder, '2026-09-15')
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
    assert.equal(byKey(buildLog(log, { datapackage: labelled }).tables.things.rows)['t-a-3'].colour, 'NA')
  })

  it('derives fields from the row, with its newest as_of', () => {
    assert.equal(rows['t-a-1'].updated, '2026-01-01')
    assert.equal(rows['t-b-1'].updated, '2026-05-01')
    assert.equal(rows['t-a-3'].updated, '2026-06-01')
  })

  it('records where each cell came from', () => {
    const provenance = result.provenance.things
    assert.deepEqual(provenance['t-b-1'].colour, {
      changeset: '2026-07-03T000000Z-0003', change: 0, type: 'update', as_of: '2026-05-01', reason: 'Same day, later changeset.', sources: []
    })
    assert.deepEqual(provenance['t-a-2'].colour, {
      changeset: '2026-01-31',
      change: 0,
      type: 'snapshot',
      as_of: '2026-03-01',
      reason: 'The toy table as published.',
      sources: ['https://example.org/avocado', 'https://example.org/avocado-2']
    })
    assert.equal(provenance['t-d-1'].colour.change, 1)
    assert.equal(provenance['t-a-1'].updated, undefined, 'derived cells have no provenance')
  })

  it('records the author, if the changeset has one', () => {
    assert.equal(buildLog(tempLog()).provenance.things['t-a-1'].name.author, undefined)
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-01', values: { name: 'Crab apple' }, reason: '' }],
      { log: dir, resource: 'things', author: 'Ada <ada@example.org>', now })
    assert.equal(buildLog(dir).provenance.things['t-a-1'].name.author, 'Ada <ada@example.org>')
  })

  it('skips and reports what it cannot use, and says what blocks', () => {
    assert.deepEqual(kinds(result.report), [
      'derived-value 2026-07-02T000000Z-0002',
      'invalid-changeset 2026-07-31/things/2026-07-08T000000Z-0008.toml',
      'invalid-toml 2026-07-31/things/2026-07-07T000000Z-0007.toml',
      'missing-row 2026-07-06T000000Z-0006',
      'older-change 2026-07-01T000000Z-0001',
      'unknown-field',
      'unknown-table 2026-07-31/ghosts/'
    ])
    const blocking = result.report.filter(item => item.blocking).map(item => item.kind).sort()
    assert.deepEqual(blocking, ['invalid-changeset', 'invalid-toml', 'missing-row'])
  })

  it('lists an unknown field with the changesets that set it', () => {
    const unknown = result.report.find(item => item.kind === 'unknown-field')!
    assert.equal(unknown.field, 'weight')
    assert.equal(unknown.count, 2)
    assert.deepEqual(unknown.changesets, ['2026-07-02T000000Z-0002', '2026-07-09T000000Z-0009'])
    assert.match(formatReport(result.report), /weight/)
  })

  it('reports a field an earlier release had as legacy, with the release', () => {
    const { report } = buildLog(log, { earlierFields: { things: { weight: '2025-06-30' } } })
    const legacy = report.find(item => item.kind === 'legacy-field')!
    assert.deepEqual([legacy.field, legacy.release, legacy.blocking], ['weight', '2025-06-30', false])
    assert.equal(report.some(item => item.kind === 'unknown-field'), false)
  })

  it('writes the baseline back as it was when nothing changed it', () => {
    const { tables } = buildLog(tempLog(), { derive: undefined })
    assert.equal(tableCSV(tables.things), 'Thing ID,Place,Name,Colour,Updated\nt-a-1,A,Apple,red,2026-01-01\nt-b-1,B,Banana,yellow,2026-01-01\nt-a-2,A,Avocado,green,2026-03-01\nt-c-1,C,Cherry,"dark, red",2026-02-01\n')
  })

  it('records every change to a cell, in the order that decides its value', () => {
    const colour = result.history.things['t-b-1'].colour
    assert.deepEqual(colour.map(e => [e.changeset, e.value, e.valueChanged]), [
      ['2026-01-31', 'yellow', true],
      ['2026-07-02T000000Z-0002', 'brown', true],
      ['2026-07-03T000000Z-0003', 'spotty', true]
    ])
    assert.deepEqual(colour[1].sources, ['https://example.org/banana'])
    assert.equal(colour[1].reason, 'Bananas go brown.')
    // a change older than the baseline still comes after it, and its value is current
    assert.deepEqual(result.history.things['t-a-1'].colour.map(e => [e.changeset, e.value]), [
      ['2026-01-31', 'red'],
      ['2026-07-01T000000Z-0001', 'green']
    ])
    assert.equal(result.history.things['t-a-1'].updated, undefined, 'derived cells have no history')
    assert.equal(result.history.things['t-c-1'], undefined, 'removed rows have no history')
  })

  it('marks a change that only restates a value', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-01', values: { colour: 'red' }, reason: 'Better evidence.', sources: ['https://example.org/red'] }],
      { log: dir, resource: 'things', now })
    const colour = buildLog(dir).history.things['t-a-1'].colour
    assert.deepEqual(colour.map(e => [e.type, e.value, e.valueChanged]), [['snapshot', 'red', true], ['update', 'red', false]])
  })

  it('writes the history as JSON with each changeset once', () => {
    const history = historyJSON(result, 'things')
    const colour = history.rows['t-b-1'].colour
    assert.equal(colour.at(-1)!.changeset, '2026-07-03T000000Z-0003')
    assert.deepEqual(colour[1], { changeset: '2026-07-02T000000Z-0002', change: 0, type: 'update', as_of: '2026-05-01', value: 'brown', valueChanged: true, sources: ['https://example.org/banana'] })
    assert.deepEqual(history.changesets['2026-07-03T000000Z-0003'], { reasons: ['Same day, later changeset.'] })
    assert.deepEqual(history.changesets['2026-01-31'], { reasons: ['The toy table as published.'] })
    assert.equal(history.changesets['2026-07-06T000000Z-0006'], undefined, 'no cell has its value')
  })
})

describe('checkItem (D60)', () => {
  const failure = (key: string, fields: string[]) => ({ resource: 'things', key, fields, message: 'fails' })

  it('blocks on a value a change introduced', () => {
    const result = buildLog(log)
    const item = checkItem(result, failure('t-b-1', ['colour']), 'thing_id')
    assert.equal(item.kind, 'check')
    assert.equal(item.blocking, true)
    assert.equal(item.changeset, '2026-07-03T000000Z-0003')
  })

  it('warns, without blocking, on a value from the baseline', () => {
    const item = checkItem(buildLog(log), failure('t-a-2', ['colour']), 'thing_id')
    assert.equal(item.kind, 'legacy')
    assert.equal(item.blocking, false)
    assert.equal(item.changeset, '2026-01-31')
  })

  it('treats a restated baseline value as legacy, and a check on several fields as introduced if any is', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'update', key: 't-a-2', as_of: '2026-06-01', values: { colour: 'green', name: 'Avocado pear' }, reason: '' }],
      { log: dir, resource: 'things', now })
    const result = buildLog(dir)
    assert.equal(checkItem(result, failure('t-a-2', ['colour']), 'thing_id').kind, 'legacy')
    assert.equal(checkItem(result, failure('t-a-2', ['colour', 'name']), 'thing_id').kind, 'check')
  })

  it('blames a failing derived date on the change with the newest as_of, not on the row (S2)', () => {
    const dir = tempLog()
    const { id } = draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-01', values: { colour: 'red' }, reason: 'Restated.' }],
      { log: dir, resource: 'things', now })
    const result = buildLog(dir)
    const derivedFrom = datedBy(result.provenance.things['t-a-1'])!
    assert.deepEqual([derivedFrom.changeset, derivedFrom.as_of], [id, '2026-06-01'])
    const item = checkItem(result, { ...failure('t-a-1', ['updated']), derivedFrom }, 'thing_id')
    assert.deepEqual([item.kind, item.blocking, item.changeset, item.change], ['check', true, id, 0])
    // without it, the derived field falls back to the row's introducer, the baseline
    assert.equal(checkItem(result, failure('t-a-1', ['updated']), 'thing_id').kind, 'legacy')
    // a row only the baseline dates stays legacy
    const baselineOnly = checkItem(result, { ...failure('t-a-2', ['updated']), derivedFrom: datedBy(result.provenance.things['t-a-2']) }, 'thing_id')
    assert.deepEqual([baselineOnly.kind, baselineOnly.changeset], ['legacy', '2026-01-31'])
  })

  it('counts a field with no value as introduced with its row', () => {
    const result = buildLog(log)
    assert.equal(checkItem(result, failure('t-a-3', ['colour']), 'thing_id').kind, 'check', 'a created row')
  })
})

describe('revert', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 6, 10, 0, 0, s))
  const update = { type: 'update' as const, key: 't-a-1', as_of: '2026-06-01', values: { colour: 'blue' }, reason: '' }
  const revert = (id: string) => ({ type: 'revert' as const, changeset: id, as_of: '2026-06-02', reason: '' })

  it('drops the changes of a reverted changeset', () => {
    const dir = tempLog()
    const first = draftChangeset([update], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([revert(first.id)], { log: dir, resource: 'things', now: at(2) })
    assert.equal(byKey(buildLog(dir).tables.things.rows)['t-a-1'].colour, 'red')
  })

  it('restores the original when a revert is reverted', () => {
    const dir = tempLog()
    const first = draftChangeset([update], { log: dir, resource: 'things', now: at(1) })
    const second = draftChangeset([revert(first.id)], { log: dir, resource: 'things', now: at(2) })
    draftChangeset([revert(second.id)], { log: dir, resource: 'things', now: at(3) })
    assert.equal(byKey(buildLog(dir).tables.things.rows)['t-a-1'].colour, 'blue')
  })

  it('reports a revert of a changeset that is not earlier in the log', () => {
    const dir = tempLog()
    draftChangeset([revert('2026-01-01T000000Z-ffff')], { log: dir, resource: 'things', now: at(1) })
    const { report } = buildLog(dir)
    assert.deepEqual(report.map(item => [item.kind, item.blocking]), [['revert-unknown', false]])
  })
})

describe('rows that do or do not exist', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 6, 10, 0, 0, s))

  it('blocks an update after a remove', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-a-1', as_of: '2026-06-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-06-02', values: { colour: 'blue' }, reason: '' }], { log: dir, resource: 'things', now: at(2) })
    const { report, tables } = buildLog(dir)
    assert.deepEqual(report.map(item => [item.kind, item.blocking]), [['missing-row', true]])
    assert.equal(byKey(tables.things.rows)['t-a-1'], undefined)
  })

  it('lets a row be created and updated in one changeset', () => {
    const dir = tempLog()
    draftChangeset([
      { type: 'create', key: 't-e-1', as_of: '2026-06-01', values: { place: 'E' }, reason: '' },
      { type: 'update', key: 't-e-1', as_of: '2026-06-01', values: { name: 'Elderberry' }, reason: '' }
    ], { log: dir, resource: 'things', now: at(1) })
    const { report, tables } = buildLog(dir)
    assert.deepEqual(report, [])
    assert.equal(byKey(tables.things.rows)['t-e-1'].name, 'Elderberry')
  })

  it('puts a new row in the place of a removed row in its group', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-c-1', as_of: '2026-06-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    draftChangeset([{ type: 'create', key: 't-x-1', as_of: '2026-06-01', values: { place: 'X' }, reason: '' }], { log: dir, resource: 'things', now: at(2) })
    draftChangeset([{ type: 'create', key: 't-c-2', as_of: '2026-06-01', values: { place: 'C' }, reason: '' }], { log: dir, resource: 'things', now: at(3) })
    const { tables } = buildLog(dir)
    assert.deepEqual(tables.things.rows.map(row => row.thing_id), ['t-a-1', 't-b-1', 't-a-2', 't-c-2', 't-x-1'])
  })

  it('applies a remove older than the row\'s date in the baseline, and reports it', () => {
    const dir = tempLog()
    draftChangeset([{ type: 'remove', key: 't-a-2', as_of: '2026-02-01', reason: '' }], { log: dir, resource: 'things', now: at(1) })
    const { report, tables } = buildLog(dir)
    assert.deepEqual(report.map(item => item.kind), ['older-change'])
    assert.equal(byKey(tables.things.rows)['t-a-2'], undefined)
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
    assert.equal(a.path, path.join(dir, 'next', 'things', `${a.id}.toml`))
    assert.deepEqual(readChangeset(fs.readFileSync(a.path, 'utf8')), { summary: 'Why', changes })
  })

  it('refuses to draft a changeset that does not match the schema', () => {
    assert.throws(() => changesetTOML({ changes: [{ type: 'update', key: 'k', as_of: '2026-01-01', values: {} } as never] }))
  })
})

describe('dates (S2)', () => {
  const update = (asOf: string) => `[[changes]]\ntype = "update"\nkey = "t-a-1"\nas_of = ${asOf}\nvalues.colour = "red"\nreason = ""\n`
  /** Write `text` as a changeset in a temp log, and read the folder */
  function read (folder: string, id: string, text: string) {
    const dir = tempLog()
    fs.mkdirSync(path.join(dir, folder, 'things'), { recursive: true })
    fs.writeFileSync(path.join(dir, folder, 'things', `${id}.toml`), text)
    const report: ReportItem[] = []
    const changesets = readFolders(dir, [folder], datapackage, report, { now })
    return { changesets: changesets.things ?? [], report }
  }

  it('knows a real calendar date', () => {
    assert.equal(isCalendarDate('2024-02-29'), true)
    for (const text of ['2026-02-29', '2026-02-31', '2026-11-31', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01']) assert.equal(isCalendarDate(text), false, text)
  })

  it('rejects a bare TOML date that is not real, which smol-toml would roll over, as invalid TOML', () => {
    assert.throws(() => readChangeset(update('2026-02-31')), /line 4: 2026-02-31 is not a real calendar date/)
    assert.throws(() => readChangeset('a = [2026-01-01, 2026-04-31T10:00:00Z]'), /2026-04-31/)
    // text that only looks like a date, in strings and comments, is left alone
    const data = readChangeset(`${update('2026-02-28')}summary = "not 2026-02-31"\n# nor 2026-02-30\n`.replace('reason = ""', "reason = '''\n2026-02-31\n'''")) as { changes: { as_of: string }[] }
    assert.equal(data.changes[0].as_of, '2026-02-28')
    const { changesets, report } = read('next', '2026-07-10T000000Z-0b0b', update('2026-02-31'))
    assert.deepEqual(changesets, [])
    assert.deepEqual(report.map(item => [item.kind, item.blocking, item.file]), [['invalid-toml', true, 'next/things/2026-07-10T000000Z-0b0b.toml']])
  })

  it('blocks a quoted as_of that is not a real date, at its change and key, and skips the changeset', () => {
    const { changesets, report } = read('next', '2026-07-10T000000Z-0b0b', update('"2026-02-28"') + update('"2026-11-31"').replace('t-a-1', 't-b-1'))
    assert.deepEqual(changesets, [])
    assert.deepEqual(report.map(item => [item.kind, item.blocking, item.changeset, item.change, item.key]), [['invalid-changeset', true, '2026-07-10T000000Z-0b0b', 1, 't-b-1']])
    assert.match(report[0].message, /as_of "2026-11-31" is not a real calendar date/)
  })

  it('warns, without blocking, about a pending as_of later than its changeset id, and still applies it', () => {
    assert.deepEqual(read('next', '2026-07-10T235959Z-0b0b', update('2026-07-10')).report, [], 'the same UTC day is fine')
    const { changesets, report } = read('next', '2026-07-10T000000Z-0b0b', update('2099-01-01'))
    assert.equal(changesets.length, 1)
    assert.deepEqual(report.map(item => [item.kind, item.blocking, item.file, item.change, item.key]),
      [['future-as-of', false, 'next/things/2026-07-10T000000Z-0b0b.toml', 0, 't-a-1']])
    assert.match(report[0].message, /dated 2099-01-01, later than the changeset's id, created 2026-07-10/)
    const built = build({ ...options, layers: [{ things: changesets }], report })
    assert.equal(byKey(built.tables.things.rows)['t-a-1'].updated, '2099-01-01')
    assert.equal(built.report.filter(item => item.blocking).length, 0)
  })

  it('caps a released as_of at its release, not its id, and any as_of at today', () => {
    // release-day fixes added to a changeset drafted before the release, as in 2026-11-06
    assert.deepEqual(read('2026-07-31', '2026-07-10T000000Z-0b0b', update('2026-07-31')).report, [])
    const { report } = read('2026-07-31', '2026-07-10T000000Z-0b0b', update('2026-08-01'))
    assert.deepEqual(report.map(item => [item.kind, item.blocking]), [['future-as-of', false]])
    assert.match(report[0].message, /later than its release, 2026-07-31/)
    assert.equal(laterThanExpected('2026-10-02', '2026-10-02T000000Z-0b0b', '2026-12-01', now), 'today, 2026-10-01')
    assert.equal(laterThanExpected('2026-10-01', '2026-10-01T000000Z-0b0b', 'next', now), undefined)
  })
})

describe('the pending round (S3)', () => {
  // the next release, as data:check builds it: the latest release's rows, plus changesets/next/ only
  function pendingRound (write: (dir: string) => void) {
    const dir = tempLog()
    write(dir)
    const report: ReportItem[] = []
    const layer = readFolders(dir, ['next'], datapackage, report, { now })
    const result = build({ ...options, layers: [layer], report })
    return { result, items: withFiles(result.report, Object.values(layer).flat()) }
  }
  const at = (s: number) => new Date(Date.UTC(2026, 6, 10, 0, 0, s))

  it('blocks on invalid TOML and a missing row, each with its file, change and key, and warns about a future as_of', () => {
    let missing = ''
    let future = ''
    const { items } = pendingRound(dir => {
      missing = draftChangeset([{ type: 'update', key: 't-z-9', as_of: '2026-07-01', values: { colour: 'blue' }, reason: '' }], { log: dir, resource: 'things', now: at(1) }).id
      future = draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2099-01-01', values: { colour: 'blue' }, reason: '' }], { log: dir, resource: 'things', now: at(2) }).id
      draftChangeset([{ type: 'update', key: 't-b-1', as_of: '2026-07-01', values: { name: 'Plantain' }, reason: 'Fine.' }], { log: dir, resource: 'things', now: at(3) })
      fs.writeFileSync(path.join(dir, 'next', 'things', '2026-07-10T000004Z-0b0b.toml'), 'this is [not toml')
    })
    const blocking = items.filter(item => item.blocking).map(describeItem)
    assert.deepEqual(blocking.map(line => line.replace(/: .*/s, '')), [
      'next/things/2026-07-10T000004Z-0b0b.toml',
      `next/things/${missing}.toml change 0, t-z-9`
    ])
    assert.match(blocking[1], /updates a row that does not exist/)
    const warnings = items.filter(item => !item.blocking)
    assert.deepEqual(warnings.map(item => [item.kind, describeItem(item)]), [
      ['future-as-of', `next/things/${future}.toml change 0, t-a-1: is dated 2099-01-01, later than the changeset's id, created 2026-07-10, and still applies`]
    ])
  })

  it('blocks on a value changed this round that fails a check, and warns on one from the release (D60)', () => {
    const { result } = pendingRound(dir => {
      draftChangeset([{ type: 'update', key: 't-a-1', as_of: '2026-07-01', values: { colour: 'Banana' }, reason: '' }], { log: dir, resource: 'things', now: at(1) })
    })
    const failure = (key: string) => ({ resource: 'things', key, fields: ['colour'], message: 'is not in the codebook' })
    assert.deepEqual([checkItem(result, failure('t-a-1'), 'thing_id')].map(item => [item.kind, item.blocking]), [['check', true]])
    assert.deepEqual([checkItem(result, failure('t-b-1'), 'thing_id')].map(item => [item.kind, item.blocking]), [['legacy', false]])
  })

  it('has nothing to report when the pending changes are fine', () => {
    const { items } = pendingRound(dir => {
      draftChangeset([{ type: 'update', key: 't-b-1', as_of: '2026-07-01', values: { name: 'Plantain' }, reason: 'Fine.', sources: ['https://example.org/p'] }], { log: dir, resource: 'things', now: at(1) })
    })
    assert.deepEqual(items, [])
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
