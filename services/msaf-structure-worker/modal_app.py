"""MSAF structure worker (ANALYSIS ENGINE, Stream F - PR-87).

An isolated, pinned CPU image that runs the Music Structure Analysis Framework
(MSAF, MIT licence, Nieto & Bello 2016) over WAV files and returns section
boundaries and labels for a few classic unsupervised algorithms:

  sf + fmc2d      Serra's structural features for boundaries, 2D-FMC labels
  foote + fmc2d   Foote's checkerboard novelty for boundaries, 2D-FMC labels
  scluster        spectral clustering (McFee & Ellis 2014), boundaries + labels

Nothing is trained or downloaded beyond pip packages; the image is built once
and every run records its digest. Invoked by
`scripts/run-structure-tournament.mjs` through `modal run`:

  py -m modal run services/msaf-structure-worker/modal_app.py \
      --input-dir <dir of .wav> --output <json>

Budget: CPU only (2 cores, 4 GiB). A three-minute song takes ~10-30 s per
algorithm; the whole tournament is well under a dollar.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import modal

APP_NAME = "msaf-structure-worker"
ALGORITHMS: tuple[tuple[str, str, str], ...] = (
    ("MSAF", "sf", "fmc2d"),
    ("MSAF_FOOTE", "foote", "fmc2d"),
    ("MSAF_SCLUSTER", "scluster", "scluster"),
)

# msaf 0.1.80 declares `enum34`, which shadows the stdlib enum on Python 3;
# install it without dependencies and pin the real ones by hand.
PINNED = [
    "numpy==1.23.5",
    "scipy==1.10.1",
    "scikit-learn==1.2.2",
    "pandas==1.5.3",
    "joblib==1.3.2",
    "librosa==0.8.1",
    "numba==0.56.4",
    "llvmlite==0.39.1",
    "audioread==3.0.1",
    "soundfile==0.12.1",
    "resampy==0.4.2",
    "decorator==5.1.1",
    "future==0.18.3",
    "jams==0.3.4",
    "mir_eval==0.7",
    "matplotlib==3.7.5",
    "seaborn==0.12.2",
    "cvxopt==1.3.2",
    "vmo==0.30.5",
    "sortedcontainers==2.4.0",
    "jsonschema==4.17.3",
]

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(*PINNED)
    .pip_install("msaf==0.1.80", extra_options="--no-deps")
    .run_commands("python -c 'import msaf, librosa, numpy; print(msaf.__version__, librosa.__version__, numpy.__version__)'")
)

app = modal.App(APP_NAME)


@app.function(image=image, cpu=2.0, memory=4096, timeout=1200)
def segment(name: str, wav_bytes: bytes) -> dict:
    """Run every algorithm on one WAV. Failures are recorded, not raised."""
    import tempfile
    import warnings

    warnings.filterwarnings("ignore")
    import msaf  # noqa: WPS433
    import numpy as np  # noqa: WPS433

    started = time.time()
    out: dict = {"name": name, "readings": {}, "runtime": {}}
    with tempfile.TemporaryDirectory() as tmp:
        # MSAF caches features at <audio dir>/../features/<stem>.json and trusts
        # a cached file whose basename matches. A fixed <tmp>/audio.wav would
        # put that cache at /tmp/features/audio.json, shared by every call in
        # the container, so a later file would silently reuse the first file's
        # features. The audio therefore lives one level down under its own
        # name, and the cache (<tmp>/features/<name>.json) dies with the call.
        audio_dir = Path(tmp) / "audio"
        audio_dir.mkdir()
        path = audio_dir / f"{name}.wav"
        path.write_bytes(wav_bytes)
        for provider, boundaries_id, labels_id in ALGORITHMS:
            t0 = time.time()
            features_cache = Path(tmp) / "features" / f"{name}.json"
            cache_seen_before = features_cache.exists()
            try:
                times, labels = msaf.process(
                    str(path),
                    feature="pcp",
                    boundaries_id=boundaries_id,
                    labels_id=labels_id,
                    plot=False,
                    n_jobs=2,
                )
                times = [float(t) for t in np.asarray(times).tolist()]
                labels = [int(l) if l == l else -1 for l in np.asarray(labels).tolist()]
                sections = [
                    {"start": times[i], "end": times[i + 1], "label": str(labels[i]) if i < len(labels) else str(i)}
                    for i in range(len(times) - 1)
                ]
                out["readings"][provider] = {
                    "boundaries": times[1:-1],
                    "sections": sections,
                    "algorithm": {"boundaries": boundaries_id, "labels": labels_id, "feature": "pcp"},
                    "seconds": round(time.time() - t0, 2),
                    "featuresCached": cache_seen_before,
                }
            except Exception as error:  # noqa: BLE001 - recorded as evidence
                out["readings"][provider] = {"error": f"{type(error).__name__}: {error}"[:500], "seconds": round(time.time() - t0, 2)}
    out["runtime"] = {
        "seconds": round(time.time() - started, 2),
        "msaf": msaf.__version__,
        "numpy": np.__version__,
    }
    return out


@app.local_entrypoint()
def main(input_dir: str, output: str) -> None:
    files = sorted(p for p in Path(input_dir).iterdir() if p.suffix.lower() == ".wav")
    if not files:
        raise SystemExit(f"no .wav files in {input_dir}")
    started = time.time()
    inputs = [(p.stem, p.read_bytes()) for p in files]
    results = list(segment.starmap(inputs))
    report = {
        "app": APP_NAME,
        "algorithms": [{"provider": p, "boundaries": b, "labels": l} for p, b, l in ALGORITHMS],
        "files": len(files),
        "wallSeconds": round(time.time() - started, 1),
        "resources": {"cpu": 2.0, "memoryMiB": 4096, "gpu": None},
        "results": results,
    }
    Path(output).write_bytes((json.dumps(report, indent=2) + "\n").encode("utf-8"))
    print(f"wrote {output}: {len(results)} files in {report['wallSeconds']} s")
