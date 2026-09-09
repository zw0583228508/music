# Anticipatory Music Transformer worker (Wave Q — Model Discovery, round 2).
# One model family, one image, one pinned runtime; nothing shared with any
# other worker.
#
# Pins: the checkpoint's own config.json says transformers 4.32.1; the
# upstream repository requires torch >= 2.0.1 and mido 1.2.10. GPU build:
# a 780M GPT-2 re-reads up to 1024 tokens for every sampled token (the
# upstream sampler keeps no KV cache), which is a GPU job for an eight-bar
# window. The image is CUDA 12.1 wheels on a slim base; Modal supplies the
# driver.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cu121 "torch==2.1.2" \
    && pip install \
       "transformers==4.32.1" \
       "safetensors>=0.3.1" \
       "mido==1.2.10" \
       "numpy<2" \
       "tqdm==4.65.0" \
       "fastapi>=0.110" \
       "uvicorn>=0.29" \
       "python-multipart>=0.0.9" \
    && python -c "import importlib.metadata as m; assert m.version('transformers') == '4.32.1'; assert m.version('torch').startswith('2.1.2'); assert m.version('mido') == '1.2.10'; import numpy; assert numpy.__version__.startswith('1.')"

# The sampling code, pinned by commit (a git commit hash is a content hash);
# the modules that decide the vocabulary and the decode are re-hashed by
# amt_infer.verify_code() at build, at load and on every /health.
ARG ANTICIPATION_COMMIT=af37397922665a0fb8d474d7988b0f3755a38d45
RUN pip install "git+https://github.com/jthickstun/anticipation.git@${ANTICIPATION_COMMIT}" \
    && python -c "from anticipation.vocab import VOCAB_SIZE; assert VOCAB_SIZE == 55028, VOCAB_SIZE"

# The checkpoint, fetched at a pinned revision and verified against the sha256
# that Hugging Face's LFS pointer states and docs/evidence records.
ARG AMT_REVISION=e206a88d4658661c2757573eae724d5b27213824
ARG AMT_SAFETENSORS_SHA256=83fb8b9546eacce77a90bb10006b3f569ba342361dce046d078cf2429975e09f
ARG AMT_CONFIG_SHA256=2ece2a78b4d9b48aca5dbc36e15779520e540ddec7eedf524dcdfa276b9a5046
RUN mkdir -p /app/model \
    && curl -fsSL -o /app/model/config.json \
         "https://huggingface.co/stanford-crfm/music-large-800k/resolve/${AMT_REVISION}/config.json" \
    && curl -fsSL -o /app/model/README.md \
         "https://huggingface.co/stanford-crfm/music-large-800k/resolve/${AMT_REVISION}/README.md" \
    && curl -fsSL -o /app/model/model.safetensors \
         "https://huggingface.co/stanford-crfm/music-large-800k/resolve/${AMT_REVISION}/model.safetensors" \
    && echo "${AMT_CONFIG_SHA256}  /app/model/config.json" | sha256sum -c - \
    && echo "${AMT_SAFETENSORS_SHA256}  /app/model/model.safetensors" | sha256sum -c -

COPY services/anticipatory-worker/*.py /app/
COPY services/anticipatory-worker/model_manifest.json /app/
# `modal_config.image_evidence()` digests this file at container start.
COPY services/anticipatory-worker/Dockerfile /app/

# The code pins are checked here without loading weights; the real smoke
# (identity gate + a real infill on a synthesised three-instrument MIDI) runs
# in modal_app.build_smoke on a GPU as the image's final build step, and a
# stub-model pass proves the plumbing on CPU right here.
ENV AMT_MODEL_DIR=/app/model
RUN cd /app && python -c "import amt_infer; c = amt_infer.verify_code(); assert c['verified'], c" \
    && AMT_SMOKE_STUB=1 AMT_SMOKE_MARKER=/app/smoke-marker-stub.json python /app/smoke_test.py > /dev/null

EXPOSE 8011
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8011"]
