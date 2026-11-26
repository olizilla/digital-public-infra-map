# Pending changesets

Changesets that haven't been released yet, as `next/<resource>/<id>.toml`. New changesets go here, from the importer, the editor or by hand.

The next release is the previous release's tables (`public/data/<date>/`) plus these changes, built by `npm run data:build -- --release <date>`. Cutting the release moves everything here into `changesets/<date>/`. Released changesets are never edited again.

The site shows released data only, so these aren't on system pages yet; only the editor's pages (`/<System ID>/edit/`, `/edit/`, `/edit/new/`) show them, so a proposal is always about the data as the next release will have it (D93). The pending changelog, `/changes/`, shows them against the latest release, apart from the releases' own changelogs at `/changes/<date>/`. See D46, D66 and D81 in the decisions log.

## Proposals

A proposal is an issue with the `proposal` label, opened from the editor at `/<System ID>/edit/`, holding one changeset's TOML. A check comments on it, saying what it would do (`.github/workflows/proposal-check.yml`). Ask any questions on the issue.

To accept it, someone on the team other than its author, with triage access or more, closes it as **completed**. The proposal-accept workflow then commits the issue's TOML, as written, to `next/<resource>/<id>.toml` on `main`, with a new id, comments on the commit, and leaves a line on the issue naming the file. It reopens the issue and says why instead if the TOML changed since the check's comment, it was edited in the 5 minutes before it was closed, it no longer passes the check or `data:check`, or whoever closed it can't accept it. Closing it as **not planned** declines it, and nothing happens. A pull request or commit that closes it, like a batch of planned changes, doesn't commit it again. If nothing appears on the issue a few minutes after closing it, reopen it and close it again. See D88 in the decisions log.

To undo an accepted proposal before the next release, delete its file here, or add a changeset that changes it back. Once released, fix it forward with a new changeset (D66).
