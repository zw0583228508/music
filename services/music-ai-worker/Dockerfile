# The CPU worker: Spotify Basic Pitch (Apache-2.0) analysis and, since PR-92,
# the sfizz 1.2.3 + VSCO 2 Community Edition (CC0-1.0) instrument renderer.
# Demucs shares this worker's code but needs Torch and a downloaded checkpoint,
# so it is deliberately absent here: `/health?provider=DEMUCS` will report
# unhealthy in this image rather than pretend. Basic Pitch's package, its
# bundled checkpoint and its whole runtime are pinned by `model_manifest.json`
# and re-verified at runtime, so this image cannot report what it did not
# install.
FROM python:3.11-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg libsndfile1 libatomic1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The exact runtime `model_manifest.json` reviews for BASIC_PITCH. The health
# route compares these versions and refuses to be healthy if they drift.
RUN pip install --upgrade pip \
    && pip install \
       # The manifest pins the distribution named `tensorflow`, and the health
       # route reads that name: `tensorflow-cpu` is a different distribution
       # and would fail the pin even at the same version.
       "tensorflow==2.14.0" \
       "numpy==1.26.4" \
       "librosa==0.11.0" \
       "resampy==0.4.2" \
       "pretty-midi==0.2.11.post0" \
       "basic-pitch==0.4.0" \
       # The smoke checks the ONNX checkpoint as well as the TensorFlow one,
       # because `/health` attests both; without a runtime for it, Basic Pitch
       # itself refuses to load the file.
       "onnxruntime>=1.29.0" \
       "soundfile>=0.14.0" \
       "scipy>=1.11,<2" \
       "mido>=1.3.3" \
       "music21>=9.7,<10" \
       "pedalboard>=0.9.24" \
       "fastapi>=0.141.1" \
       "uvicorn>=0.52.4" \
       "pydantic>=2.13.5" \
       "python-multipart>=0.0.32" \
    && python -c "import importlib.metadata as m; assert m.version('basic-pitch') == '0.4.0'; assert m.version('tensorflow') == '2.14.0'; assert m.version('numpy') == '1.26.4'; assert m.version('librosa') == '0.11.0'; assert m.version('resampy') == '0.4.2'; assert m.version('pretty-midi') == '0.2.11.post0'"

COPY services/music-ai-worker/*.py /app/
COPY services/music-ai-worker/model_manifest.json /app/
COPY services/music-ai-worker/*.json /app/
COPY services/music-ai-worker/native_hosts /app/native_hosts
COPY services/music-ai-worker/tests /app/tests
# `modal_config.image_evidence()` digests this file at container start, so the
# image must carry the recipe that produced it.
COPY services/music-ai-worker/Dockerfile /app/

# SFIZZ_VSCO2_CE (PR-92). The operator step runs the worker's own native-asset
# lifecycle at build time: sfizz 1.2.3 is built from its pinned commit, the
# VSCO 2 CE subset is downloaded from its pinned commit and verified file by
# file against `vsco2-ce-subset.json`, the TrackModel host is built
# reproducibly and must hash to the entry a human approved in
# `approved_native_hosts.json`, the library is staged through
# `_stage_asset_candidate` (three-render canonical smoke), activated through
# `_activate_asset_candidate` (atomic manifest), and every instrument-map
# entry is rendered once. A container that starts is therefore a container
# whose VSCO 2 CE piano, strings and brass have already produced audio from a
# TrackModel. The build tools leave in the same layer; the staged, attested
# library and the `sfizz_render` binary stay.
ENV MUSIC_AI_ASSET_ROOT=/var/lib/music-ai/assets \
    MUSIC_AI_SFIZZ_INSTRUMENT_MAP=/app/sfizz_instrument_map.json \
    SFIZZ_RENDER_BINARY=/var/lib/music-ai/assets/bin/sfizz_render
RUN apt-get update && apt-get install -y --no-install-recommends git cmake g++ make pkg-config \
    && MUSIC_AI_WORKER_TOKEN=build-time-smoke python /app/operator_activate_sfizz_vsco2.py \
         --evidence /app/.readiness/sfizz-vsco2-operator.json \
    && apt-get purge -y --auto-remove git cmake g++ make pkg-config \
    && rm -rf /var/lib/apt/lists/* /root/.cache

# The real smoke runs at build time: it verifies the pinned package tree, the
# pinned checkpoint tree and the pinned runtime versions, then actually
# transcribes a tone through both the TensorFlow SavedModel and the ONNX
# checkpoint, re-runs the sfizz three-render smoke against the activated
# asset, and writes the readiness marker `/health` reads. A container that
# starts is therefore a container whose Basic Pitch checkpoint produced notes.
#
# The worker's full unit suite is deliberately NOT run here: it also covers
# Demucs (Torch) and the VST3 host, which this image does not install. The
# sfizz suite can be run inside the built image with
# `modal run modal_app.py::unit_tests`; the full suite runs in the
# repository's own test job against the full environment.
RUN MUSIC_AI_WORKER_TOKEN=build-time-smoke python /app/smoke_test.py

RUN useradd --system --home /app musicai && mkdir -p /var/lib/music-ai && chown -R musicai:musicai /app /var/lib/music-ai
USER musicai
EXPOSE 8008
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8008"]
