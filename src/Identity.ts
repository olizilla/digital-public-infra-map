import json from '../public/data/2024-11-19.identity.json'

export const IDs = json.map(x => {
  return {
    'Country': x['Country'],
    "Region": x['Region'],
    "Income classification": "Low-income countries",
    'Claim digital ID': x['Claim of digital (or electronic) ID'],
    'Name': x['Digital ID name'],
    'URL': x['URL'],
    "Uses biometrics": x["Collects or uses biometric data"],
    'Status': x['Status of implementation'],
    "ID or Civil Registry Act": x["ID or Civil Registry Act"],
    "Regulation for digital ID": x["Regulation for digital ID"],
    "Enables authentication": x["Digital authentication function"],
    "Enables KYC": x["Enables KYC packet collection for service provision"],
    "Enables authentication via government portal": x["Authentication possible through a government portal"],
    "Identity act codifies legal status": x["Identity act codifies digital ID legal status\n"],
    "Governing entity": x["Governing entity"],
    "Governance structure": x["Institutional governance structure"],
    "Court oversight": x["Court oversight on digital ID system"],
    "Operators accountable to authority": x["Accountability of ID executors to authority"],
    "Legally binding redress mechanism": x["Legally binding redress mechanism\n"],
    "Terms of data storage and sharing available": x["Personal data collection, storage and sharing terms publicly available\n"],
    "Data Protection Act exists": x["National Data Protection Act exists"],    
    "Identity act sets up procedural rules": x["Identity act or secondary policy sets up procedural rules for digital ID"],
    "Data leak disclosure process exists": x["Processes to notify individuals about personal data leaks in place\n"],
    "Data handling terms exist": x["Data handling terms"],
    "Identity act clarifies relationship with feeder documents": x["Identity act clarifies relationship with feeder documents"],
    "Used by at least one external entity": x["Use of digital ID infrastructure by at least one external entity\n"],
    "Two or more sectoral use cases enabled": x["Two or more sectoral use cases enabled"],
    "Tech support organizations": x["Technical support organizations identified\n"],
    "Notes": x["Notes"]
  }
})

export const IDFlags = [
  'Claim digital ID',
  'Regulation for digital ID',
  'ID or Civil Registry Act',
  'Identity act codifies legal status',
  'Identity act sets up procedural rules',
  'Court oversight',
  'Operators accountable to authority',
  'Legally binding redress mechanism',
  'Terms of data storage and sharing available',
  'Data Protection Act exists',
  'Data leak disclosure process exists',
  'Data handling terms exist',
  'Identity act clarifies relationship with feeder documents',
  'Uses biometrics',
  'Enables authentication',
  'Enables KYC',
  'Enables authentication via government portal',
  'Used by at least one external entity',
  'Two or more sectoral use cases enabled',
]

export const IDText = [
  'Governing entity',
  'Governance structure',
  'Tech support organizations'
]

export const IDTextHeadlines = IDText.slice(0, 2)
export const IDTextOtherText = IDText.slice(2)
