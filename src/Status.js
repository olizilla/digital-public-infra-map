/**
 * A Status of implementation value as the site's statuses: 'Active', 'Pilot', 'Suspended', 'Not Found' or 'NA'
 * (src/DpiTest.ts ImplStatus). Not Found (researched, insufficient information) stays apart from NA (no answer:
 * not researched yet), D61, and src/DpiTest.ts statusOf says how each counts in the DPI test and how it's shown.
 * Earlier releases' values, like "Rollout", are matched loosely. Anything else is logged and returned as it is.
 */
export function normaliseImplementationStatus (s) {
  if (!s) return 'NA'
  // before the patterns, as /No/ would read it as No
  if (s.match(/^\s*not found\s*$/i)) {
    return 'Not Found'
  }
  if (s.match(/suspend/i)) {
    return 'Suspended'
  }
  // "Active" as a word, so "Inactive" isn't Active (/NA/ below reads it as NA)
  if(s.match(/Implemented|\bActive\b/i)) {
    return 'Active'
  }
  if(s.match(/Plan|Pilot|Rollout/i)) {
    return 'Pilot'
  }
  if (s.match(/NA|Unknown/i)) {
    return 'NA'
  }
  if (s.match(/Yes/i)) {
    return 'Yes'
  }
  if (s.match(/No/i)) {
    return 'No'
  }
  console.log("New status", s)
  return s
}

export function dpiStatusToClass (status = '') {
  return `status-${status.toLowerCase()}`
}

const statusMap = {
	'DPI': 3,
	'WIP': 2,
	'NA': 1
}

function statusCode (s) {
	return statusMap[s] ?? 0
}

export function statusSort (a, b) {
  const diff1 = statusCode(b['DPI Status']) - statusCode(a['DPI Status'])
	if (diff1 !== 0) return diff1
	return a.country.localeCompare(b.country)
}
