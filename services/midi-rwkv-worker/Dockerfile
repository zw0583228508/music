# MIDI-RWKV runtime. This image is not permitted to exist yet, and the build
# says so before apt, git clone or any download.
#
# The code is MIT. The weights it ships were pretrained on GigaMIDI, which is
# CC-BY-NC-4.0, and inherit that restriction. Future authorisation must update
# the retained licence review and the machine-readable manifest together; an
# environment variable, endpoint or token cannot change what the weights were
# trained on and so cannot open this gate.
FROM ubuntu:22.04
COPY services/midi-rwkv-worker/license_manifest.json /tmp/midi-rwkv-license-manifest.json
COPY services/midi-rwkv-worker/release-evidence/license-review.json /tmp/midi-rwkv-license-review.json
RUN grep -Fq '"commercial_use_permitted": true' /tmp/midi-rwkv-license-manifest.json \
 && ! grep -Fq '"routing_status": "BLOCKED_LICENSE"' /tmp/midi-rwkv-license-manifest.json \
 && grep -Fq '"commercialCorpusRetrainEvidenceRetained": true' /tmp/midi-rwkv-license-review.json \
 && grep -Fq '"runtimeBuildAuthorized": true' /tmp/midi-rwkv-license-review.json \
 || (echo 'BLOCKED_LICENSE: MIDI-RWKV image build refused before upstream download; base weights inherit CC-BY-NC-4.0 from GigaMIDI' >&2; exit 1)
# Nothing below this line has ever run. It is the shape a permitted build would
# take, kept so that authorisation is a manifest change rather than a rewrite.
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git python3.11 python3.11-venv && rm -rf /var/lib/apt/lists/*
RUN python3.11 -m venv /opt/midi-rwkv-venv
RUN git clone https://github.com/christianazinn/MIDI-RWKV.git /opt/midi-rwkv \
 && git -C /opt/midi-rwkv checkout --detach 7c94e9e2980d1f3cdb0d3a9ca2780ef0a5af6530 \
 && test "$(git -C /opt/midi-rwkv rev-parse HEAD)" = "7c94e9e2980d1f3cdb0d3a9ca2780ef0a5af6530"
WORKDIR /app
COPY services/midi-rwkv-worker/ /app/
CMD ["/opt/midi-rwkv-venv/bin/python","-c","import license_gate; license_gate.require_authorization('MIDI-RWKV serving')"]
