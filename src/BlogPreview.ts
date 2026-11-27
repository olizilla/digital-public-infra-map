// What the live preview (/blog/new/, D98) does that isn't drawing: fetching the Word export of a Google Doc from the browser,
// checking the form's fields, and the link to the prefilled `blog-post` issue. No DOM, and none of the converter, so the page loads
// this at once and the converter (src/BlogConvert.ts) only when there is a doc to convert. Tested with a fake `fetch`.
//
// The fetch is the action's (scripts/blog-import.ts fetchDocx) as a browser can make it: the export URL of the doc by its ID and
// nothing else of the link, no cookies (`credentials: 'omit'`, so only a doc that is shared publicly can be read, as for the
// action), no referrer, a size cap read as it streams, a time limit. A browser follows the redirect to googleusercontent.com
// itself (Google answers both with the CORS headers that let this page read them, and for any origin, so a dev server's works
// too); what it can't tell us is the difference between a doc that isn't shared (a redirect to a sign-in page, which has no CORS
// headers, so the fetch fails) and a network failure, so that error says both.
import { docIdFrom, exportUrl, FORM_IDS, FORM_TEMPLATE, LIMITS, oneLine, parseAuthors, parseDate, readLimited, Refusal } from './BlogDoc.ts'

const sharing = 'Check that the doc is shared as “Anyone with the link can view”.'
const allowedHost = (host: string) => host === 'docs.google.com' || /^([a-z0-9-]+\.)+googleusercontent\.com$/.test(host)

/** Why the preview can't be made, and whether the issue can still be opened: `unreachable` says that the preview can't tell what's wrong */
export class PreviewProblem extends Refusal {
  kind: 'not-shared' | 'not-found' | 'too-large' | 'unreachable' | 'timeout' | 'not-word' | 'cancelled' | 'other'
  constructor (message: string, kind: PreviewProblem['kind']) {
    super(message)
    this.kind = kind
  }
}

/** The Word export of a doc, fetched from the browser, as bytes: at most LIMITS.docxBytes, within LIMITS.fetchMs */
export async function fetchDocxInBrowser (id: string, options: { fetch?: typeof fetch, signal?: AbortSignal, maxBytes?: number, timeoutMs?: number } = {}): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) throw new PreviewProblem('That isn’t a Google Doc ID.', 'other')
  const maxBytes = options.maxBytes ?? LIMITS.docxBytes
  const control = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; control.abort() }, options.timeoutMs ?? LIMITS.fetchMs)
  const cancel = () => control.abort()
  options.signal?.addEventListener('abort', cancel)
  if (options.signal?.aborted) cancel()
  try {
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(exportUrl(id), { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store', signal: control.signal })
    } catch {
      if (timedOut) throw new PreviewProblem('Google took too long to send the doc.', 'timeout')
      if (control.signal.aborted) throw new PreviewProblem('Cancelled.', 'cancelled')
      throw new PreviewProblem(`This page couldn’t fetch the doc. ${sharing} If it is, your browser, a blocker or the network stopped the request: the preview can’t be made here, but you can still open the issue, which fetches the doc itself.`, 'unreachable')
    }
    if (response.url) {
      let host = ''
      try { host = new URL(response.url).hostname } catch { /* refused below */ }
      if (!allowedHost(host)) throw new PreviewProblem(`Google sent the download to a sign-in page, so the doc isn’t shared publicly. ${sharing}`, 'not-shared')
    }
    if (response.status === 401 || response.status === 403) throw new PreviewProblem(`Google won’t send the doc to anyone who isn’t signed in, so it isn’t shared publicly. ${sharing}`, 'not-shared')
    if (response.status === 404) throw new PreviewProblem(`Google can’t find that doc, or it isn’t shared publicly. Check the link, and that the doc is shared as “Anyone with the link can view”.`, 'not-found')
    if (response.status !== 200) throw new PreviewProblem(`Google answered ${response.status} for the doc’s Word export. ${sharing}`, 'other')
    if (/^text\/html/i.test(response.headers.get('content-type') ?? '')) throw new PreviewProblem(`Google sent a web page, not a Word file: usually its sign-in page, so the doc isn’t shared publicly. ${sharing}`, 'not-shared')
    try {
      return await readLimited(response, maxBytes, `The doc’s Word export is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than the import takes.`)
    } catch (error) {
      if (error instanceof PreviewProblem) throw error
      if (timedOut) throw new PreviewProblem('Google took too long to send the doc.', 'timeout')
      if (control.signal.aborted) throw new PreviewProblem('Cancelled.', 'cancelled')
      if (error instanceof Refusal) throw new PreviewProblem(error.message, /larger than/.test(error.message) ? 'too-large' : 'other')
      throw new PreviewProblem('The doc’s download was interrupted.', 'unreachable')
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

export interface Fields { doc: string, authors: string, date: string, description: string }

/** The form's problems, one sentence each for the fields that have one (an empty optional field has none; an empty required one has none until it's needed) */
export function fieldProblems (fields: Fields): Partial<Record<keyof Fields, string>> {
  const problems: Partial<Record<keyof Fields, string>> = {}
  if (fields.doc.trim()) {
    try { docIdFrom(fields.doc) } catch { problems.doc = 'That isn’t a link to a Google Doc.' }
  }
  if (fields.authors.trim()) {
    try { parseAuthors(fields.authors) } catch (error) { problems.authors = /needs the author/.test((error as Error).message) ? 'Add at least one author.' : `At most ${LIMITS.authors} authors.` }
  }
  try { parseDate(fields.date) } catch { problems.date = 'Use YYYY-MM-DD, YYYY-MM or YYYY.' }
  return problems
}

/** The link to the `blog-post` issue form with its fields filled in (GitHub reads each field's id from the query), or undefined until the doc link and the authors are good */
export function issueUrl (repository: string, fields: Fields, title = ''): string | undefined {
  let id: string
  let authors: string[]
  let date: string | undefined
  try {
    id = docIdFrom(fields.doc)
    authors = parseAuthors(fields.authors)
    date = parseDate(fields.date)
  } catch {
    return undefined
  }
  const values: Record<(typeof FORM_IDS)[number], string> = {
    doc: `https://docs.google.com/document/d/${id}/edit`,
    authors: authors.join(', '),
    date: date ?? '',
    description: oneLine(fields.description, LIMITS.descriptionChars)
  }
  const query = [`template=${FORM_TEMPLATE}`]
  if (title) query.push(`title=${encodeURIComponent(oneLine(`Blog post: ${title}`, 120))}`)
  for (const key of FORM_IDS) if (values[key]) query.push(`${key}=${encodeURIComponent(values[key])}`)
  return `${repository}/issues/new?${query.join('&')}`
}
