"""VST3 instrument hosting through pedalboard, with identity and attestation.

pedalboard is the native host here: it loads the operator's own VST3
instrument in-process and renders MIDI to audio. It needs the plugin's inner
binary (`<bundle>.vst3/Contents/x86_64-win/<name>.vst3`), not the bundle
folder -- handing it the bundle fails with "unsupported plugin format", which is
why an earlier worker in this repository assumed pedalboard could only verify
that a plugin loads.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import platform
import struct
import sys
import wave
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from midi_bridge import build_events, to_mido_messages

PLATFORM_BINARY_DIRS = ("x86_64-win", "arm64-win", "x86_64-linux", "MacOS")
SUPPORTED_SAMPLE_RATES = (44_100, 48_000)
HEADROOM_PEAK = 0.944  # -0.5 dBFS


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_plugin_binary(path: str | Path) -> Path:
    """Accept a bundle folder or the inner binary; return the loadable binary."""
    candidate = Path(path)
    if candidate.is_file():
        return candidate
    if candidate.is_dir():
        for directory in PLATFORM_BINARY_DIRS:
            matches = sorted((candidate / "Contents" / directory).glob("*.vst3"))
            matches = [m for m in matches if m.is_file()]
            if matches:
                return matches[0]
    raise FileNotFoundError(f"no loadable VST3 binary under {candidate}")


# --- host / renderer identity --------------------------------------------------


def pedalboard_version() -> str:
    import pedalboard

    return pedalboard.__version__


def renderer_binary() -> Path:
    import pedalboard_native

    return Path(pedalboard_native.__file__)


def renderer_identity() -> str:
    return f"pedalboard_native:{renderer_binary().name}@{pedalboard_version()}"


def renderer_sha256() -> str:
    return sha256_file(renderer_binary())


def runtime_identity() -> str:
    return f"pedalboard-{pedalboard_version()}/python-{sys.version.split()[0]}/{platform.system().lower()}-{platform.machine().lower()}"


# --- plugin identity ---------------------------------------------------------


@dataclass(frozen=True)
class PluginIdentity:
    name: str
    identifier: str
    version: str
    manufacturer: str
    category: str
    is_instrument: bool
    binary_path: str
    binary_sha256: str
    state_sha256: str

    @property
    def identity(self) -> str:
        return f"{self.identifier}@{self.version}"

    def to_dict(self) -> dict:
        return {**asdict(self), "identity": self.identity}


def load_instrument(path: str | Path, preset_path: str | Path | None = None):
    """Load a VST3 instrument; returns (plugin, PluginIdentity). Raises if the
    plugin is not an instrument -- an effect cannot realize a TrackModel."""
    from pedalboard import load_plugin

    binary = resolve_plugin_binary(path)
    plugin = load_plugin(str(binary))
    if not getattr(plugin, "is_instrument", False):
        raise ValueError(f"{binary.name} is not an instrument (category {getattr(plugin, 'category', '?')})")
    if preset_path:
        plugin.load_preset(str(preset_path))
    try:
        state = bytes(plugin.raw_state)
    except Exception:  # noqa: BLE001 - some plugins expose no state
        state = b""
    identity = PluginIdentity(
        name=str(plugin.name),
        identifier=str(getattr(plugin, "identifier", plugin.name)),
        version=str(getattr(plugin, "version", "unknown")),
        manufacturer=str(getattr(plugin, "manufacturer_name", "unknown")),
        category=str(getattr(plugin, "category", "")),
        is_instrument=True,
        binary_path=str(binary),
        binary_sha256=sha256_file(binary),
        state_sha256=hashlib.sha256(state).hexdigest(),
    )
    return plugin, identity


# --- rendering -----------------------------------------------------------------


@dataclass
class RenderOutput:
    wav: bytes
    frames: int
    sample_rate: int
    peak: float
    rms_dbfs: float
    clipped_samples: int
    active_frame_ratio: float
    event_count: int
    raw_peak: float = 0.0
    gain_db: float = 0.0

    @property
    def wav_sha256(self) -> str:
        return hashlib.sha256(self.wav).hexdigest()


def frames_for(sample_rate: int, duration_seconds: float) -> int:
    # Same rounding as the API: Math.ceil(sampleRate * durationSeconds).
    return int(math.ceil(sample_rate * duration_seconds - 1e-9))


def _to_stereo(audio: np.ndarray, frames: int) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        data = data[np.newaxis, :]
    if data.shape[0] not in (1, 2) and data.shape[1] in (1, 2):
        data = data.T
    if data.shape[0] == 1:
        data = np.vstack([data, data])
    if data.shape[1] > frames:
        data = data[:, :frames]
    elif data.shape[1] < frames:
        data = np.pad(data, ((0, 0), (0, frames - data.shape[1])))
    return np.clip(np.nan_to_num(data), -1.0, 1.0)


def encode_wav_pcm16(stereo: np.ndarray, sample_rate: int) -> bytes:
    interleaved = np.ascontiguousarray(stereo.T)  # (frames, 2)
    pcm = np.round(interleaved * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm.tobytes())
    return buffer.getvalue()


def parse_wav_header(data: bytes) -> dict:
    """Small independent parser used by tests and the smoke to check what the
    API's decodePcm16Wav will see."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    channels = struct.unpack_from("<H", data, 22)[0]
    sample_rate = struct.unpack_from("<I", data, 24)[0]
    bits = struct.unpack_from("<H", data, 34)[0]
    offset = 12
    while offset + 8 <= len(data):
        chunk = data[offset:offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        if chunk == b"data":
            frames = size // (channels * bits // 8)
            return {"channels": channels, "sampleRate": sample_rate, "bits": bits, "frames": frames}
        offset += 8 + size + (size & 1)
    raise ValueError("no data chunk")


def render_track(plugin, track: dict, sample_rate: int, duration_seconds: float) -> RenderOutput:
    if sample_rate not in SUPPORTED_SAMPLE_RATES:
        raise ValueError(f"unsupported sample rate {sample_rate}")
    frames = frames_for(sample_rate, duration_seconds)
    events = build_events(track, duration_seconds)
    messages = to_mido_messages(events)
    audio = plugin(messages, duration=frames / sample_rate, sample_rate=float(sample_rate), num_channels=2, reset=True)
    stereo = _to_stereo(audio, frames)
    # A plugin program driven hot by full-velocity chords will clip at the
    # 16-bit wire boundary. Apply a single deterministic gain to keep 0.5 dB of
    # headroom and report it, rather than ship clipped samples or hide the
    # adjustment. Quiet renders are never boosted.
    raw_peak = float(np.max(np.abs(stereo))) if stereo.size else 0.0
    gain = HEADROOM_PEAK / raw_peak if raw_peak > HEADROOM_PEAK else 1.0
    if gain != 1.0:
        stereo = stereo * np.float32(gain)
    peak = float(np.max(np.abs(stereo))) if stereo.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(stereo.astype(np.float64))))) if stereo.size else 0.0
    per_frame_peak = np.max(np.abs(stereo), axis=0)
    return RenderOutput(
        wav=encode_wav_pcm16(stereo, sample_rate),
        frames=frames,
        sample_rate=sample_rate,
        peak=peak,
        rms_dbfs=(20 * math.log10(rms)) if rms > 0 else -math.inf,
        clipped_samples=int(np.sum(per_frame_peak >= 0.999)),
        active_frame_ratio=float(np.mean(per_frame_peak > 0.0005)) if frames else 0.0,
        event_count=len(events),
        raw_peak=raw_peak,
        gain_db=(20 * math.log10(gain)) if gain != 1.0 else 0.0,
    )


def spectral_centroid_hz(wav: bytes) -> float:
    header = parse_wav_header(wav)
    pcm = np.frombuffer(wav[-header["frames"] * 4:], dtype="<i2").astype(np.float64) / 32768.0
    mono = pcm.reshape(-1, 2).mean(axis=1)
    if mono.size < 1024:
        return 0.0
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(mono.size)))
    freqs = np.fft.rfftfreq(mono.size, 1 / header["sampleRate"])
    total = float(spectrum.sum())
    return float((spectrum * freqs).sum() / total) if total > 0 else 0.0


# --- licensed asset manifest ---------------------------------------------------

REQUIRED_ASSET_FIELDS = ("id", "identity", "path", "sha256", "licenseOwner", "licenseReference", "rendererIdentity", "rendererSha256")


def load_asset_manifest(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def verify_asset_manifest(manifest: dict) -> list[str]:
    """Everything that must hold before a single note is rendered. Returns the
    list of problems; empty means the asset and the host are exactly what the
    manifest says they are."""
    problems: list[str] = []
    asset = manifest.get("vst3") if isinstance(manifest, dict) else None
    if not isinstance(asset, dict):
        return ["manifest has no vst3 asset entry"]
    for field in REQUIRED_ASSET_FIELDS:
        if not isinstance(asset.get(field), str) or not asset[field].strip():
            problems.append(f"asset field {field} is missing")
    if problems:
        return problems
    try:
        binary = resolve_plugin_binary(asset["path"])
    except FileNotFoundError as error:
        return [str(error)]
    actual = sha256_file(binary)
    if actual.lower() != asset["sha256"].lower():
        problems.append(f"plugin binary digest {actual[:12]} does not match manifest {asset['sha256'][:12]}")
    if asset["rendererIdentity"] != renderer_identity():
        problems.append(f"renderer identity {renderer_identity()} does not match manifest {asset['rendererIdentity']}")
    if renderer_sha256().lower() != asset["rendererSha256"].lower():
        problems.append("renderer binary digest does not match manifest")
    preset = asset.get("presetPath")
    if preset and not Path(preset).is_file():
        problems.append(f"preset {preset} is missing")
    return problems


def asset_public_fields(asset: dict) -> dict:
    """What leaves the worker: identity and licence evidence, never paths."""
    return {key: asset[key] for key in ("id", "identity", "sha256", "licenseOwner", "licenseReference", "rendererIdentity", "rendererSha256")}


# Resolved once, at import, before any plugin is loaded: some plugins change
# the process working directory when they initialise (Steinberg's do, via
# Activation Manager), after which a relative path lands somewhere protected.
_STATE_DIR = Path(os.getenv("VST3_RENDER_STATE_DIR", ".local-vst3-assets/state")).resolve()


def default_state_dir() -> Path:
    return _STATE_DIR
