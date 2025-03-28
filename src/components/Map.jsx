import { ComposableMap, Geographies, Geography } from "react-simple-maps"

// import { StatusMap } from '../components/Status.astro'

// const geoUrl = '/features.json'
const geoUrl = '/features-mod.json'

// import features from './features2.json'
// const geoUrl = '/countries-110m.json'

export const StatusMap = {
  'Active': 'oklch(0.925 0.084 155.995)',
  'In Progress': 'oklch(0.924 0.12 95.746)',   //amber
  'Proposed': 'oklch(0.882 0.059 254.128)',    // blue
  'Inactive': 'oklch(0.885 0.062 18.334)',    // red

  'Rollout': 'oklch(0.925 0.084 155.995)',     // green
  'Pilot': 'oklch(0.924 0.12 95.746)',
  'Plan': 'oklch(0.882 0.059 254.128)',

  'Unknown': '#E0DFDD',
  'NA': '#E0DFDD'
}

function statusToColour (status) {
  return `${StatusMap[status]}`
}

export default function Map ({dpiType}) {
  return (
    <div className="map text-2xl max-w-2xl mx-auto">
      <ComposableMap>
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography fill={statusToColour(geo.properties.status[dpiType])} key={geo.rsmKey} geography={geo} title={geo.properties.name} />
          ))}
        </Geographies>
      </ComposableMap>
    </div>
  )
}
