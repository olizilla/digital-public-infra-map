// Tests for the blog import (D98): scripts/blog-import.ts (the issue form, the doc link, the fetch, the frontmatter, the pull
// request, the files written) and src/BlogConvert.ts, which both it and the /blog/new/ preview use (the conversion of a Word file
// to Markdown: the allow-list, the clean-up, the images), on Word files made here (scripts/blog-import-docx.ts), hostile ones
// among them. Nothing is fetched from the network, and nothing needs to be installed: the converter is JavaScript.
// Run with: node --test scripts/blog-import.test.ts   (npm run test:blog)
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import {
  checkDocx, docIdFrom, exportUrl, fetchDocx, finalMarkdown, FORM, FORM_IDS, FORM_TEMPLATE, frontmatter, importDocx, LIMITS, oneLine, BRANCH, randomBranch,
  parseAuthors, parseDate, parseIssueForm, pullRequestBody, Refusal, safeUrl, slugify, slugTaken, sniffImage
} from './blog-import.ts'
import { convertDocx, noteParts, postFile, toMarkdown } from '../src/BlogConvert.ts'
import { fetchDocxInBrowser, fieldProblems, issueUrl, PreviewProblem } from '../src/BlogPreview.ts'
import { renderPost } from '../src/BlogRender.ts'
import { docx, gif, png, sample, x, zip } from './blog-import-docx.ts'

const scripts = import.meta.dirname
const temporary: string[] = []
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-import-test-')); temporary.push(dir); return dir }
after(() => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }) })

const ID = 'A'.repeat(20) + '-_' + 'b'.repeat(20)

// ---------------------------------------------------------------------------------------------------------
// the issue form and the link

test('the issue form: each field is the text under its heading, and "No response" is empty', () => {
  const body = ['### Link to the Google Doc', '', 'https://docs.google.com/document/d/' + ID + '/edit', '', '### Author name(s)', '', 'Ada Lovelace, Grace Hopper', '',
    '### Publish date', '', '_No response_', '', '### Description', '', 'One line.'].join('\r\n')
  assert.deepEqual(parseIssueForm(body), { doc: 'https://docs.google.com/document/d/' + ID + '/edit', authors: 'Ada Lovelace, Grace Hopper', date: '', description: 'One line.' })
  assert.deepEqual(parseIssueForm('nothing here'), { doc: '', authors: '', date: '', description: '' })
  assert.equal(parseIssueForm('### Description\n\nfirst\n\n### Description\n\nsecond').description, 'first', 'the first of a repeated heading')
})

test('the issue form’s fields are the headings the script reads, and the workflow runs for its label', () => {
  const template = load(fs.readFileSync(path.join(scripts, '../.github/ISSUE_TEMPLATE/blog-post.yml'), 'utf8')) as any
  const fields = template.body.filter((item: any) => item.type !== 'markdown')
  assert.deepEqual(fields.map((f: any) => f.attributes.label), Object.values(FORM))
  assert.deepEqual(fields.map((f: any) => f.id), ['doc', 'authors', 'date', 'description'])
  assert.deepEqual(fields.map((f: any) => f.id), [...FORM_IDS], 'the ids the preview page prefills the form with (/blog/new/)')
  assert.ok(fs.existsSync(path.join(scripts, '../.github/ISSUE_TEMPLATE', FORM_TEMPLATE)))
  assert.deepEqual(fields.filter((f: any) => f.validations?.required).map((f: any) => f.id), ['doc', 'authors'], 'the doc and the authors are required, the date and description aren’t')
  assert.deepEqual(template.labels, ['blog-post'])
  const workflow = fs.readFileSync(path.join(scripts, '../.github/workflows/blog-import.yml'), 'utf8')
  assert.ok(workflow.includes(`'${template.labels[0]}'`), 'the workflow’s label')
  for (const use of workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)) assert.match(use[1], /@[0-9a-f]{40}$/, `${use[1]} is pinned by commit`)
})

test('the doc link: only a docs.google.com document, and only its ID', () => {
  const ok = [
    `https://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com/document/d/${ID}/edit?usp=sharing&tab=t.0#heading=h.abc`,
    `https://docs.google.com/document/d/${ID}`,
    `https://docs.google.com/document/u/0/d/${ID}/edit`,
    `  <https://docs.google.com/document/d/${ID}/edit>  `
  ]
  for (const link of ok) assert.equal(docIdFrom(link), ID, link)
  const bad = [
    '', 'not a link', `http://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com.evil.example/document/d/${ID}/edit`, `https://evil.example/document/d/${ID}/edit`,
    `https://docs.google.com@evil.example/document/d/${ID}/edit`, `https://user:pw@docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com:8443/document/d/${ID}/edit`, `https://drive.google.com/document/d/${ID}/edit`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com/document/d/short/edit`,
    `https://docs.google.com/document/d/${'a'.repeat(101)}/edit`, `https://docs.google.com/document/d/${ID}%2F..%2Fx/edit`,
    `https://docs.google.com/document/d/${ID}.evil/edit`, `https://docs.google.com/document/d/../${ID}`,
    `https://docs.google.com/document/d/${ID}/edit https://evil.example`, `file:///etc/passwd`, `javascript:alert(1)`
  ]
  for (const link of bad) assert.throws(() => docIdFrom(link), Refusal, link)
  assert.equal(exportUrl(ID), `https://docs.google.com/document/d/${ID}/export?format=docx`)
})

test('the authors, the date and the description from the form', () => {
  assert.deepEqual(parseAuthors('Ada Lovelace, Grace Hopper;\nAda Lovelace\n  Alan   Turing '), ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
  assert.throws(() => parseAuthors(''), Refusal)
  assert.throws(() => parseAuthors(' , ; '), Refusal)
  assert.throws(() => parseAuthors(Array.from({ length: 21 }, (_, i) => `Author ${i}`).join(',')), Refusal)
  assert.equal(parseAuthors('A'.repeat(300))[0].length, LIMITS.authorChars)
  assert.deepEqual([parseDate(''), parseDate('2026'), parseDate('2026-03'), parseDate('2026-02-28'), parseDate(' 2026-11-25 ')], [undefined, '2026', '2026-03', '2026-02-28', '2026-11-25'])
  for (const bad of ['2026-13-01', '2026-02-30', '25 Nov 2026', '2026-1-1', '1850-01-01', '2026-11-25T00:00:00Z', '2026-11-25\n---']) assert.throws(() => parseDate(bad), Refusal, bad)
  assert.equal(oneLine('a‮b​c\u0000d\n\te   f', 50), 'a b c d e f', 'controls, zero-width and bidirectional marks go')
  assert.equal(oneLine('x'.repeat(500), 10).length, 10)
})

// ---------------------------------------------------------------------------------------------------------
// the fetch

const reply = (body: BodyInit | null, init: ResponseInit = {}) => new Response(body, { status: 200, ...init })
const redirect = (to: string, status = 307) => new Response(null, { status, headers: { location: to } })
const fakeFetch = (...responses: (Response | ((url: string, init: RequestInit) => Response | Promise<Response>))[]) => {
  const seen: string[] = []
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url))
    const next = responses.shift()
    if (!next) throw new Error('unexpected request ' + url)
    return typeof next === 'function' ? next(String(url), init ?? {}) : next
  }
  return { fetcher: fetcher as typeof fetch, seen }
}

test('fetch: asks for the export of that doc, follows Google’s redirect, and returns the bytes', async () => {
  const { fetcher, seen } = fakeFetch(redirect(`https://doc-0s-4g-docstext.googleusercontent.com/export/abc/${ID}?format=docx`), reply('PK\u0003\u0004hello'))
  const bytes = await fetchDocx(ID, { fetch: fetcher })
  assert.equal(Buffer.from(bytes).toString(), 'PK\u0003\u0004hello')
  assert.deepEqual(seen, [exportUrl(ID), `https://doc-0s-4g-docstext.googleusercontent.com/export/abc/${ID}?format=docx`])
})

test('fetch: a redirect anywhere else, to http, to a login page or with credentials is refused', async () => {
  for (const to of ['https://evil.example/x', 'http://docs.google.com/x', 'https://accounts.google.com/ServiceLogin?continue=x', 'https://docs.google.com.evil.example/x',
    'https://evilgoogleusercontent.com/x', 'https://u:p@docs.google.com/x', 'https://docs.google.com:444/x', 'file:///etc/passwd', 'https://169.254.169.254/latest/meta-data']) {
    const { fetcher, seen } = fakeFetch(redirect(to), reply('PK'))
    await assert.rejects(fetchDocx(ID, { fetch: fetcher }), Refusal, to)
    assert.equal(seen.length, 1, `${to}: not followed`)
  }
  const loop = fakeFetch(...Array.from({ length: 10 }, () => redirect(exportUrl(ID))))
  await assert.rejects(fetchDocx(ID, { fetch: loop.fetcher }), Refusal)
  await assert.rejects(fetchDocx('../x', { fetch: fakeFetch().fetcher }), Refusal, 'not an ID')
})

test('fetch: not found, private and too large downloads are refused, with the way to fix a doc’s sharing', async () => {
  // in the preview page's words (src/BlogPreview.ts): a private doc is 401 (checked on a real one, 26 Nov)
  const said = { 401: /isn’t shared publicly/, 403: /isn’t shared publicly/, 404: /can’t find that doc/, 500: /answered 500/ }
  for (const [status, words] of Object.entries(said)) {
    const error = await fetchDocx(ID, { fetch: fakeFetch(reply('nope', { status: Number(status) })).fetcher }).catch(e => e)
    assert.ok(error instanceof Refusal)
    assert.match(error.message, words, status)
    assert.match(error.message, /Anyone with the link/)
  }
  await assert.rejects(fetchDocx(ID, { fetch: fakeFetch(reply('x', { headers: { 'content-length': '1000' } })).fetcher, maxBytes: 100 }), Refusal, 'declared size')
  // no content-length: stopped as it streams
  let pulled = 0
  const endless = new ReadableStream({ pull (controller) { pulled++; controller.enqueue(new Uint8Array(64)); if (pulled > 1000) controller.close() } })
  await assert.rejects(fetchDocx(ID, { fetch: fakeFetch(reply(endless)).fetcher, maxBytes: 200 }), Refusal, 'streamed size')
  assert.ok(pulled < 20, `stopped reading after ${pulled} chunks`)
})

test('fetch: gives up after the time limit', async () => {
  const hang = (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  const error = await fetchDocx(ID, { fetch: fakeFetch(hang).fetcher, timeoutMs: 50 }).catch(e => e)
  assert.ok(error instanceof Refusal)
  assert.match(error.message, /too long/)
})

// ---------------------------------------------------------------------------------------------------------
// the Word file

test('the zip’s directory: a Word file of a sane size, and nothing else', () => {
  checkDocx(sample())
  assert.throws(() => checkDocx(Buffer.from('<html>sign in</html>')), Refusal)
  assert.throws(() => checkDocx(Buffer.alloc(0)), Refusal)
  assert.throws(() => checkDocx(zip({ 'other.txt': 'hi' })), Refusal, 'no word/document.xml')
  assert.throws(() => checkDocx(zip({ 'word/document.xml': '<w:document/>' }, { declaredSize: LIMITS.zipBytes + 1 })), Refusal, 'expands to too much')
  assert.throws(() => checkDocx(zip({ 'word/document.xml': '', ...Object.fromEntries(Array.from({ length: LIMITS.zipEntries + 1 }, (_, i) => [`f${i}`, ''])) })), Refusal, 'too many parts')
})

test('images are PNG, JPEG, GIF or WebP by their first bytes, whatever the file is called', () => {
  assert.equal(sniffImage(png())?.ext, 'png')
  assert.equal(sniffImage(gif())?.ext, 'gif')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))?.ext, 'jpg')
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))?.ext, 'webp')
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<?xml version="1.0"?><svg/>', 'MZ\u0090\u0000', '<html><script>alert(1)</script>', '%PDF-1.7', 'RIFF\u0000\u0000\u0000\u0000WAVEfmt ', '', 'GIF', 'GIF90a']) {
    assert.equal(sniffImage(Buffer.from(bad, 'latin1')), undefined, JSON.stringify(bad))
  }
})

// ---------------------------------------------------------------------------------------------------------
// converting a Word file

const { p, link, image, table } = x
const heading = p(['Title'], 'Heading1')
/** a Word file's body as the post's Markdown (the images at /blog/t/<name>), its notes and its converted parts */
const convert = async (body: string[], options: Partial<Parameters<typeof docx>[0]> = {}) => {
  const converted = await convertDocx(docx({ body, ...options }))
  return { converted, md: toMarkdown(converted, name => `/blog/t/${name}`), notes: converted.notes }
}

test('links keep an http, https or mailto address; any other is its text; Google’s redirect is unwrapped', async () => {
  assert.equal(safeUrl('https://example.org/a?b=c'), 'https://example.org/a?b=c')
  assert.equal(safeUrl('mailto:a@example.org'), 'mailto:a@example.org')
  assert.equal(safeUrl('https://www.google.com/url?q=https://example.org/real%3Fa%3D1&sa=D&source=editors'), 'https://example.org/real?a=1')
  assert.equal(safeUrl('https://www.google.com/url?sa=D&q=https%3A%2F%2Fexample.org%2Fx&usg=AOv'), 'https://example.org/x')
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.org/', 'blob:https://example.org/x',
    '#_heading=h.abc', '/relative', '//evil.example/x', 'https://u:p@example.org/', 'https://www.google.com/url?q=javascript:alert(1)', 'https://www.google.com/url?q=data:text/html,x', 'https://www.google.com/url', '']) {
    assert.equal(safeUrl(bad), undefined, JSON.stringify(bad))
  }
  const { md, notes } = await convert([heading, p(['x']), p([
    link('j', 'click me'), ' and ', link('ok', 'ok'), ' and ', link('inner', 'in the doc'), ' and ', link('g', 'google js')])
  ], { links: { j: 'javascript:alert(1)', ok: 'https://example.org/', inner: '#_heading=h.abc', g: 'https://www.google.com/url?q=javascript:alert(2)&sa=D' } })
  assert.match(md, /^click me and \[ok\]\(https:\/\/example\.org\/\) and in the doc and google js$/m)
  assert.doesNotMatch(md, /javascript/)
  assert.equal(notes.todo.filter(n => /address other than http/.test(n)).length, 1, 'said once, as something to do')
})

test('a link whose text is a web address loses its emphasis, and is an autolink if the text is the address; its spaces are outside it', async () => {
  const url = 'https://example.org/paper'
  const { md } = await convert([heading, p(['x']), p(['Available at: ', link('a', ' ' + url + ' ', true), ' ', link('a', 'https://example.org/paper-short', true), ' ', link('a', 'A Title', true), ' ', link('b', 'http://Example.org/Docs'), '.'])],
    { links: { a: url, b: 'http://Example.org/Docs' } })
  assert.match(md, /^Available at: <https:\/\/example\.org\/paper> \[https:\/\/example\.org\/paper-short\]\(https:\/\/example\.org\/paper\) \[\*A Title\*\]\(https:\/\/example\.org\/paper\) <http:\/\/example\.org\/Docs>\.$/m)
})

test('the title is the first Heading 1 (or Title) and not in the body; other headings keep their levels; what is off is a to-do, not fixed quietly', async () => {
  const ok = await convert([p(['The   title'], 'Heading1'), p(['One'], 'Heading2'), p(['Two'], 'Heading3'), p([''], 'Heading2'), p(['x'])])
  assert.equal(ok.converted.title, 'The title')
  assert.equal(ok.md, '## One\n\n### Two\n\nx\n', 'no shifting, and the empty heading is gone')
  assert.deepEqual(ok.notes.todo, [])
  assert.deepEqual(ok.notes.did, [], 'the title taken from the first Heading 1 is not worth a note')
  // more than one Heading 1: the first is the title, the others are shown as Heading 2, and the to-do says so
  const more = await convert([p(['The title'], 'Heading1'), p(['text']), p(['Another'], 'Heading1'), p(['Sub'], 'Heading2')])
  assert.equal(more.md, 'text\n\n## Another\n\n## Sub\n')
  assert.deepEqual(more.notes.todo, ['Only the first Heading 1 is the title. The other Heading 1s are shown as Heading 2. In the doc, use Heading 2 for sections.'])
  // text before the title
  const before = await convert([p(['Before']), p(['The title'], 'Heading1'), p(['after'])])
  assert.equal(before.md, 'Before\n\nafter\n')
  assert.match(before.notes.todo[0], /^The title \(the doc’s first Heading 1\) is not the first line of the doc/)
  // the Title style is a title, a Subtitle stays where it is
  const b = await convert([p(['From the Title style'], 'Title'), p(['A subtitle'], 'Subtitle'), p(['Section'], 'Heading2'), p(['text'])])
  assert.equal(b.converted.title, 'From the Title style')
  assert.equal(b.md, '*A subtitle*\n\n## Section\n\ntext\n')
  // no Heading 1: nothing is taken for the title, the import says what to do
  const none = 'The doc has no Heading 1. Make its first line the title with Format → Paragraph styles → Heading 1.'
  await assert.rejects(convert([p(['no heading'])]), { message: none })
  await assert.rejects(convert([p(['A Heading 2 is not a title'], 'Heading2'), p(['text'])]), { message: none })
})

test('an image glued to the end of a caption is a paragraph of its own; alt text is the doc’s, or none, and then it is a to-do', async () => {
  const { md, converted } = await convert([
    heading,
    p([image('i1')]), p([{ text: 'Figure 1', bold: true }, ': The first figure.']),
    p([{ text: 'Figure 2', bold: true }, ': The second one.', image('i2')]),
    p([image('i3', 'Alt text from the doc')])
  ], { media: Object.fromEntries([1, 2, 3].map(n => [`i${n}`, { name: `image${n}.png`, bytes: png(2 + n) }])) })
  assert.equal(md, [
    '![](/blog/t/image-1.png)', '**Figure 1**: The first figure.', '**Figure 2**: The second one.', '![](/blog/t/image-2.png)', '![Alt text from the doc](/blog/t/image-3.png)'
  ].join('\n\n') + '\n', 'no alt text is made up from a caption or a number')
  assert.deepEqual(converted.notes.todo, [1, 2].map(n => `\`image-${n}.png\` has no alt text. In the doc, right-click the image, choose **Alt text**, describe what it shows, then Refresh (or comment \`/update\`).`))
  assert.deepEqual(converted.notes.did, ['An image that was in a paragraph with text was moved to a paragraph of its own.'])
  assert.deepEqual(noteParts(converted.notes.todo[0]).map(part => [part.text.slice(0, 12), part.code, !!part.bold]).slice(0, 4), [['image-1.png', true, false], [' has no alt ', false, false], ['Alt text', false, true], [', describe w', false, false]])
})

test('an image that is left out leaves no empty paragraph, and is said in the notes', async () => {
  const { md, notes } = await convert([heading, p([image('i1')]), p(['after'])], { media: { i1: { name: 'image1.svg', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') } } })
  assert.equal(md, 'after\n')
  assert.deepEqual(notes.todo, ['Image 1 was left out: only PNG, JPEG, GIF and WebP images are accepted. In the doc, replace it with a picture in one of those formats.'])
})

test('a floating picture, positioned in the page, is an image of its own, in the order it comes', async () => {
  const { md, converted } = await convert([heading, p(['Before ', x.anchoredImage('i1', 'A floating picture'), ' after']), p([image('i2')])],
    { media: { i1: { name: 'image1.png', bytes: png(3) }, i2: { name: 'image2.png', bytes: png(4) } } })
  assert.equal(md, 'Before\n\n![A floating picture](/blog/t/image-1.png)\n\nafter\n\n![](/blog/t/image-2.png)\n')
  assert.equal(converted.pictures.length, 2)
})

test('a picture used twice is kept once', async () => {
  const { md, converted } = await convert([heading, p([image('i1')]), p(['text']), p([image('i2')])],
    { media: { i1: { name: 'image1.png', bytes: png(3) }, i2: { name: 'image2.png', bytes: png(3) } } })
  assert.equal(converted.pictures.length, 1)
  assert.equal(md.match(/image-1\.png/g)?.length, 2)
})

test('footnotes are Markdown footnotes', async () => {
  const { md, notes } = await convert([heading, p(['A claim', x.footnote(1), ' and another', x.footnote(2), '.'])], { footnotes: { 1: 'The source of the claim.', 2: 'Another source, with a [bracket].' } })
  assert.equal(md, 'A claim[^1] and another[^2].\n\n[^1]: The source of the claim.\n\n[^2]: Another source, with a \\[bracket].\n')
  assert.deepEqual(notes.todo, [])
})

test('lists keep their levels and numbering, and a table is a table', async () => {
  const { md } = await convert([heading, p(['Top'], undefined, 'bullet'), p(['Nested'], undefined, 'bullet', 1), p(['Deeper'], undefined, 'bullet', 2), p(['Back'], undefined, 'bullet'),
    p(['One'], undefined, 'number'), p(['Sub a'], undefined, 'number', 1), p(['Two'], undefined, 'number'), table([['Country', 'System'], ['Estonia', 'e-ID | x']])])
  assert.equal(md, '- Top\n  - Nested\n    - Deeper\n- Back\n\n1. One\n   1. Sub a\n2. Two\n\n| Country | System    |\n| ------- | --------- |\n| Estonia | e-ID \\| x |\n')
})

test('what mammoth can’t convert is said in the notes, not dropped silently', async () => {
  const { md, notes } = await convert([heading, p(['A chart: ', x.chart(), ' and an equation: ', x.equation(), ' and water, H', { text: '2', sup: true }, 'O.']),
    x.mergedTable([['Merged', 'x'], ['1', '2', '3']])])
  assert.match(md, /^A chart: and an equation: and water, H2O\.$/m)
  assert.deepEqual(notes.todo.map(n => n.replace(/`oMath`.*$/, '`oMath`')), [
    'Parts of the doc that the converter can’t read were left out: Word elements `oMath`',
    '1 drawing in the doc (charts) can’t be converted and was left out. Add it to the doc as a picture (Insert > Image) to have it in the post.',
    'Superscript and subscript text is shown as ordinary text, as Markdown has no such formatting. In the doc, write it in plain characters (m², CO₂).',
    'A table has merged cells, which Markdown tables can’t have, so they are shown as single cells. In the doc, split the cells.'
  ])
  assert.deepEqual(noteParts(notes.todo[0]).filter(part => part.code).map(part => part.text), ['oMath'])
})

test('paragraphs stay as they are in the doc, whatever their length or the blank lines around them; a line break is a hard break', async () => {
  const long = 'A long paragraph, written the usual way, that says something at some length. '.repeat(2)
  const blank = p([''])
  const lines = [p(['This transformative power resides, of course,']), p(['but rather in the power possessed']), p(['by those who deploy it.']), p(['- Someone, A Book'])]
  for (const body of [[heading, p([long]), blank, p([long]), blank, p([long]), blank, ...lines, blank, p([long])], [heading, p([long]), p([long]), ...lines, p([long])]]) {
    const { md, notes } = await convert(body)
    assert.doesNotMatch(md, /\\\n/, 'no hard breaks made up')
    assert.match(md, /This transformative power resides, of course,\n\nbut rather in the power possessed\n\nby those who deploy it\.\n\n\\- Someone, A Book\n/)
    assert.deepEqual(notes.todo, [])
  }
  // a line break (Shift+Enter) in one paragraph is a hard break
  assert.match((await convert([heading, p(['first', x.br(), 'second', x.br(), 'third'])])).md, /^first\\\nsecond\\\nthird$/m)
})

// what Google exports for suggested edits are tracked changes. mammoth keeps what is inserted or moved in and drops what is deleted or moved out,
// and takes a change of format as made: the doc as if every suggestion were accepted. Any of them is a to-do, so they never reach the post unsaid
const TRACKED = 'w:id="1" w:author="Someone" w:date="2026-11-20T10:00:00Z"'
const run_ = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`
const deleted = (t: string) => `<w:r><w:delText xml:space="preserve">${t}</w:delText></w:r>`
const suggestion = (inner: string, props = '') => `<w:p><w:pPr>${props}</w:pPr>${inner}</w:p>`
const SUGGESTED = 'The doc has suggested edits that aren’t accepted or rejected. In Google Docs, choose Tools → Review suggested edits, accept or reject them, then Refresh. Until then the post shows the text as if they were all accepted.'

test('suggested edits (tracked changes) are converted as if accepted, deterministically, and are a to-do', async () => {
  const cases: [string, string, string][] = [
    ['an insertion', suggestion(run_('Keep ') + `<w:ins ${TRACKED}>${run_('INSERTED')}</w:ins>` + run_(' end')), 'Keep INSERTED end'],
    ['a deletion', suggestion(run_('Keep ') + `<w:del ${TRACKED}>${deleted('DELETED')}</w:del>` + run_(' end')), 'Keep end'],
    ['a deletion written as text', suggestion(run_('Keep ') + `<w:del ${TRACKED}><w:r><w:t>DELETED</w:t></w:r></w:del>` + run_(' end')), 'Keep end'],
    ['text moved out', suggestion(run_('Keep ') + `<w:moveFrom ${TRACKED}>${run_('MOVED')}</w:moveFrom>` + run_(' end')), 'Keep end'],
    ['text moved in', suggestion(run_('Keep ') + `<w:moveTo ${TRACKED}>${run_('MOVED')}</w:moveTo>` + run_(' end')), 'Keep MOVED end'],
    ['a change of format', suggestion(`<w:r><w:rPr><w:b/><w:rPrChange ${TRACKED}><w:rPr/></w:rPrChange></w:rPr><w:t>NOWBOLD</w:t></w:r>`), '**NOWBOLD**'],
    ['a change of paragraph style', suggestion(run_('PARA'), `<w:pPrChange ${TRACKED}><w:pPr/></w:pPrChange>`), 'PARA'],
    ['an inserted paragraph', suggestion(`<w:ins ${TRACKED}>${run_('NEWPARA')}</w:ins>`, `<w:rPr><w:ins ${TRACKED}/></w:rPr>`), 'NEWPARA'],
    ['a deleted paragraph', suggestion(`<w:del ${TRACKED}>${deleted('GONEPARA')}</w:del>`, `<w:rPr><w:del ${TRACKED}/></w:rPr>`), '']
  ]
  for (const [name, body, expected] of cases) {
    const { md, notes } = await convert([heading, body, p(['Last'])])
    assert.equal(md, (expected ? expected + '\n\n' : '') + 'Last\n', name)
    assert.deepEqual(notes.todo, [SUGGESTED], name)
  }
  // no suggestions, no to-do: table borders have elements that start the same way (w:insideH)
  const borders = '<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  assert.deepEqual((await convert([heading, borders, p(['Last'])])).notes.todo, [])
})

test('comments never reach the post, and say nothing', async () => {
  const commented = suggestion('<w:commentRangeStart w:id="0"/>' + run_('COMMENTED') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' + run_(' after'))
  const { md, notes } = await convert([heading, commented, p(['Last'])], { comments: { 0: 'COMMENTTEXT secret, to the author only' } })
  assert.equal(md, 'COMMENTED after\n\nLast\n')
  assert.deepEqual(notes, { todo: [], did: [] })
  // and a comment that is a reply, on a suggestion, in a doc with both
  const both = await convert([heading, suggestion('<w:commentRangeStart w:id="0"/>' + `<w:ins ${TRACKED}>${run_('INSERTED')}</w:ins>` + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>')], { comments: { 0: 'COMMENTTEXT' } })
  assert.doesNotMatch(both.md, /COMMENTTEXT/)
  assert.deepEqual(both.notes.todo, [SUGGESTED])
})

test('a style map embedded in the Word file is not used', async () => {
  const text = (embeddedStyleMap?: string) => convert([heading, p(['Plain paragraph.']), p(['A section'], 'Heading2')], { embeddedStyleMap })
  assert.equal((await text("p => h3:fresh\np[style-name='heading 2'] => script")).md, (await text()).md)
  // and it would have been used, if it were read
  const direct = await import('mammoth')
  const mapped = await direct.default.convertToHtml({ buffer: docx({ body: [p(['Plain paragraph.'])], embeddedStyleMap: 'p => h3:fresh' }) }, {})
  assert.match(mapped.value, /<h3>/, 'mammoth does read it unless told not to')
})

test('a picture that links to a file on the disk is not read', async () => {
  const outside = path.join(tmp(), 'secret.png')
  fs.writeFileSync(outside, png(9))
  const linked = '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="3" name="linked"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:link="rLink"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  const converted = await convertDocx(docx({ links: { rLink: outside }, body: [heading, p(['text']), linked] }))
  assert.equal(converted.pictures.length, 0, 'the file on the disk isn’t read')
  assert.ok(converted.notes.todo.length > 0, 'and it is said, as something to do')
})

// ---------------------------------------------------------------------------------------------------------
// the Markdown

test('the Markdown has no raw HTML or MDX: any `<` that isn’t an http, https or mailto autolink is written &lt;, outside code', () => {
  const fixed = (text: string) => finalMarkdown(text).trimEnd()
  assert.equal(fixed('<div onclick="x">hi</div>'), '&lt;div onclick="x">hi&lt;/div>')
  assert.equal(fixed('a <!-- hidden --> b'), 'a &lt;!-- hidden --> b')
  assert.equal(fixed('<script>alert(1)</script>'), '&lt;script>alert(1)&lt;/script>')
  assert.equal(fixed('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)>')
  assert.equal(fixed('<javascript:alert(1)>'), '&lt;javascript:alert(1)>')
  assert.equal(fixed('<data:text/html,x>'), '&lt;data:text/html,x>')
  assert.equal(fixed('<a@b.c>'), '&lt;a@b.c>')
  assert.equal(fixed('See <https://example.org/a_b> and <mailto:a@example.org>.'), 'See <https://example.org/a_b> and <mailto:a@example.org>.')
  assert.equal(fixed('\\<script\\> is escaped already'), '\\<script\\> is escaped already')
  assert.equal(fixed('\\\\<script>'), '\\\\&lt;script>', 'an escaped backslash doesn’t escape the <')
  assert.equal(fixed('`<b>` stays in code, <i> not'), '`<b>` stays in code, &lt;i> not')
  assert.equal(fixed('```html\n<script>x</script>\n```\n\n<p>after</p>'), '```html\n<script>x</script>\n```\n\n&lt;p>after&lt;/p>')
  assert.equal(fixed('````\n```\n<b>\n````\n<b>'), '````\n```\n<b>\n````\n&lt;b>', 'a longer fence isn’t closed by a shorter one')
})

test('the Markdown has no import or export lines outside code, and no runs of blank lines', () => {
  const ctx = { notes: { todo: [] as string[], did: [] as string[] } }
  const md = finalMarkdown('One\n\nimport Evil from "../evil.astro"\n\n  export const x = 1\n\nexport default Foo\n\nimport "x"\n\nExport controls and import duties.\n\n```js\nimport a from "b"\n```\n\n\n\n\nTwo\n', ctx)
  assert.equal(md, 'One\n\nExport controls and import duties.\n\n```js\nimport a from "b"\n```\n\nTwo\n')
  assert.deepEqual([ctx.notes.todo.length, ctx.notes.did.length], [0, 1], 'what the import did, not something to do')
})

test('the frontmatter is YAML that holds exactly what it was given, whatever it holds', () => {
  const hostile = ['---', 'title: pwned', '# x: "y" \'z\' {a} [b] *c* & !tag <i> | > %', '', ': ', '- item', 'a: &anchor b', 'layout: ../../evil.astro', 'é ☃ 日本']
  for (const title of ['--- \nlayout: ../../evil.astro\n---', hostile.join('\n'), '"', "'", '&a *a', '!!js/function "x"', 'null', 'yes', '2026-11-25', '0x1F', '{', '[', '%YAML 1.1', '> folded', '- x', '#c']) {
    const clean = oneLine(title, LIMITS.titleChars)
    const text = frontmatter({ title: clean, date: '2026-11-25', description: oneLine(title, 300), authors: [clean, 'Ada'] }) + '\nBody\n'
    assert.match(text, /^---\n/)
    const end = text.indexOf('\n---\n', 3)
    const parsed = load(text.slice(4, end)) as Record<string, unknown>
    assert.deepEqual(Object.keys(parsed), ['layout', 'title', 'date', 'description', 'authors'], title)
    assert.equal(parsed.layout, '../../layouts/Post.astro')
    assert.equal(parsed.title, clean)
    assert.equal(parsed.description, clean)
    assert.deepEqual(parsed.authors, [clean, 'Ada'])
    assert.equal(String(parsed.date), '2026-11-25')
    assert.equal(text.slice(end + 5), '\nBody\n', 'nothing after the closing line is the YAML’s')
    assert.equal(text.split('\n').filter(line => line === '---').length, 2, 'only the two marker lines')
  }
})

test('slugs: lowercase ASCII and hyphens, short, cut at a word', () => {
  assert.equal(slugify('Digital ID: What’s new?'), 'digital-id-whats-new')
  assert.equal(slugify('Mapping instant payments: Pix, UPI, and the rest of us'), 'mapping-instant-payments-pix-upi')
  assert.equal(slugify('Café Müller & Søn — 日本'), 'cafe-muller-and-son')
  assert.equal(slugify('日本語'), 'post')
  assert.equal(slugify('日本語', 'post-abc'), 'post-abc')
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd')
  assert.equal(slugify('a'.repeat(100)).length, LIMITS.slugChars)
  assert.ok(slugify('word '.repeat(30)).length <= LIMITS.slugChars)
})

test('the pull request body: values from the doc and the issue are code, and the marker is for the workflow', () => {
  const body = pullRequestBody({
    action: 'import', slug: 'a-post', branch: 'blog-k3f9', title: 'Hi `@everyone` [x](https://evil.example) <script>', date: '2026-11-25', dateDefaulted: true,
    authors: ['@octocat', 'Ada'], description: '`` code', files: [], images: 2, notes: { todo: ['Image 3 was left out. In the doc, replace it.'], did: ['The title is `x`.'] },
    preview: 'https://blog-k3f9.dpi-map.pages.dev/blog/a-post/', prTitle: 'Blog: x'
  }, 42)
  assert.match(body, /^- Title: ``Hi `@everyone` \[x\]\(https:\/\/evil.example\) <script>``$/m)
  assert.match(body, /^- Authors: `@octocat`, `Ada`$/m)
  assert.match(body, /^- Date: `2026-11-25`$/m)
  assert.doesNotMatch(body, /the day this pull request was opened/)
  assert.match(body, /https:\/\/blog-k3f9\.dpi-map\.pages\.dev\/blog\/a-post\//)
  assert.match(body, /adds a commit to this branch/)
  assert.doesNotMatch(body, /aren’t kept|again from the doc/)
  assert.match(body, /### To do before merging\n\nFix these in the doc, then edit the doc and comment `\/update` on #42\./)
  assert.match(body, /\n- Image 3 was left out\. In the doc, replace it\.\n/)
  assert.match(body, /\n<details><summary>Import notes<\/summary>\n\n- The title is `x`\.\n\n<\/details>\n/)
  assert.doesNotMatch(pullRequestBody({ action: 'import', slug: 'a', branch: 'blog-k3f9', title: 'T', date: '2026-11-25', dateDefaulted: false, authors: ['A'], files: [], images: 0, notes: { todo: [], did: [] }, preview: 'https://x', prTitle: 'x' }), /Import notes|To do before merging/, 'neither section when there is nothing')
  assert.doesNotMatch(body, /made up|from the caption/)
  assert.match(body, /\n<!-- blog-import-issue: 42 slug: a-post -->\n$/)
  assert.equal(body.match(/<!--/g)?.length, 1, 'only the marker')
})

// ---------------------------------------------------------------------------------------------------------
// a whole Word file, to the post and its images

const run = async (file: Buffer, options: { authors?: string, date?: string, description?: string, slug?: string, branch?: string, root?: string, issue?: number } = {}) => {
  const root = options.root ?? tmp()
  const input = path.join(tmp(), 'doc.docx')
  fs.writeFileSync(input, file)
  const result = await importDocx({ docx: input, authors: options.authors ?? 'Ada Lovelace', date: options.date, description: options.description, defaultDate: '2026-11-25', slug: options.slug, branch: options.branch, root, issue: options.issue })
  return { result, root, read: (name: string) => fs.readFileSync(path.join(root, name)) }
}
const tree_ = (root: string): string[] => fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.relative(root, path.join(e.parentPath, e.name))).sort()

test('the fixture, a Word file made like a Google Doc, becomes the post it should', async () => {
  const { result, root, read } = await run(fs.readFileSync(path.join(scripts, 'fixtures/blog-import/sample.docx')), { authors: 'Ada Lovelace; Grace Hopper', description: 'What we learned.' })
  assert.equal(result.slug, 'digital-id-in-practice-what-we-learned')
  assert.match(result.branch, /^blog-[a-z0-9]{4}$/, 'a short random branch, not the slug')
  assert.equal(result.preview, `https://${result.branch}.dpi-map.pages.dev/blog/digital-id-in-practice-what-we-learned/`)
  assert.equal(read('src/pages/blog/digital-id-in-practice-what-we-learned.md').toString(), fs.readFileSync(path.join(scripts, 'fixtures/blog-import/sample.expected.md'), 'utf8'))
  assert.deepEqual(tree_(root), [
    'public/blog/digital-id-in-practice-what-we-learned/image-1.png',
    'public/blog/digital-id-in-practice-what-we-learned/image-2.png',
    'public/blog/digital-id-in-practice-what-we-learned/image-3.gif',
    'src/pages/blog/digital-id-in-practice-what-we-learned.md'
  ])
  assert.deepEqual([...result.files].sort(), tree_(root), 'the result lists the files written')
  assert.deepEqual([result.date, result.dateDefaulted], ['2026-11-25', true])
  assert.deepEqual(result.notes.todo.map(n => n.slice(0, 22)), ['`image-2.png` has no a', '`image-3.gif` has no a'], 'image 1 has its alt text from the doc')
  assert.equal(result.prTitle, 'Blog: Digital ID in practice: what we learned')
  assert.match(result.prBody, /### To do before merging\n[\s\S]*`image-2\.png` has no alt text[\s\S]*<details><summary>Import notes<\/summary>/)
})

test('the post’s file is frontmatter and body from one function, the one the preview shows', async () => {
  const { result, read } = await run(sample(), { authors: 'Ada Lovelace', date: '2026-03', description: 'What we learned.' })
  const converted = await convertDocx(sample())
  const body = toMarkdown(converted, name => `/blog/${result.slug}/${name}`)
  const file = postFile({ title: converted.title, date: '2026-03', description: 'What we learned.', authors: ['Ada Lovelace'] }, body)
  assert.equal(read(`src/pages/blog/${result.slug}.md`).toString(), file)
  assert.match(file, /^---\nlayout: \.\.\/\.\.\/layouts\/Post\.astro\ntitle: "Digital ID in practice: what we learned"\ndate: 2026-03\ndescription: What we learned\.\nauthors:\n  - Ada Lovelace\n---\n\n/)
})

test('the cleaning, on what Google Docs writes: a glued caption, redirect links, emphasised addresses, escapes, a table', async () => {
  const md = (await run(sample())).read('src/pages/blog/digital-id-in-practice-what-we-learned.md').toString()
  assert.doesNotMatch(md, /google\.com\/url/, 'Google’s redirect is unwrapped')
  assert.match(md, /\[second page\]\(https:\/\/example\.org\/real-page\?a=1\)/)
  assert.match(md, /Available at: <https:\/\/example\.org\/paper> and <http:\/\/example\.org\/Docs>\./, 'an emphasised address is an autolink')
  assert.doesNotMatch(md, /\[\*https/)
  assert.match(md, /!\[A chart of the first section\.\]\(\/blog\/digital-id-in-practice-what-we-learned\/image-1\.png\)/, 'the doc’s own alt text is kept')
  assert.match(md, /\*\*Figure 2\*\*: A diagram of the process\.\n\n!\[\]\(\/blog\/digital-id-in-practice-what-we-learned\/image-2\.png\)\n/, 'the image is its own paragraph')
  assert.match(md, /^\\- A line that starts with a dash is not a list\.$/m, 'the escape Markdown needs is kept')
  assert.doesNotMatch(md, /\n\n\n/)
  assert.doesNotMatch(md, /^# /m, 'no h1: the layout writes the title')
  assert.doesNotMatch(md, /^## *$/m, 'no empty heading')
  assert.doesNotMatch(md, /\/(private|var|tmp)\//, 'no absolute paths')
  assert.doesNotMatch(md.slice(md.indexOf('\n---\n', 3)), /Digital ID in practice: what we learned/, 'the title is in the frontmatter only')
})

test('the date is the issue’s, else the day the pull request is opened', async () => {
  const dated = (await run(sample(), { date: '2026-03' })).result
  assert.deepEqual([dated.date, dated.dateDefaulted], ['2026-03', false])
  assert.equal((await run(sample())).result.dateDefaulted, true)
  await assert.rejects(run(sample(), { date: 'yesterday' }), Refusal)
})

test('a hostile Word file makes safe output: no HTML, no script links, no MDX, a safe title, only real images', async () => {
  const { p, link, image } = x
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
  const huge = Buffer.concat([png(4), Buffer.alloc(LIMITS.imageBytes + 1)])
  const file = docx({
    links: { j: 'javascript:alert(1)', d: 'data:text/html,<script>alert(1)</script>', f: 'file:///etc/passwd', g: 'https://www.google.com/url?q=javascript:alert(2)&sa=D', m: 'mailto:a@example.org', ok: 'https://example.org/ok' },
    media: {
      i1: { name: 'image1.png', bytes: svg }, i2: { name: '../../evil.png', bytes: png(4) }, i3: { name: 'image3.png', bytes: huge },
      i4: { name: 'image4.png', bytes: Buffer.from('MZ\x90\x00 an executable') }, i5: { name: 'image5.svg', bytes: png(5) }
    },
    body: [
      p(['---\ntitle: pwned\nlayout: ../../evil.astro\n# x: "y" \'z\' {a} [b] *c* & <i> | > %'], 'Heading1'),
      p(['<script>alert(1)</script> <!-- hidden --> <img src=x onerror=alert(1)> <https://evil.example/x> <div onclick="x">']),
      p(['import Evil from "../evil.astro"']),
      p(['export const x = 1']),
      p(['Export controls and import duties are discussed.']),
      p(['A ', link('j', 'js link'), ' ', link('d', 'data link'), ' ', link('f', 'file link'), ' ', link('g', 'google js'), ' ', link('m', 'mail link'), ' ', link('ok', 'fine')]),
      p([image('i1'), image('i2'), image('i3'), image('i4'), image('i5')]),
      p(['{props.x} <Component client:load />'])
    ]
  })
  const { result, root, read } = await run(file, { authors: 'Mallory\n---\nlayout: x', description: 'a\nb: c\n---' })
  const text = read(`src/pages/blog/${result.slug}.md`).toString()
  const end = text.indexOf('\n---\n', 3)
  const front = load(text.slice(4, end)) as Record<string, unknown>
  assert.deepEqual(Object.keys(front), ['layout', 'title', 'date', 'description', 'authors'])
  assert.equal(front.layout, '../../layouts/Post.astro')
  assert.equal(front.title, '--- title: pwned layout: ../../evil.astro # x: "y" \'z\' {a} [b] *c* & <i> | > %')
  assert.deepEqual(front.authors, ['Mallory', '---', 'layout: x'])
  assert.equal(front.description, 'a b: c ---')
  const body = text.slice(end + 5)
  assert.doesNotMatch(body.replace(/\\</g, ''), /<(?!https?:|mailto:)/, 'no tag or comment that isn’t escaped')
  assert.doesNotMatch(body, /javascript:|data:text|file:\/\/|vbscript:/i)
  assert.doesNotMatch(body, /^\s*(import|export) \S+.* (from )?["']/m)
  assert.match(body, /Export controls and import duties are discussed\./)
  assert.match(body, /\[mail link\]\(mailto:a@example\.org\)/)
  assert.match(body, /\[fine\]\(https:\/\/example\.org\/ok\)/)
  assert.match(body, /A js link data link file link google js /, 'the other links are their text')
  // the images: the SVG, the executable and the oversized one are left out, and so is the one whose name has a path out of the Word file; only the PNG called .svg is kept
  assert.deepEqual(result.files.filter(f => f.startsWith('public/')), [`public/blog/${result.slug}/image-1.png`])
  assert.ok(result.notes.todo.some(n => /could not be read from the doc/.test(n)))
  assert.deepEqual(tree_(root), [...result.files].sort(), 'nothing is written but what it lists, and nothing outside the root')
  assert.ok(result.notes.todo.some(n => /only PNG, JPEG, GIF and WebP/.test(n)))
  assert.ok(result.notes.todo.some(n => /larger than 5 MB/.test(n)))
  assert.ok(result.notes.todo.some(n => /address other than http/.test(n)))
  assert.equal(body.match(/!\[/g)?.length, 1)
  assert.doesNotMatch(result.prBody, /<script|javascript:/)
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'evil.png')) && !fs.existsSync(path.join(root, '..', 'evil.png')))
})

test('the images together are limited, and so is their number', async () => {
  const { p, image } = x
  const four = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`i${i}`, { name: `image${i}.png`, bytes: Buffer.concat([png(2 + i), Buffer.alloc(4 * 1024 * 1024)]) }]))
  const { result } = await run(docx({ media: four, body: [p(['Title'], 'Heading1'), p(['Text']), ...Object.keys(four).map(id => p([image(id)]))] }))
  assert.equal(result.images, 3, '4 MB each, 15 MB in total')
  assert.ok(result.notes.todo.some(n => /together would be larger than 15 MB/.test(n)))
  const many = Object.fromEntries(Array.from({ length: LIMITS.images + 2 }, (_, i) => [`i${i}`, { name: `image${i}.png`, bytes: png(2 + (i % 5), [i, 0, 0]) }]))
  const second = await run(docx({ media: many, body: [p(['Title'], 'Heading1'), p(['Text']), ...Object.keys(many).map(id => p([image(id)]))] }))
  assert.equal(second.result.images, LIMITS.images)
})

test('a zip bomb, something that isn’t a Word file, and a doc with no title or no text are refused, and nothing is written', async () => {
  const { p } = x
  const root = tmp()
  await assert.rejects(run(docx({ body: [p(['T'], 'Heading1'), p(['x'])], zip: { declaredSize: LIMITS.zipBytes + 1 } }), { root }), Refusal)
  await assert.rejects(run(Buffer.from('<html><body>Sign in</body></html>'), { root }), Refusal)
  await assert.rejects(run(docx({ body: [p(['No heading, only text'])] }), { root }), /no Heading 1/)
  await assert.rejects(run(docx({ body: [p(['Only a title'], 'Heading1')] }), { root }), /no text/)
  await assert.rejects(run(sample(), { root, authors: '' }), Refusal)
  assert.deepEqual(tree_(root), [])
})

test('a slug that is already a page, a post, an entry’s landing page or a folder of images is refused, and nothing is overwritten', async () => {
  const slug = 'digital-id-in-practice-what-we-learned'
  for (const taken of [`src/pages/blog/${slug}.md`, `src/pages/blog/${slug}.mdx`, `src/content/links/${slug}.md`, `public/blog/${slug}/x.png`]) {
    const root = tmp()
    fs.mkdirSync(path.dirname(path.join(root, taken)), { recursive: true })
    fs.writeFileSync(path.join(root, taken), 'existing')
    assert.ok(slugTaken(slug, root), taken)
    await assert.rejects(run(sample(), { root }), /already a post or page/, taken)
    await assert.rejects(run(sample(), { root, slug }), /already a post or page/, `${taken}, with the slug kept`)
    assert.equal(fs.readFileSync(path.join(root, taken), 'utf8'), 'existing')
  }
  assert.equal(slugTaken('index', tmp()), true)
  assert.equal(slugTaken('[id]', tmp()), true)
  await assert.rejects(run(sample(), { slug: '../x' }), Refusal)
  await assert.rejects(run(sample(), { slug: 'Not-Valid' }), Refusal)
  assert.equal((await run(sample(), { slug: 'kept-slug' })).result.slug, 'kept-slug', 'the slug of an existing pull request is kept, whatever the title now says')
})

test('the branch is blog- and 4 random letters or digits, kept when given', async () => {
  const names = new Set(Array.from({ length: 200 }, randomBranch))
  assert.ok([...names].every(name => BRANCH.test(name)))
  assert.ok(names.size > 150, 'they differ')
  assert.equal((await run(sample(), { branch: 'blog-k3f9' })).result.branch, 'blog-k3f9')
  assert.match((await run(sample(), { branch: 'blog-k3f9' })).result.preview, /^https:\/\/blog-k3f9\.dpi-map\.pages\.dev\/blog\/digital-id-in-practice-what-we-learned\/$/)
  for (const bad of ['blog-k3f', 'blog-k3f9x', 'blog-K3F9', 'main', 'blog-k3f9/../x', 'blog-digital-id']) await assert.rejects(run(sample(), { branch: bad }), Refusal, bad)
  // written to a folder of its own, and checked against the repository
  const [root, out] = [tmp(), tmp()]
  const input = path.join(tmp(), 'doc.docx')
  fs.writeFileSync(input, sample())
  const { files } = await importDocx({ docx: input, authors: 'Ada', defaultDate: '2026-11-25', root, out })
  assert.deepEqual(tree_(out), [...files].sort())
  assert.deepEqual(tree_(root), [])
})

// ---------------------------------------------------------------------------------------------------------
// the preview page's parts (/blog/new/)

test('preview: the browser’s fetch asks for the export with no cookies, and says what is wrong when it can’t have it', async () => {
  const seen: RequestInit[] = []
  const answer = (body: BodyInit | null, init: ResponseInit & { url?: string } = {}) => async (_url: string | URL | Request, request?: RequestInit) => {
    seen.push(request ?? {})
    const response = new Response(body, { status: 200, ...init })
    if (init.url) Object.defineProperty(response, 'url', { value: init.url })
    return response
  }
  const kind = async (fetcher: typeof fetch) => (await fetchDocxInBrowser(ID, { fetch: fetcher }).catch(e => e) as PreviewProblem).kind
  assert.deepEqual([...await fetchDocxInBrowser(ID, { fetch: answer('PKxx', { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }) as typeof fetch })], [80, 75, 120, 120])
  assert.equal(seen[0].credentials, 'omit')
  assert.equal(seen[0].referrerPolicy, 'no-referrer')
  assert.equal(await kind(answer('x', { status: 404 }) as typeof fetch), 'not-found')
  assert.equal(await kind(answer('x', { status: 403 }) as typeof fetch), 'not-shared')
  assert.equal(await kind(answer('x', { status: 500 }) as typeof fetch), 'other')
  assert.equal(await kind(answer('<html>sign in', { headers: { 'content-type': 'text/html; charset=utf-8' } }) as typeof fetch), 'not-shared')
  assert.equal(await kind(answer('PK', { url: 'https://accounts.google.com/ServiceLogin?x' }) as typeof fetch), 'not-shared')
  assert.equal(await kind((async () => { throw new TypeError('Load failed') }) as typeof fetch), 'unreachable', 'a CORS or network failure')
  const big = await fetchDocxInBrowser(ID, { fetch: answer('x'.repeat(500)) as typeof fetch, maxBytes: 100 }).catch(e => e)
  assert.equal(big.kind, 'too-large')
  const slow = await fetchDocxInBrowser(ID, { fetch: ((_: unknown, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch, timeoutMs: 30 }).catch(e => e)
  assert.equal(slow.kind, 'timeout')
  const controller = new AbortController()
  const cancelled = fetchDocxInBrowser(ID, { fetch: ((_: unknown, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch, signal: controller.signal })
  controller.abort()
  assert.equal((await cancelled.catch(e => e)).kind, 'cancelled')
  assert.equal((await fetchDocxInBrowser('../x').catch(e => e)).kind, 'other')
})

test('preview: the form’s problems, and the link to the prefilled issue form', () => {
  const repository = 'https://github.com/o/r'
  const good = { doc: `https://docs.google.com/document/d/${ID}/edit?usp=sharing`, authors: 'Ada Lovelace, Grace Hopper', date: '2026-12-01', description: 'One line.' }
  assert.deepEqual(fieldProblems(good), {})
  assert.deepEqual(fieldProblems({ doc: '', authors: '', date: '', description: '' }), {}, 'empty fields have no problem until the issue is asked for')
  assert.deepEqual(Object.keys(fieldProblems({ doc: 'https://example.org/x', authors: Array.from({ length: 21 }, (_, i) => `A${i}`).join(','), date: 'soon', description: '' })), ['doc', 'authors', 'date'])
  const url = new URL(issueUrl(repository, good, 'A title: with a colon')!)
  assert.equal(url.origin + url.pathname, 'https://github.com/o/r/issues/new')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    template: 'blog-post.yml', title: 'Blog post: A title: with a colon', doc: `https://docs.google.com/document/d/${ID}/edit`, authors: 'Ada Lovelace, Grace Hopper', date: '2026-12-01', description: 'One line.'
  })
  assert.deepEqual(Object.keys(Object.fromEntries(new URL(issueUrl(repository, { ...good, date: '', description: '' })!).searchParams)), ['template', 'doc', 'authors'], 'optional fields left out')
  assert.equal(issueUrl(repository, { ...good, authors: '' }), undefined)
  assert.equal(issueUrl(repository, { ...good, doc: 'https://evil.example/' }), undefined)
  assert.equal(issueUrl(repository, { ...good, date: 'x' }), undefined)
  // every parameter is a field of the template, so GitHub fills it in
  const template = load(fs.readFileSync(path.join(scripts, '../.github/ISSUE_TEMPLATE/blog-post.yml'), 'utf8')) as any
  const ids = template.body.filter((item: any) => item.id).map((item: any) => item.id)
  for (const key of url.searchParams.keys()) assert.ok(key === 'template' || key === 'title' || ids.includes(key), key)
})

test('preview: the Markdown is rendered as the site does, and nothing in it runs', async () => {
  const html = await renderPost('## A section\n\nText with “quotes”, a footnote[^1], and ![Alt](blob:http://localhost:4323/abc).\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[^1]: The note.\n')
  assert.match(html, /<h2 id="a-section">A section<\/h2>/)
  assert.match(html, /<img src="blob:http:\/\/localhost:4323\/abc" alt="Alt">/)
  assert.match(html, /<table>/)
  assert.match(html, /<section data-footnotes class="footnotes">/)
  const hostile = await renderPost('[x](javascript:alert(1)) <script>alert(1)</script> <img src=x onerror=alert(1)> ![y](javascript:alert(2)) <div onclick="x">z</div>')
  assert.doesNotMatch(hostile, /javascript:|<script|onerror|onclick|<img src="x"/)
})

// ---------------------------------------------------------------------------------------------------------
// the workflow's push step, run as shell against a local bare repository standing in for GitHub

const workflow = load(fs.readFileSync(path.join(scripts, '../.github/workflows/blog-import.yml'), 'utf8')) as any
const pushScript: string = workflow.jobs['blog-import'].steps.find((step: any) => step.id === 'push').run
const tools = spawnSync('git', ['--version']).status === 0 && spawnSync('jq', ['--version']).status === 0 && spawnSync('bash', ['--version']).status === 0

test('the workflow never forces a push: no force flag, no leased or forced refspec, one plain push', async () => {
  const text = fs.readFileSync(path.join(scripts, '../.github/workflows/blog-import.yml'), 'utf8')
  assert.doesNotMatch(text, /--force|force-with-lease|--mirror|--delete|--prune|\+refs|\+HEAD|\+"|push[^\n]* -f\b|reset --hard|update-ref -d refs\/heads/)
  const pushes = text.split('\n').filter(line => /\bgit\b.*\bpush\b/.test(line) && !line.trim().startsWith('#'))
  assert.equal(pushes.length, 1)
  assert.match(pushes[0], /git -c core\.hooksPath=\/dev\/null push --quiet "\$remote" "HEAD:\$\{ref\}"; then$/)
  assert.match(pushScript, /refs\/heads\/blog-\[a-z0-9\]\{4\}/, 'the branch pattern')
})

const SLUG_ = 'digital-id-in-practice-what-we-learned'
const BOT = '41898282+github-actions[bot]@users.noreply.github.com'
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** A bare "origin" with a main branch, and what the workflow does around the push step */
function world () {
  const dir = tmp()
  const origin = path.join(dir, 'origin.git')
  fs.mkdirSync(origin)
  git(origin, 'init', '--quiet', '--bare', '--initial-branch=main')
  const seed = path.join(dir, 'seed')
  git(dir, 'clone', '--quiet', origin, seed)
  fs.mkdirSync(path.join(seed, 'src/pages/blog'), { recursive: true })
  fs.writeFileSync(path.join(seed, 'README.md'), 'site\n')
  fs.writeFileSync(path.join(seed, 'src/pages/blog/index.astro'), 'x\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '--quiet', '-m', 'init')
  git(seed, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')
  let n = 0
  /** A step's run: a new checkout of main, the doc converted into the out folder, then the push step. */
  const step = async (file: Buffer, options: { existing?: string, branch?: string, edit?: (result: any) => void, dirty?: boolean } = {}) => {
    const id = ++n
    const work = path.join(dir, `work${id}`)
    const out = path.join(dir, `out${id}`)
    git(dir, 'clone', '--quiet', origin, work)
    const input = path.join(dir, `doc${id}.docx`)
    fs.writeFileSync(input, file)
    const result = await importDocx({ docx: input, authors: 'Ada', defaultDate: '2026-11-25', slug: options.existing ? SLUG_ : undefined, branch: options.branch ?? 'blog-k3f9', root: work, out, issue: 12 })
    options.edit?.(result)
    const resultFile = path.join(dir, `result${id}.json`)
    fs.writeFileSync(resultFile, JSON.stringify(result))
    if (options.dirty) fs.writeFileSync(path.join(work, 'stray.txt'), 'x')
    const script = pushScript.replace('remote="https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git"', 'remote="$REMOTE_PATH"')
    assert.notEqual(script, pushScript, 'the remote is replaced by the local one')
    const outputs = path.join(dir, `outputs${id}.txt`)
    fs.writeFileSync(outputs, '')
    const ran = spawnSync('bash', ['-c', script], {
      cwd: work, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, TOKEN: 'secret', RESULT: resultFile, OUT: out, BASE: 'main', EXISTING: options.existing ?? '', ISSUE: '12', GITHUB_OUTPUT: outputs, GITHUB_REPOSITORY: 'o/r', REMOTE_PATH: origin, RETRY_PAUSE: '0' }
    })
    const found = Object.fromEntries(fs.readFileSync(outputs, 'utf8').split('\n').filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
    return { status: ran.status, log: ran.stdout + ran.stderr, outputs: found as Record<string, string>, work }
  }
  const tip = (branch = 'blog-k3f9') => spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: origin, encoding: 'utf8' }).stdout.trim()
  const commits = (branch = 'blog-k3f9') => git(origin, 'log', '--reverse', '--format=%H|%ae|%ce|%P|%s', `main..${branch}`).split('\n').filter(Boolean).map(line => { const [sha, author, committer, parents, subject] = line.split('|'); return { sha, author, committer, parents: parents.split(' ').filter(Boolean), subject } })
  const changes = (sha: string) => git(origin, 'diff', '--no-renames', '--name-status', `${sha}~1`, sha).split('\n').sort()
  /** a commit pushed to the branch directly, as a person (or a bot, with `by`) would */
  const push = (message: string, files: Record<string, string>, by = { name: 'Someone', email: 'someone@example.org' }, branch = 'blog-k3f9', to = branch) => {
    const clone = path.join(dir, `clone${++n}`)
    git(dir, 'clone', '--quiet', '--branch', branch, origin, clone)
    for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(clone, file)), { recursive: true }); fs.writeFileSync(path.join(clone, file), content) }
    git(clone, 'add', '-A')
    spawnSync('git', ['-c', `user.name=${by.name}`, '-c', `user.email=${by.email}`, 'commit', '--quiet', '--allow-empty', '-m', message], { cwd: clone, encoding: 'utf8' })
    git(clone, 'push', '--quiet', 'origin', `HEAD:refs/heads/${to}`)
  }
  return { dir, origin, step, tip, commits, changes, push }
}

// a Word file with the same title and one image, for an update that drops two of the fixture's three
const shorter = () => docx({
  media: { rIdImg1: { name: 'image3.png', bytes: png(5, [10, 10, 10]) } },
  body: [x.p(['Digital ID in practice: what we learned'], 'Heading1'), x.p(['A shorter second version.']), x.p([x.image('rIdImg1')]), x.p([{ text: 'Figure 1', bold: true }, ': A new chart.'])]
})

test('the push step: a first import makes the branch from main with one commit by the bot, of just the post and its images', { skip: !tools }, async () => {
  const w = world()
  const main = git(w.origin, 'rev-parse', 'main')
  const first = await w.step(sample())
  assert.equal(first.status, 0, first.log)
  assert.equal(first.outputs.pushed, 'true')
  const commits = w.commits()
  assert.equal(commits.length, 1)
  assert.deepEqual(commits[0].parents, [main], 'on top of main')
  assert.deepEqual([commits[0].author, commits[0].committer], [BOT, BOT])
  assert.equal(commits[0].subject, `blog: add ${SLUG_} from a Google Doc (#12)`)
  assert.deepEqual(w.changes(commits[0].sha), [
    `A\tpublic/blog/${SLUG_}/image-1.png`, `A\tpublic/blog/${SLUG_}/image-2.png`, `A\tpublic/blog/${SLUG_}/image-3.gif`, `A\tsrc/pages/blog/${SLUG_}.md`
  ])
  assert.equal(git(w.origin, 'rev-parse', 'main'), main, 'main isn’t touched')
})

test('the push step: an update adds a second commit on top of the first, replacing the post and removing the images that are gone', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  const [first] = w.commits()
  const update = await w.step(shorter(), { existing: '5' })
  assert.equal(update.status, 0, update.log)
  assert.equal(update.outputs.pushed, 'true')
  const commits = w.commits()
  assert.equal(commits.length, 2)
  assert.equal(commits[0].sha, first.sha, 'the first commit is as it was: nothing rewritten')
  assert.deepEqual(commits[1].parents, [first.sha], 'one parent: the branch’s tip as it was')
  assert.deepEqual([commits[1].author, commits[1].committer], [BOT, BOT])
  assert.equal(commits[1].subject, `blog: update ${SLUG_} from the Google Doc (#12)`)
  assert.deepEqual(w.changes(commits[1].sha), [
    `D\tpublic/blog/${SLUG_}/image-2.png`, `D\tpublic/blog/${SLUG_}/image-3.gif`, `M\tpublic/blog/${SLUG_}/image-1.png`, `M\tsrc/pages/blog/${SLUG_}.md`
  ])
  assert.match(git(w.origin, 'show', `blog-k3f9:src/pages/blog/${SLUG_}.md`), /A shorter second version/)
  assert.deepEqual(git(w.origin, 'ls-tree', '-r', '--name-only', 'blog-k3f9', `public/blog/${SLUG_}`).split('\n'), [`public/blog/${SLUG_}/image-1.png`])
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', first.sha, 'blog-k3f9'], { cwd: w.origin }).status, 0, 'a fast-forward')
})

test('the push step: an update with nothing changed adds no commit and says so', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  const before = w.tip()
  const again = await w.step(sample(), { existing: '5' })
  assert.equal(again.status, 0, again.log)
  assert.equal(again.outputs.unchanged, 'true')
  assert.equal(again.outputs.pushed, undefined)
  assert.equal(w.tip(), before)
})

const HUMAN = { name: 'Someone', email: 'someone@example.org' }

test('the push step: people’s commits on the branch don’t stop an update: it goes on top of them, and they stay in the history', { skip: !tools }, async () => {
  for (const [label, by, files] of [
    ['a person’s commit', HUMAN, { 'notes.txt': 'hi' }],
    ['a person’s empty commit', HUMAN, {}],
    ['a commit by the bot’s name and a person’s email', { name: 'github-actions[bot]', email: 'someone@example.org' }, {}]
  ] as const) {
    const w = world()
    assert.equal((await w.step(sample())).status, 0)
    w.push('a change', files, by)
    const before = w.commits()
    const update = await w.step(shorter(), { existing: '5' })
    assert.equal(update.status, 0, `${label}: ${update.log}`)
    assert.equal(update.outputs.pushed, 'true', label)
    assert.equal(update.outputs.problem, undefined, label)
    assert.equal(update.outputs.overwritten, undefined, `${label}: nothing of the post was changed, so nothing is said`)
    const after = w.commits()
    assert.equal(after.length, before.length + 1, label)
    assert.deepEqual(after.slice(0, -1), before, `${label}: their commits are as they were`)
    assert.deepEqual(after.at(-1)!.parents, [before.at(-1)!.sha], `${label}: one parent, the tip`)
    assert.match(git(w.origin, 'show', `blog-k3f9:src/pages/blog/${SLUG_}.md`), /A shorter second version/)
  }
})

test('the push step: a person’s merge of main into the branch is accepted too', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  // main moves on, and a person merges it into the branch
  const main = path.join(w.dir, 'mainclone')
  git(w.dir, 'clone', '--quiet', '--branch', 'main', w.origin, main)
  fs.writeFileSync(path.join(main, 'news.txt'), 'x')
  git(main, 'add', '-A')
  git(main, 'commit', '--quiet', '-m', 'main moves')
  git(main, 'push', '--quiet', 'origin', 'main')
  const clone = path.join(w.dir, 'mergeclone')
  git(w.dir, 'clone', '--quiet', '--branch', 'blog-k3f9', w.origin, clone)
  spawnSync('git', ['-c', `user.name=${HUMAN.name}`, '-c', `user.email=${HUMAN.email}`, 'merge', '--quiet', '--no-ff', '-m', 'merge main', 'origin/main'], { cwd: clone })
  git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/blog-k3f9')
  const merge = w.tip()
  assert.equal(git(w.origin, 'rev-list', '--parents', '-n', '1', merge).split(' ').length, 3, 'a merge')
  const update = await w.step(shorter(), { existing: '5' })
  assert.equal(update.status, 0, update.log)
  assert.equal(update.outputs.pushed, 'true')
  assert.deepEqual(w.commits().at(-1)!.parents, [merge], 'one parent: the merge, the tip')
  assert.equal(update.outputs.overwritten, undefined)
})

test('the push step: an update that replaces a person’s changes to the post says which, and where they still are', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  const bot = w.tip()
  w.push('fix a typo', { [`src/pages/blog/${SLUG_}.md`]: 'A person’s version.\n' })
  const typo = git(w.origin, 'rev-parse', '--short', w.tip())
  w.push('and an image', { [`public/blog/${SLUG_}/image-1.png`]: 'not really a png' })
  const image = git(w.origin, 'rev-parse', '--short', w.tip())
  w.push('and a note', { 'notes.txt': 'hi' })
  const update = await w.step(shorter(), { existing: '5' })
  assert.equal(update.status, 0, update.log)
  assert.equal(update.outputs.pushed, 'true')
  assert.equal(update.outputs.overwritten, `This update replaced changes made on the branch to \`public/blog/${SLUG_}/image-1.png\`, \`src/pages/blog/${SLUG_}.md\` since the last import (still in the history: ${image}, ${typo}).`)
  for (const sha of [typo, image]) assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', sha, 'blog-k3f9'], { cwd: w.origin }).status, 0, `${sha} is still in the branch's history`)
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', bot, 'blog-k3f9'], { cwd: w.origin }).status, 0)
  assert.match(git(w.origin, 'show', `blog-k3f9:src/pages/blog/${SLUG_}.md`), /A shorter second version/, 'the doc’s version is the post again')
  // a second update with the doc as it was: the person's changes are the bot's own now, and nothing is said again
  const again = await w.step(shorter(), { existing: '5' })
  assert.equal(again.outputs.unchanged, 'true')
  // a person's change to something else in the folder isn't touched, nor said
  w.push('an extra file', { [`public/blog/${SLUG_}/diagram.svg`]: '<svg/>' })
  const extra = await w.step(sample(), { existing: '5' })
  assert.equal(extra.status, 0, extra.log)
  assert.equal(extra.outputs.pushed, 'true')
  assert.equal(git(w.origin, 'show', `blog-k3f9:public/blog/${SLUG_}/diagram.svg`), '<svg/>', 'left alone')
  assert.equal(extra.outputs.overwritten, undefined)
})

test('the push step: the branch must be this post’s: not there before a first import, there for an update', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  const before = w.tip()
  const taken = await w.step(sample())
  assert.match(taken.outputs.problem, /already a branch called blog-k3f9/)
  assert.equal(w.tip(), before)
  const missing = await world().step(sample(), { existing: '5' })
  assert.match(missing.outputs.problem, /pull request is #5, but its branch blog-k3f9 is missing/)
  assert.equal(missing.status, 0)
})

test('the push step: a diff outside the post and its images is refused, and nothing is pushed', { skip: !tools }, async () => {
  const refused = async (name: string, options: Parameters<ReturnType<typeof world>['step']>[1], setup?: (w: ReturnType<typeof world>) => void) => {
    const w = world()
    setup?.(w)
    const before = w.tip()
    const ran = await w.step(sample(), options)
    assert.notEqual(ran.status, 0, `${name}: ${ran.log}`)
    assert.equal(ran.outputs.pushed, undefined, name)
    assert.match(ran.log, /Not a blog branch|Not a slug|wrote more than the post|isn't among the files|Not a plain file|isn't clean|changes more than/, `${name}: stopped by one of the guards`)
    assert.equal(w.tip(), before, `${name}: the branch is as it was`)
  }
  // the files the script says it wrote
  await refused('a file elsewhere', { edit: r => { r.files = [...r.files, 'src/pages/index.astro'] } })
  await refused('a workflow', { edit: r => { r.files = [...r.files, '.github/workflows/evil.yml'] } })
  await refused('a path out of the folder', { edit: r => { r.files = [...r.files, `public/blog/${SLUG_}/../../../package.json`] } })
  await refused('a file that isn’t an image', { edit: r => { r.files = [...r.files, `public/blog/${SLUG_}/evil.sh`] } })
  await refused('an image with a long number', { edit: r => { r.files = [...r.files, `public/blog/${SLUG_}/image-123.png`] } })
  await refused('another post', { edit: r => { r.files = [...r.files, 'src/pages/blog/other.md'] } })
  await refused('no post', { edit: r => { r.files = r.files.filter((file: string) => !file.endsWith('.md')) } })
  for (const branch of ['main', 'blog-k3f', 'blog-k3f9x', 'blog-K3F9', 'blog-k3f9/../main', 'blog-digital-id']) await refused(`the branch ${branch}`, { edit: r => { r.branch = branch } })
  for (const slug of ['../x', 'a/b', 'A', '']) await refused(`the slug ${slug}`, { edit: r => { r.slug = slug } })
  // something else in the checkout
  await refused('a stray file in the checkout', { dirty: true })
  // something in the post's folder that isn't an image, made by the bot or by a person: the update leaves it alone, and succeeds
  for (const by of [{ name: 'github-actions[bot]', email: BOT }, HUMAN]) {
    const w = world()
    assert.equal((await w.step(sample())).status, 0)
    w.push('adds a script', { [`public/blog/${SLUG_}/evil.sh`]: '#!/bin/sh' }, by)
    const ran = await w.step(shorter(), { existing: '5' })
    assert.equal(ran.status, 0, ran.log)
    assert.equal(ran.outputs.pushed, 'true')
    assert.equal(git(w.origin, 'show', `blog-k3f9:public/blog/${SLUG_}/evil.sh`), '#!/bin/sh', 'not deleted, not changed')
    assert.deepEqual(w.changes(w.tip()).filter(line => /evil/.test(line)), [], 'the update’s commit doesn’t touch it')
  }
})

test('the push step: a branch that moved is fetched again, checked again, and pushed to again', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  const [first] = w.commits()
  // the bot's own commit, as if another run got there first: kept on a side ref, and moved onto the branch by a hook as the next push arrives, which it rejects
  w.push('another run', {}, { name: 'github-actions[bot]', email: BOT }, 'blog-k3f9', 'side')
  const hook = path.join(w.origin, 'hooks/pre-receive')
  fs.writeFileSync(hook, '#!/bin/sh\nif [ ! -e "$GIT_DIR/tried" ] && grep -q blog-k3f9; then\n  : > "$GIT_DIR/tried"\n  env -u GIT_QUARANTINE_PATH -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git update-ref refs/heads/blog-k3f9 refs/heads/side\n  echo "the branch moved" >&2\n  exit 1\nfi\n', { mode: 0o755 })
  const update = await w.step(shorter(), { existing: '5' })
  assert.equal(update.status, 0, update.log)
  assert.match(update.log, /The push was rejected: fetching the branch and checking again \(1 of 4\)/)
  assert.equal(update.outputs.pushed, 'true')
  const commits = w.commits()
  assert.equal(commits.length, 3, 'the first, the other run’s, and this update')
  assert.equal(commits[0].sha, first.sha)
  assert.deepEqual(commits[2].parents, [commits[1].sha], 'on top of the branch as it had moved to')
  assert.deepEqual(commits.map(c => c.author), [BOT, BOT, BOT])
})

test('the push step: a branch that moved to a person’s commit is built on, on the retry', { skip: !tools }, async () => {
  const w = world()
  assert.equal((await w.step(sample())).status, 0)
  w.push('a person', { 'x.txt': 'x' }, HUMAN, 'blog-k3f9', 'side')
  const hook = path.join(w.origin, 'hooks/pre-receive')
  fs.writeFileSync(hook, '#!/bin/sh\nif [ ! -e "$GIT_DIR/tried" ] && grep -q blog-k3f9; then\n  : > "$GIT_DIR/tried"\n  env -u GIT_QUARANTINE_PATH -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git update-ref refs/heads/blog-k3f9 refs/heads/side\n  exit 1\nfi\n', { mode: 0o755 })
  const update = await w.step(shorter(), { existing: '5' })
  assert.equal(update.status, 0, update.log)
  assert.equal(update.outputs.pushed, 'true')
  const commits = w.commits()
  assert.equal(commits.length, 3)
  assert.equal(commits[1].author, 'someone@example.org')
  assert.deepEqual(commits[2].parents, [commits[1].sha])
})

// ---------------------------------------------------------------------------------------------------------
// the command line

const cli = (args: string[]) => {
  const run = spawnSync('node', [path.join(scripts, 'blog-import.ts'), ...args], { encoding: 'utf8' })
  return { status: run.status, out: run.stdout ? JSON.parse(run.stdout) : undefined, err: run.stderr }
}

test('the command line refuses a link that isn’t a Google Doc before it fetches anything', async () => {
  for (const doc of ['https://example.org/document/d/' + ID, 'https://docs.google.com/document/d/short', 'http://docs.google.com/document/d/' + ID]) {
    const { status, out } = cli(['--doc', doc, '--authors', 'Ada', '--out', tmp()])
    assert.equal(status, 0)
    assert.equal(out.action, 'refuse')
    assert.ok(out.comment.length > 20)
  }
  const event = path.join(tmp(), 'event.json')
  fs.writeFileSync(event, JSON.stringify({ issue: { number: 7, body: '### Link to the Google Doc\n\nhttps://evil.example/x\n\n### Author name(s)\n\nAda' } }))
  assert.equal(cli(['--event', event, '--default-date', '2026-11-25', '--out', tmp()]).out.action, 'refuse')
})

test('the command line, from a Word file: prints the result and writes the files', () => {
  const root = tmp()
  const { out, status } = cli(['--from-docx', path.join(scripts, 'fixtures/blog-import/sample.docx'), '--authors', 'Ada', '--default-date', '2026-11-25', '--out', root])
  assert.equal(status, 0)
  assert.equal(out.action, 'import')
  assert.deepEqual(tree_(root), [...out.files].sort())
  assert.match(out.prBody, /Adds the post from the Google Doc in the issue/)
})
