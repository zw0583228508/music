# MT3 / MR-MT3 baseline worker (PR-83, Wave ANALYSIS ENGINE — stream C).
#
# The field's baseline, given a number on OUR benchmark instead of quoted from
# the challenge's. MR-MT3's repository (MIT) is used rather than the
# challenge's own linked PyTorch port, which declares no licence at all.
#
# MT3's inference stack is 2022-era and imports `t5.data`, `seqio`, `ddsp` and
# `tensorflow` at module scope even on the PyTorch path — for one integer and
# one abstract base class. The image installs them rather than patching the
# imports out: a patched image would measure our fork of MT3, not MT3.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git libsndfile1 ffmpeg build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# One resolver pass over all of these is impossible — `tensorflow==2.11.0`
# requires protobuf <3.20 on some paths while `note-seq`/`t5` pull it forward,
# and pip reports ResolutionImpossible (the first build of this image did).
#
# MR-MT3's README does not solve that; it *sequences* around it, installing one
# package per pip invocation so each later pin overrides the previous
# resolution. The environment their results were produced in is the environment
# that command sequence leaves behind, so it is reproduced verbatim rather than
# tidied into something pip would call consistent.
RUN pip install --upgrade pip
RUN pip install "transformers==4.18.0"
RUN pip install --index-url https://download.pytorch.org/whl/cu121 "torch==2.1.2" "torchaudio==2.1.2"
RUN pip install "librosa==0.9.1"
RUN pip install "t5==0.9.3"
RUN pip install "note-seq==0.0.3"
RUN pip install "pretty-midi==0.2.9"
RUN pip install "einops==0.4.1"
# `ddsp` pulls `crepe`, whose setup.py does `import pkg_resources`. pip builds
# it in an isolated environment that installs a modern setuptools, and
# setuptools >= 81 no longer ships pkg_resources — so the build dies with
# `ModuleNotFoundError: pkg_resources` (builds 2 and 3 of this image did).
#
# `PIP_CONSTRAINT` does not fix it: constraints bound version *resolution*, not
# what the isolated build environment provides. The fix is to switch the build
# off isolation entirely so it uses this image's own `setuptools<81`, which
# still has pkg_resources.
RUN pip install "setuptools<81" wheel Cython
RUN pip install --no-build-isolation "ddsp"
RUN pip install "tensorflow==2.11.0"
RUN pip install "tensorflow-text==2.11.0"
RUN pip install "protobuf==3.20.3"
RUN pip install "numpy==1.23.5"
RUN pip install "hydra-core==1.2.0" "typing_extensions"
RUN pip install "tensorflow-probability==0.19.0"
RUN pip install "pytorch-lightning==1.9.5"
RUN pip install "huggingface_hub==0.25.2"
# What actually ended up installed, asserted rather than assumed. torch is not
# pinned in the assertion because the CUDA index may resolve a build suffix.
RUN python -c "import importlib.metadata as m; \
    assert m.version('transformers')=='4.18.0', m.version('transformers'); \
    assert m.version('numpy')=='1.23.5', m.version('numpy'); \
    assert m.version('tensorflow')=='2.11.0', m.version('tensorflow'); \
    assert m.version('torch').startswith('2.1.2'), m.version('torch')"

# The import that decides whether this image is possible at all. It runs before
# anything is downloaded so a dependency failure costs seconds, not minutes.
RUN python -c "import tensorflow, t5.data, seqio, note_seq, ddsp, torch; print('stack ok', tensorflow.__version__, torch.__version__)"

# The code, pinned by commit (a git commit hash is a content hash).
ARG MRMT3_COMMIT=826ea84a933f93cd707d11e91af711f1d19c8d79
RUN git clone --filter=blob:none https://github.com/gudgud96/MR-MT3.git /app/mrmt3 \
    && cd /app/mrmt3 \
    && git checkout ${MRMT3_COMMIT} \
    && test -f /app/mrmt3/inference.py \
    && test -f /app/mrmt3/contrib/vocabularies.py

# The checkpoints, at a pinned revision, verified against the sha256 the
# Hugging Face LFS pointer states and model_manifest.json records.
ARG MT3_MODEL_REVISION=7bd24c3e1dc26468a6a9354c0a4f174405c9bad8
RUN mkdir -p /app/model \
    && curl -fsSL -o /app/model/mt3.pth \
         "https://huggingface.co/gudgud1014/MR-MT3/resolve/${MT3_MODEL_REVISION}/mt3.pth" \
    && curl -fsSL -o /app/model/slakh_f1_0.65.pth \
         "https://huggingface.co/gudgud1014/MR-MT3/resolve/${MT3_MODEL_REVISION}/slakh_f1_0.65.pth" \
    && echo "b8a3807ed265059abd25ad7f68142c06c35e8f6144dcaa45bd55946a3745398f  /app/model/mt3.pth" | sha256sum -c - \
    && echo "a9fc728af2b7e72aa0517c1fe2f4dddb3f01211e7a2da467277593733d6f080b  /app/model/slakh_f1_0.65.pth" | sha256sum -c -

COPY services/mt3-baseline-worker/*.py /app/
COPY services/mt3-baseline-worker/model_manifest.json /app/
COPY services/mt3-baseline-worker/Dockerfile /app/

ENV MT3_REPO=/app/mrmt3 MT3_MODEL_DIR=/app/model
RUN cd /app && python -c "import mt3_infer, json; r = mt3_infer.verify_all(); print(json.dumps(r, indent=2)); assert r['verified'], 'checkpoint verification failed'"

# The real smoke runs on a GPU in modal_app.build_smoke: the handler builds and
# transcribes a synthesised clip. Here, only what needs no GPU.
RUN cd /app && MT3_SMOKE_CPU=1 python /app/smoke_test.py
