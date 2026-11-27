// The post as the site shows it, for the preview page (/blog/new/, D98): the Markdown that the import writes, rendered in the
// browser with what Astro does to a post's Markdown (astro.config.mjs has no plugins of its own, so that is
// @astrojs/markdown-remark's defaults): remark-parse, remark-gfm, remark-smartypants, remark-rehype, the headings' ids. Left out: the
// syntax highlighting of code blocks (shiki), which the preview doesn't need, and raw HTML, which a post doesn't have.
// The HTML is sanitized once more (a backstop, as the converter's own allow-list is the first line), with images from `blob:` URLs
// allowed, as the preview shows the doc's pictures from the bytes it fetched.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkSmartypants from 'remark-smartypants'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import GithubSlugger from 'github-slugger'

interface Hast { type: string, tagName?: string, value?: string, properties?: Record<string, unknown>, children?: Hast[] }

const text = (node: Hast): string => node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(text).join('')

/** Headings get an id from their text, as Astro gives them (github-slugger) */
function headingIds () {
  return (tree: Hast) => {
    const slugger = new GithubSlugger()
    const visit = (node: Hast) => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName ?? '') && !node.properties?.id) node.properties = { ...node.properties, id: slugger.slug(text(node)) }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

const SCHEMA = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id'] },
  protocols: { ...defaultSchema.protocols, src: ['http', 'https', 'blob'] },
  clobber: [],
  clobberPrefix: ''
}

/** The HTML of a post's Markdown (its body, with no title), safe to put in the page */
export async function renderPost (markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkSmartypants)
    .use(remarkRehype)
    .use(headingIds as never)
    .use(rehypeSanitize, SCHEMA as never)
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
}
