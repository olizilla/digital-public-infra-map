import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { csvLoader } from "@ascorbic/csv-loader"
import { changesetLoader } from './ChangesetLoader'

// Insights (/blog/): posts hosted here, entries that live elsewhere, and the Community of Practice
// sessions, merged and ordered by src/Insights.ts. Dates are the original publication dates.
// A date is only what is known: a year (2025), a month (2025-03), a day (2025-03-12), or absent.
// Never a guess. A YAML date (2025-03-12) arrives as a Date and a year as a number; both become a string,
// so the precision survives to the page. See formatDate in src/Insights.ts.
const partialDate = z.union([z.date(), z.number(), z.string()])
  .transform(v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
  .pipe(z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'a date is YYYY, YYYY-MM or YYYY-MM-DD'))

const kind = z.enum(['post', 'article', 'talk', 'paper', 'case', 'session', 'report'])

// posts hosted on this site, each a page at /blog/<file name>/. A post first published
// elsewhere names its `source` URL and that site's name as `publisher`, for the
// "First published on" line (src/layouts/Post.astro).
const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/pages/blog" }),
  schema: z.object({
    title: z.string(),
    date: partialDate.optional(),
    description: z.string().optional(),
    authors: z.array(z.string()).optional(),
    kind: kind.optional().default('post'),
    source: z.string().url().optional(),
    publisher: z.string().optional(),
    published: z.boolean().optional().default(true)
  })
})

// entries that live on other sites: talks, papers and articles, and the pinned report. One with
// neither a body nor a `pdf` links straight to `url`. One with a body, a paper's abstract verbatim,
// or a `pdf` has a landing page at /blog/<id>/ (src/pages/blog/[id].astro): the abstract, or the
// `description` as a summary where there's no abstract, a button to download `pdf`, a link to the
// record at `url` named by `urlLabel`, a citation from `publication` and `doi`, the `licence` the
// abstract is shared under, and `places` on the map it's about (System IDs or country names).
// The pinned card's button downloads `pdf`, and its `links` sit beside the button.
const links = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/links" }),
  schema: z.object({
    title: z.string(),
    date: partialDate.optional(),
    kind,
    url: z.string(),
    publisher: z.string().optional(),
    description: z.string().optional(),
    authors: z.array(z.string()).optional(),
    image: z.string().optional(),
    pdf: z.string().optional(),
    urlLabel: z.string().optional(),
    publication: z.string().optional(),
    doi: z.string().optional(),
    licence: z.string().optional(),
    places: z.array(z.string()).optional(),
    links: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
    pinned: z.boolean().optional().default(false),
    published: z.boolean().optional().default(true)
  })
})

const cop = defineCollection({
  loader: glob({ pattern: "**/!(index)*.md", base: "./src/pages/measurement-community" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    published: z.boolean().optional().default(true)
  })
})

const dpiAttributes = defineCollection({
  loader: csvLoader({
    fileName: "public/indicators/dpi-attributes.csv",
    idField: 'id'
  }),
  schema: z.object({
    id: z.coerce.string(),
    attribute: z.string(),
    category: z.string(),
    description: z.string()
  })
})

const idIndicators = defineCollection({
  loader: csvLoader({
    fileName: "public/indicators/dpi-indicators-id.csv",
    idField: 'id'
  }),
  schema: z.object({
    id: z.coerce.string(),
    indicator: z.coerce.string(),
  })
})

const payIndicators = defineCollection({
  loader: csvLoader({
    fileName: "public/indicators/dpi-indicators-pay.csv",
    idField: 'id'
  }),
  schema: z.object({
    id: z.coerce.string(),
    indicator: z.coerce.string(),
  })
})

const dataIndicators = defineCollection({
  loader: csvLoader({
    fileName: "public/indicators/dpi-indicators-data.csv",
    idField: 'id'
  }),
  schema: z.object({
    id: z.coerce.string(),
    indicator: z.coerce.string(),
  })
})

// every changeset, released or pending (D66), checked against the changeset schema by lib/changesets
const changesets = defineCollection({
  loader: changesetLoader()
})

export const collections = { 
  blog, 
  links,
  cop, 
  dpiAttributes, 
  idIndicators,
  payIndicators,
  dataIndicators,
  changesets
}
