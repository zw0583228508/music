import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_DERIVED_NAME,
  RIGHTS_CLASSES,
  VENDOR_RULES,
  analyseArchiveSets,
  isNotOpenedName,
  matchVendorRule,
  summariseTriage,
  triageFolder,
  type FolderObservation,
} from "./driveInventoryTriage";

const obs = (over: Partial<FolderObservation> & { name: string }): FolderObservation => ({
  path: `D:\\פלאגינים\\${over.name}`,
  source: "scan",
  extensions: [],
  archiveNames: [],
  docNames: [],
  suspiciousNames: [],
  subDirs: [],
  ...over,
});

test("every vendor rule places a folder in a third-party class and names a host and a vendor app", () => {
  for (const rule of VENDOR_RULES) {
    assert.ok(rule.rightsClass === "THIRD_PARTY_COMMERCIAL" || rule.rightsClass === "THIRD_PARTY_PACK", rule.id);
    assert.notEqual(rule.host, "UNKNOWN", rule.id);
    assert.notEqual(rule.vendorApp, "unknown", rule.id);
    assert.ok(rule.account.length > 10, rule.id);
  }
  const ids = VENDOR_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "rule ids unique");
});

test("the folders the survey named resolve to the expected vendor, host and rights class", () => {
  const expect: Array<[string, string, string]> = [
    ["SL-SuperiorDrummer3", "toontrack-sd3", "SUPERIOR_DRUMMER_3"],
    ["Nexus 3", "refx-nexus", "NEXUS_3"],
    ["Output Essential Engines", "output-engines", "OUTPUT_PLUGIN"],
    ["UVI FALCON 2", "uvi-falcon", "UVI_FALCON"],
    ["Spitfire Audio - Albion NEO", "spitfire-albion-neo", "KONTAKT_PLAYER"],
    ["EZDrummer", "toontrack-ezd", "EZDRUMMER"],
    ["Jaeger", "audio-imperia-jaeger", "KONTAKT_PLAYER"],
    ["SampleTank 4", "ik-sampletank", "SAMPLETANK_4"],
    ["Yamaha Vocaloid ALL Libraries", "yamaha-vocaloid", "VOCALOID_EDITOR"],
    ["ProjectSam - Swing More!", "projectsam-swing-more", "KONTAKT_PLAYER"],
    ["Impact Soundworks Pearl Concert Grand", "isw-pearl", "KONTAKT_PLAYER"],
    ["Kontakt Factory Library 2", "ni-kontakt-factory", "KONTAKT_FULL"],
    ["Chris Hein - Ensemble Strings", "chris-hein-ensemble-strings", "KONTAKT_PLAYER"],
    ["NI Session Strings Pro 2", "ni-session-strings", "KONTAKT_PLAYER"],
    ["HALion_7_Complete_Content", "steinberg-halion7", "HALION_7"],
    ["Content HALion Sonic 3", "steinberg-halion-sonic", "HALION_SONIC"],
    ["Ableton Live 11 PACK", "ableton-packs", "ABLETON_LIVE"],
    ["Heat Up Instruments", "initial-audio-heat-up", "INITIAL_AUDIO_HEAT_UP"],
    ["Ethno World 6", "best-service-ethno-world", "KONTAKT_PLAYER"],
    ["Nucleus", "audio-imperia-nucleus", "KONTAKT_PLAYER"],
    ["Cinesamples CineBrass PRO", "cinesamples-cinebrass", "KONTAKT_PLAYER"],
    ["World Percussion 2.0", "evolution-world-percussion", "KONTAKT_PLAYER"],
    ["Best Service - The Orchestra Complete", "best-service-the-orchestra", "KONTAKT_PLAYER"],
    ["Steinberg Groove Agent 5 Content", "steinberg-groove-agent", "GROOVE_AGENT_5"],
    ["The Grand 3", "steinberg-the-grand", "THE_GRAND_3"],
    ["Ilya Efimov Total Guitar", "ilya-efimov-total-guitar", "KONTAKT_FULL"],
    ["Middle East", "ni-middle-east", "KONTAKT_PLAYER"],
    ["Arturia Sound Banks", "arturia-sound-banks", "ARTURIA_V_COLLECTION_OR_PIGMENTS"],
    // Names the scan found beyond the survey's list (folder names carry the archive part suffix).
    ["HALion 6.part01", "steinberg-halion6", "HALION_7"],
    ["HALion_Sonic_Selection_Content.part1", "steinberg-halion-sonic-selection", "HALION_SONIC"],
    ["Steinberg Groove Agent SE 5 Content.part1", "steinberg-groove-agent-se", "GROOVE_AGENT_5"],
    ["Steinberg PadShop 2 CONTENT.part1", "steinberg-padshop", "STEINBERG_HOST_UNSPECIFIED"],
    ["Steinberg Verve Felt Piano Content for halion sonic se.part1", "steinberg-verve", "HALION_SONIC"],
    ["Session Guitarist - Strummed Acoustic 2 Library.part1", "ni-session-guitarist", "KONTAKT_PLAYER"],
    ["Session_Horns_Library", "ni-session-horns", "KONTAKT_PLAYER"],
    ["Studio_Drummer.part1", "ni-studio-drummer", "KONTAKT_PLAYER"],
    ["Scarbee Pre Bass Amped v1.1.0.part1", "ni-scarbee", "KONTAKT_PLAYER"],
    ["Noire Library.part1", "ni-noire", "KONTAKT_PLAYER"],
    ["Native Instruments The Gentleman.part1", "ni-the-gentleman", "KONTAKT_PLAYER"],
    ["Spitfire Audio - Spitfire Solo Violin.part1", "spitfire-solo-violin", "KONTAKT_PLAYER"],
    ["Swing! Library.part01", "projectsam-swing", "KONTAKT_PLAYER"],
    ["Best Service - TO Strings of Winter.part1", "best-service-strings-of-winter", "KONTAKT_PLAYER"],
    ["Sonokinetic  Sultan Strings.part1", "sonokinetic-sultan-strings", "KONTAKT_PLAYER"],
    ["Strezov Sampling - Darbuka X3M.part1", "strezov-darbuka", "KONTAKT_FULL"],
    ["Akki Plugs Virtual Bouzouki.part1", "akki-virtual-bouzouki", "KONTAKT_UNKNOWN_TIER"],
    ["Baklava Sounds Orient Express KONTAKT.part1", "baklava-orient-express", "KONTAKT_UNKNOWN_TIER"],
    ["Evolution Steel Strings.part1", "orange-tree-evolution", "KONTAKT_FULL"],
    ["Acou6tics.part1", "vir2-acou6tics", "KONTAKT_PLAYER"],
    ["Heavyocity - Vocalise 2.part1", "heavyocity", "KONTAKT_PLAYER"],
    ["Audiomodern -Opacity II.part1", "audiomodern", "KONTAKT_UNKNOWN_TIER"],
    ["Soundiron_Axe_Machina.part01", "soundiron", "KONTAKT_UNKNOWN_TIER"],
    ["Keyscape - 12.part1", "spectrasonics-keyscape", "SPECTRASONICS_STEAM"],
    ["Sonic Extensions - Nylon Sky.part1", "spectrasonics-sonic-extensions", "SPECTRASONICS_STEAM"],
    ["SAGE.part01", "spectrasonics-sage", "SPECTRASONICS_STEAM"],
    ["MP2 Sound Content.part01", "ik-miroslav-philharmonik-2", "SAMPLETANK_4"],
    ["Cinesamples Tina Guo vol 2.part1", "cinesamples-generic", "KONTAKT_PLAYER"],
    ["Output Exhale KONTAKT incl. NKS Update.part5", "output-engines", "OUTPUT_PLUGIN"],
  ];
  for (const [name, ruleId, host] of expect) {
    const rule = matchVendorRule(name);
    assert.ok(rule, `no rule for ${name}`);
    assert.equal(rule.id, ruleId, name);
    const row = triageFolder(obs({ name }));
    assert.equal(row.rightsClass, "THIRD_PARTY_COMMERCIAL", name);
    assert.equal(row.hostRequired, host, name);
    assert.equal(row.cloudRendering, "FORBIDDEN_PENDING_VENDOR_EULA", name);
    assert.match(row.legitimatePath.instruction, /archives on this drive are not part of that path/i, name);
  }
});

test("sample-pack publishers are THIRD_PARTY_PACK; Cymatics carries the vendor's AI-training ban", () => {
  const cymatics = triageFolder(obs({ name: "Cymatics - Eternity Melody Collection", extensions: [{ ext: ".wav", count: 400, bytes: 4e9 }, { ext: ".mid", count: 120, bytes: 1e6 }] }));
  assert.equal(cymatics.rightsClass, "THIRD_PARTY_PACK");
  assert.equal(cymatics.aiTraining, "forbidden_by_vendor_terms");
  assert.equal(cymatics.hostRequired, "RAW_WAV_MIDI");
  for (const name of ["Urban Singh Mizrahi Drums", "Midilatino Vol 3", "Dave Parkinson Trance", "TomorrowLand 2019 Kit", "Psy-Trance Essentials",
    "Zenhiser - Orbital.part1", "Oversampled - CYBERPACK 2077 - Sample Pack.part1", "[Futurephonic] Foundations - By Virtual Light & Scorb",
    "Mike Shiver Essentials Volume 2.part1", "Unison Beatmaker Blueprint.part1", "Paramount Motion - Odeon Cinematic Sound Effects Pack.part1",
    "Pro Sound Effects Cinematic Winds WAV.part1", "PML Premium Bundle.part1", "Sounds of KSHMR Vol 4 Complete Edition.part1", "Splice Sounds.part1"]) {
    assert.equal(triageFolder(obs({ name })).rightsClass, "THIRD_PARTY_PACK", name);
  }
  assert.equal(triageFolder(obs({ name: "Splice Sounds  of KSHMR 1-2-3.part1" })).aiTraining, "forbidden_by_vendor_terms");
});

test("a folder named after an archive part is never an owner candidate, even when it holds only WAV", () => {
  assert.ok(ARCHIVE_DERIVED_NAME.test("Something Volume 2.part1"));
  assert.ok(!ARCHIVE_DERIVED_NAME.test("Session_Horns_Library"));
  const row = triageFolder(obs({ name: "Unknown Publisher Kit.part1", extensions: [{ ext: ".wav", count: 700, bytes: 4e9 }, { ext: ".mid", count: 7, bytes: 1e5 }] }));
  assert.equal(row.rightsClass, "UNKNOWN");
  assert.equal(row.decidedBy, "archive-derived folder name");
  assert.ok(row.flags.includes("archive_derived_folder_name"));
});

test("an empty folder is UNKNOWN with no vendor, whatever its name says", () => {
  const row = triageFolder(obs({ name: "Spitfire", files: 0, bytes: 0 }));
  assert.equal(row.rightsClass, "UNKNOWN");
  assert.equal(row.vendor, null);
  assert.equal(row.decidedBy, "empty folder");
  assert.ok(row.flags.includes("empty_folder"));
});

test("Keyscape in Kontakt formats is flagged: the vendor's host is not Kontakt", () => {
  const row = triageFolder(obs({ name: "Keyscape - 12.part1", extensions: [{ ext: ".nkx", count: 20, bytes: 1.6e10 }, { ext: ".nki", count: 4, bytes: 1e6 }] }));
  assert.equal(row.hostRequired, "SPECTRASONICS_STEAM");
  assert.ok(row.flags.includes("formats_suggest_KONTAKT_UNKNOWN_TIER_beside_SPECTRASONICS_STEAM"));
  assert.match(row.hostNote, /never released it for Kontakt/);
});

test("a made-up folder name does not hide a vendor library: the formats decide", () => {
  const row = triageFolder(obs({
    name: "my drums 2019",
    extensions: [{ ext: ".nkx", count: 40, bytes: 30e9 }, { ext: ".nki", count: 12, bytes: 2e6 }, { ext: ".nicnt", count: 1, bytes: 1e3 }],
  }));
  assert.equal(row.rightsClass, "THIRD_PARTY_COMMERCIAL");
  assert.equal(row.hostRequired, "KONTAKT_UNKNOWN_TIER");
  assert.equal(row.hostConfidence, "format_inference");
  assert.ok(row.flags.includes("vendor_not_identified_from_name"));
  const nexus = triageFolder(obs({ name: "leads", extensions: [{ ext: ".nxs", count: 3, bytes: 5e9 }] }));
  assert.equal(nexus.hostRequired, "NEXUS_3");
  const stein = triageFolder(obs({ name: "sounds", extensions: [{ ext: ".vstsound", count: 9, bytes: 9e9 }] }));
  assert.equal(stein.hostRequired, "STEINBERG_HOST_UNSPECIFIED");
});

test("only raw takes with no vendor signal become OWNER_RECORDED_CANDIDATE, and only as a candidate", () => {
  const takes = triageFolder(obs({
    name: "הקלטות אולפן 2023",
    extensions: [{ ext: ".wav", count: 88, bytes: 6e9 }, { ext: ".mid", count: 3, bytes: 3e4 }],
    subDirs: ["Take 1", "Take 2", "vocals comp"],
  }));
  assert.equal(takes.rightsClass, "OWNER_RECORDED_CANDIDATE");
  assert.ok(takes.flags.includes("owner_confirmation_required"));
  assert.equal(takes.cloudRendering, "OWNER_DECISION_AFTER_CONFIRMATION");
  assert.equal(takes.aiTraining, "owner_decision_after_confirmation");

  const session = triageFolder(obs({ name: "shir 4", extensions: [{ ext: ".cpr", count: 2, bytes: 4e6 }, { ext: ".wav", count: 30, bytes: 2e9 }, { ext: ".png", count: 1, bytes: 1e5 }] }));
  assert.equal(session.rightsClass, "OWNER_RECORDED_CANDIDATE");
  assert.equal(session.decidedBy, "DAW session files present");

  // The same WAV folder with a readme, a pack naming convention, or split archives is not the owner's by default.
  const readme = triageFolder(obs({ name: "הקלטות", extensions: [{ ext: ".wav", count: 88, bytes: 6e9 }], docNames: ["README.txt"] }));
  assert.equal(readme.rightsClass, "UNKNOWN");
  const pack = triageFolder(obs({ name: "Oriental Drum Kit Vol 2", extensions: [{ ext: ".wav", count: 88, bytes: 6e9 }] }));
  assert.equal(pack.rightsClass, "UNKNOWN");
  const rar = triageFolder(obs({ name: "stuff", extensions: [{ ext: ".rar", count: 12, bytes: 60e9 }], archiveNames: ["x.part01.rar", "x.part02.rar"] }));
  assert.equal(rar.rightsClass, "UNKNOWN");
  assert.ok(rar.flags.includes("archives_not_listed"));
  const presets = triageFolder(obs({ name: "my presets", extensions: [{ ext: ".fxp", count: 300, bytes: 3e6 }] }));
  assert.equal(presets.rightsClass, "UNKNOWN");
});

test("archive part numbering: contiguous sets are never called complete; gaps are reported", () => {
  const sets = analyseArchiveSets([
    "SL-SuperiorDrummer3.part001.rar", "SL-SuperiorDrummer3.part002.rar", "SL-SuperiorDrummer3.part003.rar",
    "Nexus 3.part01.rar", "Nexus 3.part03.rar",
    "lib.rar", "lib.r00", "lib.r01",
    "big.7z.001", "big.7z.002",
    "single.zip",
  ]);
  const byBase = Object.fromEntries(sets.map((s) => [s.base, s]));
  assert.equal(byBase["SL-SuperiorDrummer3"].completeness, "no_gaps_seen");
  assert.deepEqual(byBase["SL-SuperiorDrummer3"].parts, [1, 2, 3]);
  assert.equal(byBase["Nexus 3"].completeness, "gaps");
  assert.deepEqual(byBase["Nexus 3"].gaps, [2]);
  assert.equal(byBase["lib"].scheme, "rNN");
  assert.deepEqual(byBase["lib"].parts, [0, 1]);
  assert.equal(byBase["big.7z"].scheme, "NNN");
  assert.equal(byBase["single.zip"].completeness, "single_file");
  assert.ok(sets.every((s) => (s.completeness as string) !== "complete"));

  const row = triageFolder(obs({ name: "Nexus 3", archiveNames: ["Nexus 3.part01.rar", "Nexus 3.part03.rar"], extensions: [{ ext: ".rar", count: 2, bytes: 1e10 }] }));
  assert.equal(row.archive.anyGaps, true);
  assert.ok(row.flags.includes("archive_numbering_has_gaps"));
  const ok = triageFolder(obs({ name: "Nexus 3", archiveNames: ["Nexus 3.part01.rar", "Nexus 3.part02.rar"] }));
  assert.ok(ok.flags.includes("archive_last_part_unverified"));
});

test("installer / activator-like names are listed as not opened and flagged; the class does not change", () => {
  assert.ok(isNotOpenedName("Activation_03-01 3_57.activate"));
  assert.ok(isNotOpenedName("keygen.exe"));
  assert.ok(isNotOpenedName("34589_Toontrack-Stori.torrent"));
  assert.ok(isNotOpenedName("Add Library.exe"));
  assert.ok(isNotOpenedName("R2R.nfo"));
  assert.ok(!isNotOpenedName("Oud sustain C3.wav"));
  assert.ok(!isNotOpenedName("Nexus 3\\NKS\\XP EDM Leads\\.previews\\LD Activator.nksf.ogg"));
  assert.ok(!isNotOpenedName("LD Summer Crackle.nksf.ogg"));
  assert.ok(!isNotOpenedName("FX Pitch Patch.fxp"));
  const row = triageFolder(obs({ name: "Ethno World 6", suspiciousNames: ["Setup.exe", "R2R.nfo", "Ethno.nki", "BA Crackzer.nxs"] }));
  assert.deepEqual(row.notOpened, ["Setup.exe", "R2R.nfo"]);
  assert.ok(row.flags.includes("installer_or_activator_like_names_present_not_opened"));
  assert.equal(row.rightsClass, "THIRD_PARTY_COMMERCIAL");
});

test("Cubase 14 coverage: HALion / Groove Agent content is player-and-subset, The Grand 3 and Kontakt libraries are not", () => {
  assert.equal(triageFolder(obs({ name: "HALion_7_Complete_Content" })).legitimatePath.cubase14, "player_and_subset_included");
  assert.equal(triageFolder(obs({ name: "Content HALion Sonic 3" })).legitimatePath.cubase14, "player_and_subset_included");
  assert.equal(triageFolder(obs({ name: "Steinberg Groove Agent 5 Content" })).legitimatePath.cubase14, "player_and_subset_included");
  assert.equal(triageFolder(obs({ name: "The Grand 3" })).legitimatePath.cubase14, "not_included");
  assert.equal(triageFolder(obs({ name: "Middle East" })).legitimatePath.cubase14, "not_included");
  assert.equal(triageFolder(obs({ name: "HALion_Sonic_Selection_Content.part1" })).legitimatePath.cubase14, "included");
  assert.equal(triageFolder(obs({ name: "Steinberg Groove Agent SE 5 Content.part1" })).legitimatePath.cubase14, "included");
  assert.equal(triageFolder(obs({ name: "Steinberg PadShop 2 CONTENT.part1" })).legitimatePath.cubase14, "included");
  assert.equal(triageFolder(obs({ name: "Steinberg Groove Agent.5 Content.part01" })).legitimatePath.cubase14, "player_and_subset_included");
  assert.match(triageFolder(obs({ name: "HALion_7_Complete_Content" })).legitimatePath.instruction, /Cubase 14 already includes the player/);
});

test("Middle-Eastern relevance is on the named products and the summary lists them", () => {
  const rows = ["Middle East", "Ethno World 6", "World Percussion 2.0", "NI Session Strings Pro 2", "Jaeger", "Cymatics - Kit"].map((name) => triageFolder(obs({ name })));
  const summary = summariseTriage(rows);
  assert.deepEqual(summary.middleEastern.core, ["Middle East", "Ethno World 6", "World Percussion 2.0"]);
  for (const name of ["Sonokinetic  Sultan Strings.part1", "Strezov Sampling - Darbuka X3M.part1", "Akki Plugs Virtual Bouzouki.part1", "Baklava Sounds Orient Express KONTAKT.part1"]) {
    assert.equal(triageFolder(obs({ name })).relevance.middleEastern, "core", name);
  }
  assert.ok(summary.middleEastern.useful.includes("NI Session Strings Pro 2"));
  assert.ok(!summary.middleEastern.useful.includes("Jaeger"));
  assert.equal(summary.byRightsClass.THIRD_PARTY_COMMERCIAL, 5);
  assert.equal(summary.byRightsClass.THIRD_PARTY_PACK, 1);
  assert.deepEqual(Object.keys(summary.byRightsClass), [...RIGHTS_CLASSES]);
  assert.deepEqual(summary.aiTrainingForbiddenByVendor, ["Cymatics - Kit"]);
});

test("a name-only survey row is flagged as such and a folder with no observation at all is UNKNOWN", () => {
  const survey = triageFolder({ name: "Nucleus", source: "lead-survey", bytes: null, files: null });
  assert.equal(survey.rightsClass, "THIRD_PARTY_COMMERCIAL");
  assert.ok(survey.flags.includes("classified_from_name_and_survey_only"));
  const nothing = triageFolder({ name: "תיקייה", source: "lead-survey", bytes: null, files: null });
  assert.equal(nothing.rightsClass, "UNKNOWN");
  assert.ok(nothing.flags.includes("no_file_observation"));
  assert.equal(nothing.version, null);
  assert.equal(triageFolder(obs({ name: "Ethno World 6" })).version, "6");
  assert.equal(triageFolder(obs({ name: "World Percussion 2.0" })).version, "2.0");
  assert.equal(triageFolder(obs({ name: "Ethno World 6.part01" })).version, "6");
  assert.equal(triageFolder(obs({ name: "Scarbee Pre Bass Amped v1.1.0.part1" })).version, "1.1.0");
  assert.equal(triageFolder(obs({ name: "EZDrummer.part01" })).version, null);
});
