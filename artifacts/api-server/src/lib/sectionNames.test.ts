import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { classifySectionName, textRefersToSectionFunction, SECTION_VOCABULARY } from "./sectionNames";
import { classifySectionFunction } from "./globalArrangementPlanner";

describe("sectionNames: the vocabulary a producer types", () => {
  it("classifies the English names exactly as the planner did before B-24", () => {
    // The pre-B-24 regexes, verbatim, as the reference implementation.
    const before = (name: string): string => {
      const n = name.toLowerCase();
      if (/intro|count/.test(n)) return "intro";
      if (/pre-?chorus|pre-?hook|lift|build/.test(n)) return "prechorus";
      if (/chorus|hook|drop|refrain/.test(n)) return "chorus";
      if (/bridge|middle 8|middle eight/.test(n)) return "bridge";
      if (/break ?down|break/.test(n)) return "breakdown";
      if (/outro|coda|ending|tag/.test(n)) return "outro";
      if (/verse/.test(n)) return "verse";
      if (/solo|instrumental|interlude|turnaround/.test(n)) return "instrumental";
      return "neutral";
    };
    const names = [
      "Intro", "Count-in", "Verse", "Verse 1", "Verse 12", "Pre-Chorus", "PreChorus", "Pre Hook",
      "Pre Chorus", "Lift", "Build", "Chorus", "Final Chorus", "Hook", "Drop", "Refrain", "Bridge",
      "Middle 8", "Middle Eight", "Breakdown", "Break Down", "Break", "Outro", "Coda", "Ending",
      "Tag", "Solo", "Instrumental", "Interlude", "Turnaround", "Section 3", "Part A", "",
    ];
    // Two English names change meaning on purpose, and only these two. The old
    // patterns were `pre-?chorus` and `pre-?hook`, which do not match a space,
    // so "Pre Chorus" and "Pre Hook" fell through to the chorus rule and were
    // arranged as choruses. They are pre-choruses. Anything else that changes
    // is a regression, not an improvement.
    const INTENDED: Record<string, { from: string; to: string }> = {
      "Pre Hook": { from: "chorus", to: "prechorus" },
      "Pre Chorus": { from: "chorus", to: "prechorus" },
    };
    for (const name of names) {
      const intended = INTENDED[name];
      if (intended) {
        assert.equal(before(name), intended.from, `"${name}" used to be ${intended.from}`);
        assert.equal(classifySectionName(name), intended.to, `"${name}" should now be ${intended.to}`);
        continue;
      }
      assert.equal(classifySectionName(name), before(name), `English name "${name}" changed meaning`);
    }
  });

  it("classifies the Hebrew names a producer actually writes", () => {
    const cases: Array<[string, string]> = [
      ["פתיחה", "intro"], ["מבוא", "intro"], ["אינטרו", "intro"], ["הקדמה", "intro"],
      ["בית", "verse"], ["בית 1", "verse"], ["בית 2", "verse"],
      ["פזמון", "chorus"], ["פזמון 3", "chorus"], ["רפריין", "chorus"],
      ["פרה-פזמון", "prechorus"], ["פרה פזמון", "prechorus"], ["טרום-פזמון", "prechorus"], ["פריקורוס", "prechorus"],
      ["גשר", "bridge"],
      ["ברייקדאון", "breakdown"], ["שבירה", "breakdown"],
      ["סיום", "outro"], ["סיומת", "outro"], ["אאוטרו", "outro"], ["קודה", "outro"],
      ["סולו", "instrumental"], ["אינסטרומנטלי", "instrumental"], ["קטע כלי", "instrumental"], ["מעבר", "instrumental"],
      ["קטע 3", "neutral"],
    ];
    for (const [name, expected] of cases) {
      assert.equal(classifySectionName(name), expected, `"${name}" should be ${expected}`);
    }
  });

  it("reads פרה-פזמון as a pre-chorus and not as a chorus", () => {
    // The containment trap in both languages.
    assert.equal(classifySectionName("פרה-פזמון"), "prechorus");
    assert.equal(classifySectionName("Pre-Chorus"), "prechorus");
    assert.equal(classifySectionName("פזמון"), "chorus");
  });

  it("says neutral rather than inventing a function", () => {
    for (const name of ["Section 1", "קטע 2", "A", "untitled", ""]) {
      assert.equal(classifySectionName(name), "neutral");
    }
  });

  it("is the same vocabulary the planner uses", () => {
    for (const name of ["פזמון", "בית", "גשר", "פתיחה", "סיום", "Chorus", "Verse 2"]) {
      assert.equal(classifySectionFunction(name), classifySectionName(name));
    }
  });

  it("keeps the decision order that makes containment safe", () => {
    const order = SECTION_VOCABULARY.map((e) => e.fn);
    assert.ok(order.indexOf("prechorus") < order.indexOf("chorus"), "prechorus must be asked before chorus");
    // Every entry's own words must classify as that entry, which is the
    // property the order exists to protect.
    for (const entry of SECTION_VOCABULARY) {
      for (const word of entry.pattern.source.split("|")) {
        const literal = word.replace(/\[- \]\?/g, "-").replace(/-\? ?/g, "").replace(/\\/g, "");
        if (!literal || /[()[\]{}*+?^$]/.test(literal)) continue;
        assert.equal(classifySectionName(literal), entry.fn, `"${literal}" should classify as ${entry.fn}`);
      }
    }
  });
});

describe("sectionNames: a producer's instruction refers to a section", () => {
  it("recognises the function in English and in Hebrew", () => {
    assert.equal(textRefersToSectionFunction("add strings in the chorus", "chorus"), true);
    assert.equal(textRefersToSectionFunction("תוסיף כלי קשת בפזמון", "chorus"), true);
    assert.equal(textRefersToSectionFunction("תוריד את התופים בבית", "verse"), true);
    assert.equal(textRefersToSectionFunction("make the גשר quieter", "bridge"), true);
  });

  it("does not read a pre-chorus instruction as a chorus one", () => {
    assert.equal(textRefersToSectionFunction("lift the pre-chorus", "chorus"), false);
    assert.equal(textRefersToSectionFunction("lift the pre-chorus", "prechorus"), true);
    assert.equal(textRefersToSectionFunction("תחזק את הפרה-פזמון", "chorus"), false);
    assert.equal(textRefersToSectionFunction("תחזק את הפרה-פזמון", "prechorus"), true);
  });

  it("still names both sections when an instruction names two", () => {
    const command = "add strings in the chorus and the bridge";
    assert.equal(textRefersToSectionFunction(command, "chorus"), true);
    assert.equal(textRefersToSectionFunction(command, "bridge"), true);
    const hebrew = "תוסיף כלי קשת בפזמון ובגשר";
    assert.equal(textRefersToSectionFunction(hebrew, "chorus"), true);
    assert.equal(textRefersToSectionFunction(hebrew, "bridge"), true);
  });

  it("is false when the instruction names no section", () => {
    assert.equal(textRefersToSectionFunction("make it warmer", "chorus"), false);
    assert.equal(textRefersToSectionFunction("תעשה את זה חם יותר", "verse"), false);
  });
});
