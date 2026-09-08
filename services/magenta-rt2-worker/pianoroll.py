"""Symbolic arrangement -> Magenta RT2 conditioning.

This is the bridge that keeps the platform's own brain in charge. The arrangement
is already composed, critiqued, repaired and performed by the symbolic pipeline;
RT2's only job is to realize it as audio. So every frame we hand it states the
notes we decided on, and RT2 is never asked to invent structure or harmony.

The encoding below is the model's own contract, taken from magenta_rt/config.py
at the pinned source revision (PIANOROLL_WITH_ONSETS / DRUM_PIANOROLL):

    notes  128 ints per frame, one per MIDI pitch:
             -1 masked (we assert nothing about this pitch)
              0 off
              1 on, sustained
              2 on, onset
              3 on, model chooses onset or sustain
    drums    1 int per frame: -1 masked, 0 no drum, 1 play drum

Both are sampled at 25 Hz, which is the codec frame rate: 25 frames = 1 second.

Pure Python and stdlib only, so it is testable without a GPU, without JAX, and
without the weights.
"""
from __future__ import annotations

from dataclasses import dataclass

FRAME_RATE_HZ = 25.0
PITCH_COUNT = 128
MASKED = -1
OFF = 0
SUSTAIN = 1
ONSET = 2
FREE = 3


@dataclass(frozen=True)
class Note:
    """One symbolic note. Times are seconds from the start of the render."""

    pitch: int
    start: float
    end: float

    def __post_init__(self) -> None:
        if not 0 <= self.pitch < PITCH_COUNT:
            raise ValueError(f"pitch {self.pitch} is outside MIDI range 0-127")
        if not self.end > self.start:
            raise ValueError(f"note at pitch {self.pitch} has non-positive duration")


def frame_count(duration_seconds: float, frame_rate_hz: float = FRAME_RATE_HZ) -> int:
    """Frames needed to cover a duration. Always at least one."""
    if duration_seconds <= 0:
        raise ValueError("duration must be positive")
    return max(1, round(duration_seconds * frame_rate_hz))


def notes_to_pianoroll(
    notes: list[Note],
    frames: int,
    *,
    frame_rate_hz: float = FRAME_RATE_HZ,
    start_seconds: float = 0.0,
    free_articulation: bool = False,
    masked_pitches: set[int] | None = None,
) -> list[list[int]]:
    """Encode notes as one 128-int vector per frame.

    Args:
      notes: the arrangement's notes, in seconds.
      frames: how many 25 Hz frames to emit.
      start_seconds: where in the arrangement this window begins, so long songs
        can be realized in streamed chunks without re-encoding from zero.
      free_articulation: emit 3 ("model's choice") instead of an explicit
        2/1 onset-sustain split. Use when we want RT2's phrasing rather than
        the Performance Engine's; off by default, because the whole point of
        this platform is that the performance decisions are ours.
      masked_pitches: pitches we deliberately assert nothing about. Everything
        not sounding and not masked is an explicit 0 (off) — silence we chose,
        not silence we forgot to specify.

    Unspecified pitches default to 0 rather than -1. That is deliberate: a
    masked pitch invites the model to add notes, and an arrangement that has
    passed the critic should not be quietly embellished.
    """
    if frames <= 0:
        raise ValueError("frames must be positive")
    masked = masked_pitches or set()
    for pitch in masked:
        if not 0 <= pitch < PITCH_COUNT:
            raise ValueError(f"masked pitch {pitch} is outside MIDI range 0-127")

    base_row = [MASKED if p in masked else OFF for p in range(PITCH_COUNT)]
    roll = [list(base_row) for _ in range(frames)]

    frame_seconds = 1.0 / frame_rate_hz
    on_value = FREE if free_articulation else SUSTAIN
    onset_value = FREE if free_articulation else ONSET

    for note in notes:
        if note.pitch in masked:
            continue
        # Frames whose start time falls inside [note.start, note.end).
        first = _ceil_frame(note.start - start_seconds, frame_seconds)
        last = _ceil_frame(note.end - start_seconds, frame_seconds) - 1
        if last < 0 or first >= frames:
            continue
        # A note shorter than one frame still gets the frame it begins in, so
        # grace notes and fast hi-hat figures do not silently vanish.
        if last < first:
            last = first
        first = max(0, first)
        last = min(frames - 1, last)
        for index in range(first, last + 1):
            row = roll[index]
            is_onset = index == first and note.start >= start_seconds - 1e-9
            if is_onset:
                row[note.pitch] = onset_value
            elif row[note.pitch] not in (ONSET, FREE):
                # Do not downgrade an onset another voice already placed here.
                row[note.pitch] = on_value
    return roll


def drums_to_track(
    onsets: list[float],
    frames: int,
    *,
    frame_rate_hz: float = FRAME_RATE_HZ,
    start_seconds: float = 0.0,
    masked: bool = False,
) -> list[int]:
    """Encode drum onsets as one int per frame.

    RT2 takes a single drum channel, not a kit, so this says *when* the kit
    speaks and leaves *what* it plays to the model — which is the one place the
    model genuinely knows more than our reference drum programmer.
    """
    if frames <= 0:
        raise ValueError("frames must be positive")
    if masked:
        return [MASKED] * frames
    track = [OFF] * frames
    frame_seconds = 1.0 / frame_rate_hz
    for onset in onsets:
        index = int((onset - start_seconds) / frame_seconds + 1e-9)
        if 0 <= index < frames:
            track[index] = 1
    return track


def _ceil_frame(seconds: float, frame_seconds: float) -> int:
    """Index of the first frame at or after `seconds`, tolerant of float noise."""
    raw = seconds / frame_seconds
    rounded = round(raw)
    if abs(raw - rounded) < 1e-6:
        return int(rounded)
    return int(raw) + 1 if raw > 0 else int(raw)


def describe_roll(roll: list[list[int]]) -> dict:
    """Summary used in smoke proofs and attestations.

    Reports what was actually asked of the model, so a realization can be
    audited against the arrangement it claims to realize.
    """
    onsets = sum(row.count(ONSET) + row.count(FREE) for row in roll)
    sounding = sum(
        1 for row in roll for value in row if value in (SUSTAIN, ONSET, FREE)
    )
    pitches = sorted(
        {
            pitch
            for row in roll
            for pitch, value in enumerate(row)
            if value in (SUSTAIN, ONSET, FREE)
        }
    )
    return {
        "frames": len(roll),
        "seconds": round(len(roll) / FRAME_RATE_HZ, 3),
        "onsets": onsets,
        "soundingFrameSlots": sounding,
        "distinctPitches": len(pitches),
        "pitchRange": [pitches[0], pitches[-1]] if pitches else None,
        "maskedPitches": sum(1 for value in roll[0] if value == MASKED) if roll else 0,
    }
