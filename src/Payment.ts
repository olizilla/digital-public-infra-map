import { releaseRows } from './Release'
import { normaliseImplementationStatus, statusSort } from './Status'
import { dpiStatus } from './DpiTest'
import { fixURL } from './Util'
import { schemas, toRecord } from './Schema'

const schema = schemas.pay

export const Payments = releaseRows.pay.map(x => {
  const record = toRecord(schema, x, {
    url: (url, get) => fixURL('pay', get('country'), url),
    status: normaliseImplementationStatus,
  })
  return { ...record, 'DPI Status': dpiStatus('pay', record) }
}).sort(statusSort)
