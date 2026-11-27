// Builds small Word files for the blog import's tests (scripts/blog-import.test.ts), the way Google Docs writes
// them where it matters: headings by style, links as relationships, images as inline drawings, and a caption
// that has an image at its end. Also writes the committed fixture, scripts/fixtures/blog-import/sample.docx:
//   node scripts/blog-import-docx.ts
// There is no zip library in Node, so this writes the zip itself, stored and not compressed, which is all a
// test needs.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const crc32 = (bytes: Uint8Array) => zlib.crc32(bytes)

export interface ZipOptions {
  /** what the central directory says each file expands to, instead of its size: a lie, for the zip bomb test */
  declaredSize?: number
}

/** A zip of these files, stored */
export function zip (files: Record<string, Buffer | string>, options: ZipOptions = {}): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const nameBytes = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    parts.push(local, nameBytes, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(options.declaredSize ?? data.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

/** A solid-colour PNG, `size` pixels square */
export function png (size = 4, rgb: [number, number, number] = [200, 60, 60]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** A 1 pixel GIF */
export const gif = () => Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface Run { text: string, bold?: boolean, italic?: boolean, sup?: boolean }
const run = ({ text, bold, italic, sup }: Run) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${sup ? '<w:vertAlign w:val="superscript"/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`

/** The paragraphs' XML: pieces of a body */
export const x = {
  /** a paragraph of runs (text, or [text, {bold, italic}]) and other XML, in a style (Heading1, Title, …) */
  p: (content: (string | Run | { xml: string })[], style?: string, list?: 'bullet' | 'number', level = 0) => {
    const props = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${list === 'bullet' ? 1 : 2}"/></w:numPr>` : ''}`
    return `<w:p><w:pPr>${props}</w:pPr>${content.map(part => typeof part === 'string' ? run({ text: part }) : 'xml' in part ? part.xml : run(part)).join('')}</w:p>`
  },
  /** a hyperlink by the relationship's id, with its text */
  link: (id: string, text: string, italic = false) => ({ xml: `<w:hyperlink r:id="${id}">${run({ text, italic })}</w:hyperlink>` }),
  /** a line break inside a paragraph (Shift+Enter) */
  br: () => ({ xml: '<w:r><w:br/></w:r>' }),
  /** the mark of a footnote in the text: the footnote's text is in `footnotes` of the docx's options */
  footnote: (id: number) => ({ xml: `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>` }),
  /** a drawing that isn't a picture: a chart, which mammoth can't read, and doesn't say so */
  chart: () => ({ xml: '<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="7" name="chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' }),
  /** an equation, which mammoth says it ignored (Word's own math markup, `m:oMath`) */
  equation: () => ({ xml: '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>' }),
  /** an image placed in the page, not in the line of text: a floating picture, written as an anchor */
  anchoredImage: (id: string, descr = '') => ({ xml: `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1905000" cy="952500"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="floating" descr="${esc(descr)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="floating"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>` }),
  /** an inline image by the relationship's id, with the alt text Google writes as `descr` */
  image: (id: string, descr = '') => ({ xml: `<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="image" descr="${esc(descr)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>` }),
  /** a table of rows of cell texts */
  /** a table of rows of cell texts, the first cell of the first row spanning two columns if `merge` */
  mergedTable: (rows: string[][]) => `<w:tbl><w:tblPr/><w:tblGrid>${rows[1].map(() => '<w:gridCol w:w="2000"/>').join('')}</w:tblGrid>${rows.map((row, r) => `<w:tr>${row.map((cell, c) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${r === 0 && c === 0 ? '<w:gridSpan w:val="2"/>' : ''}</w:tcPr>${x.p([cell])}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`,
  table: (rows: string[][]) => `<w:tbl><w:tblPr/><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="2000"/>').join('')}</w:tblGrid>${rows.map(row => `<w:tr>${row.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${x.p([cell])}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
}

const style = (id: string, name: string) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/></w:style>`
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Heading1', 'heading 1')}${style('Heading2', 'heading 2')}${style('Heading3', 'heading 3')}${style('Title', 'Title')}${style('Subtitle', 'Subtitle')}</w:styles>`
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="●"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="■"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface DocxOptions {
  /** the body's paragraphs, from `x` */
  body: string[]
  /** hyperlinks by relationship id: the address */
  links?: Record<string, string>
  /** images by relationship id: the file's name in the docx (word/media/<name>) and its bytes */
  media?: Record<string, { name: string, bytes: Buffer }>
  /** a style map embedded in the file, as mammoth's own tool writes one: a hostile file could carry one */
  embeddedStyleMap?: string
  /** comments by id: their text, in word/comments.xml, which the body's commentReference points to */
  comments?: Record<number, string>
  /** footnotes by number: their text */
  footnotes?: Record<number, string>
  zip?: ZipOptions
}

/** A Word file */
export function docx (options: DocxOptions): Buffer {
  const links = options.links ?? {}
  const media = options.media ?? {}
  const comments = options.comments ?? {}
  const hasComments = Object.keys(comments).length > 0
  const footnotes = options.footnotes ?? {}
  const hasNotes = Object.keys(footnotes).length > 0
  const rels = [
    `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`,
    ...(hasNotes ? [`<Relationship Id="rIdNotes" Type="${REL}/footnotes" Target="footnotes.xml"/>`] : []),
    ...(hasComments ? [`<Relationship Id="rIdComments" Type="${REL}/comments" Target="comments.xml"/>`] : []),
    `<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`,
    ...Object.entries(links).map(([id, target]) => `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(target)}" TargetMode="External"/>`),
    ...Object.entries(media).map(([id, { name }]) => `<Relationship Id="${id}" Type="${REL}/image" Target="media/${esc(name)}"/>`)
  ].join('')
  const extensions = new Set(Object.values(media).map(({ name }) => name.split('.').pop() ?? 'bin'))
  const defaults = [...extensions].map(ext => `<Default Extension="${ext}" ContentType="${TYPES[ext] ?? 'application/octet-stream'}"/>`).join('')
  const files: Record<string, Buffer | string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}${options.embeddedStyleMap ? '<Override PartName="/mammoth/style-map" ContentType="text/prs.mammoth.style-map"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${hasNotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}${hasComments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>${options.embeddedStyleMap ? '<Relationship Id="rIdMammoth" Type="http://schemas.zwobble.org/mammoth/style-map" Target="/mammoth/style-map"/>' : ''}</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${options.body.join('')}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING
  }
  if (hasComments) files['word/comments.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${Object.entries(comments).map(([id, text]) => `<w:comment w:id="${id}" w:author="Reviewer" w:date="2026-11-20T10:00:00Z"><w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`
  if (options.embeddedStyleMap) files['mammoth/style-map'] = options.embeddedStyleMap
  if (hasNotes) {
    const separator = (type: string, id: number) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:r><w:${type === 'separator' ? 'separator' : 'continuationSeparator'}/></w:r></w:p></w:footnote>`
    files['word/footnotes.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${separator('separator', -1)}${separator('continuationSeparator', 0)}${Object.entries(footnotes).map(([id, text]) => `<w:footnote w:id="${id}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>${run({ text: ' ' + text })}</w:p></w:footnote>`).join('')}</w:footnotes>`
  }
  for (const { name, bytes } of Object.values(media)) files[`word/media/${name}`] = bytes
  return zip(files, options.zip)
}

/** The committed fixture's content: the shapes a Google Doc has, with made-up text */
export function sample (): Buffer {
  const { p, link, image, table } = x
  return docx({
    links: {
      rIdA: 'https://example.org/guide',
      rIdB: 'https://www.google.com/url?q=https://example.org/real-page%3Fa%3D1&sa=D&source=editors&ust=1&usg=AOvVaw0abc',
      rIdC: 'https://example.org/paper',
      rIdD: 'http://Example.org/Docs'
    },
    media: {
      rIdImg1: { name: 'image3.png', bytes: png(8) },
      rIdImg2: { name: 'image1.png', bytes: png(6, [40, 90, 200]) },
      rIdImg3: { name: 'image2.gif', bytes: gif() }
    },
    body: [
      p(['Digital ID in practice: what we learned'], 'Heading1'),
      p([{ text: 'Prompt: ', italic: true }, { text: 'what changed in 2026?', italic: true }]),
      p(['We read the ', link('rIdA', 'guide'), ' and a ', link('rIdB', 'second page'), ', and found ', { text: 'three', bold: true }, ' things.']),
      p(['Heading levels go from two: ']),
      p(['A first section'], 'Heading2'),
      p(['The first point'], undefined, 'bullet'),
      p(['The second point, with ', { text: 'emphasis', italic: true }], undefined, 'bullet'),
      p(['Step one'], undefined, 'number'),
      p(['Step two'], undefined, 'number'),
      p([image('rIdImg1', 'A chart of the first section.')]),
      p([{ text: 'Figure 1', bold: true }, ': A chart of the first section. Source: the team.']),
      p([{ text: 'Figure 2', bold: true }, ': A diagram of the process.', image('rIdImg2')]),
      p([image('rIdImg3')]),
      p(['- A line that starts with a dash is not a list.']),
      p(['A second section'], 'Heading2'),
      p([''], 'Heading2'),
      table([['Country', 'System'], ['Estonia', 'e-ID'], ['India', 'Aadhaar']]),
      p(['References'], 'Heading2'),
      p(['Author (2026) The paper. Available at: ', link('rIdC', 'https://example.org/paper', true), ' and ', link('rIdD', 'http://Example.org/Docs'), '.'])
    ]
  })
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const file = path.join(import.meta.dirname, 'fixtures/blog-import/sample.docx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, sample())
  console.log(`wrote ${file}`)
}
