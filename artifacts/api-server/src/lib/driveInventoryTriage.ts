/**
 * Owner-drive inventory triage (PR-96, `owner-drive-inventory`).
 *
 * The owner described drive `D:` as "samples I personally recorded". A
 * read-only survey found a 2.86 TB folder of vendor sound libraries in vendor
 * formats, mostly as multi-part archives. This module is the pure half of the
 * catalogue: folder observations (names, extensions, archive part names,
 * sizes) in, a rights triage out. It never touches the disk.
 *
 * The rules it applies are the platform's, and they are absolute:
 *
 *  - A vendor library is `THIRD_PARTY_COMMERCIAL`. The platform may use it
 *    **only** through the vendor's own host, activated in the owner's own
 *    vendor account on his machine. Archives on a drive are irrelevant to
 *    that path: with a licence the vendor app downloads and authorises the
 *    library; without one nothing here may be used.
 *  - A vendor sample pack (WAV / MIDI) is `THIRD_PARTY_PACK`, under the pack's
 *    own terms. Cymatics, Splice and Toontrack forbid AI training outright;
 *    musical use is a separate question the pack licence answers.
 *  - Cloud rendering of any third-party material is forbidden pending the
 *    vendor EULA (Stream CLOUD-VM compiles those). This module cannot lift it.
 *  - Only material that is genuinely the owner's own recording — raw takes,
 *    DAW session folders, stems, with no vendor readme / licence / format —
 *    may be `OWNER_RECORDED_CANDIDATE`. *Candidate*: the owner still has to
 *    confirm each folder before the OWNER-SAMPLES pipeline touches it.
 *  - Anything the rules cannot place is `UNKNOWN`, never a default to "ours".
 *
 * Folder names are treated as data: a vendor product under a made-up folder
 * name is still the vendor's product, and the classifier reads the file
 * formats as well as the names for that reason.
 *
 * Nothing here judges how the owner obtained anything, and nothing here is
 * legal advice.
 */

export type RightsClass =
  | "THIRD_PARTY_COMMERCIAL"
  | "THIRD_PARTY_PACK"
  | "OWNER_RECORDED_CANDIDATE"
  | "UNKNOWN";

export const RIGHTS_CLASSES: readonly RightsClass[] = [
  "THIRD_PARTY_COMMERCIAL",
  "THIRD_PARTY_PACK",
  "OWNER_RECORDED_CANDIDATE",
  "UNKNOWN",
];

/** The host a library needs. `KONTAKT_UNKNOWN_TIER` = Kontakt, tier not established from a primary source. */
export type HostRequirement =
  | "KONTAKT_FULL"
  | "KONTAKT_PLAYER"
  | "KONTAKT_UNKNOWN_TIER"
  | "NEXUS_3"
  | "UVI_FALCON"
  | "UVI_WORKSTATION_OR_FALCON"
  | "SUPERIOR_DRUMMER_3"
  | "EZDRUMMER"
  | "HALION_7"
  | "HALION_SONIC"
  | "GROOVE_AGENT_5"
  | "THE_GRAND_3"
  | "ABLETON_LIVE"
  | "ARTURIA_V_COLLECTION_OR_PIGMENTS"
  | "VOCALOID_EDITOR"
  | "SAMPLETANK_4"
  | "OUTPUT_PLUGIN"
  | "INITIAL_AUDIO_HEAT_UP"
  | "STEINBERG_HOST_UNSPECIFIED"
  | "RAW_WAV_MIDI"
  | "UNKNOWN";

/** The vendor application that legitimately installs and authorises the library. */
export type VendorApp =
  | "Native Access"
  | "Steinberg Download Assistant + Steinberg Activation Manager"
  | "Steinberg eLicenser (legacy, discontinued product)"
  | "Toontrack Product Manager"
  | "reFX Cloud"
  | "UVI Portal (+ iLok account)"
  | "IK Product Manager"
  | "Spitfire Audio App"
  | "Ableton (account > Packs, or Live's Browser)"
  | "Arturia Software Center"
  | "VOCALOID SHOP account + VOCALOID editor"
  | "Output Hub / Output account"
  | "Initial Audio account"
  | "Vendor account download after purchase"
  | "none (raw files)"
  | "unknown";

/** Whether the owner's Cubase 14 licence already covers the product. */
export type Cubase14Coverage =
  | "included"
  | "player_and_subset_included"
  | "not_included"
  | "not_applicable";

export type MiddleEasternRelevance = "core" | "useful" | "none";

/** One extension bucket as the scanner reports it. */
export type ExtensionCount = { ext: string; count: number; bytes: number | null };

/** What the read-only scan (or a survey) recorded about one top-level folder. */
export type FolderObservation = {
  /** The folder name exactly as it appears on the drive. */
  name: string;
  /** Absolute path as given; recorded, never normalised. */
  path?: string | null;
  bytes?: number | null;
  files?: number | null;
  extensions?: ExtensionCount[];
  /** Archive file names (relative), for part-numbering checks. */
  archiveNames?: string[];
  /** Relative names of readme / licence / eula / nfo / manual files seen. */
  docNames?: string[];
  /** Relative names that look like installers / activators / keygens. Never opened. */
  suspiciousNames?: string[];
  /** Sub-folder names (depth ≤ 2) where the scan captured them. */
  subDirs?: string[];
  /** Where the observation comes from; the evidence records it per row. */
  source?: "scan" | "lead-survey" | "root-listing";
};

export type VendorRule = {
  id: string;
  match: RegExp;
  vendor: string;
  product: string;
  host: HostRequirement;
  /** Kontakt tier and any host nuance, stated plainly. */
  hostNote: string;
  vendorApp: VendorApp;
  account: string;
  cubase14: Cubase14Coverage;
  rightsClass: Extract<RightsClass, "THIRD_PARTY_COMMERCIAL" | "THIRD_PARTY_PACK">;
  middleEastern: MiddleEasternRelevance;
  /** The platform's instrument families the product serves. */
  families: string[];
  /** Whether the vendor's terms are known to forbid AI training (Cymatics/Splice/Toontrack do). */
  aiTraining: "forbidden_by_vendor_terms" | "not_permitted_until_eula_read";
  /** Confidence in the host / tier claim: read from the vendor page, or from product knowledge only. */
  hostConfidence: "vendor_page" | "product_knowledge";
  note?: string;
};

// ---------------------------------------------------------------------------
// Vendor rules — name → host / rights. Order matters: specific before generic.
// ---------------------------------------------------------------------------

const NI = "Native Access" as const;

export const VENDOR_RULES: readonly VendorRule[] = [
  // --- Toontrack -----------------------------------------------------------
  {
    id: "toontrack-sd3", match: /superior\s*drummer\s*3|\bSD3\b|SL-SuperiorDrummer3/i,
    vendor: "Toontrack", product: "Superior Drummer 3 (core library)", host: "SUPERIOR_DRUMMER_3",
    hostNote: "Toontrack's own SD3 plugin; the core library is ~230 GB installed.",
    vendorApp: "Toontrack Product Manager", account: "Toontrack account with an SD3 licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["drums"], aiTraining: "forbidden_by_vendor_terms", hostConfidence: "product_knowledge",
    note: "Toontrack's EULA forbids using its sounds/MIDI as AI training material (PR-76 data-source registry).",
  },
  {
    id: "toontrack-ezd", match: /ez\s*drummer|EZD\d?\b|ezx\b/i,
    vendor: "Toontrack", product: "EZdrummer 2/3 (+ EZX expansions)", host: "EZDRUMMER",
    hostNote: "Toontrack's own EZdrummer plugin (version 2 or 3 — not visible from the folder name).",
    vendorApp: "Toontrack Product Manager", account: "Toontrack account with an EZdrummer licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["drums"], aiTraining: "forbidden_by_vendor_terms", hostConfidence: "product_knowledge",
  },
  // --- reFX ----------------------------------------------------------------
  {
    id: "refx-nexus", match: /\bnexus\s*[2-5]?\b/i,
    vendor: "reFX", product: "Nexus 3 (+ expansions)", host: "NEXUS_3",
    hostNote: "reFX Nexus 3 plugin; .nxs files are its factory / expansion content.",
    vendorApp: "reFX Cloud", account: "reFX account with a Nexus 3 licence and each expansion licensed separately",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["synth_lead", "synth_pad", "bass", "pluck"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Widely used for Mizrahi-pop synth leads; each expansion is a separate licence in reFX Cloud.",
  },
  // --- UVI -----------------------------------------------------------------
  {
    id: "uvi-falcon", match: /\bfalcon\s*2?\b/i,
    vendor: "UVI", product: "Falcon 2 (+ factory content)", host: "UVI_FALCON",
    hostNote: "UVI Falcon 2 (iLok-protected). Falcon expansions also run in the free UVI Workstation only when sold as such.",
    vendorApp: "UVI Portal (+ iLok account)", account: "UVI account + iLok account with a Falcon licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["synth_lead", "synth_pad", "keys"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  { id: "uvi-generic", match: /\bUVI\b/i, vendor: "UVI", product: "UVI library (product not identified)", host: "UVI_WORKSTATION_OR_FALCON",
    hostNote: "UVI Workstation (free) or Falcon, per product.", vendorApp: "UVI Portal (+ iLok account)", account: "UVI account + iLok account",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  // --- Steinberg -----------------------------------------------------------
  {
    id: "steinberg-halion7", match: /halion[\s_-]*7|halion[\s_-]*complete/i,
    vendor: "Steinberg", product: "HALion 7 — complete content", host: "HALION_7",
    hostNote: "HALion 7 (full sampler). Cubase 14 Pro ships HALion Sonic 7 (the player) with its own content, not the HALion 7 full-content set.",
    vendorApp: "Steinberg Download Assistant + Steinberg Activation Manager", account: "Steinberg ID with a HALion 7 licence (Cubase 14 alone is not one)",
    cubase14: "player_and_subset_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys", "synth_pad", "synth_lead", "strings", "world"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "The owner owns Cubase 14: HALion Sonic 7 and its factory content are already his; HALion 7 content (.vstsound) needs a HALion 7 licence.",
  },
  {
    id: "steinberg-halion-sonic", match: /halion\s*sonic/i,
    vendor: "Steinberg", product: "HALion Sonic 3 content", host: "HALION_SONIC",
    hostNote: "HALion Sonic (3, or 7 as included with Cubase 14). Sonic 3's purchasable content sets are separate licences; the factory 'Selection' content ships with Cubase.",
    vendorApp: "Steinberg Download Assistant + Steinberg Activation Manager", account: "Steinberg ID (Cubase 14 licence covers HALion Sonic 7 + its factory content; extra content sets need their own licence)",
    cubase14: "player_and_subset_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys", "synth_pad", "world"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "steinberg-groove-agent", match: /groove\s*agent/i,
    vendor: "Steinberg", product: "Groove Agent 5 content", host: "GROOVE_AGENT_5",
    hostNote: "Groove Agent 5 (full). Cubase 14 includes Groove Agent SE 5 with its own kits; the full Groove Agent 5 content needs a Groove Agent 5 licence.",
    vendorApp: "Steinberg Download Assistant + Steinberg Activation Manager", account: "Steinberg ID with a Groove Agent 5 licence (Cubase 14 = SE only)",
    cubase14: "player_and_subset_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["drums", "percussion"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "steinberg-the-grand", match: /the\s*grand\s*3/i,
    vendor: "Steinberg", product: "The Grand 3", host: "THE_GRAND_3",
    hostNote: "The Grand 3 is discontinued and stayed on the legacy eLicenser; it was never moved to Steinberg Licensing and is not part of Cubase 14.",
    vendorApp: "Steinberg eLicenser (legacy, discontinued product)", account: "Steinberg ID with a The Grand 3 licence on a USB-eLicenser; otherwise unavailable",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Cubase 14's own pianos (HALion Sonic 7 content, Iconica Sketch) are the licensed alternative.",
  },
  { id: "steinberg-generic", match: /steinberg|\bcubase\b|\bnuendo\b|iconica|absolute\s*[5-7]/i, vendor: "Steinberg", product: "Steinberg content (product not identified)", host: "STEINBERG_HOST_UNSPECIFIED",
    hostNote: "A Steinberg host; which one depends on the product.", vendorApp: "Steinberg Download Assistant + Steinberg Activation Manager", account: "Steinberg ID",
    cubase14: "player_and_subset_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  // --- Native Instruments --------------------------------------------------
  {
    id: "ni-middle-east", match: /^(NI\s*[-_ ]*)?middle\s*east\b/i,
    vendor: "Native Instruments", product: "Discovery Series: Middle East", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (Discovery Series). Oud, kanun, saz, santur, ney, darbuka, riq, daf and phrases.",
    vendorApp: NI, account: "Native Instruments account with the Middle East licence (sold alone or in Komplete Ultimate)",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "core",
    families: ["world_plucked", "world_winds", "percussion"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "ni-session-strings", match: /session\s*strings/i,
    vendor: "Native Instruments", product: "Session Strings Pro 2", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NI's own library).",
    vendorApp: NI, account: "Native Instruments account with the Session Strings Pro 2 licence (or Komplete Ultimate)",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["strings"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Pop strings — the Mizrahi ballad string section lives here or in Albion NEO.",
  },
  {
    id: "ni-kontakt-factory", match: /kontakt\s*factory\s*library\s*2|factory\s*library\s*2/i,
    vendor: "Native Instruments", product: "Kontakt Factory Library 2", host: "KONTAKT_FULL",
    hostNote: "Ships with Kontakt 7/8 (full); it is not a Player library and is not in Komplete Start.",
    vendorApp: NI, account: "Native Instruments account with a Kontakt 7/8 (full) licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys", "strings", "world", "percussion", "synth_pad"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Contains a World section (incl. Middle-Eastern instruments) — the full Kontakt licence also unlocks TAQSIM Free (free-sound-libraries.md).",
  },
  { id: "ni-generic", match: /native\s*instruments|\bkomplete\b|^NI[\s_-]/i, vendor: "Native Instruments", product: "NI library (product not identified)", host: "KONTAKT_UNKNOWN_TIER",
    hostNote: "Kontakt; Player vs full depends on the product.", vendorApp: NI, account: "Native Instruments account",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  // --- Kontakt-Player third parties ---------------------------------------
  {
    id: "spitfire-albion-neo", match: /albion\s*neo/i,
    vendor: "Spitfire Audio", product: "Albion NEO", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS); installed through Native Access after the Spitfire account issues the serial.",
    vendorApp: "Spitfire Audio App", account: "Spitfire Audio account with the Albion NEO licence → serial registered in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["strings", "woodwinds", "brass", "synth_pad"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Chamber-sized strings — a natural fit for the intimate Mizrahi ballad string bed.",
  },
  { id: "spitfire-generic", match: /spitfire/i, vendor: "Spitfire Audio", product: "Spitfire library (product not identified)", host: "KONTAKT_UNKNOWN_TIER",
    hostNote: "Kontakt Player or the Spitfire plugin, per product.", vendorApp: "Spitfire Audio App", account: "Spitfire Audio account",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: ["strings"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  {
    id: "audio-imperia-jaeger", match: /\bjaeger\b/i,
    vendor: "Audio Imperia", product: "Jaeger", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS).", vendorApp: NI, account: "Audio Imperia account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["strings", "brass", "percussion", "choir"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "audio-imperia-nucleus", match: /\bnucleus\b/i,
    vendor: "Audio Imperia", product: "Nucleus", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS).", vendorApp: NI, account: "Audio Imperia account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["strings", "brass", "woodwinds", "percussion", "choir"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "projectsam-swing-more", match: /swing\s*more/i,
    vendor: "ProjectSAM", product: "Swing More!", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible.", vendorApp: NI, account: "ProjectSAM account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["brass", "woodwinds", "drums", "keys"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  { id: "projectsam-generic", match: /project\s*sam/i, vendor: "ProjectSAM", product: "ProjectSAM library (product not identified)", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible.", vendorApp: NI, account: "ProjectSAM account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  {
    id: "isw-pearl", match: /pearl\s*concert\s*grand/i,
    vendor: "Impact Soundworks", product: "Pearl Concert Grand", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS).", vendorApp: NI, account: "Impact Soundworks account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Piano is the centre of the Mizrahi ballad; Cubase 14's HALion Sonic 7 pianos are the already-licensed alternative.",
  },
  { id: "isw-generic", match: /impact\s*soundworks/i, vendor: "Impact Soundworks", product: "Impact Soundworks library (product not identified)", host: "KONTAKT_UNKNOWN_TIER",
    hostNote: "Kontakt; Player vs full per product.", vendorApp: NI, account: "Impact Soundworks account",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  {
    id: "chris-hein-ensemble-strings", match: /chris\s*hein/i,
    vendor: "Best Service / Chris Hein", product: "Chris Hein — Ensemble Strings", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (Best Service releases are Player libraries).", vendorApp: NI, account: "Best Service account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["strings"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "best-service-ethno-world", match: /ethno\s*world\s*6?/i,
    vendor: "Best Service", product: "Ethno World 6 (Complete or Instruments)", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible. Oud, saz, bouzouki, kanun, santur, ney, duduk, zurna, darbuka, riq, bendir, and vocal phrases.",
    vendorApp: NI, account: "Best Service account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "core",
    families: ["world_plucked", "world_winds", "world_bowed", "percussion", "vocal_phrases"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "best-service-the-orchestra", match: /the\s*orchestra\s*(complete)?/i,
    vendor: "Best Service / Sonuscore", product: "The Orchestra Complete", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible.", vendorApp: NI, account: "Best Service account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["strings", "brass", "woodwinds", "percussion", "choir"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  { id: "best-service-generic", match: /best\s*service/i, vendor: "Best Service", product: "Best Service library (product not identified)", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible or Best Service Engine, per product.", vendorApp: NI, account: "Best Service account",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  {
    id: "cinesamples-cinebrass", match: /cine\s*brass/i,
    vendor: "Cinesamples", product: "CineBrass PRO", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS).", vendorApp: NI, account: "Cinesamples account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["brass"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Orchestral brass; the Mizrahi horn line is closer to pop/Balkan brass, so 'useful' not 'core'.",
  },
  { id: "cinesamples-generic", match: /cinesamples|cine\s*(strings|winds|perc|piano|harps)/i, vendor: "Cinesamples", product: "Cinesamples library (product not identified)", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible.", vendorApp: NI, account: "Cinesamples account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none", families: [], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge" },
  {
    id: "evolution-world-percussion", match: /world\s*percussion\s*2/i,
    vendor: "Evolution Series", product: "World Percussion 2.0", host: "KONTAKT_PLAYER",
    hostNote: "Kontakt Player-compatible (NKS). Darbuka, riq, frame drums, tabla, taiko, Latin and African percussion.",
    vendorApp: NI, account: "Evolution Series account → serial in Native Access",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "core",
    families: ["percussion"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  {
    id: "ilya-efimov-total-guitar", match: /ilya\s*efimov/i,
    vendor: "Ilya Efimov Production", product: "Total Guitar (acoustic / nylon / electric bundle)", host: "KONTAKT_FULL",
    hostNote: "Requires the FULL Kontakt — Ilya Efimov libraries are not Player-licensed.",
    vendorApp: "Vendor account download after purchase", account: "Ilya Efimov account + a Kontakt (full) licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["guitar", "nylon_guitar"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Nylon guitar is a Mizrahi staple; both the library and full Kontakt need licences.",
  },
  // --- Output ----------------------------------------------------------------
  {
    id: "output-engines", match: /^output\b|output\s*(essential\s*)?engines|\brev\b|\bexhale\b|\bsubstance\b|analog\s*(strings|brass)/i,
    vendor: "Output", product: "Output instruments (REV / Signal / Exhale / Substance / Analog Strings / Analog Brass & Winds)", host: "OUTPUT_PLUGIN",
    hostNote: "Output's Kontakt-Player-era engines run in Kontakt Player via Native Access; newer content is Arcade (subscription).",
    vendorApp: "Output Hub / Output account", account: "Output account with each engine licensed → serial in Native Access (or an Arcade subscription)",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["synth_pad", "strings", "brass", "vocal_phrases", "texture"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  // --- IK Multimedia ---------------------------------------------------------
  {
    id: "ik-sampletank", match: /sample\s*tank\s*4?|\bIK\s*multimedia\b/i,
    vendor: "IK Multimedia", product: "SampleTank 4 (+ sound content)", host: "SAMPLETANK_4",
    hostNote: "IK's own SampleTank 4 plugin (the free SampleTank 4 CS plays only its free content).",
    vendorApp: "IK Product Manager", account: "IK Multimedia account with a SampleTank 4 (SE/full/MAX) licence",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["keys", "bass", "drums", "strings", "world", "synth_pad"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "SampleTank 4 MAX carries a World section (oud, bouzouki, saz, darbuka among them).",
  },
  // --- Yamaha Vocaloid -------------------------------------------------------
  {
    id: "yamaha-vocaloid", match: /vocaloid/i,
    vendor: "Yamaha / voicebank publishers", product: "VOCALOID voice libraries", host: "VOCALOID_EDITOR",
    hostNote: "VOCALOID 5/6 editor; each voicebank is a separate licence from its publisher, activated in the VOCALOID account.",
    vendorApp: "VOCALOID SHOP account + VOCALOID editor", account: "Yamaha VOCALOID account with the editor and each voicebank licensed",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["vocal_synth"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Voicebanks are Japanese/English/Chinese/Korean/Spanish; none sings Hebrew. Useful for guide vocals only.",
  },
  // --- Ableton / Arturia -----------------------------------------------------
  {
    id: "ableton-packs", match: /ableton|live\s*1[0-2]\s*pack/i,
    vendor: "Ableton", product: "Live 11 Packs (Suite content)", host: "ABLETON_LIVE",
    hostNote: "Ableton Live 11/12; Suite packs are tied to the Live licence tier.",
    vendorApp: "Ableton (account > Packs, or Live's Browser)", account: "Ableton account with a Live 11/12 licence of the tier that includes the pack",
    cubase14: "not_applicable", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["drums", "synth_pad", "keys", "loops"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Ableton pack samples are royalty-free in music only inside Live; the platform's DAW is Cubase 14, so this content has no legitimate route into the platform.",
  },
  {
    id: "arturia-sound-banks", match: /arturia/i,
    vendor: "Arturia", product: "Sound banks for V Collection / Pigments / Analog Lab", host: "ARTURIA_V_COLLECTION_OR_PIGMENTS",
    hostNote: "Arturia instruments (V Collection, Pigments, Analog Lab); banks install per instrument.",
    vendorApp: "Arturia Software Center", account: "Arturia account with the instrument (and the bank, when sold) licensed",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "useful",
    families: ["synth_lead", "synth_pad", "keys", "organ"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Analog synth leads and organs (Farfisa/Vox-type) are part of the classic Mizrahi palette.",
  },
  // --- Initial Audio ---------------------------------------------------------
  {
    id: "initial-audio-heat-up", match: /heat\s*up/i,
    vendor: "Initial Audio", product: "Heat Up 3 instruments / expansions", host: "INITIAL_AUDIO_HEAT_UP",
    hostNote: "Initial Audio's Heat Up 3 plugin; expansions licensed per pack.",
    vendorApp: "Initial Audio account", account: "Initial Audio account with Heat Up 3 and each expansion licensed",
    cubase14: "not_included", rightsClass: "THIRD_PARTY_COMMERCIAL", middleEastern: "none",
    families: ["keys", "synth_lead", "bass", "pluck"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
  },
  // --- Sample-pack publishers (THIRD_PARTY_PACK) ----------------------------
  {
    id: "pack-cymatics", match: /cymatics/i,
    vendor: "Cymatics", product: "Cymatics sample / MIDI packs", host: "RAW_WAV_MIDI",
    hostNote: "Raw WAV / MIDI; any sampler or DAW.", vendorApp: "Vendor account download after purchase", account: "Cymatics account (free packs need the account too)",
    cubase14: "not_applicable", rightsClass: "THIRD_PARTY_PACK", middleEastern: "none",
    families: ["drums", "loops", "melodic_loops"], aiTraining: "forbidden_by_vendor_terms", hostConfidence: "product_knowledge",
    note: "Cymatics' licence: royalty-free inside a musical work; explicitly no AI/ML training, no resale of samples.",
  },
  {
    id: "pack-splice", match: /\bsplice\b/i,
    vendor: "Splice", product: "Splice sample packs", host: "RAW_WAV_MIDI",
    hostNote: "Raw WAV / MIDI.", vendorApp: "Vendor account download after purchase", account: "Splice subscription; each sample must have been downloaded with credits from the owner's account",
    cubase14: "not_applicable", rightsClass: "THIRD_PARTY_PACK", middleEastern: "none",
    families: ["drums", "loops"], aiTraining: "forbidden_by_vendor_terms", hostConfidence: "product_knowledge",
  },
  {
    id: "pack-mizrahi-latin", match: /urban\s*singh|midilatino|dave\s*parkinson|tomorrowland|psy[\s-]*trance|goa\s*trance|\bloopmasters\b|sample\s*magic|vengeance|\bproducer\s*loops\b|black\s*octopus|ghosthack|\bw\.?a\.?\s*production\b/i,
    vendor: "Sample-pack publisher", product: "Commercial sample pack (publisher named in the folder)", host: "RAW_WAV_MIDI",
    hostNote: "Raw WAV / MIDI; any sampler or DAW.", vendorApp: "Vendor account download after purchase", account: "The publisher's or the marketplace's account with the pack purchased",
    cubase14: "not_applicable", rightsClass: "THIRD_PARTY_PACK", middleEastern: "useful",
    families: ["drums", "loops", "melodic_loops"], aiTraining: "not_permitted_until_eula_read", hostConfidence: "product_knowledge",
    note: "Loopmasters forbids AI training (PR-76); the others' terms are unread — treat as not permitted until read.",
  },
];

// ---------------------------------------------------------------------------
// Format signals
// ---------------------------------------------------------------------------

/** Vendor container formats: their presence alone says "a vendor's library", whatever the folder is called. */
export const VENDOR_FORMATS: Readonly<Record<string, HostRequirement>> = {
  ".nkx": "KONTAKT_UNKNOWN_TIER", ".nki": "KONTAKT_UNKNOWN_TIER", ".nkm": "KONTAKT_UNKNOWN_TIER", ".nkc": "KONTAKT_UNKNOWN_TIER",
  ".nkr": "KONTAKT_UNKNOWN_TIER", ".ncw": "KONTAKT_UNKNOWN_TIER", ".nicnt": "KONTAKT_UNKNOWN_TIER",
  ".nxs": "NEXUS_3", ".nxp": "NEXUS_3", ".nxb": "NEXUS_3",
  ".vstsound": "STEINBERG_HOST_UNSPECIFIED",
  ".ufs": "UVI_WORKSTATION_OR_FALCON", ".uvip": "UVI_WORKSTATION_OR_FALCON",
  ".obw": "EZDRUMMER",
  ".vpr": "VOCALOID_EDITOR", ".vsqx": "VOCALOID_EDITOR", ".vvd": "VOCALOID_EDITOR", ".ddb": "VOCALOID_EDITOR",
  ".alp": "ABLETON_LIVE", ".adg": "ABLETON_LIVE", ".adv": "ABLETON_LIVE",
  ".st4": "SAMPLETANK_4", ".st4i": "SAMPLETANK_4",
};

const AUDIO_FORMATS = new Set([".wav", ".aif", ".aiff", ".flac", ".caf", ".w64", ".rf64"]);
const MIDI_FORMATS = new Set([".mid", ".midi"]);
/** DAW session files. Their presence beside raw audio is the strongest "owner's own work" signal a scan can give. */
const DAW_SESSION_FORMATS = new Set([".cpr", ".bak", ".npr", ".als", ".flp", ".ptx", ".ptf", ".logicx", ".rpp", ".song", ".cwp"]);
const ARCHIVE_FORMATS = new Set([".rar", ".zip", ".7z", ".iso", ".dmg", ".tar", ".gz"]);
/** Sample-pack conventions in file / folder names — a WAV folder with these is a pack, not a take. */
const PACK_NAME_PATTERN = /\b(sample\s*pack|drum\s*kit|one[\s-]*shots?|loops?\s*pack|construction\s*kit|midi\s*pack|preset\s*pack|royalty[\s-]*free)\b/i;

export const VENDOR_DOC_PATTERN = /readme|licen[cs]e|eula|terms|manual|\.nfo$|install(ation)?\s*(guide|notes)|copyright/i;
/** Names that look like installers, activators, keygens. Listed, never opened. */
export const NOT_OPENED_PATTERN = /keygen|crack|patch(er)?\b|activat|r2r\b|\.exe$|\.dll$|\.bat$|\.cmd$|\.msi$|\.reg$/i;

// ---------------------------------------------------------------------------
// Archive part numbering
// ---------------------------------------------------------------------------

export type ArchiveSet = {
  base: string;
  scheme: "partNNN" | "rNN" | "NNN" | "single";
  parts: number[];
  highestSeen: number;
  /** Numbers missing between the lowest and the highest part seen. */
  gaps: number[];
  /**
   * `no_gaps_seen` means the numbering is contiguous; whether the LAST part is
   * really the last cannot be known from names alone (only a `7z l` of the
   * set can tell), so no set is ever called "complete" here.
   */
  completeness: "no_gaps_seen" | "gaps" | "single_file";
};

const PART_PATTERNS: Array<{ scheme: ArchiveSet["scheme"]; re: RegExp }> = [
  { scheme: "partNNN", re: /^(.*)\.part(\d+)\.rar$/i },
  { scheme: "rNN", re: /^(.*)\.r(\d{2,3})$/i },
  { scheme: "NNN", re: /^(.*\.(?:7z|zip|rar|bin|iso))\.(\d{3})$/i },
];

export function analyseArchiveSets(names: readonly string[]): ArchiveSet[] {
  const sets = new Map<string, ArchiveSet>();
  const singles: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\\/g, "/").split("/").pop() ?? raw;
    let matched = false;
    for (const { scheme, re } of PART_PATTERNS) {
      const m = name.match(re);
      if (!m) continue;
      matched = true;
      const key = `${scheme}:${m[1].toLowerCase()}`;
      const n = Number(m[2]);
      const set = sets.get(key) ?? { base: m[1], scheme, parts: [], highestSeen: 0, gaps: [], completeness: "no_gaps_seen" };
      set.parts.push(n);
      sets.set(key, set);
      break;
    }
    if (!matched) {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (ARCHIVE_FORMATS.has(ext)) {
        // A bare `X.rar` beside `X.r00…` is the head of an rNN set.
        const stem = name.slice(0, dot);
        const rnnKey = `rNN:${stem.toLowerCase()}`;
        const rnn = sets.get(rnnKey);
        if (rnn && ext === ".rar") { rnn.parts.push(0); continue; }
        singles.push(name);
      }
    }
  }
  const out: ArchiveSet[] = [];
  for (const set of sets.values()) {
    const parts = [...new Set(set.parts)].sort((a, b) => a - b);
    const lowest = parts[0];
    const highest = parts[parts.length - 1];
    const gaps: number[] = [];
    for (let n = lowest; n <= highest; n++) if (!parts.includes(n)) gaps.push(n);
    out.push({ ...set, parts, highestSeen: highest, gaps, completeness: gaps.length > 0 ? "gaps" : "no_gaps_seen" });
  }
  for (const single of singles) {
    out.push({ base: single, scheme: "single", parts: [1], highestSeen: 1, gaps: [], completeness: "single_file" });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base));
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export type TriageRow = {
  folder: string;
  path: string | null;
  source: FolderObservation["source"];
  vendor: string | null;
  product: string | null;
  /** Version when the folder name shows one (e.g. "3", "6", "2.0"); null otherwise. */
  version: string | null;
  hostRequired: HostRequirement;
  hostNote: string;
  hostConfidence: VendorRule["hostConfidence"] | "format_inference" | "none";
  formats: string[];
  bytes: number | null;
  files: number | null;
  archive: { sets: ArchiveSet[]; partFiles: number; anyGaps: boolean; note: string };
  rightsClass: RightsClass;
  /** Which rule decided, or which format / heuristic did. */
  decidedBy: string;
  relevance: { families: string[]; middleEastern: MiddleEasternRelevance };
  legitimatePath: { vendorApp: VendorApp; account: string; cubase14: Cubase14Coverage; instruction: string };
  cloudRendering: "FORBIDDEN_PENDING_VENDOR_EULA" | "OWNER_DECISION_AFTER_CONFIRMATION" | "UNDECIDED";
  aiTraining: VendorRule["aiTraining"] | "owner_decision_after_confirmation" | "undecided";
  notOpened: string[];
  flags: string[];
};

const versionFrom = (name: string): string | null => {
  const m = name.match(/(?:^|[\s_-])v?(\d+(?:\.\d+)?)(?=$|[\s_\-)])/i);
  return m ? m[1] : null;
};

export function matchVendorRule(name: string): VendorRule | null {
  for (const rule of VENDOR_RULES) if (rule.match.test(name)) return rule;
  return null;
}

const extensionSet = (obs: FolderObservation): Map<string, ExtensionCount> => {
  const map = new Map<string, ExtensionCount>();
  for (const e of obs.extensions ?? []) map.set(e.ext.toLowerCase(), e);
  return map;
};

const share = (exts: Map<string, ExtensionCount>, pick: (ext: string) => boolean): { byCount: number; byBytes: number | null } => {
  let count = 0, total = 0, bytes = 0, totalBytes = 0, bytesKnown = true;
  for (const [ext, e] of exts) {
    total += e.count;
    if (e.bytes === null || e.bytes === undefined) bytesKnown = false; else totalBytes += e.bytes;
    if (pick(ext)) { count += e.count; if (e.bytes !== null && e.bytes !== undefined) bytes += e.bytes; }
  }
  return { byCount: total ? count / total : 0, byBytes: bytesKnown && totalBytes ? bytes / totalBytes : null };
};

function instruction(rule: VendorRule | null, rights: RightsClass): string {
  if (rights === "OWNER_RECORDED_CANDIDATE") {
    return "The owner confirms in writing that every file in the folder is his own recording (or names the session it came from); only then does the OWNER-SAMPLES pipeline ingest it. The archives on the drive play no part.";
  }
  if (rights === "UNKNOWN") {
    return "Not classifiable from names and formats. The owner identifies the folder (his own session, or a product and its vendor); until then it is not used.";
  }
  if (!rule) return "Identify the vendor; then the vendor app / account rule applies.";
  const cubase =
    rule.cubase14 === "player_and_subset_included"
      ? " Cubase 14 already includes the player and its factory content — use that; the extra content set needs its own licence."
      : rule.cubase14 === "included"
        ? " Already included in Cubase 14."
        : "";
  if (rule.rightsClass === "THIRD_PARTY_PACK") {
    return `Only samples the owner downloaded from ${rule.vendorApp === "Vendor account download after purchase" ? "the publisher's own account" : rule.vendorApp} under his own licence may be used, under that pack's terms; the copies on this drive are not that proof. Nothing is rendered in the cloud until the pack licence is read.${rule.aiTraining === "forbidden_by_vendor_terms" ? " AI training on this material is forbidden by the vendor." : ""}`;
  }
  return `Install through ${rule.vendorApp} signed in to the owner's ${rule.account}; the vendor app downloads and authorises the library on the owner's machine (PR-21 local render worker). The archives on this drive are not part of that path: with a licence they are unnecessary, without one nothing may be used.${cubase} Cloud rendering: forbidden pending the vendor EULA.`;
}

/** Classify one folder observation. Pure; never reads the disk. */
export function triageFolder(obs: FolderObservation): TriageRow {
  const flags: string[] = [];
  const exts = extensionSet(obs);
  const formats = [...exts.keys()].sort();
  const archiveNames = obs.archiveNames ?? [];
  const sets = analyseArchiveSets(archiveNames);
  const anyGaps = sets.some((s) => s.completeness === "gaps");
  const partFiles = sets.reduce((n, s) => n + s.parts.length, 0);
  const docs = (obs.docNames ?? []).filter((d) => VENDOR_DOC_PATTERN.test(d));
  const notOpened = [...(obs.suspiciousNames ?? [])].filter((n) => NOT_OPENED_PATTERN.test(n));
  if (notOpened.length) flags.push("installer_or_activator_like_names_present_not_opened");

  const rule = matchVendorRule(obs.name);
  const vendorFormatHost = formats.map((f) => VENDOR_FORMATS[f]).find((h): h is HostRequirement => Boolean(h)) ?? null;

  let rights: RightsClass;
  let host: HostRequirement;
  let hostNote: string;
  let hostConfidence: TriageRow["hostConfidence"];
  let decidedBy: string;

  if (rule) {
    rights = rule.rightsClass;
    host = rule.host;
    hostNote = rule.hostNote;
    hostConfidence = rule.hostConfidence;
    decidedBy = `vendor rule ${rule.id}`;
    if (vendorFormatHost && vendorFormatHost !== rule.host && !(vendorFormatHost === "KONTAKT_UNKNOWN_TIER" && rule.host.startsWith("KONTAKT"))) {
      flags.push(`formats_suggest_${vendorFormatHost}_beside_${rule.host}`);
    }
  } else if (vendorFormatHost) {
    rights = "THIRD_PARTY_COMMERCIAL";
    host = vendorFormatHost;
    hostNote = "Vendor container format present; the vendor is not identified from the folder name.";
    hostConfidence = "format_inference";
    decidedBy = `vendor format ${formats.find((f) => VENDOR_FORMATS[f]) ?? "?"}`;
    flags.push("vendor_not_identified_from_name");
  } else {
    const audio = share(exts, (e) => AUDIO_FORMATS.has(e));
    const midi = share(exts, (e) => MIDI_FORMATS.has(e));
    const archives = share(exts, (e) => ARCHIVE_FORMATS.has(e) || /^\.(r\d\d|\d\d\d)$/.test(e));
    const daw = formats.some((f) => DAW_SESSION_FORMATS.has(f));
    const packNamed = PACK_NAME_PATTERN.test(obs.name) || (obs.subDirs ?? []).some((d) => PACK_NAME_PATTERN.test(d));
    const presetFormats = formats.some((f) => [".fxp", ".fxb", ".vstpreset", ".h2p", ".nmsv", ".spf"].includes(f));
    if (formats.length === 0 && obs.files === null) {
      rights = "UNKNOWN"; host = "UNKNOWN"; hostNote = "No file-level observation."; hostConfidence = "none"; decidedBy = "no observation";
      flags.push("no_file_observation");
    } else if (archives.byCount > 0 || presetFormats) {
      rights = "UNKNOWN"; host = "UNKNOWN";
      hostNote = archives.byCount > 0 ? "Archives whose contents were not listed; an owner's session is not normally shipped as split archives." : "Plugin presets without an identified vendor.";
      hostConfidence = "none"; decidedBy = archives.byCount > 0 ? "unlisted archives" : "preset formats";
      flags.push(archives.byCount > 0 ? "archives_not_listed" : "presets_without_vendor");
    } else if (docs.length > 0 || packNamed) {
      rights = "UNKNOWN"; host = "RAW_WAV_MIDI";
      hostNote = docs.length ? "Raw files, but a readme / licence file is present — somebody published this." : "Raw files under a sample-pack naming convention.";
      hostConfidence = "format_inference"; decidedBy = docs.length ? "vendor-style documents present" : "pack naming convention";
      flags.push(docs.length ? "vendor_documents_present" : "pack_naming_convention");
    } else if (daw || (audio.byCount + midi.byCount >= 0.9 && (audio.byBytes === null || audio.byBytes >= 0.9))) {
      rights = "OWNER_RECORDED_CANDIDATE"; host = "RAW_WAV_MIDI";
      hostNote = daw ? "DAW session files beside raw audio — the shape of the owner's own work." : "Raw audio / MIDI only, no vendor format, no vendor document, no archive.";
      hostConfidence = "format_inference"; decidedBy = daw ? "DAW session files present" : "raw audio only";
      flags.push("owner_confirmation_required");
    } else {
      rights = "UNKNOWN"; host = "UNKNOWN"; hostNote = "Mixed formats with no vendor signal and no owner signal."; hostConfidence = "none"; decidedBy = "no rule";
    }
  }

  if (rights !== "OWNER_RECORDED_CANDIDATE" && !rule && docs.length === 0 && archiveNames.length === 0 && obs.source !== "scan") {
    flags.push("name_only_observation");
  }
  if (rule && obs.source !== "scan") flags.push("classified_from_name_and_survey_only");
  if (anyGaps) flags.push("archive_numbering_has_gaps");
  if (sets.length && !anyGaps) flags.push("archive_last_part_unverified");

  const vendorApp: VendorApp = rule ? rule.vendorApp : rights === "OWNER_RECORDED_CANDIDATE" ? "none (raw files)" : "unknown";
  const account = rule ? rule.account : rights === "OWNER_RECORDED_CANDIDATE" ? "the owner's own confirmation" : "unknown until the vendor is identified";
  const cubase14: Cubase14Coverage = rule ? rule.cubase14 : "not_applicable";

  return {
    folder: obs.name,
    path: obs.path ?? null,
    source: obs.source,
    vendor: rule ? rule.vendor : null,
    product: rule ? rule.product : null,
    version: versionFrom(obs.name),
    hostRequired: host,
    hostNote,
    hostConfidence,
    formats,
    bytes: obs.bytes ?? null,
    files: obs.files ?? null,
    archive: {
      sets,
      partFiles,
      anyGaps,
      note: sets.length
        ? anyGaps
          ? "Part numbering has gaps; the set cannot be complete."
          : "Part numbering contiguous from names; whether the last part is the last is unknown without a `7z l` listing."
        : "No archive files observed.",
    },
    rightsClass: rights,
    decidedBy,
    relevance: { families: rule ? rule.families : [], middleEastern: rule ? rule.middleEastern : "none" },
    legitimatePath: { vendorApp, account, cubase14, instruction: instruction(rule, rights) },
    cloudRendering: rights === "OWNER_RECORDED_CANDIDATE" ? "OWNER_DECISION_AFTER_CONFIRMATION" : rights === "UNKNOWN" ? "UNDECIDED" : "FORBIDDEN_PENDING_VENDOR_EULA",
    aiTraining: rule ? rule.aiTraining : rights === "OWNER_RECORDED_CANDIDATE" ? "owner_decision_after_confirmation" : "undecided",
    notOpened,
    flags,
  };
}

export type InventorySummary = {
  folders: number;
  byRightsClass: Record<RightsClass, number>;
  bytesByRightsClass: Record<RightsClass, number>;
  bytesKnownFolders: number;
  middleEastern: { core: string[]; useful: string[] };
  ownerRecordedCandidates: string[];
  unknown: string[];
  cubase14: { playerAndSubsetIncluded: string[]; included: string[] };
  aiTrainingForbiddenByVendor: string[];
  archiveSetsWithGaps: number;
  notOpenedFiles: number;
};

export function summariseTriage(rows: readonly TriageRow[]): InventorySummary {
  const byRightsClass = Object.fromEntries(RIGHTS_CLASSES.map((c) => [c, 0])) as Record<RightsClass, number>;
  const bytesByRightsClass = Object.fromEntries(RIGHTS_CLASSES.map((c) => [c, 0])) as Record<RightsClass, number>;
  let bytesKnownFolders = 0;
  const core: string[] = [], useful: string[] = [], owner: string[] = [], unknown: string[] = [];
  const subset: string[] = [], included: string[] = [], aiBan: string[] = [];
  let gaps = 0, notOpened = 0;
  for (const r of rows) {
    byRightsClass[r.rightsClass] += 1;
    if (r.bytes !== null) { bytesByRightsClass[r.rightsClass] += r.bytes; bytesKnownFolders += 1; }
    if (r.relevance.middleEastern === "core") core.push(r.folder);
    if (r.relevance.middleEastern === "useful") useful.push(r.folder);
    if (r.rightsClass === "OWNER_RECORDED_CANDIDATE") owner.push(r.folder);
    if (r.rightsClass === "UNKNOWN") unknown.push(r.folder);
    if (r.legitimatePath.cubase14 === "player_and_subset_included") subset.push(r.folder);
    if (r.legitimatePath.cubase14 === "included") included.push(r.folder);
    if (r.aiTraining === "forbidden_by_vendor_terms") aiBan.push(r.folder);
    gaps += r.archive.sets.filter((s) => s.completeness === "gaps").length;
    notOpened += r.notOpened.length;
  }
  return {
    folders: rows.length,
    byRightsClass,
    bytesByRightsClass,
    bytesKnownFolders,
    middleEastern: { core, useful },
    ownerRecordedCandidates: owner,
    unknown,
    cubase14: { playerAndSubsetIncluded: subset, included },
    aiTrainingForbiddenByVendor: aiBan,
    archiveSetsWithGaps: gaps,
    notOpenedFiles: notOpened,
  };
}

/** The rules, stated once, for the evidence file and the write-up. */
export const RIGHTS_RULES: readonly string[] = [
  "THIRD_PARTY_COMMERCIAL: usable only through the vendor's own host, activated in the owner's own vendor account on the owner's machine. Archives are irrelevant to that path.",
  "THIRD_PARTY_PACK: usable only under the pack's own licence, from the owner's own account download; Cymatics, Splice, Toontrack and Loopmasters forbid AI training.",
  "OWNER_RECORDED_CANDIDATE: raw takes / stems / DAW sessions with no vendor format, document or archive — still a candidate until the owner confirms each folder.",
  "UNKNOWN: not placeable from names and formats; not used until identified.",
  "Cloud rendering of any third-party material: forbidden pending the vendor EULA (Stream CLOUD-VM).",
  "Nothing on the drive was extracted, installed, executed, copied or opened; installer / activator-like names are listed as not opened.",
];
