// /data/latest/<resource>.csv: the tables of the release the site shows (src/ReleaseFiles.ts) as CSV,
// made at build time from the release's JSON, which is the canonical format (D67). Not committed, and
// nothing on the site links to it. Its columns are the JSON's keys, in order, as the header; RFC 4180
// quoting; UTF-8 without a BOM; \n line endings. A missing value is NA, as in the JSON. The rest of
// /data/latest/ redirects to the release's own files (public/_redirects, written by data:build), which
// never redirects these paths.
import type { APIRoute, GetStaticPaths } from 'astro'
import { writeCSV } from '../../../../lib/changesets/csv.ts'
import { releaseTables } from '../../../ReleaseFiles'

type Name = keyof typeof releaseTables

export const getStaticPaths = (() => Object.keys(releaseTables).map(name => ({ params: { name } }))) satisfies GetStaticPaths

/** A JSON value as a cell: strings as they are, and numbers and other values as JSON */
const cell = (value: unknown) => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)

export const GET: APIRoute = ({ params }) => {
  const rows = releaseTables[params.name as Name]
  const header = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const csv = writeCSV([header, ...rows.map(row => header.map(key => cell(row[key])))])
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
}
