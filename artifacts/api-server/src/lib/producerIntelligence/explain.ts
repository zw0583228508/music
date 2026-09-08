/**
 * Explainability (Wave U, PR-U1).
 *
 * "Why is there a clarinet here?" is answered from the plan's own data — the
 * section plan's role assignments, the global palette's rationale, the
 * orchestration budget windows, the transition devices, and the brief's
 * decisions — and every answer lists the evidence it used. When the plan holds
 * no evidence for the question, the answer says so; nothing is invented.
 */
import type {
  ArrangementPlan,
  PlanExplanation,
  ProductionBrief,
} from "@workspace/db";
import { activeDecisions, resolveSectionRef, type SectionLike } from "./briefCompiler";
import { extractUserIntentSync } from "./intentExtraction";
import { instrumentFamily, lookupWord } from "./vocabulary";

export type ExplainContext = Pick<ArrangementPlan, "globalPlan" | "sectionPlan" | "orchestrationBudget" | "transitionPlan"> & {
  brief?: ProductionBrief;
};

const FAMILY_ALIASES: Record<string, string> = { synths: "synth", pad: "pads", piano: "keys", vocal: "vocals" };
const canonical = (family: string): string => FAMILY_ALIASES[family] ?? family;

const ABSENCE = /\b(no|not|isn't|aren't|without|missing|gone|absent)\b|\bwhy\s+(?:is|are)\s+there\s+no\b|אין|למה\s+לא|בלי/iu;
const CLIMAX = /\b(climax|peak)\b|שיא/iu;
const LOUD = /\b(loud|big|full|busy|dense|strong|powerful)\b|חזק|מלא|עמוס|גדול/iu;
const QUIET = /\b(quiet|thin|sparse|empty|soft|small|bare)\b|שקט|דליל|ריק|רזה/iu;

type Evidence = PlanExplanation["evidence"][number];

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function explainDecision(plan: ExplainContext, question: string): PlanExplanation {
  const intent = extractUserIntentSync(question);
  const sections: SectionLike[] = (plan.globalPlan?.sectionTargets ?? [])
    .map((t) => ({ name: t.sectionName, startBar: t.startBar, endBar: t.endBar }));
  const sectionRef = intent.sectionRequests[0]?.section;
  const sectionNames = sectionRef ? resolveSectionRef(sectionRef, sections) : [];
  const family = (() => {
    const named = intent.inferences.find((i) => i.slot === "instrument")?.value
      ?? intent.constraints.map((c) => lookupWord(c.subject)).find((e) => e?.slot === "instrument")?.value;
    return named ? canonical(instrumentFamily(named)) : undefined;
  })();
  const absence = ABSENCE.test(question);
  const evidence: Evidence[] = [];
  const lines: string[] = [];
  /** Set when the question presupposes something the plan does not contain. */
  let presuppositionFailure: string | null = null;

  const inSections = (name: string): boolean => !sectionNames.length || sectionNames.includes(name);
  const sectionLabel = sectionNames.length ? sectionNames.join(", ") : "every section";

  // --- an instrument ------------------------------------------------------------
  if (family) {
    const assignments = (plan.sectionPlan?.roleAssignments ?? [])
      .filter((r) => canonical(r.instrument) === family && inSections(r.sectionName));
    for (const a of assignments) {
      evidence.push({
        source: "sectionPlan.roleAssignments",
        ref: `${a.sectionName}/${a.instrument}`,
        detail: `role ${a.role}, register ${a.register}, density ${fmt(a.density)}, melodic ${fmt(a.melodicActivity)}, interaction with lead: ${a.interactionWithLead}, bars ${a.entryBar}–${a.exitBar}`,
      });
    }
    const palette = plan.globalPlan?.instrumentPalette.find((p) => canonical(p.role) === family);
    if (palette) {
      evidence.push({ source: "globalPlan.instrumentPalette", ref: palette.role, detail: `priority ${palette.priority}: ${palette.rationale}` });
    }
    for (const window of plan.orchestrationBudget?.windows ?? []) {
      const section = sections.find((s) => window.startBar <= s.endBar && window.endBar >= s.startBar);
      if (section && !inSections(section.name)) continue;
      const adjustment = window.instrumentAdjustments.find((x) => canonical(x.instrument) === family);
      if (!adjustment) continue;
      evidence.push({
        source: "orchestrationBudget.windows",
        ref: window.id,
        detail: `bars ${window.startBar}–${window.endBar}: vocal attention ${fmt(window.vocalAttention)}, density ×${fmt(adjustment.densityMultiplier)}, register shift ${adjustment.registerShift} — ${adjustment.note}`,
      });
    }
    for (const transition of plan.transitionPlan?.transitions ?? []) {
      for (const device of transition.devices) {
        if (canonical(device.instrument) !== family) continue;
        if (sectionNames.length && !sectionNames.includes(transition.toSection) && !sectionNames.includes(transition.fromSection)) continue;
        evidence.push({ source: "transitionPlan.transitions", ref: transition.id, detail: `${device.device} into ${transition.toSection} (bars ${device.startBar}–${device.endBar}): ${device.rationale}` });
      }
    }
    if (plan.brief) {
      for (const d of activeDecisions(plan.brief)) {
        const mentions = (d.scope.kind === "track" && canonical(d.scope.instrument) === family) ||
          (typeof d.value === "string" && canonical(d.value) === family) ||
          (Array.isArray(d.value) && d.value.map(canonical).includes(family));
        if (mentions) evidence.push({ source: "brief.producerDecisions", ref: d.id, detail: `${d.strength} ${d.topic}: ${d.statement} (${d.provenance})` });
      }
    }

    if (assignments.length) {
      const roles = [...new Set(assignments.map((a) => `${a.role.toLowerCase().replace(/_/g, " ")} in ${a.sectionName}`))];
      lines.push(`${family} is planned as ${roles.join("; ")}.`);
      if (palette) lines.push(`It is in the palette because it is ${palette.rationale}.`);
      const ducked = evidence.filter((e) => e.source === "orchestrationBudget.windows");
      if (ducked.length) lines.push(`The orchestration budget adjusts it in ${ducked.length} window(s) around the vocal.`);
    } else if (absence || !assignments.length) {
      const inactive = (plan.sectionPlan?.sections ?? [])
        .filter((s) => inSections(s.sectionName) && s.inactiveInstrumentFamilies.map(canonical).includes(family));
      for (const s of inactive) {
        evidence.push({ source: "sectionPlan.sections", ref: s.sectionName, detail: `inactive families [${s.inactiveInstrumentFamilies.join(", ")}] at energy ${fmt(s.energy)}; active [${s.activeInstrumentFamilies.join(", ")}]` });
      }
      if (inactive.length) {
        lines.push(`${family} is in the palette but sits out ${inactive.map((s) => s.sectionName).join(", ")}: at the planned energy the section keeps ${inactive[0].activeInstrumentFamilies.length} families (${inactive[0].activeInstrumentFamilies.join(", ")}).`);
      } else if (!palette && plan.globalPlan) {
        // The question presupposes an instrument the plan never planned. That
        // is not an explanation to give confidently; it is a fact to report
        // with the palette as evidence.
        evidence.push({ source: "globalPlan.instrumentPalette", ref: "(all)", detail: `palette: ${plan.globalPlan.instrumentPalette.map((p) => p.role).join(", ")}` });
        presuppositionFailure = `${family} is not in this plan's palette at all (palette: ${plan.globalPlan.instrumentPalette.map((p) => p.role).join(", ")})`;
      }
    }
  }

  // --- a section --------------------------------------------------------------------
  if (!family && sectionNames.length) {
    for (const name of sectionNames) {
      const target = plan.globalPlan?.sectionTargets.find((t) => t.sectionName === name);
      const section = plan.sectionPlan?.sections.find((s) => s.sectionName === name);
      if (target) {
        evidence.push({ source: "globalPlan.sectionTargets", ref: name, detail: `role ${target.role}, energy ${fmt(target.energy)}, density ${fmt(target.density)}, tension ${fmt(target.tension)}, novelty ${fmt(target.noveltyVsPrevious)}` });
      }
      if (section) {
        evidence.push({ source: "sectionPlan.sections", ref: name, detail: `lead ${section.leadRole}; active [${section.activeInstrumentFamilies.join(", ")}]; inactive [${section.inactiveInstrumentFamilies.join(", ")}]; groove ${section.groove}` });
      }
      if (target && section) {
        const character = LOUD.test(question) ? "full" : QUIET.test(question) ? "thin" : "shaped";
        lines.push(`${name} is ${character} because the plan targets energy ${fmt(target.energy)} and density ${fmt(target.density)} for a ${target.role}; at that energy it keeps ${section.activeInstrumentFamilies.length} families (${section.activeInstrumentFamilies.join(", ")}) with ${section.leadRole} leading.`);
      }
      if (plan.brief) {
        const intention = plan.brief.sectionIntentions.find((s) => s.sectionName === name);
        if (intention?.energyBias || intention?.densityBias || intention?.climax) {
          evidence.push({ source: "brief.sectionIntentions", ref: name, detail: `energy bias ${intention.energyBias?.value ?? 0}, density bias ${intention.densityBias?.value ?? 0}, climax ${intention.climax?.value ?? "unset"}` });
          lines.push(`The brief nudged it (energy ${intention.energyBias?.value ?? 0}, density ${intention.densityBias?.value ?? 0}).`);
        }
      }
    }
  }

  // --- the climax --------------------------------------------------------------------
  if (CLIMAX.test(question) && plan.globalPlan) {
    const climax = plan.globalPlan.climax;
    if (climax) {
      evidence.push({ source: "globalPlan.climax", ref: climax.sectionName, detail: `bar ${climax.atBar}, energy ${fmt(climax.energy)}` });
      lines.push(`The climax is planned in ${climax.sectionName} at bar ${climax.atBar} (energy ${fmt(climax.energy)}) — the highest-scoring climax candidate in the musical map.`);
      if (plan.globalPlan.secondaryClimax) {
        evidence.push({ source: "globalPlan.secondaryClimax", ref: plan.globalPlan.secondaryClimax.sectionName, detail: `bar ${plan.globalPlan.secondaryClimax.atBar}` });
      }
    } else {
      evidence.push({ source: "globalPlan.climax", ref: "(none)", detail: "no climax candidate in the musical map" });
      lines.push("No climax is planned: the musical map produced no climax candidate.");
    }
  }

  const answered = lines.length > 0;
  if (!answered) {
    const missing = !plan.globalPlan && !plan.sectionPlan
      ? "the plan has no global or section plan to read"
      : presuppositionFailure
        ? presuppositionFailure
        : family || sectionNames.length
        ? `the plan holds no evidence about ${family ?? ""}${family && sectionNames.length ? " in " : ""}${sectionNames.join(", ")}`
        : sectionRef
          ? `no ${sectionRef.function} section exists in this plan (sections: ${sections.map((s) => s.name).join(", ") || "none"})`
          : "the question names no instrument, section or climax the plan could be asked about";
    return {
      answered: false,
      answer: `I can't explain that from the plan: ${missing}.`,
      evidence,
      confidence: 0,
    };
  }
  return {
    answered: true,
    answer: lines.join(" "),
    evidence,
    confidence: Math.min(0.9, Math.round((0.4 + 0.12 * evidence.length) * 100) / 100),
  };
}
