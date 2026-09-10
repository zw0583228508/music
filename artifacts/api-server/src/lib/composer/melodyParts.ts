/**
 * Melodic parts of the reference composer (Brain B-10, D3).
 *
 * `writeCounterMelody` used to be the constant `[0, 1, 2, 1]` cell on chord
 * tones (diagnosis §4). It now dispatches to the melodic engine:
 *
 *   COUNTER_MELODY  → `writeCounterLine`: a line under the voice from the
 *                     ledger's motifs, contrary / oblique to the bass, a fifth
 *                     clear of the singer, developed per phrase unit and
 *                     recalled from the earlier statement of the section.
 *   CALL_RESPONSE   → `writeAnswerPhrases`: answers in the vocal gaps (verified
 *                     from melody evidence; inferred phrase ends when the source
 *                     has no vocal map — and the ledger says which).
 *   instrumental LEAD → `writeInstrumentalLead` (the lead wires it; see the
 *                     B-10 report for the one-line dispatch).
 *
 * The ledger comes from the request when the orchestrator threads one per
 * candidate (`request.motifLedger`); otherwise a local ledger is built from
 * the bars this request can see and recall across sections is recorded as
 * unavailable. The old figure survives only as `writeLegacyCounterMelodyFigure`,
 * used when the ledger has no motif at all, and every note it writes says so.
 */
import type { MotifOccurrenceRecord, MusicalNote } from "@workspace/db";
import type { ComposeFrame } from "./frame";
import { chordPitchClasses } from "./harmonyParts";
import { voiceNear } from "./registers";
import {
  buildMotifLedger, emittedFingerprint, sha256, stableJson, type MotifLedger, type TimedPitch,
} from "../motifLedger";
import {
  chordRootsAsBass, FALLBACK_CELL, vocalGaps, writeMelodicLine,
  type MelodicLineRequest, type MelodicLineResult, type MelodicSectionContext,
} from "../melodicEngine";

/** Melody notes below this confidence are not "the singer is singing here". */
const SUNG_CONFIDENCE = 0.6;

export type LedgerSource = "request" | "local_from_context";

/** The ledger this part writes into: the candidate's (threaded by the orchestrator) or a local one with its limits recorded. */
export function ledgerFor(frame: ComposeFrame): { ledger: MotifLedger; source: LedgerSource } {
  const { request } = frame;
  if (request.motifLedger) return { ledger: request.motifLedger, source: "request" };
  const ctx = request.context;
  const melody = dedupe([...ctx.previousBars.melody, ...ctx.currentBars.melody, ...ctx.nextBars.melody]);
  const chords = dedupe([...ctx.previousBars.chords, ...ctx.currentBars.chords, ...ctx.nextBars.chords]);
  const ledger = buildMotifLedger({
    songModel: { melody, chords, sections: [] },
    sections: [{
      sectionName: request.section.sectionName, startBar: request.section.startBar, endBar: request.section.endBar,
      function: request.section.function, tensionRole: request.arcIntent?.tensionRole,
      startSeconds: frame.startSeconds, endSeconds: frame.endSeconds,
    }],
    beatSeconds: frame.beatSeconds,
  });
  ledger.note(`local ledger for ${request.taskId}: built from the bars this request can see (${ctx.previousBars.startBar}-${ctx.nextBars.endBar}); no ledger was threaded on the request, so recall across sections is unavailable`);
  return { ledger, source: "local_from_context" };
}

function dedupe<T extends { start: number; end: number }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.start}:${item.end}:${(item as { pitch?: number }).pitch ?? (item as { symbol?: string }).symbol ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Sung notes the part must respect (melody evidence at confidence >= 0.6 across the bars in view). */
export function vocalEvidence(frame: ComposeFrame): TimedPitch[] {
  const ctx = frame.request.context;
  return dedupe([...ctx.previousBars.melody, ...ctx.currentBars.melody, ...ctx.nextBars.melody])
    .filter((n) => (n.confidence ?? 0) >= SUNG_CONFIDENCE)
    .map((n) => ({ start: n.start, end: n.end, pitch: n.pitch }));
}

/** The bass the line moves against: observed bass notes, else the chord roots the reference bass plays on every downbeat. */
export function bassReference(frame: ComposeFrame): { bass: TimedPitch[]; kind: MelodicLineRequest["bassReference"] } {
  const ctx = frame.request.context;
  const observed = dedupe([...ctx.previousBars.bass, ...ctx.currentBars.bass, ...ctx.nextBars.bass])
    .map((n) => ({ start: n.start, end: n.end, pitch: n.pitch }));
  if (observed.length) return { bass: observed, kind: "source_bass" };
  return { bass: chordRootsAsBass(frame.chords), kind: "chord_roots" };
}

function sectionContext(frame: ComposeFrame): MelodicSectionContext {
  const { request } = frame;
  return {
    name: request.section.sectionName,
    function: request.section.function,
    occurrenceIndex: request.formMemory?.occurrenceIndex ?? null,
    developmentOperator: request.formMemory?.developmentOperator ?? null,
    tensionRole: request.arcIntent?.tensionRole ?? null,
  };
}

/**
 * The seconds the request's context actually covers (its previous / current /
 * next bars, sliced on the Song Model's own bar grid). The composer's bar is
 * numerator x quarter (a documented B-12 defect), so in 6/8 or 7/8 its section
 * window runs past the bars in view; a melodic part must not answer a singer
 * it cannot see, so its windows are clipped to this span and the ledger says so.
 */
function visibleSpan(frame: ComposeFrame): { start: number; end: number } | null {
  const ctx = frame.request.context;
  const items = [...ctx.previousBars.chords, ...ctx.previousBars.melody, ...ctx.currentBars.chords, ...ctx.currentBars.melody, ...ctx.nextBars.chords, ...ctx.nextBars.melody];
  if (!items.length) return null;
  return { start: Math.min(...items.map((i) => i.start)), end: Math.max(...items.map((i) => i.end)) };
}

function partWindowSeconds(frame: ComposeFrame, ledger?: MotifLedger): { start: number; end: number } {
  const { request, origin, barSeconds, startSeconds, endSeconds } = frame;
  const window = request.partWindow ?? { startBar: request.section.startBar, endBar: request.section.endBar };
  const raw = {
    start: Math.max(startSeconds, origin + (window.startBar - 1) * barSeconds),
    end: Math.min(endSeconds, origin + window.endBar * barSeconds),
  };
  const visible = visibleSpan(frame);
  if (!visible) return raw;
  const clipped = { start: Math.max(raw.start, visible.start), end: Math.min(raw.end, visible.end) };
  if (ledger && (clipped.end < raw.end - 1e-3 || clipped.start > raw.start + 1e-3)) {
    ledger.note(`${request.taskId}: the composer's window ${raw.start.toFixed(2)}-${raw.end.toFixed(2)} s runs past the bars in view (${visible.start.toFixed(2)}-${visible.end.toFixed(2)} s; composer bar = numerator x quarter, B-12); the melodic part is limited to what it can see`);
  }
  return clipped.end > clipped.start ? clipped : raw;
}

function phraseUnits(frame: ComposeFrame, window: { start: number; end: number }): Array<{ start: number; end: number; id: string }> {
  const { request, origin, barSeconds } = frame;
  return (request.phrases ?? [])
    .map((p) => ({ start: origin + (p.startBar - 1) * barSeconds, end: origin + p.endBar * barSeconds, id: p.id }))
    .map((u) => ({ ...u, start: Math.max(u.start, window.start), end: Math.min(u.end, window.end) }))
    .filter((u) => u.end - u.start >= frame.beatSeconds)
    .sort((a, b) => a.start - b.start);
}

function baseRequest(frame: ComposeFrame, ledger: MotifLedger): Omit<MelodicLineRequest, "kind" | "window" | "idPrefix" | "phraseId" | "placement"> {
  const { request } = frame;
  const bass = bassReference(frame);
  return {
    beatSeconds: frame.beatSeconds,
    beatsPerBar: frame.beats,
    originSeconds: frame.origin,
    chords: frame.chords,
    range: { lo: frame.lo, hi: frame.hi },
    maxLeap: request.constraints.maxLeap,
    minNoteDuration: request.constraints.minNoteDuration,
    vocal: vocalEvidence(frame),
    bass: bass.bass,
    bassReference: bass.kind,
    ledger,
    section: sectionContext(frame),
    instrument: request.instrument,
    taskId: request.taskId,
    baseVelocity: frame.baseVelocity,
    density: frame.density,
    seed: frame.seed,
  };
}

/** Emit an engine result through the frame (ids are already `${taskId}-…`; the frame prefixes the taskId itself). */
function emit(frame: ComposeFrame, result: MelodicLineResult): number {
  const prefix = `${frame.request.taskId}-`;
  let emitted = 0;
  for (const note of result.notes) {
    const suffix = note.id.startsWith(prefix) ? note.id.slice(prefix.length) : note.id;
    frame.push(note.start, note.duration, note.pitch, note.velocity, suffix, note.motif);
    emitted += 1;
  }
  return emitted;
}

export type AnswerWindow = { start: number; end: number; id: string; placement: MotifOccurrenceRecord["placement"] };

/**
 * Where an answer may sit. With melody evidence: the gaps between sung spans
 * (never over a sung note), after a breath. Without it: the second half of
 * the last bar of every plan phrase — an inference from the section plan,
 * recorded as such.
 */
export function answerWindows(frame: ComposeFrame, ledger: MotifLedger): AnswerWindow[] {
  const { beatSeconds, barSeconds } = frame;
  const window = partWindowSeconds(frame, ledger);
  const vocal = vocalEvidence(frame);
  const breath = beatSeconds * 0.5;
  const maxSpan = barSeconds * 2;
  if (vocal.length) {
    return vocalGaps(vocal, window.start, window.end, { mergeGap: beatSeconds * 0.5, minSeconds: beatSeconds * 1.5 })
      .map((gap, index) => {
        const start = gap.start + Math.min(breath, (gap.end - gap.start) * 0.2);
        const end = Math.min(gap.end - beatSeconds * 0.25, start + maxSpan);
        return { start, end, id: `gap-${index + 1}`, placement: "vocal_gap" as const };
      })
      .filter((w) => w.end - w.start >= beatSeconds);
  }
  const units = phraseUnits(frame, window);
  const inferred = (units.length ? units : splitBars(frame, window, 4)).map((u) => {
    const lastBarStart = u.end - barSeconds;
    const start = Math.max(u.start, lastBarStart + barSeconds / 2);
    return { start, end: u.end - beatSeconds * 0.25, id: u.id, placement: "inferred_phrase_end" as const };
  }).filter((w) => w.end - w.start >= beatSeconds);
  if (inferred.length) {
    ledger.note(`${frame.request.taskId}: no melody evidence in view - ${inferred.length} answer window(s) placed at phrase ends inferred from the section plan (bars ${frame.request.section.startBar}-${frame.request.section.endBar}); an inference, not a heard gap`);
  }
  return inferred;
}

function splitBars(frame: ComposeFrame, window: { start: number; end: number }, bars: number): Array<{ start: number; end: number; id: string }> {
  const out: Array<{ start: number; end: number; id: string }> = [];
  const step = frame.barSeconds * bars;
  let i = 0;
  for (let t = window.start; t < window.end - 1e-6; t += step, i += 1) out.push({ start: t, end: Math.min(window.end, t + step), id: `bars-${i + 1}` });
  return out;
}

/** CALL_RESPONSE (and ACCENT, when wired): answers in the vocal gaps. */
export function writeAnswerPhrases(frame: ComposeFrame): void {
  const { ledger } = ledgerFor(frame);
  const windows = answerWindows(frame, ledger);
  if (!ledger.data.entries.length) {
    writeLegacyCounterMelodyFigure(frame, ledger, windows);
    return;
  }
  const base = baseRequest(frame, ledger);
  windows.forEach((w, index) => {
    const result = writeMelodicLine({
      ...base, kind: "answer", window: { start: w.start, end: w.end },
      idPrefix: `${frame.request.taskId}-ans${index}`, phraseId: w.id, placement: w.placement,
    });
    emit(frame, result);
  });
}

/** COUNTER_MELODY: a counter-line under the voice across the part window, phrase by phrase. */
export function writeCounterLine(frame: ComposeFrame): void {
  const { ledger } = ledgerFor(frame);
  const window = partWindowSeconds(frame, ledger);
  if (!ledger.data.entries.length) {
    writeLegacyCounterMelodyFigure(frame, ledger, answerWindows(frame, ledger));
    return;
  }
  const result = writeMelodicLine({
    ...baseRequest(frame, ledger), kind: "counterline", window, units: phraseUnits(frame, window),
    idPrefix: `${frame.request.taskId}-cl`, phraseId: frame.request.phrases?.[0]?.id ?? `${frame.request.section.sectionName}-line`,
    placement: "part_window",
  });
  emit(frame, result);
}

/** Instrumental-section LEAD: the hook stated by the instrument (foreground). */
export function writeInstrumentalLead(frame: ComposeFrame): void {
  const { ledger } = ledgerFor(frame);
  const window = partWindowSeconds(frame, ledger);
  if (!ledger.data.entries.length) {
    writeLegacyCounterMelodyFigure(frame, ledger, answerWindows(frame, ledger));
    return;
  }
  const result = writeMelodicLine({
    ...baseRequest(frame, ledger), kind: "lead", window, units: phraseUnits(frame, window),
    idPrefix: `${frame.request.taskId}-lead`, phraseId: frame.request.phrases?.[0]?.id ?? `${frame.request.section.sectionName}-lead`,
    placement: "part_window",
  });
  emit(frame, result);
}

/** COUNTER_MELODY / CALL_RESPONSE dispatch (the task the thin composer already routes here). */
export function writeCounterMelody(frame: ComposeFrame): void {
  if (frame.request.task === "CALL_RESPONSE" || frame.request.role === "CALL_RESPONSE") writeAnswerPhrases(frame);
  else writeCounterLine(frame);
}

/**
 * The pre-B-10 figure, verbatim in shape (`[0, 1, 2, 1]` on chord tones near
 * the top of the register, 0.75-beat steps) — only when the ledger has no
 * motif. Every note is labelled with the fallback cell and the ledger records
 * the fallback with its reason.
 */
export function writeLegacyCounterMelodyFigure(frame: ComposeFrame, ledger: MotifLedger, windows: AnswerWindow[]): void {
  const { request, chords, lo, hi, beatSeconds, baseVelocity, push } = frame;
  const entry = ledger.adopt(FALLBACK_CELL, {
    kind: "fallback_cell",
    reason: `${request.taskId}: the ledger has no motif (${ledger.data.reason}); the composer's fixed [0, 1, 2, 1] cell is used and labelled`,
  });
  ledger.note(`${request.taskId}: fallback figure - no motif in the ledger (${ledger.data.reason})`);
  const fingerprint = emittedFingerprint(FALLBACK_CELL);
  const evidence = sha256(stableJson({ fallback: true, taskId: request.taskId, reason: ledger.data.reason }));
  const targets = windows.length
    ? windows
    : [{ start: frame.endSeconds - frame.barSeconds, end: frame.endSeconds, id: "section-end", placement: "inferred_phrase_end" as const }];
  const barOf = (t: number) => Math.floor((t - frame.origin) / frame.barSeconds + 1e-6) + 1;
  targets.forEach((window, index) => {
    const chord = chords.find((c) => c.end > window.start && c.start < window.end) ?? chords[0];
    if (!chord) return;
    const tones = chordPitchClasses(chord);
    const figure = [0, 1, 2, 1];
    const span = window.end - window.start;
    if (span <= 0) return;
    const stepCount = Math.min(figure.length, Math.max(2, Math.round(span / (beatSeconds * 0.75))));
    const ids: string[] = [];
    for (let s = 0; s < stepCount; s += 1) {
      const pc = tones[figure[s % figure.length] % tones.length];
      const suffix = `cm${index}-${s}`;
      const motif: NonNullable<MusicalNote["motif"]> = {
        id: entry.id, fingerprint, parentMotifId: null, transformation: "repetition", phraseId: window.id,
        intention: "response", evidenceSha256: evidence, windowEndSeconds: Number(window.end.toFixed(4)),
      };
      push(window.start + s * beatSeconds * 0.75, beatSeconds * 0.6, voiceNear(pc, hi - 8, lo, hi), baseVelocity - 4, suffix, motif);
      ids.push(`${request.taskId}-${suffix}`);
    }
    ledger.record({
      motifId: entry.id, transformation: "repetition", intendedTransformation: "repetition", transposition: 0,
      sectionName: request.section.sectionName, sectionFunction: request.section.function,
      occurrenceIndex: request.formMemory?.occurrenceIndex ?? null,
      startBar: barOf(window.start), endBar: barOf(window.end - 1e-3),
      startSeconds: Number(window.start.toFixed(4)), endSeconds: Number(window.end.toFixed(4)),
      instrument: request.instrument, taskId: request.taskId, phraseId: window.id, intention: "response",
      cell: FALLBACK_CELL, noteIds: ids, recallOf: null, placement: window.placement,
      reason: "fallback: no motif in the ledger",
    });
  });
}
