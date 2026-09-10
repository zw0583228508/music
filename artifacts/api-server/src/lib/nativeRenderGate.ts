/**
 * The native-render plausibility gate (PR-98).
 *
 * A licensed native renderer (sfizz in the cloud, a VST3 host on the owner's
 * machine) returns audio that the export used to accept after a shape check:
 * right length, finite, not silent, not clipped. On the owner's first real
 * song that let a stuck plugin voice through — a constant chord-tone drone
 * from the first sample to the last, with clipped stems — because a drone is
 * not silent and its clipping sat below the threshold. The one thing the
 * export always has for every track is the preview render of the *same*
 * notes by the local synth: not production sound, but a truthful envelope.
 * A native stem that does not follow that envelope is not this track.
 *
 * Every check is over short-window RMS in dBFS and returns a reason a
 * producer can read; the caller falls back to the preview and records it.
 */
export type NativeGateVerdict = { ok: true } | { ok: false; reasons: string[] };

export type NativeGateOptions = {
  sampleRate: number;
  channels?: number;
  windowSeconds?: number;
  /** dBFS below which a window counts as silent. */
  silenceDbfs?: number;
  /** Maximum native level allowed where the preview is silent (before the first note). */
  leadInMaxDbfs?: number;
  /** Minimum envelope correlation when the preview has real dynamics. */
  minCorrelation?: number;
};

const DEFAULTS = { channels: 2, windowSeconds: 1, silenceDbfs: -60, leadInMaxDbfs: -45, minCorrelation: 0.35 };

export function rmsEnvelopeDb(samples: Float32Array, sampleRate: number, channels: number, windowSeconds: number): number[] {
  const win = Math.max(1, Math.floor(sampleRate * windowSeconds)) * channels;
  const out: number[] = [];
  for (let start = 0; start + win <= samples.length; start += win) {
    let acc = 0;
    for (let i = start; i < start + win; i += 1) acc += samples[i] * samples[i];
    out.push(20 * Math.log10(Math.sqrt(acc / win) + 1e-9));
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 1;
  let ma = 0; let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i += 1) { const da = a[i] - ma; const db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (saa === 0 || sbb === 0) return saa === sbb ? 1 : 0;
  return sab / Math.sqrt(saa * sbb);
}

function stddev(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * Compare a native stem with the preview render of the same track. Both are
 * interleaved float buffers at the same sample rate and length.
 */
export function judgeNativeAgainstPreview(
  native: Float32Array,
  preview: Float32Array,
  options: NativeGateOptions,
): NativeGateVerdict {
  const o = { ...DEFAULTS, ...options };
  const reasons: string[] = [];
  const nat = rmsEnvelopeDb(native, o.sampleRate, o.channels, o.windowSeconds);
  const pre = rmsEnvelopeDb(preview, o.sampleRate, o.channels, o.windowSeconds);
  const n = Math.min(nat.length, pre.length);
  if (n === 0) return { ok: true };

  // 1. Lead-in: where the preview is silent before the first note, the
  //    native stem must be (near) silent too. A stuck voice fails here.
  let firstActive = pre.findIndex((v) => v > o.silenceDbfs);
  if (firstActive < 0) firstActive = n;
  const leadIn = nat.slice(0, firstActive);
  const leadInMax = leadIn.length ? Math.max(...leadIn) : Number.NEGATIVE_INFINITY;
  if (leadIn.length >= 1 && leadInMax > o.leadInMaxDbfs) {
    reasons.push(`native stem carries ${leadInMax.toFixed(1)} dBFS during the ${leadIn.length} s before the first note (preview is silent there)`);
  }

  // 2. Silence inside the song: windows where the preview is silent (rests
  //    longer than the window) must not carry sustained native level.
  let restViolations = 0; let restWindows = 0;
  for (let i = firstActive; i < n; i += 1) {
    if (pre[i] <= o.silenceDbfs) { restWindows += 1; if (nat[i] > o.leadInMaxDbfs + 10) restViolations += 1; }
  }
  if (restWindows >= 3 && restViolations / restWindows > 0.5) {
    reasons.push(`native stem sounds through ${restViolations} of ${restWindows} rest windows where the preview is silent`);
  }

  // 3. Dynamics: when the preview has real dynamics, the native envelope must
  //    move with it. A constant drone has ~0 spread and ~0 correlation.
  const active = pre.map((v, i) => [v, nat[i]] as const).filter(([v]) => v > o.silenceDbfs);
  const preActive = active.map(([v]) => v); const natActive = active.map(([, v]) => v);
  if (preActive.length >= 8 && stddev(preActive) >= 3) {
    const corr = pearson(preActive, natActive);
    if (corr < o.minCorrelation) {
      reasons.push(`native envelope does not follow the notes (correlation ${corr.toFixed(2)} over ${preActive.length} s; preview spread ${stddev(preActive).toFixed(1)} dB, native ${stddev(natActive).toFixed(1)} dB)`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
