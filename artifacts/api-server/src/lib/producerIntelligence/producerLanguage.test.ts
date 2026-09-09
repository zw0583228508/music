import assert from "node:assert/strict";
import test from "node:test";
import { isHebrew, phrases, replyLanguage } from "./producerLanguage";

test("the reply language is the one the producer wrote in", () => {
  assert.equal(replyLanguage("אני רוצה בלדה חסידית"), "he");
  assert.equal(replyLanguage("a modern hasidic ballad"), "en");
  // Mixed text with any Hebrew is Hebrew: that is the producer writing Hebrew
  // and naming an instrument or an artist in Latin script.
  assert.equal(replyLanguage("בלדה עם flute"), "he");
  assert.equal(replyLanguage(""), "en");
  assert.equal(replyLanguage(null), "en");
  assert.equal(isHebrew("he"), true);
  assert.equal(isHebrew("en"), false);
});

test("Hebrew joins with a vav, and takes the maqaf before a foreign word or a quote", () => {
  const he = phrases("he");
  assert.equal(he.list(["פסנתר", "חליל"]), "פסנתר וחליל");
  assert.equal(he.list(["piano", "flute"]), "piano ו-flute");
  assert.equal(he.list(["פסנתר", "חליל", "כינור"]), "פסנתר, חליל וכינור");
  assert.equal(he.list(['"לא פופית"']), '"לא פופית"');
  assert.equal(he.list([]), "");
  const en = phrases("en");
  assert.equal(en.list(["piano", "flute"]), "piano and flute");
  assert.equal(en.list(["piano", "flute", "violin"]), "piano, flute and violin");
});

test("every producer-facing phrase has both languages, and neither invents data", () => {
  const he = phrases("he");
  const en = phrases("en");
  assert.deepEqual(Object.keys(he).sort(), Object.keys(en).sort(), "no phrase exists in one language only");

  // A sentence in each language over the same data says the same thing.
  assert.match(he.addedToBrief(3, "X"), /^נוסף לבריף \(גרסה 3\): X\.$/);
  assert.match(en.addedToBrief(3, "X"), /^Added to the brief \(v3\): X\.$/);
  assert.match(he.questionsLead(1), /דבר אחד/);
  assert.match(he.questionsLead(2), /שני דברים/);
  assert.match(he.standingRulesApplied('"בלי מיתרים"', 1), /הכלל הקבוע שלך "בלי מיתרים" הוחל/);
  assert.match(he.standingRulesApplied('"א", "ב"', 2), /הכללים הקבועים שלך .* הוחלו/);
  assert.match(he.cannotExplain("אין תוכנית"), /^אני לא יכול להסביר את זה מהתוכנית: אין תוכנית\.$/);
  assert.match(he.decisionOriginLine(he.originStandingRule, "בלי מיתרים"), /מגיעה מכלל קבוע שלך: "בלי מיתרים"/);
  assert.match(he.editPreservedIt("שמור על התופים", "drums", 532), /"שמור על התופים" לא כתבה את זה מחדש: drums נשמר, ו-532 תווים נעולים/);
  assert.match(he.editRewroteIt("תחליף את הבס", 137, "Chorus 2", 553), /137 תווים הוחלפו ב-Chorus 2, 553 נשמרו/);

  // Section names, instrument families and the producer's own words stay as
  // they are in both languages: translating them would misreport the data.
  assert.ok(he.perSection("Chorus 2: wide").includes("Chorus 2: wide"));
  assert.ok(he.excludedFromPalette("strings").includes("strings"));
  assert.equal(he.quote("  בלי מיתרים  "), '"בלי מיתרים"');
});
