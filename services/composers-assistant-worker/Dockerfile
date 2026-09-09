# Composer's Assistant 2 worker (Wave Q — Model Discovery). One model family,
# one image, one pinned runtime; nothing shared with any other worker.
#
# Pins follow the model's own config.json (transformers 4.31.0) and that
# release's declared support (Python 3.8–3.10, torch >=1.9 !=1.12.0,
# tokenizers <0.14). CPU build: a ~192M-parameter T5 infilling eight bars is a
# CPU-scale job, and a GPU would be prestige, not value, for the smoke.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.0.1" \
    && pip install \
       "transformers==4.31.0" \
       "tokenizers==0.13.3" \
       "numpy<2" \
       "miditoolkit==1.0.1" \
       # Imported lazily inside preprocessing_functions._equality_measure, only
       # when two tracks share an instrument. A synthetic three-instrument
       # smoke never reaches it; the second real PDMX file did, and failed.
       "portion==2.6.2" \
       "safetensors>=0.3.1" \
       "fastapi>=0.110" \
       "uvicorn>=0.29" \
       "python-multipart>=0.0.9" \
    && python -c "import importlib.metadata as m; assert m.version('transformers') == '4.31.0'; assert m.version('tokenizers') == '0.13.3'; assert m.version('torch').startswith('2.0.1'); assert m.version('miditoolkit') == '1.0.1'; assert m.version('portion') == '2.6.2'; import numpy; assert numpy.__version__.startswith('1.')"

# The release, fetched from its GitHub asset and verified against the sha256
# recorded in docs/evidence/model-composers-assistant-2-audit.json. Only the
# Python source and the large unjoined infill model are kept; the REAPER
# effects, the SPM model and the optimizer state are not needed and not shipped.
ARG CA2_ZIP_SHA256=2a17d0b12f17a5fc85f8d54c441e9a2d68b53e828115083942709aa676fac0b0
ARG CA2_BIN_SHA256=297bccb173b4497a3c3b6007422506dced88fd9f99f5c8a18481dedd9667d530
RUN curl -fsSL -o /tmp/ca2.zip \
      https://github.com/m-malandro/composers-assistant-REAPER/releases/download/v2.1.0/composers.assistant.v.2.1.0.zip \
    && echo "${CA2_ZIP_SHA256}  /tmp/ca2.zip" | sha256sum -c - \
    && mkdir -p /app/vendor \
    && unzip -q /tmp/ca2.zip \
         "Scripts/composers_assistant_v2/*.py" \
         "Scripts/composers_assistant_v2/license.txt" \
         "Scripts/composers_assistant_v2/disclaimer.txt" \
         "Scripts/composers_assistant_v2/models_permuted_labels/unjoined/infill/finetuned_epoch_49_0/model/*" \
         -d /tmp/ca2 \
    && mv /tmp/ca2/Scripts/composers_assistant_v2 /app/vendor/composers_assistant_v2 \
    && echo "${CA2_BIN_SHA256}  /app/vendor/composers_assistant_v2/models_permuted_labels/unjoined/infill/finetuned_epoch_49_0/model/pytorch_model.bin" | sha256sum -c - \
    && rm -rf /tmp/ca2.zip /tmp/ca2

COPY services/composers-assistant-worker/*.py /app/
COPY services/composers-assistant-worker/model_manifest.json /app/
# `modal_config.image_evidence()` digests this file at container start.
COPY services/composers-assistant-worker/Dockerfile /app/

# The real smoke runs at build time: identity gate (checksum, vocab, runtime
# pins) and then a real infill on a synthesised three-track MIDI. A container
# that starts is a container whose model produced notes.
ENV CA2_VENDOR_DIR=/app/vendor/composers_assistant_v2
RUN cd /app && MUSIC_AI_WORKER_TOKEN=build-time-smoke python /app/smoke_test.py

EXPOSE 8010
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
