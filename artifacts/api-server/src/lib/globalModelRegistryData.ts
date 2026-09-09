/**
 * The audited entries (Wave Q — Model Discovery, first pass, 2026-09-09).
 *
 * Every row records what was actually read and where. Where a field was not
 * verified from a primary source it says `secondary` or `unknown`, and
 * `classify()` refuses to ship on it. That is the point: the gaps are the
 * useful part of this file.
 *
 * `liveInferenceProven` is false on every external entry here. Nothing in this
 * pass has been run. A row flips to true only when a real musical input has
 * gone through the real model on our infrastructure and produced real output
 * with evidence recorded.
 */
import type { ModelEntry } from "./globalModelRegistry";

const unknownLicence = { stated: null, source: null, confidence: "unknown" as const };

export const GLOBAL_MODEL_REGISTRY: ModelEntry[] = [
  // -------------------------------------------------------------------------
  // Multitrack infilling / arrangement — the models closest to our own task
  // -------------------------------------------------------------------------
  {
    id: "COMPOSERS_ASSISTANT_2",
    family: "Composer's Assistant",
    name: "Composer's Assistant 2",
    authorLab: "Martin Malandro (Sam Houston State University)",
    sourceRepository: "https://github.com/m-malandro/composers-assistant-REAPER",
    huggingFace: null,
    paper: "https://arxiv.org/abs/2407.14700",
    releaseDate: "2024-07",
    revision: null,
    parameterCount: "unverified (T5-like; CA1 was ~60M)",
    architecture: "T5-style encoder-decoder",
    representation: "custom multi-track MIDI event tokens with span masking",
    contextLength: "unverified",
    capabilities: [
      "multitrack_arrangement", "track_completion", "infilling",
      "controllable_generation", "instrument_specific",
    ],
    checkpointAvailable: true,
    checkpointNotes:
      "Pretrained and finetuned models shipped with the REAPER release (v2.1.0). Sizes not yet read.",
    codeLicense: {
      stated: "MIT",
      source: "https://github.com/m-malandro/composers-assistant-REAPER (repository licence)",
      confidence: "secondary",
    },
    weightsLicense: {
      stated: null,
      source: null,
      confidence: "unknown",
    },
    trainingData: {
      stated: "public domain and permissively-licensed MIDI files",
      source: "project README, quoted in the ISMIR 2023 paper and the repository",
      confidence: "secondary",
      datasets: ["public-domain and permissively-licensed MIDI (composition not published as a named set)"],
      // The claim is exactly the right one; it has not yet been read from the
      // repository's own licence/acknowledgements files.
      underlyingWorksCleared: "unknown",
    },
    statedRestriction: null,
    roles: ["FOUNDATION_CANDIDATE", "FINE_TUNE_CANDIDATE", "SPECIALIST", "TEACHER_MODEL"],
    expectedRole:
      "The strongest lead for a shippable foundation: multi-track MIDI infilling with fine-grained controls is our exact task, and it is the only candidate found so far that claims deliberately clean training-data provenance.",
    integrationComplexity: "medium",
    knownLimitations: [
      "Parameter count, context length and checkpoint licence all still unread.",
      "Built around a REAPER workflow; the model itself needs extracting from that.",
      "Trained on a permissive-MIDI corpus of unpublished composition — the size and stylistic coverage are unknown.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  {
    id: "MIDI_GPT",
    family: "MMM / MIDI-GPT",
    name: "MIDI-GPT",
    authorLab: "Metacreation Lab, Simon Fraser University",
    sourceRepository: "https://github.com/Metacreation-Lab/MIDI-GPT",
    huggingFace: "https://huggingface.co/Metacreation/MIDI-GPT",
    paper: "https://arxiv.org/abs/2501.17011",
    releaseDate: "2025-01",
    revision: null,
    parameterCount: "unverified (GPT-2 class; prism_medium / expressive_medium checkpoints)",
    architecture: "GPT-2 decoder",
    representation: "MMM-style track-separated MIDI tokens",
    contextLength: "unverified",
    capabilities: [
      "multitrack_arrangement", "track_completion", "infilling",
      "controllable_generation", "expressive_performance", "instrument_specific",
    ],
    checkpointAvailable: true,
    checkpointNotes:
      "prism_medium and expressive_medium are explicitly mid-training checkpoints, not final snapshots.",
    codeLicense: { stated: "unverified", source: null, confidence: "unknown" },
    weightsLicense: {
      stated: "CC-BY-NC-4.0",
      source: "Metacreation/MIDI-GPT model card and the AAAI 2025 paper",
      confidence: "secondary",
    },
    trainingData: {
      stated: "GigaMIDI, acquired under Canadian Fair Dealing — research and non-commercial use only",
      source: "GigaMIDI dataset card and the MIDI-GPT paper",
      confidence: "secondary",
      datasets: ["GigaMIDI"],
      underlyingWorksCleared: "no",
    },
    statedRestriction:
      "Authors restrict use to non-commercial; GigaMIDI was acquired under Fair Dealing, limiting it to research and non-commercial use.",
    roles: ["SHADOW_CHALLENGER", "BENCHMARK_ONLY", "ARCHITECTURE_REFERENCE"],
    expectedRole:
      "A serious challenger to beat on the benchmark. Its weights can never ship, and its outputs may not be assumed safe as training data.",
    integrationComplexity: "medium",
    knownLimitations: [
      "Non-commercial at both the weights and the data layer. Fine-tuning does not remove it.",
      "Published checkpoints are mid-training and expected to be superseded.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  {
    id: "REMI_Z_ARRANGER",
    family: "Unifying Symbolic Music Arrangement (REMI-z)",
    name: "Track-Aware Reconstruction arrangement model",
    authorLab: "Longshen Ou, Jingwei Zhao, Ziyu Wang, Gus Xia, Qihao Liang, Ye Wang (NUS / Music X Lab)",
    sourceRepository: null,
    huggingFace: null,
    paper: "https://arxiv.org/abs/2408.15176",
    releaseDate: "2025-11 (NeurIPS 2025 camera-ready)",
    revision: null,
    parameterCount: "unverified",
    architecture: "segment-level reconstruction over token-level disentangled content and style",
    representation: "REMI-z — structured multitrack tokenization that relaxes global time ordering in favour of track-wise continuity",
    contextLength: "unverified",
    capabilities: [
      "multitrack_arrangement", "orchestration", "track_completion",
      "accompaniment", "instrument_specific", "controllable_generation",
    ],
    checkpointAvailable: false,
    checkpointNotes: "No public checkpoint located in this pass. Code release not confirmed.",
    codeLicense: unknownLicence,
    weightsLicense: unknownLicence,
    trainingData: { ...unknownLicence, datasets: [], underlyingWorksCleared: "unknown" },
    statedRestriction: null,
    roles: ["ARCHITECTURE_REFERENCE", "FOUNDATION_CANDIDATE"],
    expectedRole:
      "The most directly relevant published design: one model handling band arrangement, piano reduction and drum arrangement, with any-to-any instrumentation at inference. REMI-z is the representation to measure ARRANGER_REMI against — it solves the same problem we solved with Track_<family> grouping, and its claim that relaxing global time ordering in favour of track-wise continuity improves arrangement is directly testable against our tokenizer.",
    integrationComplexity: "high",
    knownLimitations: [
      "No checkpoint found. Without weights this is a design to learn from, not a model to run.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  // -------------------------------------------------------------------------
  // Large symbolic foundations
  // -------------------------------------------------------------------------
  {
    id: "MUPT",
    family: "MuPT",
    name: "MuPT-v1-8192 (190M / 550M / 1.07B / 1.97B)",
    authorLab: "M-A-P (Multimodal Art Projection)",
    sourceRepository: "https://github.com/a43992899/MuPT",
    huggingFace: "https://huggingface.co/m-a-p/MuPT-v1-8192-1.07B",
    paper: "https://arxiv.org/abs/2404.06393",
    releaseDate: "2024-04",
    revision: null,
    parameterCount: "190M, 550M, 1.07B, 1.97B",
    architecture: "LLaMA2 decoder (1.07B: 48 layers, hidden 1536, 24 heads)",
    representation: "ABC notation, newlines as <n>, merged tracks split in post-processing",
    contextLength: "8192 tokens",
    capabilities: [
      "full_symbolic_composition", "melody_generation", "accompaniment",
      "multitrack_arrangement", "style_conditioned",
    ],
    checkpointAvailable: true,
    checkpointNotes: "Multiple sizes on the M-A-P Hugging Face organisation, Megatron-LM and HF formats.",
    codeLicense: { stated: "Apache-2.0", source: "model card", confidence: "secondary" },
    weightsLicense: {
      stated: "Apache-2.0",
      source: "https://huggingface.co/m-a-p/MuPT-v1-8192-1.07B model card",
      confidence: "secondary",
    },
    trainingData: {
      stated: "~7 million symbolic music pieces; composition and provenance not published per-source",
      source: "MuPT paper and model card",
      confidence: "secondary",
      datasets: ["undisclosed 7M-piece symbolic corpus"],
      // An Apache-2.0 label on weights trained on an undisclosed 7M-piece
      // corpus is exactly the case the brief warns about.
      underlyingWorksCleared: "unknown",
    },
    statedRestriction: null,
    roles: ["FOUNDATION_CANDIDATE", "FINE_TUNE_CANDIDATE", "TEACHER_MODEL", "BENCHMARK_ONLY"],
    expectedRole:
      "The largest permissively-labelled symbolic foundation found. Its ABC representation is a poor fit for our per-instrument, per-bar arranging context, so it is a candidate to fine-tune or distil from rather than to adopt whole.",
    integrationComplexity: "high",
    knownLimitations: [
      "ABC notation loses the instrument-role, section and articulation structure PartGenerationRequestV2 carries.",
      "Training-corpus provenance is undisclosed, so Apache-2.0 on the weights does not settle commercial use.",
      "Bar-level and track-level conditioning would have to be encoded into ABC text prompts.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  {
    id: "NOTAGEN",
    family: "NotaGen",
    name: "NotaGen / NotaGen-X (110M / 244M / 516M)",
    authorLab: "ElectricAlexis et al. (Central Conservatory of Music / collaborators)",
    sourceRepository: "https://github.com/ElectricAlexis/NotaGen",
    huggingFace: "https://huggingface.co/ElectricAlexis/NotaGen",
    paper: "https://www.ijcai.org/proceedings/2025/1134.pdf",
    releaseDate: "2025",
    revision: null,
    parameterCount: "110M (small), 244M (medium), 516M (large)",
    architecture: "patch-level decoder + character-level decoder (large: 20 + 6 layers, hidden 1280)",
    representation: "ABC notation, patch-tokenised",
    contextLength: "unverified",
    capabilities: ["full_symbolic_composition", "style_conditioned", "form_section_development"],
    checkpointAvailable: true,
    checkpointNotes: "Pre-trained, fine-tuned and RL (CLaMP-DPO) checkpoints, plus NotaGen-X.",
    codeLicense: { stated: "MIT", source: "Hugging Face model card metadata", confidence: "secondary" },
    weightsLicense: { stated: "MIT", source: "Hugging Face model card metadata", confidence: "secondary" },
    trainingData: {
      stated: "1.6M pieces pre-training; ~9k classical pieces fine-tuning with period-composer-instrumentation prompts",
      source: "NotaGen paper and model card",
      confidence: "secondary",
      datasets: ["1.6M-piece pre-training corpus (undisclosed composition)", "~9k classical fine-tuning set"],
      underlyingWorksCleared: "unknown",
    },
    statedRestriction: null,
    roles: ["BENCHMARK_ONLY", "TEACHER_MODEL", "ARCHITECTURE_REFERENCE"],
    expectedRole:
      "Strong at classical sheet-music composition, which is not our product. Its three-stage recipe — pretrain, fine-tune on a curated style set, then RL against a CLaMP critic — is the most directly transferable idea here: it is the same shape as our own pretrain → PDMX → reward-model plan.",
    integrationComplexity: "medium",
    knownLimitations: [
      "Classical sheet music, monophonic-to-small-ensemble; not a pop/multitrack arranger.",
      "ABC representation, same structural loss as MuPT.",
      "Pre-training corpus composition undisclosed.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  {
    id: "ANTICIPATORY_MUSIC_TRANSFORMER",
    family: "Anticipation",
    name: "Anticipatory Music Transformer",
    authorLab: "John Thickstun, David Hall, Chris Donahue, Percy Liang (Stanford CRFM)",
    sourceRepository: "https://github.com/jthickstun/anticipation",
    huggingFace: "https://huggingface.co/stanford-crfm",
    paper: "https://arxiv.org/abs/2306.08620",
    releaseDate: "2023-06",
    revision: null,
    parameterCount: "unverified (small/medium/large variants)",
    architecture: "decoder-only transformer with anticipation (interleaved control events)",
    representation: "arrival-time event tokens with anticipated controls",
    contextLength: "unverified",
    capabilities: ["infilling", "accompaniment", "track_completion", "controllable_generation"],
    checkpointAvailable: true,
    checkpointNotes: "Final checkpoints on the Stanford CRFM Hugging Face organisation.",
    codeLicense: { stated: "Apache-2.0", source: "repository", confidence: "secondary" },
    weightsLicense: { stated: "Apache-2.0", source: "Stanford CRFM HF org", confidence: "secondary" },
    trainingData: {
      stated: "Lakh MIDI (LMD), CC-BY-4.0 as a compilation",
      source: "paper §experiments; Lakh MIDI dataset page",
      confidence: "secondary",
      datasets: ["Lakh MIDI"],
      // The exact case the brief names: the dataset licence is permissive and
      // the underlying transcriptions are of copyrighted recordings.
      underlyingWorksCleared: "no",
    },
    statedRestriction:
      "Lakh MIDI files are largely transcriptions of copyrighted recordings; the CC-BY-4.0 licence covers the compilation, not the underlying works.",
    roles: ["SHADOW_CHALLENGER", "BENCHMARK_ONLY", "ARCHITECTURE_REFERENCE"],
    expectedRole:
      "The cleanest published formulation of infilling-with-control, and a strong benchmark for accompaniment. The anticipation trick — interleaving control events ahead of the notes they constrain — is directly applicable to conditioning ARRANGER_FM on a harmony plan.",
    integrationComplexity: "low",
    knownLimitations: [
      "Lakh-trained: not shippable as weights however permissive the model licence looks.",
      "Single-stream event model; instrument roles are weaker than a track-structured representation.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  {
    id: "GETMUSIC",
    family: "Microsoft Muzic",
    name: "GETMusic (GETScore + GETDiff)",
    authorLab: "Microsoft Research Asia",
    sourceRepository: "https://github.com/microsoft/muzic",
    huggingFace: null,
    paper: "https://arxiv.org/abs/2305.10841",
    releaseDate: "2023-05",
    revision: null,
    parameterCount: "unverified",
    architecture: "non-autoregressive discrete diffusion over a 2D track×time score",
    representation: "GETScore — notes as tokens in a 2D grid, tracks stacked vertically, time horizontal",
    contextLength: "unverified",
    capabilities: [
      "multitrack_arrangement", "track_completion", "accompaniment",
      "infilling", "controllable_generation",
    ],
    checkpointAvailable: false,
    checkpointNotes: "Checkpoint availability under the Muzic repo not confirmed in this pass.",
    codeLicense: { stated: "MIT (Muzic repository)", source: "microsoft/muzic", confidence: "secondary" },
    weightsLicense: unknownLicence,
    trainingData: { ...unknownLicence, datasets: [], underlyingWorksCleared: "unknown" },
    statedRestriction: null,
    roles: ["ARCHITECTURE_REFERENCE", "FOUNDATION_CANDIDATE"],
    expectedRole:
      "The any-to-any source→target track capability is precisely our task generalised, and the 2D GETScore layout is a serious alternative to a linearised token stream for keeping tracks aligned. Worth measuring our representation against even if the weights never ship.",
    integrationComplexity: "high",
    knownLimitations: [
      "Non-autoregressive diffusion — harder to condition incrementally than a decoder.",
      "Weights licence and training provenance both unread.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
  // -------------------------------------------------------------------------
  // Retrieval / reward
  // -------------------------------------------------------------------------
  {
    id: "CLAMP3",
    family: "CLaMP",
    name: "CLaMP 3",
    authorLab: "Sander Wood et al. (ACL 2025)",
    sourceRepository: "https://github.com/sanderwood/clamp3",
    huggingFace: "https://huggingface.co/sander-wood/clamp3",
    paper: "https://arxiv.org/abs/2502.10362",
    releaseDate: "2025-02",
    revision: null,
    parameterCount: "unverified",
    architecture: "contrastive multimodal encoders (text / sheet music / MIDI / audio)",
    representation: "bar or MIDI-message units for symbolic; 5-second clips for audio",
    contextLength: "unverified",
    capabilities: ["embeddings_retrieval", "music_language_reasoning"],
    checkpointAvailable: true,
    checkpointNotes: "SAAS (audio-optimised) and C2 (symbolic; config.py line 66 'saas'→'c2') variants.",
    codeLicense: { stated: "MIT", source: "https://github.com/sanderwood/clamp3", confidence: "secondary" },
    weightsLicense: { stated: "MIT", source: "https://huggingface.co/sander-wood/clamp3 model card", confidence: "secondary" },
    trainingData: {
      stated: "M4-RAG (2.31M music-text pairs, 27 languages); WikiMT-X (1,000 triplets) for benchmarking",
      source: "CLaMP 3 model card and ACL 2025 paper",
      confidence: "secondary",
      datasets: ["M4-RAG", "WikiMT-X"],
      underlyingWorksCleared: "unknown",
    },
    statedRestriction: null,
    roles: ["SPECIALIST", "ARCHITECTURE_REFERENCE"],
    expectedRole:
      "The natural backbone for MUSIC_REWARD_MODEL_V1 and for style similarity. NotaGen's CLaMP-DPO shows it working as an RL critic for symbolic music, which is exactly the role our plan reserves for a reward model. Already present in this repo's catalogue as CLAMP3.",
    integrationComplexity: "medium",
    knownLimitations: [
      "Licence and training provenance both unread — and a reward model shapes a shipped model, so its own rights matter.",
    ],
    auditConfidence: "secondary",
    liveInferenceProven: false,
  },
];

/** Entries already present in this repo's own provider catalogue, for the audit. */
export const ALREADY_IN_CATALOGUE = [
  "ANYACCOMP", "HAFM", "SYMPHONYGEN", "METEOR", "MIDI_SAG", "MUSE_CONTROL_LITE",
  "MAGENTA_RT2", "LADA_BAND", "MIDI_RWKV", "DIFFRHYTHM_2", "CLAMP3",
  "MUSICGEN", "ACE_STEP_BASE", "STABLE_AUDIO_3_SMALL_MUSIC", "STABLE_AUDIO_3_MEDIUM",
  "BASIC_PITCH", "MT3", "MR_MT3", "YOUR_MT3", "ALL_IN_ONE", "BS_ROFORMER",
  "DEMUCS", "SHEETSAGE", "CHROMA", "BASS",
] as const;
