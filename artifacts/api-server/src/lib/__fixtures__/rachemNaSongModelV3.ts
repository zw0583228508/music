/**
 * Slimmed Song Model of the owner's song "רחם נא" (Song Model v3,
 * `trusted_automatically`, 4:18, 130 BPM, C minor, 92 chords, 9 sections) -
 * the standing test case of the Arrangement Brain program (Brain B-01).
 *
 * Generated from the stored `songmodel-v3.json` by
 * `scratchpad/b01/slim_fixture.py`: tempo / meter / key maps, chords, sections,
 * bars, beats, the energy and dynamics curves, stem hints and the vocal /
 * reconciliation statuses are kept verbatim (coordinates stripped); waveform,
 * provider provenance, trust report and the stored musical map are dropped.
 * `rachemNaSongModel()` re-derives the musical map deterministically from
 * this evidence, and `RACHEM_NA_STORED_PALETTE_HINTS` /
 * `RACHEM_NA_STORED_SECTION_ENERGY` record what the stored v3 map said so a
 * test can prove the re-derived map reproduces the owner's measurements.
 */
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "../songMusicalMap";

export const RACHEM_NA_FIXED_NOW = new Date("2026-09-10T00:00:00.000Z");

/** `musicalMap.styleFingerprint.instrumentPaletteHints` of the stored v3 map. */
export const RACHEM_NA_STORED_PALETTE_HINTS: string[] = ["mix"];

/** The stored v3 map's max-normalised RMS per bar span (source energy, the old "target"). */
export const RACHEM_NA_STORED_ENERGY_CURVE: Array<{ startBar: number; endBar: number; energy: number }> =
  [{"startBar": 1, "endBar": 1, "energy": 0}, {"startBar": 2, "endBar": 2, "energy": 0.017}, {"startBar": 3, "endBar": 3, "energy": 0.04}, {"startBar": 4, "endBar": 4, "energy": 0.057}, {"startBar": 5, "endBar": 5, "energy": 0.058}, {"startBar": 6, "endBar": 6, "energy": 0.062}, {"startBar": 7, "endBar": 7, "energy": 0.065}, {"startBar": 8, "endBar": 8, "energy": 0.069}, {"startBar": 9, "endBar": 9, "energy": 0.079}, {"startBar": 10, "endBar": 10, "energy": 0.098}, {"startBar": 11, "endBar": 11, "energy": 0.128}, {"startBar": 12, "endBar": 12, "energy": 0.131}, {"startBar": 13, "endBar": 13, "energy": 0.126}, {"startBar": 14, "endBar": 14, "energy": 0.154}, {"startBar": 15, "endBar": 15, "energy": 0.252}, {"startBar": 16, "endBar": 16, "energy": 0.437}, {"startBar": 17, "endBar": 17, "energy": 0.312}, {"startBar": 18, "endBar": 18, "energy": 0.088}, {"startBar": 19, "endBar": 19, "energy": 0.103}, {"startBar": 20, "endBar": 20, "energy": 0.089}, {"startBar": 21, "endBar": 21, "energy": 0.214}, {"startBar": 22, "endBar": 22, "energy": 0.447}, {"startBar": 23, "endBar": 23, "energy": 0.322}, {"startBar": 24, "endBar": 24, "energy": 0.108}, {"startBar": 25, "endBar": 25, "energy": 0.1}, {"startBar": 26, "endBar": 26, "energy": 0.085}, {"startBar": 27, "endBar": 27, "energy": 0.101}, {"startBar": 28, "endBar": 28, "energy": 0.1}, {"startBar": 29, "endBar": 29, "energy": 0.086}, {"startBar": 30, "endBar": 30, "energy": 0.09}, {"startBar": 31, "endBar": 31, "energy": 0.088}, {"startBar": 32, "endBar": 32, "energy": 0.097}, {"startBar": 33, "endBar": 33, "energy": 0.258}, {"startBar": 34, "endBar": 34, "energy": 0.265}, {"startBar": 35, "endBar": 35, "energy": 0.106}, {"startBar": 36, "endBar": 36, "energy": 0.095}, {"startBar": 37, "endBar": 37, "energy": 0.091}, {"startBar": 38, "endBar": 38, "energy": 0.08}, {"startBar": 39, "endBar": 39, "energy": 0.092}, {"startBar": 40, "endBar": 40, "energy": 0.552}, {"startBar": 41, "endBar": 41, "energy": 0.541}, {"startBar": 42, "endBar": 42, "energy": 0.093}, {"startBar": 43, "endBar": 43, "energy": 0.112}, {"startBar": 44, "endBar": 44, "energy": 0.108}, {"startBar": 45, "endBar": 45, "energy": 0.075}, {"startBar": 46, "endBar": 46, "energy": 0.359}, {"startBar": 47, "endBar": 47, "energy": 0.55}, {"startBar": 48, "endBar": 48, "energy": 0.269}, {"startBar": 49, "endBar": 49, "energy": 0.079}, {"startBar": 50, "endBar": 50, "energy": 0.205}, {"startBar": 51, "endBar": 51, "energy": 0.353}, {"startBar": 52, "endBar": 52, "energy": 0.292}, {"startBar": 53, "endBar": 53, "energy": 0.174}, {"startBar": 54, "endBar": 54, "energy": 0.116}, {"startBar": 55, "endBar": 55, "energy": 0.259}, {"startBar": 56, "endBar": 56, "energy": 0.405}, {"startBar": 57, "endBar": 57, "energy": 0.238}, {"startBar": 58, "endBar": 58, "energy": 0.446}, {"startBar": 59, "endBar": 59, "energy": 0.769}, {"startBar": 60, "endBar": 60, "energy": 0.582}, {"startBar": 61, "endBar": 61, "energy": 0.433}, {"startBar": 62, "endBar": 62, "energy": 0.292}, {"startBar": 63, "endBar": 63, "energy": 0.165}, {"startBar": 64, "endBar": 64, "energy": 0.152}, {"startBar": 65, "endBar": 65, "energy": 0.113}, {"startBar": 66, "endBar": 66, "energy": 0.174}, {"startBar": 67, "endBar": 67, "energy": 0.571}, {"startBar": 68, "endBar": 68, "energy": 0.581}, {"startBar": 69, "endBar": 69, "energy": 0.186}, {"startBar": 70, "endBar": 70, "energy": 0.237}, {"startBar": 71, "endBar": 71, "energy": 0.508}, {"startBar": 72, "endBar": 72, "energy": 0.5}, {"startBar": 73, "endBar": 73, "energy": 0.255}, {"startBar": 74, "endBar": 74, "energy": 0.114}, {"startBar": 75, "endBar": 75, "energy": 0.074}, {"startBar": 76, "endBar": 76, "energy": 0.06}, {"startBar": 77, "endBar": 77, "energy": 0.079}, {"startBar": 78, "endBar": 78, "energy": 0.095}, {"startBar": 79, "endBar": 79, "energy": 0.107}, {"startBar": 80, "endBar": 80, "energy": 0.113}, {"startBar": 81, "endBar": 81, "energy": 0.085}, {"startBar": 82, "endBar": 82, "energy": 0.084}, {"startBar": 83, "endBar": 83, "energy": 0.093}, {"startBar": 84, "endBar": 84, "energy": 0.098}, {"startBar": 85, "endBar": 85, "energy": 0.082}, {"startBar": 86, "endBar": 86, "energy": 0.068}, {"startBar": 87, "endBar": 87, "energy": 0.091}, {"startBar": 88, "endBar": 88, "energy": 0.097}, {"startBar": 89, "endBar": 89, "energy": 0.096}, {"startBar": 90, "endBar": 90, "energy": 0.077}, {"startBar": 91, "endBar": 91, "energy": 0.062}, {"startBar": 92, "endBar": 92, "energy": 0.074}, {"startBar": 93, "endBar": 93, "energy": 0.266}, {"startBar": 94, "endBar": 94, "energy": 0.273}, {"startBar": 95, "endBar": 95, "energy": 0.091}, {"startBar": 96, "endBar": 96, "energy": 0.093}, {"startBar": 97, "endBar": 98, "energy": 0.11}, {"startBar": 99, "endBar": 99, "energy": 0.09}, {"startBar": 100, "endBar": 100, "energy": 0.073}, {"startBar": 101, "endBar": 101, "energy": 0.068}, {"startBar": 102, "endBar": 102, "energy": 0.191}, {"startBar": 103, "endBar": 103, "energy": 0.198}, {"startBar": 104, "endBar": 104, "energy": 0.084}, {"startBar": 105, "endBar": 105, "energy": 0.095}, {"startBar": 106, "endBar": 106, "energy": 0.104}, {"startBar": 107, "endBar": 107, "energy": 0.085}, {"startBar": 108, "endBar": 108, "energy": 0.375}, {"startBar": 109, "endBar": 109, "energy": 0.75}, {"startBar": 110, "endBar": 110, "energy": 0.541}, {"startBar": 111, "endBar": 111, "energy": 0.162}, {"startBar": 112, "endBar": 112, "energy": 0.068}, {"startBar": 113, "endBar": 113, "energy": 0.078}, {"startBar": 114, "endBar": 114, "energy": 0.08}, {"startBar": 115, "endBar": 115, "energy": 0.102}, {"startBar": 116, "endBar": 116, "energy": 0.091}, {"startBar": 117, "endBar": 117, "energy": 0.077}, {"startBar": 118, "endBar": 118, "energy": 0.147}, {"startBar": 119, "endBar": 119, "energy": 0.289}, {"startBar": 120, "endBar": 120, "energy": 0.45}, {"startBar": 121, "endBar": 121, "energy": 0.329}, {"startBar": 122, "endBar": 122, "energy": 0.137}, {"startBar": 123, "endBar": 123, "energy": 0.117}, {"startBar": 124, "endBar": 124, "energy": 0.081}, {"startBar": 125, "endBar": 125, "energy": 0.089}, {"startBar": 126, "endBar": 126, "energy": 0.112}, {"startBar": 127, "endBar": 127, "energy": 0.107}, {"startBar": 128, "endBar": 128, "energy": 0.076}, {"startBar": 129, "endBar": 129, "energy": 0.061}, {"startBar": 130, "endBar": 130, "energy": 0.092}, {"startBar": 131, "endBar": 131, "energy": 0.115}, {"startBar": 132, "endBar": 132, "energy": 0.105}, {"startBar": 133, "endBar": 133, "energy": 0.096}, {"startBar": 134, "endBar": 134, "energy": 0.099}, {"startBar": 135, "endBar": 135, "energy": 0.38}, {"startBar": 136, "endBar": 136, "energy": 0.491}, {"startBar": 137, "endBar": 137, "energy": 0.196}, {"startBar": 138, "endBar": 138, "energy": 0.07}, {"startBar": 139, "endBar": 139, "energy": 0.055}, {"startBar": 140, "endBar": 140, "energy": 0.025}, {"startBar": 141, "endBar": 141, "energy": 0.011}];

/**
 * Section energy targets of the stored v3 global plan (`62d5aabc`), i.e. the
 * source recording's max-normalised RMS that the old planner used as intent.
 */
export const RACHEM_NA_V3_SECTION_ENERGY: Record<string, number> = {
  "Intro": 0.005, "Verse 1": 0.125, "Verse 2": 0.129, "Chorus": 0.274, "Chorus 2": 0.427,
  "Verse 3": 0.093, "Bridge": 0.175, "Chorus 3": 0.185, "Outro": 0.083,
};

const RAW = {
 "contractVersion": "2.0",
 "timebase": {
  "ppq": 960,
  "originSeconds": 0,
  "coordinateSystem": "seconds+ticks"
 },
 "audio": {
  "name": "rachem-na.mp3",
  "contentType": "audio/mpeg",
  "size": 4127049,
  "durationSeconds": 257.940563,
  "sampleRate": 44100,
  "channels": 2,
  "proxyObjectPath": null,
  "proxyContentType": null,
  "analysisStartSeconds": 0,
  "analysisDurationSeconds": 257.940563,
  "analysisCoverage": "full"
 },
 "analysisStartSeconds": 0,
 "analysisDurationSeconds": 257.940563,
 "analysisCoverage": 1,
 "tempoMap": [
  {
   "time": 0,
   "bpm": 130.43,
   "confidence": 1
  }
 ],
 "meterMap": [
  {
   "bar": 1,
   "meter": "4/4",
   "confidence": 1
  }
 ],
 "keyMap": [
  {
   "time": 0,
   "key": "C minor",
   "confidence": 1
  }
 ],
 "beats": [
  {
   "time": 0,
   "beat": 1,
   "bar": 1,
   "confidence": 1
  },
  {
   "time": 0.4600168672851338,
   "beat": 2,
   "bar": 1,
   "confidence": 1
  },
  {
   "time": 0.9200337345702676,
   "beat": 3,
   "bar": 1,
   "confidence": 1
  },
  {
   "time": 1.3800506018554013,
   "beat": 4,
   "bar": 1,
   "confidence": 1
  },
  {
   "time": 1.8400674691405352,
   "beat": 1,
   "bar": 2,
   "confidence": 1
  },
  {
   "time": 2.3000843364256687,
   "beat": 2,
   "bar": 2,
   "confidence": 1
  },
  {
   "time": 2.7601012037108026,
   "beat": 3,
   "bar": 2,
   "confidence": 1
  },
  {
   "time": 3.2201180709959365,
   "beat": 4,
   "bar": 2,
   "confidence": 1
  },
  {
   "time": 3.6801349382810704,
   "beat": 1,
   "bar": 3,
   "confidence": 1
  },
  {
   "time": 4.140151805566204,
   "beat": 2,
   "bar": 3,
   "confidence": 1
  },
  {
   "time": 4.600168672851337,
   "beat": 3,
   "bar": 3,
   "confidence": 1
  },
  {
   "time": 5.060185540136471,
   "beat": 4,
   "bar": 3,
   "confidence": 1
  },
  {
   "time": 5.520202407421605,
   "beat": 1,
   "bar": 4,
   "confidence": 1
  },
  {
   "time": 5.980219274706739,
   "beat": 2,
   "bar": 4,
   "confidence": 1
  },
  {
   "time": 6.440236141991873,
   "beat": 3,
   "bar": 4,
   "confidence": 1
  },
  {
   "time": 6.900253009277007,
   "beat": 4,
   "bar": 4,
   "confidence": 1
  },
  {
   "time": 7.360269876562141,
   "beat": 1,
   "bar": 5,
   "confidence": 1
  },
  {
   "time": 7.820286743847274,
   "beat": 2,
   "bar": 5,
   "confidence": 1
  },
  {
   "time": 8.280303611132409,
   "beat": 3,
   "bar": 5,
   "confidence": 1
  },
  {
   "time": 8.740320478417543,
   "beat": 4,
   "bar": 5,
   "confidence": 1
  },
  {
   "time": 9.200337345702675,
   "beat": 1,
   "bar": 6,
   "confidence": 1
  },
  {
   "time": 9.660354212987809,
   "beat": 2,
   "bar": 6,
   "confidence": 1
  },
  {
   "time": 10.120371080272943,
   "beat": 3,
   "bar": 6,
   "confidence": 1
  },
  {
   "time": 10.580387947558076,
   "beat": 4,
   "bar": 6,
   "confidence": 1
  },
  {
   "time": 11.04040481484321,
   "beat": 1,
   "bar": 7,
   "confidence": 1
  },
  {
   "time": 11.500421682128344,
   "beat": 2,
   "bar": 7,
   "confidence": 1
  },
  {
   "time": 11.960438549413478,
   "beat": 3,
   "bar": 7,
   "confidence": 1
  },
  {
   "time": 12.420455416698612,
   "beat": 4,
   "bar": 7,
   "confidence": 1
  },
  {
   "time": 12.880472283983746,
   "beat": 1,
   "bar": 8,
   "confidence": 1
  },
  {
   "time": 13.34048915126888,
   "beat": 2,
   "bar": 8,
   "confidence": 1
  },
  {
   "time": 13.800506018554014,
   "beat": 3,
   "bar": 8,
   "confidence": 1
  },
  {
   "time": 14.260522885839148,
   "beat": 4,
   "bar": 8,
   "confidence": 1
  },
  {
   "time": 14.720539753124282,
   "beat": 1,
   "bar": 9,
   "confidence": 1
  },
  {
   "time": 15.180556620409414,
   "beat": 2,
   "bar": 9,
   "confidence": 1
  },
  {
   "time": 15.640573487694548,
   "beat": 3,
   "bar": 9,
   "confidence": 1
  },
  {
   "time": 16.100590354979683,
   "beat": 4,
   "bar": 9,
   "confidence": 1
  },
  {
   "time": 16.560607222264817,
   "beat": 1,
   "bar": 10,
   "confidence": 1
  },
  {
   "time": 17.02062408954995,
   "beat": 2,
   "bar": 10,
   "confidence": 1
  },
  {
   "time": 17.480640956835085,
   "beat": 3,
   "bar": 10,
   "confidence": 1
  },
  {
   "time": 17.94065782412022,
   "beat": 4,
   "bar": 10,
   "confidence": 1
  },
  {
   "time": 18.40067469140535,
   "beat": 1,
   "bar": 11,
   "confidence": 1
  },
  {
   "time": 18.860691558690483,
   "beat": 2,
   "bar": 11,
   "confidence": 1
  },
  {
   "time": 19.320708425975617,
   "beat": 3,
   "bar": 11,
   "confidence": 1
  },
  {
   "time": 19.78072529326075,
   "beat": 4,
   "bar": 11,
   "confidence": 1
  },
  {
   "time": 20.240742160545885,
   "beat": 1,
   "bar": 12,
   "confidence": 1
  },
  {
   "time": 20.70075902783102,
   "beat": 2,
   "bar": 12,
   "confidence": 1
  },
  {
   "time": 21.160775895116153,
   "beat": 3,
   "bar": 12,
   "confidence": 1
  },
  {
   "time": 21.620792762401287,
   "beat": 4,
   "bar": 12,
   "confidence": 1
  },
  {
   "time": 22.08080962968642,
   "beat": 1,
   "bar": 13,
   "confidence": 1
  },
  {
   "time": 22.540826496971555,
   "beat": 2,
   "bar": 13,
   "confidence": 1
  },
  {
   "time": 23.00084336425669,
   "beat": 3,
   "bar": 13,
   "confidence": 1
  },
  {
   "time": 23.460860231541822,
   "beat": 4,
   "bar": 13,
   "confidence": 1
  },
  {
   "time": 23.920877098826956,
   "beat": 1,
   "bar": 14,
   "confidence": 1
  },
  {
   "time": 24.38089396611209,
   "beat": 2,
   "bar": 14,
   "confidence": 1
  },
  {
   "time": 24.840910833397224,
   "beat": 3,
   "bar": 14,
   "confidence": 1
  },
  {
   "time": 25.300927700682358,
   "beat": 4,
   "bar": 14,
   "confidence": 1
  },
  {
   "time": 25.760944567967492,
   "beat": 1,
   "bar": 15,
   "confidence": 1
  },
  {
   "time": 26.220961435252626,
   "beat": 2,
   "bar": 15,
   "confidence": 1
  },
  {
   "time": 26.68097830253776,
   "beat": 3,
   "bar": 15,
   "confidence": 1
  },
  {
   "time": 27.140995169822894,
   "beat": 4,
   "bar": 15,
   "confidence": 1
  },
  {
   "time": 27.601012037108028,
   "beat": 1,
   "bar": 16,
   "confidence": 1
  },
  {
   "time": 28.06102890439316,
   "beat": 2,
   "bar": 16,
   "confidence": 1
  },
  {
   "time": 28.521045771678295,
   "beat": 3,
   "bar": 16,
   "confidence": 1
  },
  {
   "time": 28.98106263896343,
   "beat": 4,
   "bar": 16,
   "confidence": 1
  },
  {
   "time": 29.441079506248563,
   "beat": 1,
   "bar": 17,
   "confidence": 1
  },
  {
   "time": 29.901096373533697,
   "beat": 2,
   "bar": 17,
   "confidence": 1
  },
  {
   "time": 30.361113240818828,
   "beat": 3,
   "bar": 17,
   "confidence": 1
  },
  {
   "time": 30.82113010810396,
   "beat": 4,
   "bar": 17,
   "confidence": 1
  },
  {
   "time": 31.281146975389095,
   "beat": 1,
   "bar": 18,
   "confidence": 1
  },
  {
   "time": 31.74116384267423,
   "beat": 2,
   "bar": 18,
   "confidence": 1
  },
  {
   "time": 32.20118070995937,
   "beat": 3,
   "bar": 18,
   "confidence": 1
  },
  {
   "time": 32.6611975772445,
   "beat": 4,
   "bar": 18,
   "confidence": 1
  },
  {
   "time": 33.121214444529635,
   "beat": 1,
   "bar": 19,
   "confidence": 1
  },
  {
   "time": 33.58123131181477,
   "beat": 2,
   "bar": 19,
   "confidence": 1
  },
  {
   "time": 34.0412481790999,
   "beat": 3,
   "bar": 19,
   "confidence": 1
  },
  {
   "time": 34.501265046385036,
   "beat": 4,
   "bar": 19,
   "confidence": 1
  },
  {
   "time": 34.96128191367017,
   "beat": 1,
   "bar": 20,
   "confidence": 1
  },
  {
   "time": 35.421298780955304,
   "beat": 2,
   "bar": 20,
   "confidence": 1
  },
  {
   "time": 35.88131564824044,
   "beat": 3,
   "bar": 20,
   "confidence": 1
  },
  {
   "time": 36.34133251552557,
   "beat": 4,
   "bar": 20,
   "confidence": 1
  },
  {
   "time": 36.8013493828107,
   "beat": 1,
   "bar": 21,
   "confidence": 1
  },
  {
   "time": 37.26136625009583,
   "beat": 2,
   "bar": 21,
   "confidence": 1
  },
  {
   "time": 37.72138311738097,
   "beat": 3,
   "bar": 21,
   "confidence": 1
  },
  {
   "time": 38.1813999846661,
   "beat": 4,
   "bar": 21,
   "confidence": 1
  },
  {
   "time": 38.641416851951234,
   "beat": 1,
   "bar": 22,
   "confidence": 1
  },
  {
   "time": 39.10143371923637,
   "beat": 2,
   "bar": 22,
   "confidence": 1
  },
  {
   "time": 39.5614505865215,
   "beat": 3,
   "bar": 22,
   "confidence": 1
  },
  {
   "time": 40.021467453806636,
   "beat": 4,
   "bar": 22,
   "confidence": 1
  },
  {
   "time": 40.48148432109177,
   "beat": 1,
   "bar": 23,
   "confidence": 1
  },
  {
   "time": 40.941501188376904,
   "beat": 2,
   "bar": 23,
   "confidence": 1
  },
  {
   "time": 41.40151805566204,
   "beat": 3,
   "bar": 23,
   "confidence": 1
  },
  {
   "time": 41.86153492294717,
   "beat": 4,
   "bar": 23,
   "confidence": 1
  },
  {
   "time": 42.321551790232306,
   "beat": 1,
   "bar": 24,
   "confidence": 1
  },
  {
   "time": 42.78156865751744,
   "beat": 2,
   "bar": 24,
   "confidence": 1
  },
  {
   "time": 43.241585524802574,
   "beat": 3,
   "bar": 24,
   "confidence": 1
  },
  {
   "time": 43.70160239208771,
   "beat": 4,
   "bar": 24,
   "confidence": 1
  },
  {
   "time": 44.16161925937284,
   "beat": 1,
   "bar": 25,
   "confidence": 1
  },
  {
   "time": 44.621636126657975,
   "beat": 2,
   "bar": 25,
   "confidence": 1
  },
  {
   "time": 45.08165299394311,
   "beat": 3,
   "bar": 25,
   "confidence": 1
  },
  {
   "time": 45.54166986122824,
   "beat": 4,
   "bar": 25,
   "confidence": 1
  },
  {
   "time": 46.00168672851338,
   "beat": 1,
   "bar": 26,
   "confidence": 1
  },
  {
   "time": 46.46170359579851,
   "beat": 2,
   "bar": 26,
   "confidence": 1
  },
  {
   "time": 46.921720463083645,
   "beat": 3,
   "bar": 26,
   "confidence": 1
  },
  {
   "time": 47.38173733036878,
   "beat": 4,
   "bar": 26,
   "confidence": 1
  },
  {
   "time": 47.84175419765391,
   "beat": 1,
   "bar": 27,
   "confidence": 1
  },
  {
   "time": 48.30177106493905,
   "beat": 2,
   "bar": 27,
   "confidence": 1
  },
  {
   "time": 48.76178793222418,
   "beat": 3,
   "bar": 27,
   "confidence": 1
  },
  {
   "time": 49.221804799509314,
   "beat": 4,
   "bar": 27,
   "confidence": 1
  },
  {
   "time": 49.68182166679445,
   "beat": 1,
   "bar": 28,
   "confidence": 1
  },
  {
   "time": 50.14183853407958,
   "beat": 2,
   "bar": 28,
   "confidence": 1
  },
  {
   "time": 50.601855401364716,
   "beat": 3,
   "bar": 28,
   "confidence": 1
  },
  {
   "time": 51.06187226864985,
   "beat": 4,
   "bar": 28,
   "confidence": 1
  },
  {
   "time": 51.521889135934984,
   "beat": 1,
   "bar": 29,
   "confidence": 1
  },
  {
   "time": 51.98190600322012,
   "beat": 2,
   "bar": 29,
   "confidence": 1
  },
  {
   "time": 52.44192287050525,
   "beat": 3,
   "bar": 29,
   "confidence": 1
  },
  {
   "time": 52.901939737790386,
   "beat": 4,
   "bar": 29,
   "confidence": 1
  },
  {
   "time": 53.36195660507552,
   "beat": 1,
   "bar": 30,
   "confidence": 1
  },
  {
   "time": 53.82197347236065,
   "beat": 2,
   "bar": 30,
   "confidence": 1
  },
  {
   "time": 54.28199033964579,
   "beat": 3,
   "bar": 30,
   "confidence": 1
  },
  {
   "time": 54.74200720693092,
   "beat": 4,
   "bar": 30,
   "confidence": 1
  },
  {
   "time": 55.202024074216055,
   "beat": 1,
   "bar": 31,
   "confidence": 1
  },
  {
   "time": 55.66204094150119,
   "beat": 2,
   "bar": 31,
   "confidence": 1
  },
  {
   "time": 56.12205780878632,
   "beat": 3,
   "bar": 31,
   "confidence": 1
  },
  {
   "time": 56.58207467607146,
   "beat": 4,
   "bar": 31,
   "confidence": 1
  },
  {
   "time": 57.04209154335659,
   "beat": 1,
   "bar": 32,
   "confidence": 1
  },
  {
   "time": 57.502108410641725,
   "beat": 2,
   "bar": 32,
   "confidence": 1
  },
  {
   "time": 57.96212527792686,
   "beat": 3,
   "bar": 32,
   "confidence": 1
  },
  {
   "time": 58.42214214521199,
   "beat": 4,
   "bar": 32,
   "confidence": 1
  },
  {
   "time": 58.88215901249713,
   "beat": 1,
   "bar": 33,
   "confidence": 1
  },
  {
   "time": 59.34217587978226,
   "beat": 2,
   "bar": 33,
   "confidence": 1
  },
  {
   "time": 59.802192747067394,
   "beat": 3,
   "bar": 33,
   "confidence": 1
  },
  {
   "time": 60.26220961435253,
   "beat": 4,
   "bar": 33,
   "confidence": 1
  },
  {
   "time": 60.722226481637655,
   "beat": 1,
   "bar": 34,
   "confidence": 1
  },
  {
   "time": 61.18224334892279,
   "beat": 2,
   "bar": 34,
   "confidence": 1
  },
  {
   "time": 61.64226021620792,
   "beat": 3,
   "bar": 34,
   "confidence": 1
  },
  {
   "time": 62.10227708349306,
   "beat": 4,
   "bar": 34,
   "confidence": 1
  },
  {
   "time": 62.56229395077819,
   "beat": 1,
   "bar": 35,
   "confidence": 1
  },
  {
   "time": 63.022310818063325,
   "beat": 2,
   "bar": 35,
   "confidence": 1
  },
  {
   "time": 63.48232768534846,
   "beat": 3,
   "bar": 35,
   "confidence": 1
  },
  {
   "time": 63.94234455263359,
   "beat": 4,
   "bar": 35,
   "confidence": 1
  },
  {
   "time": 64.40236141991873,
   "beat": 1,
   "bar": 36,
   "confidence": 1
  },
  {
   "time": 64.86237828720387,
   "beat": 2,
   "bar": 36,
   "confidence": 1
  },
  {
   "time": 65.322395154489,
   "beat": 3,
   "bar": 36,
   "confidence": 1
  },
  {
   "time": 65.78241202177414,
   "beat": 4,
   "bar": 36,
   "confidence": 1
  },
  {
   "time": 66.24242888905927,
   "beat": 1,
   "bar": 37,
   "confidence": 1
  },
  {
   "time": 66.7024457563444,
   "beat": 2,
   "bar": 37,
   "confidence": 1
  },
  {
   "time": 67.16246262362954,
   "beat": 3,
   "bar": 37,
   "confidence": 1
  },
  {
   "time": 67.62247949091467,
   "beat": 4,
   "bar": 37,
   "confidence": 1
  },
  {
   "time": 68.0824963581998,
   "beat": 1,
   "bar": 38,
   "confidence": 1
  },
  {
   "time": 68.54251322548494,
   "beat": 2,
   "bar": 38,
   "confidence": 1
  },
  {
   "time": 69.00253009277007,
   "beat": 3,
   "bar": 38,
   "confidence": 1
  },
  {
   "time": 69.4625469600552,
   "beat": 4,
   "bar": 38,
   "confidence": 1
  },
  {
   "time": 69.92256382734034,
   "beat": 1,
   "bar": 39,
   "confidence": 1
  },
  {
   "time": 70.38258069462547,
   "beat": 2,
   "bar": 39,
   "confidence": 1
  },
  {
   "time": 70.84259756191061,
   "beat": 3,
   "bar": 39,
   "confidence": 1
  },
  {
   "time": 71.30261442919574,
   "beat": 4,
   "bar": 39,
   "confidence": 1
  },
  {
   "time": 71.76263129648088,
   "beat": 1,
   "bar": 40,
   "confidence": 1
  },
  {
   "time": 72.22264816376601,
   "beat": 2,
   "bar": 40,
   "confidence": 1
  },
  {
   "time": 72.68266503105114,
   "beat": 3,
   "bar": 40,
   "confidence": 1
  },
  {
   "time": 73.14268189833626,
   "beat": 4,
   "bar": 40,
   "confidence": 1
  },
  {
   "time": 73.6026987656214,
   "beat": 1,
   "bar": 41,
   "confidence": 1
  },
  {
   "time": 74.06271563290653,
   "beat": 2,
   "bar": 41,
   "confidence": 1
  },
  {
   "time": 74.52273250019167,
   "beat": 3,
   "bar": 41,
   "confidence": 1
  },
  {
   "time": 74.9827493674768,
   "beat": 4,
   "bar": 41,
   "confidence": 1
  },
  {
   "time": 75.44276623476193,
   "beat": 1,
   "bar": 42,
   "confidence": 1
  },
  {
   "time": 75.90278310204707,
   "beat": 2,
   "bar": 42,
   "confidence": 1
  },
  {
   "time": 76.3627999693322,
   "beat": 3,
   "bar": 42,
   "confidence": 1
  },
  {
   "time": 76.82281683661733,
   "beat": 4,
   "bar": 42,
   "confidence": 1
  },
  {
   "time": 77.28283370390247,
   "beat": 1,
   "bar": 43,
   "confidence": 1
  },
  {
   "time": 77.7428505711876,
   "beat": 2,
   "bar": 43,
   "confidence": 1
  },
  {
   "time": 78.20286743847274,
   "beat": 3,
   "bar": 43,
   "confidence": 1
  },
  {
   "time": 78.66288430575787,
   "beat": 4,
   "bar": 43,
   "confidence": 1
  },
  {
   "time": 79.122901173043,
   "beat": 1,
   "bar": 44,
   "confidence": 1
  },
  {
   "time": 79.58291804032814,
   "beat": 2,
   "bar": 44,
   "confidence": 1
  },
  {
   "time": 80.04293490761327,
   "beat": 3,
   "bar": 44,
   "confidence": 1
  },
  {
   "time": 80.5029517748984,
   "beat": 4,
   "bar": 44,
   "confidence": 1
  },
  {
   "time": 80.96296864218354,
   "beat": 1,
   "bar": 45,
   "confidence": 1
  },
  {
   "time": 81.42298550946867,
   "beat": 2,
   "bar": 45,
   "confidence": 1
  },
  {
   "time": 81.88300237675381,
   "beat": 3,
   "bar": 45,
   "confidence": 1
  },
  {
   "time": 82.34301924403894,
   "beat": 4,
   "bar": 45,
   "confidence": 1
  },
  {
   "time": 82.80303611132408,
   "beat": 1,
   "bar": 46,
   "confidence": 1
  },
  {
   "time": 83.26305297860921,
   "beat": 2,
   "bar": 46,
   "confidence": 1
  },
  {
   "time": 83.72306984589434,
   "beat": 3,
   "bar": 46,
   "confidence": 1
  },
  {
   "time": 84.18308671317948,
   "beat": 4,
   "bar": 46,
   "confidence": 1
  },
  {
   "time": 84.64310358046461,
   "beat": 1,
   "bar": 47,
   "confidence": 1
  },
  {
   "time": 85.10312044774975,
   "beat": 2,
   "bar": 47,
   "confidence": 1
  },
  {
   "time": 85.56313731503488,
   "beat": 3,
   "bar": 47,
   "confidence": 1
  },
  {
   "time": 86.02315418232001,
   "beat": 4,
   "bar": 47,
   "confidence": 1
  },
  {
   "time": 86.48317104960515,
   "beat": 1,
   "bar": 48,
   "confidence": 1
  },
  {
   "time": 86.94318791689028,
   "beat": 2,
   "bar": 48,
   "confidence": 1
  },
  {
   "time": 87.40320478417541,
   "beat": 3,
   "bar": 48,
   "confidence": 1
  },
  {
   "time": 87.86322165146055,
   "beat": 4,
   "bar": 48,
   "confidence": 1
  },
  {
   "time": 88.32323851874568,
   "beat": 1,
   "bar": 49,
   "confidence": 1
  },
  {
   "time": 88.78325538603082,
   "beat": 2,
   "bar": 49,
   "confidence": 1
  },
  {
   "time": 89.24327225331595,
   "beat": 3,
   "bar": 49,
   "confidence": 1
  },
  {
   "time": 89.70328912060108,
   "beat": 4,
   "bar": 49,
   "confidence": 1
  },
  {
   "time": 90.16330598788622,
   "beat": 1,
   "bar": 50,
   "confidence": 1
  },
  {
   "time": 90.62332285517135,
   "beat": 2,
   "bar": 50,
   "confidence": 1
  },
  {
   "time": 91.08333972245649,
   "beat": 3,
   "bar": 50,
   "confidence": 1
  },
  {
   "time": 91.54335658974162,
   "beat": 4,
   "bar": 50,
   "confidence": 1
  },
  {
   "time": 92.00337345702675,
   "beat": 1,
   "bar": 51,
   "confidence": 1
  },
  {
   "time": 92.46339032431189,
   "beat": 2,
   "bar": 51,
   "confidence": 1
  },
  {
   "time": 92.92340719159702,
   "beat": 3,
   "bar": 51,
   "confidence": 1
  },
  {
   "time": 93.38342405888216,
   "beat": 4,
   "bar": 51,
   "confidence": 1
  },
  {
   "time": 93.84344092616729,
   "beat": 1,
   "bar": 52,
   "confidence": 1
  },
  {
   "time": 94.30345779345242,
   "beat": 2,
   "bar": 52,
   "confidence": 1
  },
  {
   "time": 94.76347466073756,
   "beat": 3,
   "bar": 52,
   "confidence": 1
  },
  {
   "time": 95.22349152802269,
   "beat": 4,
   "bar": 52,
   "confidence": 1
  },
  {
   "time": 95.68350839530783,
   "beat": 1,
   "bar": 53,
   "confidence": 1
  },
  {
   "time": 96.14352526259296,
   "beat": 2,
   "bar": 53,
   "confidence": 1
  },
  {
   "time": 96.6035421298781,
   "beat": 3,
   "bar": 53,
   "confidence": 1
  },
  {
   "time": 97.06355899716323,
   "beat": 4,
   "bar": 53,
   "confidence": 1
  },
  {
   "time": 97.52357586444836,
   "beat": 1,
   "bar": 54,
   "confidence": 1
  },
  {
   "time": 97.9835927317335,
   "beat": 2,
   "bar": 54,
   "confidence": 1
  },
  {
   "time": 98.44360959901863,
   "beat": 3,
   "bar": 54,
   "confidence": 1
  },
  {
   "time": 98.90362646630376,
   "beat": 4,
   "bar": 54,
   "confidence": 1
  },
  {
   "time": 99.3636433335889,
   "beat": 1,
   "bar": 55,
   "confidence": 1
  },
  {
   "time": 99.82366020087403,
   "beat": 2,
   "bar": 55,
   "confidence": 1
  },
  {
   "time": 100.28367706815916,
   "beat": 3,
   "bar": 55,
   "confidence": 1
  },
  {
   "time": 100.7436939354443,
   "beat": 4,
   "bar": 55,
   "confidence": 1
  },
  {
   "time": 101.20371080272943,
   "beat": 1,
   "bar": 56,
   "confidence": 1
  },
  {
   "time": 101.66372767001457,
   "beat": 2,
   "bar": 56,
   "confidence": 1
  },
  {
   "time": 102.1237445372997,
   "beat": 3,
   "bar": 56,
   "confidence": 1
  },
  {
   "time": 102.58376140458483,
   "beat": 4,
   "bar": 56,
   "confidence": 1
  },
  {
   "time": 103.04377827186997,
   "beat": 1,
   "bar": 57,
   "confidence": 1
  },
  {
   "time": 103.5037951391551,
   "beat": 2,
   "bar": 57,
   "confidence": 1
  },
  {
   "time": 103.96381200644024,
   "beat": 3,
   "bar": 57,
   "confidence": 1
  },
  {
   "time": 104.42382887372537,
   "beat": 4,
   "bar": 57,
   "confidence": 1
  },
  {
   "time": 104.8838457410105,
   "beat": 1,
   "bar": 58,
   "confidence": 1
  },
  {
   "time": 105.34386260829564,
   "beat": 2,
   "bar": 58,
   "confidence": 1
  },
  {
   "time": 105.80387947558077,
   "beat": 3,
   "bar": 58,
   "confidence": 1
  },
  {
   "time": 106.2638963428659,
   "beat": 4,
   "bar": 58,
   "confidence": 1
  },
  {
   "time": 106.72391321015104,
   "beat": 1,
   "bar": 59,
   "confidence": 1
  },
  {
   "time": 107.18393007743617,
   "beat": 2,
   "bar": 59,
   "confidence": 1
  },
  {
   "time": 107.6439469447213,
   "beat": 3,
   "bar": 59,
   "confidence": 1
  },
  {
   "time": 108.10396381200644,
   "beat": 4,
   "bar": 59,
   "confidence": 1
  },
  {
   "time": 108.56398067929157,
   "beat": 1,
   "bar": 60,
   "confidence": 1
  },
  {
   "time": 109.02399754657671,
   "beat": 2,
   "bar": 60,
   "confidence": 1
  },
  {
   "time": 109.48401441386184,
   "beat": 3,
   "bar": 60,
   "confidence": 1
  },
  {
   "time": 109.94403128114698,
   "beat": 4,
   "bar": 60,
   "confidence": 1
  },
  {
   "time": 110.40404814843211,
   "beat": 1,
   "bar": 61,
   "confidence": 1
  },
  {
   "time": 110.86406501571724,
   "beat": 2,
   "bar": 61,
   "confidence": 1
  },
  {
   "time": 111.32408188300238,
   "beat": 3,
   "bar": 61,
   "confidence": 1
  },
  {
   "time": 111.78409875028751,
   "beat": 4,
   "bar": 61,
   "confidence": 1
  },
  {
   "time": 112.24411561757265,
   "beat": 1,
   "bar": 62,
   "confidence": 1
  },
  {
   "time": 112.70413248485778,
   "beat": 2,
   "bar": 62,
   "confidence": 1
  },
  {
   "time": 113.16414935214291,
   "beat": 3,
   "bar": 62,
   "confidence": 1
  },
  {
   "time": 113.62416621942805,
   "beat": 4,
   "bar": 62,
   "confidence": 1
  },
  {
   "time": 114.08418308671318,
   "beat": 1,
   "bar": 63,
   "confidence": 1
  },
  {
   "time": 114.54419995399832,
   "beat": 2,
   "bar": 63,
   "confidence": 1
  },
  {
   "time": 115.00421682128345,
   "beat": 3,
   "bar": 63,
   "confidence": 1
  },
  {
   "time": 115.46423368856858,
   "beat": 4,
   "bar": 63,
   "confidence": 1
  },
  {
   "time": 115.92425055585372,
   "beat": 1,
   "bar": 64,
   "confidence": 1
  },
  {
   "time": 116.38426742313885,
   "beat": 2,
   "bar": 64,
   "confidence": 1
  },
  {
   "time": 116.84428429042399,
   "beat": 3,
   "bar": 64,
   "confidence": 1
  },
  {
   "time": 117.30430115770912,
   "beat": 4,
   "bar": 64,
   "confidence": 1
  },
  {
   "time": 117.76431802499425,
   "beat": 1,
   "bar": 65,
   "confidence": 1
  },
  {
   "time": 118.22433489227939,
   "beat": 2,
   "bar": 65,
   "confidence": 1
  },
  {
   "time": 118.68435175956452,
   "beat": 3,
   "bar": 65,
   "confidence": 1
  },
  {
   "time": 119.14436862684965,
   "beat": 4,
   "bar": 65,
   "confidence": 1
  },
  {
   "time": 119.60438549413479,
   "beat": 1,
   "bar": 66,
   "confidence": 1
  },
  {
   "time": 120.06440236141992,
   "beat": 2,
   "bar": 66,
   "confidence": 1
  },
  {
   "time": 120.52441922870506,
   "beat": 3,
   "bar": 66,
   "confidence": 1
  },
  {
   "time": 120.98443609599019,
   "beat": 4,
   "bar": 66,
   "confidence": 1
  },
  {
   "time": 121.44445296327531,
   "beat": 1,
   "bar": 67,
   "confidence": 1
  },
  {
   "time": 121.90446983056044,
   "beat": 2,
   "bar": 67,
   "confidence": 1
  },
  {
   "time": 122.36448669784558,
   "beat": 3,
   "bar": 67,
   "confidence": 1
  },
  {
   "time": 122.82450356513071,
   "beat": 4,
   "bar": 67,
   "confidence": 1
  },
  {
   "time": 123.28452043241585,
   "beat": 1,
   "bar": 68,
   "confidence": 1
  },
  {
   "time": 123.74453729970098,
   "beat": 2,
   "bar": 68,
   "confidence": 1
  },
  {
   "time": 124.20455416698611,
   "beat": 3,
   "bar": 68,
   "confidence": 1
  },
  {
   "time": 124.66457103427125,
   "beat": 4,
   "bar": 68,
   "confidence": 1
  },
  {
   "time": 125.12458790155638,
   "beat": 1,
   "bar": 69,
   "confidence": 1
  },
  {
   "time": 125.58460476884152,
   "beat": 2,
   "bar": 69,
   "confidence": 1
  },
  {
   "time": 126.04462163612665,
   "beat": 3,
   "bar": 69,
   "confidence": 1
  },
  {
   "time": 126.50463850341178,
   "beat": 4,
   "bar": 69,
   "confidence": 1
  },
  {
   "time": 126.96465537069692,
   "beat": 1,
   "bar": 70,
   "confidence": 1
  },
  {
   "time": 127.42467223798205,
   "beat": 2,
   "bar": 70,
   "confidence": 1
  },
  {
   "time": 127.88468910526719,
   "beat": 3,
   "bar": 70,
   "confidence": 1
  },
  {
   "time": 128.34470597255233,
   "beat": 4,
   "bar": 70,
   "confidence": 1
  },
  {
   "time": 128.80472283983747,
   "beat": 1,
   "bar": 71,
   "confidence": 1
  },
  {
   "time": 129.2647397071226,
   "beat": 2,
   "bar": 71,
   "confidence": 1
  },
  {
   "time": 129.72475657440773,
   "beat": 3,
   "bar": 71,
   "confidence": 1
  },
  {
   "time": 130.18477344169287,
   "beat": 4,
   "bar": 71,
   "confidence": 1
  },
  {
   "time": 130.644790308978,
   "beat": 1,
   "bar": 72,
   "confidence": 1
  },
  {
   "time": 131.10480717626314,
   "beat": 2,
   "bar": 72,
   "confidence": 1
  },
  {
   "time": 131.56482404354827,
   "beat": 3,
   "bar": 72,
   "confidence": 1
  },
  {
   "time": 132.0248409108334,
   "beat": 4,
   "bar": 72,
   "confidence": 1
  },
  {
   "time": 132.48485777811854,
   "beat": 1,
   "bar": 73,
   "confidence": 1
  },
  {
   "time": 132.94487464540367,
   "beat": 2,
   "bar": 73,
   "confidence": 1
  },
  {
   "time": 133.4048915126888,
   "beat": 3,
   "bar": 73,
   "confidence": 1
  },
  {
   "time": 133.86490837997394,
   "beat": 4,
   "bar": 73,
   "confidence": 1
  },
  {
   "time": 134.32492524725907,
   "beat": 1,
   "bar": 74,
   "confidence": 1
  },
  {
   "time": 134.7849421145442,
   "beat": 2,
   "bar": 74,
   "confidence": 1
  },
  {
   "time": 135.24495898182934,
   "beat": 3,
   "bar": 74,
   "confidence": 1
  },
  {
   "time": 135.70497584911448,
   "beat": 4,
   "bar": 74,
   "confidence": 1
  },
  {
   "time": 136.1649927163996,
   "beat": 1,
   "bar": 75,
   "confidence": 1
  },
  {
   "time": 136.62500958368474,
   "beat": 2,
   "bar": 75,
   "confidence": 1
  },
  {
   "time": 137.08502645096988,
   "beat": 3,
   "bar": 75,
   "confidence": 1
  },
  {
   "time": 137.545043318255,
   "beat": 4,
   "bar": 75,
   "confidence": 1
  },
  {
   "time": 138.00506018554015,
   "beat": 1,
   "bar": 76,
   "confidence": 1
  },
  {
   "time": 138.46507705282528,
   "beat": 2,
   "bar": 76,
   "confidence": 1
  },
  {
   "time": 138.9250939201104,
   "beat": 3,
   "bar": 76,
   "confidence": 1
  },
  {
   "time": 139.38511078739555,
   "beat": 4,
   "bar": 76,
   "confidence": 1
  },
  {
   "time": 139.84512765468068,
   "beat": 1,
   "bar": 77,
   "confidence": 1
  },
  {
   "time": 140.30514452196581,
   "beat": 2,
   "bar": 77,
   "confidence": 1
  },
  {
   "time": 140.76516138925095,
   "beat": 3,
   "bar": 77,
   "confidence": 1
  },
  {
   "time": 141.22517825653608,
   "beat": 4,
   "bar": 77,
   "confidence": 1
  },
  {
   "time": 141.68519512382122,
   "beat": 1,
   "bar": 78,
   "confidence": 1
  },
  {
   "time": 142.14521199110635,
   "beat": 2,
   "bar": 78,
   "confidence": 1
  },
  {
   "time": 142.60522885839148,
   "beat": 3,
   "bar": 78,
   "confidence": 1
  },
  {
   "time": 143.06524572567662,
   "beat": 4,
   "bar": 78,
   "confidence": 1
  },
  {
   "time": 143.52526259296175,
   "beat": 1,
   "bar": 79,
   "confidence": 1
  },
  {
   "time": 143.9852794602469,
   "beat": 2,
   "bar": 79,
   "confidence": 1
  },
  {
   "time": 144.44529632753202,
   "beat": 3,
   "bar": 79,
   "confidence": 1
  },
  {
   "time": 144.90531319481715,
   "beat": 4,
   "bar": 79,
   "confidence": 1
  },
  {
   "time": 145.3653300621023,
   "beat": 1,
   "bar": 80,
   "confidence": 1
  },
  {
   "time": 145.8253469293874,
   "beat": 2,
   "bar": 80,
   "confidence": 1
  },
  {
   "time": 146.28536379667253,
   "beat": 3,
   "bar": 80,
   "confidence": 1
  },
  {
   "time": 146.74538066395766,
   "beat": 4,
   "bar": 80,
   "confidence": 1
  },
  {
   "time": 147.2053975312428,
   "beat": 1,
   "bar": 81,
   "confidence": 1
  },
  {
   "time": 147.66541439852793,
   "beat": 2,
   "bar": 81,
   "confidence": 1
  },
  {
   "time": 148.12543126581306,
   "beat": 3,
   "bar": 81,
   "confidence": 1
  },
  {
   "time": 148.5854481330982,
   "beat": 4,
   "bar": 81,
   "confidence": 1
  },
  {
   "time": 149.04546500038333,
   "beat": 1,
   "bar": 82,
   "confidence": 1
  },
  {
   "time": 149.50548186766846,
   "beat": 2,
   "bar": 82,
   "confidence": 1
  },
  {
   "time": 149.9654987349536,
   "beat": 3,
   "bar": 82,
   "confidence": 1
  },
  {
   "time": 150.42551560223873,
   "beat": 4,
   "bar": 82,
   "confidence": 1
  },
  {
   "time": 150.88553246952387,
   "beat": 1,
   "bar": 83,
   "confidence": 1
  },
  {
   "time": 151.345549336809,
   "beat": 2,
   "bar": 83,
   "confidence": 1
  },
  {
   "time": 151.80556620409413,
   "beat": 3,
   "bar": 83,
   "confidence": 1
  },
  {
   "time": 152.26558307137927,
   "beat": 4,
   "bar": 83,
   "confidence": 1
  },
  {
   "time": 152.7255999386644,
   "beat": 1,
   "bar": 84,
   "confidence": 1
  },
  {
   "time": 153.18561680594954,
   "beat": 2,
   "bar": 84,
   "confidence": 1
  },
  {
   "time": 153.64563367323467,
   "beat": 3,
   "bar": 84,
   "confidence": 1
  },
  {
   "time": 154.1056505405198,
   "beat": 4,
   "bar": 84,
   "confidence": 1
  },
  {
   "time": 154.56566740780494,
   "beat": 1,
   "bar": 85,
   "confidence": 1
  },
  {
   "time": 155.02568427509007,
   "beat": 2,
   "bar": 85,
   "confidence": 1
  },
  {
   "time": 155.4857011423752,
   "beat": 3,
   "bar": 85,
   "confidence": 1
  },
  {
   "time": 155.94571800966034,
   "beat": 4,
   "bar": 85,
   "confidence": 1
  },
  {
   "time": 156.40573487694547,
   "beat": 1,
   "bar": 86,
   "confidence": 1
  },
  {
   "time": 156.8657517442306,
   "beat": 2,
   "bar": 86,
   "confidence": 1
  },
  {
   "time": 157.32576861151574,
   "beat": 3,
   "bar": 86,
   "confidence": 1
  },
  {
   "time": 157.78578547880088,
   "beat": 4,
   "bar": 86,
   "confidence": 1
  },
  {
   "time": 158.245802346086,
   "beat": 1,
   "bar": 87,
   "confidence": 1
  },
  {
   "time": 158.70581921337114,
   "beat": 2,
   "bar": 87,
   "confidence": 1
  },
  {
   "time": 159.16583608065628,
   "beat": 3,
   "bar": 87,
   "confidence": 1
  },
  {
   "time": 159.6258529479414,
   "beat": 4,
   "bar": 87,
   "confidence": 1
  },
  {
   "time": 160.08586981522654,
   "beat": 1,
   "bar": 88,
   "confidence": 1
  },
  {
   "time": 160.54588668251168,
   "beat": 2,
   "bar": 88,
   "confidence": 1
  },
  {
   "time": 161.0059035497968,
   "beat": 3,
   "bar": 88,
   "confidence": 1
  },
  {
   "time": 161.46592041708195,
   "beat": 4,
   "bar": 88,
   "confidence": 1
  },
  {
   "time": 161.92593728436708,
   "beat": 1,
   "bar": 89,
   "confidence": 1
  },
  {
   "time": 162.38595415165221,
   "beat": 2,
   "bar": 89,
   "confidence": 1
  },
  {
   "time": 162.84597101893735,
   "beat": 3,
   "bar": 89,
   "confidence": 1
  },
  {
   "time": 163.30598788622248,
   "beat": 4,
   "bar": 89,
   "confidence": 1
  },
  {
   "time": 163.76600475350762,
   "beat": 1,
   "bar": 90,
   "confidence": 1
  },
  {
   "time": 164.22602162079275,
   "beat": 2,
   "bar": 90,
   "confidence": 1
  },
  {
   "time": 164.68603848807788,
   "beat": 3,
   "bar": 90,
   "confidence": 1
  },
  {
   "time": 165.14605535536302,
   "beat": 4,
   "bar": 90,
   "confidence": 1
  },
  {
   "time": 165.60607222264815,
   "beat": 1,
   "bar": 91,
   "confidence": 1
  },
  {
   "time": 166.06608908993329,
   "beat": 2,
   "bar": 91,
   "confidence": 1
  },
  {
   "time": 166.52610595721842,
   "beat": 3,
   "bar": 91,
   "confidence": 1
  },
  {
   "time": 166.98612282450355,
   "beat": 4,
   "bar": 91,
   "confidence": 1
  },
  {
   "time": 167.4461396917887,
   "beat": 1,
   "bar": 92,
   "confidence": 1
  },
  {
   "time": 167.90615655907382,
   "beat": 2,
   "bar": 92,
   "confidence": 1
  },
  {
   "time": 168.36617342635896,
   "beat": 3,
   "bar": 92,
   "confidence": 1
  },
  {
   "time": 168.8261902936441,
   "beat": 4,
   "bar": 92,
   "confidence": 1
  },
  {
   "time": 169.28620716092922,
   "beat": 1,
   "bar": 93,
   "confidence": 1
  },
  {
   "time": 169.74622402821436,
   "beat": 2,
   "bar": 93,
   "confidence": 1
  },
  {
   "time": 170.2062408954995,
   "beat": 3,
   "bar": 93,
   "confidence": 1
  },
  {
   "time": 170.66625776278462,
   "beat": 4,
   "bar": 93,
   "confidence": 1
  },
  {
   "time": 171.12627463006976,
   "beat": 1,
   "bar": 94,
   "confidence": 1
  },
  {
   "time": 171.5862914973549,
   "beat": 2,
   "bar": 94,
   "confidence": 1
  },
  {
   "time": 172.04630836464003,
   "beat": 3,
   "bar": 94,
   "confidence": 1
  },
  {
   "time": 172.50632523192516,
   "beat": 4,
   "bar": 94,
   "confidence": 1
  },
  {
   "time": 172.9663420992103,
   "beat": 1,
   "bar": 95,
   "confidence": 1
  },
  {
   "time": 173.42635896649543,
   "beat": 2,
   "bar": 95,
   "confidence": 1
  },
  {
   "time": 173.88637583378056,
   "beat": 3,
   "bar": 95,
   "confidence": 1
  },
  {
   "time": 174.3463927010657,
   "beat": 4,
   "bar": 95,
   "confidence": 1
  },
  {
   "time": 174.80640956835083,
   "beat": 1,
   "bar": 96,
   "confidence": 1
  },
  {
   "time": 175.26642643563596,
   "beat": 2,
   "bar": 96,
   "confidence": 1
  },
  {
   "time": 175.7264433029211,
   "beat": 3,
   "bar": 96,
   "confidence": 1
  },
  {
   "time": 176.18646017020623,
   "beat": 4,
   "bar": 96,
   "confidence": 1
  },
  {
   "time": 176.64647703749137,
   "beat": 1,
   "bar": 97,
   "confidence": 1
  },
  {
   "time": 177.1064939047765,
   "beat": 2,
   "bar": 97,
   "confidence": 1
  },
  {
   "time": 177.56651077206163,
   "beat": 3,
   "bar": 97,
   "confidence": 1
  },
  {
   "time": 178.02652763934677,
   "beat": 4,
   "bar": 97,
   "confidence": 1
  },
  {
   "time": 178.4865445066319,
   "beat": 1,
   "bar": 98,
   "confidence": 1
  },
  {
   "time": 178.94656137391704,
   "beat": 2,
   "bar": 98,
   "confidence": 1
  },
  {
   "time": 179.40657824120217,
   "beat": 3,
   "bar": 98,
   "confidence": 1
  },
  {
   "time": 179.8665951084873,
   "beat": 4,
   "bar": 98,
   "confidence": 1
  },
  {
   "time": 180.32661197577244,
   "beat": 1,
   "bar": 99,
   "confidence": 1
  },
  {
   "time": 180.78662884305757,
   "beat": 2,
   "bar": 99,
   "confidence": 1
  },
  {
   "time": 181.2466457103427,
   "beat": 3,
   "bar": 99,
   "confidence": 1
  },
  {
   "time": 181.70666257762784,
   "beat": 4,
   "bar": 99,
   "confidence": 1
  },
  {
   "time": 182.16667944491297,
   "beat": 1,
   "bar": 100,
   "confidence": 1
  },
  {
   "time": 182.6266963121981,
   "beat": 2,
   "bar": 100,
   "confidence": 1
  },
  {
   "time": 183.08671317948324,
   "beat": 3,
   "bar": 100,
   "confidence": 1
  },
  {
   "time": 183.54673004676837,
   "beat": 4,
   "bar": 100,
   "confidence": 1
  },
  {
   "time": 184.0067469140535,
   "beat": 1,
   "bar": 101,
   "confidence": 1
  },
  {
   "time": 184.46676378133864,
   "beat": 2,
   "bar": 101,
   "confidence": 1
  },
  {
   "time": 184.92678064862378,
   "beat": 3,
   "bar": 101,
   "confidence": 1
  },
  {
   "time": 185.3867975159089,
   "beat": 4,
   "bar": 101,
   "confidence": 1
  },
  {
   "time": 185.84681438319404,
   "beat": 1,
   "bar": 102,
   "confidence": 1
  },
  {
   "time": 186.30683125047918,
   "beat": 2,
   "bar": 102,
   "confidence": 1
  },
  {
   "time": 186.7668481177643,
   "beat": 3,
   "bar": 102,
   "confidence": 1
  },
  {
   "time": 187.22686498504945,
   "beat": 4,
   "bar": 102,
   "confidence": 1
  },
  {
   "time": 187.68688185233458,
   "beat": 1,
   "bar": 103,
   "confidence": 1
  },
  {
   "time": 188.1468987196197,
   "beat": 2,
   "bar": 103,
   "confidence": 1
  },
  {
   "time": 188.60691558690485,
   "beat": 3,
   "bar": 103,
   "confidence": 1
  },
  {
   "time": 189.06693245418998,
   "beat": 4,
   "bar": 103,
   "confidence": 1
  },
  {
   "time": 189.52694932147512,
   "beat": 1,
   "bar": 104,
   "confidence": 1
  },
  {
   "time": 189.98696618876025,
   "beat": 2,
   "bar": 104,
   "confidence": 1
  },
  {
   "time": 190.44698305604538,
   "beat": 3,
   "bar": 104,
   "confidence": 1
  },
  {
   "time": 190.90699992333052,
   "beat": 4,
   "bar": 104,
   "confidence": 1
  },
  {
   "time": 191.36701679061565,
   "beat": 1,
   "bar": 105,
   "confidence": 1
  },
  {
   "time": 191.82703365790078,
   "beat": 2,
   "bar": 105,
   "confidence": 1
  },
  {
   "time": 192.28705052518592,
   "beat": 3,
   "bar": 105,
   "confidence": 1
  },
  {
   "time": 192.74706739247105,
   "beat": 4,
   "bar": 105,
   "confidence": 1
  },
  {
   "time": 193.2070842597562,
   "beat": 1,
   "bar": 106,
   "confidence": 1
  },
  {
   "time": 193.66710112704132,
   "beat": 2,
   "bar": 106,
   "confidence": 1
  },
  {
   "time": 194.12711799432645,
   "beat": 3,
   "bar": 106,
   "confidence": 1
  },
  {
   "time": 194.5871348616116,
   "beat": 4,
   "bar": 106,
   "confidence": 1
  },
  {
   "time": 195.04715172889672,
   "beat": 1,
   "bar": 107,
   "confidence": 1
  },
  {
   "time": 195.50716859618186,
   "beat": 2,
   "bar": 107,
   "confidence": 1
  },
  {
   "time": 195.967185463467,
   "beat": 3,
   "bar": 107,
   "confidence": 1
  },
  {
   "time": 196.42720233075212,
   "beat": 4,
   "bar": 107,
   "confidence": 1
  },
  {
   "time": 196.88721919803726,
   "beat": 1,
   "bar": 108,
   "confidence": 1
  },
  {
   "time": 197.3472360653224,
   "beat": 2,
   "bar": 108,
   "confidence": 1
  },
  {
   "time": 197.80725293260753,
   "beat": 3,
   "bar": 108,
   "confidence": 1
  },
  {
   "time": 198.26726979989266,
   "beat": 4,
   "bar": 108,
   "confidence": 1
  },
  {
   "time": 198.7272866671778,
   "beat": 1,
   "bar": 109,
   "confidence": 1
  },
  {
   "time": 199.18730353446293,
   "beat": 2,
   "bar": 109,
   "confidence": 1
  },
  {
   "time": 199.64732040174806,
   "beat": 3,
   "bar": 109,
   "confidence": 1
  },
  {
   "time": 200.1073372690332,
   "beat": 4,
   "bar": 109,
   "confidence": 1
  },
  {
   "time": 200.56735413631833,
   "beat": 1,
   "bar": 110,
   "confidence": 1
  },
  {
   "time": 201.02737100360346,
   "beat": 2,
   "bar": 110,
   "confidence": 1
  },
  {
   "time": 201.4873878708886,
   "beat": 3,
   "bar": 110,
   "confidence": 1
  },
  {
   "time": 201.94740473817373,
   "beat": 4,
   "bar": 110,
   "confidence": 1
  },
  {
   "time": 202.40742160545886,
   "beat": 1,
   "bar": 111,
   "confidence": 1
  },
  {
   "time": 202.867438472744,
   "beat": 2,
   "bar": 111,
   "confidence": 1
  },
  {
   "time": 203.32745534002913,
   "beat": 3,
   "bar": 111,
   "confidence": 1
  },
  {
   "time": 203.78747220731427,
   "beat": 4,
   "bar": 111,
   "confidence": 1
  },
  {
   "time": 204.2474890745994,
   "beat": 1,
   "bar": 112,
   "confidence": 1
  },
  {
   "time": 204.70750594188453,
   "beat": 2,
   "bar": 112,
   "confidence": 1
  },
  {
   "time": 205.16752280916967,
   "beat": 3,
   "bar": 112,
   "confidence": 1
  },
  {
   "time": 205.6275396764548,
   "beat": 4,
   "bar": 112,
   "confidence": 1
  },
  {
   "time": 206.08755654373994,
   "beat": 1,
   "bar": 113,
   "confidence": 1
  },
  {
   "time": 206.54757341102507,
   "beat": 2,
   "bar": 113,
   "confidence": 1
  },
  {
   "time": 207.0075902783102,
   "beat": 3,
   "bar": 113,
   "confidence": 1
  },
  {
   "time": 207.46760714559534,
   "beat": 4,
   "bar": 113,
   "confidence": 1
  },
  {
   "time": 207.92762401288047,
   "beat": 1,
   "bar": 114,
   "confidence": 1
  },
  {
   "time": 208.3876408801656,
   "beat": 2,
   "bar": 114,
   "confidence": 1
  },
  {
   "time": 208.84765774745074,
   "beat": 3,
   "bar": 114,
   "confidence": 1
  },
  {
   "time": 209.30767461473587,
   "beat": 4,
   "bar": 114,
   "confidence": 1
  },
  {
   "time": 209.767691482021,
   "beat": 1,
   "bar": 115,
   "confidence": 1
  },
  {
   "time": 210.22770834930614,
   "beat": 2,
   "bar": 115,
   "confidence": 1
  },
  {
   "time": 210.68772521659128,
   "beat": 3,
   "bar": 115,
   "confidence": 1
  },
  {
   "time": 211.1477420838764,
   "beat": 4,
   "bar": 115,
   "confidence": 1
  },
  {
   "time": 211.60775895116154,
   "beat": 1,
   "bar": 116,
   "confidence": 1
  },
  {
   "time": 212.06777581844668,
   "beat": 2,
   "bar": 116,
   "confidence": 1
  },
  {
   "time": 212.5277926857318,
   "beat": 3,
   "bar": 116,
   "confidence": 1
  },
  {
   "time": 212.98780955301694,
   "beat": 4,
   "bar": 116,
   "confidence": 1
  },
  {
   "time": 213.44782642030208,
   "beat": 1,
   "bar": 117,
   "confidence": 1
  },
  {
   "time": 213.9078432875872,
   "beat": 2,
   "bar": 117,
   "confidence": 1
  },
  {
   "time": 214.36786015487235,
   "beat": 3,
   "bar": 117,
   "confidence": 1
  },
  {
   "time": 214.82787702215748,
   "beat": 4,
   "bar": 117,
   "confidence": 1
  },
  {
   "time": 215.2878938894426,
   "beat": 1,
   "bar": 118,
   "confidence": 1
  },
  {
   "time": 215.74791075672775,
   "beat": 2,
   "bar": 118,
   "confidence": 1
  },
  {
   "time": 216.20792762401288,
   "beat": 3,
   "bar": 118,
   "confidence": 1
  },
  {
   "time": 216.66794449129802,
   "beat": 4,
   "bar": 118,
   "confidence": 1
  },
  {
   "time": 217.12796135858315,
   "beat": 1,
   "bar": 119,
   "confidence": 1
  },
  {
   "time": 217.58797822586828,
   "beat": 2,
   "bar": 119,
   "confidence": 1
  },
  {
   "time": 218.04799509315342,
   "beat": 3,
   "bar": 119,
   "confidence": 1
  },
  {
   "time": 218.50801196043855,
   "beat": 4,
   "bar": 119,
   "confidence": 1
  },
  {
   "time": 218.96802882772369,
   "beat": 1,
   "bar": 120,
   "confidence": 1
  },
  {
   "time": 219.42804569500882,
   "beat": 2,
   "bar": 120,
   "confidence": 1
  },
  {
   "time": 219.88806256229395,
   "beat": 3,
   "bar": 120,
   "confidence": 1
  },
  {
   "time": 220.3480794295791,
   "beat": 4,
   "bar": 120,
   "confidence": 1
  },
  {
   "time": 220.80809629686422,
   "beat": 1,
   "bar": 121,
   "confidence": 1
  },
  {
   "time": 221.26811316414936,
   "beat": 2,
   "bar": 121,
   "confidence": 1
  },
  {
   "time": 221.7281300314345,
   "beat": 3,
   "bar": 121,
   "confidence": 1
  },
  {
   "time": 222.18814689871962,
   "beat": 4,
   "bar": 121,
   "confidence": 1
  },
  {
   "time": 222.64816376600476,
   "beat": 1,
   "bar": 122,
   "confidence": 1
  },
  {
   "time": 223.1081806332899,
   "beat": 2,
   "bar": 122,
   "confidence": 1
  },
  {
   "time": 223.56819750057502,
   "beat": 3,
   "bar": 122,
   "confidence": 1
  },
  {
   "time": 224.02821436786016,
   "beat": 4,
   "bar": 122,
   "confidence": 1
  },
  {
   "time": 224.4882312351453,
   "beat": 1,
   "bar": 123,
   "confidence": 1
  },
  {
   "time": 224.94824810243043,
   "beat": 2,
   "bar": 123,
   "confidence": 1
  },
  {
   "time": 225.40826496971556,
   "beat": 3,
   "bar": 123,
   "confidence": 1
  },
  {
   "time": 225.8682818370007,
   "beat": 4,
   "bar": 123,
   "confidence": 1
  },
  {
   "time": 226.32829870428583,
   "beat": 1,
   "bar": 124,
   "confidence": 1
  },
  {
   "time": 226.78831557157096,
   "beat": 2,
   "bar": 124,
   "confidence": 1
  },
  {
   "time": 227.2483324388561,
   "beat": 3,
   "bar": 124,
   "confidence": 1
  },
  {
   "time": 227.70834930614123,
   "beat": 4,
   "bar": 124,
   "confidence": 1
  },
  {
   "time": 228.16836617342636,
   "beat": 1,
   "bar": 125,
   "confidence": 1
  },
  {
   "time": 228.6283830407115,
   "beat": 2,
   "bar": 125,
   "confidence": 1
  },
  {
   "time": 229.08839990799663,
   "beat": 3,
   "bar": 125,
   "confidence": 1
  },
  {
   "time": 229.54841677528177,
   "beat": 4,
   "bar": 125,
   "confidence": 1
  },
  {
   "time": 230.0084336425669,
   "beat": 1,
   "bar": 126,
   "confidence": 1
  },
  {
   "time": 230.46845050985203,
   "beat": 2,
   "bar": 126,
   "confidence": 1
  },
  {
   "time": 230.92846737713717,
   "beat": 3,
   "bar": 126,
   "confidence": 1
  },
  {
   "time": 231.3884842444223,
   "beat": 4,
   "bar": 126,
   "confidence": 1
  },
  {
   "time": 231.84850111170744,
   "beat": 1,
   "bar": 127,
   "confidence": 1
  },
  {
   "time": 232.30851797899257,
   "beat": 2,
   "bar": 127,
   "confidence": 1
  },
  {
   "time": 232.7685348462777,
   "beat": 3,
   "bar": 127,
   "confidence": 1
  },
  {
   "time": 233.22855171356284,
   "beat": 4,
   "bar": 127,
   "confidence": 1
  },
  {
   "time": 233.68856858084797,
   "beat": 1,
   "bar": 128,
   "confidence": 1
  },
  {
   "time": 234.1485854481331,
   "beat": 2,
   "bar": 128,
   "confidence": 1
  },
  {
   "time": 234.60860231541824,
   "beat": 3,
   "bar": 128,
   "confidence": 1
  },
  {
   "time": 235.06861918270337,
   "beat": 4,
   "bar": 128,
   "confidence": 1
  },
  {
   "time": 235.5286360499885,
   "beat": 1,
   "bar": 129,
   "confidence": 1
  },
  {
   "time": 235.98865291727364,
   "beat": 2,
   "bar": 129,
   "confidence": 1
  },
  {
   "time": 236.44866978455877,
   "beat": 3,
   "bar": 129,
   "confidence": 1
  },
  {
   "time": 236.9086866518439,
   "beat": 4,
   "bar": 129,
   "confidence": 1
  },
  {
   "time": 237.36870351912904,
   "beat": 1,
   "bar": 130,
   "confidence": 1
  },
  {
   "time": 237.82872038641418,
   "beat": 2,
   "bar": 130,
   "confidence": 1
  },
  {
   "time": 238.2887372536993,
   "beat": 3,
   "bar": 130,
   "confidence": 1
  },
  {
   "time": 238.74875412098444,
   "beat": 4,
   "bar": 130,
   "confidence": 1
  },
  {
   "time": 239.20877098826958,
   "beat": 1,
   "bar": 131,
   "confidence": 1
  },
  {
   "time": 239.6687878555547,
   "beat": 2,
   "bar": 131,
   "confidence": 1
  },
  {
   "time": 240.12880472283985,
   "beat": 3,
   "bar": 131,
   "confidence": 1
  },
  {
   "time": 240.58882159012498,
   "beat": 4,
   "bar": 131,
   "confidence": 1
  },
  {
   "time": 241.0488384574101,
   "beat": 1,
   "bar": 132,
   "confidence": 1
  },
  {
   "time": 241.50885532469525,
   "beat": 2,
   "bar": 132,
   "confidence": 1
  },
  {
   "time": 241.96887219198038,
   "beat": 3,
   "bar": 132,
   "confidence": 1
  },
  {
   "time": 242.4288890592655,
   "beat": 4,
   "bar": 132,
   "confidence": 1
  },
  {
   "time": 242.88890592655062,
   "beat": 1,
   "bar": 133,
   "confidence": 1
  },
  {
   "time": 243.34892279383575,
   "beat": 2,
   "bar": 133,
   "confidence": 1
  },
  {
   "time": 243.8089396611209,
   "beat": 3,
   "bar": 133,
   "confidence": 1
  },
  {
   "time": 244.26895652840602,
   "beat": 4,
   "bar": 133,
   "confidence": 1
  },
  {
   "time": 244.72897339569116,
   "beat": 1,
   "bar": 134,
   "confidence": 1
  },
  {
   "time": 245.1889902629763,
   "beat": 2,
   "bar": 134,
   "confidence": 1
  },
  {
   "time": 245.64900713026142,
   "beat": 3,
   "bar": 134,
   "confidence": 1
  },
  {
   "time": 246.10902399754656,
   "beat": 4,
   "bar": 134,
   "confidence": 1
  },
  {
   "time": 246.5690408648317,
   "beat": 1,
   "bar": 135,
   "confidence": 1
  },
  {
   "time": 247.02905773211683,
   "beat": 2,
   "bar": 135,
   "confidence": 1
  },
  {
   "time": 247.48907459940196,
   "beat": 3,
   "bar": 135,
   "confidence": 1
  },
  {
   "time": 247.9490914666871,
   "beat": 4,
   "bar": 135,
   "confidence": 1
  },
  {
   "time": 248.40910833397223,
   "beat": 1,
   "bar": 136,
   "confidence": 1
  },
  {
   "time": 248.86912520125736,
   "beat": 2,
   "bar": 136,
   "confidence": 1
  },
  {
   "time": 249.3291420685425,
   "beat": 3,
   "bar": 136,
   "confidence": 1
  },
  {
   "time": 249.78915893582763,
   "beat": 4,
   "bar": 136,
   "confidence": 1
  },
  {
   "time": 250.24917580311276,
   "beat": 1,
   "bar": 137,
   "confidence": 1
  },
  {
   "time": 250.7091926703979,
   "beat": 2,
   "bar": 137,
   "confidence": 1
  },
  {
   "time": 251.16920953768303,
   "beat": 3,
   "bar": 137,
   "confidence": 1
  },
  {
   "time": 251.62922640496816,
   "beat": 4,
   "bar": 137,
   "confidence": 1
  },
  {
   "time": 252.0892432722533,
   "beat": 1,
   "bar": 138,
   "confidence": 1
  },
  {
   "time": 252.54926013953843,
   "beat": 2,
   "bar": 138,
   "confidence": 1
  },
  {
   "time": 253.00927700682357,
   "beat": 3,
   "bar": 138,
   "confidence": 1
  },
  {
   "time": 253.4692938741087,
   "beat": 4,
   "bar": 138,
   "confidence": 1
  },
  {
   "time": 253.92931074139383,
   "beat": 1,
   "bar": 139,
   "confidence": 1
  },
  {
   "time": 254.38932760867897,
   "beat": 2,
   "bar": 139,
   "confidence": 1
  },
  {
   "time": 254.8493444759641,
   "beat": 3,
   "bar": 139,
   "confidence": 1
  },
  {
   "time": 255.30936134324924,
   "beat": 4,
   "bar": 139,
   "confidence": 1
  },
  {
   "time": 255.76937821053437,
   "beat": 1,
   "bar": 140,
   "confidence": 1
  },
  {
   "time": 256.2293950778195,
   "beat": 2,
   "bar": 140,
   "confidence": 1
  },
  {
   "time": 256.68941194510467,
   "beat": 3,
   "bar": 140,
   "confidence": 1
  },
  {
   "time": 257.1494288123898,
   "beat": 4,
   "bar": 140,
   "confidence": 1
  },
  {
   "time": 257.60944567967493,
   "beat": 1,
   "bar": 141,
   "confidence": 1
  }
 ],
 "bars": [
  {
   "bar": 1,
   "start": 0,
   "end": 1.8400674691405352,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 2,
   "start": 1.8400674691405352,
   "end": 3.6801349382810704,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 3,
   "start": 3.6801349382810704,
   "end": 5.520202407421605,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 4,
   "start": 5.520202407421605,
   "end": 7.360269876562141,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 5,
   "start": 7.360269876562141,
   "end": 9.200337345702675,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 6,
   "start": 9.200337345702675,
   "end": 11.04040481484321,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 7,
   "start": 11.04040481484321,
   "end": 12.880472283983746,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 8,
   "start": 12.880472283983746,
   "end": 14.720539753124282,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 9,
   "start": 14.720539753124282,
   "end": 16.560607222264817,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 10,
   "start": 16.560607222264817,
   "end": 18.40067469140535,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 11,
   "start": 18.40067469140535,
   "end": 20.240742160545885,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 12,
   "start": 20.240742160545885,
   "end": 22.08080962968642,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 13,
   "start": 22.08080962968642,
   "end": 23.920877098826956,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 14,
   "start": 23.920877098826956,
   "end": 25.760944567967492,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 15,
   "start": 25.760944567967492,
   "end": 27.601012037108028,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 16,
   "start": 27.601012037108028,
   "end": 29.441079506248563,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 17,
   "start": 29.441079506248563,
   "end": 31.281146975389095,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 18,
   "start": 31.281146975389095,
   "end": 33.121214444529635,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 19,
   "start": 33.121214444529635,
   "end": 34.96128191367017,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 20,
   "start": 34.96128191367017,
   "end": 36.8013493828107,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 21,
   "start": 36.8013493828107,
   "end": 38.641416851951234,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 22,
   "start": 38.641416851951234,
   "end": 40.48148432109177,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 23,
   "start": 40.48148432109177,
   "end": 42.321551790232306,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 24,
   "start": 42.321551790232306,
   "end": 44.16161925937284,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 25,
   "start": 44.16161925937284,
   "end": 46.00168672851338,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 26,
   "start": 46.00168672851338,
   "end": 47.84175419765391,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 27,
   "start": 47.84175419765391,
   "end": 49.68182166679445,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 28,
   "start": 49.68182166679445,
   "end": 51.521889135934984,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 29,
   "start": 51.521889135934984,
   "end": 53.36195660507552,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 30,
   "start": 53.36195660507552,
   "end": 55.202024074216055,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 31,
   "start": 55.202024074216055,
   "end": 57.04209154335659,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 32,
   "start": 57.04209154335659,
   "end": 58.88215901249713,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 33,
   "start": 58.88215901249713,
   "end": 60.722226481637655,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 34,
   "start": 60.722226481637655,
   "end": 62.56229395077819,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 35,
   "start": 62.56229395077819,
   "end": 64.40236141991873,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 36,
   "start": 64.40236141991873,
   "end": 66.24242888905927,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 37,
   "start": 66.24242888905927,
   "end": 68.0824963581998,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 38,
   "start": 68.0824963581998,
   "end": 69.92256382734034,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 39,
   "start": 69.92256382734034,
   "end": 71.76263129648088,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 40,
   "start": 71.76263129648088,
   "end": 73.6026987656214,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 41,
   "start": 73.6026987656214,
   "end": 75.44276623476193,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 42,
   "start": 75.44276623476193,
   "end": 77.28283370390247,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 43,
   "start": 77.28283370390247,
   "end": 79.122901173043,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 44,
   "start": 79.122901173043,
   "end": 80.96296864218354,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 45,
   "start": 80.96296864218354,
   "end": 82.80303611132408,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 46,
   "start": 82.80303611132408,
   "end": 84.64310358046461,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 47,
   "start": 84.64310358046461,
   "end": 86.48317104960515,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 48,
   "start": 86.48317104960515,
   "end": 88.32323851874568,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 49,
   "start": 88.32323851874568,
   "end": 90.16330598788622,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 50,
   "start": 90.16330598788622,
   "end": 92.00337345702675,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 51,
   "start": 92.00337345702675,
   "end": 93.84344092616729,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 52,
   "start": 93.84344092616729,
   "end": 95.68350839530783,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 53,
   "start": 95.68350839530783,
   "end": 97.52357586444836,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 54,
   "start": 97.52357586444836,
   "end": 99.3636433335889,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 55,
   "start": 99.3636433335889,
   "end": 101.20371080272943,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 56,
   "start": 101.20371080272943,
   "end": 103.04377827186997,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 57,
   "start": 103.04377827186997,
   "end": 104.8838457410105,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 58,
   "start": 104.8838457410105,
   "end": 106.72391321015104,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 59,
   "start": 106.72391321015104,
   "end": 108.56398067929157,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 60,
   "start": 108.56398067929157,
   "end": 110.40404814843211,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 61,
   "start": 110.40404814843211,
   "end": 112.24411561757265,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 62,
   "start": 112.24411561757265,
   "end": 114.08418308671318,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 63,
   "start": 114.08418308671318,
   "end": 115.92425055585372,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 64,
   "start": 115.92425055585372,
   "end": 117.76431802499425,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 65,
   "start": 117.76431802499425,
   "end": 119.60438549413479,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 66,
   "start": 119.60438549413479,
   "end": 121.44445296327531,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 67,
   "start": 121.44445296327531,
   "end": 123.28452043241585,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 68,
   "start": 123.28452043241585,
   "end": 125.12458790155638,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 69,
   "start": 125.12458790155638,
   "end": 126.96465537069692,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 70,
   "start": 126.96465537069692,
   "end": 128.80472283983747,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 71,
   "start": 128.80472283983747,
   "end": 130.644790308978,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 72,
   "start": 130.644790308978,
   "end": 132.48485777811854,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 73,
   "start": 132.48485777811854,
   "end": 134.32492524725907,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 74,
   "start": 134.32492524725907,
   "end": 136.1649927163996,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 75,
   "start": 136.1649927163996,
   "end": 138.00506018554015,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 76,
   "start": 138.00506018554015,
   "end": 139.84512765468068,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 77,
   "start": 139.84512765468068,
   "end": 141.68519512382122,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 78,
   "start": 141.68519512382122,
   "end": 143.52526259296175,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 79,
   "start": 143.52526259296175,
   "end": 145.3653300621023,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 80,
   "start": 145.3653300621023,
   "end": 147.2053975312428,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 81,
   "start": 147.2053975312428,
   "end": 149.04546500038333,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 82,
   "start": 149.04546500038333,
   "end": 150.88553246952387,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 83,
   "start": 150.88553246952387,
   "end": 152.7255999386644,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 84,
   "start": 152.7255999386644,
   "end": 154.56566740780494,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 85,
   "start": 154.56566740780494,
   "end": 156.40573487694547,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 86,
   "start": 156.40573487694547,
   "end": 158.245802346086,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 87,
   "start": 158.245802346086,
   "end": 160.08586981522654,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 88,
   "start": 160.08586981522654,
   "end": 161.92593728436708,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 89,
   "start": 161.92593728436708,
   "end": 163.76600475350762,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 90,
   "start": 163.76600475350762,
   "end": 165.60607222264815,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 91,
   "start": 165.60607222264815,
   "end": 167.4461396917887,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 92,
   "start": 167.4461396917887,
   "end": 169.28620716092922,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 93,
   "start": 169.28620716092922,
   "end": 171.12627463006976,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 94,
   "start": 171.12627463006976,
   "end": 172.9663420992103,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 95,
   "start": 172.9663420992103,
   "end": 174.80640956835083,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 96,
   "start": 174.80640956835083,
   "end": 176.64647703749137,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 97,
   "start": 176.64647703749137,
   "end": 178.4865445066319,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 98,
   "start": 178.4865445066319,
   "end": 180.32661197577244,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 99,
   "start": 180.32661197577244,
   "end": 182.16667944491297,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 100,
   "start": 182.16667944491297,
   "end": 184.0067469140535,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 101,
   "start": 184.0067469140535,
   "end": 185.84681438319404,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 102,
   "start": 185.84681438319404,
   "end": 187.68688185233458,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 103,
   "start": 187.68688185233458,
   "end": 189.52694932147512,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 104,
   "start": 189.52694932147512,
   "end": 191.36701679061565,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 105,
   "start": 191.36701679061565,
   "end": 193.2070842597562,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 106,
   "start": 193.2070842597562,
   "end": 195.04715172889672,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 107,
   "start": 195.04715172889672,
   "end": 196.88721919803726,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 108,
   "start": 196.88721919803726,
   "end": 198.7272866671778,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 109,
   "start": 198.7272866671778,
   "end": 200.56735413631833,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 110,
   "start": 200.56735413631833,
   "end": 202.40742160545886,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 111,
   "start": 202.40742160545886,
   "end": 204.2474890745994,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 112,
   "start": 204.2474890745994,
   "end": 206.08755654373994,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 113,
   "start": 206.08755654373994,
   "end": 207.92762401288047,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 114,
   "start": 207.92762401288047,
   "end": 209.767691482021,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 115,
   "start": 209.767691482021,
   "end": 211.60775895116154,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 116,
   "start": 211.60775895116154,
   "end": 213.44782642030208,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 117,
   "start": 213.44782642030208,
   "end": 215.2878938894426,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 118,
   "start": 215.2878938894426,
   "end": 217.12796135858315,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 119,
   "start": 217.12796135858315,
   "end": 218.96802882772369,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 120,
   "start": 218.96802882772369,
   "end": 220.80809629686422,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 121,
   "start": 220.80809629686422,
   "end": 222.64816376600476,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 122,
   "start": 222.64816376600476,
   "end": 224.4882312351453,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 123,
   "start": 224.4882312351453,
   "end": 226.32829870428583,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 124,
   "start": 226.32829870428583,
   "end": 228.16836617342636,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 125,
   "start": 228.16836617342636,
   "end": 230.0084336425669,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 126,
   "start": 230.0084336425669,
   "end": 231.84850111170744,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 127,
   "start": 231.84850111170744,
   "end": 233.68856858084797,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 128,
   "start": 233.68856858084797,
   "end": 235.5286360499885,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 129,
   "start": 235.5286360499885,
   "end": 237.36870351912904,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 130,
   "start": 237.36870351912904,
   "end": 239.20877098826958,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 131,
   "start": 239.20877098826958,
   "end": 241.0488384574101,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 132,
   "start": 241.0488384574101,
   "end": 242.88890592655062,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 133,
   "start": 242.88890592655062,
   "end": 244.72897339569116,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 134,
   "start": 244.72897339569116,
   "end": 246.5690408648317,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 135,
   "start": 246.5690408648317,
   "end": 248.40910833397223,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 136,
   "start": 248.40910833397223,
   "end": 250.24917580311276,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 137,
   "start": 250.24917580311276,
   "end": 252.0892432722533,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 138,
   "start": 252.0892432722533,
   "end": 253.92931074139383,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 139,
   "start": 253.92931074139383,
   "end": 255.76937821053437,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 140,
   "start": 255.76937821053437,
   "end": 257.60944567967493,
   "beats": 4,
   "confidence": 1
  },
  {
   "bar": 141,
   "start": 257.60944567967493,
   "end": 257.9405619872729,
   "beats": 4,
   "confidence": 1
  }
 ],
 "melody": [],
 "bass": [],
 "chords": [
  {
   "start": 3.796,
   "end": 10.37,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 10.37,
   "end": 11.111,
   "symbol": "Ab",
   "roman": "bVI",
   "confidence": 1,
   "root": "Ab",
   "quality": "maj",
   "inversion": 0,
   "bass": "Ab"
  },
  {
   "start": 11.111,
   "end": 14.63,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 14.63,
   "end": 16.574,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 16.574,
   "end": 18.5185,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 18.518,
   "end": 20,
   "symbol": "Bb",
   "roman": "bVII",
   "confidence": 1,
   "root": "Bb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Bb"
  },
  {
   "start": 20,
   "end": 23.982,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 23.982,
   "end": 24.907,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 24.907,
   "end": 27.778,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 27.778,
   "end": 30,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 30,
   "end": 35,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 35,
   "end": 36.944,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 36.944,
   "end": 39.722,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 39.722,
   "end": 40.741,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 40.741,
   "end": 47.5,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 47.5,
   "end": 47.963,
   "symbol": "F",
   "roman": "IV",
   "confidence": 1,
   "root": "F",
   "quality": "maj",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 47.963,
   "end": 51.481,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 51.481,
   "end": 52.685,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 52.685,
   "end": 55.3704,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 55.37,
   "end": 56.852,
   "symbol": "Dm",
   "roman": "ii",
   "confidence": 1,
   "root": "D",
   "quality": "min",
   "inversion": 0,
   "bass": "D"
  },
  {
   "start": 56.852,
   "end": 57.593,
   "symbol": "Bb",
   "roman": "bVII",
   "confidence": 1,
   "root": "Bb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Bb"
  },
  {
   "start": 57.593,
   "end": 60.278,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 60.278,
   "end": 61.852,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 61.852,
   "end": 63.796,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 63.796,
   "end": 64.63,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 64.63,
   "end": 65.278,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 65.278,
   "end": 66.4815,
   "symbol": "D",
   "roman": "II",
   "confidence": 1,
   "root": "D",
   "quality": "maj",
   "inversion": 0,
   "bass": "D"
  },
  {
   "start": 66.481,
   "end": 71.481,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 71.481,
   "end": 72.87,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 72.87,
   "end": 73.796,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 73.796,
   "end": 79.352,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 79.352,
   "end": 81.852,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 81.852,
   "end": 82.87,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 82.87,
   "end": 86.667,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 86.667,
   "end": 88.611,
   "symbol": "Eb",
   "roman": "bIII",
   "confidence": 1,
   "root": "Eb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Eb"
  },
  {
   "start": 88.611,
   "end": 100,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 100,
   "end": 101.111,
   "symbol": "D",
   "roman": "II",
   "confidence": 1,
   "root": "D",
   "quality": "maj",
   "inversion": 0,
   "bass": "D"
  },
  {
   "start": 101.111,
   "end": 101.574,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 101.574,
   "end": 103.333,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 103.333,
   "end": 106.852,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 106.852,
   "end": 116.204,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 116.204,
   "end": 118.241,
   "symbol": "Eb",
   "roman": "bIII",
   "confidence": 1,
   "root": "Eb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Eb"
  },
  {
   "start": 118.241,
   "end": 125.556,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 125.556,
   "end": 129.444,
   "symbol": "C#",
   "roman": "bII",
   "confidence": 1,
   "root": "C#",
   "quality": "maj",
   "inversion": 0,
   "bass": "C#"
  },
  {
   "start": 129.444,
   "end": 130,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 130,
   "end": 130.463,
   "symbol": "Eb",
   "roman": "bIII",
   "confidence": 1,
   "root": "Eb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Eb"
  },
  {
   "start": 130.463,
   "end": 131.018,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 131.018,
   "end": 132.87,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 132.87,
   "end": 141.2963,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 141.296,
   "end": 142.13,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 142.13,
   "end": 147.685,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 147.685,
   "end": 149.444,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 149.444,
   "end": 161.296,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 161.296,
   "end": 162.315,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 162.315,
   "end": 169.259,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 169.259,
   "end": 170,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 170,
   "end": 170.741,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 170.741,
   "end": 171.667,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 171.667,
   "end": 178.148,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 178.148,
   "end": 179.074,
   "symbol": "Bb",
   "roman": "bVII",
   "confidence": 1,
   "root": "Bb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Bb"
  },
  {
   "start": 179.074,
   "end": 179.537,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 179.537,
   "end": 183.704,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 183.704,
   "end": 186.389,
   "symbol": "Eb",
   "roman": "bIII",
   "confidence": 1,
   "root": "Eb",
   "quality": "maj",
   "inversion": 0,
   "bass": "Eb"
  },
  {
   "start": 186.389,
   "end": 187.315,
   "symbol": "G",
   "roman": "V",
   "confidence": 1,
   "root": "G",
   "quality": "maj",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 187.315,
   "end": 190.185,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 190.185,
   "end": 192.5,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 192.5,
   "end": 193.7037,
   "symbol": "D",
   "roman": "II",
   "confidence": 1,
   "root": "D",
   "quality": "maj",
   "inversion": 0,
   "bass": "D"
  },
  {
   "start": 193.704,
   "end": 195.648,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 195.648,
   "end": 197.5,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 197.5,
   "end": 198.7037,
   "symbol": "Bbm",
   "roman": "bvii",
   "confidence": 1,
   "root": "Bb",
   "quality": "min",
   "inversion": 0,
   "bass": "Bb"
  },
  {
   "start": 198.704,
   "end": 203.056,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 203.056,
   "end": 206.759,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 206.759,
   "end": 207.778,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 207.778,
   "end": 210.463,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 210.463,
   "end": 214.63,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 214.63,
   "end": 215.926,
   "symbol": "Bbm",
   "roman": "bvii",
   "confidence": 1,
   "root": "Bb",
   "quality": "min",
   "inversion": 0,
   "bass": "Bb"
  },
  {
   "start": 215.926,
   "end": 217.778,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 217.778,
   "end": 219.63,
   "symbol": "Ab",
   "roman": "bVI",
   "confidence": 1,
   "root": "Ab",
   "quality": "maj",
   "inversion": 0,
   "bass": "Ab"
  },
  {
   "start": 219.63,
   "end": 221.574,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 221.574,
   "end": 223.333,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 223.333,
   "end": 225.2778,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 225.278,
   "end": 226.389,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 226.389,
   "end": 232.5,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 232.5,
   "end": 236.296,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 236.296,
   "end": 238.056,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 238.056,
   "end": 240,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 240,
   "end": 243.704,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 243.704,
   "end": 245.556,
   "symbol": "C",
   "roman": "I",
   "confidence": 1,
   "root": "C",
   "quality": "maj",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 245.556,
   "end": 247.407,
   "symbol": "Fm",
   "roman": "iv",
   "confidence": 1,
   "root": "F",
   "quality": "min",
   "inversion": 0,
   "bass": "F"
  },
  {
   "start": 247.407,
   "end": 249.167,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  },
  {
   "start": 249.167,
   "end": 251.111,
   "symbol": "Gm",
   "roman": "v",
   "confidence": 1,
   "root": "G",
   "quality": "min",
   "inversion": 0,
   "bass": "G"
  },
  {
   "start": 251.111,
   "end": 257.13,
   "symbol": "Cm",
   "roman": "i",
   "confidence": 1,
   "root": "C",
   "quality": "min",
   "inversion": 0,
   "bass": "C"
  }
 ],
 "sections": [
  {
   "name": "Intro",
   "startBar": 1,
   "endBar": 2,
   "energy": 0.09
  },
  {
   "name": "Verse 1",
   "startBar": 3,
   "endBar": 24,
   "energy": 0.299
  },
  {
   "name": "Verse 2",
   "startBar": 25,
   "endBar": 40,
   "energy": 0.677
  },
  {
   "name": "Chorus",
   "startBar": 41,
   "endBar": 56,
   "energy": 0.481
  },
  {
   "name": "Chorus 2",
   "startBar": 57,
   "endBar": 72,
   "energy": 0.159
  },
  {
   "name": "Verse 3",
   "startBar": 73,
   "endBar": 96,
   "energy": 0.504
  },
  {
   "name": "Bridge",
   "startBar": 97,
   "endBar": 112,
   "energy": 0.221
  },
  {
   "name": "Chorus 3",
   "startBar": 113,
   "endBar": 128,
   "energy": 0.18791472868217057
  },
  {
   "name": "Outro",
   "startBar": 129,
   "endBar": 141,
   "energy": 0.18791472868217057
  }
 ],
 "energy": [
  0,
  0.033,
  0.046,
  0.067,
  0.049,
  0.075,
  0.055,
  0.082,
  0.075,
  0.12,
  0.135,
  0.126,
  0.181,
  0.322,
  0.551,
  0.073,
  0.103,
  0.102,
  0.076,
  0.351,
  0.542,
  0.101,
  0.115,
  0.085,
  0.117,
  0.083,
  0.089,
  0.091,
  0.084,
  0.109,
  0.406,
  0.124,
  0.088,
  0.101,
  0.08,
  0.103,
  1,
  0.081,
  0.104,
  0.121,
  0.095,
  0.055,
  0.663,
  0.437,
  0.1,
  0.057,
  0.353,
  0.23,
  0.117,
  0.115,
  0.403,
  0.407,
  0.069,
  0.822,
  0.716,
  0.448,
  0.418,
  0.165,
  0.138,
  0.087,
  0.261,
  0.88,
  0.282,
  0.089,
  0.384,
  0.632,
  0.368,
  0.142,
  0.087,
  0.06,
  0.098,
  0.091,
  0.123,
  0.103,
  0.067,
  0.102,
  0.083,
  0.113,
  0.05,
  0.085,
  0.097,
  0.095,
  0.059,
  0.065,
  0.083,
  0.448,
  0.097,
  0.084,
  0.102,
  0.119,
  0.102,
  0.078,
  0.068,
  0.313,
  0.082,
  0.087,
  0.103,
  0.104,
  0.066,
  0.683,
  0.817,
  0.265,
  0.058,
  0.078,
  0.082,
  0.121,
  0.06,
  0.094,
  0.2,
  0.378,
  0.522,
  0.135,
  0.138,
  0.095,
  0.066,
  0.112,
  0.101,
  0.05,
  0.071,
  0.112,
  0.117,
  0.093,
  0.099,
  0.099,
  0.66,
  0.322,
  0.07,
  0.039,
  0.011
 ],
 "dynamics": [
  0,
  0.033,
  0.046,
  0.067,
  0.049,
  0.075,
  0.055,
  0.082,
  0.075,
  0.12,
  0.135,
  0.126,
  0.181,
  0.322,
  0.551,
  0.073,
  0.103,
  0.102,
  0.076,
  0.351,
  0.542,
  0.101,
  0.115,
  0.085,
  0.117,
  0.083,
  0.089,
  0.091,
  0.084,
  0.109,
  0.406,
  0.124,
  0.088,
  0.101,
  0.08,
  0.103,
  1,
  0.081,
  0.104,
  0.121,
  0.095,
  0.055,
  0.663,
  0.437,
  0.1,
  0.057,
  0.353,
  0.23,
  0.117,
  0.115,
  0.403,
  0.407,
  0.069,
  0.822,
  0.716,
  0.448,
  0.418,
  0.165,
  0.138,
  0.087,
  0.261,
  0.88,
  0.282,
  0.089,
  0.384,
  0.632,
  0.368,
  0.142,
  0.087,
  0.06,
  0.098,
  0.091,
  0.123,
  0.103,
  0.067,
  0.102,
  0.083,
  0.113,
  0.05,
  0.085,
  0.097,
  0.095,
  0.059,
  0.065,
  0.083,
  0.448,
  0.097,
  0.084,
  0.102,
  0.119,
  0.102,
  0.078,
  0.068,
  0.313,
  0.082,
  0.087,
  0.103,
  0.104,
  0.066,
  0.683,
  0.817,
  0.265,
  0.058,
  0.078,
  0.082,
  0.121,
  0.06,
  0.094,
  0.2,
  0.378,
  0.522,
  0.135,
  0.138,
  0.095,
  0.066,
  0.112,
  0.101,
  0.05,
  0.071,
  0.112,
  0.117,
  0.093,
  0.099,
  0.099,
  0.66,
  0.322,
  0.07,
  0.039,
  0.011
 ],
 "waveform": [],
 "stems": [
  {
   "name": "MIX",
   "role": "MIX",
   "source": "proxy",
   "channels": 1,
   "confidence": 1
  }
 ],
 "sourceStems": [
  {
   "role": "MIX",
   "objectPath": "proxy",
   "provider": "FFMPEG",
   "confidence": 1
  }
 ],
 "vocalEvidence": {
  "status": "not_available",
  "reason": "No verified vocal or voice stem bytes are available; full-mix and inferred evidence are forbidden.",
  "provenance": null,
  "sampleRate": null,
  "channels": null,
  "frameSizeSamples": null,
  "thresholds": null,
  "observedVoicedWindows": [],
  "observedSilentWindows": []
 },
 "vocalIntelligence": {
  "version": "1.0",
  "provenance": null,
  "phrases": {
   "status": "not_available",
   "reason": "No verified vocal or voice stem bytes are available; full-mix and inferred evidence are forbidden.",
   "events": []
  },
  "breaths": {
   "status": "not_available",
   "reason": "No verified vocal or voice stem bytes are available; full-mix and inferred evidence are forbidden.",
   "events": []
  },
  "lyricAlignment": {
   "status": "not_available",
   "reason": "No accepted vocal phrases and timed lyrics are both available.",
   "alignments": []
  },
  "melodyAlignment": {
   "status": "not_available",
   "reason": "No accepted vocal phrases and compatible melody notes are both available.",
   "alignments": []
  },
  "arrangementSpace": {
   "status": "not_available",
   "reason": "No verified vocal or voice stem bytes are available; full-mix and inferred evidence are forbidden.",
   "windows": []
  }
 },
 "lyrics": [],
 "confidenceByField": {
  "key": 1,
  "bass": 0,
  "meter": 1,
  "tempo": 1,
  "energy": 0.82,
  "melody": 0.47954412228649573,
  "harmony": 1,
  "structure": 1,
  "separation": 0
 },
 "providerProvenance": [],
 "validation": {
  "status": "accepted",
  "issues": []
 },
 "fusion": {
  "selectedProvider": "BASIC_PITCH",
  "confidence": 0.8999,
  "decisions": [
   {
    "provider": "BASIC_PITCH",
    "status": "selected",
    "confidence": 0.5059,
    "compatibility": 1,
    "issues": [
     {
      "code": "CONTESTED_KEY",
      "severity": "warning",
      "path": "keyMap",
      "message": "Key is contested between 2 independent analyses; confirm one before arranging.",
      "provider": "BASIC_PITCH"
     }
    ]
   }
  ]
 },
 "reconciliation": {
  "version": "1.0",
  "domains": {
   "key": {
    "domain": "key",
    "value": null,
    "confidence": null,
    "providers": [],
    "status": "contested",
    "message": "Independent analyses disagree: C major (LOCAL_SIGNAL_ANALYZER_V1) vs C minor (TRANSCRIPTION_KEY_V1) — parallel. Confirm one before it is used.",
    "margin": 0.019,
    "candidates": [
     {
      "value": "C major",
      "score": 0.369,
      "providers": [
       "LOCAL_SIGNAL_ANALYZER_V1"
      ]
     },
     {
      "value": "C minor",
      "score": 0.35,
      "providers": [
       "TRANSCRIPTION_KEY_V1"
      ],
      "relationToLeader": "parallel"
     }
    ],
    "relation": "parallel",
    "whatWouldSettleIt": "The third degree: whether the third above the tonic is major or minor in the melody and the chords."
   },
   "tempo": {
    "domain": "tempo",
    "value": 64.8,
    "confidence": 0.374,
    "providers": [
     "LOCAL_SIGNAL_ANALYZER_V1"
    ],
    "status": "low_confidence",
    "message": "Only one independent provider supports this value; review before arranging.",
    "margin": 0.374,
    "candidates": [],
    "relation": null,
    "whatWouldSettleIt": "A second independent tempo reading (a beat tracker) agreeing within tolerance, or the producer confirming the value."
   },
   "sections": {
    "domain": "sections",
    "value": null,
    "confidence": null,
    "providers": [],
    "status": "not_available",
    "message": "Provider evidence disagreed without a sufficient reconciliation margin.",
    "margin": 0.14,
    "candidates": [],
    "relation": null,
    "whatWouldSettleIt": "No structure evidence: a structure provider, or the producer marking the boundaries."
   }
  },
  "consensusScore": 0,
  "contestedDomains": [
   "tempo",
   "key",
   "sections"
  ],
  "verdicts": {
   "key": "contested",
   "tempo": "low_confidence",
   "sections": "unknown"
  },
  "engine": {
   "version": "disagreement-engine-1.0",
   "thresholds": {
    "contestFloor": 0.15,
    "contestRatio": 0.4,
    "corroborationMargin": 0.12,
    "singleObservationFloor": 0.32
   }
  }
 }
} as const;

/** The owner's Song Model with a freshly derived musical map (deterministic). */
export function rachemNaSongModel(): SongModelData {
  const model = JSON.parse(JSON.stringify(RAW)) as SongModelData;
  model.musicalMap = deriveMusicalMap(model, { now: RACHEM_NA_FIXED_NOW });
  return model;
}
