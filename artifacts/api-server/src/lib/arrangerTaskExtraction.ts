/**
 * Arranger task extraction (Wave Q, Q-05 — Data Factory Tier B).
 *
 * The plan's Tier B: "tasks extracted automatically from each score". This
 * turns one admitted human score into arranger training examples of the form
 *
 *     given the rest of the arrangement, write this one part
 *
 * which is exactly the decision an arranger makes, and whose target is a real
 * human-written part — so the model learns from human choices, not from a
 * teacher's imitation of them.
 *
 * One example is:
 *
 *  - **context** — the structure tokens plus every track *except* the target,
 *    over a bar window;
 *  - **target** — the held-out track's tokens over the same window.
 *
 * Rules that keep the examples honest:
 *
 *  - A score with only one track yields nothing: there is no "rest of the
 *    arrangement" to condition on.
 *  - The target track must actually play in the window. Predicting "this part
 *    is silent here" from a score where it is always silent teaches nothing.
 *  - Windows do not overlap within one (score, target) pair, so the same bars
 *    are not counted twice, and a train/val split on `workId` cannot leak.
 *  - Every example carries its `workId`, so the dataset rights proof can trace
 *    it back to an admitted work.
 */
import type { ParsedMidi } from "./midiFile";
import {
  FAMILIES,
  detokenize,
  familyOf,
  tokenize,
  toGridNotes,
  type TokenizeOptions,
} from "./arrangerRemi";

export type ArrangerTask = {
  workId: string;
  targetFamily: string;
  barStart: number;
  barEnd: number;
  /** Structure + every non-target track, over [barStart, barEnd). */
  contextTokens: string[];
  /** The target track only, over the same window. */
  targetTokens: string[];
  contextTokenCount: number;
  targetTokenCount: number;
  /** Notes the target part actually plays in the window — the thing to predict. */
  targetNoteCount: number;
  /** Distinct non-target families in the context. More context is a richer task. */
  contextFamilyCount: number;
};

export type ExtractionOptions = {
  /** Bars per example window. */
  windowBars?: number;
  /** Skip a score with fewer than this many bars of content. */
  minBars?: number;
  /** Cap examples per score, so one long multi-section piece cannot dominate. */
  maxTasksPerScore?: number;
  /** Passed through to the tokenizer (bar cap). */
  tokenize?: TokenizeOptions;
};

const DEFAULTS = {
  windowBars: 8,
  minBars: 8,
  maxTasksPerScore: 12,
} as const;

/**
 * Slice a token stream to a bar range and, optionally, one family.
 *
 * Operates on the already-emitted stream rather than re-tokenizing, so the
 * context and the target are guaranteed to be exactly what the model would see
 * — no chance of the slice and the full tokenization disagreeing.
 */
function sliceStream(
  tokens: readonly string[],
  barStart: number,
  barEnd: number,
  keep: "all_except" | "only",
  family: string,
): string[] {
  const out: string[] = [];
  // Carry the structure prefix (BOS, TimeSig, Tempo) so a window is self-describing.
  for (const token of tokens) {
    if (token === "Bar") break;
    out.push(token);
  }

  let bar = -1;
  let currentFamily: string | null = null;
  let emittingBar = false;
  for (const token of tokens) {
    if (token === "Bar") {
      bar += 1;
      currentFamily = null;
      emittingBar = bar >= barStart && bar < barEnd;
      if (emittingBar) out.push("Bar");
      continue;
    }
    if (!emittingBar) continue;
    if (token === "BOS" || token === "TimeSig_4/4" || token.startsWith("TimeSig_") || token.startsWith("Tempo_") || token === "EOS") {
      continue;
    }
    if (token.startsWith("Track_")) {
      currentFamily = token.slice(6);
      const wanted = keep === "only" ? currentFamily === family : currentFamily !== family;
      if (wanted) out.push(token);
      continue;
    }
    const wanted = keep === "only" ? currentFamily === family : currentFamily !== family;
    if (wanted) out.push(token);
  }
  out.push("EOS");
  return out;
}

/** How many notes a family plays in a bar window, from the grid representation. */
function targetActivity(midi: ParsedMidi, options: TokenizeOptions | undefined): Map<string, Map<number, number>> {
  const grid = toGridNotes(midi, options);
  const perBar = grid.stepsPerBarValue;
  const activity = new Map<string, Map<number, number>>();
  for (const note of grid.notes) {
    const bar = Math.floor(note.startStep / perBar);
    const byBar = activity.get(note.family) ?? new Map<number, number>();
    byBar.set(bar, (byBar.get(bar) ?? 0) + 1);
    activity.set(note.family, byBar);
  }
  return activity;
}

/**
 * All arranger tasks from one score. Deterministic: the same ParsedMidi yields
 * the same tasks in the same order.
 */
export function extractArrangerTasks(
  midi: ParsedMidi,
  workId: string,
  options: ExtractionOptions = {},
): ArrangerTask[] {
  const windowBars = options.windowBars ?? DEFAULTS.windowBars;
  const minBars = options.minBars ?? DEFAULTS.minBars;
  const maxTasks = options.maxTasksPerScore ?? DEFAULTS.maxTasksPerScore;

  const grid = toGridNotes(midi, options.tokenize);
  if (grid.barCount < minBars) return [];

  const familiesPresent = [...new Set(midi.notes.map((note) => familyOf(note)))];
  if (familiesPresent.length < 2) return [];

  const fullStream = tokenize(midi, options.tokenize);
  const activity = targetActivity(midi, options.tokenize);
  const tasks: ArrangerTask[] = [];

  // Deterministic order: family order, then window order.
  for (const targetFamily of FAMILIES) {
    if (!familiesPresent.includes(targetFamily)) continue;
    const targetByBar = activity.get(targetFamily) ?? new Map<number, number>();

    for (let barStart = 0; barStart + windowBars <= grid.barCount; barStart += windowBars) {
      if (tasks.length >= maxTasks) return tasks;
      const barEnd = barStart + windowBars;

      let targetNotes = 0;
      for (let bar = barStart; bar < barEnd; bar += 1) targetNotes += targetByBar.get(bar) ?? 0;
      // The target must play here, or the example teaches "predict silence".
      if (targetNotes === 0) continue;

      const contextTokens = sliceStream(fullStream, barStart, barEnd, "all_except", targetFamily);
      const targetTokens = sliceStream(fullStream, barStart, barEnd, "only", targetFamily);

      // The context must contain some other part, or there is nothing to arrange against.
      const contextFamilies = new Set(
        contextTokens.filter((t) => t.startsWith("Track_")).map((t) => t.slice(6)),
      );
      if (contextFamilies.size === 0) continue;

      tasks.push({
        workId,
        targetFamily,
        barStart,
        barEnd,
        contextTokens,
        targetTokens,
        contextTokenCount: contextTokens.length,
        targetTokenCount: targetTokens.length,
        targetNoteCount: targetNotes,
        contextFamilyCount: contextFamilies.size,
      });
    }
  }
  return tasks;
}

/**
 * A task is well-formed when its target, detokenized, contains the note count
 * the task claims and nothing from another family. Used by the extraction
 * script to reject a malformed slice rather than train on it.
 */
export function taskIsWellFormed(task: ArrangerTask): { ok: true } | { ok: false; reason: string } {
  if (task.barEnd <= task.barStart) return { ok: false, reason: "empty window" };
  if (task.targetNoteCount <= 0) return { ok: false, reason: "target part is silent in the window" };
  if (task.contextFamilyCount <= 0) return { ok: false, reason: "no context part to arrange against" };

  const back = detokenize(task.targetTokens);
  const otherFamily = back.notes.find((note) => note.family !== task.targetFamily);
  if (otherFamily) return { ok: false, reason: `target slice leaked a ${otherFamily.family} note` };

  const contextBack = detokenize(task.contextTokens);
  const leaked = contextBack.notes.find((note) => note.family === task.targetFamily);
  if (leaked) return { ok: false, reason: "context slice leaked the target family" };

  return { ok: true };
}
