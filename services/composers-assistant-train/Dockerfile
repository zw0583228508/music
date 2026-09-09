# Composer's Assistant 2 LoRA trainer (Wave Q — Model Discovery, PR-63).
# The worker's pins (services/composers-assistant-worker/Dockerfile) plus CUDA
# torch of the same version and PEFT. One image, one pinned runtime; the image
# only exists if the pinned checkpoint verifies and the guard's tests pass.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# torch 2.0.1 is the worker's pin; the cu118 wheel is the same release built
# for the GPU. transformers/tokenizers/numpy/miditoolkit/portion as the worker.
# peft 0.6.2 is the last line that declares support for transformers 4.31
# (verified locally against 4.31.0 / tokenizers 0.13.3 / torch 2.0.1).
RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cu118 "torch==2.0.1" \
    && pip install \
       "transformers==4.31.0" \
       "tokenizers==0.13.3" \
       "numpy<2" \
       "miditoolkit==1.0.1" \
       "portion==2.6.2" \
       "safetensors>=0.3.1" \
       "peft==0.6.2" \
       "accelerate>=0.21.0" \
    && python -c "import importlib.metadata as m; assert m.version('transformers') == '4.31.0'; assert m.version('tokenizers') == '0.13.3'; assert m.version('torch').startswith('2.0.1'); assert m.version('peft') == '0.6.2'; assert m.version('miditoolkit') == '1.0.1'; assert m.version('portion') == '2.6.2'; import numpy; assert numpy.__version__.startswith('1.')"

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

COPY services/composers-assistant-train/*.py /app/train/
COPY services/composers-assistant-train/Dockerfile /app/train/
ENV CA2_VENDOR_DIR=/app/vendor/composers_assistant_v2

# Build-time gates: the guard's tests, the collator's, the manifest's; then the
# checkpoint's sha and the tokenizer's vocabulary through the vendored code.
RUN cd /app/train && python -m unittest test_budget_guard test_collate test_training_manifest test_eval_hooks test_train_gates test_modal_train_config \
    && python -c "import sys; sys.path.insert(0, '/app/train'); import ca2_pins; print(ca2_pins.verify_base_model()); print(ca2_pins.tokenizer_version())"
