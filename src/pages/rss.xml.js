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
    // An item needs a pubDate, so undated entries are left out. A partial date gets the first day of its
    // period here, in the feed only: it is padding for the feed format, not a claim about the day, and
    // it is never written back to the data.
    items: insights.filter(i => i.date).map(i => ({
      title: i.number !== undefined ? `Session ${i.number}: ${i.title}` : i.title,
      pubDate: new Date(`${i.date}${'-01-01'.slice(i.date.length - 4)}`),
      description: i.description,
      link: i.href,
      categories: [kindLabels[i.kind]]
    }))
  })
}
