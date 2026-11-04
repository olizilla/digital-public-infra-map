// A country's lanes of systems, its summary sentence and its citation date, for its page's
// header (src/components/CountryHeader.astro), which the country page and its systems' pages share.
import { nameOf, nouns, presence, valueOf } from './DpiTest'
import { records } from './Records'
import { parseDate } from './Util'
import type { DPIType } from './Schema'

type Status = 'DPI' | 'WIP' | 'NA'
export const statusOrder: Record<Status, number> = { DPI: 0, WIP: 1, NA: 2 }

/** The lane title for each DPI type, in lane order */
export const laneTitles: Record<DPIType, string> = { id: 'Digital ID', pay: 'Digital payment', data: 'Data exchange' }

/** Each lane's anchor on the country page, so a link can jump straight to it, e.g. /kenya/#digital-id */
export const laneAnchors: Record<DPIType, string> = { id: 'digital-id', pay: 'digital-payment', data: 'data-exchange' }

/** The country's three lanes: its rows of each DPI type, and the systems among them, best first */
export function lanesOf (country: string) {
	return (Object.entries(laneTitles) as [DPIType, string][]).map(([dpiType, title]) => {
		const all = records[dpiType].filter(record => record.Country === country)
		// rows where the research found no system don't get a card
		const systems = all
			.filter(record => presence(dpiType, record) !== 'not-found')
			.sort((a, b) => statusOrder[a['DPI Status'] as Status] - statusOrder[b['DPI Status'] as Status])
		return { dpiType, title, noun: nouns[dpiType], all, systems, researched: all.length > 0, best: systems[0]?.['DPI Status'] as Status | undefined }
	})
}
export type Lane = ReturnType<typeof lanesOf>[number]

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The summary sentence, as HTML */
export function summaryOf (country: string, lanes: Lane[]) {
	function phrase (keys: DPIType[], conj = 'and') {
		const names = lanes.filter(lane => keys.includes(lane.dpiType)).map(lane => lane.noun)
		const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ${conj} ${names.at(-1)}`
		return `<b>${joined}</b>${names.length > 1 ? ' systems' : ' system'}`
	}
	const dpi = lanes.filter(lane => lane.best === 'DPI').map(lane => lane.dpiType)
	const wip = lanes.filter(lane => lane.best === 'WIP').map(lane => lane.dpiType)
	const none = lanes.filter(lane => !lane.best || lane.best === 'NA').map(lane => lane.dpiType)
	const sentences: string[] = []
	const name = escape(country)
	if (dpi.length) {
		sentences.push(`Of the three DPI types the Map tracks, ${name}'s ${phrase(dpi)} ${dpi.length === 1 ? 'is' : 'are'} ${dpi.length === 3 ? 'all ' : ''}DPI-like.`)
	} else {
		sentences.push(`None of the three DPI types the Map tracks is DPI-like in ${name} yet.`)
	}
	if (wip.length) sentences.push(`Its ${phrase(wip)} ${wip.length === 1 ? 'is' : 'are'} in progress.`)
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

/** The date the country page is cited by: that of its newest data */
export function citedDateOf (lanes: Lane[]) {
	const updated = lanes
		.flatMap(lane => lane.all.map(record => parseDate(valueOf(lane.dpiType, record, 'last_updated'))))
		.filter(date => date !== undefined)
		.sort((a, b) => b.getTime() - a.getTime())[0]
	return updated ? updated.toISOString().slice(0, 10) : 'n.d.'
}
