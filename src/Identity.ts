import json from '../public/data/2025-09-30/2025-09-30-identity.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'

type IdentityType = typeof json[number]

/**
 * Derive DPI status for project.
 * @returns "DPI" | "WIP" | "NA"
 */
export function identityDPIStatus(x: IdentityType): "DPI" | "WIP" | "NA" {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])
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
    'Country': x['Country / Region'],
    'Last updated': x['Last updated'],
    'Claim of digital ID': x['Claim of digital ID'],
    'Name': x['Digital ID name'],
    'URL': fixURL('id', x['Country / Region'], x['URL']),
    "Collects or uses biometric data": x["Collects or uses biometric data"],
    'Status of implementation': normaliseImplementationStatus(x['Status of implementation']),
    "ID or Civil Registry Act": x["ID or Civil Registry Act"],
    "Regulation for digital ID": x["Regulation for digital ID"],
    "Digital authentication function": x["Digital authentication function"],
    "Enables KYC packet collection": x["Enables KYC packet collection"],
    "Authentication through government portal": x["Authentication through government portal"],
    "Codified digital ID legal status": x["Codified digital ID legal status"],
    "Governing entity": x["Governing entity"],
    "Legally binding redress mechanism": x["Legally binding redress mechanism "],
    "Terms of data storage and sharing available": x["Terms of data storage and sharing available"],
    "National Data Protection Act": x["National Data Protection Act"],    
    "Procedural rules for digital ID enrolment": x["Procedural rules for digital ID enrolment "],
    "Data leak disclosure process": x["Data leak disclosure process"],
    "Data handling terms exist": x["ID data handling terms"],
    "Relationship with feeder documents": x["Relationship with feeder documents"],
    "Two or more sectoral use cases enabled": x["Two or more sectoral use cases enabled"],
    "Funding organizations identified": x["Funding organizations identified"],
    "Technical Support organizations identified": x["Technical support organizations identified\n"],
    'DPI Status': identityDPIStatus(x),
  }
}).sort(statusSort)

export const IDFlags = [
  'Claim of digital ID',
  'ID or Civil Registry Act',
  'Regulation for digital ID',
  'Codified digital ID legal status',
  'Procedural rules for digital ID enrolment',
  'Relationship with feeder documents',
  'Terms of data storage and sharing available',
  'National Data Protection Act',
  'Data leak disclosure process',
  'Data handling terms exist',
  'Collects or uses biometric data',
  'Digital authentication function',
  'Enables KYC packet collection',
  'Authentication through government portal',
  'Two or more sectoral use cases enabled',
]

export const IDText = [
  'Governing entity',
  'Status of implementation',
  'Legally binding redress mechanism',
  'Funding organizations identified',
  'Technical Support organizations identified'
]

export const IDTextHeadlines = IDText.slice(0, 2)
export const IDTextOtherText = IDText.slice(2)
