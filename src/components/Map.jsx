import { ComposableMap, Geographies, Geography } from "react-simple-maps"

export const StatusMap = {
  'Active': 'oklch(0.925 0.084 155.995)',
  'In Progress': 'oklch(0.924 0.12 95.746)',   //amber
  'Proposed': 'oklch(0.882 0.059 254.128)',    // blue
  'Inactive': 'oklch(0.882 0.059 254.128)',    // also blue

  'Rollout': 'oklch(0.925 0.084 155.995)',     // green
  'Pilot': 'oklch(0.924 0.12 95.746)',
  'Plan': 'oklch(0.882 0.059 254.128)',

  'Unknown': '#E0DFDD',
  'NA': '#E0DFDD'
}

function statusToColour (status) {
  return `${StatusMap[status]}`
}

export default function Map ({dpiType, geography="/features-mod.json"}) {
  return (
    <div className="map max-w-4xl mx-auto lg:-mt-2">
      <ComposableMap className='Map'>
        <Geographies geography={geography}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography stroke="#acc" key={geo.rsmKey} geography={geo} title={geo.properties.name} onClick={() => window.location.pathname = geo.properties.slug } style={{
                default: {
                  fill: statusToColour(geo.properties.status[dpiType])
                },
                hover: {
                  fill: "#8af",
                },
                pressed: {
                  fill: "#79f",
                },
              }} />
          ))}
        </Geographies>
      </ComposableMap>
    </div>
  )
}
