// The blog import's light half (D98): the limits, the doc link, the form's fields, the slug and the bounded read of a
// download. Nothing here needs mammoth or unified, so the preview page (/blog/new/) can use it at once and load the converter
// (src/BlogConvert.ts) only when there is a doc to convert. No Node-only APIs: it runs in Node (the action) and the browser.

export const LIMITS = {
  /** the downloaded Word file */
  docxBytes: 20 * 1024 * 1024,
  /** the whole download, redirects included */
  fetchMs: 60_000,
  /** what the zip says it expands to, and how many files it holds */
  zipBytes: 200 * 1024 * 1024,
  zipEntries: 2000,
  /** each image, all the images, and how many */
  imageBytes: 5 * 1024 * 1024,
  imagesBytes: 15 * 1024 * 1024,
  images: 30,
  /** frontmatter values */
  titleChars: 200,
  descriptionChars: 300,
  authorChars: 100,
  authors: 20,
  /** the slug: the post's address, /blog/<slug>/ */
  slugChars: 40,
  /** the Markdown */
  bodyChars: 1_000_000
}

/** A reason to refuse the import, written for the issue's comment (or the preview's message) */
export class Refusal extends Error {}

export const refuse = (message: string): never => { throw new Refusal(message) }

// ---------------------------------------------------------------------------------------------------------
// the issue form's fields, and the link

/** The form's labels (.github/ISSUE_TEMPLATE/blog-post.yml): GitHub puts each in the body as "### <label>" */
export const FORM = {
  doc: 'Link to the Google Doc',
  authors: 'Author name(s)',
  date: 'Publish date',
  description: 'Description'
}

/** The form's field ids in the template, which an issue link's query parameters use: ?template=blog-post.yml&doc=… */
export const FORM_TEMPLATE = 'blog-post.yml'
export const FORM_IDS = ['doc', 'authors', 'date', 'description'] as const

/** Characters that show nothing or reorder text: controls, zero-width and bidirectional marks, the byte order mark */
export const INVISIBLE = new RegExp(`[${[[0, 8], [0xb, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('')}]`, 'gu')

/** One line of plain text: no controls or invisible marks, whitespace collapsed, cut to `max` characters */
export function oneLine (text: unknown, max: number): string {
  const line = String(text ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...line]
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : line
}

/** The doc's ID from the link in the form: only `https://docs.google.com/document/d/<ID>…`, and nothing else of the link */
export function docIdFrom (link: string): string {
  let text = String(link ?? '').trim()
  if (/^<.*>$/.test(text)) text = text.slice(1, -1).trim()
  if (!text) return refuse('The issue has no link to the Google Doc.')
  if (/\s/.test(text)) return refuse('The link to the Google Doc should be one link, on its own.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return refuse('The link to the Google Doc isn’t a web address.')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password || url.port) {
    return refuse('The link must be a Google Doc, https://docs.google.com/document/d/…, and nothing else is fetched.')
  }
  const match = /^\/document\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/.exec(url.pathname)
  if (!match || !/^[A-Za-z0-9_-]{20,100}$/.test(match[1])) {
    return refuse('That doesn’t look like a link to a Google Doc: it should be https://docs.google.com/document/d/<ID>/edit.')
  }
  return match[1]
}

export const exportUrl = (id: string) => `https://docs.google.com/document/d/${id}/export?format=docx`

/** The authors, from the form's text: names separated by commas, semicolons or lines */
export function parseAuthors (text: string): string[] {
  const names: string[] = []
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const name = oneLine(part, LIMITS.authorChars)
    if (name && !names.includes(name)) names.push(name)
  }
  if (!names.length) return refuse('The issue needs the author’s name, or the authors’ names, separated by commas.')
  if (names.length > LIMITS.authors) return refuse(`The issue lists ${names.length} authors; at most ${LIMITS.authors} are accepted.`)
  return names
}

/** A date as a post's `date` is known: YYYY, YYYY-MM or YYYY-MM-DD, a real one; empty is none */
export function parseDate (text: string): string | undefined {
  const value = String(text ?? '').trim()
  if (!value) return undefined
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2] ?? 1), Number(match?.[3] ?? 1)]
  const real = match && year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (!real) return refuse('The publish date should be YYYY-MM-DD (or YYYY-MM, or YYYY), or empty to use the day the pull request is opened.')
  return value
}

/** A slug from a title: lowercase ASCII and hyphens, at most LIMITS.slugChars, cut at a word */
export function slugify (title: string, fallback = 'post'): string {
  // NFKD takes the accents off é and ü; these letters have none to take off
  const letters: Record<string, string> = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i' }
  const ascii = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ßøæœđðłþı]/g, letter => letters[letter]).replace(/&/g, ' and ').replace(/['’‘]/g, '')
  let slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > LIMITS.slugChars) {
    const cut = slug.slice(0, LIMITS.slugChars + 1)
    slug = cut.slice(0, cut.lastIndexOf('-') > 10 ? cut.lastIndexOf('-') : LIMITS.slugChars)
  }
  // not ending on a small word, as a cut title can: …-pix-upi-and
  slug = slug.replace(/(-(and|or|the|a|an|of|in|on|to|for|at|by|with|from|is|are|as))+$/, '').replace(/-+$/g, '')
  return slug || fallback
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `text` as inline code in Markdown, whatever it holds */
export const code = (text: string) => {
  const ticks = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length)) + 1)
  return `${ticks}${text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text}${ticks}`
}

/** A note's text in pieces, with its code spans and **bold** apart, so a page can show them without parsing Markdown */
export function noteParts (note: string): { text: string, code: boolean, bold?: boolean }[] {
  const parts: { text: string, code: boolean, bold?: boolean }[] = []
  let last = 0
  for (const match of note.matchAll(/(`+)(.+?)\1(?!`)|\*\*(.+?)\*\*/gs)) {
    if (match.index > last) parts.push({ text: note.slice(last, match.index), code: false })
    parts.push(match[2] !== undefined ? { text: match[2], code: true } : { text: match[3], code: false, bold: true })
    last = match.index + match[0].length
  }
  if (last < note.length) parts.push({ text: note.slice(last), code: false })
  return parts
}

/** The body of a response, read as far as `maxBytes` and no further: a Refusal for more, with `tooLarge` as the sentence */
export async function readLimited (response: Response, maxBytes: number, tooLarge: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) return refuse(tooLarge)
  const reader = response.body?.getReader()
  if (!reader) return refuse('Google sent an empty download.')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel()
      return refuse(tooLarge)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
  return bytes
}

