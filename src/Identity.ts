import json from '../public/data/2025-06-30/2025-06-30-identity.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'

type IdentityType = typeof json[number]

/**
 * Derive DPI status for project.
 * @returns "DPI" | "WIP" | "NA"
 */
export function identityDPIStatus(x: IdentityType): "DPI" | "WIP" | "NA" {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])
  if (x['DPI based digital ID\n(to count for Visualisation)'] === 1) {
    return 'DPI'
  }
  if (implStatus === 'Active' || implStatus === 'Pilot'){
    return 'WIP'
  }
  return 'NA'
}

export const IDs = json.map(x => {
  return {
    'Country': x['Country/Region'],
    'Last updated': x['Last updated\nDD:MM:YY'],
    'Claim of digital (or electronic) ID': x['Claim of digital (or electronic) ID'],
    'Name': x['Digital ID name'],
    'URL': fixURL('id', x['Country/Region'], x['URL']),
    "Collects or uses biometric data": x["Collects or uses biometric data"],
    'Status of implementation': normaliseImplementationStatus(x['Status of implementation']),
    "ID or Civil Registry Act": x["ID or Civil Registry Act"],
    "Regulation for digital ID": x["Regulation for digital ID"],
    "Digital authentication function": x["Digital authentication function"],
    "Enables KYC packet collection": x["Enables KYC packet collection for service provision"],
    "Authentication possible through a government portal": x["Authentication possible through a government portal"],
    "Identity act codifies digital ID legal status": x["Identity act codifies digital ID legal status "],
    "Governing entity": x["Governing entity"],
    "Legally binding redress mechanism": x["Legally binding redress mechanism "],
    "Terms of data storage and sharing available": x["Personal data collection, storage and sharing terms publicly available "],
    "National Data Protection Act exists": x["National Data Protection Act exists"],    
    "Identity act or secondary policy sets up procedural rules for digital ID": x["Identity act or secondary policy sets up procedural rules for digital ID"],
    "Data leak disclosure process exists": x["Processes to notify individuals about personal data leaks in place "],
    "Data handling terms exist": x["ID data handling terms"],
    "Identity act clarifies relationship with feeder documents": x["Identity act clarifies relationship with feeder documents"],
    "Two or more sectoral use cases enabled": x["Two or more sectoral use cases enabled"],
    'DPI Status': identityDPIStatus(x),
  }
}).sort(statusSort)

export const IDFlags = [
  'Claim of digital (or electronic) ID',
  'ID or Civil Registry Act',
  'Regulation for digital ID',
  'Identity act codifies digital ID legal status',
  'Identity act or secondary policy sets up procedural rules for digital ID',
  'Identity act clarifies relationship with feeder documents',
  'Terms of data storage and sharing available',
  'National Data Protection Act exists',
  'Data leak disclosure process exists',
  'Data handling terms exist',
  'Collects or uses biometric data',
  'Digital authentication function',
  'Enables KYC packet collection',
  'Authentication possible through a government portal',
  'Two or more sectoral use cases enabled',
]

export const IDText = [
  'Governing entity',
  'Status of implementation',
  'Legally binding redress mechanism',
]

export const IDTextHeadlines = IDText.slice(0, 2)
export const IDTextOtherText = IDText.slice(2)
