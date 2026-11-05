// The data release the site shows (D45): the folder public/data/<release>/, written by
// `npm run data:build -- --release <release>`. To switch the site to a new release, change
// the date here, in `release` and in each path. `npm run data:check` reads the release from here.
//
// Its datapackage.json is the codebook the site shows (D71), in src/Schema.ts, src/Codebook.ts
// and the history in src/Release.ts. The root datapackage.json is the next release's codebook,
// so a codebook change waits for its release, like a data change. The data build (except
// data:check, which rebuilds this release) and the changesets collection (src/ChangesetLoader.ts),
// which checks pending changesets too, read the root, as they work on the next release.
//
// No astro: imports, so the data build can load it in Node (scripts/site-modules.ts).
import datapackage from '../public/data/2026-11-06/datapackage.json'
import identity from '../public/data/2026-11-06/2026-11-06-identity.json'
import payment from '../public/data/2026-11-06/2026-11-06-payment.json'
import exchange from '../public/data/2026-11-06/2026-11-06-exchange.json'

export const release = '2026-11-06'

/** The release's datapackage.json: the codebook the site shows (D71) */
export const releasePackage = datapackage

/** Each table's rows, keyed by column header, as in the release's JSON, by resource name */
export const releaseTables: Record<'identity' | 'payment' | 'exchange', Record<string, any>[]> = { identity, payment, exchange }
