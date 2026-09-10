import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF } from "./benchmarkCorpusPlan";
import {
  PUBLIC_DOMAIN_COMPOSERS,
  VERIFIED_PUBLIC_DOMAIN_TUNES,
  compositionRightsFor,
  foldName,
  publicDomainComposer,
} from "./compositionRights";

test("the verified list is internally consistent: every composer dead by the cutoff, every alias unique, every tune documented", () => {
  assert.equal(PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF, 1955);
  for (const c of PUBLIC_DOMAIN_COMPOSERS) {
    assert.ok(c.died <= PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF, `${c.name} died ${c.died}: not public domain under life + 70, must not be on the list`);
    assert.ok(c.aliases.length >= 1);
  }
  const names = PUBLIC_DOMAIN_COMPOSERS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, "no composer twice");
  for (const t of VERIFIED_PUBLIC_DOMAIN_TUNES) {
    assert.ok(t.composer || t.traditional, `${t.name} names neither a composer nor a traditional source`);
    if (t.composer) assert.ok(names.includes(t.composer), `${t.name}: ${t.composer} is not on the composer list`);
  }
});

test("a composer is read from the row's spelling: dates, keys, punctuation and diacritics fold away; a composer with a later death year is not admitted", () => {
  assert.equal(foldName("Johann Sebastian Bach (1685-1750)"), "johann sebastian bach");
  assert.equal(foldName("William Byrd1540 - 1623"), "william byrd");
  assert.equal(foldName("G Major Jeremiah Ingalls 1805"), "jeremiah ingalls");
  assert.equal(foldName("Richard Wagner."), "richard wagner");
  assert.equal(foldName("Georg Friedrich Händel"), "georg friedrich handel");
  assert.equal(publicDomainComposer("J.S. Bach")?.name, "Johann Sebastian Bach");
  assert.equal(publicDomainComposer("Orlande de Lassus")?.name, "Orlando di Lasso");
  assert.equal(publicDomainComposer("Sibelius"), null, "died 1957: not on the list, and must not be guessed");
  const bach = compositionRightsFor({ title: "Prelude", composer: "Johann Sebastian Bach (1685-1750)" });
  assert.ok(bach.ok);
  if (bach.ok) assert.deepEqual(bach.basis, { composer: "Johann Sebastian Bach", composerDied: 1750 });
  const fromArtist = compositionRightsFor({ title: "Symphony No.9 Op.125", composer: "L. van Beethoven", artist: "Ludwig van Beethoven" });
  assert.ok(fromArtist.ok);
  if (fromArtist.ok) assert.equal(fromArtist.basis.composer, "Ludwig van Beethoven");
});

test("a copyrighted composition under a CC0 score is contested, with the reason - the uploader's licence clears the score, not the song", () => {
  for (const row of [
    { title: "Mamma Mia!", artist: "ABBA" },
    { title: "Gangsta's Paradise", composer: "Coolio", artist: "Coolio" },
    { title: "guantanamera", artist: "Joseíto Fernández" },
    { title: "time in a bottle", composer: "Jim Croce" },
    { title: "earthbound - onett", artist: "Misc Computer Games" },
    { title: "Christmas medley", composer: "Mariah Carey Walter Afanasieff Jim Boothe Joe Beal Jose Feliciano Wham! Irving Berlin" },
    { title: "Eleven", artist: "Michael Stein and Kyle Dixon" },
    { title: "Counterpoint/Pie Jesu", composer: "Richard OberackerHeidi Bletzinger", artist: "Richard Oberacker" },
    { title: "Untitled", composer: "Composer" },
    { title: "sos" },
  ]) {
    const verdict = compositionRightsFor(row);
    assert.equal(verdict.ok, false, `${row.title} must be contested`);
    if (!verdict.ok) assert.ok(verdict.reason.length > 20, `${row.title}: a reason is recorded`);
  }
  const abba = compositionRightsFor({ title: "Mamma Mia!", artist: "ABBA" });
  if (!abba.ok) assert.match(abba.reason, /"ABBA"|names no verified composer/i);
  const guest = compositionRightsFor({ title: "Anthem", composer: "Douglas Guest (1916 - 1996)" });
  if (!guest.ok) assert.match(guest.reason, /Douglas Guest.*not on the verified/i);
});

test("a traditional label is not proof: the title must be on the verified tune list, and the basis names the tune's composer or its traditional source", () => {
  const silent = compositionRightsFor({ title: "Silent night - Instrumental flute - flugehorn - violin", artist: "nordalmeida1" });
  assert.ok(silent.ok, "a distinctive public-domain title with only an uploader handle beside it");
  if (silent.ok) assert.deepEqual(silent.basis, { composer: "Franz Xaver Gruber", composerDied: 1863 });
  const greensleeves = compositionRightsFor({ title: "Greensleeves", artist: "Misc Traditional" });
  assert.ok(greensleeves.ok);
  if (greensleeves.ok) { assert.equal(greensleeves.basis.traditional, true); assert.match(greensleeves.basis.source ?? "", /1580/); }
  const santaBaby = compositionRightsFor({ title: "Santa Baby", artist: "Misc Christmas" });
  assert.equal(santaBaby.ok, false, "a 1953 song under a 'Misc Christmas' label is not traditional");
  if (!santaBaby.ok) assert.match(santaBaby.reason, /not on the verified traditional/);
  const chant = compositionRightsFor({ title: "Salve Regina" });
  assert.equal(chant.ok, false, "a liturgical title with no label could be any setting");
  const labelledChant = compositionRightsFor({ title: "Victimae paschali laudes", composer: "Anonymous" });
  assert.ok(labelledChant.ok, "the same text labelled anonymous, on the list");
  const withModernName = compositionRightsFor({ title: "Silent Night", composer: "Taylor Swift" });
  assert.equal(withModernName.ok, false, "a multi-word name the list does not know blocks even a verified title");
});

test("an arranger beside a public-domain composer clears the composition; the arrangement layer is the uploader's own dedication", () => {
  const arranged = compositionRightsFor({ title: "Air", composer: "J. S. Bach, arr. Gabe Nunag" });
  assert.ok(arranged.ok);
  if (arranged.ok) assert.equal(arranged.basis.composer, "Johann Sebastian Bach");
  const arrOnly = compositionRightsFor({ title: "Pictures at an Exhibition", composer: "arr. Maurice Ravel", artist: "Modest Mussorgsky" });
  assert.ok(arrOnly.ok);
  if (arrOnly.ok) assert.equal(arrOnly.basis.composer, "Modest Mussorgsky");
  const tradArr = compositionRightsFor({ title: "The Wexford Carol", composer: "Trad. arr. Wim Verkaik" });
  assert.equal(tradArr.ok, false, "a traditional label with an unlisted tune stays contested even with an arranger credit");
});
