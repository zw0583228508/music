/**
 * The song's opening figure and its ending, as the writers realise them
 * (Brain B-21; the decisions are Brain B-18's, in `arrangementArc.ts`).
 *
 * B-18 made the two ends of the song *decisions* — `ArrangementArc.opening`
 * (`tonic_pad` / `piano_motif` / `pickup_only` / `none`, with `impliesTonic`
 * true when the intro states the key even though the chord analysis found no
 * chord under it) and `ArrangementArc.ending` (`held_final_chord` / `stop` /
 * `fade`, with a ritardando where the style takes one) — and said plainly that
 * no writer realises either. Measured on the owner's song: the arc says
 *
 *   opening = tonic_pad, Intro, 2 bars, impliesTonic: true, families [keys, bass]
 *   ending  = held_final_chord, Outro, 2 bars, ritardando: true
 *
 * and bars 1–2 shipped **silent** — the earliest note in the whole arrangement
 * was at 3.795 s — because the keys and bass tasks for the Intro found zero
 * chord events in their window and every downstream step (the voicing solver,
 * the bass skeleton, the comping onsets) is keyed on those events. The
 * orchestration critic reported `planned_family_silent` as *blocking*.
 *
 * This module answers the two questions a writer has to ask, and nothing else:
 * "does the arc want a figure here, and on which chord?". It never invents a
 * second opinion about what the intro is — `figure`, `impliesTonic`, the bar
 * count and the families are read from the arc as decided.
 */
import type { ArcEndingIntent, ArcOpeningIntent, ChordHarmonyEvent } from "@workspace/db";
import { canonicalFamily } from "../arrangementArc";
import type { ComposeFrame } from "./frame";

export type OpeningFigure = {
  figure: ArcOpeningIntent["figure"];
  /** Absolute seconds of the opening window (the arc's bar count, inside this part's section). */
  start: number;
  end: number;
  /** Downbeat of every bar of the window. */
  barStarts: number[];
  /**
   * The chord the intro states. The arc says the intro implies the tonic; the
   * tonic of this song is the chord its first analysed bar carries, so the
   * figure is written on the first chord the part can see after its own
   * (empty) window — never on a pitch this module chose.
   */
  chord: ChordHarmonyEvent | null;
  chordSource: "own_window" | "next_bars" | "none";
  /** True when the arc names this part's family among the ones that play the figure. */
  plays: boolean;
  reason: string;
};

export type EndingIntent = {
  gesture: ArcEndingIntent["gesture"];
  /** True when the arc names this part's family among the ones that hold the final chord. */
  plays: boolean;
  ritardando: boolean;
  reason: string;
};

/**
 * The opening figure this part must write, or null when the arc asks for none,
 * when this section is not the arc's opening section, or when the section
 * already carries harmony (the ordinary writers then have material and this
 * module has no business overriding them).
 */
export function openingFigureFor(frame: ComposeFrame, hasHarmony: boolean): OpeningFigure | null {
  const { request } = frame;
  const decision = request.globalPlan?.arc?.opening;
  if (!decision) return null;
  const opening = decision.value;
  if (!opening || opening.figure === "none" || !opening.sectionName) return null;
  if (opening.sectionName !== request.section.sectionName) return null;
  if (hasHarmony) return null;
  if (!opening.impliesTonic) return null;
  const family = canonicalFamily(request.instrument);
  const plays = opening.families.map((f) => canonicalFamily(f)).includes(family);
  const bars = Math.max(1, Math.min(opening.barCount, request.section.endBar - request.section.startBar + 1));
  const firstBar = Math.max(request.section.startBar, request.partWindow.startBar);
  const barStarts: number[] = [];
  for (let bar = firstBar; bar < firstBar + bars && bar <= request.section.endBar; bar += 1) {
    barStarts.push(frame.origin + (bar - 1) * frame.barSeconds);
  }
  const own = frame.chords[0] ?? null;
  const next = request.context.nextBars.chords[0] ?? request.context.currentBars.chords[0] ?? null;
  const chord = own ?? next;
  return {
    figure: opening.figure,
    start: barStarts[0] ?? frame.startSeconds,
    end: (barStarts[barStarts.length - 1] ?? frame.startSeconds) + frame.barSeconds,
    barStarts,
    chord,
    chordSource: own ? "own_window" : next ? "next_bars" : "none",
    plays,
    reason: `${decision.source}: ${decision.reason}; ${plays ? `${family} plays the figure` : `${family} is not among the figure's families (${opening.families.join(", ")})`}`,
  };
}

/** The arc's ending as this part must realise it, or null when the arc states none. */
export function endingIntentFor(frame: ComposeFrame): EndingIntent | null {
  const decision = frame.request.globalPlan?.arc?.ending;
  if (!decision) return null;
  const ending = decision.value;
  if (!ending) return null;
  const family = canonicalFamily(frame.request.instrument);
  const named = ending.families.map((f) => canonicalFamily(f));
  return {
    gesture: ending.gesture,
    // A pitched part that is playing at the end holds the chord; the arc's
    // family list is the plan's *primary* holders, not an exclusion list, so a
    // family that is not named still ends with the gesture the arc chose
    // rather than with a different one.
    plays: named.length === 0 || named.includes(family),
    ritardando: ending.ritardando,
    reason: `${decision.source}: ${decision.reason}`,
  };
}
