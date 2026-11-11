---
layout: ../../layouts/Post.astro
title: "Digital ID: What's new?"
date: 2026-11-10
---

Over the past two years, digital ID adoption has continued to grow, and so has our understanding of the systems behind it. When we launched the DPI Map in 2024, our questions centred on prevalence. How many countries had a digital ID system? And how many had the policies in place to support one? Two years on, the questions are becoming more complex. Digital ID is increasingly moving beyond standalone credentials into mobile wallets, government apps and integrated public services. Countries are not only introducing new systems, but also rebranding, consolidating and redesigning existing ones. This shift is becoming visible in our data. Over the last six months, we updated the digital ID records for **31 countries**, and the number meeting our criteria for a digital ID system rose from **70 to 80**.

Working on the updates revealed more than growing adoption. It also surfaced prospective variables, new areas for observation and places where our own definitions were revisited in the methodology.

This round of updates in numbers:

* **Systems reviewed:** 31 digital ID systems.  
* **DPI-like count:** Across the systems reviewed, the count rose from 70 to 80.  
* **Codebook:** No changes.

## 1. Services Portal Range of New Form Factors

One of the most visible changes in this round of research is the shift in how people interact with digital ID. Increasingly, the interface is no longer a standalone credential or government portal, but a mobile app that brings multiple credentials and services together.  
Austria's eAusweise illustrates this shift. By August 2026, the app held around [1.3 million digital vehicle registrations and 1.2 million driving licences](https://www.bundeskanzleramt.gv.at/bundeskanzleramt/nachrichten-der-bundesregierung/2026/08/app-eausweise-wird-noch-benutzerfreundlicher-bedienung-noch-einfacher-und-intuitiver.html), alongside [615,000 digital ID downloads](https://www.salzburg24.at/news/oesterreich/jeder-fuenfte-in-oesterreich-nutzt-digitalen-fuehrerschein-art-334793) and around 22,500 student cards since they were added in April. Other countries are following similar paths. [Belgium launched MyGov.be in May 2024](http://MyGov.be), and [Chile introduced its digital cédula in December 2024](https://www.consulado.gob.cl/registro-civil-conoce-los-nuevos-documentos-de-identificacion). 

Yet the shift is about more than putting identification on a phone. **Digital ID apps are increasingly becoming gateways to public services.** The Philippines' eGov PH brings together more than [1,000 government systems](https://pco.gov.ph/news_releases/egov-ph-app-has-more-than-a-thousand-government-systems-integrated-dict/), integrating the national ID, senior citizen ID, professional regulation ID, e-health ID and overseas worker ID in one place. In February 2026, Morocco [signed agreements](https://www.wearetech.africa/en/fils-uk/news/tech/morocco-strengthens-e-government-architecture-with-idarati-x-0) to build Idarati X.0, a wallet linked to the national electronic ID card, with six months to develop and test it. It will sit on top of a national portal that already offers [660 services](https://www.biometricupdate.com/202602/idakto-and-shareid-to-help-build-moroccos-new-digital-wallet-super-app). 

Taken together, these developments suggest that digital ID is becoming less about a single credential and more about the interface through which people access government services.

## 2. Biometrics are more than a yes or no

Biometric identification is not new. Fingerprints and photographs have long been used during enrolment. What is changing is how biometrics are used after an identity has been issued.  
Facial verification, in particular, is becoming an authentication mechanism on mobile devices. Singapore introduced Singpass face verification in December 2020, followed by the Philippines' [eVerify in June 2024](https://psa.gov.ph/system/files/philsys/Press%20Release%20Digital%20Natl%20ID%5ELJ%20Natl%20ID%20eVerify%5ELJ%20Natl%20ID%20Check%20_Rev1-signed.pdf) and the [GOV.UK One Login app in June 2025](https://apps.apple.com/gb/app/id6737119425). India, which has collected fingerprint, iris and facial data since Aadhaar's launch in 2010, introduced [face authentication in October 2022](https://uidai.gov.in/images/FaceAuthTransation.pdf).

These developments expose an important limitation in our current dataset: **the DPI Map records biometrics as a yes-or-no variable.** Today, 122 digital ID systems that we monitor are coded ‘Yes’ to biometrics. Though this is currently not a criteria for the DPI-Like system, that single value can conceal fundamentally different approaches to biometric data. For example: 

* India collects fingerprints, facial images and iris scans within a centralised system, with biometric modalities supporting enrolment and authentication.  
* Germany also collects fingerprints and facial images, but fingerprints are stored on the identity card's chip and deleted from the issuing authority's records after issuance. Access is restricted to authorised bodies.  
* [Australia's myID](https://www.myid.gov.au/security-and-privacy/myid-privacy-notice), biometric images and photographs used by third-party providers as part of the verification process are destroyed within 14 days. 

Three very different designs, but one identical value in the dataset. The distinction matters because biometric systems raise different questions about data storage, security, authentication and user control.

Our methodology review has reinforced the need to distinguish between the presence of a technical capability and the design choices behind it. Future variables could help us capture which biometric modalities are used, when they are required and how the resulting data is handled.

## 3. What's in a wallet? Exploring verifiable credentials

One area we want to explore further is the growing role of **verifiable credentials (VCs)** in digital ID systems. As digital wallets evolve, they are increasingly being designed to hold more than proof of identity. Driving licences, student cards, professional qualifications and other credentials can be issued digitally, allowing people to prove specific information about themselves without necessarily sharing their full identity.

This raises an important distinction for the DPI Map. **Having a digital wallet does not necessarily mean a country supports verifiable credentials**, and not all digital credentials follow the same technical standards or verification processes. Our current dataset captures whether a digital ID system exists, but not whether it supports VCs, what types of credentials can be issued, or how they can be verified and shared across services.  
As more countries introduce digital wallets, we want to explore how to capture these differences. This could include whether systems support internationally recognised VC standards, which credentials are available and whether they can be used across different institutions or borders.  
Moving beyond the existence of digital ID towards understanding **what people can prove with it, and where those credentials can be used**, could offer a more complete picture of how digital ID systems are evolving.

## 4. Legislation paired with Digital ID Enrollment

As digital ID systems evolve, their legal foundations do not always coincide with the initial release of the ID. Sequencing varies. Some countries establish a legal framework before deployment, others launch first and formalise later, and in several cases both happen within the same year. One particularly interesting observation is the relationship between mobile applications and the timing of ID legislation. This suggests that user-facing digital ID interfaces can move ahead of the legal frameworks intended to govern them, although the sequencing alone does not establish why. It also raises questions about what legal recognition means in practice. Does a digital credential carry the same legal status as a physical identity card? Are different credentials recognised across government services equally? These questions came out of the scoping exercise rather than the dataset, as we worked to understand how consistently legislation was present and how the map might capture it. The map currently records ‘Regulation for digital ID’ as a binary variable. For future iterations we will evaluate adding dates, and more detail on laws that have been drafted but not yet brought into force.

## What's next for the dataset?

Digital ID is changing from a document people are issued, to a credential they use to authenticate themselves, and increasingly to an interface through which they access public services. We want the next iteration of our dataset to reflect this shift. That means looking at new variables: which biometric modalities a system uses; what form factor the ID takes and how it connects to government services; whether a wallet supports verifiable credentials, and to which standards; and when a system’s legal basis was established relative to its launch. The aim is not just to map where digital ID exists, but to better understand how its design shapes people's access to services.

If you have spotted something we have missed or got wrong, or have views on how we should measure any of this, we would like to hear from you. We welcome feedback on using the DPI Map and invite stakeholders to share their experiences of country-level implementations [here](https://docs.google.com/forms/d/e/1FAIpQLSdVAq3DYscXK_XwNTPg7NoMA7Y6ii3EVBMUcRwlhAtubBNAOg/viewform).
