import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { csvLoader } from "@ascorbic/csv-loader"

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/pages/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
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

export const collections = { 
  blog, 
  cop, 
  dpiAttributes, 
  idIndicators,
  payIndicators,
  dataIndicators
}
