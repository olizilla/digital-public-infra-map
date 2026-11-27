// The blog import's conversion (D98): the Word export of a Google Doc, as bytes, to a post's Markdown and its images.
// It is the one module that does this, for the GitHub Action (scripts/blog-import.ts, in Node) and for the live
// preview (/blog/new/, in the browser), so there are no Node-only APIs in it: bytes are Uint8Array, and nothing is read
// from or written to a disk.
//
// The pipeline:
//   mammoth (docx -> HTML, plain JavaScript; its images come out as `blog-image-<n>`, never as data: URIs)
//   -> rehype-parse -> a fix of the links (only http, https and mailto; Google's redirect wrappers unwrapped)
//   -> rehype-sanitize with a schema that is an allow-list of elements and attributes (the second line: mammoth escapes the
//      doc's text and makes no raw HTML, so this is a backstop that a hostile Word file shouldn't get past)
//   -> rehype-remark (hast -> mdast; footnotes handled here) -> the clean-up of the Markdown tree (cleanTree: allowed node
//      types only, link scheme allow-list, the images' names and alt text, the title and heading levels)
//   -> remark-stringify with GFM -> finalMarkdown (a `<` that doesn't start an http, https or mailto autolink is `&lt;`,
//      MDX lines go).
// rehype-remark and remark-stringify rather than turndown: they run on the same trees in Node and the browser, with no DOM
// (turndown needs one: domino in Node, the browser's own in the browser, so two code paths), and the clean-up is then a
// walk of the Markdown tree rather than a pass over a string.
//
// What it trusts: nothing in the doc. mammoth is given only the bytes: `externalFileAccess` is off (so a docx can't make it
// read a file), the docx's own embedded style map is ignored, and the style map is ours. The zip's directory is checked
// before anything is unpacked (checkDocx), images are PNG, JPEG, GIF or WebP by their first bytes and are named here, and
// whatever mammoth says it couldn't convert goes in the notes (convertDocx), so a loss is never silent. Nothing is guessed: the alt
// text is the doc's own (an image with none is published with none, and the author is told how to add it), paragraphs stay as they
// are, and a line break in a paragraph is a hard break. The notes are two lists, what to do in the doc and what the import did.

import mammoth from 'mammoth'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeRemark from 'rehype-remark'
import { defaultHandlers } from 'hast-util-to-mdast'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { dump } from 'js-yaml'
import { code, INVISIBLE, LIMITS, oneLine, refuse } from './BlogDoc.ts'

// the light half is here too, for the action and the tests, which take everything from one place
export * from './BlogDoc.ts'

// ---------------------------------------------------------------------------------------------------------
// links

/** The address a link may have, or undefined: http, https or mailto only, a Google redirect unwrapped to the real address */
export function safeUrl (address: string): string | undefined {
  let text = String(address ?? '').replace(INVISIBLE, '').trim()
  for (let i = 0; i < 3; i++) {
    let url: URL
    try { url = new URL(text) } catch { return undefined }
    if ((url.hostname === 'www.google.com' || url.hostname === 'google.com') && url.pathname === '/url') {
      const real = url.searchParams.get('q') ?? url.searchParams.get('url')
      if (!real) return undefined
      text = real.trim()
      continue
    }
    if (url.protocol === 'mailto:') return url.href
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password) return url.href
    return undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------------------
// the Word file, and the downloaded bytes

const u32 = (view: DataView, at: number) => view.getUint32(at, true)
const u16 = (view: DataView, at: number) => view.getUint16(at, true)

/** Checks the zip's directory, without unpacking it: a Word file, with at most LIMITS.zipEntries files that expand to at most LIMITS.zipBytes */
export function checkDocx (bytes: Uint8Array): void {
  const notDocx = () => refuse('The download isn’t a Word file.')
  if (bytes.length < 22) return notDocx()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (u32(view, 0) !== 0x04034b50) return notDocx()
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return notDocx()
  const entries = u16(view, eocd + 10)
  let at = u32(view, eocd + 16)
  if (entries > LIMITS.zipEntries) return refuse(`The Word file has ${entries} parts; it can’t be imported.`)
  let total = 0
  let document = false
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || u32(view, at) !== 0x02014b50) return notDocx()
    const size = u32(view, at + 24)
    const nameLength = u16(view, at + 28)
    let name = ''
    for (let i = 0; i < nameLength && at + 46 + i < bytes.length; i++) name += String.fromCharCode(bytes[at + 46 + i])
    if (size === 0xFFFFFFFF) return refuse('The Word file has a part too large to import.')
    total += size
    if (name === 'word/document.xml') document = true
    at += 46 + nameLength + u16(view, at + 30) + u16(view, at + 32)
  }
  if (total > LIMITS.zipBytes) return refuse('The Word file expands to more than it’s safe to import.')
  if (!document) return notDocx()
}

/** One file of the zip as text, read by its directory entry and inflated, to at most `max` bytes (a stored file or deflate; undefined if there is no such file or it is longer) */
async function readZipText (bytes: Uint8Array, wanted: string, max: number): Promise<string | undefined> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(view, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return undefined
  let at = u32(view, eocd + 16)
  for (let n = 0, entries = u16(view, eocd + 10); n < entries && at + 46 <= bytes.length; n++) {
    const nameLength = u16(view, at + 28)
    let name = ''
    for (let i = 0; i < nameLength; i++) name += String.fromCharCode(bytes[at + 46 + i])
    if (name === wanted) {
      const method = u16(view, at + 10)
      const compressed = u32(view, at + 20)
      const local = u32(view, at + 42)
      if (local + 30 > bytes.length || u32(view, local) !== 0x04034b50) return undefined
      const start = local + 30 + u16(view, local + 26) + u16(view, local + 28)
      const data = bytes.subarray(start, start + compressed)
      if (method === 0) return data.length <= max ? new TextDecoder().decode(data) : undefined
      if (method !== 8) return undefined
      const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) { await reader.cancel(); return undefined }
        chunks.push(value)
      }
      return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
    }
    at += 46 + nameLength + u16(view, at + 30) + u16(view, at + 32)
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------------------
// images

type Sniff = { ext: string, type: string } | undefined

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) => bytes.length >= at + prefix.length && prefix.every((byte, i) => bytes[at + i] === byte)
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))

/** What an image is, by its first bytes: PNG, JPEG, GIF or WebP; nothing else */
export function sniffImage (bytes: Uint8Array): Sniff {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return { ext: 'gif', type: 'image/gif' }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' }
  return undefined
}

export interface Picture { name: string, bytes: Uint8Array, type: string }

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])

/** The doc's images in the order they come, as mammoth reads them: those that are allowed are kept, named image-1.png and so on, never from the docx */
function imageTaker (notes: Notes) {
  const pictures: Picture[] = []
  /** what each image, by its number in the doc, became: a picture's name, or nothing */
  const names = new Map<number, string | undefined>()
  let total = 0
  let count = 0
  // one at a time and in order, whichever is read first, so the numbers follow the doc
  let queue: Promise<unknown> = Promise.resolve()
  const left = (text: string) => { if (!notes.todo.includes(text)) notes.todo.push(text) }
  const take = async (n: number, read: () => Promise<ArrayBuffer>): Promise<string | undefined> => {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await read())
    } catch {
      return left(`Image ${n} could not be read from the doc, and was left out. In the doc, delete it and insert the picture again.`)
    }
    if (bytes.length > LIMITS.imageBytes) return left(`Image ${n} was left out: it is larger than ${LIMITS.imageBytes / 1024 / 1024} MB. In the doc, replace it with a smaller picture.`)
    const kind = sniffImage(bytes)
    if (!kind) return left(`Image ${n} was left out: only PNG, JPEG, GIF and WebP images are accepted. In the doc, replace it with a picture in one of those formats.`)
    const same = pictures.find(picture => sameBytes(picture.bytes, bytes))
    if (same) return same.name
    if (pictures.length >= LIMITS.images) return left(`Only the first ${LIMITS.images} images were kept: image ${n} and any after it were left out. Use fewer pictures, or split the post.`)
    if (total + bytes.length > LIMITS.imagesBytes) return left(`Image ${n} was left out: the images together would be larger than ${LIMITS.imagesBytes / 1024 / 1024} MB. Make some of the pictures smaller.`)
    total += bytes.length
    const name = `image-${pictures.length + 1}.${kind.ext}`
    pictures.push({ name, bytes, type: kind.type })
    return name
  }
  /** mammoth's convertImage: the image's place in the HTML is `blog-image-<n>`, or `blog-image-none` if it is left out */
  const convert = mammoth.images.imgElement(image => {
    const n = ++count
    const done = queue.then(() => take(n, () => image.readAsArrayBuffer())).then(name => { names.set(n, name) })
    queue = done
    return done.then(() => ({ src: names.get(n) ? `blog-image-${n}` : 'blog-image-none' }))
  })
  return { convert, pictures, names }
}

// ---------------------------------------------------------------------------------------------------------
// the HTML: the fixes that need it, and the allow-list

interface Hast { type: string, tagName?: string, value?: string, properties?: Record<string, any>, children?: Hast[] }

const walkHast = (node: Hast, visit: (node: Hast, parent: Hast | undefined) => void, parent?: Hast) => {
  visit(node, parent)
  for (const child of [...(node.children ?? [])]) walkHast(child, visit, node)
}

const textOf = (node: Hast): string => node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join('')
const isBlank = (text: string) => !text.replace(/[\s ]+/g, '')

/**
 * What the import says about a doc, in two kinds, in the pull request, the issue's comment and the preview. `todo`: what the author must
 * fix in the doc, each saying what to do (a missing alt text, something left out). `did`: what the import did, as facts (the title it took,
 * links it unwrapped). Neither is a guess: the import changes no words and makes up no text.
 */
export interface Notes { todo: string[], did: string[] }

/** What a conversion needs to say about the doc and its images, collected as it goes */
export interface Cleaning {
  notes: Notes
  /** the image's name for its number in the doc, or undefined if it was left out */
  image: (n: number) => string | undefined
}

const add = (list: string[], text: string) => { if (!list.includes(text)) list.push(text) }
const note = (ctx: { notes: Notes }, text: string) => add(ctx.notes.did, text)
const todo = (ctx: { notes: Notes }, text: string) => add(ctx.notes.todo, text)

/** A paragraph with nothing in it but spaces is dropped (the doc's blank lines are spacing, not content) */
function dropEmptyParagraphs (root: Hast) {
  walkHast(root, node => {
    node.children = (node.children ?? []).filter(child => !(child.type === 'element' && child.tagName === 'p' && isBlank(textOf(child)) && !hasElement(child, 'img')))
  })
}

const hasElement = (node: Hast, tagName: string): boolean => (node.children ?? []).some(child => child.tagName === tagName || hasElement(child, tagName))

const FOOTNOTE = /^#(?:foot|end)note-\d+$/
const FOOTNOTE_REF = /^#(?:foot|end)note-ref-\d+$/

const LINK_TODO = 'A link with an address other than http, https or mailto (or a link to somewhere in the doc) was turned into plain text. In the doc, link to a web address.'

/** Links: only an http, https or mailto address, with Google's redirect unwrapped; a footnote's own links stay; any other is its text */
function cleanLinks (root: Hast, ctx: Cleaning) {
  walkHast(root, (node, parent) => {
    if (node.type !== 'element' || node.tagName !== 'a' || !parent) return
    const href = String(node.properties?.href ?? '')
    let replacement: Hast[] | undefined
    if (FOOTNOTE.test(href) || FOOTNOTE_REF.test(href)) return
    if (!href) {
      // a bookmark, <a id="…"></a>, which Google Docs puts in every heading
      replacement = node.children ?? []
    } else {
      const safe = safeUrl(href)
      if (safe) {
        if (/^https?:\/\/(?:www\.)?google\.com\/url\?/i.test(href)) note(ctx, 'Links that went through Google’s redirect (google.com/url?q=…) now point straight to their address.')
        node.properties = { href: safe }
        return
      }
      todo(ctx, LINK_TODO)
      replacement = node.children ?? []
    }
    parent.children = (parent.children ?? []).flatMap(child => child === node ? replacement! : [child])
  })
}

/** A footnote's mark is a superscript run that mammoth writes in a superscript of its own: one `sup`, so that it is not taken for raised text */
function flattenSuperscripts (root: Hast) {
  walkHast(root, node => {
    while (node.tagName === 'sup' && node.children?.length === 1 && node.children[0].tagName === 'sup') node.children = node.children[0].children
  })
}

/** Things mammoth makes of Word's markup that Markdown has no place for, said in the notes as things to do: merged cells, text raised or lowered, a cell with more than a line */
function noteLosses (root: Hast, ctx: Cleaning) {
  walkHast(root, node => {
    if (node.type !== 'element') return
    if ((node.tagName === 'td' || node.tagName === 'th') && (Number(node.properties?.colSpan) > 1 || Number(node.properties?.rowSpan) > 1)) {
      todo(ctx, 'A table has merged cells, which Markdown tables can’t have, so they are shown as single cells. In the doc, split the cells.')
    }
    if ((node.tagName === 'td' || node.tagName === 'th') && (node.children ?? []).filter(child => child.type === 'element' && ['p', 'ul', 'ol', 'blockquote', 'pre', 'table'].includes(child.tagName ?? '')).length > 1) {
      todo(ctx, 'A table cell with more than one paragraph or a list in it is shown on one line. In the doc, keep each cell to one paragraph.')
    }
    if ((node.tagName === 'sup' || node.tagName === 'sub') && !(node.children ?? []).some(child => child.tagName === 'a' && FOOTNOTE.test(String(child.properties?.href ?? '')))) {
      todo(ctx, 'Superscript and subscript text is shown as ordinary text, as Markdown has no such formatting. In the doc, write it in plain characters (m², CO₂).')
    }
  })
}

/** A Markdown table has a header row, and Word's has none unless it was marked: the first row is the header */
function headerRows (root: Hast) {
  walkHast(root, node => {
    if (node.type !== 'element' || node.tagName !== 'table') return
    const rows: Hast[] = []
    walkHast(node, child => { if (child.tagName === 'tr') rows.push(child) })
    const [first] = rows
    if (!first) return
    let head = false
    walkHast(node, child => { if (child.tagName === 'th' || child.tagName === 'thead') head = true })
    if (!head) for (const cell of first.children ?? []) if (cell.tagName === 'td') cell.tagName = 'th'
  })
}

/** The elements and attributes the HTML may have: a backstop for what mammoth writes, and nothing else gets through it */
const SCHEMA = {
  ...defaultSchema,
  tagNames: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'em', 'strong', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br', 'hr', 'sup', 'sub'],
  attributes: {
    a: ['href', ['id', /^(?:foot|end)note-ref-\d+$/]],
    li: [['id', /^(?:foot|end)note-\d+$/]],
    img: [['src', /^blog-image-(?:\d+|none)$/], 'alt']
  },
  protocols: { href: ['http', 'https', 'mailto'] },
  // ids are the doc's footnotes' own, and are not prefixed
  clobber: [],
  clobberPrefix: '',
  strip: ['script', 'style', 'template']
}

const countElements = (root: Hast) => { let n = 0; walkHast(root, node => { if (node.type === 'element') n++ }); return n }

/** What mammoth's style map makes of Word's styles: the Title is the first heading, the Subtitle is in italics, code styles are code */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh > em",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  "p[style-name='Source Code'] => pre:separator('\\n')",
  "p[style-name='HTML Preformatted'] => pre:separator('\\n')",
  "r[style-name='Code Char'] => code",
  "r[style-name='Source Code Char'] => code",
  "r[style-name='HTML Code'] => code",
  "r[style-name='Verbatim Char'] => code"
]

// ---------------------------------------------------------------------------------------------------------
// the Markdown tree

export interface Mdast { type: string, value?: string, url?: string, alt?: string, depth?: number, children?: Mdast[], [key: string]: any }

/** The text of a tree, with no formatting */
export function plain (node: Mdast | Mdast[] | undefined): string {
  if (!node) return ''
  if (Array.isArray(node)) return node.map(plain).join('')
  switch (node.type) {
    case 'text': case 'inlineCode': return node.value ?? ''
    case 'break': return ' '
    case 'image': return node.alt ?? ''
    default: return plain(node.children)
  }
}

const ALLOWED = new Set(['paragraph', 'heading', 'text', 'emphasis', 'strong', 'delete', 'link', 'image', 'list', 'listItem', 'blockquote', 'code', 'inlineCode', 'table', 'tableRow', 'tableCell', 'break', 'thematicBreak', 'footnoteReference', 'footnoteDefinition'])
const strip = (text: unknown) => String(text ?? '').replace(INVISIBLE, '')
const isImage = (node: Mdast) => node.type === 'image' || (node.type === 'link' && node.children?.length === 1 && node.children[0].type === 'image')
const imageOf = (node: Mdast): Mdast => node.type === 'image' ? node : node.children![0]
const isSpace = (node: Mdast) => node.type === 'break' || (node.type === 'text' && !node.value?.trim())

/** The phrasing content with its leading and trailing spaces and breaks off, and its text's own edges trimmed */
function trimPhrasing (children: Mdast[]): Mdast[] {
  const out = [...children]
  while (out.length && isSpace(out[0])) out.shift()
  while (out.length && isSpace(out[out.length - 1])) out.pop()
  if (out[0]?.type === 'text') out[0] = { ...out[0], value: out[0].value!.trimStart() }
  if (out.length && out[out.length - 1].type === 'text') out[out.length - 1] = { ...out[out.length - 1], value: out[out.length - 1].value!.trimEnd() }
  return out
}

/** An inline node whose text starts or ends with spaces, as that node and the spaces outside it: `**bold **` is `**bold** `, as Markdown needs */
function hoistSpace (node: Mdast): Mdast[] {
  const children = node.children ?? []
  const first = children[0]
  const last = children[children.length - 1]
  const lead = first?.type === 'text' ? /^\s+/.exec(first.value!)?.[0] : undefined
  const trail = last?.type === 'text' ? /\s+$/.exec(last.value!)?.[0] : undefined
  if (!lead && !trail) return [node]
  const inner = children.map(child => ({ ...child }))
  if (lead) inner[0].value = inner[0].value!.slice(lead.length)
  if (trail) inner[inner.length - 1].value = inner[inner.length - 1].value!.slice(0, -trail.length)
  const kept = inner.filter(child => child.type !== 'text' || child.value)
  const space = (value: string | undefined): Mdast[] => value ? [{ type: 'text', value: ' ' }] : []
  return [...space(lead), ...(kept.length ? [{ ...node, children: kept }] : []), ...space(trail)]
}

interface TreeContext extends Cleaning {
  /** the images with no alt text yet, as paragraphs of their own */
  bare: Mdast[]
}

/** A paragraph's content, its images in paragraphs of their own, so a caption doesn't end with an image (a change of layout, not of words) */
function splitImages (children: Mdast[], ctx: TreeContext): Mdast[] {
  const out: Mdast[] = []
  let run: Mdast[] = []
  const flush = () => {
    const trimmed = trimPhrasing(run)
    if (trimmed.length) out.push({ type: 'paragraph', children: trimmed })
    run = []
  }
  for (const child of children) {
    if (isImage(child)) { flush(); out.push({ type: 'paragraph', children: [child] }) } else run.push(child)
  }
  flush()
  if (out.length > 1) note(ctx, 'An image that was in a paragraph with text was moved to a paragraph of its own.')
  return out
}

/** A link, its text clean: a link whose text is a web address has no emphasis in it, and is an autolink if the text is the address itself */
function cleanLink (node: Mdast, children: Mdast[], ctx: TreeContext): Mdast[] {
  const href = safeUrl(node.url ?? '')
  if (!href) {
    todo(ctx, LINK_TODO)
    return children
  }
  const text = plain(children).trim()
  if (/^https?:\/\//i.test(text)) {
    let same = false
    try { same = new URL(text).href === href } catch { /* not the same */ }
    return [{ type: 'link', url: href, children: [{ type: 'text', value: same ? href : text }] }]
  }
  return [{ type: 'link', url: href, children }]
}

/** The tree with only what the post may have, its links and images clean (see the file's header) */
function cleanNodes (nodes: Mdast[], ctx: TreeContext, inCell = false): Mdast[] {
  const out: Mdast[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      const value = strip(node.value)
      if (value) out.push({ type: 'text', value })
      continue
    }
    if (!ALLOWED.has(node.type)) {
      if (node.type !== 'definition') todo(ctx, 'Something in the doc that a post can’t have (raw HTML or Word markup) was left out. In the doc, use plain text.')
      continue
    }
    switch (node.type) {
      case 'inlineCode': out.push({ type: 'inlineCode', value: strip(node.value) }); break
      case 'code': out.push({ type: 'code', value: strip(node.value) }); break
      case 'break': out.push({ type: 'break' }); break
      case 'thematicBreak': out.push({ type: 'thematicBreak' }); break
      case 'image': {
        const n = /^blog-image-(\d+)$/.exec(node.url ?? '')?.[1]
        const name = n ? ctx.image(Number(n)) : undefined
        if (!name) break
        const alt = oneLine(strip(node.alt), 300)
        const image: Mdast = { type: 'image', url: name, alt }
        if (!alt) ctx.bare.push(image)
        out.push(image)
        break
      }
      case 'link': out.push(...hoistSpace({ type: 'link', url: node.url, children: cleanNodes(node.children ?? [], ctx, inCell) }).flatMap(part => part.type === 'link' ? cleanLink(part, part.children ?? [], ctx) : [part])); break
      case 'emphasis': case 'strong': case 'delete': out.push(...hoistSpace({ type: node.type, children: cleanNodes(node.children ?? [], ctx, inCell) })); break
      case 'heading': {
        const children = trimPhrasing(cleanNodes(node.children ?? [], ctx, true))
        // Google Docs leaves empty headings behind
        if (plain(children).trim()) out.push({ type: 'heading', depth: Math.min(Math.max(Number(node.depth) || 1, 1), 6), children })
        break
      }
      case 'paragraph': {
        const children = cleanNodes(node.children ?? [], ctx, inCell)
        if (children.some(isImage) && !inCell) { out.push(...splitImages(children, ctx)); break }
        const trimmed = trimPhrasing(children)
        if (plain(trimmed).trim() || trimmed.some(child => child.type === 'inlineCode' || isImage(child))) out.push({ type: 'paragraph', children: trimmed })
        break
      }
      case 'tableCell': out.push({ type: 'tableCell', children: trimPhrasing(cleanNodes(node.children ?? [], ctx, true)) }); break
      case 'list': out.push({ type: 'list', ordered: !!node.ordered, start: node.ordered ? Number(node.start) || 1 : null, spread: false, children: cleanNodes(node.children ?? [], ctx) }); break
      case 'listItem': out.push({ type: 'listItem', spread: false, children: cleanNodes(node.children ?? [], ctx) }); break
      case 'footnoteReference': out.push({ type: 'footnoteReference', identifier: node.identifier, label: node.label }); break
      case 'footnoteDefinition': out.push({ type: 'footnoteDefinition', identifier: node.identifier, label: node.label, children: cleanNodes(node.children ?? [], ctx) }); break
      case 'table': out.push({ type: 'table', align: (node.align ?? []).map(() => null), children: cleanNodes(node.children ?? [], ctx) }); break
      default: out.push({ ...node, children: cleanNodes(node.children ?? [], ctx, inCell) })
    }
  }
  return out
}

const walkMdast = (node: Mdast, visit: (node: Mdast) => void) => { visit(node); for (const child of node.children ?? []) walkMdast(child, visit) }

// ---------------------------------------------------------------------------------------------------------
// converting

export interface Converted {
  /** the post's title: the first heading, which is not in the body */
  title: string
  /** the body as a Markdown tree; its images' URLs are the pictures' names, until toMarkdown gives them a place */
  tree: Mdast
  pictures: Picture[]
  /** what to do in the doc, and what the import did: sentences for the pull request and the preview */
  notes: Notes
}

const messageNotes = (messages: { type: string, message: string }[], ctx: Cleaning) => {
  const elements = new Set<string>()
  let other = false
  for (const { message } of messages) {
    // the element's name, as the doc spells it: w:pict, or {namespace}name for one mammoth doesn't know the prefix of
    const element = /^An unrecognised element was ignored: (.*)$/.exec(message)?.[1]?.replace(/^\{[^}]{0,200}\}/, '')
    if (element) {
      if (/^[A-Za-z][A-Za-z0-9:]{0,40}$/.test(element)) elements.add(element)
      else other = true
    // formatting only, and images are checked here: nothing of the post's text is lost
    } else if (!/^Unrecognised (?:paragraph|run|table) style|^Unsupported break type|^Image of type|^Could not find image file|^A v:imagedata/.test(message)) {
      other = true
    } else if (/^Could not find image file|^A v:imagedata/.test(message)) {
      todo(ctx, 'An image in the doc could not be found in the Word file, and was left out. In the doc, delete it and insert the picture again.')
    }
  }
  if (elements.size) todo(ctx, `Parts of the doc that the converter can’t read were left out: Word elements ${[...elements].slice(0, 6).map(code).join(', ')}${elements.size > 6 ? ' and more' : ''} (equations, shapes and drawings, for example). In the doc, replace them with text, or with a picture (Insert > Image).`)
  if (other) todo(ctx, 'Some Word features that the converter doesn’t support were left out. In the doc, use only text, headings, lists, links, tables and pictures.')
}

const SUGGESTIONS = 'The doc has suggested edits that aren’t accepted or rejected. In Google Docs, choose Tools → Review suggested edits, accept or reject them, then Refresh. Until then the post shows the text as if they were all accepted.'

/**
 * What mammoth leaves out or changes without a word, found in the document's own XML (read once):
 * - a drawing that holds no picture (a chart, a diagram, a shape) is dropped. Drawings in a Word 2010 shape that has a fallback are not
 *   counted, as mammoth reads the fallback (a text box, for one);
 * - suggested edits, which Google exports as tracked changes: mammoth keeps what is inserted or moved in (w:ins, w:moveTo) and drops what
 *   is deleted or moved out (w:del, w:moveFrom), and takes a change of format as made (w:rPrChange and the like): the post is the doc as
 *   if every suggestion were accepted, always, and the to-do says so and how to settle them.
 * Comments are never in the post: mammoth reads no comment unless a style map asks for it, and ours doesn't.
 */
async function noteDocumentXml (bytes: Uint8Array, ctx: { notes: Notes }) {
  let xml: string | undefined
  try { xml = await readZipText(bytes, 'word/document.xml', 50 * 1024 * 1024) } catch { /* no note */ }
  if (!xml) return
  if (/<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|tblGridChange|tcPrChange|trPrChange|numberingChange|cellIns|cellDel|cellMerge)\b/.test(xml)) todo(ctx, SUGGESTIONS)
  const unread = xml.replace(/<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/g, (all, inner: string) => inner.includes('<mc:Fallback') ? '' : all)
  const kinds = new Set<string>()
  let count = 0
  for (const match of unread.matchAll(/<a:graphicData\b[^>]*\buri="([^"]*)"/g)) {
    if (/\/picture$/.test(match[1])) continue
    count++
    kinds.add(/chart/i.test(match[1]) ? 'charts' : /diagram/i.test(match[1]) ? 'diagrams' : 'shapes')
  }
  if (count) todo(ctx, `${count} drawing${count === 1 ? '' : 's'} in the doc (${[...kinds].join(' or ')}) can’t be converted and ${count === 1 ? 'was' : 'were'} left out. Add ${count === 1 ? 'it' : 'them'} to the doc as a picture (Insert > Image) to have ${count === 1 ? 'it' : 'them'} in the post.`)
}

/** mammoth's input: the bytes in Node's way or the browser's */
const input = (bytes: Uint8Array) => {
  const node = typeof (globalThis as any).process?.versions?.node === 'string' && typeof (globalThis as any).Buffer === 'function'
  return node
    ? { buffer: (globalThis as any).Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
    : { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
}

/** The Word file's bytes as the post's title, Markdown tree and images. Throws a Refusal for what isn't a Word file or has no title. */
export async function convertDocx (bytes: Uint8Array): Promise<Converted> {
  checkDocx(bytes)
  const notes: Notes = { todo: [], did: [] }
  const taker = imageTaker(notes)
  let result
  try {
    result = await mammoth.convertToHtml(input(bytes) as any, {
      styleMap: STYLE_MAP,
      includeDefaultStyleMap: true,
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      convertImage: taker.convert
    } as any)
  } catch {
    return refuse('The Word file can’t be read.')
  }
  const ctx: TreeContext = { notes, image: n => taker.names.get(n), bare: [] }
  messageNotes(result.messages, ctx)
  await noteDocumentXml(bytes, ctx)

  // the HTML: fixes, then the allow-list
  const parser = unified().use(rehypeParse, { fragment: true })
  const html = parser.parse(result.value) as unknown as Hast
  dropEmptyParagraphs(html)
  flattenSuperscripts(html)
  noteLosses(html, ctx)
  headerRows(html)
  cleanLinks(html, ctx)
  const before = countElements(html)
  const safe = await unified().use(rehypeSanitize, SCHEMA as any).run(html as any) as unknown as Hast
  if (countElements(safe) < before) note(ctx, 'Some markup that a post can’t have was removed.')

  // the Markdown tree
  const footnoteLabel = (id: unknown) => /^(foot|end)note-(?:ref-)?(\d+)$/.exec(String(id ?? '').replace(/^#/, ''))
  const mdast = await unified().use(rehypeRemark, {
    handlers: {
      // a footnote's number in the text, and its own list at the end of the doc, are Markdown footnotes
      sup (state: any, node: Hast) {
        const link = (node.children ?? []).length === 1 ? node.children![0] : undefined
        const found = link?.tagName === 'a' ? footnoteLabel(link.properties?.href) : null
        if (!found) return state.all(node)
        const label = found[1] === 'end' ? `e${found[2]}` : found[2]
        return { type: 'footnoteReference', identifier: label, label }
      },
      a (state: any, node: Hast) {
        if (FOOTNOTE_REF.test(String(node.properties?.href ?? ''))) return []
        return defaultHandlers.a(state, node)
      },
      ol (state: any, node: Hast) {
        const items = (node.children ?? []).filter(child => child.type === 'element' && child.tagName === 'li')
        const ids = items.map(item => footnoteLabel(item.properties?.id))
        if (!items.length || ids.some(id => !id)) return defaultHandlers.ol(state, node)
        return items.map((item, i) => {
          const label = ids[i]![1] === 'end' ? `e${ids[i]![2]}` : ids[i]![2]
          return { type: 'footnoteDefinition', identifier: label, label, children: state.toFlow(state.all(item)) }
        })
      }
    }
  }).run(safe as any) as unknown as Mdast

  const cleaned = cleanNodes(mdast.children ?? [], ctx)
  let tree: Mdast = { type: 'root', children: cleaned }

  // the title is the doc's first Heading 1 (or its Title style), and the layout writes it, so it isn't in the body. No other heading is
  // taken for it, and the doc's other headings keep their levels. What isn't as it should be is a to-do (or a refusal, with no title), never fixed quietly
  const first = cleaned.findIndex(block => block.type === 'heading' && block.depth === 1)
  if (first < 0) return refuse('The doc has no Heading 1. Make its first line the title with Format → Paragraph styles → Heading 1.')
  const title = oneLine(plain(cleaned[first]), LIMITS.titleChars)
  if (!title) return refuse('The doc’s Heading 1 is empty. Make its first line the title, in Heading 1.')
  cleaned.splice(first, 1)
  if (first > 0) todo(ctx, 'The title (the doc’s first Heading 1) is not the first line of the doc: what comes before it is shown after the title. In the doc, move the title to the first line.')
  // a page has one h1, the title, so any other Heading 1 is shown as a Heading 2, and the author is told
  let extra = false
  walkMdast(tree, node => { if (node.type === 'heading' && node.depth === 1) { node.depth = 2; extra = true } })
  if (extra) todo(ctx, 'Only the first Heading 1 is the title. The other Heading 1s are shown as Heading 2. In the doc, use Heading 2 for sections.')
  // an image with no alt text in the doc is published with none, and the author is asked to add it in the doc: nothing is made up
  for (const image of ctx.bare) todo(ctx, `${code(image.url!)} has no alt text. In the doc, right-click the image, choose **Alt text**, describe what it shows, then Refresh (or comment ${code('/update')}).`)
  ctx.bare.length = 0
  tree = { type: 'root', children: tree.children }
  return { title, tree, pictures: taker.pictures, notes }
}

// ---------------------------------------------------------------------------------------------------------
// the Markdown

/** One line of the Markdown, its `<` that don't start an http, https or mailto autolink written as &lt;, outside code */
function neutralize (line: string): string {
  const codeSpans = /(?<!\\)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
  let out = ''
  let last = 0
  const text = (chunk: string) => {
    let result = ''
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]
      if (char === '\\') { result += char + (chunk[i + 1] ?? ''); i++; continue }
      if (char === '<' && !/^<(?:https?:\/\/[^\s<>]*|mailto:[^\s<>]*)>/i.test(chunk.slice(i))) { result += '&lt;'; continue }
      result += char
    }
    return result
  }
  for (const match of line.matchAll(codeSpans)) {
    out += text(line.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + text(line.slice(last))
}

const MDX_LINE = /^\s*(?:import\s+(?:[\w*{].*\sfrom\s+)?['"].*|export\s+(?:default|const|let|var|function|class|async|type|interface)\b.*|export\s*[{*].*)$/

/** The Markdown as it is published: no raw HTML, no MDX lines (outside code blocks), runs of blank lines collapsed */
export function finalMarkdown (markdown: string, ctx?: { notes: Notes }): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: { char: string, size: number } | undefined
  let changed = false
  for (const line of lines) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (open && open[1][0] === fence.char && open[1].length >= fence.size && /^ {0,3}[`~]+\s*$/.test(line)) fence = undefined
      continue
    }
    if (open) {
      fence = { char: open[1][0], size: open[1].length }
      out.push(line)
      continue
    }
    if (MDX_LINE.test(line)) { changed = true; continue }
    const safe = neutralize(line)
    if (safe !== line) changed = true
    out.push(safe)
  }
  if (changed && ctx) note(ctx, 'Text that looked like HTML or code (<…>, import or export lines) was shown as plain text or left out.')
  return out.join('\n').replace(/[ \t]+\n(?=\n)/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** The converted post's body as Markdown, its images at `imageUrl(name)`. Can be called again with other URLs (the preview's object URLs). */
export function toMarkdown (converted: Converted, imageUrl: (name: string) => string): string {
  const tree = structuredClone(converted.tree)
  walkMdast(tree, node => { if (node.type === 'image') node.url = imageUrl(node.url!) })
  const markdown = unified()
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true, listItemIndent: 'one', rule: '-', setext: false })
    .stringify(tree as any)
  return finalMarkdown(markdown, converted)
}

// ---------------------------------------------------------------------------------------------------------
// the post's file

/** The post's frontmatter, written by js-yaml: the layout is a constant, the values are what the import checked */
export function frontmatter (data: { title: string, date: string, description?: string, authors: string[] }): string {
  const values: Record<string, unknown> = { layout: '../../layouts/Post.astro', title: data.title, date: data.date }
  if (data.description) values.description = data.description
  if (data.authors.length) values.authors = data.authors
  return `---\n${dump(values, { lineWidth: -1, noRefs: true, quotingType: '"' })}---\n`
}

/** The post's file, src/pages/blog/<slug>.md, exactly as the import writes it (and the preview shows it): the frontmatter, a blank line, the body */
export const postFile = (data: Parameters<typeof frontmatter>[0], body: string) => frontmatter(data) + '\n' + body
