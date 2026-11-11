// A country's lanes of systems and its summary sentence, for its page's
// header (src/components/CountryHeader.astro), which the country page and its systems' pages share.
import { nameOf, nouns, presence, statusOf, type ImplStatus } from './DpiTest'
import { records } from './Records'
import type { DPIType } from './Schema'

type Status = 'DPI' | 'WIP' | 'NA'
export const statusOrder: Record<Status, number> = { DPI: 0, WIP: 1, NA: 2 }

/** The lane title for each DPI type, in lane order */
export const laneTitles: Record<DPIType, string> = { id: 'Digital ID', pay: 'Digital payment', data: 'Data exchange' }

export { laneAnchors } from './Lanes'

/** The country's three lanes: its rows of each DPI type, and the systems among them, best first */
export function lanesOf (country: string) {
	return (Object.entries(laneTitles) as [DPIType, string][]).map(([dpiType, title]) => {
		const all = records[dpiType].filter(record => record.country === country)
		// rows where the research found no system don't get a card
		const systems = all
			.filter(record => presence(dpiType, record) !== 'not-found')
			.sort((a, b) => statusOrder[a['DPI Status'] as Status] - statusOrder[b['DPI Status'] as Status])
		return { dpiType, title, noun: nouns[dpiType], all, systems, researched: all.length > 0, best: systems[0]?.['DPI Status'] as Status | undefined }
	})
}
export type Lane = ReturnType<typeof lanesOf>[number]

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "a", "a and b", "a, b and c" */
const list = (items: string[], conj = 'and') => items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} ${conj} ${items.at(-1)}`

/** The summary sentence, as HTML */
export function summaryOf (country: string, lanes: Lane[]) {
	/** The lanes' types, as "<b>digital ID and data exchange</b> systems". `count` is how many systems that is, if not one per type */
	function phrase (keys: DPIType[], conj = 'and', count = keys.length) {
		const names = lanes.filter(lane => keys.includes(lane.dpiType)).map(lane => lane.noun)
		return `<b>${list(names, conj)}</b>${count > 1 ? ' systems' : ' system'}`
	}
	const dpi = lanes.filter(lane => lane.best === 'DPI').map(lane => lane.dpiType)
	const wip = lanes.filter(lane => lane.best === 'WIP').map(lane => lane.dpiType)
	// "not found" only where the country has no system of the type. A lane whose systems are
	// all suspended, or whose status isn't known, says so instead
	const none = lanes.filter(lane => lane.systems.length === 0).map(lane => lane.dpiType)
	const sentences: string[] = []
	const name = escape(country)
	if (dpi.length) {
		sentences.push(`Of the three DPI types the Map tracks, ${name}'s ${phrase(dpi)} ${dpi.length === 1 ? 'is' : 'are'} ${dpi.length === 3 ? 'all ' : ''}DPI-like.`)
	} else {
		sentences.push(`None of the three DPI types the Map tracks is DPI-like in ${name} yet.`)
	}
	if (wip.length) sentences.push(`Its ${phrase(wip)} ${wip.length === 1 ? 'is' : 'are'} in progress.`)
	sentences.push(...inactiveSentences(lanes.filter(lane => lane.systems.length > 0 && lane.best === 'NA'), phrase))
	if (none.length) sentences.push(`No ${phrase(none, 'or').replace(' systems', ' system')} has been found yet.`)
	for (const lane of lanes) {
		const others = lane.systems.filter(record => record['DPI Status'] !== lane.best)
		if (others.length === 1 && others[0]['DPI Status'] === 'WIP') {
			const other = nameOf(lane.dpiType, others[0]) ?? 'an unnamed system'
			sentences.push(`One of its ${lane.systems.length} ${lane.noun} systems, ${escape(other)}, is still in progress.`)
		}
	}
	return sentences.join(' ')
}

/**
 * Why a system is neither DPI-like nor in progress: it's suspended, or its status is Not Found (researched,
 * insufficient information) or NA (no answer: not researched yet), D61, as statusOf (src/DpiTest.ts) has it
 */
type Inactive = Extract<ImplStatus, 'Suspended' | 'Not Found' | 'NA'>
const inactiveOrder: Inactive[] = ['Suspended', 'Not Found', 'NA']

/**
 * The sentences for lanes that have systems but none DPI-like or in progress, in lane order:
 * lanes whose systems share a status share a sentence, and a lane with a mix has its own.
 */
function inactiveSentences (lanes: Lane[], phrase: (keys: DPIType[], conj?: string, count?: number) => string) {
	const statusIn = (lane: Lane, record: Record<string, any>) => statusOf(lane.dpiType, record).status
	const nameIn = (lane: Lane) => (record: Record<string, any>) => escape(nameOf(lane.dpiType, record) ?? 'an unnamed system')
	const shared = new Map<Inactive, Lane[]>()
	const sentences: { lane: Lane, text: string }[] = []
	for (const lane of lanes) {
		const statuses = inactiveOrder.filter(status => lane.systems.some(record => statusIn(lane, record) === status))
		if (statuses.length === 1) {
			shared.set(statuses[0], [...shared.get(statuses[0]) ?? [], lane])
			continue
		}
		// "Of its 2 digital payment systems, D-Cash is suspended and the status of Mobile money isn't recorded."
		const clauses = statuses.map(status => {
			const records = lane.systems.filter(record => statusIn(lane, record) === status)
			const one = records.length === 1
			const names = list(records.map(nameIn(lane)))
			if (status === 'Suspended') return `${names} ${one ? 'is' : 'are'} suspended`
			if (status === 'Not Found') return `there isn't enough information on the ${one ? 'status' : 'statuses'} of ${names}`
			return one ? `the status of ${names} isn't recorded` : `the statuses of ${names} aren't recorded`
		})
		sentences.push({ lane, text: `Of its ${lane.systems.length} <b>${lane.noun}</b> systems, ${list(clauses)}.` })
	}
	for (const [status, group] of shared) {
		const keys = group.map(lane => lane.dpiType)
		const records = group.flatMap(lane => lane.systems.map(record => ({ lane, record })))
		const one = records.length === 1
		const types = phrase(keys, 'and', records.length)
		let text: string
		if (status === 'Suspended') {
			// named, as a suspended system is one the country had: "Its digital payment system, D-Cash, is suspended."
			const names = records.every(({ lane, record }) => nameOf(lane.dpiType, record)) ? `, ${list(records.map(({ lane, record }) => nameIn(lane)(record)))},` : ''
			text = `Its ${types}${names} ${one ? 'is' : 'are'} suspended.`
		} else if (status === 'Not Found') {
			text = one ? `There isn't enough information on its ${types}'s status.` : `There isn't enough information on its ${types}' statuses.`
		} else {
			text = one ? `Its ${types}'s status isn't recorded.` : `Its ${types}' statuses aren't recorded.`
		}
		sentences.push({ lane: group[0], text })
	}
	return sentences.sort((a, b) => lanes.indexOf(a.lane) - lanes.indexOf(b.lane)).map(({ text }) => text)
}
