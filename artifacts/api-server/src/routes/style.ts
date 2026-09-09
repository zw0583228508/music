/**
 * Universal style decomposition (Wave Q, Q-02 — PR-66).
 *
 *   POST /api/style/decompose  { description, maxQuestions?, deterministicOnly? }
 *
 * Read-only and stateless: it touches no table, writes nothing and needs no
 * schema change. A signed-in caller sends a style description in any words —
 * "1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat" — and gets
 * back the universal style representation, what stayed unknown, the questions
 * worth asking, the grammar rules and the per-role arrangement instructions.
 *
 * No model runs behind this route: the default provider is the deterministic
 * seed one. Nothing here writes a note.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { decomposeStyle, decomposeStyleDeterministic } from "../lib/universalStyle";

const router: IRouter = Router();

/** A description longer than this is a brief, not a style, and is refused rather than truncated. */
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_QUESTIONS_CAP = 10;

router.post("/style/decompose", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    res.status(400).json({ error: "description is required" });
    return;
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    res.status(400).json({ error: `description must be at most ${MAX_DESCRIPTION_CHARS} characters` });
    return;
  }
  const rawMax = body.maxQuestions;
  if (rawMax !== undefined && (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 0 || rawMax > MAX_QUESTIONS_CAP)) {
    res.status(400).json({ error: `maxQuestions must be an integer between 0 and ${MAX_QUESTIONS_CAP}` });
    return;
  }
  if (body.deterministicOnly !== undefined && typeof body.deterministicOnly !== "boolean") {
    res.status(400).json({ error: "deterministicOnly must be a boolean" });
    return;
  }

  try {
    // `deterministicOnly` runs the parser with no reasoning provider at all —
    // what the text itself says, and nothing anybody generalised.
    if (body.deterministicOnly === true) {
      const parsed = decomposeStyleDeterministic(description);
      res.status(200).json({ mode: "parser_only", style: parsed.style, cues: parsed.cues, share: parsed.share });
      return;
    }
    const result = await decomposeStyle(description, { maxQuestions: rawMax as number | undefined });
    res.status(200).json({
      mode: "parser_and_seed",
      style: result.style,
      cues: result.parse.cues,
      synthesis: result.synthesis,
      questions: result.questions,
      grammar: result.grammar,
      grammarSlot: result.grammarSlot,
      instructions: result.instructions,
      share: result.share,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? `style decomposition failed: ${error.message}` : "style decomposition failed",
    });
  }
});

export default router;
