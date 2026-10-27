import codebook from './codebook.json'
import { schemas, schemaSource, labelOf, codebookNameOf, type DPIType } from './Schema'

export type { DPIType }
/** A codebook variable, as written by `npm run codebook:pull` */
export type CodebookVariable = typeof codebook['id'][number]

function findVariable (dpiType: DPIType, name: string) {
  return codebook[dpiType].find(variable => variable.name === name)
}

// Every field's `title` must be a variable in the codebook, so a renamed
// variable fails the build rather than leaving a dead link. Fields marked
// `codebook: false` in src/SiteFields.ts are skipped.
for (const dpiType of Object.keys(schemas) as DPIType[]) {
  for (const field of schemas[dpiType].fields) {
    const name = codebookNameOf(field)
    if (name !== undefined && !findVariable(dpiType, name)) {
      throw new Error(
        `Broken codebook link: field "${field.id}" in ${schemaSource(dpiType)} has title "${name}", ` +
        `but src/codebook.json has no "${dpiType}" variable with that name. Set the field's "title" ` +
        `to the codebook's "Variable name", mark it \`codebook: false\` in src/SiteFields.ts if the ` +
        `codebook doesn't cover it, or update the codebook with \`npm run codebook:pull\`.`
      )
    }
  }
}

/**
 * The codebook anchor for a card label, via the schema field with that label.
 * @throws if the field has no codebook variable
 */
export function codebookAnchorForLabel (dpiType: DPIType, label: string) {
  const field = schemas[dpiType]?.fields.find(field => labelOf(field) === label)
  const name = field && codebookNameOf(field)
  const variable = name !== undefined && findVariable(dpiType, name)
  if (!variable) {
    const source = dpiType in schemas ? schemaSource(dpiType) : 'datapackage.json'
    throw new Error(
      `Broken codebook link: dpiType "${dpiType}", label "${label}" has no codebook variable. ` +
      (field
        ? `Field "${field.id}" is marked \`codebook: false\` in src/SiteFields.ts. Remove that if the codebook covers it, or don't link this label.`
        : `No field in ${source} has that label.`)
    )
  }
  return variable.anchor
}
