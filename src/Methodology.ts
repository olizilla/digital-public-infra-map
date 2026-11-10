// The Measuring DPI Framework as /methodology/ shows it (src/pages/methodology.mdx): its attributes
// (public/indicators/dpi-attributes.csv) and each DPI type's outcome indicators
// (public/indicators/dpi-indicators-<type>.csv), with the anchors other pages link to.
// The attribute and indicator tables (AttributeTable.astro, IndicatorTable.astro) give their rows
// these ids, and the codebook (src/CodebookPage.ts) links a variable to them.
import slug from 'slug'
import { csvRows } from './Places'
import type { DPIType } from './Schema'
import attributesCSV from '../public/indicators/dpi-attributes.csv?raw'
import idCSV from '../public/indicators/dpi-indicators-id.csv?raw'
import payCSV from '../public/indicators/dpi-indicators-pay.csv?raw'
import dataCSV from '../public/indicators/dpi-indicators-data.csv?raw'

export interface Attribute {
  /** 1 to 6 */
  id: number
  name: string
  /** Technology, Public-interest values or Adoption */
  category: string
}

export const attributes: Attribute[] = csvRows(attributesCSV)
  .map(row => ({ id: Number(row.id), name: row.attribute, category: row.category }))
  .sort((a, b) => a.id - b.id)
const attributeById = new Map(attributes.map(attribute => [attribute.id, attribute]))
export const attributeOf = (id: number) => attributeById.get(id)

/** An attribute's id on /methodology/, a slug of its name, like `privacy-safety-and-security` */
export const attributeAnchor = (name: string) => slug(name)
export const attributeHref = (name: string) => `/methodology/#${attributeAnchor(name)}`

/** An indicator's id on /methodology/, like `id-indicator-2-5` */
export const indicatorAnchor = (dpiType: DPIType, id: string) => `${dpiType}-indicator-${id.replace(/\./g, '-')}`

/** The id of the paragraph on /methodology/ that says how a type's systems are counted as DPI-like */
export const dpiTestAnchor = (dpiType: DPIType) => `dpi-test-${dpiType}`

/** Each type's indicators, by number, like `2.5`, with their text */
export const indicatorTexts: Record<DPIType, Map<string, string>> = {
  id: new Map(csvRows(idCSV).map(row => [row.id, row.indicator])),
  pay: new Map(csvRows(payCSV).map(row => [row.id, row.indicator])),
  data: new Map(csvRows(dataCSV).map(row => [row.id, row.indicator]))
}

/**
 * Indicator numbers are numbered per DPI type, so they don't always match the attribute ids.
 * Data exchange has no "Non-discrimination and inclusion" indicators, so its 4.x indicators
 * are "Capacity and coordination" (attribute 5) and its 5.x are "Scale of adoption" (attribute 6).
 */
const attributeForGroup: Partial<Record<DPIType, Record<number, number>>> = { data: { 4: 5, 5: 6 } }

/** The attribute an indicator number, like `4.1`, measures: 1 to 6, or 0 if it's none, like `0` */
export function attributeOfIndicator (dpiType: DPIType, indicator: string) {
  const group = Number(indicator.match(/^\s*(\d+)/)?.[1] ?? 0)
  return attributeForGroup[dpiType]?.[group] ?? group
}

export interface Indicator {
  /** like `2.5`, or `2.6` */
  number: string
  /** the indicator's text from its CSV, or the codebook's own if the CSV doesn't have it */
  text?: string
  /** whether /methodology/ lists it, so it has a row to link to */
  listed: boolean
  attribute?: Attribute
  anchor: string
}

/**
 * The indicators a codebook variable's `frameworkIndicator` names, one per line, like
 * `2.5 Legally-binding redressal framework …`. A number without text, like `2.6`, still counts;
 * `0` means none.
 */
export function indicatorsOf (dpiType: DPIType, frameworkIndicator: string): Indicator[] {
  return frameworkIndicator.split(/\n/).map(line => line.trim()).flatMap(line => {
    const match = line.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
    if (!match || Number(match[1]) === 0) return []
    const [, number, own] = match
    const text = indicatorTexts[dpiType].get(number)
    return [{
      number,
      text: text ?? (own || undefined),
      listed: text !== undefined,
      attribute: attributeOf(attributeOfIndicator(dpiType, number)),
      anchor: indicatorAnchor(dpiType, number)
    }]
  })
}
