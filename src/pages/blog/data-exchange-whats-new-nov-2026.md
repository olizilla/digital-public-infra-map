---
layout: ../../layouts/Post.astro
title: "Data Exchange: What's new?"
date: 2026-11-08
---

In February 2026 we began reviewing how the DPI Map identifies and measures data exchange systems (DES), [consulting technical and policy stakeholders](/measurement-community/2026-05-07-session-7-data-exchange-as-dpi/) along the way. This release is the first result of that work: new data for 50 countries and territories in Asia, Europe and the Americas, with five new variables and two revised ones.

The headline update is that we have become stricter about which systems we track and include on the dataset. Meanwhile, the new variables we have added are signalling important information on what classifies to be DPI-like attributes. We delve into these findings further, below.

**Summary of updates from our latest release**

* **DPI-like count:** Countries with a DPI-like data exchange fell from 103 to 101. In [Ireland](/dx-ie-02/) and [Germany](/dx-de-02), we replaced the system we tracked with one that is more central to public services but, both replacements are still in pilot so they no longer count as DPI-like.  
* **New systems:** We added 17 new systems to the dataset. Fifteen replace systems we tracked before. The other two are second DPI-like exchanges in Greece and Belgium, which is why our 50 countries cover 52 systems. Both countries were already in the DPI-like count, which is why the count of countries with DPI-like exchanges doesn't increase.  
* **New variables:** We added five new variables, taking the number of variables we track for data exchanges from 13 to 18. Namely, these are, formal mandate, once-only principle, independent audits, personal data protection, and members and annual transactions.  
* **Revised variables:** Two existing variables were revised namely, [semantic interoperability](/codebook/exchange/interoperability_level/) and [permitted participants](/codebook/exchange/permitted_participants/).

We focused this dataset on 49 countries, and the autonomous territory of Greenland, because they were previously classified as DPI-like and spanned a range of maturity and scale.

## Sharpening what counts as DPI-like

Our current test for whether a data exchange is DPI-like is that it is active and used across sectors. It is quite broad, and we are in the process of tightening it and becoming stricter about what counts.

As a first step, we want to add two conditions to the test: a formal mandate and permitted participants. We are already collecting data on both, and the values are live on the Map, but the test itself hasn't changed yet. We will only update it once we have collected data for these variables across the existing DPI-like dataset. In the meantime, we want to share what each one of these proposed classifiers measure and what we've found so far.

### Formal mandate  *New Variable*

**Definition.** Whether a decree, executive order, law or similar legal instrument both authorises data sharing over the exchange and obliges participants to adopt shared standards.

**Why we are interested.** Countries often run several data infrastructures, and it can be hard to tell which matter most for public services delivery. A formal mandate helps us separate secure, cross-sectoral exchanges from intranets, document management and cataloguing tools, open data portals and other more limited efforts.

**What we see so far.** 35 of the 50 countries we reviewed have a formal mandate for their data exchange. This variable also led us to replace the system we tracked in Austria, Germany, Slovenia, Slovakia, Switzerland, Sweden and Turkey. In Austria, for example, we replaced EZD-RP, a document management system, with DadeX, which is controlled by the Federal Ministry of Finance and formally authorised to support public services delivery.

### Permitted participants *Revised Variable*

**Definition.** This is an existing variable which we have expanded to capture an additional category. It tracks which entities can take part on an exchange, but alongside civil society and the private sector, we now also track whether individuals can participate, and we consider participation to mean both indirect as well as direct involvement. 

To illustrate the difference between direct and indirect participation with an example, on Belgium's Crossroads Bank for Social Security, private companies can check whether an applicant is eligible for a telecoms subsidy. Thus they benefit from data flows on the exchange without exchanging data on it directly. Meanwhile, in Bosnia and Herzegovina, individuals can register a birth through the [e-services portal](https://www.iddeea.gov.ba/en/linked-e-services-for-citizens/), which passes their information through the data exchange.

**Why we are interested.** Society-wide participation is a core feature of DPI. This variable shows how far an exchange reaches beyond government, and to whom.

**What we see so far.** 37 of the 50 countries allow participation beyond the public sector, directly or indirectly. Among those, a majority of exchanges can be observed to enable private sector entities to leverage the exchange as well. 

| Permitted Participants | Number of systems |
| ----- | ----- |
| Public sector only | 14 |
| Public and civil society | 2 |
| Public and private sector | 19 |
| Public, private and civil society | 16 |
| No data | 1 |

## Adding depth to what we track

We also revised **one existing variable and added four new ones.** Together they make our measures more precise, capture the policy behind data sharing, check whether oversight is built in, and add quantitative data on each exchange.

### Refining interoperability measures

We used to record **semantic interoperability** as a single yes or no, based on published data formats, terminology, and protocols. That collapsed two different things into one, so we now separate them.

| Category | Definition |
| ----- | ----- |
| Syntactic interoperability | Systems on the exchange share data using a shared grammar, format and schema, according to the exchange's documentation. |
| Semantic interoperability | The exchange has adopted a shared vocabulary, ontology or data dictionaries, so that sender and receiver understand data elements the same way. |

Out of the 50 countries we tracked, 18 had enforced some degree of semantic interoperability by requiring adoption of shared semantic assets within the exchange. 29 others enforced syntactic interoperability through specifying data formats and protocols. We consider the presence of semantic assets to be useful for understanding the extensibility and interoperability of a system and differentiate the extent to which data is exchanged in a standardised manner. 

### Capturing policies supporting data sharing

We now track whether a country has an explicit [**once-only principle**](/codebook/exchange/once_only_principle/): a policy that public bodies ask people for data only once, then reuse it from sources within government. It is a useful policy lever for building data exchange infrastructure, as Estonia's X-tee [shows](https://www.ucl.ac.uk/bartlett/sites/bartlett/files/iipp-wp-2018-09_estonias_digital_transformation.pdf). Most countries we reviewed have one: 43 of the 50 have a once-only principle in law or policy, with or without explicitly naming and authorising a data exchange system to implement it. For instance, Ireland’s public service data strategy contains the once-only principle however it does not have a nationally implemented or formally authorised data exchange system yet. 

### Building in oversight

Two new variables look at whether oversight mechanisms are built into an exchange and the rules around it.

The first is a variable for **require periodic, independent audits**asks whether an exchange's rules or documentation of its cybersecurity and technical functionality. This turns out to be rare: only 9 of the 52 systems do. Many that fall short are not unaudited, though. In Hungary, a security officer must check the exchange every six months, but the review is internally conducted. Croatia, by contrast, requires independent audits, but doesn’t specify a regular schedule. The measurement of this variable might also be impacted by the Map’s capacity itself. Audit duties can also sit in cybersecurity regulations, which the Map doesn't track, so some of these may be false negatives.

The second asks whether the country has an **enacted personal data protection law**. We already track this for digital ID, and adding it here means researchers can find it in each DPI type's dataset. Here the picture is reversed: 48 of the 50 countries have one. The exceptions are Kuwait and the United States, which has no comprehensive federal law. This partly reflects our sample, since many of the countries are covered by the EU's GDPR.

Put together, a data protection law is close to universal, but routine independent scrutiny of the exchanges themselves is rare.

### Building in quantitative metrics

Whether an exchange publishes statistics about itself says little about how widely it is used. So where the figures exist, we now also record the **number of members** (institutions directly onboarded onto the exchange) and **annual transactions**. These give a direct sense of scale: how far an exchange has spread across government, and how much of the state's everyday data sharing runs through it.

Few exchanges publish them. We found member numbers for 19 of the 52 systems and transaction numbers for only 12, mostly in countries known for mature digital government, such as Estonia, Italy, Belgium and Portugal.

## What's next

Over the next two quarters our plan is to collect data on formal mandate, permitted participants, and review the exchanges we capture across the full DPI-like dataset, allowing us to update our test for DPI-like data exchange correctly. Meanwhile, we want to share our thinking on these variables and some of the other questions on tracking DPI-like data exchanges in a separate blog piece soon. These include -

1. How could the Map capture the underlying technical architecture of an exchange differently?  
2. How data exchange systems have varying governance, coordination, and operational structures and how can the Map capture them?  
3. How can the Map better distinguish between active and defunct systems in what we capture and persistent challenges with capturing national and federal systems? 

If you work on data exchange and you’d like to offer us feedback, we would love to hear from you - you can set up a chat with us through this link [here](https://calendar.app.google/8FxK8nqJudFhDEBu9). However, if you have spotted something we've miscoded, you can get in touch with us by filling this short [form](https://docs.google.com/forms/d/e/1FAIpQLSdVAq3DYscXK_XwNTPg7NoMA7Y6ii3EVBMUcRwlhAtubBNAOg/viewform).
