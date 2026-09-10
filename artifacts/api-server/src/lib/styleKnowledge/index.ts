/**
 * Style knowledge base — registry (Brain B-09).
 *
 * Every entry the platform ships, in a fixed order (matching ties break on
 * this order, then on id, so resolution is deterministic). Adding a style is
 * adding a data file and one line here; `styleKnowledge.test.ts` validates
 * every entry against the contract.
 */
import type { StyleKnowledgeEntry } from "./schema";
import { ballad } from "./ballad";
import { chassidicBallad } from "./chassidicBallad";
import { chassidicSimcha } from "./chassidicSimcha";
import { mizrahiPop } from "./mizrahiPop";
import { pop, popBallad } from "./pop";
import { singerSongwriterAcoustic } from "./singerSongwriterAcoustic";
import { rock } from "./rock";
import { edmDance } from "./edmDance";
import { jazzStandard } from "./jazzStandard";
import { orchestralCinematic } from "./orchestralCinematic";
import { gospel } from "./gospel";
import { bossaLatin } from "./bossaLatin";
import { hipHopRnb } from "./hipHopRnb";

export * from "./schema";

export const STYLE_KNOWLEDGE_VERSION = "STYLE_KNOWLEDGE_V1" as const;

export const STYLE_KNOWLEDGE_ENTRIES: readonly StyleKnowledgeEntry[] = [
  // Specific worlds first: on an equal score a family entry beats a generic
  // form ("jazz ballad" resolves to the jazz standard, not to the bare ballad).
  chassidicBallad,
  chassidicSimcha,
  mizrahiPop,
  popBallad,
  singerSongwriterAcoustic,
  rock,
  edmDance,
  jazzStandard,
  orchestralCinematic,
  gospel,
  bossaLatin,
  hipHopRnb,
  // Generic forms and families last (parents of the entries above).
  ballad,
  pop,
];

export const knowledgeEntryById = (id: string): StyleKnowledgeEntry | undefined =>
  STYLE_KNOWLEDGE_ENTRIES.find((entry) => entry.id === id);
