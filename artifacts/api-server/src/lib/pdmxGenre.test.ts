import assert from "node:assert/strict";
import test from "node:test";
import {
  GENRE_FAMILIES,
  classifyPdmxGenre,
  expandInstrumentTargets,
  genreFamilyRefusal,
  matchesGenreFilter,
  parsePdmxList,
} from "./pdmxGenre";
import { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine } from "./pdmxCsv";

test("PDMX's hyphen-joined lists parse; NA and blanks are no list", () => {
  assert.deepEqual(parsePdmxList("rock-pop"), ["rock", "pop"]);
  assert.deepEqual(parsePdmxList("jazz-bossanova"), ["jazz", "bossanova"]);
  assert.deepEqual(parsePdmxList("NA"), []);
  assert.deepEqual(parsePdmxList(""), []);
  assert.deepEqual(parsePdmxList(undefined), []);
});

test("the genres column decides the primary family; slugs map to the fixed family set", () => {
  const rock = classifyPdmxGenre({ genres: "rock-pop", tags: "NA", groups: "NA" });
  assert.equal(rock.primary, "rock");
  assert.deepEqual(rock.families, ["rock", "pop"]);
  assert.equal(rock.source, "genres");
  assert.equal(rock.genres, "rock-pop");

  assert.equal(classifyPdmxGenre({ genres: "rbfunksoul" }).primary, "rnb_funk_soul");
  assert.equal(classifyPdmxGenre({ genres: "religiousmusic" }).primary, "religious_worship");
  assert.equal(classifyPdmxGenre({ genres: "soundtrack" }).primary, "film_game");
  assert.equal(classifyPdmxGenre({ genres: "worldmusic-folk" }).primary, "world_traditional");
  assert.equal(classifyPdmxGenre({ genres: "classical-soundtrack" }).primary, "classical");
  assert.ok(classifyPdmxGenre({ genres: "classical-soundtrack" }).families.includes("film_game"));
  for (const g of [rock]) for (const f of g.families) assert.ok((GENRE_FAMILIES as readonly string[]).includes(f));
});

test("tags and groups add families and are the only source for latin and musical theatre", () => {
  const bossa = classifyPdmxGenre({ genres: "jazz", tags: "jazz-bossanova", groups: "NA" });
  assert.deepEqual(bossa.families, ["jazz", "latin"]);
  assert.equal(bossa.primary, "jazz", "an explicit genre is never overridden by a tag");
  assert.equal(bossa.source, "genres");

  const show = classifyPdmxGenre({ genres: "soundtrack", tags: "musicals-thewizardofoz-witch" });
  assert.deepEqual(show.families, ["film_game", "musical_theatre"]);

  const fromTagsOnly = classifyPdmxGenre({ genres: "NA", tags: "halo-odst-rain-videogame-soundtrack", groups: "NA" });
  assert.equal(fromTagsOnly.primary, "film_game");
  assert.equal(fromTagsOnly.source, "tags");
  assert.equal(fromTagsOnly.genres, undefined);

  const fromGroups = classifyPdmxGenre({ genres: "NA", tags: "NA", groups: "orchestralgroup-videogameandanimemusic" });
  assert.equal(fromGroups.primary, "film_game");
});

test("a row with no usable label is unlabelled, not guessed", () => {
  const none = classifyPdmxGenre({ genres: "NA", tags: "getyourmusicheard-piano-original", groups: "youngcomposersgroup" });
  assert.deepEqual(none.families, ["unlabelled"]);
  assert.equal(none.source, "none");
  assert.ok(none.tags.includes("piano"));
  // Substrings never fire: 'rockymountainhigh' is not rock.
  assert.equal(classifyPdmxGenre({ genres: "NA", tags: "rockymountainhigh-johndenver" }).primary, "unlabelled");
});

test("filters: include matches any family, exclude drops on any family, names are checked", () => {
  const mixed = classifyPdmxGenre({ genres: "jazz-classical" });
  assert.equal(matchesGenreFilter(mixed, { include: ["jazz"] }), true);
  assert.equal(matchesGenreFilter(mixed, { include: ["jazz"], exclude: ["classical"] }), false, "a jazz-classical crossover is not a non-classical task");
  assert.equal(matchesGenreFilter(mixed, {}), true);
  assert.equal(matchesGenreFilter(classifyPdmxGenre({ genres: "pop" }), { include: ["rock"] }), false);
  assert.equal(genreFamilyRefusal("pop"), null);
  assert.match(genreFamilyRefusal("polka") ?? "", /not a genre family/);
});

test("instrument targets expand to tournament families; unknown names are refused", () => {
  assert.deepEqual(expandInstrumentTargets(["drums", "bass", "guitar", "piano/keys", "synth"]), { families: ["drums", "bass", "guitar", "keys", "synth"] });
  assert.deepEqual(expandInstrumentTargets(["woodwinds", "reed"]), { families: ["reed", "pipe"] });
  assert.deepEqual(expandInstrumentTargets(["Percussion", " Keys "]), { families: ["drums", "keys"] });
  assert.match((expandInstrumentTargets(["theremin"]) as { refusal: string }).refusal, /not an instrument target/);
});

test("the CSV reader carries tags, groups and track programs through without requiring them", () => {
  const header = "path,mid,license,license_url,license_conflict,subset:no_license_conflict,genres,groups,tags,song_name,title,composer_name,n_tracks,tracks,song_length.seconds,song_length.bars,song_length.beats,notes_per_bar,pitch_class_entropy";
  const index = csvHeaderIndex(header);
  const line = "./data/x.json,./mid/1/11/QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC.mid,publicdomain,https://creativecommons.org/publicdomain/mark/1.0/,False,True,rock-folk,NA,pinkfloyd-classicrock,Song,Song,Anon,4,0-25-33-0,120,60,240,9,3";
  const row = csvRowToMetadataRow(parseCsvLine(line), index)!;
  assert.equal(row.tags, "pinkfloyd-classicrock");
  assert.equal(row.groups, undefined);
  assert.deepEqual(row.trackPrograms, [0, 25, 33, 0]);
  const genre = classifyPdmxGenre({ genres: row.genres as string, tags: row.tags, groups: row.groups });
  assert.deepEqual(genre.families, ["rock", "folk"]);

  // Without the optional columns the reader still works and says nothing.
  const bare = csvHeaderIndex("path,mid,license,license_url,license_conflict,subset:no_license_conflict,genres,song_name,title,composer_name,n_tracks,song_length.seconds,song_length.bars,song_length.beats,notes_per_bar,pitch_class_entropy");
  const bareRow = csvRowToMetadataRow(parseCsvLine("./data/x.json,./mid/1/11/QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC.mid,publicdomain,u,False,True,pop,S,S,A,3,120,60,240,9,3"), bare)!;
  assert.equal(bareRow.tags, undefined);
  assert.equal(bareRow.trackPrograms, undefined);
});
