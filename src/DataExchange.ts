import dataJSON from '../public/data/2026-03-31/2026-03-31-exchange.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { dpiStatus } from './DpiTest'
import { fixURL } from './Util'
import { schemas, toRecord } from './Schema'

const schema = schemas.data

export const DataExchanges = dataJSON.map(x => {
  const record = toRecord(schema, x, {
    url: (url, get) => fixURL('data', get('country'), url),
    status: normaliseImplementationStatus,
  })
  return { ...record, 'DPI Status': dpiStatus('data', record) }
}).sort(statusSort)
