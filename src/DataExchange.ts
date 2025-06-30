import dataJSON from '../public/data/2025-06-30/2025-06-30-exchange.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'

type DataExchangeType = typeof dataJSON[number]

export function dataExchangeDPIStatus(x: DataExchangeType) {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])
  if (x['Count for DPI-like data exchange system'] === 1) {
    return 'DPI'
  }
  if (implStatus === 'Active' || implStatus === 'Pilot') {
    return 'WIP'
  }
  return 'NA'
}

export const DataExchanges = dataJSON.map(x => {
  return {
    'Country': x['Country/Region'],
    'Last updated': x['Last updated'],
    'Name': x['Data exchange system name'],
    'URL': fixURL('data', x['Country/Region'], x['URL']),
    'Status of implementation': normaliseImplementationStatus(x['Status of implementation']),
    "Base technical architecture": x['Base technical architecture'],
    'National or Regional': x['National/ Regional'],
    "Sector-specific or Cross-sectoral": x["Sector-specific/ Cross-sectoral"],
    "Semantic interoperability": x["Semantic interoperability"],
    "Real-time sharing": x["(Near) real-time sharing"],
    "Scalable architecture": x["Scalable technology architecture"],
    "Governing Entity": x["Governing entity"],
    "Ownership": x["Ownership"],
    "Enrolment and participation information": x["Enrolment and participation information"],
    "Permitted participants": x["Permitted participants"],
    "Auditable": x["Audit mechanism"],
    "Procedural rules for data mgmt": x["Procedural rules for data mgmt."],
    "Coordination unit": x["Coordination unit"],
    "Used by more than one public entity": x['Used by more than one public entity'],
    "Impact metrics": x["Impact metrics"],
    'DPI Status': dataExchangeDPIStatus(x),
  }
}).sort(statusSort)

export const DataExchangeFlags = [
  'Semantic interoperability',
  'Real-time sharing',
  'Scalable architecture',
  'Auditable',
  'Procedural rules for data mgmt',
  'Enrolment and participation information',
  'Used by more than one public entity',
  'Impact metrics',
]

export const DataExchangeText = [
  'Base technical architecture',
  'Status of implementation',
  'Governing Entity',
  'Coordination unit',
  'National or Regional',
  'Sector-specific or Cross-sectoral',
  'Permitted participants',
  'Ownership',
]

export const DataExchangeHeadlines = DataExchangeText.slice(0, 2)
export const DataExchangeOtherText = DataExchangeText.slice(2)
