# 🗺️ Digital Public Infrastructure Map

Tracking the state of national-scale digital infrastructure around the world. 

<img width="1468" alt="screenshot of the ui. it's got a map of the world showing which regions are running digital public infrastructure projects." src="https://github.com/user-attachments/assets/7398f03d-dd4b-4330-ae6a-265e21254f58" />

## Getting started

**Editors:** You can edit the site via [Pages CMS](https://pagescms.org/).

**The bold and the curious:** You can build this website on your computer:

- Ensure [node.js](https://nodejs.org) is installed on your computer
- Download the code by cloning this repo
- Run `npm install` to fetch the dependencies
- Run `npm start` to build the site and start a local server
- Open http://localhost:4321 in your browser

You can now add new pages and edit existing ones and see those changes live in your browser.

## How it works

The DPI data is collected by the team in a google sheet. For every release of the this dataset, a snapshot google sheet is taken. The URLs for the snapshot sheet is captured in this repo in the [./src/pages/api](./src/pages/api) directory. 

The code in this repo uses that data to build out a static, multi-page website using [astro.build](https://astro.build).

A date-stamped snapshot of the data is captured as JSON in the [./public/data](./public/data) directory. Those JSON files are then used to build out the map and cards for all the DPI systems you can see at https://dpimap.org

The [codebook](https://dpimap.org/codebook/) is built from a snapshot of the [codebook google sheet](https://docs.google.com/spreadsheets/d/1XywQ7War3luFLzfuvqdeH-ZH7S_b2jibYk9fOjlcRgs/). To refresh it after the sheet has changed, run `npm run codebook:pull` and commit the result. That writes [./src/codebook.json](./src/codebook.json), which has the variables with their anchor ids and value codes already extracted, and is what the site imports. Card labels that link to the codebook are checked against it at build time, so a renamed variable fails the build rather than leaving a dead link.

Updates to the site are deployed to dpimap.org automatically when changes are merged into the main branch of this repository on GitHub. Cloudflare watches for changes, runs the build process (`npm install && npm run build`) and stores the updated html and css files and starts serving the new version of the website.

## Data package

[./datapackage.json](./datapackage.json) describes the CSVs in [./public/data/latest](./public/data/latest). It's an Open Knowledge Foundation [Data Package](https://datapackage.org/standard/data-package/) (v2) file, that documents the shapes of the dpimap.org data, to aid reuse.

### System IDs

Every row has a stable id in its first column, `System ID`, so a system can be referred to even if its name or country changes. An id is `<dpi type>-<place>-<index>`:

- `dpi type` is `id` (identity), `pay` (payment) or `dx` (data exchange).
- `place` is the lower case ISO 3166-1 alpha-2 code of the country or territory (`xk` for Kosovo), or for a regional system `africa`, `asia`, `europe`, `oceania`, `lac`, `noram`, `americas` or `world`.
- `index` is two or more digits, counting up from `01` for each type and place.

For example `pay-gb-01`, `id-id-01` and `dx-europe-01`. The global form is `https://dpimap.org/<id>`.

Place codes are in [public/data/places.csv](./public/data/places.csv), with the source of each: the [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/) table, which gives each country's ISO code and its UN name; [ISO 3166-1](https://www.iso.org/obp/ui/#iso:code:3166:TW) for Taiwan, which M49 doesn't list; and [Unicode CLDR](https://github.com/unicode-org/cldr/blob/main/common/validity/region.xml) for `xk`, Kosovo, which is in ISO's user-assigned range rather than an ISO code. The names our data uses that differ from the names in those sources are in [public/data/place-names.csv](./public/data/place-names.csv).

An id is never reused or renumbered, even if its system is removed, so gaps are fine. A rename keeps the id, and a different system gets a new one. To add a system, use the next unused number for its type and place. `npm run validate` rejects duplicate and malformed ids, and checks that each id's place matches its row's Country / Region.

## Contributing

Contributions are welcome and encouraged! Share information about DPI deployments, provide feedback on our framework, or add to data and build on it. see: https://dpimap.org/contribute/ 

You can add new blog posts and community of practice posts using [Pages CMS](https://pagescms.org/).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.

## Project Structure

- `public` - anything in here is published under the root of https://dpimap.org/
- `src/pages/measurement-community` - the CoP blog posts live here
- `src/pages/blog` - the blog posts live there
- `src/pages` - the rest of the website lives here

## CLI Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm start`               | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run codebook:pull`   | Refresh `src/codebook.json` from the sheet       |
| `npm run validate`        | Check `datapackage.json` and the latest CSVs     |
| `npm run codebook:check`  | Report where the codebook and the data disagree  |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |
