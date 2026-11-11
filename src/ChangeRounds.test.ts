// The changelog's rounds (src/ChangeRounds.ts, D81): a release's changelog holds only the changesets
// released in it, against the release before it, and the pending one only those in changesets/next/,
// against the release the site shows (B2: pending changes counted in the published release's changelog).
// Run with: node --test src/ChangeRounds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseOf, inRound, pending, releaseRounds, type RoundEntry } from './ChangeRounds.ts'

const releases = ['2026-01-15', '2026-03-31', '2026-11-06']
const released = (release: string): RoundEntry => ({ status: 'released', release })
const next: RoundEntry = { status: 'pending', release: null }

test('a release round holds only the changesets released in it', () => {
  assert.equal(inRound(released('2026-11-06'), '2026-11-06'), true)
  assert.equal(inRound(released('2026-03-31'), '2026-11-06'), false)
  assert.equal(inRound(next, '2026-11-06'), false)
})

test('the pending round holds only the pending changesets', () => {
  assert.equal(inRound(next, pending), true)
  assert.equal(inRound(released('2026-11-06'), pending), false)
})

test('a release applies to the release before it, and the pending changes to the latest', () => {
  assert.equal(baseOf('2026-11-06', releases, '2026-11-06'), '2026-03-31')
  assert.equal(baseOf('2026-03-31', releases, '2026-11-06'), '2026-01-15')
  assert.equal(baseOf('2026-01-15', releases, '2026-11-06'), undefined)
  assert.equal(baseOf(pending, releases, '2026-11-06'), '2026-11-06')
})

test('only releases with changesets get a changelog, newest first, up to the latest', () => {
  assert.deepEqual(releaseRounds([released('2026-11-06'), released('2026-11-06'), next], releases, '2026-11-06'), ['2026-11-06'])
  assert.deepEqual(releaseRounds([next], releases, '2026-11-06'), [])
  // a later release's changesets, cut but not yet shown by the site, wait for it
  const later = [...releases, '2027-02-01']
  assert.deepEqual(releaseRounds([released('2026-11-06'), released('2027-02-01')], later, '2026-11-06'), ['2026-11-06'])
  assert.deepEqual(releaseRounds([released('2026-11-06'), released('2027-02-01')], later, '2027-02-01'), ['2027-02-01', '2026-11-06'])
  // a release folder without every table's JSON has no changelog
  assert.deepEqual(releaseRounds([released('2026-12-01')], releases, '2026-12-01'), [])
})
