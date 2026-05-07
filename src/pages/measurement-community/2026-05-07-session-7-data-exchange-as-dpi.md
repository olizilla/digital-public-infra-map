---
layout: ../../layouts/Standard.astro
title: Data Exchange Systems as Digital Public Infrastructure
date: 2026-04-08
published: true
---

# Session 7 – Data Exchange Systems as Digital Public Infrastructure

**Key Takeaways**

1. **Defining DPI-like DES remains a work in progress, but the map is converging on a clearer threshold.** Of the three DPI pillars, data exchange systems are the least conceptually mature and the hardest to measure. The session tested a proposed revised definition — a national-level federated data system, operating with three or more entities, backed by a legal mandate — with session participants. The definition held, but the discussion surfaced important refinements which are still needed. 

2. **The DPI map is a baseline, not a verdict.** The DPI Map presents a point-in-time snapshot of the DPI-like attributes of DES across countries, not their potential or maturity. Over time, systems can evolve to become DPI-like. Additionally, while there are many important attributes (see our methodology) related to DPI measurement, some of them are not measurable. In such cases, the DPI map becomes a tool to surface data for researchers and practitioners to investigate further.

3. **Political economy shapes both interoperability and privacy — and remains unmeasured.** Whether entities actually share data depends less on legal mandates than on who holds power and which actors control what data. The same dynamic applies to privacy: data protection laws set the rules on paper, but ownership structures and institutional incentives determine whether those rules are enforced in practice. Both dimensions suffer from the same gap; the map can track formal frameworks but cannot yet capture the political and economic realities underneath them.

## **Session Overview**

The session introduced the DPI Map’s existing classification for measuring DES as DPI-like and invited comments on a revised definition that measures the scale, interoperability, and extensibility of DES systems. 

The discussion raised questions about the DPI map’s current approach to private sector participation. Whether the private sector participates in a DES matters for how the system operates in practice; however, this is a separate question from whether that system qualifies as DPI-like. While private sector participation in a system is currently tracked on the map, it is not a defining criterion for DPI classification. Participants also raised questions around scoping sectoral data exchanges, which are excluded from the map both due to definitional exclusions and capacity limitations. This topic prompted a more fundamental debate on whether sectoral exchanges can scale nationally. 

The case of subnational systems in federal contexts was also discussed. Sub-national systems may integrate with federal authentication infrastructure in ways that blur the boundary between state and national scope, as seen in some Indian state-level systems that use central identity verification to deliver services locally.

A participant questioned whether the map’s revised definition might conflate two distinct domains: solution design (modularity, exchange protocols, architecture) and uptake (participating entities, adoption levels). Critically, at this time, the map intentionally prioritizes uptake instead of extensibility potential. As per the proposed revised definition, a DES must demonstrably be in active use by three or more parties to qualify as DPI-like.

The team then shared feedback gathered through one-on-one calls with research and technical organisations on measuring privacy, interoperability, capacity, and scale. This fed into two breakout room discussions on interoperability and extensibility, and privacy and safety.

### **Interoperability and Extensibility**

**Rules vs. Rails** Participants recommended disaggregating "rules" and "rails" as distinct measurement categories. Rails refer to technical infrastructure — protocols, APIs, system architecture. Rules refer to legal and governance frameworks governing when and how exchange occurs. A system may have strong rails but weak rules, or vice versa, and conflating the two obscures where gaps lie.

**Formal Mandates vs. Exchange Agreements** Participants recommended using the term "formal mandate" as the operative measurement concept, with sub-indicators for whether that mandate is transparent and publicly accessible. A legal mandate creates an observable, codeable indicator; informal or contractual exchange agreements may be neither public nor consistent. However, a mandate that exists on paper without political backing may be functionally equivalent to no mandate at all.

This tension was illustrated by the country cases discussed. Nigeria has adopted a federated model for national identity and data exchange with a dedicated national data exchange policy — but the question of who owns what data and what their incentives are to participate remains a live constraint. The Asaan model in Azerbaijan illustrates a different challenge: resource distribution across entities in a federated system can impede effective exchange even where architecture and mandate exist. Work on civil registration and social protection linkages in southern Africa further highlights how legal frameworks and interagency agreements interact differently depending on context, and how system design choices affect non-citizen populations in particular.

**Political Economy of Data Ownership** A cross-cutting theme was that interoperability is not purely a technical or legal problem — it is a political economy problem. Political will frequently proved more decisive than formal institutional arrangements in the cases discussed: which actors hold power often matters more than which ministry holds jurisdiction. Data ownership and incentive structures among participating entities are currently difficult to measure but were identified as important explanatory variables for variation across countries.

**Other Refinements Flagged** The map currently conflates distinct types of interoperability — semantic vs. syntactic, legal vs. technical — which is a further refinement opportunity. The role of e-government laws in enabling or mandating interoperability is not currently factored in but is under consideration. 

### **Privacy, Safety, and Security**

Privacy measurement was acknowledged as particularly difficult observationally. Similar questions of legal mandates versus on-ground incentives were raised. Key open questions included whether a country's data protection law actually prevents unauthorized access within the DES, what thresholds constitute sufficient protection under a personal data protection law, and whether cybersecurity incident reporting mandates in the law are a sufficient proxy for measuring a DES’ cyber-resilience. 

**Granular vs Blanket consent:** Two governance models were discussed. Consent-based models require individual consent for data exchange; contractual or system-level governance uses interagency agreements rather than transactional consent. Both carry tradeoffs — blanket consent creates governance tensions, while contractual agreements are not always publicly accessible. 

**Data principal rights and accountability mechanisms**: It was also highlighted that in public service delivery contexts, consent may not be legally required for data processing by the state, but accountability mechanisms remain essential regardless. Participants discussed grievance redressal mechanisms linked to an independent regulatory body as an important indicator, though assessing the independence of such bodies presents its own methodological challenge. Rights identified as worth tracking in law include the right to erasure, grievance redressal, and access to information about data storage. Whether GDPR adequacy classifications could serve as a proxy for adequate data protection was raised as an open question.

**Supply and demand-side metrics**: The African context was raised as a case where DES appears relatively prevalent compared to the other DPI pillars, but many systems exist primarily on paper — like the governance frameworks meant to govern them. This points to the value of both supply-side indicators (infrastructure, civil servant digital literacy, training capacity) and demand-side indicators (user access, adoption rates, household digital statistics) as complements to legal and policy proxies. 

---

## **Looking Forward**

Several priorities emerged for future iterations of the map and related research:

**Finalize measurement refinements.** Several measurement refinements are under consideration. These include separating rules from rails as distinct indicators; adopting "formal mandate" — with transparency sub-indicators — as the operative concept for legal interoperability; developing qualitative indicators for data ownership and incentive alignment; integrating supply and demand-side data on infrastructure, technology uptake, and digital literacy; and strengthening privacy measurement by tracking citizen rights enshrined in law. The extent to which these revisions are possible for the map is under consideration and dependent upon readily available data or proxy measures that can be easily incorporated. 

**Maturity modeling.** There is an appetite in the research community for frameworks that track how a DES progresses along a development spectrum over time, rather than only capturing a point-in-time snapshot.

**Encouragement for deeper country and thematic dives.** The map is designed as a baseline. Country-level researchers and thematic specialists are best placed to go deeper on unmeasured attributes — including governance quality, capacity gaps, and the real-world functioning of privacy protections — using the map as a starting point.

**Outstanding open questions** include: How should state-level systems in federal contexts be classified? Can GDPR adequacy serve as a privacy proxy? How should cyber resilience be measured at the system level? And how should the map handle systems with clear DPI potential that have not yet reached the uptake threshold?

## **Join the Conversation**

**Get Involved:** The Community of Practice continues to evolve based on member contributions and interests. To suggest topics for future sessions or share implementation experiences that could inform measurement framework development, please reach out through our [feedback form](https://docs.google.com/forms/d/e/1FAIpQLSfSGSYL6lOwzNBqtwsiRYKQXnBGSx32IXeh9fPpWQjx2r0erg/viewform?usp=dialog).

**Stay Connected:** Subscribe to our [DPI Map Newsletter](https://docs.google.com/forms/d/e/1FAIpQLSef0ja9DQhV9uBpgSBILh0eNT152Y2nv_9DRGZNFqulZT09Eg/alreadyresponded) to receive updates about upcoming sessions and research insights. 

For questions about the Community of Practice or to discuss collaboration opportunities around DPI measurement, contact Naeha Rashid, Research Fellow, UCL IIPP at Naeha.rashid@ucl.ac.uk

