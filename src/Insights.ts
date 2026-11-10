// Insights, /blog/: one list of everything the team has written or said, from three collections
// (src/content.config.ts): `blog`, the posts hosted here; `links`, entries that live on other sites
// and the pinned report; `cop`, the Community of Practice sessions, which keep their pages under
// /measurement-community/. A `links` entry with a body (a paper's abstract) or a PDF has a landing
// page here, /blog/<id>/ (src/pages/blog/[id].astro); one with neither links straight to its source. Used by the index (src/pages/blog/index.astro) and the feed (src/pages/rss.xml.js).
import { getCollection } from 'astro:content'

// a post is written for this site; an article is a piece on another site: a blog, a magazine, a newspaper's comment pages
// a case study is a teaching case: how one government built one system, and what it teaches
export type Kind = 'post' | 'article' | 'talk' | 'paper' | 'case' | 'session' | 'report'

export const kindLabels: Record<Kind, string> = {
  post: 'Post',
  article: 'Article',
  talk: 'Talk',
  paper: 'Paper',
  case: 'Case study',
  session: 'Session',
  report: 'Report'
}

// where an entry was first published, when that was here
export const HOME = 'DPI Map'

export interface Insight {
  id: string
  kind: Kind
  title: string
  // YYYY, YYYY-MM or YYYY-MM-DD as known, or absent: shown as "Date unknown"
  date?: string
  description: string
  authors: string[]
  // where the entry's card goes: its page here, or its source when it has no page here
  href: string
  external: boolean
  // the site it was first published on
  publisher: string
  // the original, for a hosted post first published elsewhere
  source?: string
  pinned: boolean
  // a session's number, from its file name; its title is shown without it
  number?: number
  image?: string
  // the full text's PDF: the pinned report's button, and a link under papers in the list
  pdf?: string
  links: { label: string, href: string }[]
}

const isExternal = (href: string) => /^https?:\/\//.test(href)

// a links entry with a body (an abstract) or a PDF gets a landing page here; the pinned report has its own
export const hasPage = (data: { pinned?: boolean, pdf?: string }, body?: string) => !data.pinned && Boolean(body?.trim() || data.pdf)

// a session's number from its file name (session-6, 2025-09-30-session-6-...), and its title
// without the number: "Session 5 - Measuring Just DPI" is "Measuring Just DPI"
export function sessionTitle (id: string, title: string) {
  const n = id.match(/(?:^|-)session-(\d+)(?:-|$)/)
  return {
    ...(n ? { number: Number(n[1]) } : {}),
    title: title.replace(/^Session\s+\d+\s*[:\-–—]\s*/i, '')
  }
}

// markdown as plain text, on one line: no tags, images, link targets or emphasis
const strip = (text: string) => text
  .replace(/<[^>]+>/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

// a body's prose as plain text, a paragraph after another: an abstract, for its citation meta tags
export const plainText = (body = '') => body.split(/\n\s*\n/).map(strip).filter(Boolean).join(' ')

// a short summary from the body, for entries without a description: the first paragraph of
// prose long enough to say something, else the first list item, stripped of markdown
export function excerpt (body = '', max = 300) {
  const blocks = body.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const prose = blocks.find(b => !/^(#|<|---|>|[-*] |\d+\. |import |export )/.test(b) && strip(b).length >= 80)
  const item = blocks.find(b => /^[-*] /.test(b))?.split('\n')[0].replace(/^[-*] /, '')
  const text = strip(prose ?? item ?? '')
  if (text.length <= max) return text
  // cut at a word, and drop a trailing comma or the like
  const cut = text.slice(0, max - 1)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.\-–—]+$/, '') + '…'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// a date at the precision it's known: "2025", "Mar 2025", "12 Mar 2025"; "Date unknown" for none.
// `short` leaves out the year, for a list already under its year's heading: "2025" stays, "Mar", "12 Mar".
export function formatDate (date?: string, short = false) {
  if (!date) return 'Date unknown'
  const [y, m, d] = date.split('-')
  if (!m) return y
  const month = MONTHS[Number(m) - 1]
  const day = d ? `${Number(d)} ` : ''
  return short ? `${day}${month}` : `${day}${month} ${y}`
}

// frontmatter in a post's own page (the Post layout reads it raw): a YAML date is a Date, a year a number
export function normDate (value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value === undefined || value === null || value === '' ? undefined : String(value)
}

// every published entry, newest first. The pinned report is in the list; the index shows it on its own.
export async function getInsights (): Promise<Insight[]> {
  const [posts, links, sessions] = await Promise.all([
    getCollection('blog', ({ data }) => data.published),
    getCollection('links', ({ data }) => data.published),
    getCollection('cop', ({ data }) => data.published)
  ])
  const insights: Insight[] = [
    ...posts.map(p => ({
      id: p.id,
      kind: p.data.kind,
      title: p.data.title,
      date: p.data.date,
      description: p.data.description ?? excerpt(p.body),
      authors: p.data.authors ?? [],
      href: `/blog/${p.id}/`,
      external: false,
      publisher: p.data.publisher ?? HOME,
      source: p.data.source,
      pinned: false,
      links: []
    })),
    ...links.map(l => ({
      id: l.id,
      kind: l.data.kind,
      title: l.data.title,
      date: l.data.date,
      description: l.data.description ?? excerpt(l.body),
      authors: l.data.authors ?? [],
      href: hasPage(l.data, l.body) ? `/blog/${l.id}/` : l.data.url,
      external: !hasPage(l.data, l.body) && isExternal(l.data.url),
      publisher: l.data.publisher ?? HOME,
      pinned: l.data.pinned,
      image: l.data.image,
      pdf: l.data.pdf,
      links: l.data.links ?? []
    })),
    ...sessions.map(s => ({
      id: s.id,
      kind: 'session' as const,
      ...sessionTitle(s.id, s.data.title),
      date: s.data.date.toISOString().slice(0, 10),
      description: excerpt(s.body),
      authors: [],
      href: `/measurement-community/${s.id}/`,
      external: false,
      publisher: HOME,
      pinned: false,
      links: []
    }))
  ]
  // newest first by the date string, which is right at equal precision; a year alone sorts after that
  // year's dated entries. Undated entries come last.
  return insights.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}
