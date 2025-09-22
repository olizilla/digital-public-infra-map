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

Updates to the site are deployed to dpimap.org automatically when changes are merged into the main branch of this repository on GitHub. Cloudflare watches for changes, runs the build process (`npm install && npm run build`) and stores the updated html and css files and starts serving the new version of the website.

## Contributing

Contributions are welcome and encouraged! Share information about DPI deployments, provide feedback on our framework, or add to data and build on it. see: https://dpimap.org/contribute-to-the-dpi-map/ 

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
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |
