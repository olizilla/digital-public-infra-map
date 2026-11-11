---
layout: ../../layouts/Post.astro
title: "Payments: What's new?"
date: 2026-11-09
---

Over the past few months, we reviewed the full payments codebook and then took a deeper look at real-time payment systems in 38 countries to see how well the DPI Map captures them. Some of what we found led to changes in our codebook. Some raised questions we haven't settled yet. Together, these findings are a reminder that our definitions are never finished. Each round of work pushes us to revisit and question what we count as DPI, which is also why we describe systems as DPI-like rather than DPI. 

To start, here is what changed this round in numbers: 

* **Systems reviewed:** 38  
* **DPI-like count:** 12 added and 4 removed, a net gain of 8. Additions include PI-SPI, BIMPay (Barbados), BI-FAST (Indonesia), NAPAS (Vietnam) and LAPNet (Laos).  
* **New systems:** 11 added to the dataset, 6 of them replacing incorrect TIPS entries.   
* **First suspension:** DCash 2.0  
* **Codebook tweaks:** Definitions for 7 fields updated, including number of participants, annual value of transactions, annual volume of transactions, payment system type, operator, QR code based transactions, and reporting forum.   
* **Codebook additions:** "Type of settlement system" replaced by two fields - “Clearing infrastructure” and “Settlement method”. 

These data points show what moved. However, the more interesting part is the questions they raised about how we measure. Here are five things we learned, starting with the newest addition to the payments codebook. 

## 1. Instant for the user, not for the underlying system

When your money lands in seconds, that's the real-time part. Behind the scenes, banks may not settle with each other until hours later, and how they get there varies a lot by country.

Our old "Type of settlement system" field squeezed all of this into one code. In our previous release 102 of the 136 systems with a value were coded simply “RTGS”. But almost every payment system eventually settles through the central bank’s RTGS, therefore, the label told you little about how the instant system itself works. So we split it into two.

* **Clearing infrastructure** tells you who does the work the moment a transaction happens: the central bank's own system (RTGS), a clearing house (ACH) or a scheme operator's hub (Switch).  
* **Settlement method** tells you how and when banks square up with one another: each payment on its own (Gross), netted every few seconds (Hybrid) or netted at set times (DNS). The more netting and the longer the wait, the more risk banks carry to each other in between.

Here's how four well-known systems looked in our Q1 2026 data, and how they look now.

| System | Q1: Type of settlement system | Now: Clearing infrastructure | Now: Settlement method | What it tells us |
| :---- | :---- | :---- | :---- | :---- |
| Pix (Brazil) | RTGS | RTGS | Gross | Run end-to-end by the central bank. Every payment is final instantly. |
| Raast (Pakistan) | RTGS | Switch | DNS | Owned by the central bank, but a switch that settles later. Ownership and design are separate choices. |
| CoDi on SPEI (Mexico) | Multilateral Netting (MN) | RTGS | Hybrid | Run by the central bank, netting every few seconds. Close to Pix on risk. |
| UPI (India) | Not coded | Switch | DNS | A bank-owned switch, with banks settling in batches through the day. |

Under the old field, Pix and Raast looked identical, UPI had no code at all, and CoDi carried a netting label that fits almost every system. Now each one tells a different story about who runs the rail and how much risk sits between banks.

This release has a clearing value for 104 systems and a settlement method for 74; every system with a settlement method also has a clearing value. Settlement method has fewer values because we only record it when a source states how payments are settled. Most of the remaining systems have not yet been coded under the new fields and will be reviewed in the next release.

## 2. Public ownership is not a binary

Payment rails are public infrastructure, so we think public ownership or public governance should sit at their core. The harder question is whether we're drawing that line in the right place. 

Today, a real-time payment system counts as DPI-like on the Map if it is live and the central bank owns or operates it, even through a minority stake. That produces a surprising result. India’s UPI, arguably the best-known DPI payment system in the world, doesn’t pass. It’s run by NPCI, a company owned mainly by banks, in which the RBI holds no shares. Pakistan’s Raast does pass, because the central bank owns it.

Yet UPI is hardly a private system. Public sector banks have always held [a majority of NPCI’s shares](https://www.theindiaforum.in/society/whom-npci-accountable), and NPCI has said they will keep [at least 51 per cent](https://www.business-standard.com/article/pti-stories/npci-looks-to-add-50-promoters-widen-capital-base-115062901187_1.html), in line with RBI guidance. The central bank also oversees it closely. Peru's CBDC pilot raises the opposite puzzle; the central bank controls it, but a commercial telecoms operator delivers it.

Cases like these show that "operator" bundles several different things:

* who owns the operator  
* who sets the rules of the scheme  
* who runs the technology day to day  
* who decides fees and who can join

So which of these matters most for DPI? Our instinct is that rule-setting and access matter most, because they decide whether a rail stays open and serves the public interest. But they're also the hardest to capture. Ownership sits on a company register. Rule-setting power is spread across scheme rules, regulation and practice that is rarely written down.

For now we keep the central bank test, because it is the one we can apply consistently from public evidence. It means UPI stays outside the DPI-like count, even though the state, through public sector banks, holds the majority. We’d like to hear how others would draw this line, and what evidence they’d use.

## 3. Safeguards end at the bank's front door

The Map asks whether users have a place to raise a problem with the real-time payment system itself. It turned out to be one of the rarest things we found. In our Q1 data, only around 30 of 259 payment entries were coded Yes. In almost every country, users are told to go to their bank or payment provider, and we code this as No.

**What it looks like when it exists.** Brazil’s Pix is one of the few exceptions. Section 3 of the central bank’s [Pix dispute resolution manual](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/XI_Manual_de_resolucao_de_disputa.pdf) gives users a route above their bank. Anyone can file a complaint against any Pix institution through the central bank’s own complaints system, within 45 days of an issue, whether they bank there or not. The institution must answer every point within 10 business days and upload its supporting evidence to the central bank’s system. Users are then asked to rate how their complaint was handled, and the central bank publishes the results each month, institution by institution. Commercial disputes, such as a problem with something you bought, aren’t covered.

**Why it matters.** Problems on instant rails aren't rare. Refund requests for Pix scams [nearly doubled in 2024](https://canaltech.com.br/podcast/podcast-canaltech/med-do-pix-da-pra-recuperar-o-dinheiro-de-um-golpe-5891/), to around BRL 10.2 billion, and in 2025 [less than 10% of the value of accepted claims was recovered](https://phc.adv.br/contestacoes-de-pix-mais-que-dobram-90-foram-rejeitadas/). When money moves in seconds, people need somewhere to turn that doesn't depend on their own bank alone. 

Where no such forum exists, users have only their bank, which may have little power over the bank that received the funds, and nobody outside can see how complaints are handled. On a shared national rail, protection can't stop at the bank's front door.

## 4. Borders are blurring

The Map records each system as national or regional. That line is getting harder to draw, and real-time payments are starting to look more like card networks, spreading across borders in different ways. We see three patterns.

**Regional systems that work domestically.** West Africa's PI-SPI, [launched by the BCEAO in September 2025](https://www.ecofinagency.com/news-finances/0110-49183-waemus-instant-payment-system-launches-but-key-banks-stay-on-the-sidelines), is a single platform for the eight WAEMU countries. Banks and payment institutions had [until 30 September 2026](https://www.ecofinagency.com/news-finances/2506-56829-bceao-extends-pi-spi-instant-payment-platform-connection-deadline-to-september-30) to offer it, and for now it mostly carries payments within each country. Is that one regional system or eight national ones? This round, we record it in each of the eight countries, as well as once as a regional system. That accounts for eight of the twelve countries whose DPI-like count rose this round. We think that’s right, because in each country PI-SPI is the domestic instant payment system people actually use. But it shows how much the choice matters.

**National systems used abroad.** UPI now works in a [growing list of countries](https://www.businesstoday.in/amp/india/story/upi-goes-global-indians-can-now-pay-seamlessly-in-9-countries-see-the-full-list-here-544216-2026-07-21), including Sri Lanka. The primary use case is allowing visitors from India to pay local merchants. That goes beyond a domestic system, but it isn't yet a full two-way cross-border link.

**Bilateral links.** Some countries share or connect their rails. Liechtenstein uses [Switzerland's instant payment system](https://llb.li/en/business/payments/solutions/instant-payment), since the two share a currency. Rwanda and Tanzania are [piloting a link](https://www.eac.int/eadrip-news-updates/eardip-press-releases/3457-eac-begins-building-regional-instant-payment-network-with-rwanda-tanzania-pilot) between Tanzania's Instant Payment System and Rwanda's RSwitch. 

How we code these matters. A regional system can appear as many country rows and inflate counts. And when a payment crosses two schemes, it isn't always clear whose rules protect the user. For now, we code each system where it's operational, and note links and overseas use where we find them.

## 5. Numbers can be hard to find and compare

The Map currently captures three basic figures for each system: transaction volume, transaction value (in USD) and number of participants. Participant numbers were usually easy to find. Volume and value weren't. We found annual volume for only 7 of the countries we reviewed and value for 5. Where we did find both, the system was usually in Europe.

Even where figures exist, they aren't always easy to work with. The Czech Republic, which has run instant payments since 2018, publishes monthly counts but no annual total. Switzerland reports instant payments together with other retail payments. Peru publishes monthly figures in soles, and we converted this to dollars ourselves using SBS banking system selling rate on 31 December 2025. Even "participants" means different things. [In Switzerland](https://www.six-group.com/dam/download/banking-services/interbank-clearing/annual-reports/annual-report-2025.pdf), 78 institutions can receive instant payments, but only 24 can send them. We currently record 78 in our dataset. 

Shared reporting is possible. The BIS already collects comparable payments figures, including for fast payment systems, through its [Red Book statistics](https://www.bis.org/committees/cpmi/payment). But these cover only [28 mostly large economies](https://www.bis.org/committees/cpmi/governance), so most systems on the Map fall outside them. Without comparable figures, it's hard to judge how a system is performing or who it reaches. A simple shared format for the basics (volume, value, and participants, published regularly) would go a long way.

## What's next

Reviewing 38 countries has given us a sharper eye for our older data. We're now bringing the same level of review to the rest of the payments dataset.

If you work on any of these questions and would like to have a conversation about our data or work, you can set up a call [here](https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ25fk4oN_aKub5l3bDss2go_uCuxlX6bUUzJAmdZHyUxuZFxJ6W_inMsf4OUQ88zX0RokcC9Xp2). If you’d like to share information about a deployment we’re currently not tracking or correct a data point, you can use this [form](https://docs.google.com/forms/d/e/1FAIpQLSdVAq3DYscXK_XwNTPg7NoMA7Y6ii3EVBMUcRwlhAtubBNAOg/viewform). 

Follow us for future updates on [dpimap.org](/).
