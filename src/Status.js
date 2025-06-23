export function normaliseImplementationStatus (s) {
  if (!s) return 'NA'
  if(s.match(/Implemented|Active/i)) {
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
	return a.Country.localeCompare(b.Country)
}
