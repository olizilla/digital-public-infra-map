import { releaseRows } from './Release'
import { normaliseImplementationStatus, statusSort } from './Status'
import { dpiStatus } from './DpiTest'
import { fixURL } from './Util'
import { schemas, toRecord } from './Schema'

const schema = schemas.data

export const DataExchanges = releaseRows.data.map(x => {
  const record = toRecord(schema, x, {
    url: (url, get) => fixURL('data', get('country'), url),
    status: normaliseImplementationStatus,
  })
  return { ...record, 'DPI Status': dpiStatus('data', record) }
}).sort(statusSort)
