import json from '../public/data/2026-03-31/2026-03-31-identity.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'
import { schemas, toRecord, displayTitles, headlineTitles, otherTextTitles } from './Schema'

const schema = schemas.id

type IdentityType = typeof json[number]

/**
 * Derive DPI status for project.
 * @returns "DPI" | "WIP" | "NA"
 */
export function identityDPIStatus(x: IdentityType): "DPI" | "WIP" | "NA" {
  const implStatus = normaliseImplementationStatus(x['Status of Implementation'])
  if (x['Count for DPI'] === 1) {
    return 'DPI'
  }
  if (implStatus === 'Active' || implStatus === 'Pilot'){
    return 'WIP'
  }
  return 'NA'
}

export const IDs = json.map(x => {
  return {
    ...toRecord(schema, x, {
      url: (url, get) => fixURL('id', get('country'), url),
      status: normaliseImplementationStatus,
    }),
    'DPI Status': identityDPIStatus(x),
  }
}).sort(statusSort)

export const IDFlags = displayTitles(schema, 'flag')
export const IDText = displayTitles(schema, 'text')
export const IDTextHeadlines = headlineTitles(schema)
export const IDTextOtherText = otherTextTitles(schema)
