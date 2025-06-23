import dataJSON from '../public/data/2025-03-31/2025-03-31-exchange.json'
import { normaliseImplementationStatus, statusSort } from './Status'

type DataExchangeType = typeof dataJSON[number]

export function dataExchangeDPIStatus(x: DataExchangeType) {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])

  if (
    x['Sector-specific/ Cross-sectoral'] === 'Cross-sectoral'
    && implStatus === 'Active'
  ) return 'DPI'

  if (
    implStatus === 'Active'
    || implStatus === 'Pilot'
  ) return 'WIP'

  return 'NA'
}

export const DataExchanges = dataJSON.map(x => {
  return {
    'DPI Status': dataExchangeDPIStatus(x),
    'Country': x['Country'],
    'Name': x['Data exchange system name'],
    'Status of implementation': normaliseImplementationStatus(x['Status of implementation']),
    'National or Regional': x['National/ Regional'],
    "Sector-specific or Cross-sectoral": x["Sector-specific/ Cross-sectoral"],
    "Semantic interoperability": x["Semantic interoperability"],
    "Real-time sharing": x["(Near) real-time sharing"],
    "Scalable architecture": x["Scalable technology architecture"],
    "Governing Entity": x["Governing entity"],
    "Ownership": x["Ownership"],
    "Onboarding docs": "Unknown",
    "Permitted participants": x["Permitted participants"],
    "Auditable": x["Audit mechanism"],
    "Procedural rules for data mgmt": x["Procedural rules for data mgmt."],
    "Coordination unit": x["Coordination unit"],
    "Enrolment and participation information": x["Enrolment and participation information"],
    "Impact metrics": x["Impact metrics"],
    "Notes": x["Notes"],
  }
}).sort(statusSort)

export const DataExchangeFlags = [
  'Semantic interoperability',
  'Real-time sharing',
  'Scalable architecture',
  'Onboarding docs',
  'Auditable',
  'Procedural rules for data mgmt',
  'Enrolment and participation information',
  'Impact metrics',
]

export const DataExchangeText = [
  'Governing Entity',
  'Coordination unit',
  'Status of implementation',
  'Permitted participants',
  'Ownership',
  'National or Regional',
  'Sector-specific or Cross-sectoral',
]

export const DataExchangeHeadlines = DataExchangeText.slice(0, 2)
export const DataExchangeOtherText = DataExchangeText.slice(2)
