import json from '../public/data/2025-06-30/2025-06-30-payment.json'
import { normaliseImplementationStatus, statusSort } from './Status'
import { fixURL } from './Util'

type PaymentType = typeof json[number]

export function paymentDPIStatus(x: PaymentType) {
  const implStatus = normaliseImplementationStatus(x['Status of payment system implementation'])
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
    'DPI Status': paymentDPIStatus(x),
    'Country': x['Country/Region'],
    'Last updated': x['Last updated'],
    'Name': x['Payment system name'],
    'URL': fixURL('pay', x['Country/Region'] ?? '', x['URL']),
    'Active real-time payment system': x['Active real-time payment system present'],
    'Payment system type': x['Payment system type'],
    'Status of implementation': normaliseImplementationStatus(x['Status of payment system implementation']),
    'National or Regional': x['National / Regional'],
    "Cross-border payments": x["Cross-border payments"],
    "Interoperability policy": x["Interoperability policy"],
    "Types of transactions supported": x["Types of transactions supported"],
    "Type of settlement system": x["Type of settlement system"],
    "Operator": x["Operator"],
    "Bank participation": x["Bank participation"],
    "Non-bank participation": x["Non-bank participation"],
    "Participation rules": x["Participation conditions and rules"],
    "Participants": x["No. of participants* (PSPs)\n*For regional payment systems > countries"],
    "Annual value of transactions (USD)": x["Annual value of transactions (USD)"],
    "Annual volume of transactions": x["Annual volume of transactions"],
    "Data-handling rules": x["Data-handing rules for payment system"],
    "Reporting forum": x["Reporting forum"],
    "AML Law": x["AML Law"],
    "Cost of transactions": x["Cost of transactions"],
    "QR code transactions": x["QR code based transactions"],
  }
}).sort(statusSort)

export const PaymentFlags = [
  'Active real-time payment system',
  'Cross-border payments',
  'QR code transactions',
  'Bank participation',
  'Non-bank participation',
  'Interoperability policy',
  'Participation rules',
  'Data-handling rules',
  'Reporting forum',
  'AML Law',
]

export const PaymentText = [
  'Payment system type',
  'Status of implementation',
  'Operator',
  'National or Regional',
  'Annual value of transactions (USD)',
  'Annual volume of transactions',
  'Cost of transactions',
  'Participants',
  'Types of transactions supported',
  'Type of settlement system',
]

export const PaymentHeadlines = PaymentText.slice(0, 2)
export const PaymentOtherText = PaymentText.slice(2)
