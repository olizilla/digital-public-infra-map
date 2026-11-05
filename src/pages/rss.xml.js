import rss from '@astrojs/rss'
import { getInsights, kindLabels } from '../Insights'

// every entry in Insights (/blog/): posts, talks, papers, sessions and the report.
// Entries with no page here link to their source.
export async function GET (context) {
  const insights = await getInsights()
  return rss({
    title: 'DPI Map Insights',
    description: 'Posts, talks and papers from the Digital Public Infrastructure Map team at UCL IIPP, and notes from the DPI Measurement Community of Practice.',
    site: context.site,
    items: insights.map(i => ({
      title: i.number !== undefined ? `Session ${i.number}: ${i.title}` : i.title,
      pubDate: i.date,
      description: i.description,
      link: i.href,
      categories: [kindLabels[i.kind]]
    }))
  })
}
