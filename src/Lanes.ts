// Each DPI type's lane anchor, shared by the country page's lanes (src/CountryPage.ts), the changes
// pages' paths (src/Changes.ts) and the data build's /changes/ redirects (scripts/data-build.ts).
// No other imports, so the data build can load it in Node.
import type { DPIType } from './Schema'

/** Each lane's anchor on the country page, so a link can jump straight to it, e.g. /kenya/#digital-id */
export const laneAnchors: Record<DPIType, string> = { id: 'digital-id', pay: 'digital-payment', data: 'data-exchange' }
