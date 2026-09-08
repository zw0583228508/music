"""The conditioning bridge is the one part of this worker that must be right
before a GPU is ever billed, so it is tested without JAX, CUDA or weights."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pianoroll import (  # noqa: E402
    FREE,
    MASKED,
    OFF,
    ONSET,
    PITCH_COUNT,
    SUSTAIN,
    Note,
    describe_roll,
    drums_to_track,
    frame_count,
    notes_to_pianoroll,
)


def test_a_held_note_is_one_onset_followed_by_sustain():
    # 0.4s at 25Hz is 10 frames.
    roll = notes_to_pianoroll([Note(60, 0.0, 0.4)], frames=10)
    assert len(roll) == 10
    assert all(len(row) == PITCH_COUNT for row in roll)
    assert roll[0][60] == ONSET
    assert [row[60] for row in roll[1:]] == [SUSTAIN] * 9


def test_silence_is_explicit_rather_than_masked():
    # An arrangement that passed the critic should not be quietly embellished,
    # so every pitch we did not choose is an explicit off.
    roll = notes_to_pianoroll([Note(60, 0.0, 0.04)], frames=4)
    assert roll[0][60] == ONSET
    assert roll[1][60] == OFF
    assert set(roll[0]) == {ONSET, OFF}
    assert MASKED not in roll[0]


def test_masked_pitches_are_the_only_way_to_leave_a_pitch_open():
    roll = notes_to_pianoroll([Note(60, 0.0, 0.2)], frames=5, masked_pitches={61, 62})
    assert roll[0][61] == MASKED and roll[0][62] == MASKED
    assert roll[0][60] == ONSET
    assert describe_roll(roll)["maskedPitches"] == 2


def test_a_masked_pitch_ignores_notes_written_on_it():
    roll = notes_to_pianoroll([Note(61, 0.0, 0.2)], frames=5, masked_pitches={61})
    assert [row[61] for row in roll] == [MASKED] * 5


def test_a_note_shorter_than_a_frame_still_sounds():
    # Grace notes and fast hi-hat figures must not silently vanish.
    roll = notes_to_pianoroll([Note(72, 0.0, 0.005)], frames=3)
    assert roll[0][72] == ONSET


def test_repeated_notes_produce_separate_onsets():
    roll = notes_to_pianoroll(
        [Note(60, 0.0, 0.04), Note(60, 0.08, 0.12)], frames=5
    )
    assert [row[60] for row in roll] == [ONSET, OFF, ONSET, OFF, OFF]


def test_an_onset_is_never_downgraded_by_an_overlapping_voice():
    # Two voices on the same pitch: the onset must survive the sustain.
    roll = notes_to_pianoroll(
        [Note(60, 0.0, 0.4), Note(60, 0.08, 0.2)], frames=10
    )
    assert roll[2][60] == ONSET, "the second voice's onset is preserved"
    assert roll[3][60] == SUSTAIN


def test_windowing_keeps_absolute_time():
    # Realizing bar 5 onward must place notes where they actually fall, and a
    # note already sounding when the window opens is a sustain, not a re-attack.
    notes = [Note(60, 10.0, 10.4), Note(64, 9.8, 10.2)]
    roll = notes_to_pianoroll(notes, frames=10, start_seconds=10.0)
    assert roll[0][60] == ONSET, "a note starting exactly at the window opens it"
    assert roll[0][64] == SUSTAIN, "a note carried in from before is not re-attacked"


def test_notes_outside_the_window_are_dropped():
    roll = notes_to_pianoroll(
        [Note(60, 0.0, 0.4), Note(67, 100.0, 100.4)], frames=10
    )
    assert all(row[67] == OFF for row in roll)


def test_free_articulation_hands_phrasing_to_the_model():
    roll = notes_to_pianoroll([Note(60, 0.0, 0.4)], frames=10, free_articulation=True)
    assert set(row[60] for row in roll) == {FREE}
    assert ONSET not in roll[0] and SUSTAIN not in roll[0]


def test_drum_onsets_land_on_the_right_frames():
    track = drums_to_track([0.0, 0.2, 0.4], frames=12)
    assert track == [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]


def test_masked_drums_leave_the_kit_entirely_to_the_model():
    assert drums_to_track([0.0], frames=4, masked=True) == [MASKED] * 4


def test_frame_count_matches_the_codec_rate():
    assert frame_count(1.0) == 25
    assert frame_count(0.01) == 1, "a very short render still gets one frame"
    with pytest.raises(ValueError):
        frame_count(0)


def test_describe_roll_reports_what_was_asked_of_the_model():
    roll = notes_to_pianoroll(
        [Note(60, 0.0, 0.2), Note(64, 0.0, 0.2), Note(67, 0.2, 0.4)], frames=10
    )
    summary = describe_roll(roll)
    assert summary["frames"] == 10
    assert summary["seconds"] == 0.4
    assert summary["onsets"] == 3
    assert summary["distinctPitches"] == 3
    assert summary["pitchRange"] == [60, 67]


def test_invalid_input_is_rejected_rather_than_silently_clamped():
    with pytest.raises(ValueError):
        Note(128, 0.0, 1.0)
    with pytest.raises(ValueError):
        Note(60, 1.0, 1.0)
    with pytest.raises(ValueError):
        notes_to_pianoroll([], frames=0)
    with pytest.raises(ValueError):
        notes_to_pianoroll([], frames=4, masked_pitches={200})
