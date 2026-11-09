# Last tweaks for the 6 Nov 2026 release

Applied on 5 Nov 2026 (late evening, UK time) from a fresh download of the team's sheet (`1OqJd9Lt…`, saved as `tweaks.xlsx` in the session scratchpad's `tweaks-in/`). Branch `session-on-places`, on top of `1492b8a`. Not pushed.

| Commit | What |
| --- | --- |
| `e96dd88` | Value tweaks: 2 new changesets, plus the rebuilt release (`public/data/2026-11-06/`, `reports/data-build-2026-11-06.md`) |
| `3494658` | Rationale edits: 186 `reason` strings changed in place in 40 changeset files. The rebuild changed nothing in the release, so the commit has only the changesets |

Checks after each commit: `npm run data:build -- --release 2026-11-06` with 0 blocking items (47 notes, the same as before), `npm run data:check` passed, and `npm test` passed (data check, site build, links).

## The sheet

The tabs are named as described:

- **Value tweaks:** `Digital ID`, `Payments`, `Data exchange`. Their instructions are in `How to use`. `Lists` holds the dropdown values: System IDs, and field titles that match the codebook's titles.
- **Rationale edits, older version:** `Digital ID rationales`, `Payments rationales`, `Data exchange rationales`. Columns: System ID, Field(s), Change, Current rationale, New rationale, Changeset. Their instructions are in `Rationales tweaks`.
- **Rationale edits, newer version:** the same three tabs with ` (1)` added to the name. They also have the Country / Region and System name columns. Their instructions are in `How to use (1)`.

Both versions have the same rows (91 identity, 806 payment, 123 data exchange). Edits were in both versions:
- Identity: 36 in the newer version and 0 in the older one.
- Payment: 153 in the newer version and 10 in the older one. 3 of the 10 were the same in both, 5 differed only by a trailing space, and 2 really differed.

## Value tweaks applied (10)

- `changesets/2026-11-06/identity/2026-11-05T234428Z-04e7.toml` (2 changes)
- `changesets/2026-11-06/payment/2026-11-05T234428Z-a867.toml` (8 changes)

Each change is an `update` with `key`, a bare `as_of`, one value, `reason` and `sources`. Neither changeset has an `author`.

| System | Field | Old → new | as_of |
| --- | --- | --- | --- |
| id-bz-01 | Codified digital ID legal status (`legal_status`) | No → Not Found | 2026-11-05 |
| id-bz-01 | Regulation for digital ID (`regulation`) | No → Not Found | 2026-11-06 |
| pay-gb-02 | URL (`url`) | https://fastpayments.worldbank.org/sites/default/files/2023-05/Settlement%20Note_Final_April%2020.pdf → https://www.wearepay.uk/what-we-do/payment-systems/faster-payment-system/ | 2026-11-05 |
| pay-gb-02 | Reporting forum (`reporting_forum`) | Yes → No | 2026-11-05 |
| pay-pl-02 | Reporting forum (`reporting_forum`) | Yes → No | 2026-11-05 |
| pay-ro-02 | Reporting forum (`reporting_forum`) | Yes → No | 2026-11-05 |
| pay-bb-01 | Interoperability policy (`interoperability_policy`) | NA → Yes | 2026-11-05 |
| pay-no-01 | Active-real time payment system present (`realtime_active`) | Yes → No | 2026-11-05 |
| pay-is-01 | Active-real time payment system present (`realtime_active`) | Yes → No | 2026-11-05 |
| pay-hu-02 | URL (`url`) | https://www.giro.hu/kliringtagok → https://giro.hu/en/en-giroinstant | 2026-11-05 |

Notes on these:
- **id-bz-01:** both rows were written exactly as the sheet has them, and need checking:
  - The reason has a typo: "Planned/Pilot valuepostponed for future review." I did not correct it.
  - The two rows have different dates. The second, 2026-11-06, was a day ahead of when I applied it, and Belize's Last updated is now 2026-11-06.
  - There are no sources.
  - The reason's link to these two fields isn't obvious.
- **Sources:** the sheet asks for links separated by spaces, but pay-pl-02, pay-bb-01 and pay-is-01 separate theirs with " | ". I split them on spaces and dropped the bars. Each remaining source is a URL.
- **Values:** no value needed normalising (D55), and no tweak sets a value the cell already had.

## Value tweaks skipped (2)

| Row | System | Field | New value | Why |
| --- | --- | --- | --- | --- |
| Payments 6 | pay-lac-02 | Active-real time payment system present | No | The System ID looks wrong (see below) |
| Payments 7 | pay-lac-02 | Status of payment system implementation | Planned/Piloted | The same |

pay-lac-02 is **SIPA** (Payment Interconnection System, Central America and the Dominican Republic). The reason and both sources for these rows are about the **CARICOM** payment system (The Bahamas–Barbados proof of concept, the Central Bank of Trinidad and Tobago, CAPSS/PAPSS), which is **pay-lac-04** (CAPSS). pay-lac-04's own rationale edits use the same wording and sources. I applied the rows to neither system.
- If they are meant for pay-lac-04, the release has Active = Yes there, so the tweak would change it to No.
- Its Status is already Planned/Piloted, so that row would set the value it already has.
- For pay-lac-02 they would change Active from Yes to No and Status from Implemented to Planned/Piloted.

## Rationale edits: 186 applied, 3 skipped

- **Applied:** 36 identity and 150 payment. Each one checked that the file's current `reason` was exactly the sheet's "Current rationale" (all of them matched) and that change N's `key` was the sheet's System ID. Only the `reason = …` line changed: each is a one-line string, escaped by `tomlString`, and every file reads back the same except that reason. The existing reasons were all one-line strings too.
- **Whitespace:** 13 new rationales had a trailing space, which I trimmed. In 5 changes the two versions differed only by a trailing space, so I treated them as agreeing and applied the trimmed text. Those 5 are pay-bf-02 #4, pay-bj-01 #2, pay-bj-01 #4, pay-ci-01 #2 and pay-cv-01 #8, in the changesets `…144135Z-f3e5`, `…144136Z-ff27`, `…144138Z-0c0a` and `…144140Z-479c`. Revert them if a strict reading is wanted.

Skipped:

| System | Changeset | Change | Field | Why |
| --- | --- | --- | --- | --- |
| pay-bf-02 | 2026-11-04T144135Z-f3e5 | 9 | Operator | The two versions differ: "Built and operated by BCEAO." / "Built and operated by (Central Bank of West African States) BCEAO." |
| pay-ci-01 | 2026-11-04T144138Z-0c0a | 9 | Operator | The two versions differ in the same way |
| pay-lac-04 | 2026-11-04T144159Z-a6f8 | 2 | Active-real time payment system present | Held back. The new rationale ("Not yet processing payments for users…") argues for No, but the release has Yes, because the tweak to No was filed under pay-lac-02 and skipped. Publishing it would put a rationale next to a value it contradicts. Apply it together with the pay-lac-04 value tweak once the team confirms the System ID |

The other pay-lac-04 rationale edits (changes 0, 1 and 3–7) are applied; they are consistent with its current values.

## DPI status and counts

The tweaks change no system's DPI status (Count for DPI is the same for all 10 tweaked rows) and no DPI-like country count. The build summary is the same before and after:
- 32 systems changed DPI status since 2026-03-31, 28 are new and 25 were removed.
- Countries with a DPI-like system: Data exchange 103 → 101, Digital ID 70 → 80, Payment 102 → 110.

The only change in the build report is to the rows for pay-is-01 and pay-no-01. Both were already DPI (1) → WIP (0) since 2026-03-31, and now also list "Real-time payments: Yes → No".

## Data exchange (not applied)

- Value tweaks tab `Data exchange`: 0 rows apart from the header.
- Rationale tabs `Data exchange rationales` and `Data exchange rationales (1)`: 123 rows each, with 0 new rationales in either.

## Other notes

- `uv run -I` isn't a uv option, so I ran Python as `uv run --with openpyxl python -I`.
- `tweaks-in/` also held an earlier download, `sheet.xlsx`, from a minute before mine, with a different checksum. I didn't create it and didn't use it.

## Data exchange

Applied on 6 Nov 2026 from a second fresh download of the sheet (`tweaks2.xlsx` in the scratchpad's `tweaks-in/`). The Digital ID and Payments tabs, and their rationale tabs, are the same as in the first download.

| Commit | What |
| --- | --- |
| `49d6982` | Data exchange value tweak: `changesets/2026-11-06/exchange/2026-11-06T071524Z-b883.toml`, plus the rebuilt release |
| `d33d118` | Data exchange rationale edits: 28 `reason` strings changed in place in 24 changeset files. The release didn't change |

After each commit the build had 0 blocking items (47 notes, as before), and `data:check` and `npm test` passed.

### Value tweaks: 1 applied, 1 skipped

The `Data exchange` tab has 2 rows.

| System | Field | Old → new | as_of | |
| --- | --- | --- | --- | --- |
| dx-gr-02 | Status of implementation (`status`) | NA → Implemented | 2026-11-06 | Applied. Reason: "System shows active transactions since 2018". No sources given |
| dx-gr-02 | Sector-specific / Cross-sectoral (`sectoral`) | NA → "Cross-Sectoral" | 2026-11-06 | **Skipped**: it has no reason, which the sheet says is required. The value differs from the codebook's "Cross-sectoral" only in case, so it would be normalised (D55) once a reason is given |

### Rationale edits: 28 applied, 23 skipped

All 51 data exchange edits were in the older tab, `Data exchange rationales`. The newer `(1)` tab has none, so there were no conflicts between the versions. All 51 current rationales matched the changeset files.

The 28 applied edits:
- I trimmed a trailing space from 2 of them (dx-hr-01 #2, dx-pt-01 #3).
- dx-bg-01 #5 and #6 swap their texts. Each now matches its field and value.

Skipped: 20 edits whose new rationale is just **"Delete"**. The sheet gives no way to remove a rationale, and "Delete" could mean an empty reason (`""`, allowed by D27), or removing the change, or removing the system. Five of them are on a system's `create` change, and dx-gr-02's is one of those. If "Delete" meant removing dx-gr-02, it would clash with the status tweak above. The 20 edits:
- dx-at-02 #0, #5, #7 (`…144632Z-05f7`)
- dx-be-01 #5 (`…144636Z-a047`)
- dx-be-02 #1, #3, #8 (`…144637Z-d5ba`)
- dx-ch-02 #4 (`…144642Z-884b`)
- dx-cy-01 #4 (`…144643Z-f778`)
- dx-fi-01 #1, #4 (`…144651Z-5c02`)
- dx-gr-02 #0, #6 (`…144657Z-ccdc`)
- dx-ie-02 #0 (`…144701Z-726b`)
- dx-lt-01 #6 (`…144709Z-5450`)
- dx-nl-02 #0 (`…144715Z-00c3`)
- dx-si-02 #0, #3 (`…144726Z-49e5`)
- dx-tr-02 #0 (`…144730Z-3266`)
- dx-us-01 #1 (`…144732Z-20c2`)

Skipped, because they don't fit their value or would publish a broken link:

| System | Changeset | Change | Field | Why |
| --- | --- | --- | --- | --- |
| dx-bg-01 | 2026-11-04T144638Z-2b8a | 7 | Semantic interoperability | The change sets the value to Syntactic, but the new rationale, "Service level semantic exist", argues for Semantic |
| dx-dk-01 | 2026-11-04T144647Z-7644 | 6 | Impact metrics | The change sets the value to No, but the new rationale says "Data Not Found", which is the Not Found value |
| dx-pl-02 | 2026-11-04T144719Z-60f8 | 1 | Formal Mandate | The new link ends "zadania-publicznes" where the current one ends "zadania-publiczne", so it looks broken. The text also changes "public tasks" to "public task" |

### DPI status and counts

There are no changes in DPI status or in DPI-like country counts. Data exchange is still 103 → 101; Digital ID (70 → 80) and Payment (102 → 110) are also unchanged. The build summary is the same: 32 systems changed DPI status, 28 are new and 25 were removed.

dx-gr-02 is one of the new systems. Its DPI status changed from NA (0) to WIP (0), so it still doesn't count.

## Held-back items, second look

The second download has no changes to any Digital ID or Payments row, value or rationale, so every held-back item stands. I applied none of them and made no third commit:
- **pay-lac-02's two value rows:** still filed under pay-lac-02 (SIPA), not pay-lac-04 (CAPSS). Not applied.
- **pay-lac-04 change 2 rationale:** unchanged, and the release still has Active = Yes, so it would still contradict its value. Not applied.
- **Operator rationales for pay-bf-02 #9 and pay-ci-01 #9:** the two versions still differ ("Built and operated by BCEAO." / "Built and operated by (Central Bank of West African States) BCEAO."). Not applied.
- **id-bz-01:** the typo ("valuepostponed"), the 2026-11-06 date and the missing sources are unchanged. These were applied as the sheet had them in `e96dd88`, and I left them alone.

No value tweak or rationale edit that I applied earlier is different in the sheet now.

## Third pass

Oli confirmed that "Delete" means removing the rationale text, and that a change without a reason is accepted this round. A third download of the sheet, made before applying, matched the second.

| Commit | What |
| --- | --- |
| `45e09f4` | The 20 "Delete" rationale edits listed above now have `reason = ""`, in place, in 13 changeset files. Nothing else changed: the 5 `create` changes, dx-gr-02's included, keep their systems. The release didn't change |
| `71d9d42` | dx-gr-02 Sector-specific / Cross-sectoral: NA → Cross-sectoral, as_of 2026-11-06 from the sheet, `reason = ""`, no sources, in a new changeset, `changesets/2026-11-06/exchange/2026-11-06T073148Z-5aa8.toml`. Plus the rebuilt release. The sheet's "Cross-Sectoral" was normalised to "Cross-sectoral", a case-only difference (D55) |

The build had 0 blocking items (47 notes, as before), and `data:check` and `npm test` passed.

**DPI:** Greece's KED (dx-gr-02) now passes the DPI test: WIP (0) → DPI (1), and its Count for DPI is now 1. The DPI-like country counts don't change: Data exchange is still 103 → 101, Digital ID 70 → 80, Payment 102 → 110. Greece already counted, through dx-gr-01 (Govhub, DPI 1).

These are still left out: dx-bg-01 #7, dx-dk-01 #6, dx-pl-02 #1, the two pay-lac-02 rows, pay-lac-04 #2, and the Operator conflicts for pay-bf-02 #9 and pay-ci-01 #9.

## Last batch (Payments, 7 Nov)

This pass used a fresh download (`tweaks4.xlsx` in the scratchpad's `tweaks-in/`), on top of `7f1ba96`, and applied only the two new tabs, "Payments 6 Nov_new" and "Payments rationales 6 Nov_New". In this copy the old Payments tab is renamed "Payments (already reflected)". I ignored it and the other older tabs.

| Commit | What |
| --- | --- |
| `defc078` | Value changes: 8 rows as in-place revisions of this round's changes (6 files), plus the rebuilt release (only `2026-11-06-payment.json` changed) |
| `92c7858` | Rationale edits: 3 `reason` strings changed in place (2 files). The release didn't change |

The build had 0 blocking items (47 notes, as before) after each commit, and `data:check` and `npm test` passed.

### Value changes: 8 applied in place, 0 new changesets

Every row revises a cell that a change in `changesets/2026-11-06/payment/` already set, and only one change sets each cell. So, as Oli asked, each row's value, as_of, reason and sources replace that change's own, with no change on top.
- Every as_of moves later, from 2026-10-15 to the sheet's date. No other change in this round sets these cells, so no order between changes is affected. Each row's Last updated moves to the new date.
- No values needed normalising. No row repeats an earlier change exactly, and no row sets Private PSP.

| Changeset | Change | System | Field | Value | as_of | Reason | Sources |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-04T144142Z-fb20 | 19 | pay-cz-02 | reporting_forum | Yes → No | 2026-10-15 → 2026-11-06 | already the sheet's (from the first pass) | replaced: CNB instant payments page |
| 2026-11-04T144156Z-767c | 18 | pay-la-01 | reporting_forum | Yes → No | 2026-10-15 → 2026-11-06 | replaced (it was about interoperability) | replaced: Tilleke & Gibbins |
| 2026-11-04T144146Z-e142 | 4 → **17** | pay-gb-02 | interoperability_policy | Not Found → Yes | 2026-10-15 → 2026-11-06 | new | new: 2 Bank of England pages |
| 2026-11-04T144210Z-b5ec | 7 | pay-pl-02 | interoperability_policy | Not Found → Yes | 2026-10-15 → 2026-11-06 | already the sheet's | replaced: Worldline, Dudkowiak |
| 2026-11-04T144213Z-7f5b | 7 | pay-ro-02 | interoperability_policy | No → Yes | 2026-10-15 → 2026-11-06 | already the sheet's | replaced: SENT rules v28, Worldline |
| 2026-11-04T144142Z-fb20 | 7 | pay-cz-02 | interoperability_policy | No → Yes | 2026-10-15 → 2026-11-06 | already the sheet's | replaced: CNB news, Worldline |
| 2026-11-04T144156Z-767c | 7 | pay-la-01 | interoperability_policy | Not Found → Yes | 2026-10-15 → 2026-11-06 | replaced | the same (RegAlert) |
| 2026-11-04T144219Z-de22 | 8 | pay-vn-01 | transaction_types | P2P, P2M, B2P → P2P, P2M, B2B | 2026-10-15 → **2026-11-07** | replaced | the same (NAPAS) |

Notes:
- **pay-gb-02 is not a plain revision.** Change #4 of `e142` set both cross_border ("No") and interoperability_policy, with one reason ("Information not found for the corrected system…"). Rewriting its as_of, reason and sources would also have rewritten cross_border's evidence. So I took interoperability_policy out of #4 and left cross_border with its as_of and reason. The revision is a new change, #17, at the end of the same changeset, so changes #0–#16 keep their indices.
- **pay-vn-01's as_of is 2026-11-07**, as the sheet has it. That is the day after the release date, so pay-vn-01's Last updated is now 2026-11-07. The build doesn't object, but it should be checked.
- **pay-cz-02, pay-pl-02 and pay-ro-02:** in the first pass the rationale edits had already given these changes the reasons the sheet now gives (they argued for the new values). Only the value, as_of and sources change now.

### Rationale edits: 3 applied, 1 skipped

The new tab has no Changeset column, and its Change column is empty. I matched each row to the one change for its System ID and field whose `reason` is exactly the sheet's "Current rationale". Each match was unique. There was one version of each row, so there were no conflicts, and no edit said "Delete".

Applied:

| Changeset | Change | System | Field |
| --- | --- | --- | --- |
| 2026-11-04T144132Z-d6ba | 13 | pay-africa-02 | Settlement method (DNS): "Payments are cleared on PI-SPI and participants' net positions are settled at the BCEAO. Source: BCEAO." |
| 2026-11-04T144132Z-d6ba | 21 | pay-africa-02 | Cost of transactions: the Agence Ecofin text on the 2 November 2026 fee rules |
| 2026-11-04T144207Z-8027 | 3 | pay-pe-02 | Clearing infrastructure (Other): the RPP/Infobae text, without the "confirm with BCRP" note |

Skipped:

| Changeset | Change | System | Field | Why |
| --- | --- | --- | --- | --- |
| 2026-11-04T144219Z-de22 | 13 | pay-vn-01 | Number of participants | The change also sets Non-bank participation (Yes), and the old tabs list it as "Non-bank participation, Number of participants". The row names only Number of participants, and its new text ("NAPAS reports 68 member organisations…") would replace the current rationale for non-bank participation, "Payment intermediaries, e-wallets and mobile money". The team should confirm the text is meant for both fields, or give one for each |

### DPI status and counts

There are no changes in DPI status or in DPI-like country counts. Count for DPI is the same for all 6 systems that changed: pay-la-01, pay-vn-01, pay-cz-02, pay-pl-02 and pay-ro-02 stay at 1, and pay-gb-02 stays at 0. Payment is still 102 → 110, Data exchange 103 → 101, and Digital ID 70 → 80. The build report didn't change.

## Data exchange, 9 Nov

This pass used a fresh download (`tweaks5.xlsx` in the scratchpad's `tweaks-in/`), on top of `9cb48fb`. Only the yellow rows of the "Data exchange" tab were applied.

| Commit | What |
| --- | --- |
| `5faec8f` | The dx-be-01 Formal Mandate revision, split into its own change in changeset `a047`, plus the rebuilt release |
| `8e36440` | dx-be-01's Number of Transactions and Number of Members in a new changeset, `changesets/2026-11-06/exchange/2026-11-09T152735Z-9d76.toml`, plus the rebuilt release |

The build had 0 blocking items (47 notes, as before) after each commit, and `data:check` and `npm test` passed.

### Fills found

I read the fills in columns A–F with openpyxl:

| Fill | Rows | Which |
| --- | --- | --- |
| solid `FFE4E4E7` (light grey) | 1 | the header |
| none (`00000000`, no fill type) | 2 | rows 2–3, the old dx-gr-02 rows |
| solid `FFFFFF00` (pure yellow) | 6 | rows 4–9, all six cells of each |

There was only one yellow, it covered whole rows, and no empty row had a fill, so the reading wasn't ambiguous. The two old rows match the data: Status Implemented, and Cross-sectoral, which the sheet has as "Cross-Sectoral". I didn't re-apply them.

### The yellow rows: 3 applied, 3 skipped

Every yellow row is dated 2026-11-09. Each applied change is the only change for its cell in this round, so it still applies last, and as Oli decided I dated it 2026-11-06.

**In-place edit (split):**

| Changeset | Change | Field | Old → new |
| --- | --- | --- | --- |
| 2026-11-04T144636Z-a047 | 1 → **6** | dx-be-01 formal_mandate | Not Found → Yes. as_of 2026-10-15 → 2026-11-06 (the sheet says 2026-11-09). Reason "" → "Law provides authorisation to the federal services integrator". Sources: none → the 2012 ejustice.just.fgov.be law |

Change #1 also sets coordination_unit, impact_metrics and personal_data_protection, which keep #1's as_of and its empty reason. I removed formal_mandate from #1 and added the revision as a new change, #6, at the end of `a047`. Changes #0–#5 keep their indices.

**New changeset** (`2026-11-09T152735Z-9d76`), for cells this round hadn't changed:

| System | Field | Old → new | as_of | Reason |
| --- | --- | --- | --- | --- |
| dx-be-01 | number_of_transactions | NA → Not Found | 2026-11-06 (the sheet says 2026-11-09) | "Data not found" |
| dx-be-01 | number_of_members | NA → Not Found | 2026-11-06 (the sheet says 2026-11-09) | "Data not found" |

The sheet has "Not found". These fields are free text, so I normalised it to "Not Found", the D73 value, by case only (D55).

**Skipped:**

| Row | System | Field | New value | Why |
| --- | --- | --- | --- | --- |
| 4 | dx-ba-02 | Governing entity | Government of the Republic of Slovenia | The System ID looks wrong. dx-ba-02 is Bosnia and Herzegovina's Data Exchange System, but the value, the reason (Article 74a of the ZDU, Slovenia's Public Administration Act) and the source (iusinfo.si) are Slovenian. Slovenia's system is dx-si-02 (Tray/Pladenj), whose Governing entity is now "Ministry of Justice" and whose governing-entity rationale the team marked "Delete" earlier. Not applied to either system |
| 8 | dx-be-01 | Governing entity | "Delete" | The value is "Delete", with the reason "Coding mismatch in the change log". D72 defines "Delete" for rationales, not for values. One likely reading is to remove the value from this round's change, so the cell goes back to 2026-03-31's "Federal Public Service Policy and Support (BOSA)". The cell is now "Yes", set by `a047` #0 with the same 2012 law as the Formal Mandate row, which looks like the coding mismatch. But the row could also mean NA or an empty cell, so the team needs to confirm |
| 9 | dx-be-01 | Coordination unit | "Delete" | The same reason. The cell is now "Not Found", set by `a047` #1; on 2026-03-31 it was "Directorate-General Simplification and Digitalisation" |

### DPI status and counts

There are no changes in DPI status or DPI-like country counts. dx-be-01's Count for DPI stays 1. Data exchange is still 103 → 101, Payment 102 → 110, and Digital ID 70 → 80. The build report's only change is the number of exchange changesets (71 → 72).

Follow-up (Oli, 9 Nov):
- Rows 8–9, "Delete" on dx-be-01's Governing entity and Coordination unit: those fields are removed from changes #0 and #1 of `2026-11-04T144636Z-a047`, so both go back to their 2026-03-31 values (Federal Public Service Policy and Support (BOSA); Directorate-General Simplification and Digitalisation).
- Row 4, filed under dx-ba-02 but about Slovenia: applied to dx-si-02 by amending change #3 of `2026-11-04T144726Z-49e5` in place: Governing entity "Ministry of Justice" → "Government of the Republic of Slovenia", dated 2026-11-06 (the sheet's 2026-11-09 moved back to the release date; it's the only change to that cell this round), with the sheet's reason and source.
