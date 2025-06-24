---
layout: ../../layouts/Standard.astro
title: 'DPI Map Data for Statistical Analysis'
date: 2025-04-30
---

# DPI Map Data for Statistical Analysis

The **DPI Map dataset for statistical analysis** is a cross-national and cross-sectional policy database of technology characteristics, policies and adoption metrics related to digital public infrastructure across a maximum of 218 geographical entities (countries, regions/continents). The dataset comprises three distinct sets: one for digital identity systems, digital payment systems, and one for data exchange systems.

<aside>

Access the dataset [here](https://drive.google.com/drive/folders/1Xuzfwj8YZVWnvSIRESKuhsvqIlYfXWgM?usp=sharing).

</aside>

The previous dataset has been updated to ease usage for analysis with statistical software, with its new version now reflecting information from October 2024. The interactive [DPI Map dataset](https://dpimap.org/data) will continue to be updated every quarter as information is reported, whereas the Data Repository will be updated and released with version control regularly, planned to be released annually.

The digital identity dataset collects information on policies from 210 countries across 29 variables. The digital payment system dataset spans 218 geographical entities, of which 210 are countries. 7 entries are related to wider continental or institutional policies, across 47 variables. Lastly, the data exchange system dataset spans 210 geographical entities, one of which relates to institutional policies, with the rest being rooted in country-specific policies. Information is recorded across 27 variables. Variables included in each dataset provide information and contextual data on participation mechanisms, institutional involvement in the respective policy, legal and procedural matters and technical details.

Firstly, the structure of the dataset was adjusted. Whereas the interactive DPI Map dataset records information with countries as a unit of analysis, the Statistical dataset codes information on the basis of policies. Countries with multiple DPI policies are now represented multiple times in the dataset.

New variables have been added to enable policy-specific analysis, and some existing variables have been revised.

- A new ordinal variable on the **status of implementation** has been added to all three datasets with a streamlined scale to allow for cross-analysis.
- For variables that can take **multiple values for a single unit**, a new binary variable was coded. For instance, in the variable for types of entities that can participate in data exchange systems, values can take either public, private, civil, or multiple of the aforementioned.
- Three binary variables have been added to record the **adoption of DPI by different types of participants**. This approach has also been applied to the variables for types of transactions supported and the type of settlement system in the digital payment dataset.
- Further, ordinal variables have been coded for **variables that previously held financial values**. These were often coded in ranges. These ranges have now been streamlined into 5 distinct levels. This applies to the variables for annual transaction values, annual volume of transactions and cost of transactions, all in the digital payment dataset.
- Lastly, values previously coded as “Unknown” are now simply labelled as **Not Available (NA)**.
- **Ordinal and categorical variables** have been cleaned, and duplicate variables with slightly differing spellings of values have been streamlined.

<aside>

Our [codebook](https://docs.google.com/spreadsheets/d/1JbpmZ1ap235wVCTcnA1dE5ghCWEzdFJXxyZz1FTRupk/edit?usp=drive_link) can help simplify studying both datasets. Or write to us at [dpimappingucl@gmail.com](mailto:dpimappingucl@gmail.com) with questions.

</aside>