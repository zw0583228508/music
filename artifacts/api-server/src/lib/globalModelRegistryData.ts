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
    revision: "v2.1.0 (released 2024-10-09; small model files dated 2024-06-28)",
    parameterCount:
      "large (default shipped): 192,368,256 (measured by model.num_parameters() at load; 769,602,209 bytes fp32); small: ~54M (215,745,913 bytes ÷ 4)",
    architecture:
      "T5ForConditionalGeneration. Large: 16 encoder + 16 decoder layers, d_model 576, d_ff 2304, 12 heads, d_kv 48. Small: 10+10, d_model 384, d_ff 1536, 8 heads. Both gated-GELU, relative attention (4096 buckets / max distance 4096), fp32, transformers 4.31.0 — read from each model/config.json.",
    representation:
      "'unjoined' event vocabulary, exactly 1944 tokens (reproduced from spm_train_functions.get_user_defined_symbols + UnjoinedTokenizer): ;I:0–257 instrument per track, ;R:1–63 repeated-instrument index, ;N:0–127 note-on, ;d:0–192 duration, ;D:0–127 drum hit, ;w:1–192 wait, ;L:1–192 length, ;B:0–7 BPM level, ;M:0–7 loudness level (ppp–fff, one per measure head), ;<extra_id_0..255> T5 span-mask sentinels for infilling, ;<mono>/;<poly>, and ;<instruction_0..511> — 512 control instructions (onset density horizontal/vertical, pitch-class count, pitch-histogram step/leap, onset irregularity, density diversity, rhythmic conditioning). Grid QUANTIZE=(8,6) → 24 steps per quarter, 8-quarter max note length.",
    contextLength: "MAX_LEN 1650 tokens per request (constants.py); relative attention to 4096",
    capabilities: [
      "multitrack_arrangement", "track_completion", "infilling",
      "controllable_generation", "instrument_specific",
    ],
    checkpointAvailable: true,
    checkpointNotes:
      "v2.1.0 assets: composers.assistant.v.2.1.0.zip (683 MB, includes the large model + Python source), CA.v2.1.0.small.model.optional.download.zip (192 MB: model/config.json, model/pytorch_model.bin, generation_config.json, instructions.txt — no separate licence file inside).",
    codeLicense: {
      stated: "MIT License, Copyright (c) 2023 Martin E. Malandro",
      source: "repository LICENSE file, read verbatim via the GitHub contents API",
      confidence: "verified_primary_source",
    },
    weightsLicense: {
      // No separate licence ships with the model. disclaimer.txt says "See also
      // the License", i.e. the repository MIT licence, and adds that the author
      // claims no rights to outputs.
      stated:
        "MIT — the repository LICENSE, and a second in-release Scripts/composers_assistant_v2/license.txt (\"MIT LICENSE, Copyright 2023, 2024 (The authors)\") shipped beside the models; disclaimer.txt: \"We claim no rights to the outputs you generate with the models we've distributed.\"",
      source: "repository LICENSE + in-zip license.txt + disclaimer.txt, all read verbatim; both model zips listed",
      confidence: "verified_primary_source",
    },
    trainingData: {
      stated:
        "\"These models were trained on a set of MIDI files marked as being in the public domain, available under a CC0 license (or otherwise freely available to use without attribution), available under a CC-BY license, or which we had permission from the MIDI file authors to use for training.\" — disclaimer.txt",
      source: "disclaimer.txt + acknowledgments.html (375 KB source list), both read verbatim",
      confidence: "verified_primary_source",
      datasets: [
        "The Mutopia Project (2,451 links; 237 composer rows) — PD classical compositions, CC-BY/CC0/PD typesetting",
        "CocoChorales (Yusong Wu, CC-BY 4.0) — synthetic Bach-style chorales, no underlying work",
        "The Josquin Research Project (josquin.stanford.edu) — Renaissance polyphony, PD",
        "Named contributors who granted permission (Santtu Pesonen, Augustus Knezevich, Bernd Krueger, François Faucher, Henry Howey, HetzlersFakebook, mfiles.co.uk, lutemusic.org, wussu.com, Alain Naigeon, guitarloot.org.uk, Paul Butler, anonymous)",
      ],
      // The dominant share is PD-by-age classical, a synthetic set, and
      // composer-released CC-BY. Two named residuals are recorded under
      // knownLimitations rather than hidden in this boolean.
      underlyingWorksCleared: "yes",
    },
    statedRestriction:
      "Author's own residual-risk clause: \"There is a chance (albeit, in our opinion, a very small one) that the models we've distributed may output copyrighted musical information … You use the models at your own risk.\" Not a commercial restriction.",
    roles: ["FOUNDATION_CANDIDATE", "FINE_TUNE_CANDIDATE", "SPECIALIST", "TEACHER_MODEL"],
    expectedRole:
      "The leading shippable foundation candidate, now on primary-source evidence: multi-track MIDI infilling with fine-grained controls is our exact task, it is a standard HF T5 that runs standalone, and it is the only candidate whose training corpus is dominated by works that are public domain by age.",
    integrationComplexity: "medium",
    knownLimitations: [
      "Residual 1: 18 of 237 Mutopia composer rows have post-1926 death dates — those rows rest on the composer's/arranger's own CC-BY release, not on PD-by-age.",
      "Residual 2: HetzlersFakebook (2 links of ~2,500) is a fake-book site; fake books carry jazz-standard lead sheets, some still in copyright. The author states only 'allowable' files were used.",
      "Corpus is overwhelmingly classical/early music; pop, rock, dance and Hebrew/Mizrahi idioms are essentially absent — a fine-tune on PDMX would not fix that either.",
      "The tokenizer and MIDI→string encoder (midisong.py 100 KB, encoding_functions.py, unjoined_vocab_tokenizer.py, spm_train_functions.py, preprocessing_functions.py) ship as loose Python in the release, not a package; the adapter must vendor them at the pinned revision.",
      "Inference path is a plain XML-RPC wrapper around transformers T5ForConditionalGeneration.generate() (top-p 0.85, encoder_no_repeat_ngram_size, up to 9 re-tries at rising temperature) — runs without REAPER, but the request string is built by REAPER-side code that the adapter must reimplement from encode_midisongbymeasure_with_masks().",
      "Only the 'infill' task is fine-tuned (constants.py: FINETUNE_TASK = 'infill'; 'the plan is to add additional tasks over time').",
      "Instrument vocabulary is 258 GM-ish programs per track (finer than ARRANGER_REMI's 15 families) but there is no section, phrase, harmony-plan or style-grammar token — the deep context of PartGenerationRequestV2 has no slot to enter except the 512 numeric control instructions.",
      "Observed in four real PDMX runs (CPU, 6.5–15.3 s each): one repetition collapse in four at temperature 1.0 (64 notes on a single pitch — the case CA2's own nine-retry loop exists for); the other three produced idiomatic-register, rhythmically plausible parts, one with genuine four-voice polyphony. Harmonic tracking against the context tracks is weak to moderate, and measure-to-measure repetition is high (one trumpet run repeats its bar verbatim). Single-sample quality is not a verdict; the tournament with N seeds and the platform critics is.",
      "Deployed as an isolated Modal worker (services/composers-assistant-worker; cpu=4, no GPU) and proven over HTTPS on 2026-09-09: 401 without the dedicated token, /health verifies the bin sha inside the container, two real infills on the brass score (48 and 39 notes, 5.8–7.9 s inference, warm; ~12 s cold health). The same seed sampled different outputs on the Modal host than locally — CPU T5 sampling is not bit-reproducible across machines, so the tournament runs N seeds and never compares single samples. Evidence: docs/evidence/model-composers-assistant-2-cloud.json.",
    ],
    auditConfidence: "verified_primary_source",
    liveInferenceProven: true,
    liveEvidence: "docs/evidence/model-composers-assistant-2-live.json",
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
