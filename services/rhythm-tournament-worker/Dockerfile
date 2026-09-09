# Rhythm tournament worker (Wave ANALYSIS ENGINE, PR-84).
#
# One image, every installable beat/downbeat tracker, one decode of the audio.
# CPU throughout: Beat This is a ~20M-parameter transformer over a mel
# spectrogram and madmom is a small RNN + DBN — on a 30 s excerpt both finish in
# seconds on four cores, and a GPU here would be prestige, not value.
#
# Licence note that matters more than the pins: madmom's *code* is BSD-2-Clause
# but the model files loaded by RNNDownBeatProcessor are CC BY-NC-SA 4.0. This
# image may benchmark madmom; the platform may not route production traffic to
# it without written permission from its authors. See model_manifest.json.
FROM python:3.11-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential ffmpeg libsndfile1 portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# numpy is pinned below 2 because madmom's Cython extensions and librosa 0.10
# were both built against the 1.x ABI; letting pip resolve it freely is how you
# get a worker that imports and then segfaults on the first spectrogram.
RUN pip install --upgrade pip setuptools wheel Cython \
    && pip install --index-url https://download.pytorch.org/whl/cpu \
       "torch==2.5.1" "torchaudio==2.5.1" \
    && pip install \
       "numpy<2" \
       "scipy>=1.11,<2" \
       "librosa==0.10.2.post1" \
       "soundfile>=0.12" \
       "soxr>=0.5" \
       "einops>=0.8" \
       "rotary-embedding-torch>=0.8" \
       "fastapi>=0.110" \
       "uvicorn>=0.29" \
       "python-multipart>=0.0.9"

# Beat This (MIT, code and weights). --no-deps so its unpinned `torch>=2` does
# not pull a second, CUDA-flavoured torch over the CPU wheel above.
ARG BEAT_THIS_COMMIT=b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c
RUN pip install --no-deps "beat_this @ git+https://github.com/CPJKU/beat_this.git@${BEAT_THIS_COMMIT}" \
    && python -c "import beat_this; print('beat_this', beat_this.__file__)"

# The Beat This checkpoint, baked in and digest-verified. A weight we cannot
# verify is a weight we do not deploy; the digest is the one already recorded in
# services/beat-this-worker/model_manifest.json.
ARG BEAT_THIS_CKPT_SHA256=8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331
RUN mkdir -p /var/lib/rhythm \
    && curl -fsSL -o /var/lib/rhythm/final0.ckpt \
       "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt" \
    && echo "${BEAT_THIS_CKPT_SHA256}  /var/lib/rhythm/final0.ckpt" | sha256sum -c -

# madmom from main: the last PyPI release (0.16.1) still calls np.float and
# cannot import under any numpy this decade. --no-build-isolation so it compiles
# its Cython extensions against the numpy already pinned above.
RUN pip install --no-build-isolation "madmom @ git+https://github.com/CPJKU/madmom.git@main" \
    && python -c "import madmom; print('madmom', madmom.__version__)"

# Optional contenders. These are allowed to fail: the worker's /health reports
# what it can actually import, so an absent tracker becomes an honest refusal in
# the evidence rather than a fabricated zero.
RUN (pip install --no-deps "BeatNet==1.1.0" && pip install pyaudio matplotlib \
      && python -c "import BeatNet; print('BeatNet ok')") \
    || echo "BEATNET_UNAVAILABLE: install failed, /health will report the reason"
RUN (pip install "natten==0.17.1+torch250cpu" -f https://shi-labs.com/natten/wheels \
      && pip install --no-deps "allin1==1.1.0" \
      && pip install "demucs==4.0.1" "madmom" "pydub" "torchvision" \
      && python -c "import allin1; print('allin1 ok')") \
    || echo "ALL_IN_ONE_UNAVAILABLE: install failed, /health will report the reason"

COPY services/rhythm-tournament-worker/*.py /app/
COPY services/rhythm-tournament-worker/model_manifest.json /app/
# `modal_config.image_evidence()` digests this file at container start.
COPY services/rhythm-tournament-worker/Dockerfile /app/

# The real smoke runs at build time: a synthesised click track at a known tempo,
# tracked by every provider the image has. A container that starts is a
# container in which at least one tracker found the beat it was given.
RUN cd /app && MUSIC_AI_WORKER_TOKEN=build-time-smoke python /app/smoke_test.py

EXPOSE 8014
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8014"]
