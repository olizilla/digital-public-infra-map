// The browser side of the blog post preview, /blog/new/ (src/pages/blog/new.astro, D98): the form, the fetch of the doc's Word export
// (src/BlogPreview.ts), the conversion (src/BlogConvert.ts, the action's own module, loaded by a dynamic import the first time there is a doc),
// and drawing the post, what is to be done in the doc, the facts of the post as it will be once merged, and how it will look in the blog
// index (the index's own entry markup, src/components/InsightEntry.astro, filled in here) and when its link is shared (the tags
// src/layouts/Layout.astro writes: the title with the site's name, the description, the site's default image). Nothing from the doc is put in the page as HTML except the post itself, rendered from the
// Markdown the import would write and sanitized once more (src/BlogRender.ts); the notes, the title and the other text are set as text.
import { docIdFrom, LIMITS, noteParts, oneLine, parseAuthors, parseDate, Refusal, slugify } from '../../BlogDoc'
import { excerpt } from '../../Excerpt'
import { fetchDocxInBrowser, fieldProblems, issueUrl, PreviewProblem, type Fields } from '../../BlogPreview'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** a date as the site shows it (src/Insights.ts formatDate, which needs Astro's content API and so isn't imported): "12 Mar 2025", or short, "12 Mar" */
const formatDate = (date: string, short = false) => {
  const [y, m, d] = date.split('-')
  if (!m) return y
  const day = d ? `${Number(d)} ` : ''
  return short ? `${day}${MONTHS[Number(m) - 1]}` : `${day}${MONTHS[Number(m) - 1]} ${y}`
}

/** how the post is described where it has no description of its own: the index and the share card cut its first paragraph (src/Insights.ts, src/layouts/Post.astro) */
const INDEX_CHARS = 300
const SHARE_CHARS = 160
const SITE_DESCRIPTION = 'The first global investigation of digital public infrastructure.'

export function startPreview (root: HTMLElement) {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const form = $<HTMLFormElement>('form#blog')
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const { taken, repository, site } = JSON.parse(document.querySelector('#blog-data')!.textContent!) as { taken: string[], repository: string, site: string }
  const el = {
    status: $('[data-status]'), problem: $('[data-problem]'), notes: $<HTMLDetailsElement>('[data-notes]'), badge: $('[data-badge]'), facts: $('[data-facts]'),
    todoBox: $('[data-todo-box]'), todoList: $('[data-todo-list]'),
    index: $('[data-index-card]'), share: $('[data-share-card]'), descriptionHint: $('[data-description-hint]'),
    post: $('[data-post]'), example: $('[data-example]'), exampleDate: $('[data-example-date]'), exampleAuthors: $('[data-example-authors]'), body: $('[data-body]'), markdown: $('[data-markdown]'), markdownText: $<HTMLTextAreaElement>('[data-markdown-text]'),
    refresh: $<HTMLButtonElement>('[data-refresh]'), issue: $<HTMLAnchorElement>('a[data-issue]'), issueHint: $('[data-issue-hint]')
  }
  const issueHint = el.issueHint.textContent!
  /** "Send to GitHub" was clicked since the form last changed: the hint then says what happens next */
  let sent = false
  const fields = (): Fields => ({ doc: input('doc').value, authors: input('authors').value, date: input('date').value, description: input('description').value })

  /** the last good preview: what to show of it again when the form changes, and the pictures' object URLs, to let go of */
  let shown: { title: string, slug: string, body: string, images: number, urls: string[], file: (f: Fields) => string } | undefined
  /** the preview couldn't be made because the browser couldn't fetch the doc: the issue can still be opened, as the import fetches it itself */
  let unreachable = false
  let generation = 0
  let running: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  /** the status line; after a doc has loaded it says where the preview is, in the one-column layout, where the form is above it (and not by an anchor, whose # would replace the form's) */
  const setStatus = (line: string, pointer = false) => {
    el.status.textContent = line
    if (!pointer || !line) return
    const link = document.createElement('a')
    link.href = '#preview-details'
    link.className = 'ul whitespace-nowrap wide:hidden'
    link.textContent = 'See the preview ↓'
    link.addEventListener('click', event => {
      event.preventDefault()
      el.notes.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    el.status.append(' ', link)
  }
  const problem = (text?: string) => { el.problem.hidden = !text; el.problem.textContent = text ?? '' }
  const errorLine = (name: string, text?: string) => { $(`[data-error="${name}"]`).textContent = text ?? '' }
  const text = (selector: string, value: string, root: ParentNode = el.post) => { const target = root.querySelector(selector); if (target) target.textContent = value }

  // the form in the address's #, for sharing a preview as a link: #doc=<the doc's id>&authors=…&date=…&description=…. The # is
  // never sent to a server, so the names stay out of logs. It's rewritten as the form changes, without adding to the history
  const NAMES = ['authors', 'date', 'description'] as const
  const toHash = (f: Fields) => {
    const params = new URLSearchParams()
    try { params.set('doc', docIdFrom(f.doc)) } catch { /* not a doc's link yet: left out */ }
    for (const name of NAMES) if (f[name].trim()) params.set(name, f[name])
    return [...params].length ? `#${params}` : ''
  }
  const saveHash = () => {
    const hash = toHash(fields())
    if (hash !== location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`)
  }
  /** fills the form from the address's #, if it has any of the form; returns whether it has a doc to load */
  const fromHash = () => {
    const params = new URLSearchParams(location.hash.slice(1))
    if (![...params.keys()].some(key => key === 'doc' || (NAMES as readonly string[]).includes(key))) return false
    const id = params.get('doc') ?? ''
    input('doc').value = /^[A-Za-z0-9_-]{20,100}$/.test(id) ? `https://docs.google.com/document/d/${id}/edit` : ''
    for (const name of NAMES) input(name).value = (params.get(name) ?? '').slice(0, 1000)
    return input('doc').value !== ''
  }

  const authorsOf = (f: Fields) => { try { return parseAuthors(f.authors) } catch { return [] } }
  const dateOf = (f: Fields) => { try { return parseDate(f.date) } catch { return undefined } }
  const today = () => new Date().toISOString().slice(0, 10)

  /** a line of a list, its code spans and bold as elements, the rest as text */
  const note = (list: HTMLElement, line: string) => {
    const li = document.createElement('li')
    for (const part of noteParts(line)) {
      if (part.code) { const code = document.createElement('code'); code.className = 'font-mono text-xs'; code.textContent = part.text; li.append(code) } else if (part.bold) { const b = document.createElement('strong'); b.textContent = part.text; li.append(b) } else li.append(part.text)
    }
    list.append(li)
  }

  /** the facts of the post as it will be once it is merged: a row of label and value, the value muted when it is a note on the lack of one */
  const facts = (rows: [string, string, boolean?][]) => {
    el.facts.replaceChildren()
    for (const [label, value, muted] of rows) {
      const dt = document.createElement('dt')
      dt.className = 'text-secondary'
      dt.textContent = label
      const dd = document.createElement('dd')
      dd.className = muted ? 'text-muted [overflow-wrap:anywhere]' : 'text-ink [overflow-wrap:anywhere]'
      dd.textContent = value
      el.facts.append(dt, dd)
    }
  }

  /** what happens after the issue form is submitted, in order */
  function steps () {
    const ol = document.createElement('ol')
    ol.className = 'grid list-decimal gap-0.5 pl-4'
    const item = (...parts: (string | HTMLElement)[]) => { const li = document.createElement('li'); li.append(...parts); ol.append(li) }
    const code = (value: string) => { const c = document.createElement('code'); c.className = 'font-mono'; c.textContent = value; return c }
    item('Submit the form on GitHub.')
    item('In a few minutes the issue gets a link to a pull request, with a preview of the post.')
    item('To change the post, edit the doc, then comment ', code('/update'), ' on the issue.')
    item('When it’s right, a teammate merges the pull request to publish it.')
    el.issueHint.replaceChildren(ol)
  }

  // the authors are kept on this device, as a convenience: nothing else of the form is. Storage can be missing or refuse, so every use is guarded
  const AUTHORS_KEY = 'dpimap-blog-authors'
  const storedAuthors = () => { try { return (localStorage.getItem(AUTHORS_KEY) ?? '').slice(0, 1000) } catch { return '' } }
  const storeAuthors = (value: string) => { try { if (value.trim()) localStorage.setItem(AUTHORS_KEY, value); else localStorage.removeItem(AUTHORS_KEY) } catch { /* not kept */ } }

  // everything that follows the form's fields: errors under the fields, the issue link, and, once there is a post, its header, the facts,
  // the index entry, the share card and the file. None of it fetches again.
  function update () {
    const f = fields()
    saveHash()
    const problems = fieldProblems(f)
    for (const name of ['doc', 'authors', 'date'] as const) errorLine(name, problems[name])
    const url = shown || unreachable ? issueUrl(repository, f, shown?.title) : undefined
    if (url) {
      el.issue.href = url; el.issue.setAttribute('aria-disabled', 'false')
      if (sent) steps(); else el.issueHint.textContent = 'Opens the issue form in a new tab with these filled in. You need a GitHub account with write access to submit it.'
    } else {
      sent = false
      el.issue.removeAttribute('href'); el.issue.setAttribute('aria-disabled', 'true'); el.issueHint.textContent = issueHint
    }
    // the example post, until a doc is shown: the fields as typed, or their placeholders
    const exampleDate = dateOf(f) ?? (form.elements.namedItem('date') as HTMLInputElement).placeholder
    el.exampleDate.setAttribute('datetime', exampleDate)
    el.exampleDate.textContent = formatDate(exampleDate)
    el.exampleAuthors.textContent = authorsOf(f).join(', ') || (form.elements.namedItem('authors') as HTMLInputElement).placeholder
    if (!shown) return
    const authors = authorsOf(f)
    const date = dateOf(f) ?? today()
    const description = oneLine(f.description, LIMITS.descriptionChars)
    const names = el.post.querySelector<HTMLElement>('.paper-authors')
    if (names) { names.textContent = authors.join(', '); names.hidden = !authors.length }
    const time = el.post.querySelector('time')
    if (time) { time.setAttribute('datetime', date); time.textContent = formatDate(date) }
    el.markdownText.value = shown.file(f)

    facts([
      ['URL', `${site}/blog/${shown.slug}/`],
      ['Title', shown.title],
      ['Date', f.date.trim() ? formatDate(date) : `${formatDate(date)}, the day the pull request is opened`],
      ['Authors', authors.length ? authors.join(', ') : 'none yet', !authors.length],
      ['Description', description || 'none', !description],
      ...(shown.images > 0 ? [['Images', String(shown.images)] as [string, string]] : [])
    ])

    // the entry the index shows: its own markup, with this post's words; without a description, the post's first paragraph, cut
    const indexText = description || excerpt(shown.body, INDEX_CHARS)
    text('[data-index-year]', date.slice(0, 4), el.index)
    text('.ins-meta time', formatDate(date, true), el.index)
    el.index.querySelector('.ins-meta time')?.setAttribute('datetime', date)
    text('h3 a', shown.title, el.index)
    const authorsLine = el.index.querySelector<HTMLElement>('.ins-authors')
    if (authorsLine) { authorsLine.textContent = authors.join(', '); authorsLine.hidden = !authors.length }
    const desc = el.index.querySelector<HTMLElement>('.ins-desc')
    if (desc) { desc.textContent = indexText; desc.hidden = !indexText }

    // the share card: the tags Layout.astro writes for a post (the title with the site's name, the description or the first paragraph cut at 160, the site's image)
    text('[data-share-domain]', new URL(site).host, el.share)
    text('[data-share-title]', `${shown.title} - DPI Map`, el.share)
    text('[data-share-description]', description || excerpt(shown.body, SHARE_CHARS) || SITE_DESCRIPTION, el.share)
    el.descriptionHint.textContent = description ? '' : 'There is no description, so the index and the share card use the post’s first paragraph, cut. A description written for them reads better: add one in the form.'
  }

  /** The converted doc, drawn: what to do, the facts, the post in the site's styling, its file to read */
  async function draw (converted: import('../../BlogConvert').Converted, lib: typeof import('../../BlogConvert'), renderPost: typeof import('../../BlogRender').renderPost) {
    for (const url of shown?.urls ?? []) URL.revokeObjectURL(url)
    const { toMarkdown, postFile } = lib
    const urls = new Map(converted.pictures.map(picture => [picture.name, URL.createObjectURL(new Blob([picture.bytes as BlobPart], { type: picture.type }))]))
    const slug = slugify(converted.title, 'post')
    el.body.innerHTML = await renderPost(toMarkdown(converted, name => urls.get(name)!))
    el.post.querySelector('h1')!.textContent = converted.title
    // the post's file, from the same code that writes it: the frontmatter from the form's fields (today's date if there is none), then the body
    const body = toMarkdown(converted, name => `/blog/${slug}/${name}`)
    shown = {
      title: converted.title, slug, body, images: converted.pictures.length, urls: [...urls.values()],
      file: f => postFile({ title: converted.title, date: dateOf(f) ?? today(), description: oneLine(f.description, LIMITS.descriptionChars) || undefined, authors: authorsOf(f) }, body)
    }
    // what is to be done in the doc: the import's to-dos (what it did stays in the pull request's notes)
    const todo = [...converted.notes.todo]
    if (taken.includes(slug)) todo.unshift(`There is already a post or page at /blog/${slug}/, so the import would refuse this doc. In the doc, give it a different title.`)
    el.todoList.replaceChildren()
    for (const line of todo) note(el.todoList, line)
    el.todoBox.hidden = todo.length === 0
    el.badge.textContent = todo.length ? `${todo.length} to do` : 'Ready'
    el.badge.className = 'rounded-md border px-2 py-px text-xs font-semibold ' + (todo.length ? 'border-wip-line bg-wip text-amber-900' : 'border-yes-line bg-yes text-green-900')
    el.notes.hidden = false
    el.notes.open = todo.length > 0
    el.post.hidden = false
    el.example.hidden = true
    el.markdown.hidden = false
    unreachable = false
    update()
  }

  async function load () {
    const f = fields()
    let id: string
    try { id = docIdFrom(f.doc) } catch {
      problem(f.doc.trim() ? undefined : 'Paste the link to the Google Doc first.')
      errorLine('doc', f.doc.trim() ? 'That isn’t a link to a Google Doc.' : undefined)
      setStatus('')
      return
    }
    const mine = ++generation
    running?.abort()
    running = new AbortController()
    el.refresh.disabled = true
    el.refresh.querySelector('svg')!.classList.add('animate-spin')
    problem()
    setStatus('Fetching the doc from Google…')
    el.post.style.opacity = '.5'
    try {
      const bytes = await fetchDocxInBrowser(id, { signal: running.signal })
      if (mine !== generation) return
      setStatus('Converting…')
      const [lib, { renderPost }] = await Promise.all([import('../../BlogConvert'), import('../../BlogRender')])
      const converted = await lib.convertDocx(bytes)
      if (mine !== generation) return
      await draw(converted, lib, renderPost)
      setStatus(`The preview of the doc as it is now, ${new Date().toLocaleTimeString('en-GB')}. Edit the doc and refresh to see changes.`, true)
    } catch (error) {
      if (mine !== generation || (error as PreviewProblem).kind === 'cancelled') return
      for (const url of shown?.urls ?? []) URL.revokeObjectURL(url)
      shown = undefined
      unreachable = (error as PreviewProblem).kind === 'unreachable'
      el.post.hidden = true
      el.example.hidden = false
      el.notes.hidden = true
      el.markdown.hidden = true
      setStatus('')
      problem(error instanceof Refusal ? error.message : 'The doc couldn’t be converted here. You can still open the issue, which converts it again, and says what went wrong.')
      update()
    } finally {
      if (mine === generation) { el.refresh.disabled = false; el.refresh.querySelector('svg')!.classList.remove('animate-spin'); el.post.style.opacity = '' }
    }
  }

  // typing a link waits a moment; pasting one doesn't
  form.addEventListener('input', event => {
    sent = false
    if ((event.target as HTMLInputElement).name === 'authors') storeAuthors(input('authors').value)
    update()
    if ((event.target as HTMLInputElement).name !== 'doc') return
    clearTimeout(timer)
    const f = fields()
    try { docIdFrom(f.doc) } catch { return }
    timer = setTimeout(load, (event as InputEvent).inputType === 'insertFromPaste' ? 0 : 700)
  })
  form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); void load() })
  el.refresh.addEventListener('click', () => { clearTimeout(timer); void load() })
  el.issue.addEventListener('click', event => {
    if (el.issue.getAttribute('aria-disabled') !== 'true') {
      sent = true
      steps()
    } else {
      event.preventDefault()
      const f = fields()
      const problems = fieldProblems(f)
      if (!f.doc.trim() || problems.doc) errorLine('doc', problems.doc ?? 'Paste the link to the Google Doc.')
      if (!f.authors.trim() || problems.authors) errorLine('authors', problems.authors ?? 'Add at least one author.')
    }
  })
  // a shared link: fill the form from it and load the doc. Editing the address's # in the tab does the same
  const fromAddress = () => {
    const hasDoc = fromHash()
    // authors the address doesn't give are this device's last ones, if it has any; the address wins when it has them
    if (!input('authors').value.trim()) input('authors').value = storedAuthors()
    update()
    if (hasDoc) void load()
  }
  window.addEventListener('hashchange', fromAddress)
  fromAddress()
}
