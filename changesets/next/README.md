# Pending changesets

Changesets that haven't been released yet, as `next/<resource>/<id>.toml`. New changesets go here, from the importer, the editor or by hand.

The next release is the previous release's tables (`public/data/<date>/`) plus these changes, built by `npm run data:build -- --release <date>`. Cutting the release moves everything here into `changesets/<date>/`. Released changesets are never edited again.

The site shows released data only, so these aren't on system pages yet. See D46 and D66 in the decisions log.
