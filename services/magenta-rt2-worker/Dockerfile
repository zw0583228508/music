# Dedicated Magenta RT2 (JAX/CUDA) runtime. It is never shared with the
# PyTorch workers, because jax[cuda12] and torch pin different CUDA stacks.
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04

# Fail before apt, git clone or any download if the recorded licence review no
# longer says this build is permitted. Unlike the gated research models, Magenta
# RT2 is Apache-2.0 code and CC-BY-4.0 weights, so the gate asserts the
# attribution obligation rather than an access approval.
COPY services/magenta-rt2-worker/license_manifest.json /tmp/magenta-rt2-license-manifest.json
COPY services/magenta-rt2-worker/release-evidence/license-review.json /tmp/magenta-rt2-license-review.json
RUN grep -Fq '"license_status": "VERIFIED_PERMISSIVE"' /tmp/magenta-rt2-license-manifest.json \
 && grep -Fq '"attribution_required": true' /tmp/magenta-rt2-license-manifest.json \
 && grep -Fq '"runtimeBuildAuthorized": true' /tmp/magenta-rt2-license-review.json \
 || (echo 'BLOCKED_LICENSE: Magenta RT2 image build refused before upstream download' >&2; exit 1)

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ffmpeg libsndfile1 python3.11 python3.11-venv python3.11-dev \
 && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m venv /opt/magenta-rt2-venv
ENV PATH=/opt/magenta-rt2-venv/bin:$PATH
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

COPY services/magenta-rt2-worker/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# The package is installed from the pinned commit with --no-deps: requirements.txt
# already carries the versions from the same commit's uv.lock, and resolving the
# dependency tree twice is how a pinned build silently drifts.
RUN git clone https://github.com/magenta/magenta-realtime.git /opt/magenta-realtime \
 && git -C /opt/magenta-realtime checkout --detach 694a545e4ba0b88bf1150137b129582166d3e07f \
 && test "$(git -C /opt/magenta-realtime rev-parse HEAD)" = "694a545e4ba0b88bf1150137b129582166d3e07f" \
 && git -C /opt/magenta-realtime submodule update --init --recursive \
 && pip install --no-cache-dir --no-deps /opt/magenta-realtime

WORKDIR /app
COPY services/magenta-rt2-worker/ /app/
RUN useradd --system magenta \
 && mkdir -p /var/lib/magenta-rt2/models /var/lib/magenta-rt2/smoke /var/lib/magenta-rt2/artifacts \
 && chown -R magenta:magenta /app /var/lib/magenta-rt2
USER magenta
CMD ["/opt/magenta-rt2-venv/bin/python","-m","uvicorn","app:app","--host","0.0.0.0","--port","8021"]
