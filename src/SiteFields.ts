// How the site shows each field of datapackage.json, by resource then field id.
// This is presentation only, so it lives here rather than in the data package.
// src/Schema.ts throws if this and datapackage.json don't have the same field ids.

/** How the site uses a field */
export type Kind = 'country' | 'name' | 'url' | 'updated' | 'count' | 'flag' | 'text'

interface Common {
  /** the label shown on the site, only when it differs from the field's `title` */
  label?: string
  /** `false` if the codebook doesn't cover the field, so it must not link to it */
  codebook?: false
}

/** `order` is where a flag or text field appears on the cards, among fields of the same kind, from 1 */
export type SiteField = Common & (
  | { kind: Exclude<Kind, 'flag' | 'text'> }
  | { kind: 'flag', order: number }
  | {
    kind: 'text'
    order: number
    /** shown on a card before it is expanded */
    headline?: true
  }
)

export const siteFields = {
  identity: {
    country: { label: 'Country', kind: 'country' },
    last_updated: { kind: 'updated', codebook: false },
    dpi_count: { label: 'Count for DPI', kind: 'count' },
    claim: { kind: 'flag', order: 1 },
    name: { label: 'Name', kind: 'name' },
    url: { kind: 'url', codebook: false },
    biometrics: { kind: 'flag', order: 11 },
    status: { label: 'Status of implementation', kind: 'text', order: 2, headline: true },
    id_act: { kind: 'flag', order: 2 },
    regulation: { kind: 'flag', order: 3 },
    digital_auth: { kind: 'flag', order: 12 },
    kyc: { kind: 'flag', order: 13 },
    gov_portal_auth: { kind: 'flag', order: 14 },
    legal_status: { kind: 'flag', order: 4 },
    governing_entity: { kind: 'text', order: 1, headline: true },
    legal_redress: { kind: 'text', order: 3 },
    storage_sharing_terms: { kind: 'flag', order: 7 },
    data_protection_act: { kind: 'flag', order: 8 },
    enrolment_rules: { kind: 'flag', order: 5 },
    data_leak_disclosure: { kind: 'flag', order: 9 },
    data_handling_terms: { label: 'Data handling terms exist', kind: 'flag', order: 10 },
    feeder_documents: { kind: 'flag', order: 6 },
    sectoral_use_cases: { kind: 'flag', order: 15 },
    funders: { kind: 'text', order: 4 },
    technical_support: { kind: 'text', order: 5 },
  },
  payment: {
    country: { label: 'Country', kind: 'country' },
    last_updated: { kind: 'updated', codebook: false },
    dpi_count: { kind: 'count', codebook: false },
    name: { label: 'Name', kind: 'name' },
    url: { kind: 'url', codebook: false },
    realtime_active: { label: 'Active real-time payment system present', kind: 'flag', order: 1 },
    system_type: { kind: 'text', order: 1, headline: true },
    status: { label: 'Status of implementation', kind: 'text', order: 2, headline: true },
    national_regional: { kind: 'text', order: 4 },
    cross_border: { kind: 'flag', order: 2 },
    interoperability_policy: { kind: 'flag', order: 6 },
    transaction_types: { kind: 'text', order: 9 },
    settlement_type: { kind: 'text', order: 10 },
    operator: { kind: 'text', order: 3 },
    bank_participation: { kind: 'flag', order: 4 },
    nonbank_participation: { kind: 'flag', order: 5 },
    participation_rules: { kind: 'flag', order: 7 },
    participants: { kind: 'text', order: 8 },
    annual_value_usd: { kind: 'text', order: 5 },
    annual_volume: { kind: 'text', order: 6 },
    data_handling_rules: { kind: 'flag', order: 8 },
    reporting_forum: { kind: 'flag', order: 9 },
    aml_law: { kind: 'flag', order: 10 },
    transaction_cost: { kind: 'text', order: 7 },
    qr_code: { label: 'QR code transactions', kind: 'flag', order: 3 },
  },
  exchange: {
    country: { label: 'Country', kind: 'country' },
    last_updated: { kind: 'updated', codebook: false },
    dpi_count: { kind: 'count', codebook: false },
    name: { label: 'Name', kind: 'name' },
    url: { kind: 'url', codebook: false },
    status: { kind: 'text', order: 2, headline: true },
    architecture: { kind: 'text', order: 1, headline: true },
    national_regional: { kind: 'text', order: 5 },
    sectoral: { kind: 'text', order: 6 },
    semantic_interoperability: { kind: 'flag', order: 1 },
    realtime_sharing: { kind: 'flag', order: 2 },
    scalable_architecture: { label: 'Scalable architecture', kind: 'flag', order: 3 },
    governing_entity: { label: 'Governing Entity', kind: 'text', order: 3 },
    ownership: { kind: 'text', order: 8 },
    enrolment_info: { kind: 'flag', order: 6 },
    permitted_participants: { kind: 'text', order: 7 },
    audit_mechanism: { kind: 'flag', order: 4 },
    data_management_rules: { kind: 'flag', order: 5 },
    coordination_unit: { kind: 'text', order: 4 },
    multiple_public_entities: { kind: 'flag', order: 7 },
    impact_metrics: { kind: 'flag', order: 8 },
  },
} satisfies Record<string, Record<string, SiteField>>

export type ResourceName = keyof typeof siteFields
/** The field ids of a resource, so a typo'd id is a type error */
export type FieldId<R extends ResourceName> = keyof typeof siteFields[R] & string
