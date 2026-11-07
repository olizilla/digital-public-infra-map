# The 6 Nov 2026 release: what changed

A summary of the changes since the 2026-03-31 release, for the research team to check. Everything here comes from the change log (the changesets) and the release build, `public/data/2026-11-06/`. Built on 2026-11-03 from the proposal sheet exported at 18:13 UTC.

Words used below:

- **DPI**: the system passes the DPI test, so its Count for DPI is 1.
- **WIP**: it's live or a pilot, but doesn't pass the test yet (Count 0).
- **NA**: not enough data, or suspended (Count 0).
- **Sheets**: a change from the proposal sheets.
- **Wording**: a change that only puts a value into the agreed wording (D54, D55), like "Central Bank" to "Central bank".

## 1. Headline numbers

Countries with at least one DPI-like system. Regions don't count.

| Type | 31 Mar | 6 Nov |
|---|--:|--:|
| Digital ID | 70 | 80 |
| Payment | 102 | 110 |
| Data exchange | 103 | 101 |

- **Digital ID, +10:** Andorra, Armenia, Bahrain, Cyprus, Côte d’Ivoire, Djibouti, Honduras, Hungary, Jamaica and Kuwait.
- **Payment, +12:** Barbados, Benin, Burkina Faso, Côte d’Ivoire, Guinea-Bissau, Indonesia, Laos, Mali, Niger, Senegal, Togo and Vietnam.
- **Payment, −4:** Iceland and Norway (TIPS is now a pilot there), Peru (its CBDC is a pilot, and the new CCE transfers aren't DPI-like yet) and the United Kingdom (TIPS removed; Faster Payments is WIP).
- **Data exchange, −2:** Germany and Ireland. Each old system was replaced by one that is still WIP.

In all: 28 new systems, 25 removed, 23 renamed, 12 named for the first time, and 32 with a new DPI status.

## 2. New systems (28)

No new Digital ID systems: every Digital ID change this round updates an existing system (D63).

### Payment (11)

- **pay-bf-02**, Burkina Faso: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-cz-02**, Czech Republic: CERTIS Instant Payments (Okamžité platby)
- **pay-hu-02**, Hungary: AFR (Azonnali Fizetési Rendszer, GIRO Instant)
- **pay-li-02**, Liechtenstein: SIC IP (Instant Payments service of the SIC system)
- **pay-pl-02**, Poland: Express Elixir
- **pay-ro-02**, Romania: Plăți Instant
- **pay-ua-02**, Ukraine: SEP instant credit transfers (System of Electronic Payments of the NBU)
- **pay-gb-02**, United Kingdom of Great Britain and Northern Ireland: Faster Payments
- **pay-lac-04**, Latin America and the Caribbean: CAPSS (CARICOM Payment and Settlement System)
- **pay-py-02**, Paraguay: SPI (Sistema de Pagos Instantáneos)
- **pay-pe-03**, Peru: Transferencias Inmediatas (CCE)

### Data exchange (17)

- **dx-at-02**, Austria: dadeX
- **dx-be-02**, Belgium: CrossRoads Bank of Social Security (KSZ)
- **dx-ba-02**, Bosnia and Herzegovina: Data Exchange System
- **dx-fr-02**, France: State Exchange Hub (HubEE)
- **dx-de-02**, Germany: National Once Only Technical System
- **dx-gr-02**, Greece: Interoperability Centre (KED)
- **dx-ie-02**, Ireland: Information Mediator
- **dx-lu-02**, Luxembourg: API Gateway Portal
- **dx-nl-02**, Netherlands: Digital Link (Digikoppelling)
- **dx-pl-02**, Poland: System of State Registers
- **dx-sk-02**, Slovakia: The Common Module for Data and Process Integration
- **dx-si-02**, Slovenia: Tray (Pladenj)
- **dx-se-02**, Sweden: Secure Digital Communication
- **dx-ch-02**, Switzerland: Sedex
- **dx-il-02**, Israel: Data Avenue
- **dx-kw-02**, Kuwait: Apigee
- **dx-tr-02**, Turkey: eGovernment Gateway

## 3. Removed systems (25)

A removed system's page now redirects to its country page.

### Payment (10)

Replaced. The sheet's reason for each is "Not part of TIPS. Only Euro, Danish Krone, and Swedish Krona covered." Each country's own instant payment system is added as a new system.

- **pay-cz-01**, Czech Republic: TIPS. Replaced by pay-cz-02, CERTIS Instant Payments (Okamžité platby).
- **pay-hu-01**, Hungary: TIPS. Replaced by pay-hu-02, AFR (Azonnali Fizetési Rendszer, GIRO Instant).
- **pay-li-01**, Liechtenstein: TIPS. Replaced by pay-li-02, SIC IP (Instant Payments service of the SIC system).
- **pay-pl-01**, Poland: TIPS. Replaced by pay-pl-02, Express Elixir.
- **pay-ro-01**, Romania: TIPS. Replaced by pay-ro-02, Plăți Instant.
- **pay-ua-01**, Ukraine: TIPS. Replaced by pay-ua-02, SEP instant credit transfers (System of Electronic Payments of the NBU).
- **pay-gb-01**, United Kingdom of Great Britain and Northern Ireland: TIPS. Replaced by pay-gb-02, Faster Payments.

Duplicate:

- **pay-lac-03**, Eastern Caribbean: DCash 2.0. A duplicate of pay-lac-01. "DCash 2.0 formally suspended by ECCB Monetary Council (communique 4 May 2026)".

Deleted:

- **pay-co-01**, Colombia: Transfiya. It stopped operating as a standalone service on 6 October 2025, and Colombia's instant payments are recorded under Bre-B.
- **pay-pe-01**, Peru: Mobile money. A placeholder pointing to the Bim wallet, which isn't a national real-time payment system. Peru's real-time payments are now pay-pe-03.

### Data exchange (15)

All replaced by a new system in the same country. The sheet's reason is "Delete row and associated fields", and the rows that follow add the new system. Sweden's is our own changeset, from the team's decision (D63).

- **dx-at-01**, Austria: Electronic File System ELAK. Replaced by dx-at-02, dadeX.
- **dx-ba-01**, Bosnia and Herzegovina: National Interoperability Framework. Replaced by dx-ba-02, Data Exchange System.
- **dx-fr-01**, France: Interministerial Network of the State (Réseau Interministériel de l’État, RIE). Replaced by dx-fr-02, State Exchange Hub (HubEE).
- **dx-de-01**, Germany: Federal Information Management (FIM). Replaced by dx-de-02, National Once Only Technical System.
- **dx-ie-01**, Ireland: Build To Share. Replaced by dx-ie-02, Information Mediator.
- **dx-lu-01**, Luxembourg: National Platform for Data Exchange (Plateforme nationale d’échange de données, PNED). Replaced by dx-lu-02, API Gateway Portal.
- **dx-nl-01**, Netherlands: Diginetwerk. Replaced by dx-nl-02, Digital Link (Digikoppelling).
- **dx-pl-01**, Poland: EZD-RP. Replaced by dx-pl-02, System of State Registers.
- **dx-sk-01**, Slovakia: GovNet. Replaced by dx-sk-02, The Common Module for Data and Process Integration.
- **dx-si-01**, Slovenia: National Interoperability Framework (NIO). Replaced by dx-si-02, Tray (Pladenj).
- **dx-se-01**, Sweden: Ena. Replaced by dx-se-02, Secure Digital Communication.
- **dx-ch-01**, Switzerland: I14Y Interoperability Platform , Sedex. Replaced by dx-ch-02, Sedex.
- **dx-il-01**, Israel: SAAR. Replaced by dx-il-02, Data Avenue.
- **dx-kw-01**, Kuwait: Morasalat Online. Replaced by dx-kw-02, Apigee.
- **dx-tr-01**, Turkey: KAYSIS. Replaced by dx-tr-02, eGovernment Gateway.

## 4. Renamed systems

Each keeps its System ID (D9, D63).

### Digital ID (15)

- **id-cv-01**, Cabo Verde: Sistema Nacional de Identifticação e Autenticação Civil → **Chave Móvel Digital de Cabo Verde (CMD-CV)**
- **id-ci-01**, Côte d’Ivoire: National Registry of Natural Persons (RNPP) → **National Registry of Natural Persons (RNPP) + CI Identité app**
- **id-dj-01**, Djibouti: eID → **Djibouti Mobile ID**
- **id-af-01**, Afghanistan: National digital identity → **Electronic National Identity Card (e-Tazkira)**
- **id-la-01**, Laos: National digital identity → **LAeID**
- **id-cu-01**, Cuba: Carné de identidad → **Identidad Digital**
- **id-hu-01**, Hungary: Digital Citizenship (DÁP) → **Digitális Állampolgár (DÁP) mobile application**
- **id-xk-01**, Kosovo: Electronic ID system → **eID Kosova (Kosova e-Wallet)**
- **id-cl-01**, Chile: RUN (Rol Único Nacional)/ RUT (Rol Único Tributario)/ ClaveÚnica → **ClaveÚnica + Cédula de identidad**
- **id-hn-01**, Honduras: National Identification System → **National Digital ID System / Bien**
- **id-az-01**, Azerbaijan: Digital Login / Asan Imza → **mygov ID / Asan Imza**
- **id-bh-01**, Bahrain: Smart ID → **eKey 2.0**
- **id-cy-01**, Cyprus: Cypriot National eID → **Cypriot National eID (IDMe.cy) / eID card**
- **id-kw-01**, Kuwait: Hawyti → **Kuwait Mobile ID**
- **id-au-01**, Australia: myGovID / Trust Exchange (TEx) → **myID**

### Payment (5)

- **pay-africa-02**, Africa: BCEAO Regional Payment Systems Project → **PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)**
- **pay-dz-01**, Algeria: Switch mobile → **DZMobPay (GIE Monétique)**
- **pay-bj-01**, Benin: Domestic IPS → **PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)**
- **pay-ch-01**, Switzerland: SIC5 → **SIC IP (Instant Payments service of the SIC system)**
- **pay-pe-02**, Peru: CBDC → **BCRP digital money (CBDC pilot via BiPay)**

### Data exchange (3)

- **dx-by-01**, Belarus: Belarusian Integrated Service-Settlement System (Белорусская интегрир… → **National Automated Information System (OAIS)**
- **dx-cz-01**, Czech Republic: eGovernment Service Bus → **Shared Service Information System (ISSS)**
- **dx-cy-01**, Cyprus: Government Gateway Ariadni → **CY Connect**

### Named for the first time (12)

These had no name before (NA).

- **id-bf-01**, Burkina Faso: National biometric ID / Unique Identification Number (WURI)
- **id-bi-01**, Burundi: Biometric National ID
- **id-bz-01**, Belize: National Digital ID
- **pay-cv-01**, Cabo Verde: STII (Sistema de Transferências Imediatas e Inclusivas)
- **pay-ci-01**, Côte d’Ivoire: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-gw-01**, Guinea-Bissau: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-ml-01**, Mali: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-ne-01**, Niger: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-sn-01**, Senegal: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-tg-01**, Togo: PI-SPI (Plateforme Interopérable du Système de Paiement Instantané)
- **pay-la-01**, Laos: LMPS (LAPNet mobile interbank payment system)
- **pay-vn-01**, Vietnam: NAPAS 247 (NAPAS FastFund 247)

## 5. DPI status changes (32)

Each system whose DPI status or Count for DPI changed, then what changed in the DPI test. New and removed systems are in sections 2 and 3. No data exchange system that was already in the map changed status.

### Digital ID (13)

- **id-ci-01**, Côte d’Ivoire: WIP → **DPI**. Used across 2+ sectors: No → Yes.
- **id-dj-01**, Djibouti: WIP → **DPI**. Active: No → Yes; Digital authentication: NA → Yes; Used across 2+ sectors: No → Yes; Status: Pilot → Active.
- **id-la-01**, Laos: NA → **WIP**. Active: NA → Yes; Claims a digital ID: No → Yes; Used across 2+ sectors: No → Yes; Status: NA → Active.
- **id-cu-01**, Cuba: NA → **WIP**. Active: NA → No; Claims a digital ID: No → Yes; Status: NA → Pilot.
- **id-jm-01**, Jamaica: WIP → **DPI**. Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active.
- **id-ad-01**, Andorra: WIP → **DPI**. Used across 2+ sectors: NA → Yes.
- **id-hu-01**, Hungary: WIP → **DPI**. Active: No → Yes; Digital authentication: NA → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active.
- **id-bz-01**, Belize: WIP → **NA**. Active: No → NA; Claims a digital ID: No → Yes; Used across 2+ sectors: No → NA; Status: Pilot → NA.
- **id-hn-01**, Honduras: WIP → **DPI**. Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active.
- **id-am-01**, Armenia: WIP → **DPI**. Used across 2+ sectors: NA → Yes.
- **id-bh-01**, Bahrain: WIP → **DPI**. Digital authentication: NA → Yes; Used across 2+ sectors: NA → Yes.
- **id-cy-01**, Cyprus: WIP → **DPI**. Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active.
- **id-kw-01**, Kuwait: NA → **DPI**. Active: NA → Yes; Status: NA → Active.

### Payment (19)

- **pay-africa-02**, Africa: WIP → **DPI**. Active: No → Yes; Status: Pilot → Active.
- **pay-bj-01**, Benin: WIP → **DPI**. Active: No → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: Pilot → Active.
- **pay-cv-01**, Cabo Verde: NA → **WIP**. Active: NA → No; Operated by the central bank: NA → Yes; Status: NA → Pilot.
- **pay-ci-01**, Côte d’Ivoire: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-gw-01**, Guinea-Bissau: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-ml-01**, Mali: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-ne-01**, Niger: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-sn-01**, Senegal: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-tg-01**, Togo: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-id-01**, Indonesia: WIP → **DPI**. Operated by the central bank: NA → Yes.
- **pay-la-01**, Laos: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-vn-01**, Vietnam: NA → **DPI**. Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active.
- **pay-ag-01**, Antigua and Barbuda: WIP → **NA**. Status: Pilot → Suspended.
- **pay-bb-01**, Barbados: WIP → **DPI**. Active: No → Yes; Status: Pilot → Active.
- **pay-lac-01**, Latin America and the Caribbean: WIP → **NA**. Status: Pilot → Suspended.
- **pay-kn-01**, Saint Kitts and Nevis: WIP → **NA**. Real-time payments: Yes → No; Status: Pilot → Suspended.
- **pay-is-01**, Iceland: DPI → **WIP**. Active: Yes → No; Status: Active → Pilot.
- **pay-no-01**, Norway: DPI → **WIP**. Active: Yes → No; Status: Active → Pilot.
- **pay-pe-02**, Peru: DPI → **WIP**. Active: Yes → No; Status: Active → Pilot.

## 6. Value changes by field

Cells whose value differs from 31 March, on systems that were already in the map. New systems aren't counted here.

### Digital ID

From the sheets: 117 cells.

| Field | Cells |
|---|--:|
| Digital ID Name | 18 |
| Governing entity | 15 |
| Two or more sectoral use cases enabled | 14 |
| URL | 12 |
| Status of Implementation | 11 |
| Authentication through government portal | 9 |
| Technical Support organizations identified | 9 |
| Funding organizations identified | 6 |
| Collects or uses biometric data | 5 |
| Regulation for digital ID | 5 |
| Claim of digital ID | 4 |
| Digital authentication function | 4 |
| Codified digital ID legal status | 2 |
| Enables KYC packet collection | 1 |
| Legally binding redress mechanism | 1 |
| Procedural rules for digital ID enrolment | 1 |

Wording: 1 cell.

- URL: 1

### Payment

From the sheets: 289 cells.

| Field | Cells |
|---|--:|
| Payment system type | 36 |
| Status of payment system implementation | 23 |
| Active-real time payment system present | 15 |
| Number of participants | 15 |
| Cost of transactions | 14 |
| Operator | 14 |
| Payment system name | 14 |
| Annual volume of transactions | 13 |
| QR code based transactions | 13 |
| Reporting forum | 13 |
| URL | 13 |
| Annual value of transactions (USD) | 12 |
| Bank participation | 12 |
| Data-handing rules for payment system | 12 |
| Non-bank participation | 12 |
| Types of transactions supported | 12 |
| Cross-border payments | 11 |
| Interoperability policy | 11 |
| Participation conditions and rules | 11 |
| National / Regional | 7 |
| AML Law | 6 |

New fields, filled in from the sheets:

| Field | Cells |
|---|--:|
| Clearing infrastructure | 95 |
| Settlement method | 67 |

Wording: 313 cells.

- Payment system type: 149
- Operator: 131
- Types of transactions supported: 32
- URL: 1

Our own changesets: 4 Country / Region cells now use the UN M49 region names (for example "Caribbean" to "Latin America and the Caribbean"), and Saint Kitts and Nevis is spelled right.

### Data exchange

From the sheets: 85 cells.

| Field | Cells |
|---|--:|
| Permitted participants | 21 |
| Audit mechanism | 9 |
| Base technical architecture | 9 |
| Enrolment and participation information | 8 |
| Impact metrics | 8 |
| Procedural rules for data mgmt. | 6 |
| Coordination unit | 5 |
| URL | 5 |
| Real-time sharing | 4 |
| Data exchange system name | 3 |
| Governing entity | 3 |
| Scalable technology architecture | 3 |
| Ownership | 1 |

New fields, filled in from the sheets:

| Field | Cells |
|---|--:|
| Formal Mandate | 35 |
| Independent Audit | 34 |
| Number of Members | 34 |
| Number of Transactions | 34 |
| Once-Only Principle | 35 |
| Personal Data Protection | 34 |
| Semantic interoperability | 35 |


Our own changesets: 1 Country / Region cell, "European Union" to "Europe".

Notes on the wording changes:

- Operator (131): "Central Bank" to "Central bank" (116), "Commercial bank/ Private PSP" to "Commercial bank/Private PSP" (11), "Central bank/ Bank association" to "Bank association/Central bank" (3), and Bhutan's "Central bank, Private PSP" to "Central bank", which the team confirmed.
- Payment system type (149): "Interbank payment system" and "Cross-domain payment system" to "Interbank" and "Cross-domain", and one "Mobile money" to "Mobile money system".
- Types of transactions supported (32): P2G becomes Other, P2B becomes P2M, and lists use ", " between values.
- URL (2): a trimmed space, and State of Palestine's Digital ID URL "sa/sso", which isn't a URL, is now NA.

## 7. Codebook changes

Fields added:

- Payment: Clearing infrastructure, and Settlement method.
- Data exchange: Semantic interoperability (a new field, with Syntactic and Semantic), Formal Mandate, Once-Only Principle, Personal Data Protection, Independent Audit, Number of Transactions, and Number of Members.

Fields removed (their old values stay in the log):

- Payment: Type of settlement system, replaced by Clearing infrastructure and Settlement method.
- Data exchange: the old Yes/No Semantic interoperability. The new field has the same title but a new meaning, so the old values aren't carried over.

Values added:

- Not Found ("we looked and found nothing") on every researched field with a list of values, and on URLs (D37, D61).
- Suspended, for the status of all three types.
- Mobile money system, for Payment system type. Mobile money stays allowed.
- Private PSP, for Operator.
- NA now has a meaning: "Not yet researched, or it can't exist yet."

Definitions rewritten, from the Codebook _ Proposals tab. No values change:

- Payment system type: Interbank and Cross-domain.
- Operator: Bank association, and Commercial bank/Private PSP.
- QR code based transactions, and Reporting forum, with what Yes and No mean.
- Number of participants, Annual value of transactions (USD), and Annual volume of transactions.
- Sector-specific / Cross-sectoral.
- Country / Region: the six UN M49 groups for regional systems.

The Digital ID Governing entity definition was cut off mid-word in the old codebook ("…reports, poli"). Neither the tab nor the old codebook has the rest, so the sentence now ends after "governmental reports".

## 8. Still to do next round

### Legacy warnings (35)

Values already published that the codebook doesn't allow. They don't block this release (D60).

| Field | Cells |
|---|--:|
| Digital ID, Legally binding redress mechanism | 28 |
| Data exchange, Ownership | 4 |
| Payment, Payment system type | 2 |
| Payment, Operator | 1 |

- Redress mechanism: 27 say "Legally established mechanism", where the codebook says "Legally binding mechanism", and Tonga (id-to-01) says "Yes".
- Ownership: "Public, Private" in Barbados, Liechtenstein, Mexico and Panama. It's a single-value field, and the codebook has Joint.
- Payment system type: Oman's two systems say "Interbank payment system, Mobile wallet", a list in a single-value field.
- Operator: Nigeria (pay-ng-02) says "Central bank/Other".

### Values left out of this import (4)

The sheets set these, but the codebook doesn't allow them, so the published value stays:

- Belize (id-bz-01): "Planned/Piloted" for Codified digital ID legal status, and for Regulation for digital ID. Both are Yes or No fields.
- Oman (pay-om-01 and pay-om-02): "Interbank payment system, Mobile money system" for Payment system type, which takes one value.

### Also for the team

- 202 cells are set to NA where the rationale says something like "not found", and 6 the other way round. They're imported as written: see `reports/import-proposals-na-not-found.csv`.
- 632 imported rows have a blank rationale, so their history shows no reason.

## 9. How to check a system

Each system has a page at `/<system-id>/`, for example dpimap.org/pay-bj-01/. It shows:

- the DPI test, and why the system passes or not;
- every field, grouped by attribute. Open a field to see what it means, its evidence links, and its history: every value it has had, newest first, with the date and the reason;
- the change log for the whole system.

A removed system's page redirects to its country page. To check a cell against the sheet, `reports/import-proposals-changesets.csv` lists the sheet rows behind each changeset.
