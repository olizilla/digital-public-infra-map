// Import a blog post from a Google Doc: the Word export of the doc, converted to Markdown by src/BlogConvert.ts (mammoth,
// then an allow-list and clean-up; D98), written as src/pages/blog/<slug>.md with its images in public/blog/<slug>/.
// The live preview at /blog/new/ runs the same conversion in the browser, so what it shows is what this writes.
// .github/workflows/blog-import.yml runs this from an issue ("Blog post from a Google Doc"), and opens or
// updates the pull request that adds the post.
//
// usage: node scripts/blog-import.ts --event <event.json> --default-date <YYYY-MM-DD> [--slug <slug>] [--branch <blog-xxxx>] [--out <dir>] [--root <repo>]
//          reads the doc link, authors, date and description from the issue form in the event's issue body
//        node scripts/blog-import.ts --doc <link> --authors "A, B" [--date <date>] [--description <text>] [--slug <slug>] [--branch <blog-xxxx>] [--out <dir>] [--root <repo>]
//        node scripts/blog-import.ts --from-docx <file.docx> --authors "A, B" [--date <date>] [--description <text>] [--slug <slug>] [--branch <blog-xxxx>] [--out <dir>] [--root <repo>]
//          local runs: the doc by link, or an already downloaded Word file (nothing is fetched)
// It prints the result as JSON on stdout (ImportResult, or a Refusal's comment): the slug and the branch,
// the files it wrote, the pull request's title and body, and anything it left out. Progress goes to stderr.
// The files are written under --out (default: the current directory), and none is overwritten. --root is the repository
// the slug is checked against (default: --out). --slug and --branch are kept from the first import when a pull request
// exists; without them the slug is made from the title and the branch is blog- and 4 random letters and digits.
//
// What it trusts: nothing in the doc or the issue. This is a public repo and what is reviewed in the pull
// request is what is published, so the doc is data, never code:
// - it fetches only https://docs.google.com/document/d/<ID>/export?format=docx, where <ID> is 20 to 100 of
//   A-Za-z0-9_-, and nothing else from the link; redirects stay on docs.google.com and *.googleusercontent.com;
//   the download is capped in size and time (LIMITS), and must be a zip with a bounded size and entry count;
// - the conversion (src/BlogConvert.ts, see its header) reads the docx with mammoth, which reads no files outside it and
//   makes no raw HTML; the HTML is rebuilt from an allow-list of elements and attributes, and a link keeps only an http,
//   https or mailto address, with Google's redirect wrappers (https://www.google.com/url?q=<real>) unwrapped; any other
//   link becomes its text. Markdown is written from that tree, without raw HTML;
// - the Markdown is checked again (finalMarkdown): a `<` that doesn't start an http, https or mailto autolink
//   becomes &lt;, and lines that look like MDX (import and export) are dropped. The output is always .md;
// - images: PNG, JPEG, GIF and WebP by their first bytes, never by file name, at most 5 MB each and 15 MB in total,
//   named image-<n>.<ext> by the converter, never from the docx; any other is left out, and the pull request says so;
//   so is anything else that the converter couldn't read (drawings, equations): it is in the notes, as a to-do that says what to do in the doc, not silent.
//   Nothing is guessed: no alt text is made up (an image with none in the doc is published with none, and a to-do), and no paragraphs are joined;
// - the frontmatter is written by js-yaml from values capped in length, with no control or bidirectional-text
//   characters, and the layout is a constant;
// - the slug is made from the title (lowercase ASCII and hyphens), checked against the posts already in the
//   repo (--out), and never overwrites a file.
// The conversion itself has no time limit (pandoc's process had one), so the workflow's job has a timeout.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseArgs } from 'node:util'
import {
  type Notes, convertDocx, frontmatter, postFile, docIdFrom, exportUrl, FORM, finalMarkdown, LIMITS, oneLine, parseAuthors, parseDate, readLimited, Refusal, refuse, slugify, SLUG, toMarkdown, code,
  checkDocx, safeUrl, sniffImage, plain, FORM_IDS, FORM_TEMPLATE
} from '../src/BlogConvert.ts'

// the conversion's pieces are in src/BlogConvert.ts; the tests and the command line take them from here
export { frontmatter, postFile, LIMITS, Refusal, docIdFrom, exportUrl, FORM, finalMarkdown, oneLine, parseAuthors, parseDate, slugify, SLUG, checkDocx, safeUrl, sniffImage, plain, FORM_IDS, FORM_TEMPLATE, convertDocx, toMarkdown }

// ---------------------------------------------------------------------------------------------------------
// the issue form

/** The form's fields as written in an issue body: the text under each "### <label>", the first of each */
export function parseIssueForm (body: string): Record<keyof typeof FORM, string> {
  const sections = new Map<string, string>()
  const parts = String(body ?? '').replace(/\r\n?/g, '\n').split(/^### +(.+?) *$/m)
  // [before, label, text, label, text, …]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (!sections.has(parts[i])) sections.set(parts[i], parts[i + 1].trim())
  }
  const field = (label: string) => {
    const text = sections.get(label) ?? ''
    return text === '_No response_' ? '' : text
  }
  return { doc: field(FORM.doc), authors: field(FORM.authors), date: field(FORM.date), description: field(FORM.description) }
}

// ---------------------------------------------------------------------------------------------------------
// fetching the Word file

const allowedHost = (host: string) => host === 'docs.google.com' || /^([a-z0-9-]+\.)+googleusercontent\.com$/.test(host)

/** The Word export of a doc, by its ID: at most LIMITS.docxBytes, within LIMITS.fetchMs, redirects only within Google */
export async function fetchDocx (id: string, options: { fetch?: typeof fetch, maxBytes?: number, timeoutMs?: number } = {}): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) return refuse('That isn’t a Google Doc ID.')
  const fetcher = options.fetch ?? fetch
  const maxBytes = options.maxBytes ?? LIMITS.docxBytes
  const signal = AbortSignal.timeout(options.timeoutMs ?? LIMITS.fetchMs)
  const sharing = ' Check that the doc is shared as “Anyone with the link can view”.'
  let url = exportUrl(id)
  try {
    for (let hop = 0; hop < 6; hop++) {
      const response = await fetcher(url, { redirect: 'manual', signal, headers: { accept: '*/*' } })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        let next: URL | undefined
        try { next = location ? new URL(location, url) : undefined } catch { /* refused below */ }
        if (!next || next.protocol !== 'https:' || next.username || next.password || next.port || !allowedHost(next.hostname)) {
          return refuse(`Google sent the download somewhere else than Google Docs.${sharing}`)
        }
        url = next.href
        continue
      }
      // the preview page's words for the same answers (src/BlogPreview.ts)
      if (response.status === 401 || response.status === 403) return refuse(`Google won’t send the doc to anyone who isn’t signed in, so it isn’t shared publicly.${sharing}`)
      if (response.status === 404) return refuse('Google can’t find that doc, or it isn’t shared publicly. Check the link, and that the doc is shared as “Anyone with the link can view”.')
      if (response.status !== 200) return refuse(`Google answered ${response.status} for the doc’s Word export.${sharing}`)
      return await readLimited(response, maxBytes, `The doc’s Word export is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }
    return refuse('Google redirected the download too many times.')
  } catch (error) {
    if (error instanceof Refusal) throw error
    if (signal.aborted) return refuse('Google took too long to send the doc.')
    return refuse(`The doc couldn’t be fetched.${sharing}`)
  }
}

// ---------------------------------------------------------------------------------------------------------
// the post

/** Whether a slug is already a page (`new` is the preview page, /blog/new/): a post (.md, .mdx or .astro), an entry's landing page (src/content/links), or a folder of images */
export function slugTaken (slug: string, root: string): boolean {
  return ['index', '[id]', 'new'].includes(slug) ||
    ['.md', '.mdx', '.astro'].some(ext => fs.existsSync(path.join(root, 'src/pages/blog', slug + ext))) ||
    fs.existsSync(path.join(root, 'src/content/links', slug + '.md')) ||
    fs.existsSync(path.join(root, 'public/blog', slug))
}

export interface ImportResult {
  action: 'import'
  slug: string
  branch: string
  title: string
  date: string
  dateDefaulted: boolean
  authors: string[]
  description?: string
  /** the files written, from the repository's root */
  files: string[]
  images: number
  /** what to do in the doc before merging, and what the import did */
  notes: Notes
  preview: string
  prTitle: string
  prBody: string
}

/** A pull request's branch: blog- and 4 random lowercase letters and digits. The preview's address is made from it, so it is short, and it doesn't change when the title does. */
export const BRANCH = /^blog-[a-z0-9]{4}$/
export const randomBranch = () => `blog-${Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[crypto.randomInt(36)]).join('')}`

/** The previews Cloudflare Pages builds for a branch: https://<branch>.dpi-map.pages.dev */
export const previewUrl = (branch: string, slug: string) => `https://${branch}.dpi-map.pages.dev/blog/${slug}/`

/** The pull request's body: written here from the result, so nothing from the doc or the issue is in it as Markdown */
export function pullRequestBody (r: Omit<ImportResult, 'prBody'>, issue?: number): string {
  const lines = [
    `Adds the post from the Google Doc in ${issue ? `#${issue}` : 'the issue'}: \`src/pages/blog/${r.slug}.md\`${r.images ? `, with ${r.images} image${r.images === 1 ? '' : 's'} in \`public/blog/${r.slug}/\`` : ''}.`,
    '',
    `- Title: ${code(r.title)}`,
    `- Authors: ${r.authors.map(code).join(', ')}`,
    `- Date: ${code(r.date)}`
  ]
  if (r.description) lines.push(`- Description: ${code(r.description)}`)
  lines.push('', `Preview: ${r.preview} once Cloudflare has built it (its check on this pull request has the exact link; the branch name, \`${r.branch}\`, decides the address).`)
  const update = `edit the doc and comment \`/update\` on ${issue ? `#${issue}` : 'the issue'}`
  if (r.notes.todo.length) lines.push('', '### To do before merging', '', `Fix these in the doc, then ${update}. Nothing is guessed: what the import can't do from the doc, it asks for.`, '', ...r.notes.todo.map(text => `- ${text}`))
  // what the import did, as facts, for whoever wants them: collapsed, and only when there is something
  if (r.notes.did.length) lines.push('', '<details><summary>Import notes</summary>', '', ...r.notes.did.map(text => `- ${text}`), '', '</details>')
  lines.push(
    '',
    '### To update or publish',
    '',
    `- To change the post, edit the doc and comment \`/update\` on ${issue ? `#${issue}` : 'the issue'} (or edit the issue). That adds a commit to this branch that replaces the post and its images with the doc’s current text. Edit the doc rather than the post’s files on the branch: an update replaces them, and says so on the issue if it replaced changes made on the branch (they stay in the branch’s history).`,
    '- To publish it, merge this pull request.',
    // the workflow finds this pull request again, and the post's slug, from this line
    ...(issue ? ['', `<!-- blog-import-issue: ${issue} slug: ${r.slug} -->`] : [])
  )
  return lines.join('\n') + '\n'
}

export interface ImportOptions {
  /** the downloaded Word file */
  docx: string
  authors: string
  date?: string
  description?: string
  /** the date to use when there's none: the day the pull request is opened, YYYY-MM-DD */
  defaultDate: string
  /** the slug to keep, when the pull request already exists */
  slug?: string
  /** the branch, blog-xxxx: the first import's, when the pull request already exists; else a new random one */
  branch?: string
  /** the repository to check for the slug in, and to write to unless there's an `out` */
  root: string
  /** where to write the files, from the repository's root: the repository's own folder, or another */
  out?: string
  /** the issue's number, for the pull request body */
  issue?: number
  /** check and convert, but write nothing */
  dryRun?: boolean
}

/** Converts the Word file into the post and its images, and writes them under `root`. Throws a Refusal if it can't or shouldn't. */
export async function importDocx (options: ImportOptions): Promise<ImportResult> {
  const authors = parseAuthors(options.authors)
  const date = parseDate(options.date ?? '')
  const description = oneLine(options.description ?? '', LIMITS.descriptionChars) || undefined
  if (options.slug !== undefined && (!SLUG.test(options.slug) || options.slug.length > 60)) return refuse('That isn’t a valid slug.')
  if (options.branch !== undefined && !BRANCH.test(options.branch)) return refuse('That isn’t a valid branch name.')
  const defaultDate = parseDate(options.defaultDate) ?? refuse('No default date.')

  const docx = path.resolve(options.docx)
  const converted = await convertDocx(fs.readFileSync(docx))
  const { title, pictures } = converted
  const slug = options.slug ?? slugify(title, `post-${crypto.createHash('sha1').update(path.basename(docx)).digest('hex').slice(0, 6)}`)
  if (!SLUG.test(slug)) return refuse('The title makes no usable slug.')
  if (slugTaken(slug, options.root)) {
    return refuse(`There is already a post or page called \`${slug}\`: this doc’s title makes the same address, /blog/${slug}/. If that is this doc’s post, it is already published, so change it with a pull request. Otherwise give the doc a different title.`)
  }

  const body = toMarkdown(converted, name => `/blog/${slug}/${name}`)
  if (body.length > LIMITS.bodyChars) return refuse('The post is longer than it’s safe to import.')
  if (!body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()) return refuse('The doc has no text under its title.')

  const file = `src/pages/blog/${slug}.md`
  const text = postFile({ title, date: date ?? defaultDate, description, authors }, body)
  const files = [file, ...pictures.map(picture => `public/blog/${slug}/${picture.name}`)]
  const branch = options.branch ?? randomBranch()
  const partial = {
    action: 'import' as const,
    slug,
    branch,
    title,
    date: date ?? defaultDate,
    dateDefaulted: !date,
    authors,
    ...(description ? { description } : {}),
    files,
    images: pictures.length,
    notes: converted.notes,
    preview: previewUrl(branch, slug),
    prTitle: oneLine(`Blog: ${title}`, 120)
  }
  const result: ImportResult = { ...partial, prBody: pullRequestBody(partial, options.issue) }
  if (!options.dryRun) {
    const out = options.out ?? options.root
    fs.mkdirSync(path.join(out, 'src/pages/blog'), { recursive: true })
    fs.writeFileSync(path.join(out, file), text, { flag: 'wx' })
    if (pictures.length) {
      fs.mkdirSync(path.join(out, 'public/blog', slug), { recursive: true })
      for (const picture of pictures) fs.writeFileSync(path.join(out, 'public/blog', slug, picture.name), picture.bytes, { flag: 'wx' })
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------------------
// the command line

async function main () {
  const { values: args } = parseArgs({
    options: {
      event: { type: 'string' },
      doc: { type: 'string' },
      'from-docx': { type: 'string' },
      authors: { type: 'string' },
      date: { type: 'string' },
      description: { type: 'string' },
      'default-date': { type: 'string' },
      slug: { type: 'string' },
      branch: { type: 'string' },
      out: { type: 'string' },
      root: { type: 'string' },
      'dry-run': { type: 'boolean' }
    }
  })
  const out = path.resolve(args.out ?? '.')
  const root = path.resolve(args.root ?? out)
  const download = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-import-download-'))
  try {
    let fields = { doc: args.doc ?? '', authors: args.authors ?? '', date: args.date ?? '', description: args.description ?? '' }
    let issue: number | undefined
    if (args.event) {
      const event = JSON.parse(fs.readFileSync(args.event, 'utf8'))
      fields = parseIssueForm(event.issue?.body ?? '')
      issue = Number(event.issue?.number) || undefined
    }
    let docx = args['from-docx']
    if (!docx) {
      const id = docIdFrom(fields.doc)
      docx = path.join(download, 'doc.docx')
      fs.writeFileSync(docx, await fetchDocx(id))
    }
    const result = await importDocx({
      docx, authors: fields.authors, date: fields.date, description: fields.description,
      defaultDate: args['default-date'] ?? new Date().toISOString().slice(0, 10),
      slug: args.slug, branch: args.branch, root, out, issue, dryRun: args['dry-run']
    })
    console.error(`${result.files.length} files for /blog/${result.slug}/${result.notes.todo.length ? `; ${result.notes.todo.length} to do` : ''}`)
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.error(error.message)
    console.log(JSON.stringify({ action: 'refuse', comment: error.message }, null, 2))
  } finally {
    fs.rmSync(download, { recursive: true, force: true })
  }
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main()
