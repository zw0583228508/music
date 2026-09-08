import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { renderStem } from "./referenceRenderWorker";
import { abCompareCandidates, critiqueRenderedAudio } from "./audioCritic";
import type { AudioStem } from "./audioCritic";

const SR = 48_000;

const notes = (pitch: number, count: number, step = 0.5, velocity = 96): MusicalNote[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${pitch}-${i}`, start: i * step, duration: step * 0.85, pitch, velocity,
  }));

function stem(
  trackId: string, instrument: string, role: string, midiNotes: MusicalNote[], pan?: number,
): AudioStem {
  const rendered = renderStem(
    { id: trackId, instrument, role, notes: midiNotes },
    { sampleRate: SR, bitDepth: 24, durationSeconds: 4 },
  );
  return {
    trackId, instrument, role, family: rendered.attestation.family,
    samples: rendered.samples, pan, attestation: rendered.attestation,
  };
}

function scoreOf(critique: ReturnType<typeof critiqueRenderedAudio>, dimension: string): number {
  return critique.dimensions.find((d) => d.dimension === dimension)!.score;
}

test("a balanced arrangement scores every dimension with weights summing to 1", () => {
  const critique = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("drums", "drums", "GROOVE", [
        ...notes(36, 8, 0.5, 110), ...notes(42, 16, 0.25, 70), ...notes(38, 4, 1.0, 100),
      ]),
      stem("bass", "bass", "BASS", notes(40, 8, 0.5, 96)),
      stem("keys", "keys", "HARMONIC_BED", notes(64, 8, 0.5, 78)),
    ],
  });
  assert.equal(critique.version, "1.0");
  assert.equal(critique.stemCount, 3);
  assert.equal(critique.dimensions.length, 10);
  assert.ok(Math.abs(critique.dimensions.reduce((s, d) => s + d.weight, 0) - 1) < 1e-6);
  assert.ok(critique.overallScore > 0 && critique.overallScore <= 100);
  for (const d of critique.dimensions) {
    assert.ok(d.score >= 0 && d.score <= 100 && d.confidence >= 0 && d.confidence <= 1);
    assert.ok(d.findings.length > 0);
  }
});

test("two instruments fighting for the sub band lower the low-end score", () => {
  const clean = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [stem("bass", "bass", "BASS", notes(40, 8)), stem("keys", "keys", "HARMONIC_BED", notes(72, 8))],
  });
  const conflicted = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("bass", "bass", "BASS", notes(33, 8, 0.5, 110)),
      stem("synth", "synth", "PAD", notes(33, 8, 0.5, 110)),
    ],
  });
  assert.ok(
    scoreOf(conflicted, "lowEndConflict") < scoreOf(clean, "lowEndConflict"),
    "sub-band collision is detected",
  );
  assert.ok(conflicted.recommendedMixActions.some((a) => a.dimension === "lowEndConflict" || a.dimension === "masking"));
});

test("an over-loud pad above the lead is caught by balance", () => {
  const critique = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("lead", "keys", "LEAD", notes(72, 8, 0.5, 40)),
      stem("pad", "strings", "PAD", notes(64, 8, 0.5, 127)),
    ],
  });
  assert.ok(scoreOf(critique, "balance") < 92);
  assert.ok(critique.dimensions.find((d) => d.dimension === "balance")!.findings[0].length > 0);
});

test("stereo distribution is unavailable for mono stems and scored when panned", () => {
  const mono = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [stem("a", "keys", "HARMONIC_BED", notes(60, 8)), stem("b", "guitar", "RHYTHMIC_HARMONY", notes(64, 8))],
  });
  assert.ok(mono.dimensions.find((d) => d.dimension === "stereoDistribution")!.confidence < 0.3);

  const panned = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("a", "keys", "HARMONIC_BED", notes(60, 8), -0.6),
      stem("b", "guitar", "RHYTHMIC_HARMONY", notes(64, 8), 0.6),
    ],
  });
  assert.ok(panned.dimensions.find((d) => d.dimension === "stereoDistribution")!.confidence > 0.5);
  assert.ok(scoreOf(panned, "stereoDistribution") > 60);
});

test("instrument realism reads the render attestations", () => {
  const critique = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [stem("keys", "keys", "HARMONIC_BED", notes(60, 8))],
  });
  const realism = critique.dimensions.find((d) => d.dimension === "instrumentRealism")!;
  assert.ok(realism.confidence > 0.5);
  assert.match(realism.findings[0], /attested/);
});

test("no audio degrades gracefully instead of throwing", () => {
  const critique = critiqueRenderedAudio({ sampleRate: SR, stems: [] });
  assert.equal(critique.stemCount, 0);
  assert.equal(critique.dimensions.length, 10);
  assert.ok(critique.dimensions.every((d) => d.confidence === 0));
});

test("A/B ranks candidates and reports per-dimension wins", () => {
  const good = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("drums", "drums", "GROOVE", notes(36, 8, 0.5, 110)),
      stem("bass", "bass", "BASS", notes(40, 8)),
      stem("keys", "keys", "HARMONIC_BED", notes(67, 8, 0.5, 70)),
    ],
  });
  const muddy = critiqueRenderedAudio({
    sampleRate: SR,
    stems: [
      stem("bass", "bass", "BASS", notes(33, 8, 0.5, 120)),
      stem("synth", "synth", "PAD", notes(34, 8, 0.5, 120)),
      stem("keys", "keys", "HARMONIC_BED", notes(35, 8, 0.5, 120)),
    ],
  });
  const ab = abCompareCandidates([
    { candidateId: "cand-A", label: "A · conservative", critique: good },
    { candidateId: "cand-B", label: "B · muddy", critique: muddy },
  ]);
  assert.equal(ab.ranked.length, 2);
  assert.equal(ab.winner, ab.ranked[0].candidateId);
  assert.ok(ab.margin >= 0);
  assert.ok(ab.ranked[0].wins.length > 0 || ab.ranked[1].losses.length > 0);
});
