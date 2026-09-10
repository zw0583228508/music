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
import re
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


_MULTI_PLUGIN_RE = re.compile(r'contains \d+ plugins.*?following values:\s*(.*)', re.S)


def plugin_names_in_error(message: str) -> list[str]:
    """pedalboard refuses a binary that exports several plugins (sfizz ships
    `sfizz` and `sfizz-multi` in one file) and lists their names in the
    error. Parse them so a caller can pick one without guessing."""
    match = _MULTI_PLUGIN_RE.search(message)
    if not match:
        return []
    return re.findall(r'"([^"]+)"', match.group(1))


def _load_plugin_binary(binary: Path, plugin_name: str | None):
    from pedalboard import load_plugin

    if plugin_name:
        return load_plugin(str(binary), plugin_name=plugin_name)
    try:
        return load_plugin(str(binary))
    except ValueError as error:
        names = plugin_names_in_error(str(error))
        if not names:
            raise
        # A multi-plugin binary with no name chosen: the first exported plugin
        # is the vendor's primary one (sfizz before sfizz-multi).
        return load_plugin(str(binary), plugin_name=names[0])


def load_instrument(
    path: str | Path,
    preset_path: str | Path | None = None,
    plugin_name: str | None = None,
    sfz_path: str | Path | None = None,
):
    """Load a VST3 instrument; returns (plugin, PluginIdentity). Raises if the
    plugin is not an instrument -- an effect cannot realize a TrackModel.

    `plugin_name` selects one plugin from a binary that exports several;
    `sfz_path` hands an SFZ instrument to a sampler (sfizz) through its
    component state, since a sampler has no file parameter to automate."""
    binary = resolve_plugin_binary(path)
    plugin = _load_plugin_binary(binary, plugin_name)
    if not getattr(plugin, "is_instrument", False):
        raise ValueError(f"{binary.name} is not an instrument (category {getattr(plugin, 'category', '?')})")
    if preset_path:
        plugin.load_preset(str(preset_path))
    if sfz_path:
        load_sfz(plugin, sfz_path)
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


def load_asset_instrument(asset: dict):
    """Load exactly what a manifest asset describes: the binary, one plugin of
    a multi-plugin binary (`pluginName`), a `.vstpreset` (`presetPath`) and,
    for a sampler, the SFZ instrument (`sfzPath`). One asset per library: the
    same sfizz binary attested once per SFZ file, each with its own smoke."""
    return load_instrument(
        asset["path"],
        asset.get("presetPath"),
        plugin_name=asset.get("pluginName"),
        sfz_path=asset.get("sfzPath"),
    )


# --- SFZ instruments through the sampler's component state -----------------------
#
# sfizz (and Decent Sampler) load their instrument from a file path kept in the
# VST3 component state; there is no parameter to set and pedalboard exposes no
# file-open message. pedalboard's `raw_state` is JUCE's getStateInformation():
# 'VC2!' + little-endian length + '<VST3PluginState><IComponent>N.base64</IComponent>...'
# where the base64 is JUCE's own alphabet, LSB-first. sfizz's component state
# (plugins/vst/SfizzVstState.cpp, version 5) starts with the uint64 version and
# then the SFZ path as an int32-length-prefixed NUL-terminated string; the rest
# (volume, voices, tuning, controllers) is left exactly as the plugin wrote it.

_JUCE_B64 = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+"
_JUCE_MAGIC = b"VC2!"


def juce_base64_decode(text: str) -> bytes:
    size_text, dot, payload = text.partition(".")
    if not dot or not size_text.isdigit():
        raise ValueError("not a JUCE base64 block (expected '<size>.<data>')")
    size = int(size_text)
    out = bytearray(size)
    total_bits = size * 8
    for index, char in enumerate(payload):
        value = _JUCE_B64.index(char)
        for bit in range(6):
            k = index * 6 + bit
            if k >= total_bits:
                break
            if (value >> bit) & 1:
                out[k >> 3] |= 1 << (k & 7)
    return bytes(out)


def juce_base64_encode(data: bytes) -> str:
    size = len(data)
    total_bits = size * 8
    chars = []
    for index in range(((size << 3) + 5) // 6):
        value = 0
        for bit in range(6):
            k = index * 6 + bit
            if k < total_bits and (data[k >> 3] >> (k & 7)) & 1:
                value |= 1 << bit
        chars.append(_JUCE_B64[value])
    return f"{size}." + "".join(chars)


def unwrap_component_state(raw: bytes) -> tuple[str, bytes]:
    """JUCE state blob -> (xml text, decoded IComponent bytes)."""
    if raw[:4] != _JUCE_MAGIC or len(raw) < 8:
        raise ValueError("plugin state is not a JUCE VST3PluginState block")
    (length,) = struct.unpack_from("<I", raw, 4)
    xml = raw[8:8 + length].rstrip(b"\0").decode("utf-8")
    match = re.search(r"<IComponent>([^<]*)</IComponent>", xml)
    if not match:
        raise ValueError("plugin state carries no IComponent chunk")
    return xml, juce_base64_decode(match.group(1))


def wrap_component_state(xml: str, component: bytes) -> bytes:
    new_xml = re.sub(r"<IComponent>[^<]*</IComponent>", f"<IComponent>{juce_base64_encode(component)}</IComponent>", xml, count=1)
    body = new_xml.encode("utf-8") + b"\0"
    return _JUCE_MAGIC + struct.pack("<I", len(body)) + body


def sfizz_state_sfz_path(component: bytes) -> str:
    """The SFZ path an sfizz component state names ('' when none)."""
    if len(component) < 13:
        raise ValueError("sfizz component state is too short")
    (length,) = struct.unpack_from("<i", component, 8)
    if length < 1 or 12 + length > len(component):
        raise ValueError("sfizz component state has a malformed path string")
    return component[12:12 + length - 1].decode("utf-8")


def sfizz_state_with_sfz(component: bytes, sfz_path: str | Path) -> bytes:
    """Replace the SFZ path in an sfizz component state, keeping everything
    else byte-for-byte (state version first, then the path)."""
    (length,) = struct.unpack_from("<i", component, 8)
    sfizz_state_sfz_path(component)  # validates the layout
    encoded = str(sfz_path).replace("\\", "/").encode("utf-8")
    return component[:8] + struct.pack("<i", len(encoded) + 1) + encoded + b"\0" + component[12 + length:]


_SFZ_INCLUDE_RE = re.compile(r'#include\s+"([^"]+)"')
_SFZ_DEFINE_RE = re.compile(r'#define\s+(\$[A-Za-z0-9_]+)\s+(\S+)')
_SFZ_SET_CC_RE = re.compile(r'\bset_(hdcc|realcc|cc)(\d+)=(-?[0-9]*\.?[0-9]+)')
SFZ_MAX_INCLUDED_FILES = 4000


def sfz_control_defaults(sfz_path: str | Path) -> dict[int, float]:
    """The `set_ccN` / `set_hdccN` defaults an SFZ instrument declares, as
    normalised 0..1 values, following `#include` and expanding `#define`
    macros (Karoryfer and DrumGizmo kits put their mic and macro levels behind
    `set_cc$vol_kd=$default_level`).

    Why this exists: many libraries route every region's amplitude through a
    CC (`amplitude_oncc7=100`, `locc$mic=1`) and rely on the file's `set_cc`
    to make it audible. pedalboard exposes those CCs as parameters
    (`controller_N`) and re-applies its cached values after every reset, which
    silently overrides what the file set; the defaults must therefore be
    applied as parameters too (see `load_sfz`)."""
    defaults: dict[int, float] = {}
    macros: dict[str, str] = {}
    visited: set[Path] = set()

    def expand(line: str) -> str:
        if "$" not in line:
            return line
        for name in sorted(macros, key=len, reverse=True):
            if name in line:
                line = line.replace(name, macros[name])
        return line

    def walk(path: Path, depth: int) -> None:
        resolved = path.resolve()
        if resolved in visited or depth > 12 or len(visited) >= SFZ_MAX_INCLUDED_FILES or not resolved.is_file():
            return
        visited.add(resolved)
        text = resolved.read_text(encoding="utf-8", errors="replace")
        for raw in text.splitlines():
            line = raw.split("//", 1)[0]
            if not line.strip():
                continue
            for name, value in _SFZ_DEFINE_RE.findall(line):
                macros[name] = value
            if "set_" not in line and "#include" not in line:
                continue
            line = expand(line)
            for kind, number, value in _SFZ_SET_CC_RE.findall(line):
                cc = int(number)
                level = float(value)
                normalised = level if kind in ("hdcc", "realcc") else level / 127.0
                defaults[cc] = min(1.0, max(0.0, normalised))
            for include in _SFZ_INCLUDE_RE.findall(line):
                walk(resolved.parent / include.replace("\\", "/"), depth + 1)

    walk(Path(sfz_path), 0)
    return defaults


def apply_control_defaults(plugin, defaults: dict[int, float]) -> dict[int, float]:
    """Set the sampler's `controller_N` parameters to the file's defaults.
    Returns what was applied (CCs the plugin does not expose are skipped)."""
    applied: dict[int, float] = {}
    for cc, value in sorted(defaults.items()):
        name = f"controller_{cc}"
        if name in getattr(plugin, "parameters", {}) or hasattr(plugin, name):
            setattr(plugin, name, value)
            applied[cc] = value
    return applied


def load_sfz(plugin, sfz_path: str | Path) -> str:
    """Point a loaded sfizz instance at an SFZ file through its state, confirm
    the plugin now names that file, and apply the file's CC defaults as
    parameters. sfizz loads the file synchronously in freewheeling (offline)
    mode, which is how pedalboard renders."""
    target = Path(sfz_path)
    if not target.is_file():
        raise FileNotFoundError(f"SFZ instrument {target} is missing")
    xml, component = unwrap_component_state(bytes(plugin.raw_state))
    plugin.raw_state = wrap_component_state(xml, sfizz_state_with_sfz(component, target))
    _, after = unwrap_component_state(bytes(plugin.raw_state))
    loaded = sfizz_state_sfz_path(after)
    if Path(loaded) != Path(str(target).replace("\\", "/")):
        raise RuntimeError(f"sampler did not take the SFZ path (state names {loaded!r})")
    apply_control_defaults(plugin, sfz_control_defaults(target))
    return loaded


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


def list_assets(manifest: dict) -> list[dict]:
    """All assets in a manifest, default first, de-duplicated by id.

    Manifest v1 has a single `vst3` entry. v2 keeps it as the default and adds
    `assets: [...]` so one worker can offer drums, pads and synths and let the
    API route each track (PR-22). The default is what /health reports as
    `asset` for callers that never ask for a specific one.
    """
    if not isinstance(manifest, dict):
        return []
    ordered: list[dict] = []
    seen: set[str] = set()
    default = manifest.get("vst3")
    extra = manifest.get("assets") if isinstance(manifest.get("assets"), list) else []
    for asset in [default, *extra]:
        if isinstance(asset, dict) and isinstance(asset.get("id"), str) and asset["id"] not in seen:
            seen.add(asset["id"])
            ordered.append(asset)
    return ordered


def default_asset(manifest: dict) -> dict | None:
    assets = list_assets(manifest)
    return assets[0] if assets else None


def find_asset(manifest: dict, asset_id: str | None) -> dict | None:
    assets = list_assets(manifest)
    if asset_id is None:
        return assets[0] if assets else None
    return next((asset for asset in assets if asset["id"] == asset_id), None)


def verify_one_asset(asset: dict) -> list[str]:
    problems: list[str] = []
    label = asset.get("id") if isinstance(asset.get("id"), str) else "<unnamed>"
    for field in REQUIRED_ASSET_FIELDS:
        if not isinstance(asset.get(field), str) or not asset[field].strip():
            problems.append(f"asset {label}: field {field} is missing")
    if problems:
        return problems
    try:
        binary = resolve_plugin_binary(asset["path"])
    except FileNotFoundError as error:
        return [f"asset {label}: {error}"]
    actual = sha256_file(binary)
    if actual.lower() != asset["sha256"].lower():
        problems.append(f"asset {label}: plugin binary digest {actual[:12]} does not match manifest {asset['sha256'][:12]}")
    if asset["rendererIdentity"] != renderer_identity():
        problems.append(f"asset {label}: renderer identity {renderer_identity()} does not match manifest {asset['rendererIdentity']}")
    if renderer_sha256().lower() != asset["rendererSha256"].lower():
        problems.append(f"asset {label}: renderer binary digest does not match manifest")
    preset = asset.get("presetPath")
    if preset and not Path(preset).is_file():
        problems.append(f"asset {label}: preset {preset} is missing")
    sfz = asset.get("sfzPath")
    if sfz and not Path(sfz).is_file():
        problems.append(f"asset {label}: SFZ instrument {sfz} is missing")
    elif sfz and asset.get("sfzSha256"):
        actual_sfz = sha256_file(Path(sfz))
        if actual_sfz.lower() != asset["sfzSha256"].lower():
            problems.append(f"asset {label}: SFZ file digest {actual_sfz[:12]} does not match manifest {asset['sfzSha256'][:12]}")
    return problems


def verify_asset_manifest(manifest: dict) -> list[str]:
    """Everything that must hold before a single note is rendered. Returns the
    list of problems; empty means every asset and the host are exactly what
    the manifest says they are."""
    assets = list_assets(manifest)
    if not assets:
        return ["manifest has no vst3 asset entry"]
    problems: list[str] = []
    for asset in assets:
        problems.extend(verify_one_asset(asset))
    return problems


def asset_public_fields(asset: dict) -> dict:
    """What leaves the worker: identity and licence evidence, never paths.
    Routing hints (`families`, `roles`) and the operator's `character` words
    are informational; the routing and sound-selection decisions are the
    API's."""
    public = {key: asset[key] for key in ("id", "identity", "sha256", "licenseOwner", "licenseReference", "rendererIdentity", "rendererSha256")}
    for hint in ("name", "manufacturer", "families", "roles", "character", "library", "sfzSha256"):
        if hint in asset:
            public[hint] = asset[hint]
    return public


# Resolved once, at import, before any plugin is loaded: some plugins change
# the process working directory when they initialise (Steinberg's do, via
# Activation Manager), after which a relative path lands somewhere protected.
_STATE_DIR = Path(os.getenv("VST3_RENDER_STATE_DIR", ".local-vst3-assets/state")).resolve()


def default_state_dir() -> Path:
    return _STATE_DIR
