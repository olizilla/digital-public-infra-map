# 🗺️ Digital Public Infrastructure Map

Tracking the state of national-scale digital infrastructure around the world. 

<img width="1468" alt="screenshot of the ui. it's got a map of the world showing which regions are running digital public infrastructure projects." src="https://github.com/user-attachments/assets/7398f03d-dd4b-4330-ae6a-265e21254f58" />

## Getting started

**Editors:** You can edit the site via [Pages CMS](https://pagescms.org/).

**The bold and the curious:** You can build this website on your computer:

- Install [node.js](https://nodejs.org)
- Download the code by cloning this repo
- Run `npm install` to fetch the dependencies
- Run `npm start` to build the site and start a local server
- Open http://localhost:4321 in your browser

You can now add new pages and edit existing ones and see those changes live in your browser.

## Project Structure

- `public` - anything in here is published under the root of https://dpimap.org/
- `src/pages/measurement-community` - the CoP blog posts live here
- `src/pages/blog` - the dataset release blog posts live there
- `src/pages` - the rest of the website lives here

## CLI Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |
