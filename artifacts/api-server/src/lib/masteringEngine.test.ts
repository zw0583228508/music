import assert from "node:assert/strict";
import test from "node:test";
import { measureLoudness, measureTruePeakDbtp } from "./loudness";
import {
  MASTERING_PROFILES,
  MASTER_PROFILE_IDS,
  masterAudio,
  masteringProfile,
  revisionControlsForExport,
  tracksForMasterProfile,
} from "./masteringEngine";

const SR = 44_100;

/** A deterministic music-like signal: chords + a kick pulse + noise floor, with dynamics. */
function programme(seconds: number, sampleRate = SR): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const out = new Float32Array(frames * 2);
  let state = 12345;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff - 0.5; };
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const bar = Math.floor(t / 2);
    const dyn = bar % 4 === 3 ? 1 : 0.55; // every fourth bar is a loud one
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat * 18) * 0.9;
    const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) * 0.8 + Math.sin(2 * Math.PI * 329.63 * t) * 0.7) * 0.18;
    const air = rand() * 0.02;
    const l = (kick + chord + air) * dyn;
    const r = (kick + chord * 0.9 + Math.sin(2 * Math.PI * 440 * t) * 0.05 + air) * dyn;
    out[i * 2] = l; out[i * 2 + 1] = r;
  }
  return out;
}

const rendered = (id: string, role: string, family: string) => ({ trackModel: { id, role, instrumentDefinition: { family } } });

test("every profile lands within 1 LU of its target and under its ceiling, and says so honestly", () => {
  const source = programme(12);
  for (const id of MASTER_PROFILE_IDS) {
    const { master, report } = masterAudio(source, id, { sampleRate: SR });
    const profile = MASTERING_PROFILES[id];
    const measured = measureLoudness(master, SR).integratedLufs;
    const peak = measureTruePeakDbtp(master);
    assert.ok(Math.abs(measured - profile.targetLufs) <= 1, `${id}: ${measured.toFixed(2)} LUFS vs target ${profile.targetLufs}`);
    assert.ok(peak <= profile.ceilingDbtp + 0.1, `${id}: true peak ${peak.toFixed(2)} dBTP over ceiling ${profile.ceilingDbtp}`);
    assert.equal(report.withinTarget, true, `${id} reports withinTarget`);
    assert.equal(report.output.integratedLufs, Number(measured.toFixed(2)));
    assert.equal(report.profile, id);
    assert.ok(report.steps.some((s) => s.step === "true_peak_limiter"));
    assert.equal(master.length, source.length);
  }
});

test("the report measures, it does not assert: input loudness, gain applied, limiter work", () => {
  const { report } = masterAudio(programme(10), "MASTER", { sampleRate: SR });
  assert.ok(report.input.integratedLufs! < -14, `input was quiet: ${report.input.integratedLufs}`);
  assert.ok(report.gainDb > 0, "a quiet input needed positive gain");
  assert.ok(report.limiter.maxReductionDb > 0, "a -10 LUFS target on peaky material makes the limiter work");
  assert.ok(report.limiter.limitedFrameRatio > 0 && report.limiter.limitedFrameRatio < 1);
  assert.equal(report.method.includes("BS.1770-4"), true);
  const demo = masterAudio(programme(10), "DEMO", { sampleRate: SR }).report;
  assert.equal(demo.compression.maxReductionDb, 0, "DEMO bypasses compression");
  assert.ok(demo.limiter.maxReductionDb < report.limiter.maxReductionDb, "a -16 LUFS demo needs far less limiting than a -10 LUFS master");
});

test("revision controls override the profile: target, ceiling, width and limiter", () => {
  const source = programme(8);
  const custom = masterAudio(source, "STREAMING", { sampleRate: SR, targetLufs: -18, ceilingDbtp: -3, stereoWidth: 0.5 });
  assert.ok(Math.abs(measureLoudness(custom.master, SR).integratedLufs - -18) <= 1);
  assert.ok(measureTruePeakDbtp(custom.master) <= -2.9);
  assert.deepEqual(custom.report.target, { integratedLufs: -18, truePeakDbtp: -3, stereoWidth: 0.5, limiter: true });
  const noLimiter = masterAudio(source, "STREAMING", { sampleRate: SR, limiter: false });
  assert.equal(noLimiter.report.limiter.enabled, false);
  assert.ok(noLimiter.report.steps.some((s) => /bypassed/.test(s.detail)));
});

test("mono width collapses the sides; the mid is untouched", () => {
  const source = programme(4);
  const { master } = masterAudio(source, "STREAMING", { sampleRate: SR, stereoWidth: 0 });
  let sideEnergy = 0;
  for (let i = 0; i < master.length; i += 2) sideEnergy += (master[i] - master[i + 1]) ** 2;
  assert.ok(sideEnergy < 1e-6, `side energy ${sideEnergy}`);
});

test("silence is handled without NaN and reported as unreachable", () => {
  const { master, report } = masterAudio(new Float32Array(SR * 2 * 2), "STREAMING", { sampleRate: SR });
  assert.ok(master.every((v) => Number.isFinite(v)));
  assert.equal(report.output.integratedLufs, null);
  assert.equal(report.withinTarget, false);
  assert.ok(report.warnings.length >= 1);
});

test("BACKING_TRACK leaves out the lead role, KARAOKE the voice family; stems are the caller's business", () => {
  const tracks = [rendered("kit", "GROOVE", "drums"), rendered("bass", "BASS", "strings"), rendered("flute", "LEAD", "winds"), rendered("vox", "LEAD", "voice"), rendered("pad", "PAD", "synth")];
  const backing = tracksForMasterProfile(tracks, masteringProfile("BACKING_TRACK"));
  assert.deepEqual(backing.excluded.map((e) => e.trackId), ["flute", "vox"]);
  const karaoke = tracksForMasterProfile(tracks, masteringProfile("KARAOKE"));
  assert.deepEqual(karaoke.excluded.map((e) => e.trackId), ["vox"]);
  assert.ok(karaoke.excluded[0].reason.includes("KARAOKE"));
  assert.equal(tracksForMasterProfile(tracks, masteringProfile("STREAMING")).excluded.length, 0);
  assert.equal(masteringProfile("nonsense").id, "STREAMING", "unknown ids fall back to streaming");
});

test("an export renders the approved revision's mix; the delivery profile decides the master targets", () => {
  const revision = {
    tracks: {
      kit: { levelDb: -1, pan: 0, bus: "DRUMS" as const, sendDb: -24, processing: { highPassHz: 40, compressorRatio: 3, saturation: 0.1 }, automation: [{ startSeconds: 0, endSeconds: 8, levelOffsetDb: -0.4, sendOffsetDb: 0 }] },
      pad: { levelDb: -6, pan: 0.5, bus: "MUSIC" as const, sendDb: -10, processing: { highPassHz: 140, compressorRatio: 1.5, saturation: 0 } },
    },
    master: { targetLufs: -14, truePeakDbtp: -1, processing: { limiter: true, stereoWidth: 1 } },
  };
  const explicit = revisionControlsForExport(revision, masteringProfile("LIVE_PLAYBACK"), true);
  assert.deepEqual(explicit.controls.tracks, revision.tracks, "the mix is the revision's, automation included");
  assert.deepEqual(explicit.controls.master, { targetLufs: -12, truePeakDbtp: -1.5, processing: { limiter: true, stereoWidth: 0.85 } });
  assert.ok(explicit.notes.some((n) => /1 automation segment/.test(n)));
  assert.ok(explicit.notes.some((n) => /LIVE_PLAYBACK profile/.test(n) && /-14 LUFS/.test(n)), "the note says whose targets won and what the audition used");
  const implicit = revisionControlsForExport(revision, masteringProfile("STREAMING"), false);
  assert.deepEqual(implicit.controls, revision, "with no profile asked for, the export sounds like its audition");
});

test("mastering is deterministic", () => {
  const source = programme(6);
  const a = masterAudio(source, "LIVE_PLAYBACK", { sampleRate: SR });
  const b = masterAudio(source, "LIVE_PLAYBACK", { sampleRate: SR });
  assert.deepEqual(Array.from(a.master.subarray(0, 4000)), Array.from(b.master.subarray(0, 4000)));
  assert.deepEqual(a.report, b.report);
});
