// The script of /edit/new/<table>/ (D91): finds the place in the address, `?place=<code>` (or, for a draft link with
// no `?place=`, in the draft), and the System ID to suggest, then starts the editor (./form.ts) with the spec for
// that place. With no place, or one the data doesn't have, it says so and links to /edit/. If the place already
// has a row in this table with no name, it says to fill that in instead, but the form stays usable: it's a
// judgement call, so it guides and doesn't block (D91). The place and the System ID are shown, not edited.
import { draftPlace, specForPlace, type EditSpec } from '../../Proposal.ts'
import { findPlace, nextSystemId, placeNames, tables, typeIds, unnamedRows, type EditIndex } from '../../EditIndex.ts'
import { startEditor } from './form'

const text = (selector: string, value: string, root: ParentNode = document) => {
  for (const node of root.querySelectorAll(selector)) node.textContent = value
}

export async function startNew (form: HTMLFormElement) {
  const base: EditSpec = JSON.parse(form.dataset.spec ?? '{}')
  const index: EditIndex = JSON.parse(document.getElementById('edit-index')!.textContent!)
  const type = typeIds.find(id => tables[id].resource === base.resource)!
  const noun = tables[type].noun

  let code = new URLSearchParams(location.search).get('place')
  const draft = new URLSearchParams(location.hash.slice(1)).get('draft')
  // a draft link with no ?place= still says its place
  if (!code && draft !== null) {
    const saved = await draftPlace(draft)
    if (saved?.resource === base.resource) code = saved.place
  }

  const place = findPlace(index, code)
  if (!place) {
    const message = document.querySelector<HTMLElement>('[data-no-place]')!
    message.append(code ? `There’s no place “${code.slice(0, 40)}” in the map. ` : `Choose a place first, to add a ${noun} system to it. `, Object.assign(document.createElement('a'), { href: '/edit/', className: 'ul', textContent: 'Search for a place' }), '.')
    message.hidden = false
    return
  }

  const key = nextSystemId(index, type, place[0])
  const spec = specForPlace(base, { code: place[0], country: place[1], key })
  const { name, region } = placeNames(index, place)
  text('[data-place-name]', name)
  text('[data-place-shown]', region ? `${name}, ${region}` : name)
  text('[data-new-id]', key)
  // the page doesn't exist until the system is in a release, so it's the suggested System ID, not an address
  text('[data-new-id-label]', `${key} · suggested System ID`)
  text('[data-receipt-id]', key)

  // a row with no name is filled in rather than added to, which the page says, with a link, and leaves the form usable (D91)
  const notice = document.querySelector<HTMLElement>('[data-unnamed]')!
  const unnamed = unnamedRows(index, type, place[0])
  if (unnamed.length) {
    notice.append(`${name} already has a row for this with no name: `)
    // a row waiting for the next release is filled in like any other (D93)
    unnamed.forEach(({ id }, i) => {
      notice.append(i === 0 ? '' : i === unnamed.length - 1 ? ' or ' : ', ')
      notice.append('fill in ', Object.assign(document.createElement('a'), { href: `/${id}/edit/`, className: 'ul', textContent: id }), ' instead')
    })
    notice.append('. Add a new system only if this is a different one.')
    notice.hidden = false
  }

  document.querySelector<HTMLElement>('[data-new-grid]')!.hidden = false
  startEditor(form, spec)
}
