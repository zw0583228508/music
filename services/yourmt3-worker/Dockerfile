# YourMT3+ transcription worker (PR-83, Wave ANALYSIS ENGINE — stream C).
# One model family, one image, one pinned runtime; nothing shared with any
# other worker.
#
# Pins come from the Space's own requirements.txt (transformers 4.45.1,
# numpy 1.26.4, lightning >= 2.2.1). torch is pinned to 2.4.1+cu121 rather
# than left floating: the Space installs whatever `torch` resolves to that
# day, which is not a thing a benchmark can be reproduced against.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cu121 \
       "torch==2.4.1" "torchaudio==2.4.1" \
    && pip install \
       "transformers==4.45.1" \
       "numpy==1.26.4" \
       "lightning==2.4.0" \
       "einops==0.8.0" \
       "librosa==0.10.2.post1" \
       "mido==1.3.2" \
       "deprecated==1.2.14" \
       # utils/metrics.py is imported on the task-manager path, so the
       # tokenizer will not build without it. The Space installs mir_eval from
       # git; a released wheel is pinned here so the image is reproducible.
       "mir_eval==0.8.2" \
       # `model.init_train` imports the W&B logger even though this worker runs
       # with `--wandb-mode disabled`. Installed so the import resolves; it is
       # never initialised and never sends anything.
       "wandb==0.18.7" \
       "huggingface_hub==0.25.2" \
       "fastapi>=0.110" \
       "uvicorn>=0.29" \
       "python-multipart>=0.0.9" \
    && python -c "import importlib.metadata as m; assert m.version('transformers')=='4.45.1'; assert m.version('numpy')=='1.26.4'; assert m.version('torch').startswith('2.4.1')"

# The code, pinned by Space revision (a git commit is a content hash). The
# GitHub repository's default branch carries only a LICENSE and a README —
# the runnable YourMT3+ source lives in the Space, so that is what is pinned.
ARG YMT3_SPACE_REVISION=5e66c1ea173a8186e0d20432b841d3180cc015b5
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='mimbres/YourMT3', repo_type='space', revision='${YMT3_SPACE_REVISION}', local_dir='/app/space', allow_patterns=['amt/src/**', 'model_helper.py'])"
RUN mkdir -p /app/amt \
    && cp -r /app/space/amt/src /app/amt/src \
    && cp /app/space/model_helper.py /app/amt/model_helper.py \
    && rm -rf /app/space \
    && test -f /app/amt/src/model/ymt3.py \
    && test -f /app/amt/src/utils/task_manager.py

# The checkpoints, at a pinned model-repo revision and verified against the
# sha256 that Hugging Face's LFS pointer states and model_manifest.json records.
ARG YMT3_MODEL_REVISION=e45ebd70398682d54b7bb1901a5216e18f3b1824
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='mimbres/YourMT3', repo_type='model', revision='${YMT3_MODEL_REVISION}', local_dir='/app/amt', allow_patterns=['logs/2024/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b80_ps2/checkpoints/model.ckpt','logs/2024/ptf_all_cross_rebal5_mirst_xk2_edr005_attend_c_full_plus_b100/checkpoints/model.ckpt','logs/2024/notask_all_cross_v6_xk2_amp0811_gm_ext_plus_nops_b72/checkpoints/model.ckpt'])"

COPY services/yourmt3-worker/*.py /app/
COPY services/yourmt3-worker/model_manifest.json /app/
# `modal_config.image_evidence()` digests this file at container start.
COPY services/yourmt3-worker/Dockerfile /app/

# Every checkpoint re-hashed here, before any GPU time is spent. A wrong file
# is a build failure, not a quietly wrong benchmark number.
ENV YMT3_ROOT=/app/amt
RUN cd /app && python -c "import ymt3_infer, json; r = ymt3_infer.verify_all(); print(json.dumps(r, indent=2)); assert r['verified'], 'checkpoint verification failed'"

# The real smoke — loading 759 MB onto a GPU and transcribing a synthesised
# clip — runs in modal_app.build_smoke as the image's final build step. What
# runs here is the part that needs no GPU: the model builds and the tokenizer
# agrees with the checkpoint's config.
RUN cd /app && YMT3_SMOKE_CPU=1 python /app/smoke_test.py

EXPOSE 8012
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8012"]
