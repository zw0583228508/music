# Melody/bass specialist worker (ANALYSIS ENGINE stream G, PR-88).
# One isolated CPU image: htdemucs 4-stem separation + three monophonic pitch
# trackers (pYIN, CREPE, Basic Pitch/ONNX). Nothing shared with any other
# worker; every weight is fetched at build and verified against the sha256 in
# model_manifest.json, and the image only exists if the build-time smoke found
# the right pitches on the right stems.
FROM python:3.11-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# CPU-only Torch; the trackers are small CNNs and htdemucs on a three-minute
# song is a CPU job measured in minutes, which is the right cost for evidence.
RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.2.2" "torchaudio==2.2.2" \
    && pip install \
       "numpy==1.26.4" \
       "scipy==1.11.4" \
       "librosa==0.10.2.post1" \
       "soundfile==0.12.1" \
       "resampy==0.4.3" \
       "pretty_midi==0.2.10" \
       "mir_eval==0.7" \
       "onnxruntime==1.17.3" \
       "einops==0.7.0" \
       "julius==0.2.7" \
       "lameenc==1.7.0" \
       "openunmix==1.3.0" \
       "pyyaml==6.0.1" \
       "tqdm==4.66.2" \
       "dora-search==0.1.12" \
       "fastapi>=0.110" \
       "uvicorn>=0.29" \
       "pydantic>=2.6" \
    && pip install --no-deps "demucs==4.0.1" "torchcrepe==0.0.24" "basic-pitch==0.4.0" \
    && python -c "import importlib.metadata as m; assert m.version('demucs') == '4.0.1'; assert m.version('torchcrepe') == '0.0.24'; assert m.version('basic-pitch') == '0.4.0'; assert m.version('torch').startswith('2.2.2'); import numpy; assert numpy.__version__ == '1.26.4'"

# The htdemucs checkpoint, fetched once at build into the torch hub cache the
# worker points at, and verified against the FULL sha256 (demucs itself checks
# only the 8-hex file-name suffix).
ARG HTDEMUCS_SHA256=8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4
ENV TORCH_HOME=/app/torch
RUN mkdir -p /app/torch/hub/checkpoints \
    && curl -fsSL -o /app/torch/hub/checkpoints/955717e8-8726e21a.th \
         "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th" \
    && echo "${HTDEMUCS_SHA256}  /app/torch/hub/checkpoints/955717e8-8726e21a.th" | sha256sum -c -

COPY services/melody-bass-worker/*.py /app/
COPY services/melody-bass-worker/model_manifest.json /app/
# `modal_config.image_evidence()` digests this file at container start.
COPY services/melody-bass-worker/Dockerfile /app/

# The real smoke: identity gate (every pin re-hashed) + separation of a
# synthesised mix + every tracker on clean and separated stems, on CPU, here.
ENV MELODY_BASS_SMOKE_MARKER=/app/smoke-marker.json
RUN cd /app && python /app/smoke_test.py \
    && python -c "import tracker, json; i = tracker.identity(); assert i['healthy'], json.dumps([c for c in i['checks'] if not c['ok']])"

EXPOSE 8012
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8012"]
