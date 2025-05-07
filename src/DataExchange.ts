import dataJSON from '../public/data/2024-11-19.exchange.json'

export const DataExchanges = dataJSON.map(x => {
  return {
    'Country': x['Country'],
    'Name': x['Data exchange system name'],
    'Status': x['Status of implementation'],
    'National or Regional': x['National/ Regional'],
    "Sector-specific or Cross-sectoral": x["Sector-specific/ Cross-sectoral"],
    "Semantic interoperability": x["Semantic interoperability"],
    "Real-time": x["Data is shared in (near) real-time through the Data Exchange"],
    "Scalable architecture": x["Technology architecture of the DES is scalable"],
    "Governing Entity": x["Public-interest entity governing the development and operations of the Data Exchange"],
    "Ownership": x["Ownership"],
    "Onboarding docs": "Unknown",
    "Allowed users": x["Types of entities that can participate  in the data exchange"],
    "Auditable": x["The system provides mechanisms to audit data exchanges"],
    "Procedural rules established": x["Procedural rules for the Data Exchange (access restrictions, protections, etc.) are established"],
    "Coordination unit": x["Coordination unit"],
    "Public entity users": x["Public entities other than the Data Exchange operator use the system"],
    "Impact metrics exist": x["Impact metrics of the Data Exchange exist"],
    "Additional Info": x["0 Additional Information"],
    "Notes": x["0 Notes"],
  }
})

export const DataExchangeFlags = [
  'Semantic interoperability',
  'Real-time',
  'Scalable architecture',
  'Onboarding docs',
  'Auditable',
  'Procedural rules established',
  'Public entity users',
  'Impact metrics exist',
]

export const DataExchangeText = [
  'Governing Entity',
  'Allowed users',
  'Ownership',
  'National or Regional',
  'Sector-specific or Cross-sectoral',
  'Coordination unit',
]

export const DataExchangeHeadlines = DataExchangeText.slice(0, 2)
export const DataExchangeOtherText = DataExchangeText.slice(2)
