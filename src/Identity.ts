import json from '../public/data/2026-03-31/2026-03-31-identity.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { dpiStatus } from './DpiTest'
import { fixURL } from './Util'
import { schemas, toRecord } from './Schema'

const schema = schemas.id

export const IDs = json.map(x => {
  const record = toRecord(schema, x, {
    url: (url, get) => fixURL('id', get('country'), url),
    status: normaliseImplementationStatus,
  })
  return { ...record, 'DPI Status': dpiStatus('id', record) }
}).sort(statusSort)
