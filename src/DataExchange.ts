import dataJSON from '../public/data/2026-03-31/2026-03-31-exchange.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'
import { schemas, toRecord, displayTitles, headlineTitles, otherTextTitles } from './Schema'

const schema = schemas.data

type DataExchangeType = typeof dataJSON[number]

export function dataExchangeDPIStatus(x: DataExchangeType): "DPI" | "WIP" | "NA" {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])
  if (x['Count for DPI'] === 1) {
    return 'DPI'
  }
  if (implStatus === 'Active' || implStatus === 'Pilot') {
    return 'WIP'
  }
  return 'NA'
}

export const DataExchanges = dataJSON.map(x => {
  return {
    ...toRecord(schema, x, {
      url: (url, get) => fixURL('data', get('country'), url),
      status: normaliseImplementationStatus,
    }),
    'DPI Status': dataExchangeDPIStatus(x),
  }
}).sort(statusSort)

export const DataExchangeFlags = displayTitles(schema, 'flag')
export const DataExchangeText = displayTitles(schema, 'text')
export const DataExchangeHeadlines = headlineTitles(schema)
export const DataExchangeOtherText = otherTextTitles(schema)
