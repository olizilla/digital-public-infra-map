# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl==3.1.5"]
# ///
"""Extract evidence links from a published snapshot workbook into the release's sources JSON.

In the snapshot workbook many cells are hyperlinks: the cell text is the value
and the link is the evidence for it. The CSV and JSON exports lose the links,
so this script reads them from the .xlsx and writes:

  <out-dir>/public/data/2026-03-31/2026-03-31-sources.json   [{resource, key, field, url}], one per line
  <out-dir>/reports/na-with-evidence.csv             NA / Not Found cells that carry a link
  <out-dir>/reports/snapshot-sources.md              counts, and everything not handled cleanly

Snapshot rows are matched to System IDs by place and system name against the
latest CSVs named in datapackage.json. Rows that match no system, or more than
one, are reported and left out. Fields are looked up through datapackage.json
by header name, then by title.

Usage:
  uv run scripts/import/snapshot_sources.py <snapshot.xlsx> <out-dir> [--datapackage PATH]

No URLs are fetched. Output is deterministic for the same inputs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl

# Workbook tab -> datapackage resource. The tab names are the workbook's own
# structure, so they're named here; everything about columns comes from the
# datapackage.
SHEETS = {
    "ID- data contributions": "identity",
    "Payment- data contributions": "payment",
    "DES- data contributions": "exchange",
}

# The published release the workbook is
SNAPSHOT = "2026-03-31"

# Field ids with a special role.
KEY = "system_id"
PLACE = "country"
NAME = "name"
URL = "url"

NA_VALUES = {"na", "n/a", "not found"}
# Cell text that only points at the link, so the link is the value itself.
PLACEHOLDERS = {"here", "link", "click here", "see here", "source", "website", "see link"}

URL_TOKEN = re.compile(r"^(https?://|www\.)\S+$", re.IGNORECASE)
# dlapiperdataprotection.com pages name their country in a c= parameter.
DLA_COUNTRY = re.compile(r"dlapiperdataprotection\.com/.*[?&]c=([A-Za-z]{2})(?:&|$)")


def is_url_text(s: str) -> bool:
    """True when the text is one or more URLs (and nothing else)."""
    tokens = s.split()
    return bool(tokens) and all(URL_TOKEN.match(t) for t in tokens)


def norm_text(v) -> str:
    """Normalise a place or system name for matching."""
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip().casefold()


def cell_text(v) -> str:
    return "" if v is None else str(v).strip()


def norm_url(u: str) -> str:
    """For D19 duplicate checks: ignore scheme and trailing slash."""
    u = u.strip()
    u = re.sub(r"^[a-z][a-z0-9+.-]*://", "", u, flags=re.IGNORECASE)
    return u.rstrip("/")


def norm_url_loose(u: str) -> str:
    """Also ignore a leading www. and host case; only used to flag near misses."""
    u = norm_url(u)
    host, sep, rest = u.partition("/")
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    return host + sep + rest


@dataclass
class Resource:
    name: str
    fields: list[dict]
    by_id: dict[str, dict]
    header_to_id: dict
    index: dict[tuple[str, str], list[str]]  # (place, name) -> system ids


def load_package(path: Path) -> dict[str, Resource]:
    pkg = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for res in pkg["resources"]:
        if res["name"] not in SHEETS.values():
            continue
        fields = res["schema"]["fields"]
        by_id = {f["id"]: f for f in fields}
        by_name = {f["name"]: f["id"] for f in fields}
        by_title = {f.get("title", ""): f["id"] for f in fields}
        by_name_loose = {norm_text(f["name"]): f["id"] for f in fields}
        by_title_loose = {norm_text(f.get("title", "")): f["id"] for f in fields}

        def lookup(h, by_name=by_name, by_title=by_title, a=by_name_loose, b=by_title_loose):
            if h is None:
                return None
            return by_name.get(h) or by_title.get(h) or a.get(norm_text(h)) or b.get(norm_text(h))

        index: dict[tuple[str, str], list[str]] = defaultdict(list)
        with open(path.parent / res["path"], newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                rec = {by_name[k]: v for k, v in row.items() if k in by_name}
                index[(norm_text(rec[PLACE]), norm_text(rec[NAME]))].append(rec[KEY])
        out[res["name"]] = Resource(res["name"], fields, by_id, lookup, dict(index))
    return out


@dataclass
class Stats:
    rows: Counter = field(default_factory=Counter)
    links: Counter = field(default_factory=Counter)  # (resource, field, outcome)


def main(argv=None) -> int:
    here = Path(__file__).resolve()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("snapshot", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--datapackage", type=Path, default=here.parents[2] / "datapackage.json")
    args = ap.parse_args(argv)

    resources = load_package(args.datapackage)
    wb = openpyxl.load_workbook(args.snapshot)  # not read_only: hyperlinks need the full load

    sources: set[tuple[str, str, str, str]] = set()
    na_rows: list[dict] = []
    url_fixes: list[dict] = []
    placeholders: list[dict] = []
    oddities: list[dict] = []  # links we couldn't place
    unmatched: list[dict] = []
    ambiguous: list[dict] = []
    collisions: list[dict] = []
    near_dups: list[dict] = []
    other_country: list[dict] = []
    redirects: list[dict] = []
    unmapped_headers: list[tuple[str, str]] = []
    stats = Stats()

    for sheet, rname in SHEETS.items():
        if sheet not in wb.sheetnames:
            print(f"missing tab: {sheet}", file=sys.stderr)
            return 1
        ws = wb[sheet]
        res = resources[rname]
        headers = [c.value for c in ws[1]]
        col_field = []
        for h in headers:
            fid = res.header_to_id(h)
            if h not in (None, "") and fid is None:
                unmapped_headers.append((rname, str(h)))
            col_field.append(fid)
        col_of = {fid: i for i, fid in enumerate(col_field) if fid}

        # First pass: match each snapshot row to a System ID.
        matched: dict[int, str] = {}
        by_key: dict[str, list[int]] = defaultdict(list)
        for row in ws.iter_rows(min_row=2):
            if not any(cell_text(c.value) for c in row):
                continue
            stats.rows[(rname, "rows")] += 1
            place = cell_text(row[col_of[PLACE]].value)
            name = cell_text(row[col_of[NAME]].value)
            nlinks = sum(1 for c in row if c.hyperlink is not None)
            ids = res.index.get((norm_text(place), norm_text(name)), [])
            info = {"resource": rname, "row": row[0].row, "place": place, "name": name,
                    "links": nlinks, "ids": ids}
            if len(ids) == 1:
                matched[row[0].row] = ids[0]
                by_key[ids[0]].append(row[0].row)
            elif not ids:
                unmatched.append(info)
            else:
                ambiguous.append(info)
        for key, rows in by_key.items():
            if len(rows) > 1:
                for r in rows:
                    del matched[r]
                collisions.append({"resource": rname, "key": key, "rows": rows})
        stats.rows[(rname, "matched")] += len(matched)

        # Second pass: links on matched rows.
        for row in ws.iter_rows(min_row=2):
            r = row[0].row
            for c in row:
                if c.hyperlink is None:
                    continue
                fid = col_field[c.column - 1] if c.column <= len(col_field) else None
                value = cell_text(c.value)
                target = (c.hyperlink.target or "").strip()
                ctx = {"resource": rname, "cell": f"{c.column_letter}{r}",
                       "field": fid or "", "value": value, "url": target}
                if r not in matched:
                    stats.links[(rname, fid or "?", "row not matched")] += 1
                    continue
                key = matched[r]
                ctx["key"] = key
                if not target:
                    stats.links[(rname, fid or "?", "no link target")] += 1
                    ctx["problem"] = "link has no URL (internal location: %s)" % (c.hyperlink.location or "none")
                    oddities.append(ctx)
                    continue
                if fid is None:
                    stats.links[(rname, "?", "column not in datapackage")] += 1
                    ctx["problem"] = "column header not in datapackage"
                    oddities.append(ctx)
                    continue
                if fid == URL:
                    if is_url_text(value):
                        stats.links[(rname, fid, "URL value, skipped")] += 1
                    else:
                        stats.links[(rname, fid, "URL text isn't a URL, see below")] += 1
                        url_fixes.append({**ctx, "place": cell_text(row[col_of[PLACE]].value),
                                          "system name": cell_text(row[col_of[NAME]].value)})
                    continue
                if not value:
                    stats.links[(rname, fid, "empty cell")] += 1
                    ctx["problem"] = "link on an empty cell"
                    oddities.append(ctx)
                    continue
                if value.casefold() in PLACEHOLDERS:
                    stats.links[(rname, fid, "placeholder, link is the value")] += 1
                    placeholders.append(ctx)
                    continue
                if fid == NAME:
                    ucell = row[col_of[URL]]
                    utext = cell_text(ucell.value)
                    row_urls = (utext.split() if is_url_text(utext) else []) + (
                        [ucell.hyperlink.target.strip()] if ucell.hyperlink and ucell.hyperlink.target else [])
                    if any(norm_url(u) == norm_url(target) for u in row_urls):
                        stats.links[(rname, fid, "name link duplicates URL (D19)")] += 1
                        continue
                    if any(norm_url_loose(u) == norm_url_loose(target) for u in row_urls):
                        near_dups.append({**ctx, "row_url": row_urls[0]})
                if value.casefold() in NA_VALUES:
                    f = res.by_id[fid]
                    na_rows.append({
                        "resource": rname, "key": key,
                        "place": cell_text(row[col_of[PLACE]].value),
                        "system name": cell_text(row[col_of[NAME]].value),
                        "field id": fid, "field title": f.get("title", f["name"]).strip(),
                        "value": value, "url": target,
                    })
                stats.links[(rname, fid, "evidence")] += 1
                sources.add((rname, key, fid, target))
                m = DLA_COUNTRY.search(target)
                place_code = key.split("-")[1]
                if m and m.group(1).lower() != place_code:
                    other_country.append({**ctx, "place": cell_text(row[col_of[PLACE]].value),
                                          "link country": m.group(1).upper()})
                if "google.com/url?" in target:
                    redirects.append(ctx)

    out = args.out_dir
    (out / "reports").mkdir(parents=True, exist_ok=True)

    # The evidence for the snapshot's values, beside its tables, the baseline for history (D66)
    folder = out / "public" / "data" / SNAPSHOT
    folder.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(dict(zip(("resource", "key", "field", "url"), s)), ensure_ascii=False, separators=(",", ":"))
             for s in sorted(sources)]
    (folder / f"{SNAPSHOT}-sources.json").write_text("[\n" + ",\n".join(lines) + "\n]\n", encoding="utf-8")

    order = {rn: {f["id"]: i for i, f in enumerate(r.fields)} for rn, r in resources.items()}
    rorder = {rn: i for i, rn in enumerate(SHEETS.values())}
    na_rows.sort(key=lambda d: (rorder[d["resource"]], d["place"].casefold(), d["system name"].casefold(),
                                d["key"], order[d["resource"]][d["field id"]], d["url"]))
    na_cols = ["resource", "key", "place", "system name", "field id", "field title", "value", "url"]
    with open(out / "reports" / "na-with-evidence.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, na_cols, lineterminator="\n")
        w.writeheader()
        w.writerows(na_rows)

    report = render_report(args, resources, stats, sources, na_rows, url_fixes, placeholders, oddities,
                           unmatched, ambiguous, collisions, near_dups, unmapped_headers,
                           other_country, redirects)
    (out / "reports" / "snapshot-sources.md").write_text(report, encoding="utf-8")
    print(f"{len(sources)} sources, {len(na_rows)} NA with evidence; see {out / 'reports'}")
    return 0


def md_escape(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def table(cols: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(md_escape(x) for x in r) + " |" for r in rows]
    return "\n".join(lines) + "\n"


def render_report(args, resources, stats, sources, na_rows, url_fixes, placeholders, oddities,
                  unmatched, ambiguous, collisions, near_dups, unmapped_headers,
                  other_country, redirects) -> str:
    digest = hashlib.sha256(args.snapshot.read_bytes()).hexdigest()
    rnames = list(SHEETS.values())
    by_res = Counter(s[0] for s in sources)
    na_by_res = Counter(d["resource"] for d in na_rows)
    p = []
    p.append("# Snapshot evidence links\n")
    p.append(f"Generated by `scripts/import/snapshot_sources.py` from `{args.snapshot.name}` "
             f"(sha256 `{digest[:16]}…`). Rows are matched to System IDs by place and system name "
             "against the latest CSVs. No URLs were fetched.\n")
    p.append("An .xlsx cell holds at most one hyperlink, so a cell whose text linked to several pages "
             "in the Google Sheet keeps only one of them here.\n")

    p.append("## Summary\n")
    def outcome_total(rn, pred):
        return sum(n for (r, _, o), n in stats.links.items() if r == rn and pred(o))
    rows = []
    for rn in rnames:
        rows.append([rn, stats.rows[(rn, "rows")], stats.rows[(rn, "matched")],
                     outcome_total(rn, lambda o: True), by_res[rn],
                     outcome_total(rn, lambda o: o == "name link duplicates URL (D19)"),
                     na_by_res[rn]])
    p.append(table(["resource", "snapshot rows", "rows matched", "links seen", "sources emitted",
                    "name links dropped (D19)", "NA with evidence"], rows))

    p.append("## Links per field\n")
    p.append("Every hyperlink on a snapshot row, by what happened to it. `evidence` links are in "
             f"`public/data/{SNAPSHOT}/{SNAPSHOT}-sources.json`.\n")
    for rn in rnames:
        res = resources[rn]
        outcomes = sorted({o for (r, _, o) in stats.links if r == rn}, key=lambda o: (o != "evidence", o))
        rows = []
        for f in res.fields + [{"id": "?", "name": "?"}]:
            counts = [stats.links.get((rn, f["id"], o), 0) for o in outcomes]
            if any(counts):
                rows.append([f["id"]] + [c or "" for c in counts])
        p.append(f"### {rn}\n")
        p.append(table(["field"] + outcomes, rows))

    p.append("## Not handled cleanly\n")

    p.append(f"### Snapshot rows with no matching system ({len(unmatched)})\n")
    p.append("No row in the latest CSV has this place and system name. Their links are left out.\n")
    if unmatched:
        p.append(table(["resource", "snapshot row", "place", "system name", "links"],
                       [[d["resource"], d["row"], d["place"], d["name"], d["links"]] for d in unmatched]))

    p.append(f"### Snapshot rows matching more than one system ({len(ambiguous)})\n")
    if ambiguous:
        p.append(table(["resource", "snapshot row", "place", "system name", "links", "candidates"],
                       [[d["resource"], d["row"], d["place"], d["name"], d["links"], ", ".join(d["ids"])]
                        for d in ambiguous]))

    p.append(f"### Systems matched by more than one snapshot row ({len(collisions)})\n")
    if collisions:
        p.append(table(["resource", "key", "snapshot rows"],
                       [[d["resource"], d["key"], ", ".join(map(str, d["rows"]))] for d in collisions]))

    p.append(f"### URL cells whose text isn't a URL but which carry a link ({len(url_fixes)})\n")
    p.append("These are values to fix on import, not evidence, so none is in `sources.csv`. "
             "Check each link before using it as the system's URL: many point at a different place's "
             "system (for example Chad's links to Armenia's ekeng.am), so the link may be left over "
             "from another row rather than this system's real URL.\n")
    if url_fixes:
        p.append(table(["resource", "key", "cell", "place", "system name", "text", "link"],
                       [[d["resource"], d["key"], d["cell"], d["place"], d["system name"], d["value"], d["url"]]
                        for d in url_fixes]))

    p.append(f"### Placeholder text where the link is the value ({len(placeholders)})\n")
    if placeholders:
        p.append(table(["resource", "key", "cell", "field", "text", "link"],
                       [[d["resource"], d["key"], d["cell"], d["field"], d["value"], d["url"]]
                        for d in placeholders]))

    p.append(f"### Other links not used ({len(oddities)})\n")
    if oddities:
        p.append(table(["resource", "key", "cell", "field", "text", "problem"],
                       [[d["resource"], d["key"], d["cell"], d["field"], d["value"], d["problem"]]
                        for d in oddities]))

    p.append(f"### Name links kept that differ from the URL only by `www.` or host case ({len(near_dups)})\n")
    p.append("D19 compares after ignoring scheme and trailing slash only, so these are kept as evidence.\n")
    if near_dups:
        p.append(table(["resource", "key", "cell", "name link", "row URL"],
                       [[d["resource"], d["key"], d["cell"], d["url"], d["row_url"]] for d in near_dups]))

    p.append(f"### Evidence links that name a different country ({len(other_country)})\n")
    p.append("Kept in `sources.csv` (D4), but worth a look: the dlapiperdataprotection.com page's `c=` "
             "country differs from the row's place. Some are expected (a territory citing its state's "
             "law); others suggest a link copied from another row. Only this one site is checked, "
             "so treat it as a sample of the problem, not its extent.\n")
    if other_country:
        p.append(table(["resource", "key", "place", "cell", "field", "text", "link country"],
                       [[d["resource"], d["key"], d["place"], d["cell"], d["field"], d["value"],
                         d["link country"]] for d in other_country]))

    p.append(f"### Evidence links wrapped in a Google redirect ({len(redirects)})\n")
    p.append("Kept as they are in `sources.csv`; the real URL is in the `q=` parameter.\n")
    if redirects:
        p.append(table(["resource", "key", "cell", "field", "link"],
                       [[d["resource"], d["key"], d["cell"], d["field"], d["url"]] for d in redirects]))

    if unmapped_headers:
        p.append(f"### Workbook columns not in datapackage.json ({len(unmapped_headers)})\n")
        p.append(table(["resource", "header"], [list(x) for x in unmapped_headers]))

    p.append(f"### NA or Not Found cells with evidence ({len(na_rows)})\n")
    p.append("Listed in `reports/na-with-evidence.csv` for the researchers to review. Their links are "
             "also in `sources.csv`, as evidence for the cell as it stands. Many look left over from "
             "another row rather than evidence for NA (Angola's NA cells link to pages about Algeria, "
             "the row above it alphabetically), so a case may end as \"drop the link\" rather than "
             "\"Not Found\".\n")
    return "\n".join(p)


if __name__ == "__main__":
    sys.exit(main())
