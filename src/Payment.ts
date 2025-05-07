import json from '../public/data/2024-11-19.payment.json'

export function fixStatus(raw: string) {
  if (!raw) return 'Unknown'
  if (raw.match(/Operating at scale/i)) return 'Active'
  if (raw.match(/Planned/i)) return 'Plan'
  return 'Unknown'
}

export const Payments = json.map(x => {
  return {
    'Country': x['Country/ Region'],
    'Name': x['Payment system name'],
    'Status': fixStatus(x['Status of payment system implementation']),
    'Active real-time payment system': x['Active real-time payment system present'],
    'Payment system type': x['Payment system type'],
    'National or Regional': x['National / Regional'],
    "Cross-border payments": x["Cross-border payments"],
    "Interoperability policy": x["Interoperability policy"],
    "Types of transactions": x["Types of transactions supported"],
    "Operator": x["Operator"],
    "Bank participation": x["Bank participation"],
    "Non-bank participation": "Unknown",
    "Participation rules": x["Participation conditions and rules"],
    "Participants": x["No. of participants* (PSPs)\n*For regional payment systems > countries"],
    "Cost of transactions": x["Cost of transactions"],
    "Annual value of transactions (USD)": x["Annual value of transactions (USD)"],
    "Annual volume of transactions": x["Annual volume of transactions"],
    "Data-handing rules": x["Data-handing rules for payment system"],
    "Reporting forum": x["Reporting forum"],
    "AML Law": x["AML Law"],
    "QR code transactions": x["QR code based transactions"],
    "Notes": x["Notes"]
  }
})

export const PaymentFlags = [
  'Active real-time payment system',
  'Cross-border payments',
  'QR code transactions',
  'Bank participation',
  'Non-bank participation',
  'Interoperability policy',
  'Participation rules',
  'Data-handing rules',
  'Reporting forum',
  'AML Law',
]

export const PaymentText = [
  'Payment system type',
  'Operator',
  'Annual value of transactions (USD)',
  'Annual volume of transactions',
  'Cost of transactions',
  'Participants',
  'Types of transactions',
  'Type of settlement system',
  'National or Regional',
  'Notes'
]

export const PaymentHeadlines = PaymentText.slice(0, 2)
export const PaymentOtherText = PaymentText.slice(2)
