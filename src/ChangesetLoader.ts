// An Astro content loader for the changesets (D66): every file in changesets/<release>/<resource>/
// and changesets/next/<resource>/, read and checked against the changeset schema by
// lib/changesets, the same code as the data build. Astro's glob() doesn't read TOML.
// Each entry is marked released, with its release's date, or pending.
//
// The build fails if anything blocks a merge (D51, S3), so a broken pending changeset fails the PR's
// preview too: a file that isn't valid TOML or a changeset (including an as_of that isn't a real
// date, S2), or a pending update or remove of a row that doesn't exist, found by replaying changesets/next/
// onto the release the site shows, with the next codebook, as `npm run data:check` does. Other items,
// like legacy warnings, are only warnings. A pending value outside the codebook isn't checked here:
// that needs scripts/validate.mjs, so `npm run data:check` catches it, in CI, and the build doesn't.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'astro/zod'
import type { Loader } from 'astro/loaders'
import { AstroError } from 'astro/errors'
import { build } from '../lib/changesets/build.ts'
import { PENDING_FOLDER, readFolders, releaseFolders } from '../lib/changesets/log.ts'
import { formatReport, withFiles } from '../lib/changesets/report.ts'
import type { Changeset, DataPackage, ReportItem } from '../lib/changesets/types.ts'
import datapackage from '../datapackage.json'
import { derivedFields, lastUpdatedAsOf } from './DpiLayer'
import { release, releaseTables } from './ReleaseFiles'

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
      const pending: Record<string, Changeset[]> = {}
      store.clear()
      for (const folder of [...releaseFolders(dir), PENDING_FOLDER]) {
        const released = folder !== PENDING_FOLDER
        const read = readFolders(dir, [folder], datapackage as DataPackage, report, { seen })
        if (!released) Object.assign(pending, read)
        for (const changesets of Object.values(read)) {
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
      // the pending round, as data:check builds it: the release the site shows, plus changesets/next/ (S3)
      const replayed = build({
        datapackage: datapackage as DataPackage,
        baseline: { id: release, tables: releaseTables },
        layers: [pending],
        baselineAsOf: lastUpdatedAsOf,
        // derived cells aren't needed, only what the replay finds
        derive: { fields: Object.fromEntries(datapackage.resources.map(r => [r.name, derivedFields])), values: () => ({}) }
      })
      report.push(...withFiles(replayed.report, Object.values(pending).flat()))
      // files it skipped, and what the replay found, as the data build reports them
      const blocking = report.filter(item => item.blocking).length
      const text = formatReport(report, `${report.length} problems in ${log}/`)
      if (blocking) throw new AstroError(`${blocking} blocking item${blocking === 1 ? '' : 's'} in ${log}/, which block a merge (D51).\n\n${text}`, 'Fix or remove the changesets listed. `npm run data:check` gives the full check, codebook values included.')
      if (report.length) logger.warn(text)
    }
  }
}
