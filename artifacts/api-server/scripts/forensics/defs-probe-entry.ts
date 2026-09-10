import { getInstrumentDefinition, getInstrumentPerformanceCapability } from "../../src/lib/musicEngines";
for (const [name, role] of [["keys","HARMONIC_BED"],["piano","HARMONIC_BED"],["strings","PAD"],["pads","PAD"],["pad","PAD"],["percussion","GROOVE"],["mix","HARMONIC_BED"],["ensemble","TRANSITION"],["bass","BASS"],["synth","PAD"],["guitar","RHYTHMIC_HARMONY"],["winds","COUNTER_MELODY"],["brass","CLIMAX_LAYER"]]) {
  const d = getInstrumentDefinition(name, role);
  console.log(name.padEnd(11), role.padEnd(16), "->", d.id.padEnd(8), d.family.padEnd(8), `${d.playableRange.min}-${d.playableRange.max}`, "poly", d.polyphonic, "native", getInstrumentPerformanceCapability(d).nativeRenderers.join("+"));
}
