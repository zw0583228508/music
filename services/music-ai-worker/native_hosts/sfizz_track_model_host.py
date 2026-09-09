#!/usr/bin/env python3
"""TrackModel-to-MIDI adapter for the sfizz 1.2.3 native offline renderer."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import host_path, load_request, midi_events, parser, write_attestation
from sfizz_instrument_map import load_instrument_map, resolve_sfz_instrument


def sfz_file(library: Path, track: dict) -> Path:
    """The SFZ the instrument map assigns to this track; refuse anything unmapped.

    The map is the single place that decides which VSCO 2 CE instrument plays
    a platform family. A track that matches no entry raises here, the worker
    reports the reason, and the platform keeps its preview synth for that stem
    instead of hearing a wrong instrument presented as the right one.
    """
    entry = resolve_sfz_instrument(load_instrument_map(), track)
    root = library.resolve()
    candidate = (root / entry["sfz"]).resolve()
    candidate.relative_to(root)
    if not candidate.is_file() or candidate.suffix.lower() != ".sfz":
        raise ValueError(f"mapped instrument {entry['sfz']} is not an SFZ file in the library")
    return candidate


def main() -> None:
    args = parser("sfz").parse_args()
    request, track = load_request(args.track_model)
    if track["automation"]:
        raise ValueError("SFZ automation requires an approved asset-specific CC mapping")
    instrument = sfz_file(args.library, track)
    with tempfile.TemporaryDirectory(prefix="sfizz-host-") as temporary:
        midi_path = Path(temporary) / "input.mid"
        rendered = Path(temporary) / "rendered.wav"
        midi = mido.MidiFile(ticks_per_beat=1000)
        midi_track = mido.MidiTrack()
        midi.tracks.append(midi_track)
        previous = 0
        for message, seconds in midi_events(track):
            tick = round(seconds * 2000)
            midi_track.append(mido.Message.from_bytes(list(message)).copy(time=tick - previous))
            previous = tick
        # sfizz_render stops at the end of the sequence. An explicit End of
        # Track at the requested duration keeps release tails that fall after
        # the last note-off, and `--use-eot` makes that marker the stop point.
        end_tick = max(previous, round(args.duration_seconds * 2000))
        midi_track.append(mido.MetaMessage("end_of_track", time=end_tick - previous))
        midi.save(midi_path)
        subprocess.run([
            os.getenv("SFIZZ_RENDER_BINARY", "sfizz_render"),
            "--sfz", str(instrument),
            "--midi", str(midi_path),
            "--wav", str(rendered),
            "--samplerate", str(args.sample_rate),
            "--use-eot",
        ], check=True, timeout=float(os.getenv("MUSIC_AI_INFERENCE_TIMEOUT_SECONDS", "540")))
        audio, rate = sf.read(rendered, always_2d=True, dtype="float32")
        if rate != args.sample_rate:
            raise ValueError("sfizz returned the wrong sample rate")
        frames = round(args.sample_rate * args.duration_seconds)
        if audio.shape[0] < frames:
            audio = np.pad(audio, ((0, frames - audio.shape[0]), (0, 0)))
        sf.write(args.output, audio[:frames], rate, subtype="PCM_16")
    write_attestation("sfz", args, track, args.library, host_path(__file__))


if __name__ == "__main__":
    main()
