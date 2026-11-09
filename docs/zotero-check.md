# Checking pages in Zotero

Every page tells reference managers how to cite it, in meta tags in its head: mainly Highwire Press `citation_*` tags, the ones Zotero's "Embedded Metadata" translator reads best. `src/CitationMeta.ts` writes them from the same data as the citation the page shows, and the dataset's title, author, repository, licence and address come from `CITATION.cff` (`src/Citation.ts`). The repository is `preferred-citation.publisher`, an entity named "DPI Map".

The dataset pages (`/data/`, the map pages, a system's page and a country's page) cite the data as APA 7 cites a dataset, author first, with the release as the version and the year, the DPI Map, the platform the data is published on, as the repository, and no "Retrieved" date:

- `/data/`, and the workbook: "UCL Institute for Innovation and Public Purpose. (2026). DPI Map (Version 2026-11-06) [Data set]. DPI Map. https://dpimap.org/data".
- the other dataset pages are parts of it, titled after it, so Zotero doesn't save a country's page as just "Belgium": "UCL Institute for Innovation and Public Purpose. (2026). DPI Map: Belgium (Version 2026-11-06) [Data set]. DPI Map. https://dpimap.org/belgium/". Only the citation and its tags have the "DPI Map: " prefix; the page's own title doesn't.

Two scripts check them:

- `npm run citation:check` reads the built pages in `dist/` and checks their tags, and that each citation a page shows matches its tags. It's part of `npm test`.
- `npm run zotero:check` saves the same pages in Zotero's [translation server](https://github.com/zotero/translation-server), if one is running at `127.0.0.1:1969` (or `ZOTERO_SERVER`), and checks the items it makes. It writes each response to `tests/zotero/`. Without a server it skips. The server leaves out attachments, so it can't show the PDFs.

This is the check by hand, in the Zotero desktop app with the Zotero Connector in your browser.

## Set up

- Against the deployed site: use `https://dpimap.org`, or a preview deploy's address.
- Locally: `npm run build && npm run preview`, then use `http://localhost:4321`.

The URL Zotero saves comes from the tags, so a local or preview page still saves a `https://dpimap.org/...` address. The report's PDF is attached from the same site as the page.

Make a new collection for the test, so the items are easy to find and delete afterwards.

## Pages to save

Open each page and click the Zotero Connector button. The button's icon should already show the item type before you click it.

| Page | Item type | Check these fields |
|---|---|---|
| `/global-state-of-dpi/` | Report | Title "2025 State of Digital Public Infrastructure Report: A Look at Measurement and Prevalence as DPI Transitions from Experiment to Scale"; authors Fetter, Jordyn; Rao, Krisstina; Eaves, David; Date 2025; Institution "UCL Institute for Innovation and Public Purpose"; Report Number 2025/06; Series Title "IIPP Policy Report"; ISBN 978-1-917384-39-1; URL the page. A "Full Text PDF" attachment, the report. |
| `/data/` | Dataset | Title "DPI Map" (not "DPI Map: DPI Map"); one author, "UCL Institute for Innovation and Public Purpose", in a single field (Zotero shows one name box, not Last and First); Version the release (2026-11-06); Date the release; Repository "DPI Map"; no Identifier; Rights "CC BY 4.0"; URL `https://dpimap.org/data`; Abstract from CITATION.cff. A snapshot. |
| `/` (map page: digital ID) | Dataset | Title "DPI Map: Digital ID systems"; Author, Version, Date, Repository and Rights as `/data/`; no Identifier; URL `https://dpimap.org/`; Abstract "Digital ID systems in 210 countries researched: 80 DPI-like. DPI Map, 2026-11-06 release.", the DPI-like count the page's status bar shows. |
| `/digital-payment/`, `/data-exchange/` (map pages) | Dataset | Title "DPI Map: Digital payment systems", "DPI Map: Data exchange systems"; otherwise as `/`. |
| `/dx-be-01/` (data exchange system) | Dataset | Title "DPI Map: Federal Service Bus (FSB), Belgium", without the ID; Identifier "dx-be-01"; Author as `/data/`; Version and Date the release, as `/data/` (not the record's last update, which the page shows beside its fields); Repository and Rights as `/data/`; URL the page; Abstract "Federal Service Bus (FSB) is a data exchange system in Belgium. DPI status: DPI-like. DPI Map, 2026-11-06 release." |
| `/id-in-01/` (digital ID system) | Dataset | Title "DPI Map: Aadhaar, India"; Identifier "id-in-01"; otherwise as above. |
| `/belgium/` (country) | Dataset | Title "DPI Map: Belgium"; no Identifier; Author, Version, Date, Repository and Rights as `/data/`; Abstract the page's summary sentence and the release. |
| `/blog/interactions-between-ai-and-dpi/` (paper with a DOI) | Journal Article | Title; authors Nagar, Sarosh; Eaves, David; Date 2024-12-07; Publication "arXiv preprint 2412.05761"; DOI 10.48550/arXiv.2412.05761; URL `https://arxiv.org/abs/2412.05761` (the original, not this page); Abstract the paper's. A "Full Text PDF" attachment from arxiv.org. |
| `/blog/dpi-a-framework-for-conceptualisation-and-measurement/` (paper with a PDF) | Journal Article | Authors Eaves, David; Rao, Krisstina; Date 2025-01; Publication "UCL Institute for Innovation and Public Purpose, Working Paper Series (IIPP WP 2025-01)"; URL the UCL IIPP page. A "Full Text PDF" attachment from discovery.ucl.ac.uk. |
| `/blog/the-economics-of-shared-digital-infrastructures/` (report) | Report | Institution "UCL Institute for Innovation and Public Purpose"; four authors; Date 2025-03; URL the UCL IIPP page; a PDF from discovery.ucl.ac.uk. |
| `/blog/the-digilocker-story/` (case study) | Web Page | Website Title "UCL Institute for Innovation and Public Purpose"; authors Gaur, Ritul; Eaves, David; Date 2025-10-20; URL the UCL IIPP page; a PDF. |
| `/about/` | Web Page | Title "About"; Website Title "DPI Map"; no creators; Abstract the page's description; URL the page. A snapshot. |

For each item, also check that Zotero's citation matches the page's own: select the item, right-click, Create Bibliography from Item, copy to the clipboard, and compare it with the page's "Cite" box or "Cite this page" line. The style changes the order and punctuation; the authors, year, title, venue and DOI or URL should be the same, and for a dataset the version and repository too. Zotero's Accessed date is the day you saved the item; the pages' citations have no "Retrieved" date, so a style that prints one adds it.

## What Zotero needs, or can't do, from meta tags

- **The institute as a single-field author needs a trailing comma.** Zotero splits an author at the first comma into last and first name, and a name with no comma at its last space (`cleanAuthor` in zotero/utilities). So `citation_author` "UCL Institute for Innovation and Public Purpose" would become a person, first name "UCL Institute for Innovation and Public", last name "Purpose". The dataset pages write it as "UCL Institute for Innovation and Public Purpose," with a comma at the end, on purpose: nothing follows the comma, so Zotero keeps the whole name as one field. Only the tag has the comma; the citations the pages show don't.
- **Identifier needs Zotero's own tag.** A system page gives its ID as `z.identifier`, which Zotero puts in Identifier; it doesn't read `DC.identifier` into it.
- **Dataset needs a non-Highwire tag.** Highwire has no dataset type. The translator ranks `og:type` "website" above `DC.type` "Dataset", so the dataset pages also say `eprints.type` "dataset", which it ranks above both.
- **Short Title.** Zotero makes a title's part before a colon its Short Title, so the items for the parts of the dataset ("DPI Map: Belgium") get the Short Title "DPI Map", which styles that shorten titles use. The pages don't set one; a `z.shortTitle` tag would.
- **Series Title on a Report** comes from `z.seriesTitle`, Zotero's own namespace: the translator puts `citation_series_title` in Series, which a Report doesn't have.
- **Library Catalog** is the site's host, `dpimap.org` (or `localhost:4321` for a local preview).

If an item comes out as the wrong type, or a field is missing, note the page, what Zotero made, and the Zotero and Connector versions (Help → About Zotero).
