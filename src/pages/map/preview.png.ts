import sharp from 'sharp'
import { experimental_AstroContainer } from "astro/container"
import Map from "../../components/MapSvg.astro";

const container = await experimental_AstroContainer.create()

export async function GET () {
  const res = await container.renderToResponse(Map)
  const svgBuffer = await res.bytes()
  const pngBuffer = await sharp(svgBuffer, {})
    .flatten({background: '#ffffff'})
    .resize({
      width: 1200,
      height: 630,
      fit: 'cover',
      position: 'top',
      background: '#ffffff'
    })
    .png({colors:16})
    .toBuffer()
  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
    }
  })
}
