# Separation tournament worker (PR-82). One shared base for four arms: the
# runtime, the pinned upstream inference code and the worker itself. Weights
# are fetched and verified per arm by a Modal build step keyed on the arm name
# (`modal_app.py`), so no two arms can share a weights layer by accident.
ARG CUDA_IMAGE=nvidia/cuda@sha256:2fcc4280646484290cc50dce5e65f388dd04352b07cbe89a635703bd1f9aedb6
FROM ${CUDA_IMAGE}
ARG MSST_REVISION=050cae7345f4ac1e1e27e066c2c5cdc0a2cdb679
ARG PYTORCH_SPEC=torch==2.5.1+cu124
ARG TORCHAUDIO_SPEC=torchaudio==2.5.1+cu124
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_HOME=/opt/torch-home \
    SEPARATION_WEIGHTS_ROOT=/opt/separation-weights \
    MSST_ROOT=/opt/msst \
    PYTHON_VERSION=3.11.11

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv@sha256:1ececcacbbde240ffca54d400df86e4fdd38f29c1a2366299279d197e92eaed3 /uv /uvx /bin/
RUN uv python install 3.11.11 && uv venv --python 3.11.11 /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN uv pip install --python /opt/venv/bin/python "${PYTORCH_SPEC}" "${TORCHAUDIO_SPEC}" --index-url "${TORCH_INDEX_URL}"
# The Roformer stack is what MSST's requirements pin for these models (beartype,
# rotary_embedding_torch, einops) plus PoPE-pytorch, a hard import at the pinned
# revision; demucs 4.0.1 is the package the platform already attests.
RUN uv pip install --python /opt/venv/bin/python \
      numpy==1.26.4 soundfile==0.12.1 librosa==0.11.0 pyyaml==6.0.2 ml-collections==1.1.0 \
      tqdm==4.67.1 beartype==0.14.1 rotary-embedding-torch==0.3.5 einops==0.8.1 PoPE-pytorch==0.2.1 \
      demucs==4.0.1 fastapi==0.141.1 uvicorn==0.52.4 pydantic==2.13.5 \
    && python -c "import importlib.metadata as m; assert m.version('demucs') == '4.0.1'; assert m.version('torch').startswith('2.5.1')"

# Upstream inference code at one revision, recorded and then detached from git.
RUN git clone --quiet https://github.com/ZFTurbo/Music-Source-Separation-Training /opt/msst \
    && cd /opt/msst && git checkout --quiet --detach "${MSST_REVISION}" \
    && git rev-parse HEAD > /opt/msst/REVISION && rm -rf /opt/msst/.git \
    && test "$(cat /opt/msst/REVISION)" = "${MSST_REVISION}"

WORKDIR /app
COPY services/separation-tournament-worker/model_manifest.json services/separation-tournament-worker/weights.py \
     services/separation-tournament-worker/app.py services/separation-tournament-worker/separators.py \
     services/separation-tournament-worker/smoke_test.py services/separation-tournament-worker/modal_config.py \
     services/separation-tournament-worker/Dockerfile /app/
RUN mkdir -p /opt/separation-weights /opt/torch-home/hub/checkpoints
EXPOSE 8012
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8012"]
