// The script of /edit/ (D91): searches the page's index (src/EditIndex.ts) as the person types, and shows
// what's found. A place shows, for each table, its rows and the right next step: "Fill in <id>" for a row with
// no name (with a smaller "A different system? Add a new one"), "Edit <name>" for a named system, "Add another
// <noun> system", or "Add a <noun> system" where it has none. A system, found by its name or its System ID,
// links to its edit page. The query is kept in the address (?q=), so going back finds it again. Everything shown
// is text, never HTML, as names are anyone's.
import {
  editHref, MAX_SYSTEMS, parseId, placeNames, placeTables, search, tables,
  type EditIndex, type PlaceRow, type SystemHit, type TypeId
} from '../../EditIndex.ts'
import { buttonClass } from './styles'

type Child = Node | string | undefined | false

/** An element with a class and children */
function el<K extends keyof HTMLElementTagNameMap> (tag: K, className: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children.filter((child): child is Node | string => !!child))
  return node
}

/** A link with a class */
const link = (className: string, href: string, text: string) => Object.assign(el('a', className, text), { href })

/** A system that's in the next release and not the one the map shows */
const waitingText = 'new, waiting for the next release'

const mono = (text: string) => el('span', 'font-mono text-xs text-secondary whitespace-nowrap', text)
const primary = 'button-blue'
const secondaryLink = 'text-ui text-secondary ul'

function placeRow (row: PlaceRow, noun: string): HTMLElement {
  const who = row.name ? el('span', 'text-ink font-medium', row.name) : el('span', 'text-secondary italic', `Unnamed ${noun} system`)
  const action = link(row.action === 'fill' ? primary : buttonClass, row.href, row.label)
  return el('li', 'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2', el('span', 'flex min-w-0 flex-1 basis-60 flex-wrap items-baseline gap-x-2', who, mono(row.id), row.pending && el('span', 'text-ui text-muted', waitingText)), action)
}

function placeBlock (index: EditIndex, code: string): HTMLElement {
  const place = index.p.find(place => place[0] === code)!
  const { name, region } = placeNames(index, place)
  return el('section', 'rounded-lg border border-line bg-white shadow',
    el('h2', 'px-4 pt-3 pb-1 text-title font-semibold text-strong', name, region && el('span', 'pl-2 text-ui font-normal text-muted', region)),
    ...placeTables(index, code).map(table => {
      const noun = tables[table.type].noun
      return el('div', 'border-t border-line-faint px-4 py-3 first-of-type:border-t-0',
        el('h3', 'text-ui font-medium text-secondary', table.label),
        table.rows.length > 0 && el('ul', 'divide-y divide-line-faint', ...table.rows.map(row => placeRow(row, noun))),
        el('p', table.rows.length ? 'pt-1.5' : 'pt-2',
          link(table.add.secondary ? secondaryLink : buttonClass + ' inline-block', table.add.href, table.add.label)))
    }))
}

function systemRow (index: EditIndex, { row }: SystemHit): HTMLElement {
  const [id, name, kind, pending] = row
  const parsed = parseId(id)
  const type = parsed?.type as TypeId
  const place = index.p.find(place => place[0] === parsed?.place)
  const noun = tables[type]?.noun ?? 'system'
  const who = name ? el('span', 'text-ink font-medium', name) : el('span', 'text-secondary italic', `Unnamed ${noun} system`)
  const action = link(kind === 0 ? buttonClass : primary, editHref(id), kind === 0 ? `Edit ${name}` : `Fill in ${id}`)
  return el('li', 'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2',
    el('span', 'flex min-w-0 flex-1 basis-60 flex-wrap items-baseline gap-x-2', who, mono(id),
      el('span', 'text-ui text-muted', [place?.[1], tables[type]?.label, pending ? waitingText : undefined].filter(Boolean).join(' · '))), action)
}

export function startFind (form: HTMLFormElement) {
  const index: EditIndex = JSON.parse(document.getElementById('edit-index')!.textContent!)
  const input = form.querySelector<HTMLInputElement>('input[data-query]')!
  const results = document.querySelector<HTMLElement>('[data-results]')!

  function show () {
    const text = input.value
    const found = search(index, text)
    const nothing = !found.places.length && !found.systems.length
    results.replaceChildren(
      ...found.places.map(hit => placeBlock(index, hit.place[0])),
      ...(found.systems.length ? [el('section', 'rounded-lg border border-line bg-white shadow',
        el('h2', 'px-4 pt-3 pb-1 text-title font-semibold text-strong', 'Systems'),
        el('ul', 'divide-y divide-line-faint px-4 pb-2', ...found.systems.map(hit => systemRow(index, hit))),
        found.more > 0 && el('p', 'px-4 pb-3 text-ui text-muted', `and ${found.more} more: keep typing to narrow it down (up to ${MAX_SYSTEMS} are listed).`))] : []),
      ...(nothing && text.trim().length >= 2 ? [el('p', 'text-ui text-secondary', `Nothing found for “${text.trim()}”. Try a country or region, a system’s name, or a System ID like pay-ke-01.`)] : [])
    )
    const url = new URL(location.href)
    if (text.trim()) url.searchParams.set('q', text)
    else url.searchParams.delete('q')
    history.replaceState(null, '', url)
  }

  form.addEventListener('submit', event => event.preventDefault())
  input.addEventListener('input', show)
  const q = new URLSearchParams(location.search).get('q')
  if (q) {
    input.value = q
    show()
  }
}
