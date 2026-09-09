# Transcription baseline worker (PR-83, Wave ANALYSIS ENGINE — stream C).
#
# Basic Pitch only, pinned to exactly the versions
# services/music-ai-worker/model_manifest.json reviews, so the incumbent this
# sweep measures is the incumbent the platform runs. CPU: Basic Pitch is a
# small CNN and a GPU would spend budget for nothing.
FROM python:3.10-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN pip install --upgrade pip \
    && pip install \
       # The manifest pins the distribution named `tensorflow`; `tensorflow-cpu`
       # is a different distribution and would not match what production runs.
       "tensorflow==2.14.0" \
       "numpy==1.26.4" \
       "librosa==0.11.0" \
       "resampy==0.4.2" \
       "pretty-midi==0.2.11.post0" \
       "basic-pitch==0.4.0" \
    && python -c "import importlib.metadata as m; assert m.version('basic-pitch')=='0.4.0'; assert m.version('tensorflow')=='2.14.0'; assert m.version('numpy')=='1.26.4'; assert m.version('librosa')=='0.11.0'"

COPY services/transcription-baseline-worker/*.py /app/
COPY services/transcription-baseline-worker/model_manifest.json /app/
COPY services/transcription-baseline-worker/Dockerfile /app/

# A container that starts is a container whose Basic Pitch checkpoint produced
# notes from a real tone. No GPU is needed, so the whole smoke runs here.
RUN cd /app && python /app/smoke_test.py
