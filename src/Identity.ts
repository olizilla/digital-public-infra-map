import json from '../public/data/2025-03-31/2025-03-31-identity.json'
import { normaliseImplementationStatus, statusSort } from './Status'

type IdentityType = typeof json[number]

/**
 * Derive DPI status for project.
 * @returns "DPI" | "WIP" | "NA"
 */
export function identityDPIStatus(x: IdentityType) {
  const implStatus = normaliseImplementationStatus(x['Status of implementation'])
  if (
    x['Two or more sectoral use cases enabled'] === 'Yes'
    && x['Digital authentication function'] === 'Yes'
    && x['Claim of digital (or electronic) ID'] === 'Yes'
    && implStatus === 'Active'
  ) return 'DPI'

  if (
    implStatus === 'Active'
    || implStatus === 'Pilot'
  ) return 'WIP'

  return 'NA'
}

export const IDs = json.map(x => {
  return {
    'DPI Status': identityDPIStatus(x),
    'Country': x['Country'],
    "Income classification": "Low-income countries",
    'Claim digital ID': x['Claim of digital (or electronic) ID'],
    'Name': x['Digital ID name'],
    'URL': x['URL'],
    "Uses biometrics": x["Collects or uses biometric data"],
    'Status': normaliseImplementationStatus(x['Status of implementation']),
    "ID or Civil Registry Act": x["ID or Civil Registry Act"],
    "Regulation for digital ID": x["Regulation for digital ID"],
    "Enables authentication": x["Digital authentication function"],
    "Enables KYC": x["Enables KYC packet collection for service provision"],
    "Enables authentication via government portal": x["Authentication possible through a government portal"],
    "Identity act codifies legal status": x["Identity act codifies digital ID legal status\n"],
    "Governing entity": x["Governing entity"],
    "Type of governing entity": x["Type of governing entity"],
    "Court oversight": x["Court oversight on digital ID system"],
    "Operators accountable to authority": x["Accountability of ID executors to authority"],
    "Legally binding redress mechanism": x["Legally binding redress mechanism\n"],
    "Terms of data storage and sharing available": x["Personal data collection, storage and sharing terms publicly available\n"],
    "Data Protection Act exists": x["National Data Protection Act exists"],    
    "Procedural rules for data management": x["Identity act or secondary policy sets up procedural rules for digital ID"],
    "Data leak disclosure process exists": x["Processes to notify individuals about personal data leaks in place\n"],
    "Data handling terms exist": x["ID data handling terms"],
    "Identity act clarifies relationship with feeder documents": x["Identity act clarifies relationship with feeder documents"],
    "Two or more sectoral use cases enabled": x["Two or more sectoral use cases enabled"],
    "Notes": x["Notes"]
  }
}).sort(statusSort)

export const IDFlags = [
  'Claim digital ID',
  'Regulation for digital ID',
  'ID or Civil Registry Act',
  'Identity act codifies legal status',
  'Procedural rules for data management',
  'Court oversight',
  'Operators accountable to authority',
  'Terms of data storage and sharing available',
  'Data Protection Act exists',
  'Data leak disclosure process exists',
  'Data handling terms exist',
  'Identity act clarifies relationship with feeder documents',
  'Uses biometrics',
  'Enables authentication',
  'Enables KYC',
  'Enables authentication via government portal',
  'Two or more sectoral use cases enabled',
]

export const IDText = [
  'Governing entity',
  'Type of governing entity',
  'Legally binding redress mechanism',
]

export const IDTextHeadlines = IDText.slice(0, 2)
export const IDTextOtherText = IDText.slice(2)
