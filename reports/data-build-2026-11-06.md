# Data build: the 2026-11-06 release

Built by `npm run data:build -- --release 2026-11-06` into `public/data/2026-11-06/`, from the 2026-03-31 release and the changesets in `changesets/2026-11-06/` and `changesets/next/`.

- exchange: 215 rows, from 70 changesets
- identity: 212 rows, from 33 changesets
- payment: 260 rows, from 300 changesets

0 blocking items, 47 not blocking.

| Kind | Blocks a merge | Items |
|---|---|---|
| Legacy warnings: values from the baseline that fail a check | no | 45 |
| Legacy fields: values for fields from an earlier release that are not in the package | no | 2 |

## DPI status changes since 2026-03-31

Every system whose DPI status (DPI, WIP or NA) or Count for DPI differs between the 2026-03-31 release and this build, by System ID. Both come from the DPI test in src/DpiTest.ts. The criteria are the DPI test's, plus the implementation status when it changed.

### Countries with a DPI-like system

The headline count on the home page: places that are countries, not regions, with at least one system that passes the DPI test.

| Type | 2026-03-31 | 2026-11-06 |
|---|---|---|
| Data exchange | 103 | 101 |
| Digital ID | 70 | 80 |
| Payment | 102 | 110 |

### Systems whose status changed: 32

| System ID | Name | Was | Now | What changed |
|---|---|---|---|---|
| id-ci-01 | National Registry of Natural Persons (RNPP) + CI Identité app | WIP (0) | DPI (1) | Used across 2+ sectors: No → Yes |
| id-dj-01 | Djibouti Mobile ID | WIP (0) | DPI (1) | Active: No → Yes; Digital authentication: NA → Yes; Used across 2+ sectors: No → Yes; Status: Pilot → Active |
| id-la-01 | LAeID | NA (0) | WIP (0) | Active: NA → Yes; Claims a digital ID: No → Yes; Used across 2+ sectors: No → Yes; Status: NA → Active |
| id-cu-01 | Identidad Digital | NA (0) | WIP (0) | Active: NA → No; Claims a digital ID: No → Yes; Status: NA → Pilot |
| id-jm-01 | National identity (NIDS) | WIP (0) | DPI (1) | Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active |
| id-ad-01 | Electronic certificate | WIP (0) | DPI (1) | Used across 2+ sectors: NA → Yes |
| id-hu-01 | Digitális Állampolgár (DÁP) mobile application | WIP (0) | DPI (1) | Active: No → Yes; Digital authentication: NA → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active |
| id-bz-01 | National Digital ID | WIP (0) | NA (0) | Active: No → NA; Claims a digital ID: No → Yes; Used across 2+ sectors: No → NA; Status: Pilot → NA |
| id-hn-01 | National Digital ID System / Bien | WIP (0) | DPI (1) | Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active |
| id-am-01 | EsEm | WIP (0) | DPI (1) | Used across 2+ sectors: NA → Yes |
| id-bh-01 | eKey 2.0 | WIP (0) | DPI (1) | Digital authentication: NA → Yes; Used across 2+ sectors: NA → Yes |
| id-cy-01 | Cypriot National eID (IDMe.cy) / eID card | WIP (0) | DPI (1) | Active: No → Yes; Used across 2+ sectors: NA → Yes; Status: Pilot → Active |
| id-kw-01 | Kuwait Mobile ID | NA (0) | DPI (1) | Active: NA → Yes; Status: NA → Active |
| pay-africa-02 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | WIP (0) | DPI (1) | Active: No → Yes; Status: Pilot → Active |
| pay-bj-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | WIP (0) | DPI (1) | Active: No → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: Pilot → Active |
| pay-cv-01 | STII (Sistema de Transferências Imediatas e Inclusivas) | NA (0) | WIP (0) | Active: NA → No; Operated by the central bank: NA → Yes; Status: NA → Pilot |
| pay-ci-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-gw-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-ml-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-ne-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-sn-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-tg-01 | PI-SPI (Plateforme Interopérable du Système de Paiement Instantané) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-id-01 | BI-FAST | WIP (0) | DPI (1) | Operated by the central bank: NA → Yes |
| pay-la-01 | LMPS (LAPNet mobile interbank payment system) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-vn-01 | NAPAS 247 (NAPAS FastFund 247) | NA (0) | DPI (1) | Active: NA → Yes; Real-time payments: No → Yes; Operated by the central bank: NA → Yes; Status: NA → Active |
| pay-ag-01 | D-Cash (CBDC) | WIP (0) | NA (0) | Status: Pilot → Suspended |
| pay-bb-01 | BimPay | WIP (0) | DPI (1) | Active: No → Yes; Status: Pilot → Active |
| pay-lac-01 | DCash 2.0 | WIP (0) | NA (0) | Status: Pilot → Suspended |
| pay-kn-01 | D-Cash (CBDC) | WIP (0) | NA (0) | Real-time payments: Yes → No; Status: Pilot → Suspended |
| pay-is-01 | TIPS (Target Instant Payment Settlement) | DPI (1) | WIP (0) | Active: Yes → No; Real-time payments: Yes → No; Status: Active → Pilot |
| pay-no-01 | TIPS (Target Instant Payment Settlement) | DPI (1) | WIP (0) | Active: Yes → No; Real-time payments: Yes → No; Status: Active → Pilot |
| pay-pe-02 | BCRP digital money (CBDC pilot via BiPay) | DPI (1) | WIP (0) | Active: Yes → No; Status: Active → Pilot |

### New systems: 28

- dx-at-02, dadeX: DPI (1)
- dx-be-02, CrossRoads Bank of Social Security (KSZ): DPI (1)
- dx-ba-02, Data Exchange System: DPI (1)
- dx-fr-02, State Exchange Hub (HubEE): DPI (1)
- dx-de-02, National Once Only Technical System: WIP (0)
- dx-gr-02, Interoperability Centre (KED): DPI (1)
- dx-ie-02, Information Mediator: WIP (0)
- dx-lu-02, API Gateway Portal: DPI (1)
- dx-nl-02, Digital Link (Digikoppelling): DPI (1)
- dx-pl-02, System of State Registers: DPI (1)
- dx-sk-02, The Common Module for Data and Process Integration: DPI (1)
- dx-si-02, Tray (Pladenj): DPI (1)
- dx-se-02, Secure Digital Communication: DPI (1)
- dx-ch-02, Sedex: DPI (1)
- dx-il-02, Data Avenue: DPI (1)
- dx-kw-02, Apigee: DPI (1)
- dx-tr-02, eGovernment Gateway: DPI (1)
- pay-bf-02, PI-SPI (Plateforme Interopérable du Système de Paiement Instantané): DPI (1)
- pay-cz-02, CERTIS Instant Payments (Okamžité platby): DPI (1)
- pay-hu-02, AFR (Azonnali Fizetési Rendszer, GIRO Instant): DPI (1)
- pay-li-02, SIC IP (Instant Payments service of the SIC system): DPI (1)
- pay-pl-02, Express Elixir: DPI (1)
- pay-ro-02, Plăți Instant: DPI (1)
- pay-ua-02, SEP instant credit transfers (System of Electronic Payments of the NBU): DPI (1)
- pay-gb-02, Faster Payments: WIP (0)
- pay-lac-04, CAPSS (CARICOM Payment and Settlement System): WIP (0)
- pay-py-02, SPI (Sistema de Pagos Instantáneos): NA (0)
- pay-pe-03, Transferencias Inmediatas (CCE): WIP (0)

### Removed systems: 25

- dx-at-01, Electronic File System ELAK: was DPI (1)
- dx-ba-01, National Interoperability Framework: was DPI (1)
- dx-fr-01, Interministerial Network of the State (Réseau Interministériel de l’État, RIE): was DPI (1)
- dx-de-01, Federal Information Management (FIM): was DPI (1)
- dx-ie-01, Build To Share: was DPI (1)
- dx-lu-01, National Platform for Data Exchange (Plateforme nationale d’échange de données, PNED): was DPI (1)
- dx-nl-01, Diginetwerk: was DPI (1)
- dx-pl-01, EZD-RP: was DPI (1)
- dx-sk-01, GovNet: was DPI (1)
- dx-si-01, National Interoperability Framework (NIO): was DPI (1)
- dx-se-01, Ena: was DPI (1)
- dx-ch-01, I14Y Interoperability Platform , Sedex: was DPI (1)
- dx-il-01, SAAR: was DPI (1)
- dx-kw-01, Morasalat Online: was DPI (1)
- dx-tr-01, KAYSIS: was DPI (1)
- pay-lac-03, DCash 2.0: was WIP (0)
- pay-cz-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-hu-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-li-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-pl-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-ro-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-ua-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-gb-01, TIPS (Target Instant Payment Settlement): was DPI (1)
- pay-co-01, Transfiya: was WIP (0)
- pay-pe-01, Mobile money: was WIP (0)

## Legacy warnings by field

45 values from the baseline fail a check. They don't block a merge (D60), and each release reports how many are left.

| Table | Field | Values |
|---|---|---|
| identity | `legal_redress` | 28 |
| payment | `operator` | 11 |
| exchange | `ownership` | 4 |
| payment | `system_type` | 2 |

## Legacy warnings: values from the baseline that fail a check

- identity, 2026-03-31 change 0, id-ls-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-sc-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-so-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-tg-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-th-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-th-02, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-cu-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-jm-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-ad-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-at-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-ba-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-bg-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-fi-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-de-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-gr-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-hu-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-lv-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-lt-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-lu-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-mk-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-md-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-me-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-es-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-se-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-gy-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-nz-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-ws-01, `legal_redress`: "Legally established mechanism" is not an allowed value
- identity, 2026-03-31 change 0, id-to-01, `legal_redress`: "Yes" is not an allowed value
- payment, 2026-03-31 change 0, pay-ng-02, `operator`: "Central bank/Other" is not an allowed value
- payment, 2026-03-31 change 0, pay-mn-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-cw-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-do-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-pr-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-tt-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-bz-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-gy-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-iq-01, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-om-01, `system_type`: "Interbank payment system, Mobile wallet" is not an allowed value
- payment, 2026-03-31 change 0, pay-om-02, `system_type`: "Interbank payment system, Mobile wallet" is not an allowed value
- payment, 2026-03-31 change 0, pay-om-02, `operator`: "Private PSP" is not an allowed value
- payment, 2026-03-31 change 0, pay-sy-01, `operator`: "Private PSP" is not an allowed value
- exchange, 2026-03-31 change 0, dx-bb-01, `ownership`: "Public, Private" is not an allowed value
- exchange, 2026-03-31 change 0, dx-li-01, `ownership`: "Public, Private" is not an allowed value
- exchange, 2026-03-31 change 0, dx-mx-01, `ownership`: "Public, Private" is not an allowed value
- exchange, 2026-03-31 change 0, dx-pa-01, `ownership`: "Public, Private" is not an allowed value

## Legacy fields: values for fields from an earlier release that are not in the package

| Table | Field | Values | Changesets | Last in |
|---|---|---|---|---|
| exchange | `Semantic interoperability` | 213 | 0 | 2026-03-31 |
| payment | `Type of settlement system` | 259 | 0 | 2026-03-31 |

## scripts/validate.mjs on the release

Its failures are listed above, as values that fail a check or as legacy warnings, each with the changeset that introduced the value.

```
Summary

package: /Users/oli/Code/olizilla/digital-public-infra-map/.claude/worktrees/ucl-iipp-project-review-a8f0bf/public/data/2026-11-06/datapackage.json, with 5 resources, OK

identity: 212 rows, 28 errors, 1 warning
  "Legally binding redress mechanism ": 28 (allowed: Customer service mechanism, Legally binding mechanism, Both, Not Found)
    27	"Legally established mechanism"
    1	"Yes"

payment: 260 rows, 13 errors
  "Operator": 11 (allowed: Central bank, Commercial bank/Private PSP, Bank association, Bank association/Central bank, Other, Not Found)
    10	"Private PSP"
    1	"Central bank/Other"
  "Payment system type": 2 (allowed: Cross-domain, Interbank, Mobile money, Mobile money system, CBDC, Card Payment, Not Found)
    2	"Interbank payment system, Mobile wallet"

exchange: 215 rows, 4 errors
  "Ownership": 4 (allowed: Public, Private, Joint, Not Found)
    4	"Public, Private"

places: 258 rows, 0 errors

place_names: 23 rows, 0 errors

45 errors, 1 warning
```
