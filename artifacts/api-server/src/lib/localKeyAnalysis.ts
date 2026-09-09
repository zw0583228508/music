/**
 * Local spectral key evidence (PR-89: moved verbatim out of `sourceAnalyzer.ts`
 * so the calibration runner can measure it in isolation; behaviour unchanged).
 *
 * The loudest pitch class out of a Goertzel sweep over two octaves decides
 * the tonic; the relative energy of the minor vs major third and sixth decides
 * the mode. It returns null when no pitch class stands out - on a real mixed
 * recording that is the usual outcome, which is why `keyFromNotes` exists.
 */
export function detectKeyEvidence(
  samples: Float32Array,
  sampleRate: number,
): { key: string; confidence: number } | null {
  const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const maxSamples = Math.min(samples.length, sampleRate * 60);
  if (!maxSamples) return null;
  let mean = 0;
  for (let i = 0; i < maxSamples; i += 1) mean += samples[i];
  mean /= maxSamples;
  const pitchEnergy = Array.from({ length: 12 }, () => 0);
  for (let midi = 48; midi <= 71; midi += 1) {
    const omega = (2 * Math.PI * (440 * 2 ** ((midi - 69) / 12))) / sampleRate;
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < maxSamples; i += 8) {
      const centered = samples[i] - mean;
      real += centered * Math.cos(omega * i);
      imaginary -= centered * Math.sin(omega * i);
    }
    pitchEnergy[midi % 12] += Math.hypot(real, imaginary);
  }
  const ranked = [...pitchEnergy].sort((a, b) => b - a);
  const peak = ranked[0] ?? 0;
  const runnerUp = ranked[1] ?? 0;
  const total = pitchEnergy.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || peak <= 0) return null;
  const peakShare = peak / total;
  const separation = (peak - runnerUp) / peak;
  if (peakShare < 0.1 || separation < 0.04) return null;
  const root = pitchEnergy.indexOf(peak);
  const minor = pitchEnergy[(root + 3) % 12] + pitchEnergy[(root + 8) % 12] >
    pitchEnergy[(root + 4) % 12] + pitchEnergy[(root + 7) % 12];
  return {
    key: `${noteNames[root]} ${minor ? "minor" : "major"}`,
    confidence: Number(Math.min(0.82, 0.35 + peakShare * 1.8 + separation).toFixed(2)),
  };
}
