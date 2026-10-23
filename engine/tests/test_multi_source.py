"""Clip projects must preserve source order, timing, captions and downgrade refusal."""
import subprocess
from pathlib import Path

import jsonschema
import numpy as np
import pytest

from conftest import mkwords
from reelengine import broll, captions, cut, init, project, render, tools
from reelengine.proto import EngineError


def clip(cid, source, start, end):
    return {"clip": cid, "source": source, "in": start, "out": end}


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    folder = tmp_path_factory.mktemp("clip-signals")
    paths = {}
    for name, offset, audio in [("s1", 0, True), ("s2", 20, True), ("silent", 0, False)]:
        path = folder / f"{name}.mp4"
        # Every half second changes both brightness and tone frequency on the same source clock.
        video = f"nullsrc=s=96x64:r=30:d=6,geq=lum='30+{offset}+16*floor(T*2)':cb=128:cr=128"
        cmd = [tools.ffmpeg(), "-y", "-v", "error", "-f", "lavfi", "-i", video]
        if audio:
            tone = f"aevalsrc=0.2*sin(2*PI*(250+{offset * 5}+125*floor(t*2))*t):s=48000:d=6"
            cmd += ["-f", "lavfi", "-i", tone, "-c:a", "aac"]
        cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)]
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        paths[name] = path
    return paths


def make_project(tmp_path, media, keep, words=None, library=False):
    pdir = tmp_path / "project"
    p = project.new_project("Clip reel")
    p["format"] = {"width": 96, "height": 64, "fps": 30}
    p["sources"] = []
    for sid, original in media.items():
        rel = f"Library/Footage/{sid}.mp4" if library else f"media/{sid}.mp4"
        dest = (tmp_path if library else pdir) / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.hardlink_to(original)
        p["sources"].append({"id": sid, "path": rel, "duration": 6, "fps": 30,
                             "width": 96, "height": 64})
    p["cut"]["keep"] = keep
    p["captions"]["enabled"] = words is not None
    if words is not None:
        p["transcript"] = {"file": "work/transcript.json"}
        project.write_json(pdir / "work/transcript.json", {"words": words})
    project.save(pdir, p)
    return pdir, p


def decode(path):
    raw = subprocess.run([tools.ffmpeg(), "-v", "error", "-i", str(path), "-map", "0:v:0",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         check=True, capture_output=True, timeout=60).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 64, 96)
    raw = subprocess.run([tools.ffmpeg(), "-v", "error", "-i", str(path), "-map", "0:a:0",
                          "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
                         check=True, capture_output=True, timeout=60).stdout
    return frames, np.frombuffer(raw, np.float32)


def assert_signals(path, spans):
    frames, sound = decode(path)
    duration = sum(end - start for _, start, end in spans)
    assert len(frames) == round(duration * 30)
    assert abs(len(sound) / 48000 - duration) <= 1 / 30
    cursor = 0.0
    for sid, start, end in spans:
        offset = 20 if sid == "s2" else 0
        for delta in np.arange(0.1, end - start - 0.06, 0.1):
            src = start + delta
            # Avoid measuring windows across a fixture's half-second transition.
            if min(src % 0.5, 0.5 - src % 0.5) < 0.075:
                continue
            at = cursor + delta
            level = 30 + offset + 16 * int(src * 2)
            grey = (level - 16) * 255 / 219
            assert abs(float(frames[round(at * 30)].mean()) - grey) < 7, (sid, src, at)
            samples = sound[round((at - 0.025) * 48000):round((at + 0.025) * 48000)]
            spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
            hz = np.fft.rfftfreq(len(samples), 1 / 48000)[spectrum.argmax()]
            assert abs(hz - (250 + offset * 5 + 125 * int(src * 2))) < 25, (sid, src, at, hz)
        cursor += end - start


def test_three_clips_render_in_sync_without_transcript(tmp_path, media):
    spans = [("s1", 3.2, 4.4), ("s2", 1.3, 2.4), ("s1", 0.4, 1.8)]
    keep = [clip(f"c{i}", *span) for i, span in enumerate(spans, 1)]
    pdir, p = make_project(tmp_path, {s: media[s] for s in ("s1", "s2")}, keep, library=True)
    p["captions"]["enabled"] = True
    project.save(pdir, p)
    assert not (pdir / "work/transcript.json").exists()
    result = render.run(pdir, root=tmp_path, cover=False)
    assert result["duration"] == pytest.approx(3.7)
    assert result["captions"] == 0
    assert result["verify"]["ok"], result["verify"]
    assert_signals(result["file"], spans)


def test_reordering_clips_moves_source_anchored_broll(tmp_path, media):
    keep = [clip("c1", "s1", 0, 1), clip("c2", "s2", 2, 4), clip("c3", "s1", 4, 6)]
    pdir, p = make_project(tmp_path, {s: media[s] for s in ("s1", "s2")}, keep)
    p["broll"] = [{"id": "b1", "anchor": {"source": "s2", "s": 2.5, "e": 3.0},
                   "leadIn": 0, "treatment": "text-pop", "params": {"text": "GOAL", "hold": 0.5}}]
    project.save(pdir, p)

    def window():
        tl = project.timeline(pdir, p)
        ctx = render.make_ctx(pdir, p, tl, False, tmp_path, pdir / "work/render")
        plans = broll.plan_windows(ctx)
        assert len(plans) == 1
        assert render.unknown_anchor_skips(p, tl) == ([], [])
        return plans[0]["t0"], plans[0]["t1"]

    before = window()
    p["cut"]["keep"] = [keep[1], keep[2], keep[0]]
    after = window()
    assert before == pytest.approx((1.5, 2.05))
    assert after == pytest.approx((0.5, 1.05))
    # Trimming away the anchor removes the overlay instead of leaving it at its old output time.
    p["cut"]["keep"] = [clip("c2", "s2", 3.5, 4)]
    tl = project.timeline(pdir, p)
    ctx = render.make_ctx(pdir, p, tl, False, tmp_path, pdir / "work/render")
    assert broll.plan_windows(ctx) == []


def test_mixed_cut_captions_only_kept_words(tmp_path, media):
    words = mkwords([(0.4, 0.7, "First"), (2, 2.3, "Removed")])
    words += mkwords([(1.2, 1.5, "Clip"), (3, 3.3, "Outside")], source="s2", start_id=2)
    pdir, p = make_project(tmp_path, {s: media[s] for s in ("s1", "s2")},
                           [{"from": "w0", "to": "w0"}, clip("c1", "s2", 1, 2)], words)
    tl = project.timeline(pdir, p)
    assert [w["id"] for w in tl.words_out] == ["w0", "w2"]
    assert tl.words_out[-1]["s"] == pytest.approx(0.667, abs=0.001)
    _, report, _, _, _ = captions.build_for_timeline(tl, p, 1080, 1920)
    text = " ".join(row["text"] for row in report).upper()
    assert "FIRST" in text and "CLIP" in text
    assert "REMOVED" not in text and "OUTSIDE" not in text


@pytest.mark.parametrize("mixed", [False, True])
def test_silent_sources_render_silence(tmp_path, media, mixed):
    paths = {"s1": media["silent"]}
    keep = [clip("c1", "s1", 1, 2)]
    if mixed:
        paths["s2"] = media["s2"]
        keep += [clip("c2", "s2", 2, 3), clip("c3", "s1", 3, 4)]
    pdir, _ = make_project(tmp_path, paths, keep)
    result = render.run(pdir, root=tmp_path, cover=False, verify=False)
    frames, sound = decode(result["file"])
    assert len(frames) == (90 if mixed else 30)
    assert np.max(np.abs(sound[4800:43200])) < 0.0001
    if mixed:
        assert np.max(np.abs(sound[52800:91200])) > 0.01
        assert np.max(np.abs(sound[100800:139200])) < 0.0001


def test_init_accepts_silent_video(tmp_path, media):
    result = init.run(tmp_path / "new", "Silent clip", [media["silent"]])
    assert len(result["sources"]) == 1
    assert project.load(tmp_path / "new")["sources"][0]["duration"] == pytest.approx(6)


def test_main_schema_refuses_clip_project_with_bad_project(tmp_path, monkeypatch):
    # Snapshot from origin/main at 31382f9, before clip items existed. No git/network dependency.
    old_schema = Path(__file__).parent / "fixtures/project-schema-31382f9.json"
    p = project.new_project("Downgrade")
    p["cut"]["keep"] = [clip("c1", "s1", 0, 1)]
    project.write_json(tmp_path / "project.json", p)
    monkeypatch.setattr(project, "_VALIDATOR", jsonschema.Draft202012Validator(project.read_json(old_schema)))
    with pytest.raises(EngineError) as exc:
        project.load(tmp_path)
    assert exc.value.code == "BAD_PROJECT"


def test_old_word_range_project_renders_unchanged(tmp_path, media):
    words = mkwords([(0.4, 0.7, "One"), (0.8, 1.2, "two"), (3.2, 3.5, "three")])
    pdir, p = make_project(tmp_path, {"s1": media["s1"]}, [{"from": "w0", "to": "w2"}], words)
    p["captions"]["enabled"] = False
    project.save(pdir, p)
    result = render.run(pdir, root=tmp_path, cover=False)
    # Existing gap/lead/tail behavior on main, measured on the source frame grid.
    assert result["duration"] == pytest.approx(1.8)
    assert_signals(result["file"], [("s1", 0.3, 1.266667), ("s1", 3.033333, 3.866667)])
