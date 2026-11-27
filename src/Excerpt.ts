// Plain-text summaries of a post's Markdown, for Insights (src/Insights.ts) and the post layout (src/layouts/Post.astro), and for the
// blog post preview (/blog/new/), which runs in the browser and so can't import Insights.ts (it needs Astro's content API).

// markdown as plain text, on one line: no tags, images, link targets or emphasis
export const strip = (text: string) => text
  .replace(/<[^>]+>/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

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

