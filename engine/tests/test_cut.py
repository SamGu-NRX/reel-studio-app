import pytest

from conftest import mkwords
from reelengine import cut
from reelengine.proto import EngineError

SRC = {"s1": {"duration": 10.0, "fps": 30.0}, "s2": {"duration": 6.0, "fps": 25.0}}


def words_basic():
    return mkwords([(0.50, 0.80, "We"), (0.85, 1.20, "build"), (1.25, 1.70, "things."),
                    (3.70, 4.00, "Every"), (4.05, 4.50, "day."), (6.00, 6.30, "Again.")])


def test_gap_is_capped_and_words_never_cut():
    w = words_basic()
    tl = cut.build_timeline(w, [{"from": "w0", "to": "w4"}], SRC, gap_cap=0.25, min_saving=0.08)
    # 2.0 s of dead air between "things." and "Every" is cut down to ~0.25 s
    out = {x["id"]: x for x in tl.words_out}
    gap = out["w3"]["s"] - out["w2"]["e"]
    assert 0.20 <= gap <= 0.30, gap
    # every kept word keeps its full length
    for x in w[:5]:
        assert abs((out[x["id"]]["e"] - out[x["id"]]["s"]) - (x["e"] - x["s"])) < 0.035
    # the output duration is exactly the sum of segment lengths
    assert abs(tl.duration - sum(s.duration for s in tl.segments)) < 1e-6


def test_segments_on_frame_grid():
    tl = cut.build_timeline(words_basic(), [{"from": "w0", "to": "w4"}], SRC)
    for s in tl.segments:
        for t in (s.src_start, s.src_end):
            assert abs(t * 30 - round(t * 30)) < 1e-4


def test_anchor_mapping_matches_segments():
    """word_out_time must equal where the renderer actually places the word."""
    w = words_basic()
    keep = [{"from": "w3", "to": "w4"}, {"from": "w0", "to": "w2"}]      # reordered
    tl = cut.build_timeline(w, keep, SRC)
    for x in w[:5]:
        t_out = tl.word_out_time(x["id"])
        sid, t_src = tl.out_to_src(t_out + 1e-4)
        assert sid == "s1"
        assert abs(t_src - x["s"]) < 0.04, (x, t_out, t_src)
    # reordered: "Every" now comes first
    assert tl.word_out_time("w3") < tl.word_out_time("w0")


def test_recut_moves_anchors_with_the_words():
    w = words_basic()
    a = cut.build_timeline(w, [{"from": "w0", "to": "w4"}], SRC)
    b = cut.build_timeline(w, [{"from": "w2", "to": "w4"}], SRC)      # first two words cut
    # "day." is still preceded by exactly the same material after "things.", so its offset from
    # "things." is unchanged; and it starts earlier overall
    da = a.word_out_time("w4") - a.word_out_time("w2")
    db = b.word_out_time("w4") - b.word_out_time("w2")
    assert abs(da - db) < 0.035
    assert b.word_out_time("w4") < a.word_out_time("w4")


def test_cut_word_maps_to_next_kept_word():
    w = words_basic()
    tl = cut.build_timeline(w, [{"from": "w0", "to": "w1"}, {"from": "w3", "to": "w4"}], SRC)
    assert not tl.is_kept("w2")
    assert tl.word_out_time("w2") == tl.word_out_time("w3")
    assert tl.word_out_end("w2") == tl.word_out_end("w1")


def test_unknown_word_is_an_engine_error():
    with pytest.raises(EngineError) as e:
        cut.build_timeline(words_basic(), [{"from": "w0", "to": "w99"}], SRC)
    assert e.value.code == "BAD_CUT" and e.value.user_message


def test_inside_word_silence_removed():
    w = mkwords([(0.5, 2.5, "Hold"), (2.55, 3.0, "on.")])
    w[0]["gaps"] = [[0.8, 2.2]]
    tl = cut.build_timeline(w, [{"from": "w0", "to": "w1"}], SRC, gap_cap=0.25)
    # 0.4..3.35 without the inside cut is 2.95 s; 1.4 s of silence capped to 0.25 removes 1.15 s
    assert tl.duration < 2.95 - 1.0


def test_ranges_split_at_source_boundaries():
    w = mkwords([(0.5, 0.9, "one"), (1.0, 1.4, "two")]) + \
        mkwords([(0.3, 0.7, "three"), (0.8, 1.1, "four")], source="s2", start_id=2)
    tl = cut.build_timeline(w, [{"from": "w0", "to": "w3"}], SRC)
    assert [s.source for s in tl.segments] == ["s1", "s2"]
    # s2 is 25 fps: its cut points sit on the 25 fps grid
    for s in tl.segments[1:]:
        assert abs(s.src_start * 25 - round(s.src_start * 25)) < 1e-4


def test_window_segments():
    tl = cut.build_timeline(words_basic(), [{"from": "w0", "to": "w5"}], SRC)
    win = cut.window_segments(tl.segments, 0.5, 2.0)
    assert abs(sum(s.duration for s in win) - 1.5) < 1e-6
    assert win[0].out_start == 0


def test_keep_positions_roundtrip():
    w = words_basic()
    keep = cut.keep_from_positions(w, [0, 1, 2, 4, 5])
    assert keep == [{"from": "w0", "to": "w2"}, {"from": "w4", "to": "w5"}]
    assert cut.positions_from_keep(w, keep) == [0, 1, 2, 4, 5]


def test_remap_anchors_after_retranscription():
    from reelengine import project
    old = words_basic()
    new = [dict(w) for w in old if w["id"] != "w4"] + [{"id": "w9", "source": "s1", "s": 4.06, "e": 4.5, "w": "day."}]
    new.sort(key=lambda w: w["s"])
    p = project.new_project("t")
    p["cut"]["keep"] = [{"from": "w0", "to": "w4"}]
    p["zooms"] = [{"anchor": {"from": "w4", "to": "w4"}, "scale": 1.1}]
    moved = project.remap_anchors(p, old, new)
    assert moved == 3
    assert p["cut"]["keep"] == [{"from": "w0", "to": "w9"}]
    assert p["zooms"][0]["anchor"] == {"from": "w9", "to": "w9"}


# --- seconds ranges ----------------------------------------------------------------------------

def test_seconds_range_plays_its_snapped_span_with_every_pause_left_in():
    w = words_basic()            # 2 s and 1.5 s pauses that a word range would cap
    tl = cut.build_timeline(w, [{"source": "s1", "start": 0.41, "end": 6.52}], SRC)
    assert [(s.source, s.src_start, s.src_end, s.out_start) for s in tl.segments] == [
        ("s1", round(12 / 30, 6), round(196 / 30, 6), 0.0)]
    assert tl.duration == round(184 / 30, 6)
    assert (tl.segments[0].first_word, tl.segments[0].last_word) == ("w0", "w5")


def test_seconds_range_keeps_words_by_midpoint_on_the_output_clock():
    w = words_basic()
    tl = cut.build_timeline(w, [{"source": "s1", "start": 1.0, "end": 4.3}], SRC)
    # "build" (mid 1.025) and "day." (mid 4.275) are in; "We" (mid 0.65) and "Again." are not
    assert [x["id"] for x in tl.words_out] == ["w1", "w2", "w3", "w4"]
    out = {x["id"]: x for x in tl.words_out}
    assert out["w1"]["s"] == 0.0                         # starts before the cut: clamped to it
    assert out["w3"] == {"id": "w3", "w": "Every", "s": 2.7, "e": 3.0, "source": "s1"}
    assert out["w4"]["e"] == 3.3                         # ends after the cut: clamped to it
    assert not tl.is_kept("w0") and not tl.is_kept("w5")
    assert tl.word_out_time("w0") == 0.0                 # cut word -> next kept word
    assert tl.word_out_end("w5") == 3.3                  # cut word -> end of the last kept one


def test_mixed_keep_plays_in_list_order_and_word_ranges_cap_as_before():
    w = words_basic()
    keep = [{"source": "s2", "start": 1.0, "end": 3.0}, {"from": "w0", "to": "w4"},
            {"source": "s1", "start": 5.0, "end": 7.0}]
    tl = cut.build_timeline(w, keep, SRC)
    # a word run in the middle of the video is planned like any middle run (capped, no head/tail air)
    middle = cut.plan_run(w, 0, 4, cut.GAP_CAP, cut.MIN_SAVING, 30.0, 10.0, is_first=False, is_last=False)
    assert len(middle) > 1
    assert [(s.source, s.src_start, s.src_end) for s in tl.segments] == (
        [("s2", 1.0, 3.0)] + [("s1", a, b) for a, b in middle] + [("s1", 5.0, 7.0)])
    assert tl.segments[0].first_word is None
    words_dur = sum(b - a for a, b in middle)
    assert tl.word_out_time("w0") == pytest.approx(2.0 + w[0]["s"] - middle[0][0], abs=1e-4)
    assert tl.word_out_time("w5") == pytest.approx(2.0 + words_dur + 1.0, abs=1e-4)
    assert abs(tl.duration - sum(s.duration for s in tl.segments)) < 1e-6


def test_back_to_back_word_ranges_still_merge_but_not_across_a_seconds_range():
    w = words_basic()
    merged = cut.build_timeline(w, [{"from": "w0", "to": "w2"}, {"from": "w3", "to": "w4"}], SRC)
    one = cut.build_timeline(w, [{"from": "w0", "to": "w4"}], SRC)
    assert merged.segments == one.segments
    split = cut.build_timeline(w, [{"from": "w0", "to": "w2"}, {"source": "s2", "start": 0, "end": 1},
                                   {"from": "w3", "to": "w4"}], SRC)
    assert [(s.source, s.first_word, s.last_word) for s in split.segments] == [
        ("s1", "w0", "w2"), ("s2", None, None), ("s1", "w3", "w4")]


def test_a_word_inside_two_seconds_ranges_keeps_its_first_place():
    w = words_basic()
    tl = cut.build_timeline(w, [{"source": "s1", "start": 3.0, "end": 5.0},
                                {"source": "s1", "start": 3.5, "end": 4.6}], SRC)
    assert [x["id"] for x in tl.words_out] == ["w3", "w4", "w3", "w4"]
    assert tl.word_out_time("w3") == 0.7
    assert tl.kept_index == [3, 4]


def test_seconds_range_clamps_to_the_source_end_on_its_frame_grid():
    tl = cut.build_timeline([], [{"source": "s2", "start": 5.0, "end": 9.0}],
                            {"s2": {"duration": 5.99, "fps": 25.0}})
    assert (tl.segments[0].src_start, tl.segments[0].src_end) == (5.0, 5.96)


def test_seconds_cut_needs_no_words():
    tl = cut.build_timeline([], [{"source": "s1", "start": 0, "end": 5}], SRC)
    assert tl.duration == 5.0 and tl.words_out == [] and tl.kept_index == []
    assert cut.positions_from_keep([], [{"source": "s1", "start": 0, "end": 5}]) == []


@pytest.mark.parametrize("rng, why", [
    ({"source": "s1", "start": 4.0, "end": 4.0}, "not after"),
    ({"source": "s1", "start": 5.0, "end": 2.0}, "not after"),
    ({"source": "s9", "start": 0.0, "end": 2.0}, "unknown source"),
    ({"source": "s1", "start": "0", "end": 2.0}, "numeric"),
    ({"source": "s1", "start": 0.0, "end": True}, "numeric"),
    ({"source": "s1", "start": 12.0, "end": 14.0}, "under one frame"),
])
def test_bad_seconds_range_is_a_bad_cut(rng, why):
    with pytest.raises(EngineError) as e:
        cut.build_timeline(words_basic(), [{"from": "w0", "to": "w1"}, rng], SRC)
    assert e.value.code == "BAD_CUT" and "cut.keep[1]" in e.value.message and why in e.value.message
    assert e.value.user_message


def _speechless(tmp_path, keep):
    from reelengine import project
    (tmp_path / "work").mkdir()
    (tmp_path / "work" / "transcript.json").write_text('{"words": []}')
    p = project.new_project("t")
    p["cut"]["keep"] = keep
    return project, p


@pytest.mark.parametrize("keep, ok", [
    ([{"source": "s1", "start": 0.0, "end": 4.0}], True),
    ([{"source": "s1", "start": 0.0, "end": 4.0}, {"from": "w0", "to": "w1"}], False),
    ([], False),
])
def test_an_empty_transcript_is_no_speech_unless_the_cut_is_all_seconds(tmp_path, keep, ok):
    project, p = _speechless(tmp_path, keep)
    if ok:
        assert project.load_transcript(tmp_path, p)["words"] == []
    else:
        with pytest.raises(EngineError) as e:
            project.load_transcript(tmp_path, p)
        assert e.value.code == "NO_SPEECH"


def test_the_schema_takes_word_and_seconds_ranges_and_a_brief():
    from reelengine import project
    p = project.new_project("t")
    p["cut"]["keep"] = [{"from": "w0", "to": "w3"}, {"source": "s1", "start": 0, "end": 2.5}]
    p["brief"] = {"kind": "match", "home": "Spurs"}
    assert project.validate(p) == []
    # a bad entry is explained as the kind of range it was meant to be, not "matches no oneOf branch"
    p["cut"]["keep"] = [{"source": "s1", "start": -1, "end": 2.5}]
    assert project.validate(p) == ["cut/keep/0/start: -1 is less than the minimum of 0"]


@pytest.mark.parametrize("keep, shown", [
    ([{"source": "s1", "start": 1.0, "end": 3.0}], [{"source": "s1", "start": 1.0, "end": 3.0}]),
    ([{"from": "w2", "to": "w3"}], [{"from": "w0", "to": "w5"}]),
])
def test_first_look_keeps_a_seconds_cut_and_replaces_a_word_cut(tmp_path, keep, shown):
    import json
    from reelengine import project, render
    (tmp_path / "work").mkdir()
    (tmp_path / "work" / "analysis.json").write_text(json.dumps({"defaultCut": {"keep": [{"from": "w0", "to": "w5"}]}}))
    p = project.new_project("t")
    p["cut"]["keep"] = keep
    assert render.first_look_project(tmp_path, p)["cut"]["keep"] == shown
