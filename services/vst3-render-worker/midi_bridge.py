"""TrackModel -> timed MIDI for the plugin host.

The TrackModel is Performance MIDI already: every onset, length, velocity and
controller value was decided upstream by the Performance Engine. This bridge
translates, it does not interpret. Times are seconds, absolute from render
start, which is what pedalboard's instrument API consumes.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MidiEvent:
    time: float
    kind: str  # note_on | note_off | control_change
    data1: int  # note number or controller
    data2: int  # velocity or value
    channel: int = 0

    def to_mido(self):
        from mido import Message

        if self.kind == "control_change":
            return Message("control_change", control=self.data1, value=self.data2, channel=self.channel, time=self.time)
        return Message(self.kind, note=self.data1, velocity=self.data2, channel=self.channel, time=self.time)


def _clamp_int(value: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(round(value))))


def build_events(track: dict, duration_seconds: float, *, keyswitch_lead_seconds: float = 0.01) -> list[MidiEvent]:
    """Deterministic, time-sorted MIDI for one TrackModel.

    - Notes past the render end are clamped; notes starting after it are dropped.
    - Note-offs use velocity 0.
    - CC values arrive as 0..127 floats from the Performance Engine and are
      rounded to integers here, at the wire boundary.
    - An articulation with a `keyswitch` becomes a short keyswitch note just
      ahead of its time, the way a keyswitched library expects.
    - Ordering is stable: at equal times, note-offs precede note-ons so a
      repeated pitch re-triggers instead of being swallowed.
    """
    if duration_seconds <= 0:
        raise ValueError("duration must be positive")
    events: list[MidiEvent] = []
    for note in track.get("notes") or []:
        start = float(note["start"])
        end = start + float(note["duration"])
        if start >= duration_seconds or end <= start:
            continue
        pitch = _clamp_int(note["pitch"], 0, 127)
        velocity = _clamp_int(note.get("velocity", 96), 1, 127)
        channel = _clamp_int(note.get("channel", 0), 0, 15)
        events.append(MidiEvent(start, "note_on", pitch, velocity, channel))
        events.append(MidiEvent(min(end, duration_seconds), "note_off", pitch, 0, channel))
    for event in track.get("cc") or []:
        time = float(event["time"])
        if time > duration_seconds:
            continue
        events.append(MidiEvent(
            time, "control_change",
            _clamp_int(event["controller"], 0, 127),
            _clamp_int(event["value"], 0, 127),
            _clamp_int(event.get("channel", 0), 0, 15),
        ))
    for articulation in track.get("articulations") or []:
        keyswitch = articulation.get("keyswitch")
        if keyswitch is None:
            continue
        time = max(0.0, float(articulation["time"]) - keyswitch_lead_seconds)
        if time > duration_seconds:
            continue
        key = _clamp_int(keyswitch, 0, 127)
        events.append(MidiEvent(time, "note_on", key, 100))
        events.append(MidiEvent(min(time + 0.05, duration_seconds), "note_off", key, 0))
    order = {"control_change": 0, "note_off": 1, "note_on": 2}
    events.sort(key=lambda e: (e.time, order[e.kind], e.data1))
    return events


def to_mido_messages(events: list[MidiEvent]):
    return [event.to_mido() for event in events]
