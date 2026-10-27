import json from '../public/data/2026-03-31/2026-03-31-payment.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'
import { schemas, toRecord, displayTitles, headlineTitles, otherTextTitles } from './Schema'

const schema = schemas.pay

type PaymentType = typeof json[number]

export function paymentDPIStatus(x: PaymentType): "DPI" | "WIP" | "NA" {
  const implStatus = normaliseImplementationStatus(x['Status of Implementation'])
  if (x['Count for DPI'] === 1) { 
    return 'DPI'
  }
  if (implStatus === 'Active' || implStatus === 'Pilot') {
    return 'WIP'
  }
  return 'NA'
}

export const Payments = json.map(x => {
  return {
    ...toRecord(schema, x, {
      url: (url, get) => fixURL('pay', get('country'), url),
      status: normaliseImplementationStatus,
    }),
    'DPI Status': paymentDPIStatus(x),
  }
}).sort(statusSort)

export const PaymentFlags = displayTitles(schema, 'flag')
export const PaymentText = displayTitles(schema, 'text')
export const PaymentHeadlines = headlineTitles(schema)
export const PaymentOtherText = otherTextTitles(schema)
