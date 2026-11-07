# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "openpyxl>=3.1",
#   "jsonschema>=4.21",
# ]
# ///
"""
Turn the researchers' proposal change logs (a Google Sheets export) into
changesets, the append-only log format in docs/design/data-entry.md (D7, as
amended by D27, D29, D30, D31, D33, D35 and D39).

usage: uv run scripts/import/proposals.py <proposals.xlsx> <repo-root> --created-at <ISO UTC> [--previous <older.xlsx>]

--created-at is when this export's changesets were created (D33), like
2026-10-30T12:00:00Z. The Nth changeset's id has that time plus N seconds, so
pin one time per export: re-runs with the same time give the same ids. Choose
a time far enough back that the last id isn't in the future.

With --previous, the report also compares this export with an older one:
tabs added and removed, where the rows of removed tabs went, and row counts.

The baseline is the latest release: the newest public/data/<date>/ with
<date>-<resource>.json for every table, whose rows have System IDs (D66).

Writes, under <repo-root>:
- lib/changesets/changeset.schema.json, the JSON Schema for a changeset
- changesets/next/<resource>/<UTC timestamp>-<4 hex>.toml, pending changesets:
  one per system per tab, and one wording changeset per table that puts
  published values into the agreed wording (D54, D55; see WORDING)
- reports/import-proposals.md, its CSVs, and reports/draft-schema-changes.json

It is deterministic: the same workbook, baseline and --created-at give the same
files. Changesets it wrote on an earlier run (listed in
reports/import-proposals-changesets.csv) are deleted first, if they're still
pending in changesets/next/, so it can be re-run after the sheets are locked.
Released changesets, in changesets/<date>/, are never touched.

Rows are only attributed to a system by the rules below. A row that can't be
attributed is reported, never guessed.

Reasons are the sheet's rationale text, with spaces and tabs tidied, or "" if
it's blank. The importer never writes one, and sheet references only go in the
reports (D24, D26, D27, D29). The exception is the wording changesets, whose
reasons state the team's decisions (D54).
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import sys
import tomllib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import jsonschema
import openpyxl

# The name of each change's date field. It's here, and only here, because it may
# be renamed.
DATE_FIELD = 'as_of'

# A finding's date is its row's own, if that's a specific date. Rows with no date,
# or a vague one, use this one (D34).
DEFAULT_AS_OF = '2026-10-15'

# Changeset ids are <UTC timestamp>-<4 hex>. The time is when the changeset was
# created (D33): --created-at plus one second per changeset, in tab order and then
# System ID order, so a system created by one tab exists before a later tab updates
# it. The 4 hex is a hash of (tab, System ID). Ids must not be in the future.
CHANGESET_ID = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[0-9a-f]{4}$')

# resource -> the type part of a System ID
TYPES = {'identity': 'id', 'payment': 'pay', 'exchange': 'dx'}

# Fields whose values are calculated, so never emitted as findings.
DERIVED = {'last_updated', 'dpi_count'}

# ---------------------------------------------------------------------------
# The tabs to apply, in order. Data Exchange_Changelog_Old is left out (D14).


@dataclass
class Tab:
    title: str
    resource: str
    # the column that names the system, for places with several
    hint: str | None = None
    # take the header from another tab, for a tab that has none
    header_from: str | None = None
    # the sheet row the data starts on
    first_row: int = 2
    # rows after a "Break for ..." marker are a second, new system
    breaks: bool = False
    # every value is a default (N/A) for a new variable, unless it isn't
    defaults_log: bool = False
    # the row's date is in a column with no heading, between these two headed columns
    date_between: tuple | None = None


TABS = [
    Tab('Digital ID_ChangeLog', 'identity'),
    Tab('Digital ID_Notes', 'identity'),
    Tab('Payment_ChangeLog_New', 'payment', hint='notes'),
    Tab('Payment_ChangeLog_New-Settlement', 'payment', hint='notes'),
    # "Codebook revision" relabelling of payment system types (Mobile money -> Mobile money system)
    Tab('Payment_ChangeLog_New-MM Label', 'payment', hint='notes'),
    Tab('Payments_Other', 'payment', hint='notes', header_from='Payment_ChangeLog_New', first_row=2),
    Tab('Data Exchange_FinalLog', 'exchange', hint='system_name', breaks=True, date_between=('url', 'system_name')),
    Tab('Data Exchange_NewVar_Log', 'exchange', hint='system_name', defaults_log=True),
]

# Change logs that are not applied (D14), so not reported as unknown tabs
SKIPPED_TABS = ['Data Exchange_Changelog_Old', 'Payment_Notes']

# Column headers, as normalised by `key`, for each column the importer reads.
COLUMNS = {
    'place': ['country region', 'country'],
    'var': ['variable name', 'variable name general note'],
    'prev': ['previous data point'],
    'new': ['new data point'],
    'url': ['url'],
    'date': ['date edited'],
    'rationale': ['rational for change', 'rationale for change'],
    'notes': ['notes', 'comments notes'],
    'links': ['additional links'],
    'system_name': ['tracker system name', 'system name', 'data exchange system name'],
    'reviewed': ['reviewed for publication'],
    # only listed in the not-reviewed report: it's not a date, and not a source of regions
    'updated': ['updated in the dataset'],
}
# any header with these words is the "New system" column (D5)
NEW_SYSTEM_HEADER = 'new system'

# ---------------------------------------------------------------------------
# Known cases, decided with the research team. Each one is listed in the report.

# Systems removed as duplicates of another, by tab: (key, duplicate_of, rows)
KNOWN_DUPLICATES = {
    'Payment_ChangeLog_New': [
        ('pay-lac-03', 'pay-lac-01', [5, 6]),
    ],
}

# Places whose rows are all one new system, in any tab of the resource, with
# the place code and Country / Region to use: (resource, place) -> (code, country)
KNOWN_NEW = {
    ('payment', 'rwanda-tanzania'): ('africa', 'Africa'),
}

# Notes or rationale that mean "remove this system", like "Delete row and related data"
REMOVE_NOTE = re.compile(r'^\s*(delete|remove)\b.*\b(row|fields?|data|values)\b', re.I)

# ---------------------------------------------------------------------------
# Variable names that drift from the datapackage's names and titles.
# normalised log name -> field id. Each use is reported.
DRIFT = {
    'payment': {
        'data handling rules for payment system': 'data_handling_rules',
        'dpi like': 'dpi_count',
    },
    'exchange': {
        'scalability': 'scalable_architecture',
        'coordinating entity': 'coordination_unit',
        'procedural rules for data management': 'data_management_rules',
        'sectoral cross sectoral': 'sectoral',
        'dpi like': 'dpi_count',
        'once only policy': 'once_only_principle',
        'near real time sharing': 'realtime_sharing',
    },
    'identity': {
        'dpi like': 'dpi_count',
    },
}

# ---------------------------------------------------------------------------
# The draft schema changes, written to reports/draft-schema-changes.json and
# used with the current datapackage to validate. datapackage.json isn't edited.
# The schema migration for the 2026-11-06 release (M3a) applied this round's:
# the new fields, Not Found as a value (D37, D61), Suspended, Mobile money
# system, Private PSP, and Semantic interoperability's new field,
# interoperability_level (D51). So the draft only holds what's still open.

# Values the codebook proposals add to an existing field: (resource, field id) -> values
ADD_ENUM = {}

DRAFT = {
    'description': (
        'Proposed changes to datapackage.json, drafted by scripts/import/proposals.py from the proposal logs. '
        'Not applied. Field ids are proposals: once agreed they are never reused and never change meaning (D7).'
    ),
    'newFields': {},
    'fieldChanges': {
        # filled in by Schema: Suspended for each status, and ADD_ENUM
    },
    'openQuestions': [
        'payment system_type: the agreed wording rewrites Mobile money and Mobile wallet as Mobile money system. '
        'Should Mobile money leave the allowed values?',
        'Country / Region for regional systems: the codebook lists Africa, Asia, Europe, Oceania, NorAm and LAC.',
    ],
    # Fields that are no longer in datapackage.json, so the sheets' values for them are skipped (D51)
    'retiredFields': {
        'payment': [
            {'id': 'settlement_type', 'name': 'Type of settlement system', 'rule': 'ignore',
             'note': 'Split into clearing_infrastructure and settlement_method. The logs set both for each system, '
                     'and mark this column for removal ("Marked for removal", "Removed (column deleted)").'},
        ],
    },
}

# Values that mean a column is being removed, not a value for it
RETIRED_VALUES = {'marked for removal', 'removed (column deleted)'}

# PROVISIONAL: Oli hasn't confirmed this. Rows marked "Reviewed for Publication: No" are left
# out of the changesets and listed in reports/import-proposals-not-reviewed.csv. To drop the
# rule, set this to False: nothing else depends on it.
LEAVE_OUT_NOT_REVIEWED = True

# Rationales that say the opposite of the cell's value (D37), for
# reports/import-proposals-na-not-found.csv. Listed, not changed.
NA_BUT_NOT_FOUND = re.compile(r'\bnot found\b|\bno (source|information|evidence|data)\b|\bcould not (find|locate)\b', re.I)
NOT_FOUND_BUT_NOT_RECORDED = re.compile(r'\bnot (yet )?recorded\b', re.I)

# ---------------------------------------------------------------------------
# Helpers


def key(text):
    """Normalise a header, variable or place name for matching"""
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').replace('’', "'").casefold()).strip()


def place_key(text):
    return re.sub(r'\s+', ' ', (text or '').replace('’', "'").casefold()).strip()


def cell_text(value):
    """The text of a cell, as the sheet shows it"""
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, dt.datetime):
        return value.date().isoformat() if value.time() == dt.time() else value.isoformat()
    return str(value).strip()


def is_placeholder(name):
    """A system row with no name yet"""
    return name.strip().casefold() in ('', 'na', 'n/a', '-')


def is_blank(value):
    return value.strip() in ('', '-', '–')


def name_keys(name):
    """Keys for fuzzy matching of system names: alphanumerics only, with and without (parentheses)"""
    full = re.sub(r'[^a-z0-9]', '', (name or '').casefold())
    bare = re.sub(r'[^a-z0-9]', '', re.sub(r'\([^)]*\)', '', (name or '').casefold()))
    return {k for k in (full, bare) if len(k) >= 4}


def names_match(a, b):
    if a and b and re.sub(r'[^a-z0-9]', '', a.casefold()) == re.sub(r'[^a-z0-9]', '', b.casefold()):
        return True
    return any(x in y or y in x for x in name_keys(a) for y in name_keys(b))


URL_WITH_SCHEME = re.compile(r'(?:https?://|www\.)[^\s<>"\'|]+', re.I)
URL_BARE = re.compile(r'(?<![\w@/.])(?:[a-z0-9-]+\.)+[a-z]{2,}/[^\s<>"\'|]*', re.I)


def clean_url(url):
    url = url.rstrip('.,;:]}\'"')
    while url.endswith(')') and url.count(')') > url.count('('):
        url = url[:-1]
    if not re.match(r'https?://', url, re.I):
        url = 'https://' + url
    return url


def urls_in(text):
    found = URL_WITH_SCHEME.findall(text or '')
    rest = URL_WITH_SCHEME.sub(' ', text or '')
    found += URL_BARE.findall(rest)
    return [clean_url(u) for u in found]


def changeset_id(created_at, n, tab, system_id):
    """The id of the nth changeset: when it was created, plus a hash of its tab and system"""
    digest = hashlib.sha256(f'{tab}\n{system_id}'.encode()).hexdigest()
    when = created_at + dt.timedelta(seconds=n)
    return f"{when.strftime('%Y-%m-%dT%H%M%SZ')}-{digest[:4]}"


def utc_time(text):
    """The --created-at argument, which must say it's UTC"""
    try:
        when = dt.datetime.fromisoformat(text)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f'{text!r} is not an ISO time') from e
    if when.utcoffset() != dt.timedelta(0):
        raise argparse.ArgumentTypeError(f'{text!r} is not UTC: end it with Z')
    return when.astimezone(dt.timezone.utc).replace(microsecond=0)


MONTHS = {m.casefold(): i + 1 for i, m in enumerate(
    'January February March April May June July August September October November December'.split())}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
MONTHS['sept'] = 9
DAY_MONTH = r'(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?'


def row_date(text):
    """(a row's date as YYYY-MM-DD or None, how we read it: specific, blank, no year or vague)"""
    text = text.strip()
    if not text:
        return None, 'blank'
    if re.match(r'\d{4}-\d{2}-\d{2}(T|$)', text):
        # a date cell's text, with or without a time
        try:
            return dt.date.fromisoformat(text[:10]).isoformat(), 'specific'
        except ValueError:
            return None, 'vague'
    folded = text.casefold()
    m = re.fullmatch(DAY_MONTH + r'\s+(\d{4})', folded)
    if m and m[2] in MONTHS:
        try:
            return dt.date(int(m[3]), MONTHS[m[2]], int(m[1])).isoformat(), 'specific'
        except ValueError:
            return None, 'vague'
    m = re.fullmatch(DAY_MONTH, folded)
    if m and m[2] in MONTHS:
        return None, 'no year'
    return None, 'vague'


def baseline_date(text):
    """A baseline row's Last updated, written dd/mm/yy up to 2026-03-31 and YYYY-MM-DD since (D49), as YYYY-MM-DD or None"""
    for fmt in ('%d/%m/%y', '%Y-%m-%d'):
        try:
            return dt.datetime.strptime(text.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


# ---------------------------------------------------------------------------
# Changesets are TOML (D39). tomllib only reads, so this writes them by hand, in
# the order a person reads them: type, key, what it points at, date, values, reason, sources.

TOML_ESCAPES = {'\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r'}
# What can't go in a """ string as it is: control characters and backslashes, three
# quotes in a row, and a quote at the very end, next to the closing quotes.
NOT_MULTILINE = re.compile(r'[\x00-\x09\x0b-\x1f\x7f\\]|"""|"$')


def toml_string(text):
    def escape(ch):
        if ch in TOML_ESCAPES:
            return TOML_ESCAPES[ch]
        return f'\\u{ord(ch):04X}' if ord(ch) < 0x20 or ord(ch) == 0x7f else ch
    return '"' + ''.join(escape(ch) for ch in text) + '"'


def toml_text(text):
    """A string that reads better over several lines, if it has several and that's safe"""
    if '\n' in text and not NOT_MULTILINE.search(text):
        return '"""\n' + text + '"""'
    return toml_string(text)


def toml_change(change):
    known = {'type', 'key', 'duplicate_of', 'changeset', DATE_FIELD, 'values', 'reason', 'sources', 'table', 'sources_file'}
    if set(change) - known:
        raise ValueError(f'no TOML layout for {sorted(set(change) - known)}')
    lines = ['[[changes]]']
    for name in ('type', 'key', 'duplicate_of', 'changeset'):
        if name in change:
            lines.append(f'{name} = {toml_string(change[name])}')
    if DATE_FIELD in change:
        # a bare TOML date, which the checks turn back into this text
        lines.append(f'{DATE_FIELD} = {dt.date.fromisoformat(change[DATE_FIELD]).isoformat()}')
    for fid, value in change.get('values', {}).items():
        lines.append(f'values.{fid} = {toml_string(value)}')
    if 'reason' in change:
        lines.append(f'reason = {toml_text(change["reason"])}')
    for name in ('table', 'sources_file'):
        if name in change:
            lines.append(f'{name} = {toml_string(change[name])}')
    if change.get('sources'):
        lines += ['sources = [', *(f'  {toml_string(url)},' for url in change['sources']), ']']
    return '\n'.join(lines) + '\n'


def read_changeset(text):
    """A changeset's data as the schema checks it, with its dates as text"""
    data = tomllib.loads(text)
    for change in data.get('changes', []):
        if isinstance(change.get(DATE_FIELD), dt.date):
            change[DATE_FIELD] = change[DATE_FIELD].isoformat()
    return data


def write_toml(path, data):
    text = '\n'.join(toml_change(change) for change in data['changes'])
    if read_changeset(text) != data:
        raise ValueError(f'{path}: the TOML does not read back as the same data')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# The changeset schema (D7), generated here so DATE_FIELD is in one place.


def changeset_schema():
    common = {
        'key': {'type': 'string', 'minLength': 1, 'description': "The row's primary key, like a System ID."},
        DATE_FIELD: {'$ref': '#/$defs/date'},
        'reason': {'$ref': '#/$defs/reason'},
        'sources': {'$ref': '#/$defs/sources'},
    }
    required = ['type', 'key', DATE_FIELD, 'reason']

    def change(kind, description, extra=None, extra_required=()):
        return {
            'description': description,
            'type': 'object',
            'properties': {'type': {'const': kind}, **common, **(extra or {})},
            'required': [*required, *extra_required],
            'additionalProperties': False,
        }

    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'title': 'Changeset',
        'description': (
            'One changeset file, changesets/<release>/<resource>/<UTC timestamp>-<4 hex>.toml, or changesets/next/<resource>/… while it is pending, whose filename is its id. '
            'The path says which table it applies to, and the timestamp is when it was created. '
            'See D7, D31, D33, D35, D39, D53 and D66 in docs/design/data-entry.md. '
            "The author is the changeset's author if it has one, or else the commit's author. "
            f'A change replaces the value in the previous release. Among the changes in one release, latest {DATE_FIELD} wins, with ties broken by changeset id. '
            f'This schema checks the parsed TOML, once {DATE_FIELD} has been turned from a TOML date into a string.'
        ),
        'type': 'object',
        'properties': {
            'summary': {'type': 'string', 'minLength': 1,
                        'description': 'Optional: why a set of changes belongs together, if a person wants to say so (D30).'},
            'author': {'type': 'string', 'pattern': r'^[^<>]+ <[^<>]+>$',
                       'description': (
                           'Optional: who made the changes, as in git: "Name <identifier>", where the identifier may be '
                           'an email, URL or DID. When it is missing, the commit\'s author is the author (D53).'
                       )},
            'changes': {'type': 'array', 'minItems': 1, 'items': {'$ref': '#/$defs/change'}},
        },
        'required': ['changes'],
        'additionalProperties': False,
        '$defs': {
            'date': {'type': 'string', 'pattern': r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', 'description': 'The date the finding is about, as YYYY-MM-DD. In the file it is a bare TOML date.'},
            'reason': {'type': 'string', 'description': 'Why: the rationale for the finding. Required, but may be "", which records that none was given (D27).'},
            'sources': {
                'type': 'array', 'uniqueItems': True, 'description': 'Evidence links. None is allowed (D10).',
                'items': {'type': 'string', 'pattern': r'^https?://\S+$'},
            },
            'values': {
                'type': 'object', 'minProperties': 1,
                'description': 'Field id -> the exact text of the cell. Any text, including "" (D36).',
                'propertyNames': {'pattern': '^[a-z][a-z0-9_]*$'},
                'additionalProperties': {'type': 'string'},
            },
            'changesetId': {'type': 'string', 'pattern': CHANGESET_ID.pattern},
            'change': {
                'type': 'object',
                'required': ['type'],
                'properties': {'type': {'enum': ['create', 'update', 'remove', 'revert', 'snapshot']}},
                'allOf': [
                    {'if': {'properties': {'type': {'const': kind}}}, 'then': {'$ref': f'#/$defs/{kind}'}}
                    for kind in ['create', 'update', 'remove', 'revert', 'snapshot']
                ],
            },
            'create': change('create', 'A new row. The row must not exist, and values must include every required field.',
                            {'values': {'$ref': '#/$defs/values'}}, ['values']),
            'update': change('update', 'New values for an existing row: at least one.',
                            {'values': {'$ref': '#/$defs/values'}}, ['values']),
            'remove': change('remove', 'Remove an existing row, optionally as a duplicate of another.',
                            {'duplicate_of': {'type': 'string', 'minLength': 1, 'description': 'The key of the row this one duplicates.'}}),
            'revert': {
                'description': 'Leave out the changes of a whole, earlier changeset when building.',
                'type': 'object',
                'properties': {
                    'type': {'const': 'revert'},
                    'changeset': {'$ref': '#/$defs/changesetId'},
                    DATE_FIELD: {'$ref': '#/$defs/date'},
                    'reason': {'$ref': '#/$defs/reason'},
                    'sources': {'$ref': '#/$defs/sources'},
                },
                'required': ['type', 'changeset', DATE_FIELD, 'reason'],
                'additionalProperties': False,
            },
            'snapshot': {
                'description': "Not used any more: the baseline was a snapshot like this until D66, and is now the previous release's tables. The build skips a changeset that has one.",
                'type': 'object',
                'properties': {
                    'type': {'const': 'snapshot'},
                    'reason': {'$ref': '#/$defs/reason'},
                    'table': {'type': 'string', 'minLength': 1, 'description': "CSV of the resource's rows, relative to this file."},
                    'sources_file': {'type': 'string', 'minLength': 1,
                                     'description': 'CSV of evidence links (resource, key, field, url), relative to this file.'},
                },
                'required': ['type', 'table'],
                'additionalProperties': False,
            },
        },
    }


# ---------------------------------------------------------------------------
# The schema: current datapackage fields plus the draft


class Schema:
    def __init__(self, datapackage):
        self.resources = {}
        for r in datapackage['resources']:
            if r['name'] not in TYPES:
                continue
            self.resources[r['name']] = r
        # Draft field changes: Suspended for each status field, and the codebook's new payment system type
        changes = {}
        for name, r in self.resources.items():
            for f in r['schema']['fields']:
                enum = f.get('constraints', {}).get('enum')
                if f['id'] == 'status' and enum is not None and 'Suspended' not in enum:
                    changes.setdefault(name, {})[f['id']] = {'addEnum': ['Suspended']}
                for value in ADD_ENUM.get((name, f['id']), []):
                    if enum is not None and value not in enum:
                        changes.setdefault(name, {}).setdefault(f['id'], {}).setdefault('addEnum', []).append(value)
        DRAFT['fieldChanges'] = changes
        self.fields = {}
        for name, r in self.resources.items():
            fields = {}
            for f in r['schema']['fields']:
                f = json.loads(json.dumps(f))
                add = changes.get(name, {}).get(f['id'], {}).get('addEnum')
                if add:
                    f['constraints']['enum'] = f['constraints']['enum'] + add
                fields[f['id']] = f
            for f in DRAFT['newFields'].get(name, []):
                fields[f['id']] = {**f, 'draft': True}
            self.fields[name] = fields
        self.retired = {name: {f['id']: f for f in DRAFT['retiredFields'].get(name, [])} for name in self.resources}
        # each missing value is text, or { value, label } (Data Package v2)
        self.missing = {name: [m if isinstance(m, str) else m['value'] for m in r['schema'].get('missingValues', ['NA'])]
                        for name, r in self.resources.items()}
        # lookup: name, then title, then aliases, then drift
        self.lookup = {}
        for name in self.resources:
            index = {}
            fields = list(self.fields[name].values()) + list(self.retired[name].values())
            for prop in ('name', 'title', 'aliases'):
                for f in fields:
                    vals = f.get(prop) or []
                    for v in ([vals] if isinstance(vals, str) else vals):
                        index.setdefault(key(v), (f['id'], prop))
            for k, fid in DRIFT.get(name, {}).items():
                index.setdefault(k, (fid, 'drift'))
            self.lookup[name] = index

    def field_for(self, resource, variable):
        """(field id, how) for a log's variable name, or (None, None)"""
        return self.lookup[resource].get(key(variable), (None, None))

    def field(self, resource, fid):
        return self.fields[resource].get(fid)

    def name_field(self, resource):
        return 'name'

    def header(self, resource, fid):
        f = self.fields[resource].get(fid) or self.retired[resource].get(fid)
        return f['name'] if f else fid

    def required(self, resource):
        return [fid for fid, f in self.fields[resource].items()
                if f.get('constraints', {}).get('required') and fid not in DERIVED and fid != 'system_id']

    def id_pattern(self, resource):
        return self.fields[resource]['system_id']['constraints']['pattern']


# ---------------------------------------------------------------------------
# Values

STATUS_SYNONYMS = {
    'pilot/planned': 'Planned/Piloted', 'planned/pilot': 'Planned/Piloted', 'planned / piloted': 'Planned/Piloted',
    'pilot': 'Planned/Piloted', 'piloted': 'Planned/Piloted', 'planned': 'Planned/Piloted',
    'planned/piloted': 'Planned/Piloted', 'pilot/ planned': 'Planned/Piloted', 'planned/ piloted': 'Planned/Piloted',
}


def list_values(f):
    """The values a multi-valued field allows: the alternatives in a pattern like (a|b)(, (a|b))*,
    then any that must be the whole cell, like Not Found in (a|b)(, (a|b))*|Not Found"""
    pattern = f.get('constraints', {}).get('pattern') or ''
    m = re.match(r'^\(((?:\\.|[^()\\])*)\)', pattern)
    if not m or not pattern.startswith(f'({m[1]})(, ({m[1]}))*'):
        return None
    rest = pattern[len(f'({m[1]})(, ({m[1]}))*'):]
    whole = [] if rest == '' else re.split(r'(?<!\\)\|', rest[1:]) if rest.startswith('|') else None
    if whole is None or not all(re.fullmatch(r'(?:\\.|[^\\|()\[\]{}*+?.^$])+', w) for w in whole):
        return None
    return [re.sub(r'\\(.)', r'\1', x) for x in re.split(r'(?<!\\)\|', m[1]) + whole]


def canon(text):
    return re.sub(r'[^a-z0-9]', '', text.casefold())


def normalise_value(f, value):
    """(value, ok). Rewordings of an allowed value become that value; anything else is left as it is."""
    v = value.strip().strip('"').strip()
    folded = re.sub(r'\s+', ' ', v.casefold())
    if folded in ('na', 'n/a', 'n.a.', 'n.a'):
        return 'NA', True
    if folded in ('not found', 'information not found', 'no information found'):
        # the codebook allows Not found for every variable ("All variables: No; Not found; NA")
        return 'Not Found', True
    constraints = f.get('constraints', {})
    enum = constraints.get('enum')
    pattern = constraints.get('pattern')
    if f['id'] == 'url' and not re.match(r'https?://', v, re.I) and re.fullmatch(r'(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/\S*)?', v, re.I):
        v = 'https://' + v
    if enum is not None:
        allowed = [str(a) for a in enum]
        if v in allowed:
            return v, True
        if f['id'] == 'status' and folded in STATUS_SYNONYMS:
            return STATUS_SYNONYMS[folded], True
        by_canon = {canon(a): a for a in allowed}
        if canon(v) in by_canon:
            return by_canon[canon(v)], True
        # "X payment system" for a payment system type of X
        stripped = re.sub(r'\s*payment systems?$', '', v, flags=re.I)
        if canon(stripped) in by_canon:
            return by_canon[canon(stripped)], True
        # the same parts, in another order or spacing: "Central bank/ Bank association"
        parts = sorted(canon(p) for p in re.split(r'\s*/\s*', v))
        for a in allowed:
            if sorted(canon(p) for p in a.split('/')) == parts:
                return a, True
        return v, False
    if pattern:
        if re.fullmatch(pattern, v):
            return v, True
        values = list_values(f)
        if values:
            by_canon = {canon(a): a for a in values}
            items = [i for i in re.split(r'\s*[,;]\s*', v) if i]
            if items and all(canon(i) in by_canon for i in items):
                fixed = ', '.join(by_canon[canon(i)] for i in items)
                return fixed, bool(re.fullmatch(pattern, fixed))
            return v, False
        if f['id'] == 'sectoral':
            if canon(v) == 'crosssectoral':
                return 'Cross-sectoral', True
            m = re.fullmatch(r'sectoral\s*\((.+)\)', v, re.I)
            if m:
                return f'Sectoral ({m[1]})', True
        return v, False
    return v, True


def same_value(f, a, b):
    """Whether two cell texts say the same thing, for checking previous values"""
    blank = {'', '-', '–', 'na', 'n/a'}
    fa, fb = a.strip().casefold(), b.strip().casefold()
    if fa in blank and fb in blank:
        return True
    if fa in blank or fb in blank:
        return False
    if f is not None:
        a = normalise_value(f, a)[0]
        b = normalise_value(f, b)[0]
    return re.sub(r'\s+', ' ', a.strip().casefold()) == re.sub(r'\s+', ' ', b.strip().casefold())


# ---------------------------------------------------------------------------
# The agreed wording (D54, D55, and the team's answers on 2026-11-03)
#
# Each rule rewrites one field's values into the wording the team chose. They're
# used in two places:
# (a) on every value read from the sheets, before normalise_value, and so before
#     it's emitted;
# (b) on the published data: a wording changeset per table, with an update for
#     each baseline cell a rule rewrites, unless this round's sheet changes or a
#     changeset we didn't write (like a region rename) set that cell. Its reason
#     is "Use the agreed wording for <field title>" (D54).
#
# A rule that maps values matches them by canon(), so case, spacing and
# punctuation don't matter. normalise_value's older rules only reach a value
# after these, and agree with them: every value a rule writes is the codebook's
# own wording. Rewording a value twice changes nothing, and the checks require
# every value in a changeset to be in the agreed wording already.
#
# A rewording is a mechanical edit, so its change inherits the as_of of the value
# it rewrites (D65): for a published cell, its row's Last updated. When it was
# made is in its changeset's id (D33). The wording changesets come after the
# baseline and this round's changes, so on a tie of as_of the rewrite wins (D46).

# Region aliases -> their UN M49 names, from public/data/place-names.csv: the rows
# whose code is a region (not a two-letter country code). Filled in by main().
REGION_NAMES = {}


def region_name(value):
    """A region alias, like Caribbean or European Union, as its UN M49 name"""
    return REGION_NAMES.get(canon(value), value)


def codes_separated(value):
    """A list of transaction type codes, separated by commas, full stops, slashes or spaces, as a ", " list"""
    items = [i for i in re.split(r'[\s,./;]+', value) if i]
    if not items or not all(re.fullmatch(r'[a-z]2[a-z]|other', i, re.I) for i in items):
        return value
    return ', '.join(items)


def without_repeats(value):
    """A list with each item once, where it first appears"""
    items, seen = [], set()
    for item in re.split(r'\s*,\s*', value):
        if canon(item) not in seen:
            seen.add(canon(item))
            items.append(item)
    return ', '.join(items)


# (resource, or None for every table; field id; the rule's name in the report; how).
# `how` is a dict of value -> agreed value, or a function of the whole cell.
# Rules apply in this order.
WORDING = [
    ('payment', 'operator', 'Central Bank -> Central bank', {'Central Bank': 'Central bank'}),
    ('payment', 'operator', 'Commercial bank/ Private PSP -> Commercial bank/Private PSP',
     {'Commercial bank/ Private PSP': 'Commercial bank/Private PSP'}),
    ('payment', 'operator', 'Central bank/ Bank association -> Bank association/Central bank',
     {'Central bank/ Bank association': 'Bank association/Central bank'}),
    ('payment', 'system_type', 'Interbank payment system -> Interbank, Cross-domain payment system -> Cross-domain',
     {'Interbank payment system': 'Interbank', 'Cross-domain payment system': 'Cross-domain'}),
    ('payment', 'system_type', 'Mobile money, Mobile wallet -> Mobile money system',
     {'Mobile money': 'Mobile money system', 'Mobile wallet': 'Mobile money system'}),
    ('payment', 'transaction_types', 'separators -> ", "', codes_separated),
    ('payment', 'transaction_types', 'P2G -> Other', {'P2G': 'Other'}),
    ('payment', 'transaction_types', 'P2B -> P2M', {'P2B': 'P2M'}),
    ('payment', 'transaction_types', 'no repeats', without_repeats),
    (None, 'url', 'trim whitespace', str.strip),
    (None, 'country', 'region aliases -> UN M49 names (place-names.csv)', region_name),
]

# Fields whose values may be ", " lists: a dict rule rewrites each item.
WORDING_LISTS = {('payment', 'system_type'), ('payment', 'transaction_types')}

# One-off fixes to published cells, each its own change with its own reason:
# (resource, key, field id, the value we expect, the agreed value, reason, as_of).
# as_of is None for a mechanical fix, which inherits the published cell's date
# (D65), and the date of the research for one that is research.
WORDING_ONE_OFF = [
    ('identity', 'id-ps-01', 'url', 'sa/sso', 'NA', 'Not a URL.', None),
    ('payment', 'pay-bt-01', 'operator', 'Central bank, Private PSP', 'Central bank', 'Confirmed by the research team.', '2026-11-03'),
]

# Published cells the rules would rewrite, but that are decided next round (D60):
# (resource, key, field id). Legal redress, ownership "Public, Private" and
# Nigeria's operator ("Central bank/Other") are left alone too, but no rule
# touches them. Operator "Private PSP" is an allowed value.
WORDING_LEAVE_ALONE = {
    ('payment', 'pay-om-01', 'system_type'),  # Oman: "Interbank payment system, Mobile wallet"
    ('payment', 'pay-om-02', 'system_type'),
}


def reword(resource, fid, value):
    """(the value in the agreed wording, the names of the rules that changed it)"""
    hits = []
    for res, f, name, how in WORDING:
        if f != fid or res not in (None, resource):
            continue
        if callable(how):
            new = how(value)
        else:
            by_canon = {canon(a): b for a, b in how.items()}
            items = re.split(r'\s*,\s*', value) if (resource, fid) in WORDING_LISTS else [value]
            mapped = [by_canon.get(canon(i), i) for i in items]
            new = ', '.join(mapped) if mapped != items else value
        if new != value:
            hits.append(name)
            value = new
    return value, hits


def wording_reason(schema, resource, fid):
    return f"Use the agreed wording for {schema.field(resource, fid)['title']}"


# ---------------------------------------------------------------------------
# Reading the workbook


@dataclass
class Row:
    tab: str
    n: int
    cells: dict
    urls: list
    fill: str = ''
    new_system: bool = False
    new_system_raw: str = ''

    def __getattr__(self, name):
        cells = self.__dict__.get('cells', {})
        if name in COLUMNS:
            return cells.get(name, '')
        raise AttributeError(name)


def find_sheet(wb, title):
    """The sheet with this title, or None"""
    want = key(title).replace(' ', '')
    sheets = {key(ws.title).replace(' ', ''): ws for ws in wb.worksheets}
    if want in sheets:
        return sheets[want]
    # Excel truncates sheet names to 31 characters
    for k, ws in sheets.items():
        if len(k) >= 20 and want.startswith(k):
            return ws
    return None


def header_map(header_cells):
    found = {}
    for i, h in enumerate(header_cells):
        k = key(h)
        if not k:
            continue
        for col, names in COLUMNS.items():
            if k in names and col not in found:
                found[col] = i
        if NEW_SYSTEM_HEADER in k and 'new system' not in found:
            found['new system'] = i
    return found


def unheaded_date_column(ws, tab, header, cols):
    """The index of a tab's date column that has no heading, after checking it's where we expect and holds only dates"""
    left, right = (cols.get(name) for name in tab.date_between)
    if left is None or right is None or right != left + 2 or key(header[left + 1]):
        raise SystemExit(f'{tab.title}: expected a date column with no heading between {tab.date_between[0]} and '
                         f'{tab.date_between[1]}, but the header is {header}')
    at = left + 1
    dates = 0
    for cells in ws.iter_rows(min_row=tab.first_row):
        if at >= len(cells) or cells[at].value in (None, ''):
            continue
        if not isinstance(cells[at].value, dt.datetime):
            raise SystemExit(f'{tab.title}: the date column with no heading holds {cells[at].value!r} at {cells[at].coordinate}, which is not a date')
        dates += 1
    if not dates:
        raise SystemExit(f'{tab.title}: the date column with no heading holds no dates')
    return at


def read_tab(wb, tab, read_dates=True):
    ws = find_sheet(wb, tab.title)
    header_ws = find_sheet(wb, tab.header_from) if tab.header_from else ws
    if ws is None or header_ws is None:
        return None
    header = [cell_text(c.value) for c in next(header_ws.iter_rows(min_row=1, max_row=1))]
    cols = header_map(header)
    missing = [c for c in ('place', 'var', 'prev', 'new') if c not in cols]
    if missing:
        raise SystemExit(f'{tab.title}: no column for {missing} in header {header}')
    if tab.date_between and read_dates and 'date' not in cols:
        cols['date'] = unheaded_date_column(ws, tab, header, cols)
    rows = []
    for cells in ws.iter_rows(min_row=tab.first_row):
        n = cells[0].row
        texts = [cell_text(c.value) for c in cells]
        get = {col: (texts[i] if i < len(texts) else '') for col, i in cols.items()}
        if not any(get.get(c) for c in ('var', 'prev', 'new')):
            continue
        urls = []
        for col in ('url', 'links'):
            i = cols.get(col)
            if i is None or i >= len(cells):
                continue
            c = cells[i]
            if c.hyperlink is not None and c.hyperlink.target:
                urls.append(clean_url(c.hyperlink.target))
            urls += urls_in(texts[i])
        var_cell = cells[cols['var']] if cols['var'] < len(cells) else None
        fill = ''
        if var_cell is not None and var_cell.fill is not None and var_cell.fill.fill_type == 'solid':
            fill = str(var_cell.fill.fgColor.rgb)
        row = Row(tab.title, n, get, urls, fill)
        row.new_system_raw = get.get('new system', '')
        row.new_system = key(row.new_system_raw) in ('yes', 'y', 'true')
        rows.append(row)
    return rows, 'new system' in cols


def unheaded_dates(ws):
    """Columns with no heading that hold dates. They aren't read, but the report says they're there."""
    header = [cell_text(c.value) for c in next(ws.iter_rows(min_row=1, max_row=1))]
    found = defaultdict(Counter)
    for cells in ws.iter_rows(min_row=2):
        for i, c in enumerate(cells):
            if isinstance(c.value, dt.datetime) and not (i < len(header) and key(header[i])):
                found[c.column_letter][cell_text(c.value)] += 1
    return dict(found)


# ---------------------------------------------------------------------------
# The baseline


def load_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


DATE_FOLDER = re.compile(r'\d{4}-\d{2}-\d{2}')
PENDING = 'next'


def latest_release(root, schema):
    """The newest release folder with JSON for every table, whose rows have System IDs"""
    data = root / 'public' / 'data'
    for folder in sorted((p for p in data.iterdir() if p.is_dir() and DATE_FOLDER.fullmatch(p.name)), reverse=True):
        files = [folder / f'{folder.name}-{name}.json' for name in schema.resources]
        if all(f.exists() for f in files) and all(
                all('System ID' in r for r in json.loads(f.read_text(encoding='utf-8'))) for f in files):
            return folder.name
    raise SystemExit('no release in public/data/ has JSON with System IDs for every table')


def load_baseline(root, schema):
    """The latest release's rows (D66), each table's as text, like its CSV. Returns (release, tables)."""
    release = latest_release(root, schema)
    text = lambda v: '' if v is None else str(v)
    tables = {}
    for name in schema.resources:
        rows = json.loads((root / 'public' / 'data' / release / f'{release}-{name}.json').read_text(encoding='utf-8'))
        tables[name] = [{k: text(v) for k, v in r.items()} for r in rows]
    return release, tables


def pending_paths(root, resource, after):
    """The changesets the next release applies to the baseline: those in release folders after it, then the pending ones"""
    log = root / 'changesets'
    folders = sorted(p for p in log.iterdir() if p.is_dir() and DATE_FOLDER.fullmatch(p.name) and p.name > after) if log.exists() else []
    paths = []
    for folder in [*folders, log / PENDING]:
        paths += sorted((folder / resource).glob('*.toml'))
    return sorted(paths, key=lambda p: p.stem)


# ---------------------------------------------------------------------------
# Places


def load_places(root, baseline):
    """place name -> code, from places.csv, place-names.csv and the baseline's Country / Region"""
    names = {}
    for r in load_csv(root / 'public/data/places.csv'):
        names[place_key(r['name'])] = r['code']
    for r in load_csv(root / 'public/data/place-names.csv'):
        names[place_key(r['dpimap_name'])] = r['code']
        if len(r['code']) > 2:
            # a region: the WORDING rule for country writes its UN M49 name
            REGION_NAMES[canon(r['dpimap_name'])] = r['name_in_source']
    for name, rows in baseline.items():
        for r in rows:
            code = r['System ID'].split('-', 1)[1].rsplit('-', 1)[0]
            names.setdefault(place_key(r['Country / Region']), code)
    return names


# ---------------------------------------------------------------------------
# The import


@dataclass
class Finding:
    row: Row
    resource: str
    key: str
    fid: str
    value: str
    group: tuple
    is_create: bool = False
    # what the change says, filled in once a row is known to be imported
    as_of: str = ''
    reason: str = ''
    sources: list = field(default_factory=list)


@dataclass
class Report:
    unattributed: list = field(default_factory=list)      # (tab, row, place, variable, new, why)
    unmapped: Counter = field(default_factory=Counter)    # (tab, variable) -> rows
    variants: Counter = field(default_factory=Counter)    # (resource, variable, field id, how) -> rows
    conflicts: list = field(default_factory=list)
    prev: list = field(default_factory=list)              # (tab, row, key, field, sheet prev, baseline)
    outside: list = field(default_factory=list)           # (tab, row, key, field, value, allowed)
    skipped: list = field(default_factory=list)           # (tab, row, place, variable, new, reason)
    dpi: list = field(default_factory=list)               # (tab, row, key/place, prev, new)
    notes: list = field(default_factory=list)             # general notes
    overwrites: list = field(default_factory=list)        # NewVar_Log defaults over an existing Yes
    renames: list = field(default_factory=list)
    normalised: Counter = field(default_factory=Counter)  # (field, from, to) -> rows
    dropped_sources: Counter = field(default_factory=Counter)
    yellow: Counter = field(default_factory=Counter)
    counts: dict = field(default_factory=dict)
    no_effect: int = 0
    has_new_system_column: dict = field(default_factory=dict)
    missing_tabs: list = field(default_factory=list)
    placeholders_kept: list = field(default_factory=list)
    unknown_tabs: list = field(default_factory=list)
    known: list = field(default_factory=list)
    unheaded_dates: list = field(default_factory=list)    # (tab, column letter, date text -> cells)
    rows_read: dict = field(default_factory=dict)         # tab -> rows
    not_reviewed: list = field(default_factory=list)      # rows left out by LEAVE_OUT_NOT_REVIEWED
    dates: Counter = field(default_factory=Counter)       # (tab, how the date was read) -> imported rows
    vague_dates: Counter = field(default_factory=Counter) # (tab, date text) -> imported rows
    future_dates: list = field(default_factory=list)      # (tab, row, key, field, date)
    older_than_baseline: list = field(default_factory=list)  # (tab, row, key, field, value, as_of, Last updated)
    unreadable_last_updated: Counter = field(default_factory=Counter)  # the text -> findings
    create_differs: list = field(default_factory=list)    # (tab, row, key, field, value): a required cell whose own row differs from the create's
    create_unnamed: list = field(default_factory=list)    # (tab, key): a create with no name row to take its reason from
    remove_differs: list = field(default_factory=list)    # (tab, row, key, what differs from the first row)
    blank_rationales: list = field(default_factory=list)  # (tab, row, key, field, value)
    na_not_found: list = field(default_factory=list)      # (tab, row, key, field, value, rationale)
    not_found_cells: Counter = field(default_factory=Counter)  # (resource, field) -> cells
    grouping: Counter = field(default_factory=Counter)    # values and changes in changes made from rows
    reworded: Counter = field(default_factory=Counter)    # (resource, field id, rule) -> sheet rows the rule rewrote
    wording: list = field(default_factory=list)           # (resource, key, field id, published, agreed, rules or one-off, reason, as_of)
    wording_skipped: list = field(default_factory=list)   # (resource, key, field id, published, agreed, why)


def main(xlsx, root, created_at, previous=None):
    xlsx, root = Path(xlsx), Path(root)
    datapackage = json.loads((root / 'datapackage.json').read_text(encoding='utf-8'))
    schema = Schema(datapackage)
    write_json(root / 'lib/changesets/changeset.schema.json', changeset_schema())
    write_json(root / 'reports/draft-schema-changes.json', DRAFT)
    release, baseline = load_baseline(root, schema)
    places = load_places(root, baseline)

    by_id = {name: {r['System ID']: r for r in rows} for name, rows in baseline.items()}
    by_place = {name: defaultdict(list) for name in baseline}
    for name, rows in baseline.items():
        for r in rows:
            by_place[name][r['System ID'].split('-', 1)[1].rsplit('-', 1)[0]].append(r)
    name_header = {name: schema.header(name, 'name') for name in baseline}

    wb = openpyxl.load_workbook(xlsx)
    report = Report()
    tab_rows = {}
    tabs = []
    for tab in TABS:
        got = read_tab(wb, tab)
        if got is None:
            report.missing_tabs.append(tab.title)
            continue
        rows, has_col = got
        report.rows_read[tab.title] = len(rows)
        if LEAVE_OUT_NOT_REVIEWED:
            report.not_reviewed += [row for row in rows if row.reviewed.strip().casefold() == 'no']
            rows = [row for row in rows if row.reviewed.strip().casefold() != 'no']
        tab_rows[tab.title] = rows
        tabs.append(tab)
        report.has_new_system_column[tab.title] = has_col
        if not tab.date_between:
            for letter, days in unheaded_dates(find_sheet(wb, tab.title)).items():
                report.unheaded_dates.append((tab.title, letter, days))
    applied = {key(t.title).replace(' ', '') for t in tabs} | {key(t).replace(' ', '') for t in SKIPPED_TABS}
    for ws in wb.worksheets:
        k = key(ws.title).replace(' ', '')
        if not any(a.startswith(k) or k.startswith(a) for a in applied if len(k) >= 20 or a == k):
            if 'log' in k or 'notes' in k or 'other' in k or 'label' in k:
                report.unknown_tabs.append(ws.title.strip())

    def place_of(text):
        return places.get(place_key(text))

    # Pass 1: removals, so rows about a removed system aren't attributed to it
    removed = {}   # system id -> [tab, rows, reason, sources, duplicate_of, as_of]
    remove_rows = set()
    for tab in tabs:
        for row in tab_rows[tab.title]:
            if not any(REMOVE_NOTE.search(text) for text in (row.notes, row.rationale) if text):
                continue
            remove_rows.add((tab.title, row.n))
            code = place_of(row.place)
            cands = by_place[tab.resource].get(code, []) if code else []
            hit = cands
            if len(cands) > 1:
                hit = [c for c in cands if names_match(row.prev, c[name_header[tab.resource]])]
                if not hit and schema.field_for(tab.resource, row.var)[0] != 'name':
                    # not a name row, so its previous value can't pick the system: try the exact Country / Region
                    hit = [c for c in cands if place_key(c['Country / Region']) == place_key(row.place)]
            if len(hit) != 1:
                why = (f'asks to remove a system, but {row.place.strip()!r} is not a known place' if not code else
                       f'asks to remove a system, but {len(hit)} of the {len(cands)} systems here match {row.prev!r}')
                report.unattributed.append((tab.title, row.n, row.place, row.var, row.new, why))
                continue
            sid = hit[0]['System ID']
            if sid in removed:
                removed[sid][1].append(row.n)
                note_remove_differs(report, sid, removed[sid], row)
                continue
            removed[sid] = [tab.title, [row.n], reason_for(row), sources_for(row, report), None, as_of_for(row)]
        for sid, dup, rows in KNOWN_DUPLICATES.get(tab.title, []):
            if sid in removed:
                removed[sid][4] = dup
                report.known.append(f'remove `{sid}` as a duplicate of `{dup}`: found in {tab.title} row(s) {", ".join(map(str, removed[sid][1]))}')
                continue
            # the tab doesn't say to remove it: use the rows we know about, and the first one's rationale
            removed[sid] = [tab.title, rows, '', [], dup, DEFAULT_AS_OF]
            known_rows = [row for row in tab_rows[tab.title] if row.n in rows]
            for i, row in enumerate(known_rows):
                remove_rows.add((tab.title, row.n))
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'part of a known duplicate removal'))
                if i == 0:
                    removed[sid][2:4] = [reason_for(row), sources_for(row, report)]
                    removed[sid][5] = as_of_for(row)
                else:
                    note_remove_differs(report, sid, removed[sid], row)
            report.known.append(f'remove `{sid}` as a duplicate of `{dup}`: not asked for by the tab, so added from {tab.title} rows {rows}')

    # Pass 2: attribute each row to a system, or to a new one
    findings = []
    fills = {}         # placeholder system id -> dict(tab, group, rows, name)
    new_systems = {}   # system id -> dict(code, country, name, group, tab, row)
    next_number = {}
    # new systems from earlier tabs, which later tabs can update: resource -> code -> [row-like dicts]
    created_by_place = {name: defaultdict(list) for name in baseline}

    def mint(resource, code):
        k = (resource, code)
        if k not in next_number:
            used = [int(r['System ID'].rsplit('-', 1)[1]) for r in by_place[resource].get(code, [])]
            next_number[k] = max(used, default=0) + 1
        n = next_number[k]
        next_number[k] += 1
        return f'{TYPES[resource]}-{code}-{n:02d}'

    for tab in tabs:
        rows = tab_rows[tab.title]
        resource = tab.resource
        hint_of = (lambda r: getattr(r, tab.hint)) if tab.hint else (lambda r: '')
        # groups of rows about one system: same place and the same system name, if the tab has one
        groups = defaultdict(list)
        group_of = {}
        break_place, break_n = None, None
        new_run = None
        for row in rows:
            var_key = key(row.var)
            if var_key.startswith('break for'):
                break_place, break_n = place_key(row.place), row.n
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'marker: break for a second system'))
                continue
            if tab.breaks and break_place is not None and place_key(row.place) != break_place:
                break_place = None
            if (tab.title, row.n) in remove_rows:
                continue
            if var_key.startswith('general note'):
                report.notes.append((tab.title, row.n, row.place, row.var, row.new))
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'general note, not data'))
                continue
            marker = row.new_system_raw.strip().casefold()
            if marker not in ('', 'yes', 'y', 'true', 'no', 'n', 'false'):
                g = ('unsure', row.n, row.new_system_raw)
            elif (resource, place_key(row.place)) in KNOWN_NEW:
                g = ('known new', place_key(row.place))
            elif tab.breaks and break_place is not None:
                g = ('new after break', break_place, break_n)
            elif row.new_system:
                # a run of New system = Yes rows, in one place, naming one system (or none)
                hint = key(hint_of(row))
                if new_run is None or new_run[1] != place_key(row.place) or hint not in ('', new_run[2]):
                    new_run = ('new system', place_key(row.place), hint, row.n)
                g = new_run
            else:
                new_run = None
                g = ('existing', place_key(row.place), key(hint_of(row)))
            groups[g].append(row)
            group_of[row.n] = g

        # resolve each group to a system id, or a reason it can't be
        resolved = {}
        for g, grows in groups.items():
            place = grows[0].place
            fids = [(r, schema.field_for(resource, r.var)[0]) for r in grows]
            name_rows = [r for r, fid in fids if fid == 'name']
            if g[0] == 'unsure':
                resolved[g] = (None, f'New system is {g[2]!r}: not Yes or No')
                continue
            if g[0] in ('known new', 'new after break', 'new system'):
                if g[0] == 'known new':
                    code, country = KNOWN_NEW[(resource, g[1])]
                else:
                    code = place_of(place)
                    # the place's name as the baseline writes it, if the baseline has one
                    labels = [r['Country / Region'] for name in baseline for r in by_place[name].get(code, [])]
                    exact = [x for x in labels if place_key(x) == place_key(place)]
                    country = (exact or (Counter(labels).most_common(1)[0][0:1] if len(code) == 2 and labels else [])
                               or [place.strip()])[0]
                if not code:
                    resolved[g] = (None, f'new system in a place that is not in places.csv or place-names.csv: {place.strip()!r}')
                    continue
                named = [r for r in name_rows if not is_blank(r.new) and key(r.new) not in ('na', 'not found')]
                if not named:
                    resolved[g] = (None, 'New system = Yes, but none of these rows names the system '
                                         '(D5: mark every row of a new system, including its name)')
                    continue
                # D9: a filled placeholder keeps its id. If the place's only system of this type is a
                # placeholder (no name), the new system fills it, as an update of the existing key.
                existing = [c for c in by_place[resource].get(code, []) if c['System ID'] not in removed]
                placeholders = [c for c in existing if is_placeholder(c[name_header[resource]])]
                if g[0] != 'known new' and len(existing) == 1 and placeholders:
                    sid = existing[0]['System ID']
                    fills[sid] = {'tab': tab.title, 'group': g, 'rows': (grows[0].n, grows[-1].n),
                                  'name': normalise_value(schema.field(resource, 'name'), named[0].new)[0]}
                    resolved[g] = (sid, None)
                    continue
                if placeholders:
                    report.placeholders_kept.append((tab.title, grows[0].n, grows[-1].n, place.strip(),
                                                     '; '.join(f"{c['System ID']} {c[name_header[resource]] or '(blank)'}" for c in existing)))
                sid = mint(resource, code)
                name = normalise_value(schema.field(resource, 'name'), named[0].new)[0]
                # the place as the sheet or baseline writes it stays the row's label for matching later
                # rows; the create's value is in the agreed wording
                agreed_country, rules = reword(resource, 'country', country)
                for rule in rules:
                    report.reworded[(resource, 'country', rule)] += 1
                new_systems[sid] = {'code': code, 'country': agreed_country, 'name': name, 'group': g, 'tab': tab.title,
                                    'row': {'System ID': sid, name_header[resource]: name, 'Country / Region': country},
                                    'rows': (grows[0].n, grows[-1].n),
                                    'others': [f"{c['System ID']} {c[name_header[resource]]}"
                                               + (' (removed)' if c['System ID'] in removed else '')
                                               for c in by_place[resource].get(code, []) + created_by_place[resource].get(code, [])]}
                resolved[g] = (sid, None)
                continue
            if not place.strip():
                resolved[g] = (None, 'no Country / Region')
                continue
            code = place_of(place)
            if not code:
                resolved[g] = (None, f'place {place.strip()!r} is not in places.csv or place-names.csv')
                continue
            cands = by_place[resource].get(code, []) + created_by_place[resource].get(code, [])
            if not cands:
                resolved[g] = (None, f'no {resource} system in {code}; a new system needs New system = Yes')
                continue
            if len(cands) == 1:
                sid = cands[0]['System ID']
                if sid in removed:
                    rt, rn, *_ = removed[sid]
                    if key(grows[0].new_system_raw) in ('no', 'n', 'false'):
                        resolved[g] = (None, f'New system = No, so about {sid}, which is removed ({rt} row {rn[0]})')
                    else:
                        resolved[g] = (None, f'the only system here, {sid}, is removed ({rt} row {rn[0]}); '
                                             'these rows look like a new system: mark them New system = Yes')
                    continue
            else:
                hints = [hint_of(grows[0])] + [x for r in name_rows for x in (r.prev, r.new)]
                hints = [h for h in hints if h and not is_blank(h)]
                hit = [c for c in cands if any(names_match(h, c[name_header[resource]]) for h in hints)]
                if len(hit) > 1:
                    exact = [c for c in hit if place_key(c['Country / Region']) == place_key(place)]
                    hit = exact or hit
                if len(hit) != 1:
                    names = '; '.join(f"{c['System ID']} {c[name_header[resource]]}" for c in cands)
                    hint_text = hints[0] if hints else 'no system name'
                    resolved[g] = (None, f'{len(cands)} systems here ({names}) and {hint_text!r} '
                                         f"{'matches none' if not hit else 'matches several'}")
                    continue
                sid = hit[0]['System ID']
                if sid in removed:
                    rt, rn, *_ = removed[sid]
                    resolved[g] = (None, f'matches {sid}, which is removed ({rt} row {rn[0]}); probably a new system')
                    continue
            current = (by_id[resource][sid] if sid in by_id[resource] else new_systems[sid]['row'])[name_header[resource]]
            odd = [r for r in name_rows if is_blank(r.prev) and current.strip() not in ('', 'NA')
                   and not is_blank(r.new) and key(r.new) != key(current)]
            if odd:
                resolved[g] = (None, f'renames {sid} ({current!r}) to {odd[0].new!r} but gives no previous name: '
                                     'a rename, or a new system (New system = Yes)?')
                continue
            resolved[g] = (sid, None)

        # turn rows into findings
        for row in rows:
            g = group_of.get(row.n)
            if g is None:
                continue
            sid, why = resolved[g]
            fid, how = schema.field_for(resource, row.var)
            if not row.var.strip():
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'no variable name'))
                continue
            if fid is None:
                report.unmapped[(tab.title, row.var.strip())] += 1
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'unmapped variable name'))
                continue
            if is_blank(row.new) and not tab.defaults_log:
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'no new value'))
                continue
            if how in ('drift', 'aliases') or (how == 'title' and key(row.var) != key(schema.header(resource, fid))):
                report.variants[(resource, row.var.strip(), fid, how)] += 1
            if fid in DERIVED:
                if fid == 'dpi_count':
                    report.dpi.append((tab.title, row.n, sid or row.place, row.prev, row.new))
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, f'derived field ({fid})'))
                continue
            f = schema.field(resource, fid)
            if fid in schema.retired[resource] or row.new.strip().casefold() in RETIRED_VALUES:
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, f'retired field ({fid})'))
                continue
            if tab.defaults_log:
                value, _ = normalise_value(f, row.new) if row.new.strip() else ('', True)
                if value in ('', 'NA', '-'):
                    if sid and sid in by_id[resource] and by_id[resource][sid].get(f['name'], '') == 'Yes':
                        report.overwrites.append((tab.title, row.n, sid, fid, by_id[resource][sid][f['name']], row.new))
                    report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'default (N/A) for a new variable'))
                    continue
            if sid is None:
                report.unattributed.append((tab.title, row.n, row.place, row.var, row.new, why))
                continue
            if is_blank(row.new):
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new, 'no new value'))
                continue
            agreed, rules = reword(resource, fid, row.new.strip())
            for name in rules:
                report.reworded[(resource, fid, name)] += 1
            value, ok = normalise_value(f, agreed)
            if value != row.new.strip():
                report.normalised[(fid, row.new.strip(), value)] += 1
            if not ok:
                allowed = f.get('constraints', {}).get('enum') or f.get('constraints', {}).get('pattern')
                report.outside.append((tab.title, row.n, sid, fid, row.new, json.dumps(allowed, ensure_ascii=False)))
                continue
            if fid == 'name' and value in ('Not Found', 'NA'):
                report.skipped.append((tab.title, row.n, row.place, row.var, row.new,
                                       f'name set to {value}: remove {sid}, or keep it? (ask)'))
                continue
            is_create = sid in new_systems and new_systems[sid]['tab'] == tab.title
            # previous values
            if not is_create and not f.get('draft') and sid in by_id[resource]:
                current = by_id[resource][sid].get(f['name'], '')
                if not is_blank(row.prev) or current not in ('', 'NA'):
                    if not same_value(f, row.prev, current):
                        report.prev.append((tab.title, row.n, sid, fid, row.prev, current))
                if same_value(f, value, current):
                    report.no_effect += 1
                if fid == 'name' and not same_value(f, value, current) and fills.get(sid, {}).get('group') != g:
                    report.renames.append((tab.title, row.n, sid, by_id[resource][sid]['Country / Region'], current, value))
            findings.append(Finding(row, resource, sid, fid, value, g, is_create))
        for sid, info in new_systems.items():
            if info['tab'] == tab.title:
                created_by_place[resource][info['code']].append(info['row'])

    # Conflicts: the same cell set to different values, in one tab or across tabs. Withheld.
    cells = defaultdict(list)
    for x in findings:
        cells[(x.resource, x.key, x.fid)].append(x)
    withheld = set()
    duplicates = set()
    for (resource, sid, fid), xs in cells.items():
        values = {x.value for x in xs}
        if len(values) > 1:
            for x in xs:
                withheld.add(id(x))
            report.conflicts.append((resource, sid, fid, [(x.row.tab, x.row.n, x.value) for x in xs]))
        else:
            seen = set()
            for x in xs:
                if x.row.tab in seen:
                    duplicates.add(id(x))
                seen.add(x.row.tab)
    kept = []
    for x in findings:
        if id(x) in withheld:
            report.skipped.append((x.row.tab, x.row.n, x.row.place, x.row.var, x.row.new, 'conflict: withheld'))
        elif id(x) in duplicates:
            report.skipped.append((x.row.tab, x.row.n, x.row.place, x.row.var, x.row.new, 'repeats an earlier row of the same tab'))
        else:
            kept.append(x)

    # Build changesets: one per system per tab, in tab order and then System ID order
    changesets = {}   # id -> dict(tab, key, resource, kind, rows, data)
    by_file = defaultdict(list)
    for x in kept:
        by_file[(x.row.tab, x.resource, x.key)].append(x)
    for sid, (tab_title, *_) in removed.items():
        resource = next(name for name, t in TYPES.items() if sid.startswith(t + '-'))
        by_file.setdefault((tab_title, resource, sid), [])

    tab_titles = [t.title for t in TABS]
    field_order = {name: {fid: i for i, fid in enumerate(schema.fields[name])} for name in schema.resources}

    def in_field_order(resource, values):
        return dict(sorted(values.items(), key=lambda kv: field_order[resource][kv[0]]))

    def group_of_change(x):
        """Rows make one change if they agree on all of these (D29)"""
        return (x.as_of, x.reason, frozenset(x.sources))

    def updates_from(resource, sid, xs):
        """One change per distinct date, rationale and set of sources, in the order the rows first say so"""
        changes = {}
        for x in xs:
            change = changes.setdefault(group_of_change(x), {'type': 'update', 'key': sid, DATE_FIELD: x.as_of, 'values': {},
                                                          'reason': x.reason, 'sources': x.sources})
            change['values'][x.fid] = x.value
        for change in changes.values():
            change['values'] = in_field_order(resource, change['values'])
        return list(changes.values())

    for n, ((tab_title, resource, sid), xs) in enumerate(
            sorted(by_file.items(), key=lambda kv: (tab_titles.index(kv[0][0]), kv[0][2])), start=1):
        xs = sorted(xs, key=lambda x: x.row.n)
        current = by_id[resource].get(sid) or (new_systems[sid]['row'] if sid in new_systems else None)
        if sid in removed and removed[sid][0] == tab_title:
            _, rows, reason, sources, dup, as_of = removed[sid]
            change = {'type': 'remove', 'key': sid}
            if dup:
                change['duplicate_of'] = dup
            change.update({DATE_FIELD: as_of, 'reason': reason, 'sources': sources})
            changes = [change]
            for x in xs:
                report.skipped.append((x.row.tab, x.row.n, x.row.place, x.row.var, x.row.new, f'{sid} is removed by this tab'))
            for row in tab_rows[tab_title]:
                if row.n in rows:
                    read_date(report, row)
            if not reason:
                report.blank_rationales.extend((tab_title, row_n, sid, '', '') for row_n in rows)
            rows = sorted(rows)
            kind = 'remove'
        else:
            rows = [x.row.n for x in xs]
            for x in xs:
                x.as_of = read_date(report, x.row)
                x.reason = reason_for(x.row)
                x.sources = sources_for(x.row, report)
                note_cell(report, x, by_id, schema, created_at)
            if sid in new_systems and new_systems[sid]['tab'] == tab_title:
                info = new_systems[sid]
                required = schema.required(resource)
                named = [x for x in xs if x.fid == 'name']
                if named:
                    in_create = group_of_change(named[0])
                else:
                    # its name row was withheld, so there's no rationale to use
                    in_create = (DEFAULT_AS_OF, '', frozenset())
                    report.create_unnamed.append((tab_title, sid))
                as_of, reason, _ = in_create
                sources = named[0].sources if named else []
                values = {'country': info['country']}
                others = []
                for x in xs:
                    if group_of_change(x) == in_create:
                        values[x.fid] = x.value
                    elif x.fid in required:
                        values[x.fid] = x.value
                        report.create_differs.append((tab_title, x.row.n, sid, x.fid, x.value))
                    else:
                        others.append(x)
                missing = [fid for fid in required if fid not in values]
                if missing:
                    raise SystemExit(f'{sid}: a create is missing required fields {missing}')
                changes = [{'type': 'create', 'key': sid, DATE_FIELD: as_of, 'values': in_field_order(resource, values),
                           'reason': reason, 'sources': sources}]
                changes += updates_from(resource, sid, others)
                kind = 'create'
            else:
                if current is None:
                    raise SystemExit(f'{sid} is not in the baseline')
                changes = updates_from(resource, sid, xs)
                if sid in fills and fills[sid]['tab'] == tab_title:
                    kind = 'fill'
                elif any(x.fid == 'name' and not same_value(None, x.value, current[name_header[resource]]) for x in xs):
                    kind = 'rename'
                else:
                    kind = 'update'
            report.grouping['rows'] += len(xs)
            report.grouping['changes'] += len(changes)
        for change in changes:
            if not change.get('sources'):
                change.pop('sources', None)
        cid = changeset_id(created_at, n, tab_title, sid)
        clash = 0
        while cid in changesets:
            clash += 1
            cid = changeset_id(created_at, n, f'{tab_title}#{clash}', sid)
        changesets[cid] = {'tab': tab_title, 'key': sid, 'resource': resource, 'kind': kind, 'rows': rows,
                           'data': {'changes': changes}}

    # Wording changesets (D54, D55): one per table, after this round's changes from the sheets
    manifest = root / 'reports' / 'import-proposals-changesets.csv'
    ours = {r['changeset'] for r in load_csv(manifest)} if manifest.exists() else set()
    removed_by_others, set_by_others = others_in_log(root, schema, ours, release)
    set_by_sheets = {(x.resource, x.key, x.fid) for x in kept}
    last_updated = {resource: schema.header(resource, 'last_updated') for resource in schema.resources}
    for resource in schema.resources:
        one_off = {(k, fid): (expect, agreed, reason, as_of)
                   for res, k, fid, expect, agreed, reason, as_of in WORDING_ONE_OFF if res == resource}
        missing = {k for k, _ in one_off} - set(by_id[resource])
        if missing:
            raise SystemExit(f'WORDING_ONE_OFF: {sorted(missing)} not in the {resource} baseline')
        changes = []
        for row in baseline[resource]:
            sid = row['System ID']
            # the cell's value is the baseline's: the sheets, a hand-written changeset or a remove would
            # be skipped below. So the rewrite inherits the baseline cell's as_of (D65).
            inherited = snapshot_as_of(row.get(last_updated[resource], ''))
            for fid, f in schema.fields[resource].items():
                published = row.get(f['name'])
                if f.get('draft') or published is None:
                    continue
                if (sid, fid) in one_off:
                    expect, agreed, reason, as_of = one_off[(sid, fid)]
                    rules = ['one-off']
                    if published != expect:
                        report.wording_skipped.append((resource, sid, fid, published, agreed, f'the one-off fix expects {expect!r}'))
                        continue
                else:
                    agreed, rules = reword(resource, fid, published)
                    if not rules:
                        continue
                    reason = wording_reason(schema, resource, fid)
                    as_of = None
                why = ('decided next round (D60)' if (resource, sid, fid) in WORDING_LEAVE_ALONE else
                       "set by this round's changes from the sheets" if (resource, sid, fid) in set_by_sheets else
                       f'removed by {removed[sid][0]}' if sid in removed else
                       f'removed by changeset {removed_by_others[resource][sid]}' if sid in removed_by_others[resource] else
                       f'set by changeset {set_by_others[resource][(sid, fid)]}' if (sid, fid) in set_by_others[resource] else None)
                if why:
                    report.wording_skipped.append((resource, sid, fid, published, agreed, why))
                    continue
                if as_of is None:
                    if inherited is None:
                        raise SystemExit(f'{resource} {sid}: Last updated {row.get(last_updated[resource])!r} is not dd/mm/yy, '
                                         f'so the rewrite of {fid} has no date to inherit (D65)')
                    as_of = inherited
                changes.append({'type': 'update', 'key': sid, DATE_FIELD: as_of, 'values': {fid: agreed}, 'reason': reason})
                report.wording.append((resource, sid, fid, published, agreed, rules, reason, as_of))
        if not changes:
            continue
        n = len(changesets) + 1
        cid = changeset_id(created_at, n, 'wording', resource)
        clash = 0
        while cid in changesets:
            clash += 1
            cid = changeset_id(created_at, n, f'wording#{clash}', resource)
        changesets[cid] = {'tab': '', 'key': '', 'resource': resource, 'kind': 'wording', 'rows': [],
                           'data': {'changes': changes}}

    last = created_at + dt.timedelta(seconds=len(changesets))
    if last > dt.datetime.now(dt.timezone.utc):
        raise SystemExit(f'the last of {len(changesets)} changeset ids would be {last}, in the future: choose an earlier --created-at')

    # Write: delete what the last run wrote, if it's still pending, then write this run's changesets
    # as pending ones (D66), and say which they are
    folder = root / 'changesets' / PENDING
    if manifest.exists():
        for r in load_csv(manifest):
            p = folder / r['resource'] / f"{r['changeset']}.toml"
            if p.exists():
                p.unlink()
    for cid, c in sorted(changesets.items()):
        write_toml(folder / c['resource'] / f'{cid}.toml', c['data'])
    write_csv(manifest, ['changeset', 'resource', 'key', 'kind', 'tab', 'rows'],
              [(cid, c['resource'], c['key'], c['kind'], c['tab'], ', '.join(map(str, c['rows']))) for cid, c in sorted(changesets.items())])

    # Validate every changeset, and the baseline
    errors = validate(root, schema, by_id, changesets, release)
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        raise SystemExit(f'{len(errors)} validation errors')

    # Counts per tab
    for tab in tabs:
        rows = tab_rows[tab.title]
        cs = [c for c in changesets.values() if c['tab'] == tab.title]
        report.counts[tab.title] = {
            'rows': report.rows_read[tab.title],
            'not_reviewed': sum(1 for r in report.not_reviewed if r.tab == tab.title),
            'findings': sum(1 for x in kept if x.row.tab == tab.title) + sum(1 for c in cs if c['kind'] == 'remove'),
            'changesets': len(cs),
            'changes': sum(len(c['data']['changes']) for c in cs),
            'creates': sum(1 for c in cs if c['kind'] == 'create'),
            'fills': sum(1 for c in cs if c['kind'] == 'fill'),
            'removes': sum(1 for c in cs if c['kind'] == 'remove'),
            'renames': sum(1 for c in cs if c['kind'] == 'rename'),
            'unattributed': sum(1 for u in report.unattributed if u[0] == tab.title),
        }
    # Yellow rows in payments mean new variables: check they agree
    for tab in tabs:
        if tab.resource != 'payment':
            continue
        for row in tab_rows[tab.title]:
            if row.fill == 'FFFFFF00':
                fid = schema.field_for('payment', row.var)[0]
                report.yellow[(tab.title, fid or row.var)] += 1

    for (resource, place), (code, country) in KNOWN_NEW.items():
        if not any(info['group'] == ('known new', place) for info in new_systems.values()):
            report.known.append(f'new {resource} system in {place!r}: not in this export')
        else:
            sid = next(s for s, info in new_systems.items() if info['group'] == ('known new', place))
            report.known.append(f'new {resource} system in {place!r}: created as `{sid}` with Country / Region {country!r}')
    tips = sorted(sid for sid, r in removed.items() if 'tips' in key(by_id['payment'].get(sid, {}).get('Payment system name', '')))
    report.known.append(f'TIPS rows removed: {len(tips)} ({", ".join(tips)}); expected 7')
    codebook, comparison = read_codebook(wb), None
    if previous:
        comparison = compare(openpyxl.load_workbook(previous), wb, codebook, schema, {(x.row.tab, x.row.n) for x in kept})
    write_reports(root, report, changesets, removed, new_systems, fills, schema, xlsx, codebook, comparison, created_at)
    n_changes = sum(len(c["data"]["changes"]) for c in changesets.values())
    print(f'{len(changesets)} changesets, {n_changes} changes, {len(kept)} findings; reports in reports/import-proposals.md')


def reason_for(row):
    """The sheet's rationale, with only spaces and tabs tidied. Blank stays blank (D27)."""
    return re.sub(r'[ \t]+', ' ', row.rationale.strip())


def as_of_for(row):
    """The row's own date if it's specific, or the default (D34)"""
    return row_date(row.date)[0] or DEFAULT_AS_OF


def read_date(report, row):
    """A row's date, counted for the report"""
    day, how = row_date(row.date)
    report.dates[(row.tab, how)] += 1
    if how != 'specific' and how != 'blank':
        report.vague_dates[(row.tab, row.date.strip())] += 1
    return day or DEFAULT_AS_OF


def note_remove_differs(report, sid, remove, row):
    """A remove change has one reason, one set of sources and one date, so a second row that says otherwise can't be expressed"""
    tab, _, reason, sources, _, as_of = remove
    differs = [what for what, same in (('rationale', reason_for(row) == reason),
                                       ('sources', set(sources_for(row, report)) == set(sources)),
                                       ('date', as_of_for(row) == as_of)) if not same]
    if differs:
        report.remove_differs.append((tab, row.n, sid, ', '.join(differs)))


def note_cell(report, x, by_id, schema, created_at):
    """What the reports say about one imported cell"""
    tab, n, sid, fid = x.row.tab, x.row.n, x.key, x.fid
    if not x.reason:
        report.blank_rationales.append((tab, n, sid, fid, x.value))
    if (x.value == 'NA' and NA_BUT_NOT_FOUND.search(x.reason)) or (x.value == 'Not Found' and NOT_FOUND_BUT_NOT_RECORDED.search(x.reason)):
        report.na_not_found.append((tab, n, sid, fid, x.value, x.reason))
    if x.value == 'Not Found':
        report.not_found_cells[(x.resource, fid)] += 1
    if x.as_of > created_at.date().isoformat():
        report.future_dates.append((tab, n, sid, fid, x.as_of))
    base = by_id[x.resource].get(sid)
    if base is not None:
        text = base.get(schema.header(x.resource, 'last_updated'), '')
        day = baseline_date(text)
        if day is None:
            report.unreadable_last_updated[text] += 1
        elif x.as_of < day:
            report.older_than_baseline.append((tab, n, sid, fid, x.value, x.as_of, day))


def sources_for(row, report):
    out = []
    for u in row.urls:
        host = re.sub(r'^https?://', '', u, flags=re.I).split('/')[0].casefold()
        if host == 'dpimap.org' or host.endswith('.dpimap.org'):
            report.dropped_sources[u] += 1
            continue
        if u not in out:
            out.append(u)
    return out


def others_in_log(root, schema, ours, release):
    """For changesets after the baseline release that this importer didn't write, like a hand-written remove or region rename:
    (resource -> key -> the changeset that removes it, resource -> (key, field id) -> the last changeset that sets it)"""
    removes = {resource: {} for resource in schema.resources}
    sets = {resource: {} for resource in schema.resources}
    for resource in schema.resources:
        for path in pending_paths(root, resource, release):
            if path.stem in ours:
                continue
            for change in read_changeset(path.read_text(encoding='utf-8')).get('changes', []):
                if change.get('type') == 'remove':
                    removes[resource][change.get('key', '')] = path.stem
                for fid in change.get('values', {}):
                    sets[resource][(change.get('key', ''), fid)] = path.stem
    return removes, sets


def snapshot_as_of(text):
    """A baseline row's Last updated, dd/mm/yy or YYYY-MM-DD, as YYYY-MM-DD: the as_of the build gives its cells (D7), or None"""
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return text
    m = re.fullmatch(r'(\d{2})/(\d{2})/(\d{2})', text)
    return f'20{m[3]}-{m[2]}-{m[1]}' if m else None


# ---------------------------------------------------------------------------
# Validation


def validate(root, schema, by_id, changesets, release):
    """Check the changesets the next release applies to the baseline release (D66)"""
    errors = []
    validator = jsonschema.Draft202012Validator(changeset_schema())
    folder = root / 'changesets'
    now = dt.datetime.now(dt.timezone.utc)
    for top in sorted(folder.iterdir()):
        if not top.is_dir():
            continue
        if not (DATE_FOLDER.fullmatch(top.name) or top.name == PENDING):
            errors.append(f'{top.relative_to(root)}: is not a release folder or {PENDING}/')
            continue
        for path in sorted(top.iterdir()):
            if path.is_dir() and path.name not in schema.resources:
                errors.append(f'{path.relative_to(root)}: is not the folder of a resource')
    ids_seen = set()
    # each log is its own (D31). Replay it in id order: rows must exist (or not) when each change applies
    for resource in schema.resources:
        paths = pending_paths(root, resource, release)
        in_log = {p.stem for p in paths}
        live = set(by_id[resource])
        for path in paths:
            data = read_changeset(path.read_text(encoding='utf-8'))
            for e in validator.iter_errors(data):
                errors.append(f'{path.relative_to(root)}: {"/".join(map(str, e.absolute_path))}: {e.message}')
            cid = path.stem
            if not CHANGESET_ID.match(cid):
                errors.append(f'{path.relative_to(root)}: the filename is not <UTC timestamp>-<4 hex>')
                continue
            if cid in ids_seen:
                errors.append(f'{path.relative_to(root)}: the id is already used')
            ids_seen.add(cid)
            when = dt.datetime.strptime(cid[:18], '%Y-%m-%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
            if when > now:
                errors.append(f'{path.relative_to(root)}: the timestamp is in the future')
            for i, change in enumerate(data.get('changes', [])):
                at = f'{path.relative_to(root)}: changes/{i}'
                if change.get('type') == 'revert':
                    target = change.get('changeset', '')
                    if target not in in_log:
                        errors.append(f'{at}: reverts {target}, which is not pending in this log')
                    elif target >= cid:
                        errors.append(f'{at}: reverts {target}, which does not come earlier')
                    continue
                sid = change.get('key', '')
                kind = change.get('type')
                if not sid.startswith(TYPES[resource] + '-'):
                    errors.append(f'{at}: {sid} does not belong in the {resource} folder')
                exists = sid in live
                if kind == 'create':
                    if exists or sid in by_id[resource]:
                        errors.append(f'{at}: create {sid}, which already exists or existed')
                    if not re.fullmatch(schema.id_pattern(resource), sid):
                        errors.append(f'{at}: {sid} does not match the System ID pattern')
                    live.add(sid)
                    missing = [f for f in schema.required(resource) if f not in change.get('values', {})]
                    if missing:
                        errors.append(f'{at}: create is missing required fields {missing}')
                elif kind in ('update', 'remove') and not exists:
                    errors.append(f'{at}: {kind} {sid}, which does not exist at that point')
                if kind == 'remove':
                    live.discard(sid)
                    if change.get('duplicate_of') and change['duplicate_of'] not in live:
                        errors.append(f'{at}: duplicate_of {change["duplicate_of"]}, which does not exist')
                for fid, value in change.get('values', {}).items():
                    f = schema.field(resource, fid)
                    if f is None:
                        errors.append(f'{at}: unknown field id {fid!r} in {resource}')
                        continue
                    if fid in DERIVED:
                        errors.append(f'{at}: {fid} is derived, so is never a finding')
                    if value in schema.missing[resource]:
                        continue
                    agreed, _ = reword(resource, fid, value)
                    if agreed != value:
                        errors.append(f'{at}: {fid} = {value!r} is not in the agreed wording, {agreed!r}')
                    v, ok = normalise_value(f, value)
                    if not ok or v != value:
                        errors.append(f'{at}: {fid} = {value!r} is not an allowed value')
    return errors


# ---------------------------------------------------------------------------
# The codebook proposals, and comparing two exports


def read_codebook(wb):
    ws = find_sheet(wb, 'Codebook _ Proposals')
    if ws is None:
        return []
    rows = list(ws.iter_rows(values_only=True))
    header = [key(cell_text(v)) for v in rows[0]]
    out = []
    for r in rows[1:]:
        d = {h: cell_text(v) for h, v in zip(header, r) if h}
        if d.get('variable name') or d.get('dpi system'):
            out.append(d)
    return out


def codebook_key(r):
    return (key(r.get('dpi system')), key(r.get('variable name')), key(r.get('category name')))


SHIFT_REACH = 3


def suspected_shifts(tab, before, now, schema, imported):
    """Places where a tab's variables only agree with the older export once its values are read some rows
    up or down, which says the columns have come apart. Listed, never repaired. Returns (per place, per row)."""
    fid = lambda r: schema.field_for(tab.resource, r.var)[0] or key(r.var)
    value = lambda r: re.sub(r'\s+', ' ', r.new).strip().casefold()
    earlier = defaultdict(set)
    named = defaultdict(set)
    for r in before:
        if value(r):
            earlier[(place_key(r.place), fid(r))].add(value(r))
            named[(place_key(r.place), value(r))].add(r.var.strip())
    by_n = {r.n: r for r in now}
    places = defaultdict(list)
    for r in now:
        places[place_key(r.place)].append(r)
    per_place, per_row = [], []
    for place, rows in places.items():
        agree = Counter()
        for offset in range(-SHIFT_REACH, SHIFT_REACH + 1):
            for r in rows:
                other = by_n.get(r.n + offset)
                if other is not None and place_key(other.place) == place and value(other) and value(other) in earlier[(place, fid(r))]:
                    agree[offset] += 1
        best = max(sorted(agree, key=abs), key=lambda offset: agree[offset], default=0)
        if best == 0 or agree[best] < 3 or agree[best] <= agree[0]:
            continue
        per_place.append((tab.title, rows[0].place.strip(), rows[0].n, rows[-1].n, len(rows), agree[0], best, agree[best]))
        for r in rows:
            per_row.append((tab.title, r.n, r.place.strip(), best, r.var.strip(), r.prev, r.new,
                            '; '.join(sorted(named[(place, value(r))])), 'yes' if (tab.title, r.n) in imported else 'no'))
    return per_place, per_row


def compare(prev_wb, wb, codebook, schema, imported):
    """Markdown lines comparing an older export with this one"""
    sig = lambda r: (place_key(r.place), key(r.var), key(r.new))
    now, before = {}, {}
    for tab in TABS:
        got = read_tab(wb, tab)
        now[tab.title] = got[0] if got else None
        got = read_tab(prev_wb, tab, read_dates=False)
        before[tab.title] = got[0] if got else None
    where = defaultdict(list)
    for title, rows in now.items():
        for r in rows or []:
            where[sig(r)].append(f'{title} r{r.n}')
    old_log = read_tab(wb, Tab('Data Exchange_Changelog_Old', 'exchange')) or read_tab(prev_wb, Tab('Data Exchange_Changelog_Old', 'exchange'))
    in_old_log = {sig(r) for r in (old_log[0] if old_log else [])}
    names = lambda w: {ws.title.strip() for ws in w.worksheets}
    L = ['## Compared with the previous export\n']
    L.append(f'Tabs removed: {", ".join(sorted(names(prev_wb) - names(wb))) or "none"}. '
             f'Tabs added: {", ".join(sorted(names(wb) - names(prev_wb))) or "none"}.\n')
    rows_table = []
    for tab in TABS:
        a, b = before[tab.title], now[tab.title]
        if a is None and b is None:
            continue
        sa = Counter(sig(r) for r in a or [])
        sb = Counter(sig(r) for r in b or [])
        added = sum((sb - sa).values())
        gone = sum((sa - sb).values())
        rows_table.append((tab.title, '-' if a is None else len(a), '-' if b is None else len(b), added, gone))
    L.append('Rows with a variable or value, and rows added or gone (matched on place, variable and new value):\n')
    L.append(md_table(['tab', 'before', 'now', 'added', 'gone'], rows_table))
    L.append('')
    for tab in TABS:
        a, b = before[tab.title], now[tab.title]
        if a is not None and b is None:
            L.append(f'### Where the rows of {tab.title} went\n')
            L.append(md_table(['row', 'place', 'variable', 'new value', 'now'],
                              [(r.n, r.place, short(r.var, 40), short(r.new, 40), '; '.join(where.get(sig(r), [])) or 'not found')
                               for r in a if r.var.strip()]))
            L.append('')
    for tab in TABS:
        a, b = before[tab.title], now[tab.title]
        if a is None or b is None:
            continue
        ca = Counter(place_key(r.place) for r in a)
        cb = Counter(place_key(r.place) for r in b)
        changed = [(p or '(blank)', ca[p], cb[p]) for p in sorted(set(ca) | set(cb)) if ca[p] != cb[p]]
        if len(changed) < 5:
            continue
        sa = Counter(sig(r) for r in a)
        new_rows = [r for r in b if sig(r) not in sa]
        marked = Counter(key(r.new_system_raw) or '(blank)' for r in new_rows)
        L.append(f'### {tab.title}: places whose row count changed ({len(changed)})\n')
        L.append(f'{len(new_rows)} rows are new. Their New system values: '
                 + ', '.join(f'{k} ({n})' for k, n in marked.most_common())
                 + f'. {sum(1 for r in new_rows if sig(r) in in_old_log)} of them match a row of Data Exchange_Changelog_Old.\n')
        L.append(md_table(['place', 'before', 'now'], changed))
        L.append('')
    prev_keys = {codebook_key(r) for r in read_codebook(prev_wb)}
    new_codebook = {codebook_key(r) for r in codebook} - prev_keys
    shift_places, shift_rows = [], []
    for tab in TABS:
        if before[tab.title] and now[tab.title]:
            per_place, per_row = suspected_shifts(tab, before[tab.title], now[tab.title], schema, imported)
            shift_places += per_place
            shift_rows += per_row
    L.append(f'### Suspected column shifts ({len(shift_places)} places, {len(shift_rows)} rows)\n')
    L.append('Places where a variable agrees with its value in the previous export only when the value is read from another row, '
             'so the variable column and the value columns seem to have come apart. Nothing here is repaired. '
             'Values that fit the codebook, or go in a free-text field, are still in the changesets, so check these before relying on them. '
             'Offset: the value that agrees with the variable on row n is on row n + offset. '
             '[`import-proposals-suspected-shifts.csv`](import-proposals-suspected-shifts.csv)\n')
    if shift_places:
        L.append(md_table(['tab', 'place', 'rows', 'row count', 'agree as they stand', 'offset', 'agree at that offset'],
                          [(t, p, f'{a}–{b}', n, zero, f'{best:+d}', at) for t, p, a, b, n, zero, best, at in shift_places]))
        L.append('')
    L.append(f'Codebook proposals: {len(read_codebook(prev_wb))} rows before, {len(codebook)} now, '
             f'{len(new_codebook)} new (marked "New" above; matched on system, variable and categories).\n')
    return {'lines': L, 'new_codebook': new_codebook, 'shift_rows': shift_rows}


# ---------------------------------------------------------------------------
# Reports


def md_table(header, rows):
    esc = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')
    out = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    out += ['| ' + ' | '.join(esc(c) for c in r) + ' |' for r in rows]
    return '\n'.join(out)


def short(text, n=60):
    text = re.sub(r'\s+', ' ', str(text)).strip()
    return text if len(text) <= n else text[:n - 1] + '…'


def write_reports(root, report, changesets, removed, new_systems, fills, schema, xlsx, codebook, comparison, created_at):
    rdir = root / 'reports'
    digest = hashlib.sha256(xlsx.read_bytes()).hexdigest()[:12]
    prefix = 'import-proposals'

    tab_order = [t.title for t in TABS]
    by_sheet = lambda r: (tab_order.index(r[0]), r[1], r[3])
    write_csv(rdir / f'{prefix}-blank-rationales.csv', ['tab', 'row', 'system id', 'field id', 'value'],
              sorted(report.blank_rationales, key=by_sheet))
    write_csv(rdir / f'{prefix}-not-reviewed.csv',
              ['tab', 'row', 'country / region', 'updated in the dataset', 'new system', 'system name', 'variable',
               'previous data point', 'new data point', 'url', 'rationale', 'reviewed for publication'],
              [(r.tab, r.n, r.place, r.updated, r.new_system_raw, r.system_name, r.var, r.prev, r.new, r.url, r.rationale, r.reviewed)
               for r in report.not_reviewed])
    if comparison:
        write_csv(rdir / f'{prefix}-suspected-shifts.csv',
                  ['tab', 'row', 'country / region', 'offset', 'variable', 'previous data point', 'new data point',
                   'variable with this value in the previous export', 'in the changesets'],
                  comparison['shift_rows'])
    write_csv(rdir / f'{prefix}-na-not-found.csv', ['tab', 'row', 'system id', 'field id', 'value', 'rationale'],
              sorted(report.na_not_found, key=by_sheet))
    write_csv(rdir / f'{prefix}-unattributed.csv', ['tab', 'row', 'place', 'variable', 'new value', 'why'],
              sorted(report.unattributed, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-prev-mismatches.csv', ['tab', 'row', 'system', 'field', 'sheet previous value', 'baseline value'],
              sorted(report.prev, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-outside-codebook.csv', ['tab', 'row', 'system', 'field', 'value', 'allowed'],
              sorted(report.outside, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-skipped.csv', ['tab', 'row', 'place', 'variable', 'new value', 'reason'],
              sorted(report.skipped, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-renames.csv', ['tab', 'row', 'system', 'place', 'current name', 'new name'],
              sorted(report.renames, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-conflicts.csv', ['resource', 'system', 'field', 'tab', 'row', 'value'],
              [(res, sid, fid, t, n, v) for res, sid, fid, xs in sorted(report.conflicts) for t, n, v in xs])
    write_csv(rdir / f'{prefix}-newvar-overwrites.csv', ['tab', 'row', 'system', 'field', 'baseline value', 'log value'],
              sorted(report.overwrites, key=lambda r: (r[0], r[1])))
    write_csv(rdir / f'{prefix}-wording.csv', ['table', 'system', 'field', 'published', 'agreed', 'rules', 'reason', DATE_FIELD, 'skipped because'],
              [(r, k, f, a, b, '; '.join(rules), reason, as_of, '') for r, k, f, a, b, rules, reason, as_of in report.wording]
              + [(r, k, f, a, b, '', '', '', why) for r, k, f, a, b, why in report.wording_skipped])

    L = []
    L.append('# Proposal logs import report\n')
    L.append(f'Generated by `scripts/import/proposals.py` from `proposals.xlsx` (sha256 `{digest}…`). '
             f"Each finding is dated by its row's Date Edited if that's a specific date, otherwise {DATE_FIELD} = {DEFAULT_AS_OF} (D34). "
             "Each table has its own log. The baseline is the latest release, and the changesets are written as pending ones, in `changesets/next/<resource>/` (D66). "
             f'Changeset ids start from `--created-at {created_at.strftime("%Y-%m-%dT%H:%M:%SZ")}`: re-run this export with the same time to get the same ids. '
             'This run is from the frozen export: the sheets froze on 2026-11-02 (D63).\n')
    L.append('A changeset holds one system from one tab. Its changes hold no sheet references or summaries, '
             'and their reasons are the sheet\'s rationale text with only spaces and tabs tidied, or empty if the rationale is blank (D24, D26, D27, D29, D30). '
             f'To find the changeset for a sheet row, or the rows behind a changeset, see [`{prefix}-changesets.csv`]({prefix}-changesets.csv).\n')
    if comparison and comparison['shift_rows']:
        L.append(f"**Check before relying on this run:** {len(comparison['shift_rows'])} rows look shifted, so their variables and values may not belong together. "
                 'See "Suspected column shifts" below.\n')
    L.append('Rows are attributed to a system only by these rules: New system = Yes is a new system; '
             'a place with one system of the type is that system; a place with several uses the system name '
             '(Payments: Notes; DX: the system-name column) and then the exact Country / Region; '
             'rows after a "Break for …" marker are a new system. Anything else is listed below, not guessed.\n')
    no_col = [t for t, has in report.has_new_system_column.items() if not has]
    if no_col:
        L.append(f'Tabs without a New system column: {", ".join(no_col)}. '
                 'In these, new systems are only found from break markers and the known cases.\n')

    L.append('## Counts per tab\n')
    rows = []
    tot = Counter()
    for tab, c in report.counts.items():
        rows.append((tab, c['rows'], c['not_reviewed'], c['findings'], c['changesets'], c['changes'], c['creates'], c['fills'], c['removes'], c['renames'], c['unattributed']))
        tot.update(c)
    rows.append(('**Total**', tot['rows'], tot['not_reviewed'], tot['findings'], tot['changesets'], tot['changes'], tot['creates'], tot['fills'], tot['removes'], tot['renames'], tot['unattributed']))
    L.append(md_table(['tab', 'rows read', 'not reviewed', 'findings emitted', 'changesets', 'changes', 'creates', 'placeholder fills', 'removes', 'renames', 'not attributed'], rows))
    L.append(f'\nFindings are field values (a create counts each of its values from the log). '
             f'{report.no_effect} findings repeat the baseline value (no effect, but kept: re-confirming is a finding). '
             f'Every changeset, with its tab and rows, is in [`{prefix}-changesets.csv`]({prefix}-changesets.csv).\n')
    all_changes = [(c['resource'], e['type']) for c in changesets.values() for e in c['data']['changes']]
    change_types = ['create', 'update', 'remove']
    L.append(md_table(['table', 'changesets', 'changes', *change_types],
                      [(name, sum(1 for c in changesets.values() if c['resource'] == name), sum(1 for r, _ in all_changes if r == name),
                        *(sum(1 for r, t in all_changes if r == name and t == kind) for kind in change_types)) for name in schema.resources]
                      + [('**Total**', len(changesets), len(all_changes), *(sum(1 for _, t in all_changes if t == kind) for kind in change_types))]))
    L.append(f'\nWithin a system and a date, rows make one change if their rationale and their set of sources are exactly the same (D29): '
             f'{report.grouping["rows"]} imported cells make {report.grouping["changes"]} create and update changes. '
             'Reasons from different rows are never joined.\n')

    if report.missing_tabs:
        L.append(f'Tabs to apply that are not in this export: {", ".join(report.missing_tabs)}.\n')
    if report.unknown_tabs:
        L.append(f'Tabs in this export that look like logs but are not applied: {", ".join(report.unknown_tabs)}.\n')

    L.append('## Dates\n')
    L.append(f"Imported rows by how their Date Edited reads. Specific dates are used as they are; every other row is dated {DEFAULT_AS_OF} (D34). "
             'Data Exchange_FinalLog\'s date column is now headed "Date edited". '
             'Its "Updated in the dataset" column holds regions, such as Europe, and is not read as a date or a region.\n')
    for t, letter, days in report.unheaded_dates:
        L.append(f'{t} column {letter} has no heading, so is not read, but holds dates: '
                 + ', '.join(f'{day} ({n})' for day, n in sorted(days.items())) + '.\n')
    hows = ['specific', 'blank', 'vague', 'no year']
    date_tabs = [t for t in report.counts if any(report.dates[(t, h)] for h in hows)]
    L.append(md_table(['tab', *hows, 'imported rows'],
                      [(t, *(report.dates[(t, h)] for h in hows), sum(report.dates[(t, h)] for h in hows)) for t in date_tabs]
                      + [('**Total**', *(sum(report.dates[(t, h)] for t in date_tabs) for h in hows),
                          sum(report.dates[(t, h)] for t in date_tabs for h in hows))]))
    L.append('')
    if report.vague_dates:
        L.append('Dates that were not specific enough to use: '
                 + '; '.join(f'{t}: {v!r} ({n})' for (t, v), n in sorted(report.vague_dates.items())) + '.\n')
    L.append(f"Findings that lose to the baseline, because they are older than their row's `Last updated` (D7): {len(report.older_than_baseline)}.\n")
    if report.older_than_baseline:
        L.append(md_table(['tab', 'row', 'system', 'field', 'value', DATE_FIELD, 'Last updated'],
                          [(t, n, s, f, short(v, 40), a, b) for t, n, s, f, v, a, b in sorted(report.older_than_baseline)]))
        L.append('')
    if report.unreadable_last_updated:
        L.append('Findings on baseline rows whose `Last updated` could not be read, so were not compared: '
                 + '; '.join(f'{v!r} ({n})' for v, n in report.unreadable_last_updated.most_common()) + '.\n')
    if report.future_dates:
        L.append(f'Findings dated after this export was imported: {len(report.future_dates)}.\n')
        L.append(md_table(['tab', 'row', 'system', 'field', DATE_FIELD], sorted(report.future_dates)))
        L.append('')

    L.append('## Rows not reviewed\n')
    L.append(f'Provisional, and not yet confirmed: rows marked "Reviewed for Publication: No" are left out of the changesets: {len(report.not_reviewed)} rows'
             + (' (' + ', '.join(f'{t}: {n}' for t, n in sorted(Counter(r.tab for r in report.not_reviewed).items())) + ')' if report.not_reviewed else '')
             + f'. Every one is in [`{prefix}-not-reviewed.csv`]({prefix}-not-reviewed.csv).\n')

    L.append('## Rationales\n')
    blank_by_tab = Counter(r[0] for r in report.blank_rationales)
    L.append(f'Imported rows with a blank rationale: {len(report.blank_rationales)}'
             + (' (' + ', '.join(f'{t}: {n}' for t, n in sorted(blank_by_tab.items())) + ')' if blank_by_tab else '')
             + f'. Their reasons are empty, and the site shows nothing for them (D27). [`{prefix}-blank-rationales.csv`]({prefix}-blank-rationales.csv)\n')
    na = [r for r in report.na_not_found if r[4] == 'NA']
    L.append(f'Rationales that seem to contradict the value (D37), left as they are for the researchers to check: {len(na)} cells set to `NA` whose rationale says something like not found, '
             f'and {len(report.na_not_found) - len(na)} cells set to `Not Found` whose rationale says not yet recorded. '
             f'[`{prefix}-na-not-found.csv`]({prefix}-na-not-found.csv)\n')
    L.append(f'`Not Found` is a value, not a missing value (D37, D61): "we looked and found nothing". '
             f'{sum(report.not_found_cells.values())} imported cells hold it, in {len(report.not_found_cells)} fields.\n')
    L.append(f'New systems: the create change holds the required fields and the rows that match the name row\'s rationale, sources and date; other rows become updates after it. '
             f'Required cells whose own row says something different, so whose rationale is not on any change: {len(report.create_differs)}.\n')
    if report.create_differs:
        L.append(md_table(['tab', 'row', 'system', 'field', 'value'], [(t, n, s, f, short(v, 40)) for t, n, s, f, v in sorted(report.create_differs)]))
        L.append('')
    if report.create_unnamed:
        L.append('Creates with no name row, whose reason is empty: ' + ', '.join(f'{s} ({t})' for t, s in report.create_unnamed) + '.\n')
    L.append(f'Removes: a change has one reason, one set of sources and one date, and takes them from the first row that asks for the removal. '
             f'Later rows that say something different can\'t be expressed: {len(report.remove_differs)}.\n')
    if report.remove_differs:
        L.append(md_table(['tab', 'row', 'system', 'differs in'], sorted(report.remove_differs)))
        L.append('')

    L.append('## Agreed wording (D54, D55)\n')
    L.append(f'The rules in `WORDING` rewrite values from the sheets before they are emitted, and the published data in one wording changeset per table, '
             'with the reason "Use the agreed wording for <field title>". '
             'Each rewritten cell is its own change; the rules that hit one cell share its change. '
             f"A rewording is mechanical, so each change's {DATE_FIELD} is the published cell's, its row's Last updated (D65), "
             'and the wording changeset comes after the baseline, so the rewrite wins the tie. '
             "A published cell that this round's changes from the sheets, or a changeset we didn't write, set is left to them. "
             f'Every published cell, rewritten or skipped, is in [`{prefix}-wording.csv`]({prefix}-wording.csv).\n')
    published = Counter((r, f, rule) for r, k, f, a, b, rules, reason, as_of in report.wording for rule in rules if rule != 'one-off')
    L.append(md_table(['table', 'field', 'rule', 'sheet rows', 'published cells'],
                      [(r, f, rule, report.reworded[(r, f, rule)], published[(r, f, rule)])
                       for r in schema.resources for res, f, rule, how in WORDING if res in (None, r) and f in schema.fields[r]]))
    L.append('')
    one_offs = [x for x in report.wording if 'one-off' in x[5]]
    L.append(f'One-off fixes ({len(one_offs)}):\n')
    L.append(md_table(['system', 'field', 'published', 'agreed', 'reason', DATE_FIELD],
                      [(k, f, a, b, reason, as_of) for r, k, f, a, b, rules, reason, as_of in one_offs]))
    L.append('')
    if report.wording_skipped:
        L.append(f'Published cells not rewritten ({len(report.wording_skipped)}):\n')
        L.append(md_table(['system', 'field', 'published', 'agreed', 'why'],
                          [(k, f, short(a, 40), short(b, 40), why) for r, k, f, a, b, why in report.wording_skipped]))
        L.append('')

    L.append('## Known cases\n')
    for line in report.known:
        L.append(f'- {line}')
    L.append('')

    L.append(f'## Removes ({len(removed)})\n')
    L.append(md_table(['system', 'tab', 'rows', 'duplicate of', 'reason'],
                      [(sid, tab, ', '.join(map(str, rows_)), dup or '', short(reason, 90))
                       for sid, (tab, rows_, reason, sources, dup, as_of) in sorted(removed.items())]))
    L.append('')
    filled = {c['key']: c for c in changesets.values() if c['kind'] == 'fill'}
    L.append(f'## Placeholder fills ({len(filled)})\n')
    L.append('New system = Yes rows in a place whose only system of the type is a placeholder (no name). '
             'A filled placeholder keeps its id (D9), so these are updates of the existing key, not creates.\n')
    L.append(md_table(['system', 'name', 'tab', 'rows'],
                      [(sid, short(fills[sid]['name'], 50), fills[sid]['tab'], f"{fills[sid]['rows'][0]}–{fills[sid]['rows'][1]}")
                       for sid in sorted(filled)]))
    L.append('')
    if report.placeholders_kept:
        L.append(f'New systems created in a place that has a placeholder and a named system, so the placeholder is left alone '
                 f'({len(report.placeholders_kept)}):\n')
        L.append(md_table(['tab', 'rows', 'place', 'systems here'],
                          [(t, f'{a}–{b}', p, short(x, 120)) for t, a, b, p, x in report.placeholders_kept]))
        L.append('')
    made = {c['key'] for c in changesets.values() if c['kind'] == 'create'}
    L.append(f'## Creates ({len(made)})\n')
    L.append('New System IDs are the next unused number for the place and type. '
             '"Already here" lists the systems the place has, so placeholders and replaced systems can be checked.\n')
    L.append(md_table(['system', 'name', 'tab', 'rows', 'how', 'already here'],
                      [(sid, short(info['name'], 45), info['tab'], f"{info['rows'][0]}–{info['rows'][1]}", info['group'][0],
                        short('; '.join(info['others']) or '-', 120))
                       for sid, info in sorted(new_systems.items()) if sid in made]))
    L.append('')

    L.append(f'## Rows not attributed to a system ({len(report.unattributed)})\n')
    L.append(f'Full list: [`{prefix}-unattributed.csv`]({prefix}-unattributed.csv). Grouped by tab, place and reason:\n')
    grouped = defaultdict(list)
    for t, n, place, var, new, why in report.unattributed:
        grouped[(t, place.strip(), why)].append(n)
    L.append(md_table(['tab', 'place', 'rows', 'why'],
                      [(t, p, f'{min(ns)}–{max(ns)} ({len(ns)})' if len(ns) > 1 else str(ns[0]), w)
                       for (t, p, w), ns in sorted(grouped.items(), key=lambda kv: (kv[0][0], min(kv[1])))]))
    L.append('')

    L.append(f'## Variable names\n')
    if report.unmapped:
        L.append('Unmapped (rows skipped):\n')
        L.append(md_table(['tab', 'variable', 'rows'], [(t, v, n) for (t, v), n in sorted(report.unmapped.items())]))
    else:
        L.append('Every variable name maps to a field.\n')
    L.append('\nNames that differ from the datapackage (mapped, by name, then title, then alias, then a drift table in the script):\n')
    L.append(md_table(['resource', 'log name', 'field id', 'matched by', 'rows'],
                      [(r, v, f, h, n) for (r, v, f, h), n in sorted(report.variants.items())]))
    L.append('')

    L.append(f'## Conflicts ({len(report.conflicts)})\n')
    L.append('The same cell set to different values, in two tabs or twice in one tab. Both sides are withheld. '
             f'[`{prefix}-conflicts.csv`]({prefix}-conflicts.csv)\n')
    if report.conflicts:
        L.append(md_table(['system', 'field', 'values'],
                          [(sid, fid, '; '.join(f'{t} r{n}: {short(v, 40)!r}' for t, n, v in xs))
                           for res, sid, fid, xs in sorted(report.conflicts)]))
    L.append('')

    L.append(f'## Previous-value mismatches ({len(report.prev)})\n')
    L.append(f"Where the sheet's previous value isn't the baseline value. The finding is still emitted. "
             f'Blank, "-" and NA count as the same. [`{prefix}-prev-mismatches.csv`]({prefix}-prev-mismatches.csv)\n')
    L.append(md_table(['tab', 'row', 'system', 'field', 'sheet', 'baseline'],
                      [(t, n, s, f, short(p, 40), short(b, 40)) for t, n, s, f, p, b in sorted(report.prev)[:25]]))
    if len(report.prev) > 25:
        L.append(f'\n…and {len(report.prev) - 25} more in the CSV.')
    L.append('')

    L.append(f'## Values outside the codebook ({len(report.outside)})\n')
    L.append('Not emitted. Allowed values are the datapackage plus `reports/draft-schema-changes.json`. '
             f'[`{prefix}-outside-codebook.csv`]({prefix}-outside-codebook.csv)\n')
    by_field = defaultdict(Counter)
    for t, n, s, fid, v, allowed in report.outside:
        by_field[fid][v.strip()] += 1
    L.append(md_table(['field', 'values (rows)'],
                      [(fid, '; '.join(f'{short(v, 50)!r} ({n})' for v, n in c.most_common())) for fid, c in sorted(by_field.items())]))
    L.append('\nNormalised to a codebook value, or to `Not Found` (emitted):\n')
    L.append(md_table(['field', 'sheet', 'emitted', 'rows'],
                      [(f, short(a, 40), b, n) for (f, a, b), n in sorted(report.normalised.items())]))
    L.append('')

    L.append(f'## Skipped rows by reason ({len(report.skipped)})\n')
    L.append(f'[`{prefix}-skipped.csv`]({prefix}-skipped.csv)\n')
    reasons = Counter()
    for t, n, place, var, new, why in report.skipped:
        reasons[(t, why.split(': ')[0])] += 1
    L.append(md_table(['tab', 'reason', 'rows'], [(t, w, n) for (t, w), n in sorted(reasons.items())]))
    L.append('')

    L.append(f'### Count for DPI / DPI-Like rows ({len(report.dpi)})\n')
    L.append('Count for DPI will be derived, so these are not emitted.\n')
    L.append(md_table(['tab', 'row', 'system', 'previous', 'new'], sorted(report.dpi)))
    L.append('')

    L.append(f'### General notes in Digital ID_Notes ({len(report.notes)})\n')
    L.append('Not data. Skipped.\n')
    L.append(md_table(['row', 'place', 'note', 'text'], [(n, p, short(v, 50), short(new, 70)) for t, n, p, v, new in sorted(report.notes)]))
    L.append('')

    L.append(f'### Data Exchange_NewVar_Log over an existing Yes ({len(report.overwrites)})\n')
    L.append('The log fills its new variables with N/A for every system. Defaults are not emitted; '
             f'these rows would have overwritten a Yes. [`{prefix}-newvar-overwrites.csv`]({prefix}-newvar-overwrites.csv)\n')
    ov = Counter((t, f) for t, n, s, f, b, v in report.overwrites)
    L.append(md_table(['tab', 'field', 'systems'], [(t, f, n) for (t, f), n in sorted(ov.items())]))
    L.append('')

    L.append(f'## Renames ({len(report.renames)})\n')
    L.append(f'Name changes with New system blank, emitted as updates of the name. Check each is the same system '
             f'(D9: renamed, wrong system, or replaced). [`{prefix}-renames.csv`]({prefix}-renames.csv)\n')
    L.append(md_table(['tab', 'row', 'system', 'current', 'new'],
                      [(t, n, s, short(c, 45), short(v, 45)) for t, n, s, p, c, v in sorted(report.renames)]))
    L.append('')

    L.append('## Other checks\n')
    L.append(f'- Links to dpimap.org itself dropped from sources: {sum(report.dropped_sources.values())} '
             f'({len(report.dropped_sources)} different).')
    yl = '; '.join(f'{t}: {f} ({n})' for (t, f), n in sorted(report.yellow.items()))
    L.append(f'- Yellow rows in the payment tabs (new variables), by field: {yl or "none"}.')
    L.append('- Draft schema changes still open, and the fields whose values are skipped: `reports/draft-schema-changes.json`.')
    L.append('')

    L.append(f'## Codebook proposals ({len(codebook)})\n')
    L.append('From the Codebook _ Proposals tab, for the schema migration. '
             + ('"New" marks rows that are not in the previous export.\n' if comparison else '\n'))
    new_keys = comparison['new_codebook'] if comparison else set()
    L.append(md_table(['', 'system', 'variable', 'new variable', 'categories', 'description', 'date'],
                      [('New' if codebook_key(r) in new_keys else '', r.get('dpi system', ''), r.get('variable name', ''),
                        r.get('new variable', ''), short(r.get('category name', '').replace('\n', '; '), 60),
                        short(r.get('description', ''), 90), r.get('date', ''))
                       for r in codebook]))
    L.append('')
    if comparison:
        L.extend(comparison['lines'])
    (rdir / f'{prefix}.md').write_text('\n'.join(L), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Turn the proposal change logs into changesets.')
    parser.add_argument('xlsx', help='the proposals workbook')
    parser.add_argument('root', help='the repo root')
    parser.add_argument('--created-at', required=True, type=utc_time, metavar='ISO_UTC',
                        help="when this export's changesets were created, like 2026-10-30T12:00:00Z. Pin one per export.")
    parser.add_argument('--previous', help='an older export to compare this one with, in the report')
    args = parser.parse_args()
    main(args.xlsx, args.root, args.created_at, args.previous)
