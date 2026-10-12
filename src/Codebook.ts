import slug from 'slug'
import codebook from './codebook.json'
import { IDCodebookNames } from './Identity'
import { PaymentCodebookNames } from './Payment'
import { DataExchangeCodebookNames } from './DataExchange'

export type DPIType = 'id' | 'pay' | 'data'
/** A codebook variable, as written by `npm run codebook:pull` */
export type CodebookVariable = typeof codebook['id'][number]

// Where a card label differs from the codebook's `Variable name`, see the maps in
// Identity.ts, Payment.ts and DataExchange.ts
const codebookNames: Record<DPIType, Record<string, string>> = {
  id: IDCodebookNames,
  pay: PaymentCodebookNames,
  data: DataExchangeCodebookNames
}

/** The anchor id for a codebook variable, as used on the codebook page. */
export function codebookAnchor (dpiType: DPIType, variableName: string) {
  return `${dpiType}-${slug(variableName)}`
}

/** Every anchor id that exists on the codebook page. */
const anchors = new Set(
  [...codebook.id, ...codebook.pay, ...codebook.data].map(variable => variable.anchor)
)

/**
 * The codebook anchor for a card label.
 * @throws if there is no such variable in the codebook
 */
export function codebookAnchorForLabel (dpiType: DPIType, label: string) {
  const variableName = codebookNames[dpiType]?.[label] ?? label
  const anchor = codebookAnchor(dpiType, variableName)
  if (!anchors.has(anchor)) {
    throw new Error(
      `Broken codebook link: dpiType "${dpiType}", label "${label}" links to "/codebook/#${anchor}" ` +
      `but the codebook has no such anchor. Add a mapping from "${label}" to the codebook's "Variable name" ` +
      `in ${dpiType === 'id' ? 'IDCodebookNames (src/Identity.ts)' : dpiType === 'pay' ? 'PaymentCodebookNames (src/Payment.ts)' : 'DataExchangeCodebookNames (src/DataExchange.ts)'}, ` +
      `or update the codebook with \`npm run codebook:pull\`.`
    )
  }
  return anchor
}
