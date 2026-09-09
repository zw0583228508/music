import assert from "node:assert/strict";
import test from "node:test";
import type { MidiNote, ParsedMidi } from "./midiFile";
import { extractArrangerTasks, taskIsWellFormed } from "./arrangerTaskExtraction";

const TPQ = 480;

function note(over: Partial<MidiNote>): MidiNote {
  return {
    track: 0, channel: 0, program: 0, isPercussion: false,
    pitch: 60, velocity: 80, startTick: 0, endTick: 240, ...over,
  };
}

/** A score: `bars` bars of a keys chord, a bassline and a drum pulse. */
function score(bars: number, options: { dropBassAfterBar?: number } = {}): ParsedMidi {
  const notes: MidiNote[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const barTick = bar * 4 * TPQ;
    // keys: a chord on beat 1
    for (const p of [60, 64, 67]) {
      notes.push(note({ startTick: barTick, endTick: barTick + 4 * TPQ, pitch: p, program: 0, track: 0 }));
    }
    // bass: root on 1 and 3, unless dropped
    if (options.dropBassAfterBar === undefined || bar <= options.dropBassAfterBar) {
      notes.push(note({ startTick: barTick, endTick: barTick + 2 * TPQ, pitch: 36, program: 33, track: 1 }));
      notes.push(note({ startTick: barTick + 2 * TPQ, endTick: barTick + 4 * TPQ, pitch: 36, program: 33, track: 1 }));
    }
    // drums: four on the floor
    for (let beat = 0; beat < 4; beat += 1) {
      notes.push(note({
        startTick: barTick + beat * TPQ, endTick: barTick + beat * TPQ + 120,
        pitch: 36, program: 0, isPercussion: true, channel: 9, track: 2,
      }));
    }
  }
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: 4, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: bars * 4 * TPQ,
  };
}

test("a single-track score yields nothing: there is no arrangement to condition on", () => {
  const oneTrack: ParsedMidi = {
    ...score(16),
    notes: score(16).notes.filter((n) => n.track === 0),
  };
  assert.deepEqual(extractArrangerTasks(oneTrack, "w1"), []);
});

test("a score too short for one window yields nothing", () => {
  assert.deepEqual(extractArrangerTasks(score(4), "w1", { windowBars: 8, minBars: 8 }), []);
});

test("each task holds out one family and keeps the rest as context", () => {
  const tasks = extractArrangerTasks(score(16), "w1", { windowBars: 8 });
  assert.ok(tasks.length > 0);
  for (const task of tasks) {
    assert.equal(task.workId, "w1");
    assert.equal(task.barEnd - task.barStart, 8);
    // The target family never appears as a Track_ token in the context.
    assert.ok(!task.contextTokens.includes(`Track_${task.targetFamily}`), "context excludes the target");
    // The target stream contains only the target family.
    const targetTracks = task.targetTokens.filter((t) => t.startsWith("Track_"));
    assert.ok(targetTracks.every((t) => t === `Track_${task.targetFamily}`));
    assert.ok(task.contextFamilyCount >= 1, "something to arrange against");
    assert.ok(task.targetNoteCount > 0, "the held-out part actually plays");
    assert.deepEqual(taskIsWellFormed(task), { ok: true });
  }
});

test("all three families become targets across the extracted set", () => {
  const tasks = extractArrangerTasks(score(16), "w1", { windowBars: 8, maxTasksPerScore: 99 });
  const targets = new Set(tasks.map((t) => t.targetFamily));
  assert.ok(targets.has("keys") && targets.has("bass") && targets.has("drums"));
});

test("a window where the target family is silent is not made into an example", () => {
  // With bass throughout, both windows (bars 0-7 and 8-15) are valid bass tasks.
  const full = extractArrangerTasks(score(16), "w1", { windowBars: 8, maxTasksPerScore: 99 });
  assert.deepEqual(
    full.filter((t) => t.targetFamily === "bass").map((t) => t.barStart).sort((a, b) => a - b),
    [0, 8],
  );

  // Drop the bass after bar 3: the bars 8-15 window now has no bass to predict.
  const withGap = extractArrangerTasks(score(16, { dropBassAfterBar: 3 }), "w2", { windowBars: 8, maxTasksPerScore: 99 });
  assert.deepEqual(
    withGap.filter((t) => t.targetFamily === "bass").map((t) => t.barStart),
    [0],
    "no bass example for the silent second window",
  );
  // The keys and drums, which play throughout, still produce both windows.
  assert.deepEqual(
    withGap.filter((t) => t.targetFamily === "keys").map((t) => t.barStart).sort((a, b) => a - b),
    [0, 8],
  );
});

test("windows within one (score, target) pair do not overlap", () => {
  const tasks = extractArrangerTasks(score(24), "w1", { windowBars: 8, maxTasksPerScore: 99 });
  for (const family of new Set(tasks.map((t) => t.targetFamily))) {
    const starts = tasks.filter((t) => t.targetFamily === family).map((t) => t.barStart).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i += 1) {
      assert.ok(starts[i] - starts[i - 1] >= 8, "no overlap, so a bar is never counted twice");
    }
  }
});

test("extraction is deterministic", () => {
  const a = extractArrangerTasks(score(16), "w1", { windowBars: 8 });
  const b = extractArrangerTasks(score(16), "w1", { windowBars: 8 });
  assert.deepEqual(
    a.map((t) => [t.targetFamily, t.barStart, t.targetTokenCount]),
    b.map((t) => [t.targetFamily, t.barStart, t.targetTokenCount]),
  );
});

test("maxTasksPerScore caps a long piece", () => {
  const tasks = extractArrangerTasks(score(200), "w1", { windowBars: 8, maxTasksPerScore: 5 });
  assert.equal(tasks.length, 5, "one 200-bar piece cannot dominate a batch");
});

test("a malformed task is caught by the well-formed check", () => {
  const [task] = extractArrangerTasks(score(16), "w1", { windowBars: 8 });
  // Corrupt the target slice by pasting a context Track token into it.
  const broken = { ...task, targetTokens: [...task.targetTokens, "Track_strings", "Position_0", "Pitch_60", "Velocity_16", "Duration_6"] };
  const verdict = taskIsWellFormed(broken);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /leaked a strings note/);
});
