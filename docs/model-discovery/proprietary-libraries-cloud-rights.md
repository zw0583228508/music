# Proprietary free libraries on a cloud VM — the clause table (2026-09-10)

**What this is.** A table of what each vendor's *published* licence text says
about running its free-but-proprietary library on a rented Windows virtual
machine, (a) for the owner's own private, single-user, non-commercial use and
(b) inside a deployment that other people use. Every quote below is verbatim
(≤ 25 words) from the vendor's own page, fetched on **2026-09-10** at the URL
given. Where a page could not be fetched, or a topic is not addressed, the
table says so — **no permission is inferred from silence**.

**What this is not.** It is a clause table, not legal advice and not a legal
opinion. EULAs change; the vendor's current text and the vendor's answer to a
direct question outrank this page. Nothing here was accepted, signed up for,
installed or paid for during this survey.

Companion: `windows-render-vm-runbook.md` (the VM that would host these),
`free-sound-libraries.md` (the catalogue this narrows), `Q-13` in
`docs/master-plan.md` (the licensed instrument catalogue whose every asset must
pass a cloud-rendering rights review — this table is that review's first pass).

## How to read the verdicts

The scenario for question (a): **one licensee** (the owner), **one machine**
(the VM counts as one computer/device), the owner signs into every vendor
account himself on that machine, the only rendering requests come from his own
API, and the audio is his own music. Nobody else has an account on the VM or
receives renders from it.

| Private-VM verdict | meaning |
| --- | --- |
| `PRIVATE_VM_PERMITTED` | a clause positively covers the scenario (e.g. "as many computer systems as he or she has access to", "install on one or more computers … used only by the licensee") |
| `PRIVATE_VM_GREY` | the text is silent on servers/VMs/remote use, **or** a clause could be read against a rented machine (e.g. computers "owned … by you", "one local hard drive"), **or** the licence could not be fetched |
| `PRIVATE_VM_FORBIDDEN` | a clause forbids the scenario in terms |

| Multi-user verdict | meaning |
| --- | --- |
| `MULTI_USER_SERVICE_FORBIDDEN` | the text forbids third parties benefiting from the software / limits use to the single licensee, and names no path to a broader licence — **also the platform's default where the text is silent** (a policy, not an inference) |
| `NEEDS_COMMERCIAL_LICENCE` | the text names a path (multi-user licence, per-user licences, written consent) |
| `PERMITTED` | the text permits it — **no product in this set** |

Confidence is *high* when the verdict rests on an explicit sentence, *medium*
when it rests on a general clause applied to the scenario, *low* when the
governing document is unclear or of uncertain applicability, *none* when the
licence was not fetched.

## Summary — 22 products

| # | product | private single-user VM | multi-user deployment | rests on |
| --- | --- | --- | --- | --- |
| 1 | NI Kontakt 8 Player + Komplete Start | `PRIVATE_VM_GREY` (medium) | `NEEDS_COMMERCIAL_LICENCE` (high) | EULA §3.3 three devices, one regularly; servers/VMs not addressed; "not … on a network by multiple users, unless each user possesses a license" |
| 2 | Third-party Kontakt Player libraries (in general) | inherits the *library vendor's* row **and** row 1 | the stricter of the two | Kontakt Player is NI software under row 1; the library is the vendor's licence |
| 3 | Spitfire SSO Discover | `PRIVATE_VM_PERMITTED` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | §5 "not more than two devices concurrently"; §6 personal use; §8 no "time share" |
| 4 | Spitfire BBC SO Discover | as row 3 | as row 3 | same EULA, no Discover-specific clause |
| 5 | Spitfire LABS | as row 3 (low: the LABS site now redirects to splice.com) | as row 3 | same EULA; LABS-specific terms not found |
| 6 | Orchestral Tools SINE player | `PRIVATE_VM_GREY` (medium) | `NEEDS_COMMERCIAL_LICENCE` (high) | licence silent on devices/servers; T&C §8.2 no "application service providing or as 'software as a service'" without consent |
| 7 | OT Berlin Free Orchestra | as row 6 | as row 6 | same documents |
| 8 | OT Layers | as row 6 | as row 6 | same documents |
| 9 | Audio Imperia GLADE | `PRIVATE_VM_GREY` (medium — the closest to a prohibition in this set) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | "one local hard drive"; "Cloud storage is permitted for backup purposes only"; "does not allow you to upload to shared servers" |
| 10 | Sonuscore LUX Strings Elements / Orchestra Elements | `PRIVATE_VM_GREY` (medium) | `NEEDS_COMMERCIAL_LICENCE` (high) | "for one single user"; devices/servers not addressed; "multiuser license, please contact us" |
| 11 | Impact Soundworks Tokyo Scoring Strings Free / Shreddage 3 Stratus Free | `PRIVATE_VM_PERMITTED` (high) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | "as many computer systems as he or she has access to"; "ONLY the licensee may use the Product" |
| 12 | Sonixinema Origins | `PRIVATE_VM_GREY` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | two computers "owned and used by you exclusively" — a rented VM is used exclusively but not owned |
| 13 | Fracture Sounds Blueprint | `PRIVATE_VM_PERMITTED` (medium) | `NEEDS_COMMERCIAL_LICENCE` (high) | "up to three computers, provided you are the sole user"; "multi-user … please contact us" |
| 14 | Emergence Audio Infinite Collection | `PRIVATE_VM_GREY` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | "up to two personal devices" — whether a rented VM is a *personal device* is not defined |
| 15 | ProjectSAM The Free Orchestra | `PRIVATE_VM_PERMITTED` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | "MAXIMUM OF 3 (THREE) computer systems or samplers, as long as you are the SOLE USER" |
| 16 | Ample Sound Lite (AGM Lite II, ABP Lite II) | `PRIVATE_VM_GREY` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | §2 computers must "belong to the same owner"; §5 free products are "Demo Software" for "demonstration, test or evaluation" unless Ample says otherwise; §3 no "timesharing, service bureau" |
| 17 | Steven Slate SSD5.5 Free | `PRIVATE_VM_GREY` (**none** — no SSD EULA published on the vendor's sites) | `MULTI_USER_SERVICE_FORBIDDEN` (low — policy default) | FAQ: 3 iLok activations, no iLok Cloud; Slate Digital's (Audiotonix) terms forbid hosted-service use but do not say they cover SSD |
| 18 | Soundpaint (free engine + free instruments) | `PRIVATE_VM_GREY` (low) | `MULTI_USER_SERVICE_FORBIDDEN` (medium) | soundpaint.com terms are website terms + an AI clause; 8Dio's licensing page (same company) says two computers "owned and used by you exclusively", single user — but does not name Soundpaint |
| 19 | Decent Sampler plugin | `PRIVATE_VM_GREY` (**none** — no plugin licence published; a 2022 request for it is unanswered) | `MULTI_USER_SERVICE_FORBIDDEN` (low — policy default) | plugin is proprietary freeware with no published EULA |
| 20 | Decent Samples libraries + Pianobook packs | `PRIVATE_VM_GREY` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high for Pianobook: "solely for your own personal use"; low for Decent Samples: silent) | Decent: compositions only, no redistribution, nothing on machines; Pianobook: personal, non-transferable, packs carry no per-pack licence field |
| 21 | VSL Big Bang Orchestra Free Basics | `PRIVATE_VM_PERMITTED` (medium-high) | `NEEDS_COMMERCIAL_LICENCE` (high) | "install the Software on one or more computers … provided that it is used only by the licensee"; network multi-user "unless each user has purchased a license" |
| 22 | MT Power Drum Kit 2 | `PRIVATE_VM_GREY` (**none** — EULA only inside the installer) | `MULTI_USER_SERVICE_FORBIDDEN` (none — policy default) | download page: "By downloading, you agree to the EULA"; the EULA link is a JavaScript action, the legal page is an imprint |
| 23 | Steinberg HALion Sonic / Groove Agent SE content with Cubase 14 | `PRIVATE_VM_GREY` (medium) | `MULTI_USER_SERVICE_FORBIDDEN` (high) | §2.3 single-user licence, activations "on a limited number of computers" (help centre: three, simultaneously); §2.2 samples only inside "a live or recorded performance"; servers/VMs not addressed |

**Counts.** Private VM: `PERMITTED` for five vendors (Impact Soundworks,
Fracture Sounds, ProjectSAM, VSL, Spitfire — whose three free products share
one EULA), `FORBIDDEN` for none, `GREY` for the rest — three of them GREY only
because the licence could not be fetched (SSD5 Free, Decent Sampler plugin,
MT Power). Multi-user: nothing `PERMITTED`; five vendors name a
licence path (NI, OT, Sonuscore, Fracture, VSL); the rest forbid it or are
silent (silent = forbidden by platform policy).

## Two findings that cut across the table

1. **AI-training prohibitions are now common and bind the platform's training
   plan.** Soundpaint §14, VSL, Orchestral Tools T&C §9, Sonuscore §5, Fracture
   §3 and Audio Imperia all forbid using their content to train or improve
   AI/ML models, several "whether standalone or incorporated within musical
   compositions". Audio rendered through these libraries therefore **must not
   enter** `MUSIC_REWARD_MODEL_*`, LoRA, or any other training set, and the
   Listening Room recordings that use them must be tagged so they cannot be
   promoted into a dataset later. Proposal (not implemented here): a
   `trainingUse: "forbidden"` field on the VST3 worker's asset manifest, copied
   into every render's evidence, with the dataset gate (`datasetRightsProof.ts`)
   refusing any item that carries it.
2. **Activation seats are consumed by VM lifecycle, not by rendering.** Every
   vendor with a device count (NI 2–3, Spitfire 2, Sonixinema/8Dio 2, Emergence
   2, Fracture 3, ProjectSAM 3, Steinberg 3, SSD5 3 iLok) counts *machines*.
   Deleting and re-creating a VM burns a seat each time unless the licence is
   deactivated first. The runbook's cost-control rule "deactivate before you
   delete; snapshot instead of re-creating" follows from the licences, not from
   cost.

## Clause cards (verbatim, ≤ 25 words each)

Fields: **machines** (installs per user) · **licensee-only** · **server / remote /
VM / cloud / rendering-as-a-service** · **third-party / networked access** ·
**commercial vs non-commercial** · **transfer** · **AI / other**. "NOT ADDRESSED"
means the fetched document contains nothing on the topic.

### 1. Native Instruments — Kontakt 8 Player, Komplete Start, Native Access

Source: End User License Agreement, "Latest Version 2026-07-01",
<https://www.native-instruments.com/pages/end-user-license-agreement> (fetched
2026-09-10). Device-count support article:
<https://support.native-instruments.com/support/solutions/articles/69000879152-on-how-many-computers-can-i-activate-my-native-instruments-product->
(fetched 2026-09-10, undated).

- machines — §3.3: "Licensee may install and personally use the licensed software on three devices"; "Simultaneous use on more than one hardware device is not permitted." Support article: "Installation on two computers (three computers for all versions of Maschine and Komplete)" — the two documents disagree (three vs two); the EULA is the contract, the article the operational limit Native Access enforces.
- licensee-only — §3.3: "personally use".
- server / VM / cloud — NOT ADDRESSED.
- third-party / networked — §3.3: "The Products may not be used on a network by multiple users, unless each user possesses a license." §3.6(a): "Renting or lending the licensed Software to a third party is expressly forbidden."
- commercial — §3.7: "The provided samples, instruments and presets can be used for commercial or non-commercial music and audio productions without prior permission."
- transfer — §3.6(b): "Licensee may resell the software to a third party or transfer the software permanently, provided the third party agrees in writing".
- Kontakt Player libraries / Komplete Start specifically — NOT ADDRESSED.

Verdicts: private VM `GREY` (medium): a VM is one of the permitted devices and
nothing forbids a VM, but servers/remote use are unaddressed and Native Access
ties the activation to the machine identity. Multi-user
`NEEDS_COMMERCIAL_LICENCE` (high): the text's own path is "each user possesses
a license" — which a single server account cannot satisfy for free Player
libraries, since each user's licence lives in that user's own NI account.

### 2. Third-party Kontakt Player libraries, in general

No separate NI document governs them. Each library is licensed by its vendor
(rows 9–15 below) **and** runs inside Kontakt Player under row 1. Fracture
Sounds §7 states the dependency in terms: "Products require the free version of
Kontakt (Kontakt Player), unless otherwise stated." The verdict for any Player
library is therefore the *stricter* of its vendor's row and row 1.

### 3–5. Spitfire Audio — SSO Discover, BBC SO Discover, LABS

Source: Spitfire Audio End User Licence Agreement (undated),
<https://www.spitfireaudio.com/en-us/pages/spitfire-audio-end-user-license-agreement>
(fetched 2026-09-10). `/info/eula` and `/pages/eula` now serve the privacy
policy; `labs.spitfireaudio.com` returned a 301 to `splice.com/instrument`
(observed 2026-09-10) — LABS-specific terms were not found.

- machines — §5: "download (on not more than two devices concurrently) and use the Products".
- licensee-only — §6: "you are granted a personal non-transferable licence to use the Products solely for your own personal use"; §3: "the Site and the Content are for your personal use only".
- server / VM / cloud — NOT ADDRESSED.
- third-party — §5: "You may not sell any Product(s), or give away any Product(s) for use by any other person(s)"; §6: "must not be shared with or given or transferred to any third party".
- commercial — §5: "use the purchased Sound File(s) only within your own newly-created sound recording(s) and/or performances"; re-sampling: "Replaying and recording loops or sounds through any of our Products and reselling or distributing those loops and sounds other than in a musical composition is strictly prohibited" (§5).
- transfer — §8: "you may not rent, lease, sell, sublicense, distribute, transfer, copy, reproduce, display, modify or time share any Product(s)".
- free products — NOT ADDRESSED.

Verdicts: private VM `PERMITTED` (medium): a device limit with no ownership
or location condition; the VM is one of two devices. Multi-user `FORBIDDEN`
(high): "for use by any other person(s)" and "time share" are prohibited in
terms, and no multi-user path is offered.

### 6–8. Orchestral Tools — SINE, Berlin Free Orchestra, Layers

Sources: License Agreement, "Last revised 20 November 2023",
<https://www.orchestraltools.com/legal/license-agreement>; General Terms and
Conditions, "Last updated December 5, 2024",
<https://www.orchestraltools.com/legal/terms> (both fetched 2026-09-10).

- machines — NOT ADDRESSED in either document.
- licensee-only — Licence §2(1): "The Licensor shall make the software available to the Licensee for a one-time download."
- server / VM / cloud / service — T&C §8.2 forbids use as "application service providing or as 'software as a service'" without consent.
- third-party — T&C §8.2: "not … make them available to third parties for a fee or free of charge."; Licence §3(2): "The Licensee shall not be entitled to exploit the software … for commercial gain without prior consent".
- commercial — Licence §3(2): "This does not apply to the work product created with the licensed use of the software."; T&C §8.2: "use it for the composition of music and audio productions and license the results … to third parties."
- transfer — Licence §3(2): selling, renting or leasing the software to third parties is excluded.
- AI — T&C §9: "training of artificial intelligence is hereby reserved and is not permitted without our consent."
- SINE / free products / Layers — NOT ADDRESSED by name.

Verdicts: private VM `GREY` (medium): no device or location clause at all; the
SaaS/ASP prohibition is not triggered by the owner using his own instance, but
it shows where the vendor draws the line. Multi-user `NEEDS_COMMERCIAL_LICENCE`
(high): the text's own words are "without consent" — consent is the path.

### 9. Audio Imperia — GLADE

Source: License Agreement, "Updated November 25, 2024",
<https://www.audioimperia.com/license-agreement/> (fetched 2026-09-10).

- machines — "You may transfer the licensed audio files to one local hard drive and also make one additional backup copy."
- licensee-only — "The rights associated with this license are available to you only. The license is non-transferable."
- server / VM / cloud — "Cloud storage is permitted for backup purposes only if access is restricted to the licensed user."; "This license does not allow you to upload to shared servers."
- third-party — "You may not sell, lend, or giveaway, any of the licensed audio files, in whole, or part, to third parties."
- commercial — royalty-free in "radio programs, podcasts, mobile apps, television broadcasts, film soundtracks, music albums … advertising".
- transfer — non-transferable (above).
- AI — "The licensee shall not use the licensed products or any part thereof with generative AI or ML models … without prior written consent."

Verdicts: private VM `GREY` (medium), the most cautious row: the licence names
"one local hard drive" and allows cloud copies "for backup purposes only". A
VM's data disk is a working copy, not a backup, and a rented disk is arguably
not "local". It is not a "shared server" when only the owner has access, so the
text does not forbid the scenario in terms — but this is the vendor to ask
before installing. Multi-user `FORBIDDEN` (high): "available to you only" plus
the shared-server sentence.

### 10. Sonuscore — LUX Orchestral Strings Elements, The Orchestra Elements

Source: Terms & Conditions including EULA (undated),
<https://www.sonuscore.com/terms-condition/> (fetched 2026-09-10).

- machines — NOT ADDRESSED.
- licensee-only — §2: "grants a non-exclusive, non-transferable, non-sublicensable right to use the Content for one single user".
- server / VM / cloud — NOT ADDRESSED.
- third-party — §2: "If you want to purchase a multiuser license, please contact us directly".
- commercial — §4: "use the Content in your own finished productions without additional license fees".
- transfer — §5: "You may not redistribute, resell, sublicense … for the purpose of re-selling, trading, sharing".
- AI — §5: "No usage of the Content … for the purpose of training, improving, or developing any Neural Networks (NN), Artificial Intelligence (AI) or Machine Learning (ML) models".

Verdicts: private VM `GREY` (medium): silent on machines and servers. Multi-user
`NEEDS_COMMERCIAL_LICENCE` (high): the multiuser licence is the named path.

### 11. Impact Soundworks — Tokyo Scoring Strings Free, Shreddage 3 Stratus Free

Source: Combined License Agreement & Privacy Policy, "Updated December 4, 2014",
<https://impactsoundworks.com/combined-license-agreement-privacy-policy/>
(fetched 2026-09-10).

- machines — "The licensee (primary user) MAY install the Product on as many computer systems as he or she has access to."
- licensee-only — "ONLY the licensee may use the Product. No other users are authorized."
- server / VM / cloud — NOT ADDRESSED.
- third-party — institutional licences only: "at no point may multiple authorized users access one license simultaneously."
- commercial — "This includes both non-commercial and commercial usage of all types."
- transfer — "Redistributing, reselling, electronically transmitting, uploading, sharing, or renting the Product in any way, shape, or form is prohibited by law."
- free products / AI — NOT ADDRESSED.

Verdicts: private VM `PERMITTED` (high): a rented VM is a computer system the
licensee has access to, and the text puts no ownership or location condition on
it. Multi-user `FORBIDDEN` (high): "No other users are authorized."

### 12. Sonixinema — Origins (Delicate Strings, Emotive Brass, Whispering Woodwinds, Ethereal Pads, Celestial Voices)

Source: Licensing Agreement (undated),
<https://www.sonixinema.com/pages/licensing-agreement> (fetched 2026-09-10).

- machines — "You may use this product on up to two (2) separate computers, which computers shall be owned and used by you exclusively."
- licensee-only — "The license for this product is granted only to a single user."
- server / VM / cloud — NOT ADDRESSED.
- third-party — "This license is nontransferable and expressly forbids resale or lease of the product."
- commercial — "for commercial and non-commercial use in music, sound-effect, audio/video post-production, performance, broadcast or similar finished content-creation and production use."
- transfer — nontransferable (above).

Verdicts: private VM `GREY` (medium): a rented VM is *used* exclusively by the
owner but is not *owned* by him; the word "owned" is in the clause. Multi-user
`FORBIDDEN` (high): "only to a single user".

### 13. Fracture Sounds — Blueprint

Source: EULA / Terms & Conditions, "Last updated: 24th September 2025",
<https://fracturesounds.com/terms-conditions/> (read in the browser
2026-09-10; the page returns 403 to non-browser fetchers).

- machines — §2: "You may install the software on up to three computers, provided you are the sole user."
- licensee-only — §2: "Each user requires their own licence; licences cannot be shared between multiple people"; free products are covered: "(purchased, provided for free, or issued as a Not-for-Resale (NFR) licence)".
- server / VM / cloud — NOT ADDRESSED.
- third-party — §2: "For multi-user, educational, or volume licences, please contact us for special arrangements."
- commercial — §3 permitted: "Licence and monetise those productions (e.g., streaming, sync, commercial releases)."
- transfer — §5: "All licences are strictly non-transferable."
- AI — §3 prohibited: "Use our products to train AI models, machine learning systems, or similar technologies without express written permission".
- dependency — §7: "Products require the free version of Kontakt (Kontakt Player), unless otherwise stated."

Verdicts: private VM `PERMITTED` (medium): three computers, sole user, no
ownership condition — subject to row 1 for Kontakt Player. Multi-user
`NEEDS_COMMERCIAL_LICENCE` (high): "please contact us for special arrangements".

### 14. Emergence Audio — Infinite Collection

Source: Emergence Audio LLC End User License Agreement, "Effective July 12th,
2024", <https://emergenceaudio.com/end-user-license-agreement/> (fetched
2026-09-10).

- machines — §1: "(on up to two personal devices, simultaneously)".
- licensee-only — §1: "license to you (a single user)".
- server / VM / cloud — NOT ADDRESSED.
- third-party — §2: "Products may not be used in or in relation to any competitive products that are sold or relicensed to any third parties".
- commercial — §1: "in any commercial or non-commercial purpose provided you have combined them with other sounds within one or more original musical composition(s)".
- transfer — §2: "You may not copy, modify, share, rent, sell or lease any Product and documentation (in whole or in part)".

Verdicts: private VM `GREY` (medium): "personal devices" is undefined; a
rented VM used only by the owner may or may not be one. Multi-user `FORBIDDEN`
(high): "a single user".

### 15. ProjectSAM — The Free Orchestra

Source: End User License Agreement (EULA) for The Free Orchestra (undated),
<https://projectsam.com/end-user-license-agreement-eula-for-the-free-orchestra/>
(fetched 2026-09-10).

- machines — §1: "MAXIMUM OF 3 (THREE) computer systems or samplers, as long as you are the SOLE USER".
- licensee-only — §1: "The license to use this product is granted to a single user only."
- server / VM / cloud — NOT ADDRESSED.
- third-party — NOT ADDRESSED beyond the single-user grant.
- commercial — §1: "for COMMERCIAL USE in music production, public performance, broadcast or similar use".
- transfer — §2: "expressly forbids resale or redistribution of the product, its sounds or their derivatives".

Verdicts: private VM `PERMITTED` (medium): three systems, sole user, no
ownership condition. Multi-user `FORBIDDEN` (high): "a single user only".

### 16. Ample Sound — Ample Guitar M Lite II, Ample Bass P Lite II

Source: AMPLE SOUND END USER LICENSE AGREEMENT (EULA), PDF, 13 pages, undated,
<https://www.amplesound.net/en/EULA-Ample.pdf> (fetched 2026-09-10; text
extracted locally).

- machines — §2: "install, and use a Product on one computer or on more than one computer only if these computers form a single production unit"; the computers must "belong to the same owner."; "If the Product does not have a copy protection system, no more than two concurrent installations are permitted."
- licensee-only — §2: "You (one user)".
- server / VM / cloud / service — §3: "You may not permit third parties to benefit from the use or functionality of a Product or any part thereof through a timesharing, service bureau" (or other arrangement).
- third-party — §4(ii): "You may not rent or sublicense any Product, Product component or License."
- commercial — §6: use "only in the context of musical arrangements, recordings of arrangements and live performances."
- transfer — §4(i): "You may transfer a Product to a computer or computers you own other than the computer(s) on which such Product was originally installed"; one-time licence transfer by e-mail notice.
- **free products** — §5: "Products that are provided without charge are collectively referred to herein as 'Demo Software.'" and Demo Software "may only be used for the purpose of demonstration, test or evaluation of a Product", "except with respect to Products that are bundled with other third-party products or where we expressly provide that the limitations set forth in this subparagraph do not apply".

Verdicts: private VM `GREY` (medium): the computers must "belong to the same
owner" and transfers go "to a computer or computers you own" — a rented VM
fails the letter of both. Separately, §5 makes every free product "Demo
Software" limited to evaluation unless Ample "expressly provide[s]" otherwise;
whether Ample's Lite product pages do so was not verified here — **read the
Lite product page before relying on Lite instruments in finished music at
all**. Multi-user `FORBIDDEN` (high): the timesharing / service-bureau clause is
the most explicit prohibition in this set.

### 17. Steven Slate Drums — SSD5.5 Free

Sources: SSD5.5 FAQ, 2019-07-27,
<https://support.stevenslatedrums.com/hc/en-us/articles/360033680113-SSD5-5-Frequently-Asked-Questions>
(read in the browser 2026-09-10). `stevenslatedrums.com` and
`stevenslateaudio.com` footers link only a privacy policy and a return policy
(checked 2026-09-10) — **no SSD EULA is published on the vendor's sites**.
Slate Digital's site carries "Audiotonix General Terms of Use",
<https://slatedigital.com/terms-of-service/> (fetched 2026-09-10), whose
applicability to Steven Slate Drums is NOT ADDRESSED.

- machines — FAQ: "Three iLok Licenses are provided with the purchase of SSD5."; "Can SSD5 be activated with iLok Cloud? A: Currently no."
- free product — FAQ: "Expansions can not be used in SSD5 Free."
- server / hosted (Audiotonix terms, §6, if they apply) — prohibited use "on a service bureau basis, on a time-sharing basis, as a part of a hosted service".
- licensee-only (Audiotonix §3.1) — "non-exclusive, limited, revocable right for you to install, access and use", "cannot be shared".
- commercial, transfer — Audiotonix §3.1 "non-transferable"; §3.8: free access terminable "at any time".

Verdicts: private VM `GREY` (confidence **none**): the governing SSD5 Free EULA
is shown only in the installer and was not accepted or read here. Multi-user
`FORBIDDEN` (low, policy default; high if the Audiotonix hosted-service clause
governs).

### 18. Soundpaint — free engine and free instruments

Sources: Terms & Conditions,
<https://soundpaint.com/pages/terms-conditions> (read in the browser
2026-09-10) — website terms whose only product clause is §14; Free Engine page
<https://soundpaint.com/pages/free-engine-v2> ("FREE ENGINE FOR LIFE", no
licence text); 8Dio Licensing Agreement (same company, 8Dio Productions LLC),
<https://8dio.com/pages/licensing-agreement> (fetched 2026-09-10), which does
not name Soundpaint.

- machines (8Dio) — "You may use this product on up to two (2) separate computers, which computers shall be owned and used by you exclusively."
- licensee-only (8Dio) — "The license for this product is granted only to a single user."
- server / VM / cloud — NOT ADDRESSED in either document.
- third-party (soundpaint.com §3) — "Any user ID and password you may have for this Website are confidential and you must maintain confidentiality of such information."
- commercial (8Dio) — "for commercial and non-commercial use in music, sound-effect, audio/video post-production, performance, broadcast or similar finished content-creation and production use."
- transfer (8Dio) — "This license is nontransferable and expressly forbids resale or lease of the product."
- AI (soundpaint.com §14) — "The use of any instruments, samples or audio content provided by 8Dio Productions LLC, whether standalone or incorporated within musical compositions, for the intention of training" AI "is expressly and categorically forbidden."

Verdicts: private VM `GREY` (low): the only product licence found is 8Dio's,
with the same "owned … by you" wording as Sonixinema, and it is not certain it
governs Soundpaint. Multi-user `FORBIDDEN` (medium): single user.

### 19. Decent Sampler — the plugin

Sources: Q&A "What license is Decent Sampler under?",
<https://www.decentsamples.com/qa/27/what-license-is-decent-sampler-under>
(read in the browser 2026-09-10): the 2021-06-04 answer addresses selling
libraries; a 2022-03-27 comment asks "Can you please answer about the specific
license this software is under" and is unanswered. Plugin page
<https://www.decentsamples.com/product/decent-sampler-plugin/> states it is free.

- every field — NOT ADDRESSED: the plugin ships without a published EULA.

Verdicts: private VM `GREY` (confidence **none**). Multi-user `FORBIDDEN`
(low, policy default).

### 20. Decent Samples libraries and Pianobook packs

Sources: Decent Samples End User License Agreement ("Plain English License",
undated),
<https://www.decentsamples.com/decent-samples-end-user-license-agreement/>
(read in the browser 2026-09-10); Pianobook END USER LICENSE AGREEMENT & TERMS,
"Updated 25th April 2022", <https://www.pianobook.co.uk/terms-conditions/>;
Pianobook FAQ
<https://www.pianobook.co.uk/faq/are-pianobook-sample-packs-royalty-free-or-free-for-commercial-use/>;
pack pages `packs/expressive-duduk/` and `packs/complexe/` (all fetched
2026-09-10).

Decent Samples:
- commercial — "use any sample library downloaded from this site in any music or video composition you wish, be it commercial or freely available".
- transfer / redistribution — "You may not redistribute any of the samples or sample libraries on their own, unless you have been given written permission by Decidedly, LLC."; a composition must combine samples "with at least one other audio source".
- machines, licensee-only, server / VM, third-party — NOT ADDRESSED.

Pianobook:
- machines — NOT ADDRESSED.
- licensee-only — §1: "licence is granted to only the individual person registering or making such purchase and … such licence is not transferable"; §6: "use the Products solely for your own personal use".
- server / VM / cloud — NOT ADDRESSED.
- third-party — §5: "You may not sell any Product(s), or give away any Product(s) for use by any other person(s)".
- commercial — The Basics: "you have license to use them on commercial and non-commercial recordings and compositions you create".
- transfer — §5: "This license expressly forbids resale or other distribution of the Products or their derivatives".
- per-pack variety — §10: "You are responsible for any and all content you upload to the Pianobook site"; FAQ: "It is forbidden to sell or redistribute the sample libraries that you do not own the copyright to." The two pack pages sampled show **no per-pack licence field**; the site EULA is the only licence text, and the site "cannot guarantee sample packs uploaded to this site are copyright free" (FAQ).

Verdicts: private VM `GREY` (medium) for both: nothing on machines or servers.
Multi-user `FORBIDDEN`: high for Pianobook ("solely for your own personal
use"), low for Decent Samples (silent; policy default).

### 21. Vienna Symphonic Library — Big Bang Orchestra Free Basics

Source: Terms of License, dated "August 26, 2026",
<https://www.vsl.co.at/legals/license> (fetched 2026-09-10).

- machines — "(a) install the Software on one or more computers, (b) transfer the Software from one computer to another provided that it is used only by the licensee".
- licensee-only — "a non-exclusive, perpetual license to use the Software for your own personal use and not for sublicense".
- server / VM / cloud — NOT ADDRESSED beyond the network clause below.
- third-party / networked — prohibited: "install or electronically transfer the Software or Sounds of the Software on a network for use by multiple users, unless each user has purchased a license".
- commercial — "You may use the Software on any commercial music release (including music libraries), public performance, broadcast, or similar occasion … without paying any additional license fees."
- transfer — "(d) transfer the Software to another party, subject to Licensor's prior written consent and payment of the applicable handling charge".
- AI — "The use of the Software for the development, training, or enhancement of artificial intelligence systems, including but not limited to machine learning models … is strictly prohibited."
- BBO Free Basics by name — NOT ADDRESSED; iLok — NOT ADDRESSED in the licence (the product page requires an iLok account).

Verdicts: private VM `PERMITTED` (medium-high): "one or more computers …
provided that it is used only by the licensee" is the most permissive device
clause in the set. Multi-user `NEEDS_COMMERCIAL_LICENCE` (high): "unless each
user has purchased a license".

### 22. MT Power Drum Kit 2 (Manda Audio)

Sources: download page <https://www.powerdrumkit.com/download76187.php>
("By downloading, you agree to the EULA"; the EULA link is `javascript:;`),
legal notice <https://www.powerdrumkit.com/legal-notice.php> (an imprint:
"Daniel Mitschang-Manda, Kurt-Schumacher-Str. 8c, 76187 Karlsruhe, Germany"),
homepage <https://www.powerdrumkit.com/> ("FREE", no licence text) — all
fetched 2026-09-10.

- every field — NOT FETCHED: the EULA exists only behind the download action / inside the installer and was not accepted here.

Verdicts: private VM `GREY` (confidence **none**). Multi-user `FORBIDDEN`
(none, policy default).

### 23. Steinberg — HALion Sonic / Groove Agent SE content bundled with Cubase 14

Sources: Steinberg Software End User License Agreement (EULA) with Account
Terms and Conditions of Use (undated),
<https://download.steinberg.net/legal/eula/EULA_English.html> (fetched
2026-09-10); help-centre article "Steinberg Activation Manager: Activation
Limit Reached (No seats)",
<https://helpcenter.steinberg.de/hc/en-us/articles/4412568514706-Steinberg-Activation-Manager-Activation-Limit-Reached-No-seats>
(read in the browser 2026-09-10).

- machines — §2.3: "activate the software only on a limited number of computers (see the FAQ on the Steinberg website for the number)"; help centre: "A Steinberg license can be activated via Steinberg Activation Manager on up to three computers simultaneously."
- licensee-only — §2.3: "the software must only be used by a single user (single-user license)"; §2.9: "you are the only user if you have obtained a single user license".
- server / VM / cloud — NOT ADDRESSED (the only cloud clauses, §4.4 and §9.2, concern Steinberg's own servers and VST Transit).
- third-party — §2.1: "You may not lease, loan or sublicense the software"; §3.6 forbids sharing the Steinberg Account "with other users".
- commercial / content — §2.2: samples are "licensed by Steinberg to you only for use in the creation of a live or recorded performance that includes the licensed samples"; "The samples may not be included … in any sample library product"; §2.6 (educational versions only): "this software may not be used for commercial purposes".
- transfer — §10.1: "Any products issued free of charge, Trial Version Software and software referred to as not-for-resale (NFR) may not be assigned".
- HALion Sonic / Groove Agent by name — NOT ADDRESSED.

Verdicts: private VM `GREY` (medium): a single-user licence with three
simultaneous activations; the VM would take one seat via Steinberg Activation
Manager, which the licence allows for any computer, but servers and remote use
are unaddressed. The content plays only inside HALion Sonic / Groove Agent SE,
so the VM needs the Cubase 14 licence activated on it, not just the content.
Multi-user `FORBIDDEN` (high): "must only be used by a single user".

## What changes for a multi-user deployment

If the platform is used by anyone but the owner — a second account, a public
demo, a paid tier — **no product in this table may be rendered for them on a
shared worker**. Concretely:

- The five vendors with a named path (NI per-user licences, OT consent,
  Sonuscore multiuser licence, Fracture "special arrangements", VSL per-user
  purchase) would each need a written agreement before a shared worker offers
  their sounds; the free Player-library model (a licence in each user's own NI
  account) does not map onto one server account at all.
- The others forbid it in terms; a multi-user platform must not offer them,
  full stop.
- The AI-training clauses apply regardless of user count.
- Q-13's "licensed instrument catalogue whose every asset passes a
  cloud-rendering rights review" therefore splits into two catalogues: the
  owner's private VM catalogue (this table's `PERMITTED`/`GREY` rows, after the
  vendor questions below are answered) and a public catalogue that today
  contains only the open-licence Tier CLOUD assets of `free-sound-libraries.md`.

## Questions worth one e-mail each (the GREY rows that a sentence would settle)

1. Audio Imperia: is a single-user Windows VM the licensee alone can reach a "local hard drive" for GLADE?
2. Sonixinema / 8Dio (Soundpaint): does "owned and used by you exclusively" admit a rented machine used by nobody else?
3. Ample Sound: are the Lite instruments "Demo Software" under §5, and is a rented VM a computer "you own"?
4. Emergence Audio: is a single-user VM a "personal device"?
5. Manda Audio, Steven Slate Drums, Decent Samples: where is the plugin EULA published?
6. Native Instruments, Steinberg, Orchestral Tools, Sonuscore: any objection to a single-user virtual machine as one of the licensed computers?

## Honest limits

- Every quote was extracted through a fetch-and-summarise tool or read in a
  browser pane on 2026-09-10; the ≤ 25-word fragments were checked against the
  returned text, but the surrounding sentences were not always visible, so a
  fragment can be accurate and still miss a qualifier elsewhere in the document.
  Read the full page before acting on any row.
- Three licences were not fetched at all (MT Power, SSD5 Free, Decent Sampler
  plugin) because they are shown only inside installers or are unpublished;
  their rows are verdicts about *absence of text*, not about the text.
- "Fetched" means the public page; several vendors present a different or
  longer EULA inside Native Access, the Spitfire App, SINE or iLok at install
  time, which this survey did not accept and therefore did not read.
- The Spitfire EULA was read at `/en-us/pages/...`; the older `/info/eula`
  path now serves the privacy policy, and LABS' own domain redirects to Splice —
  the LABS terms may have moved with it.
- The NI device count differs between the EULA (three) and the support
  article (two, three for Komplete); which one Native Access enforces for a
  Komplete Start account was not tested.
- Whether Native Access, the Spitfire App, SINE, Soundpaint and iLok run on
  **Windows Server** (the pay-as-you-go image on Azure/AWS) was not verified
  here — the NI compatibility article could not be fetched; the runbook treats
  it as the first thing to test on a trial hour, and lists Kamatera's Windows
  11 image as the alternative.
- This is a clause table, not legal advice; the platform's own policy choices
  (silence = multi-user forbidden; no training on AI-restricted renders) are
  labelled as such.
