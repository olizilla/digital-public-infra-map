import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/pages/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    published: z.boolean().optional().default(true)
  })
})

export const collections = { blog }
