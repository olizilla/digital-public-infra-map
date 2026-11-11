# Pending changesets

Changesets that haven't been released yet, as `next/<resource>/<id>.toml`. New changesets go here, from the importer, the editor or by hand.

The next release is the previous release's tables (`public/data/<date>/`) plus these changes, built by `npm run data:build -- --release <date>`. Cutting the release moves everything here into `changesets/<date>/`. Released changesets are never edited again.

The site shows released data only, so these aren't on system pages yet. The pending changelog, `/changes/`, shows them against the latest release, apart from the releases' own changelogs at `/changes/<date>/`. See D46, D66 and D81 in the decisions log.
