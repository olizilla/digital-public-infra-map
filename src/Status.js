export function normaliseStatus (s) {
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
  console.log("New exchange status", s)
  return s
}

export function statusToClass (status) {
  return `status-${normaliseStatus(status).toLowerCase()}`
}

const statusMap = {
	'Active': 3,
	'Pilot': 2,
	'NA': 1
}

function statusCode (s) {
	return statusMap[s] ?? 0
}

export function statusSort (a, b) {
  const diff1 = statusCode(b['Status']) - statusCode(a['Status'])
	if (diff1 !== 0) return diff1
	return a.Country.localeCompare(b.Country)
}
