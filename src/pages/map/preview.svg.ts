import { experimental_AstroContainer } from "astro/container"
import Map from "../../components/MapSvg.astro";

const container = await experimental_AstroContainer.create()

export async function GET () {
  const svg = await container.renderToString(Map)
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
    }
  })
}
