"""Beat accents must follow audible clicks, including between onset-frame boundaries."""
import hashlib
import json
import wave

import numpy as np
import pytest

from reelengine import music


def click_track(path, bpm, texture="pure", seconds=30.0, start=0.137, stop=None):
    sr = 22050
    t = np.arange(round(seconds * sr)) / sr
    x = np.zeros(len(t))
    clicks = np.arange(start, seconds - 0.1 if stop is None else stop, 60 / bpm)
    pulse_t = np.arange(round(0.015 * sr)) / sr
    pulse = 0.8 * np.sin(2 * np.pi * 1000 * pulse_t)
    for at in clicks:
        i = round(at * sr)
        x[i:i + len(pulse)] += pulse
    if texture != "pure":
        x += 0.015 * sum(np.sin(2 * np.pi * f * t) for f in (110, 165, 220))
    if texture == "syncopated":
        rng = np.random.default_rng(42)
        hat_t = np.arange(round(0.025 * sr)) / sr
        noise = rng.standard_normal(len(hat_t))
        hat = 0.12 * np.diff(noise, prepend=0) * np.exp(-hat_t * 180)
        for index, at in enumerate(clicks):
            # Eighth-note offbeats with a sixteenth-note pickup on alternate beats.
            for offset in ((0.5, 0.75) if index % 2 else (0.5,)):
                i = round((at + offset * 60 / bpm) * sr)
                if i + len(hat) <= len(x):
                    x[i:i + len(hat)] += hat
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sr)
        wav.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return clicks


@pytest.mark.parametrize("bpm", [90, 100, 120, 128, 140])
@pytest.mark.parametrize("texture", ["pure", "pad"])
def test_beats_follow_clicks(tmp_path, bpm, texture):
    path = tmp_path / "clicks.wav"
    clicks = click_track(path, bpm, texture)
    result = music.analyze_track(path)
    assert_click_grid(result, clicks, bpm)


def assert_click_grid(result, clicks, bpm):
    beats = np.asarray(result["beats"])
    assert len(beats) == len(clicks), "missing clicks or extra beats"
    errors = np.abs(beats - clicks)
    print(f"bpm={bpm} detected={result['bpm']} max_error_ms={1000 * errors.max():.3f}")
    assert errors.max() <= 1 / 30, f"worst beat error: {1000 * errors.max():.3f} ms"
    assert result["bpm"] == pytest.approx(bpm, rel=0.01)


def test_offbeat_hihat_does_not_move_click_grid(tmp_path):
    path = tmp_path / "syncopated.wav"
    clicks = click_track(path, 120, "syncopated")
    assert_click_grid(music.analyze_track(path), clicks, 120)


def test_old_beat_analysis_is_recomputed(tmp_path):
    path = tmp_path / "clicks.wav"
    clicks = click_track(path, 120)
    cache = tmp_path / "cache"
    cache.mkdir()
    old_key = hashlib.sha256(b"v3|" + path.read_bytes()).hexdigest()[:32]
    (cache / f"{old_key}.json").write_text(json.dumps({"bpm": 117.5, "beats": [0.25]}))
    result = music.analyze_track_cached(path, cache_dir=cache)
    assert_click_grid(result, clicks, 120)
    assert music.analyze_track_cached(path, cache_dir=cache) == result


@pytest.mark.parametrize("start", [0.0, 0.48])
def test_clicks_at_track_edges_are_kept(tmp_path, start):
    path = tmp_path / "edges.wav"
    clicks = click_track(path, 120, start=start, stop=29.985)
    assert_click_grid(music.analyze_track(path), clicks, 120)


def test_long_track_does_not_accumulate_phase_error(tmp_path):
    path = tmp_path / "long.wav"
    clicks = click_track(path, 128, seconds=210)
    assert_click_grid(music.analyze_track(path), clicks, 128)


def test_silent_intro_and_outro_have_no_beats(tmp_path):
    path = tmp_path / "silence-around-clicks.wav"
    clicks = click_track(path, 120, start=5.137, stop=25)
    assert_click_grid(music.analyze_track(path), clicks, 120)
