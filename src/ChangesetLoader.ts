// An Astro content loader for the changesets (D66): every file in changesets/<release>/<resource>/
// and changesets/next/<resource>/, read and checked against the changeset schema by
// lib/changesets, the same code as the data build. Astro's glob() doesn't read TOML.
// Each entry is marked released, with its release's date, or pending.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'astro/zod'
import type { Loader } from 'astro/loaders'
import { PENDING_FOLDER, readFolders, releaseFolders } from '../lib/changesets/log.ts'
import { formatReport } from '../lib/changesets/report.ts'
import type { DataPackage, ReportItem } from '../lib/changesets/types.ts'
import datapackage from '../datapackage.json'

export const changesetSchema = z.object({
  /** The changeset's id, its filename */
  changeset: z.string(),
  /** The table it applies to */
  resource: z.string(),
  status: z.enum(['released', 'pending']),
  /** The release it came out in, or null if it's pending */
  release: z.string().nullable(),
  author: z.string().optional(),
  summary: z.string().optional(),
  /** Its changes, as lib/changesets reads them: checked against the changeset schema */
  changes: z.array(z.record(z.string(), z.any()))
})

export type ChangesetEntry = z.infer<typeof changesetSchema>

/** The changesets in `log`, relative to the project, by `<folder>/<resource>/<id>` */
export function changesetLoader ({ log = 'changesets' } = {}): Loader {
  return {
    name: 'changesets',
    schema: changesetSchema,
    load: async ({ store, logger, parseData, generateDigest, config }) => {
      const root = fileURLToPath(config.root)
      const dir = path.resolve(root, log)
      const report: ReportItem[] = []
      const seen = new Map<string, string>()
      store.clear()
      for (const folder of [...releaseFolders(dir), PENDING_FOLDER]) {
        const released = folder !== PENDING_FOLDER
        for (const changesets of Object.values(readFolders(dir, [folder], datapackage as DataPackage, report, { seen }))) {
          for (const c of changesets) {
            const id = `${folder}/${c.resource}/${c.id}`
            const data = await parseData({
              id,
              data: {
                changeset: c.id,
                resource: c.resource,
                status: released ? 'released' : 'pending',
                release: released ? folder : null,
                ...(c.author !== undefined ? { author: c.author } : {}),
                ...(c.summary !== undefined ? { summary: c.summary } : {}),
                changes: c.changes as Record<string, unknown>[]
              }
            })
            store.set({ id, data, digest: generateDigest(data), filePath: path.relative(root, c.path) })
          }
        }
      }
      // files it skipped, as the data build reports them
      if (report.length) logger.warn(formatReport(report, `${report.length} problems in ${log}/`))
    }
  }
}
