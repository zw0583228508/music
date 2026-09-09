#!/usr/bin/env python3
"""Per-asset operator: an open-licence SFZ library through the worker's own native-asset lifecycle.

Run with the asset root, manifest and sfizz binary in the environment (see
`modal_open_licence_assets.py`). In provisioning mode it

1. builds the committed sfizz TrackModel host (`native_hosts/build_host.py sfz`)
   and approves exactly that checksum for this process
   (`MUSIC_AI_APPROVED_NATIVE_HOSTS`), recording the hash;
2. stages the library subset with `app._stage_asset_candidate` - the function
   behind `POST /admin/assets/stage`: the host is checked against the approved
   registry, everything is hashed below the asset root, and the canonical
   three-render TrackModel smoke must give three distinct audible outputs;
3. activates with `app._activate_asset_candidate` - re-verification and an
   atomic manifest replacement;
4. reads `renderer_health("SFIZZ_VSCO2_CE")`, which must be healthy;
5. renders one short Performance-MIDI phrase per catalogue instrument through
   `app._render_sfizz_track` (the `/render` path, attestation verified by the
   worker) and writes the WAVs beside the asset.

`--attest-only` re-runs step 4 (and optionally one render) against whatever
the asset root holds - used from the Volume mount, so the attestation is of
the stored bytes. The host reads `MUSIC_AI_SFIZZ_INSTRUMENT`, so the
instrument for each render is selected by that variable; nothing here edits
the host.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from open_licence_assets import load_catalogue  # noqa: E402

BEAT = 60 / 96  # 96 BPM
PHRASE_SECONDS = 6.0


class LazyUpload:
    """The two methods `app._write_upload` uses, without holding thousands of files open at once."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.filename = path.name
        self._handle = None

    async def read(self, size: int) -> bytes:
        if self._handle is None:
            self._handle = self.path.open("rb")
        return self._handle.read(size)

    async def close(self) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None


def _fit(pitches: list[int], key_range: list[int]) -> int:
    """Octave shift that puts as many of `pitches` as possible inside `key_range`."""
    best, best_count = 0, -1
    for shift in (0, -12, 12, -24, 24, -36, 36):
        count = sum(1 for p in pitches if key_range[0] <= p + shift <= key_range[1])
        if count > best_count:
            best, best_count = shift, count
    return best


def phrase_notes(family: str, key_range: list[int], drum_keys: dict | None = None) -> list[dict]:
    """A short, deterministic Performance-MIDI phrase: humanised velocities and timing, one audition family each."""
    notes: list[tuple[float, float, int, int]] = []  # (start beats, duration beats, pitch, velocity)

    def add(start: float, duration: float, pitch: int, velocity: int) -> None:
        notes.append((start, duration, pitch, velocity))

    if family == "piano":
        chords = [(48, [52, 55, 60]), (45, [48, 52, 57]), (41, [45, 48, 53]), (43, [47, 50, 55])]
        melody = [72, 74, 76, 79, 76, 74, 72, 69]
        for bar, (root, upper) in enumerate(chords):
            at = bar * 2
            add(at, 1.9, root, 78)
            for i, p in enumerate(upper):
                add(at + 0.5 * i + 0.01 * i, 1.5 - 0.5 * i, p, 62 + 6 * i)
            add(at + 0.02, 0.95, melody[2 * bar], 96)
            add(at + 1.0 + 0.015, 0.95, melody[2 * bar + 1], 84)
    elif family == "strings":
        line = [(0, 1.5, 62, 70), (1.5, 0.5, 64, 74), (2, 2, 66, 88), (4, 1, 69, 92), (5, 1, 67, 80), (6, 2, 62, 76)]
        for start, dur, p, v in line:
            add(start, dur - 0.05, p, v)
    elif family == "world":
        # Hijaz on D (D Eb F# G A Bb C D) with grace-note ornaments - the owner's idiom.
        hijaz = [62, 63, 66, 67, 69, 70, 72, 74]
        line = [(0, 0.5, 62, 92), (0.5, 0.5, 63, 80), (1, 1, 66, 96), (2, 0.25, 67, 78), (2.25, 0.75, 66, 84),
                (3, 0.5, 63, 82), (3.5, 0.5, 62, 90), (4, 0.5, 69, 96), (4.5, 0.5, 67, 84), (5, 0.5, 66, 88),
                (5.5, 0.5, 63, 80), (6, 1.5, 62, 94)]
        for start, dur, p, v in line:
            add(start, dur - 0.04, p, v)
        add(0.9, 0.1, 67, 60)  # grace before the F#
        add(3.9, 0.1, 70, 58)  # grace before the A
        del hijaz
    elif family == "bass":
        pattern = [(36, 96), (36, 70), (43, 84), (36, 74), (41, 92), (41, 66), (43, 88), (45, 78),
                   (43, 94), (43, 70), (40, 84), (43, 72), (36, 96), (36, 68), (43, 86), (47, 80)]
        for i, (p, v) in enumerate(pattern):
            add(i * 0.5 + (0.012 if i % 2 else 0), 0.42, p, v)
    elif family == "guitar":
        chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 52, 55, 60, 64], [43, 47, 50, 55, 59]]
        for bar, chord in enumerate(chords):
            at = bar * 2
            for strum, (offset, down) in enumerate([(0, True), (1.0, True), (1.5, False)]):
                order = chord if down else list(reversed(chord))
                for i, p in enumerate(order):
                    add(at + offset + 0.02 * i, (0.9 if strum < 2 else 0.45) - 0.02 * i, p, (86 if strum == 0 else 72) - 4 * i)
    elif family == "drums":
        keys = {"kick": 36, "snare": 38, "hatClosed": 42, "hatOpen": 46, "crash": 49, "tomLow": 45, "tomHigh": 48, **(drum_keys or {})}
        add(0, 0.5, keys["crash"], 100)
        for bar in range(2):
            at = bar * 2
            add(at, 0.2, keys["kick"], 112)
            add(at + 0.75, 0.2, keys["kick"], 92)
            add(at + 1.0, 0.2, keys["snare"], 108)
            add(at + 1.5, 0.2, keys["kick"], 84)
            add(at + 1.75, 0.2, keys["snare"], 56)
            for i in range(4):
                add(at + 0.5 * i + (0.008 if i % 2 else 0), 0.15, keys["hatClosed"], 78 if i % 2 == 0 else 58)
        add(3.5, 0.5, keys["hatOpen"], 88)
        add(3.0, 0.2, keys["tomHigh"], 96)
        add(3.25, 0.2, keys["tomLow"], 100)
    else:
        raise ValueError(f"unknown audition family {family}")
    if family != "drums":
        shift = _fit([p for _, _, p, _ in notes], key_range)
        notes = [(s, d, p + shift, v) for s, d, p, v in notes]
    out = []
    for index, (start, duration, pitch, velocity) in enumerate(notes):
        if not 0 <= pitch <= 127:
            continue
        out.append({"id": f"{family}-{index}", "start": round(start * BEAT + 0.05, 4), "duration": round(max(0.05, duration * BEAT), 4), "pitch": int(pitch), "velocity": int(max(1, min(127, velocity))), "voice": "lead"})
    return out


def phrase_track(asset: dict, instrument: dict) -> dict:
    """A canonical TrackModel of the phrase; the family fields keep the platform's shape."""
    family = instrument["auditionFamily"]
    notes = phrase_notes(family, instrument["keyRange"], instrument.get("drumKeys"))
    end = max(n["start"] + n["duration"] for n in notes)
    duration = min(PHRASE_SECONDS, round(end + 1.2, 2))
    cc = [{"controller": 11, "time": 0, "value": 100}]
    if family == "strings":
        cc += [{"controller": 11, "time": round(t * BEAT, 3), "value": v} for t, v in ((1, 70), (2, 95), (3, 110), (4, 100), (5, 85), (6, 96))]
    if family == "piano":
        cc += [{"controller": 64, "time": 0.0, "value": 127}, {"controller": 64, "time": round(2 * BEAT - 0.02, 3), "value": 0}, {"controller": 64, "time": round(2 * BEAT, 3), "value": 127}]
    # The host ends its MIDI at the last event; a final controller event at the
    # requested duration keeps sfizz rendering through the release tails.
    cc.append({"controller": 11, "time": round(duration - 0.02, 3), "value": 100})
    return {
        "id": f"open-licence-{asset['assetId']}-{family}",
        "instrument": instrument["instrument"],
        "role": "lead",
        "instrumentDefinition": {"id": instrument["family"], "family": instrument["family"]},
        "notes": notes,
        "cc": cc,
        "articulations": [],
        "automation": [],
    }, duration


def phrase_midi_bytes(family: str, *, program: int = 0, bank: int = 0, channel: int = 0, key_range: list[int] | None = None) -> bytes:
    """The same phrase as a Standard MIDI File (for the FluidSynth SoundFont audition)."""
    import mido

    notes = phrase_notes(family, key_range or [0, 127])
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(96), time=0))
    track.append(mido.Message("control_change", channel=channel, control=0, value=bank & 0x7F, time=0))
    track.append(mido.Message("program_change", channel=channel, program=program & 0x7F, time=0))
    events = []
    for note in notes:
        events.append((note["start"], 1, mido.Message("note_on", channel=channel, note=note["pitch"], velocity=note["velocity"])))
        events.append((note["start"] + note["duration"], 0, mido.Message("note_off", channel=channel, note=note["pitch"], velocity=0)))
    events.sort(key=lambda e: (e[0], e[1]))
    previous = 0
    for seconds, _, message in events:
        tick = round(seconds / BEAT * 480)
        track.append(message.copy(time=tick - previous))
        previous = tick
    end_tick = round(PHRASE_SECONDS / BEAT * 480)
    track.append(mido.MetaMessage("end_of_track", time=max(0, end_tick - previous)))
    import io

    buffer = io.BytesIO()
    midi.save(file=buffer)
    return buffer.getvalue()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def build_host(asset_root: Path) -> tuple[Path, str]:
    host = asset_root / "bin" / "sfizz-track-model-host"
    subprocess.run([sys.executable, str(HERE / "native_hosts" / "build_host.py"), "sfz", str(host)], check=True)
    return host, sha256_file(host)


async def stage(app, asset: dict, source: Path, host: Path, host_identity: str, licence: dict) -> dict:
    files = sorted(p for p in source.rglob("*") if p.is_file())
    uploads = [LazyUpload(p) for p in files]
    relative = [str(p.relative_to(source)).replace("\\", "/") for p in files]
    licence_reference = f"{asset['licence']['spdx']}: {asset['licence']['file']} sha256 {licence['sha256']} in {asset['source'].get('repository') or asset['source'].get('url')}@{asset['source'].get('commit') or asset['source'].get('sha256', '?')}"
    return await app._stage_asset_candidate(
        "sfz", asset["assetId"], asset["identity"], asset["licenseOwner"], licence_reference[:500], host_identity,
        uploads, LazyUpload(host), relative,
    )


def preflight(asset: dict, source: Path, host: Path, host_identity: str) -> dict:
    """Run sfizz_render and the built host once, directly, with their stderr kept.

    The worker's own render path (`_render_native_track`) deliberately hides
    a failing host's words behind a 503; this step runs the same command
    line first so a library that sfizz cannot load, or a host that cannot
    start, is diagnosed in the evidence instead of guessed at.
    """
    import tempfile

    import app

    track = app._canonical_track_model(app.canonical_render_smoke_track())
    out: dict = {"instrument": asset["smokeInstrument"]}
    with tempfile.TemporaryDirectory(prefix="preflight-") as temporary:
        tmp = Path(temporary)
        midi = tmp / "smoke.mid"
        midi.write_bytes(phrase_midi_bytes("piano", key_range=[48, 72]))
        wav = tmp / "direct.wav"
        started = time.monotonic()
        direct = subprocess.run(
            [os.environ["SFIZZ_RENDER_BINARY"], "--sfz", str(source / asset["smokeInstrument"]), "--midi", str(midi), "--wav", str(wav), "--samplerate", "22050"],
            capture_output=True, text=True, timeout=600,
        )
        out["sfizzRender"] = {"exit": direct.returncode, "ms": round((time.monotonic() - started) * 1000), "wavBytes": wav.stat().st_size if wav.is_file() else 0, "stderrTail": direct.stderr[-1500:], "stdoutTail": direct.stdout[-800:]}
        request = tmp / "track-model.json"
        output = tmp / "render.wav"
        attestation = tmp / "attestation.json"
        request.write_text(json.dumps({"trackModel": track, "sampleRate": 22050, "durationSeconds": 1.0, "assetPath": str(source), "outputPath": str(output)}, sort_keys=True, separators=(",", ":")))
        started = time.monotonic()
        hosted = subprocess.run(
            [str(host), "--track-model", str(request), "--sample-rate", "22050", "--duration-seconds", "1.0", "--output", str(output), "--attestation", str(attestation), "--asset-identity", asset["identity"], "--library", str(source)],
            capture_output=True, text=True, timeout=600,
        )
        out["host"] = {"exit": hosted.returncode, "ms": round((time.monotonic() - started) * 1000), "wavBytes": output.stat().st_size if output.is_file() else 0, "attested": attestation.is_file(), "stderrTail": hosted.stderr[-2500:], "stdoutTail": hosted.stdout[-800:]}
        if output.is_file():
            import soundfile as sf

            audio, _rate = sf.read(output, always_2d=True, dtype="float32")
            out["host"]["peak"] = round(float(abs(audio).max()), 6) if audio.size else 0.0
    return out


def public_health(health: dict) -> dict:
    return {k: v for k, v in health.items() if k not in {"smokeEvidence"}} | {"smokeEvidence": {k: health["smokeEvidence"][k] for k in ("outputSha256", "pitchVariantSha256", "expressionVariantSha256", "peak", "canonicalSensitivity", "audible") if isinstance(health.get("smokeEvidence"), dict) and k in health["smokeEvidence"]}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--catalogue", type=Path, default=HERE / "open_licence_assets.json")
    parser.add_argument("--source", type=Path, help="the library subset to stage (provisioning mode)")
    parser.add_argument("--host-identity", default="music-ai-worker sfizz TrackModel host / main (PR-93 open-licence assets)")
    parser.add_argument("--renders", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--attest-only", action="store_true")
    parser.add_argument("--render-check", action="store_true")
    args = parser.parse_args()

    import resource  # POSIX only; the phrase helpers above stay importable on the Windows checkout for the tests

    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (min(hard, 65536), hard))
    asset_root = Path(os.environ["MUSIC_AI_ASSET_ROOT"]).resolve()
    catalogue = load_catalogue(args.catalogue)
    asset = next(a for a in catalogue["assets"] if a["assetId"] == args.asset_id)
    by_sfz = {i["sfz"]: i for i in asset["instruments"]}
    os.environ["MUSIC_AI_SFIZZ_INSTRUMENT"] = asset["smokeInstrument"]

    if args.attest_only:
        import app

        started = time.monotonic()
        health = app.renderer_health("SFIZZ_VSCO2_CE")
        result = {"assetId": args.asset_id, "healthy": bool(health.get("healthy")), "health": public_health(health) if health.get("healthy") else health, "healthMs": round((time.monotonic() - started) * 1000)}
        if args.render_check and health.get("healthy"):
            instrument = by_sfz[asset["smokeInstrument"]]
            track, duration = phrase_track(asset, instrument)
            track = app._canonical_track_model(track)
            started = time.monotonic()
            audio, rendered = app._render_sfizz_track(track, 22050, min(duration, 3.0))
            result["renderCheck"] = {"sfz": instrument["sfz"], "ms": round((time.monotonic() - started) * 1000), "peak": round(float(abs(audio).max()), 6), "outputSha256": hashlib.sha256(audio.tobytes()).hexdigest(), "assetSha256": rendered["sha256"]}
        print(json.dumps(result, sort_keys=True))
        return

    record: dict = {"assetId": args.asset_id, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    licence_dir = asset_root / "licence"
    licence_file = licence_dir / Path(asset["licence"]["file"]).name
    if not licence_file.is_file():
        raise SystemExit("refusing to stage: the captured licence text is not beside the asset root")
    licence = {"sha256": sha256_file(licence_file), "file": asset["licence"]["file"]}

    started = time.monotonic()
    host, host_sha256 = build_host(asset_root)
    os.environ["MUSIC_AI_APPROVED_NATIVE_HOSTS"] = json.dumps([{"kind": "sfz", "identity": args.host_identity, "sha256": host_sha256}], separators=(",", ":"))
    record["host"] = {"identity": args.host_identity, "sha256": host_sha256, "builtBy": "native_hosts/build_host.py sfz (main)", "seconds": round(time.monotonic() - started, 1), "sfizzRenderSha256": sha256_file(Path(os.environ["SFIZZ_RENDER_BINARY"]))}

    import app

    def write_evidence() -> None:
        if args.evidence:
            args.evidence.parent.mkdir(parents=True, exist_ok=True)
            args.evidence.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")

    try:
        record["preflight"] = preflight(asset, args.source, host, args.host_identity)
    except Exception as exc:  # noqa: BLE001 - the preflight is diagnosis, never the gate
        record["preflight"] = {"error": str(exc)[:800]}
    write_evidence()
    if record["preflight"].get("host", {}).get("exit") not in (None, 0):
        raise SystemExit(f"preflight: the native host failed on {asset['smokeInstrument']}: {record['preflight']['host'].get('stderrTail', '')[-600:]}")

    started = time.monotonic()
    try:
        candidate = asyncio.run(stage(app, asset, args.source, host, args.host_identity, licence))
    except Exception as exc:  # noqa: BLE001
        record["stage"] = {"seconds": round(time.monotonic() - started, 1), "error": str(getattr(exc, "detail", exc))[:800]}
        write_evidence()
        raise
    record["stage"] = {"seconds": round(time.monotonic() - started, 1), "candidate": {k: v for k, v in candidate.items() if k != "smokeEvidence"}, "smoke": {k: candidate["smokeEvidence"].get(k) for k in ("outputSha256", "pitchVariantSha256", "expressionVariantSha256", "peak", "canonicalSensitivity", "audible", "sampleRate", "durationSeconds")}}
    write_evidence()
    started = time.monotonic()
    active = app._activate_asset_candidate(candidate["candidateId"])
    record["activate"] = {"seconds": round(time.monotonic() - started, 1), "status": active.get("status"), "activatedAt": active.get("activatedAt"), "assetId": active.get("assetId"), "sha256": active.get("sha256")}
    health = app.renderer_health("SFIZZ_VSCO2_CE")
    record["health"] = public_health(health) if health.get("healthy") else health
    write_evidence()
    if not health.get("healthy"):
        raise SystemExit(f"health is not healthy after activation: {health.get('reason')}")

    import soundfile as sf

    renders: dict = {}
    args.renders.mkdir(parents=True, exist_ok=True)
    for instrument in asset["instruments"]:
        os.environ["MUSIC_AI_SFIZZ_INSTRUMENT"] = instrument["sfz"]
        track, duration = phrase_track(asset, instrument)
        track = app._canonical_track_model(track)
        started = time.monotonic()
        entry = {"instrument": instrument["instrument"], "family": instrument["family"], "auditionFamily": instrument["auditionFamily"], "notes": len(track["notes"]), "durationSeconds": duration, "sampleRate": 44100}
        try:
            audio, rendered = app._render_sfizz_track(track, 44100, duration)
            entry["renderMs"] = round((time.monotonic() - started) * 1000)
            peak = float(abs(audio).max())
            wav = args.renders / f"{instrument['auditionFamily']}--{Path(instrument['sfz']).stem.replace(' ', '_')}.wav"
            sf.write(wav, audio.T, 44100, subtype="PCM_16")
            entry.update({"audible": peak >= 0.0005, "peak": round(peak, 6), "outputSha256": hashlib.sha256(audio.tobytes()).hexdigest(), "wav": wav.name, "wavSha256": sha256_file(wav), "wavBytes": wav.stat().st_size, "assetSha256": rendered["sha256"], "channels": int(audio.shape[0])})
        except Exception as exc:  # noqa: BLE001 - one instrument's failure is evidence, not a stop
            entry.update({"audible": False, "renderMs": round((time.monotonic() - started) * 1000), "error": str(getattr(exc, "detail", exc))[:500]})
        renders[instrument["sfz"]] = entry
    record["renders"] = renders
    record["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_evidence()
    print(json.dumps({"assetId": args.asset_id, "healthy": True, "sha256": active.get("sha256"), "renders": {k: v.get("audible") for k, v in renders.items()}}))


if __name__ == "__main__":
    main()
