// Not Found on a text row (D95, src/components/edit/notFound.ts): what typing in the box does to the button. The colours, the box never
// being disabled and the rows not moving are in the browser flows. Run with: node --test src/NotFound.test.ts
import '../scripts/site-modules.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOT_FOUND } from './Proposal.ts'
import { notFoundAfterTyping } from './components/edit/notFound.ts'

const after = (current: string, text: string, on: boolean) => notFoundAfterTyping({ current, text, on })

test('typing a value turns Not Found off, whatever the row had', () => {
  for (const current of [NOT_FOUND, 'M-Pesa', 'NA', '']) {
    for (const on of [true, false]) assert.equal(after(current, 'Airtel', on), false, `${current || 'empty'}, ${on}`)
  }
})

test('on a row whose value is Not Found, an empty box is Not Found again, whether it was on or off', () => {
  assert.equal(after(NOT_FOUND, '', false), true)
  assert.equal(after(NOT_FOUND, '  ', false), true)
  assert.equal(after(NOT_FOUND, '', true), true)
})

test('on a row with a value, or none, emptying the box never sets Not Found', () => {
  for (const current of ['M-Pesa', 'NA', '']) assert.equal(after(current, '', false), false, current || 'empty')
  assert.equal(after('M-Pesa', ' \t ', false), false)
})

test('on another row, an empty box leaves a Not Found that was clicked on as it was', () => {
  assert.equal(after('M-Pesa', '', true), true)
})
