import copy
import json

import pytest

from reelengine import project
from reelengine.proto import EngineError


def reel(tmp_path):
    p = project.new_project("Seeded reel")
    p["version"] = 3
    p["cutStyle"] = {"preset": "standard", "seed": 42}
    p["sources"] = [{"id": "s1", "path": "media/take.mp4", "duration": 30}]
    words = [{"id": f"w{i}", "source": "s1", "w": f"word{i}", "s": i * .4 + .1,
              "e": i * .4 + .4} for i in range(60)]
    p["cut"]["keep"] = [{"from": "w0", "to": "w9"}, {"from": "w20", "to": "w59"}]
    p["zooms"] = [{"anchor": {"from": f"w{i}", "to": f"w{i+2}"}, "scale": 1.15,
                    "accentGroup": "payoff"} for i in [30, 40]]
    p["broll"] = [{"id": "b1", "anchor": {"from": "w22", "to": "w25"},
                    "treatment": "text-pop", "asset": None, "params": {"text": "hello"}}]
    project.save(tmp_path, p, touch=False)
    project.write_json(tmp_path / "work" / "transcript.json", {"words": words})
    return p, project.timeline(tmp_path, p, words)


def test_same_seed_has_byte_identical_render_decisions(tmp_path):
    from reelengine import render, zoom
    p, tl = reel(tmp_path)
    original = copy.deepcopy(p)
    contexts = [render.make_ctx(tmp_path, p, tl, draft, tmp_path, tmp_path / "work")
                for draft in [True, False]]
    reports = [json.dumps(c.variation, sort_keys=True) for c in contexts]
    assert reports[0] == reports[1]
    assert contexts[0].variation["seed"] == 42
    assert zoom.build_zooms(contexts[0], with_broll=False) == zoom.build_zooms(contexts[1], with_broll=False)
    assert contexts[0].variation["framing"]
    assert p == original


def test_different_seed_changes_only_allowed_choices(tmp_path):
    from reelengine.variation import resolve
    from reelengine.cut_style import CUT_STYLES
    p, tl = reel(tmp_path)
    settings_before = copy.deepcopy(CUT_STYLES)
    p["cut"]["keep"][1]["join"] = {"transition": "j", "frames": 8}
    p["cut"]["keep"][0]["join"] = None
    a, da = resolve(p, tl)
    other = copy.deepcopy(p)
    other["cutStyle"]["seed"] = 123
    b, db = resolve(other, tl)
    assert da != db
    for result, decisions in [(a, da), (b, db)]:
        assert decisions["framingPair"][0] == 1
        assert abs(decisions["framingPair"][1] - 1.15) <= .03
        assert .10 <= decisions["cardLead"] <= .16
        assert -.5 <= decisions["cadencePhase"] <= .5
        assert decisions["startFraming"] in [0, 1]
        assert len(result["zooms"]) == 1
        assert 6 <= result["cut"]["keep"][1]["join"]["frames"] <= 12
        assert result["cut"]["keep"][0]["join"] is None
        expected = copy.deepcopy(p)
        expected["cutStyle"] = result["cutStyle"]
        expected["zooms"] = result["zooms"]
        expected["broll"][0]["leadIn"] = decisions["cardLead"]
        expected["cut"]["keep"][1]["join"]["frames"] = result["cut"]["keep"][1]["join"]["frames"]
        assert result == expected
    assert CUT_STYLES == settings_before


@pytest.mark.parametrize("variable,value,path", [
    ("seed", None, ("cutStyle", "seed")),
    ("hook", {"from": "w10", "to": "w19"}, ("cut", "keep", 0)),
    ("cover", {"atSourceTime": 2, "source": "s1", "text": "Bread"}, ("cover",)),
    ("caption", "Try a slower rise", ("post", "caption")),
    ("brightness", -8, ("exposure",)),
])
def test_variant_changes_exactly_one_variable(tmp_path, variable, value, path):
    from reelengine.variation import make_variant
    p, _ = reel(tmp_path)
    before = copy.deepcopy(p)
    variant = make_variant(p, variable, value=value)
    if variable == "brightness":
        assert variant["exposure"] == .92
    assert p == before
    assert variant != p
    a, b = before, variant
    for key in path[:-1]:
        a, b = a[key], b[key]
    if isinstance(a, list) or path[-1] in a:
        assert a[path[-1]] != b[path[-1]]
        b[path[-1]] = a[path[-1]]
    else:
        b.pop(path[-1])
    assert variant == p


def test_trials_record_changes_and_keep_parent_snapshot(tmp_path):
    from reelengine.variation import create_variant
    p, _ = reel(tmp_path)
    result = create_variant(tmp_path, "caption", value="A different caption")
    assert result["trial"] == {"parent_version": 3, "variable": "caption", "from": "", "to": "A different caption"}
    assert project.read_json(tmp_path / "trials.json") == [result["trial"]]
    assert project.load(tmp_path)["post"]["caption"] == "A different caption"
    assert project.read_json(tmp_path / "versions" / "v3" / "project.json") == p
    create_variant(tmp_path, "brightness", value=8)
    assert len(project.read_json(tmp_path / "trials.json")) == 2


def test_old_project_is_unchanged(tmp_path):
    from reelengine.variation import resolve
    p, tl = reel(tmp_path)
    del p["cutStyle"]
    before = json.dumps(p, sort_keys=True)
    effective, decisions = resolve(p, tl)
    assert json.dumps(effective, sort_keys=True) == before
    assert decisions is None


@pytest.mark.parametrize("variable,value", [("preset", "hyper"), ("hook", None),
    ("cover", None), ("caption", ""), ("brightness", 7), ("brightness", True)])
def test_invalid_trial_does_not_write(tmp_path, variable, value):
    from reelengine.variation import create_variant
    reel(tmp_path)
    before = (tmp_path / "project.json").read_bytes()
    with pytest.raises(EngineError):
        create_variant(tmp_path, variable, value=value)
    assert (tmp_path / "project.json").read_bytes() == before
    assert not (tmp_path / "trials.json").exists()


def test_brightness_trial_reaches_video_filter(tmp_path):
    from reelengine import render
    p, tl = reel(tmp_path)
    p["exposure"] = 1.08
    ctx = render.make_ctx(tmp_path, p, tl, True, tmp_path, tmp_path / "work")
    graph = tmp_path / "graph.txt"
    render.build_video_cmd(ctx, tl.segments, {"s1": {"width": 1080, "height": 1920, "fps": 30}},
        {"s1": tmp_path / "take.mp4"}, {}, 540, 960, [], [], None, tmp_path / "audio.wav",
        0, tl.duration, 0, "libx264", tmp_path / "out.mp4", graph, use_hw=False)
    assert "exposure=exposure=" in graph.read_text()


def test_hook_trial_rejects_unknown_and_repeated_speech(tmp_path):
    from reelengine.variation import create_variant
    reel(tmp_path)
    before = (tmp_path / "project.json").read_bytes()
    for value in [{"from": "w999", "to": "w19"}, {"from": "w20", "to": "w25"}]:
        with pytest.raises(EngineError, match="hook"):
            create_variant(tmp_path, "hook", value=value)
        assert (tmp_path / "project.json").read_bytes() == before
    assert not (tmp_path / "trials.json").exists()


def test_variant_cli_writes_trial(tmp_path):
    from reelengine.cli import build_parser
    reel(tmp_path)
    args = build_parser().parse_args(["make-variant", "--project", str(tmp_path),
                                     "--variable", "caption", "--value", '"New caption"'])
    result = args.fn(args)
    assert result["trial"]["to"] == "New caption"
    assert project.load(tmp_path)["post"]["caption"] == "New caption"


def test_seeded_render_without_authored_zooms(tmp_path):
    import subprocess
    from reelengine import render, tools
    p = project.new_project("Tiny seeded render")
    p["format"] = {"width": 64, "height": 96, "fps": 10}
    p["cutStyle"] = {"preset": "standard", "seed": 0}
    p["exposure"] = 1.08
    p["captions"]["enabled"] = False
    p["sources"] = [{"id": "s1", "path": "media/take.mp4", "duration": 2,
                      "width": 64, "height": 96, "fps": 10}]
    p["cut"]["keep"] = [{"from": "w0", "to": "w1"}]
    project.save(tmp_path, p, touch=False)
    project.write_json(tmp_path / "work" / "transcript.json", {"words": [
        {"id": "w0", "source": "s1", "w": "Hello", "s": .1, "e": .9},
        {"id": "w1", "source": "s1", "w": "world", "s": 1, "e": 1.8}]})
    (tmp_path / "media").mkdir()
    subprocess.run([tools.ffmpeg(), "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=64x96:r=10:d=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264",
                    "-c:a", "aac", "-shortest", str(tmp_path / "media" / "take.mp4")], check=True)
    a = render.run(tmp_path, draft=True, root=tmp_path, verify=False, cover=False)
    b = render.run(tmp_path, draft=True, root=tmp_path, verify=False, cover=False)
    assert a["zooms"] > 0
    assert a["variation"] == b["variation"]
    assert project.read_json(tmp_path / "versions" / "preview" / "render_draft.json")["variation"] == a["variation"]


def test_exposure_validation_rejects_unrenderable_values(tmp_path):
    p, _ = reel(tmp_path)
    for value in [.1, 0, -1, "bright", 20]:
        p["exposure"] = value
        assert any("exposure" in problem for problem in project.validate(p))
    for value in [.125, 8]:
        p["exposure"] = value
        assert not project.validate(p)


def test_caption_trial_gets_its_own_render_version(tmp_path):
    from reelengine.variation import create_variant
    from reelengine.render import pick_version
    p, _ = reel(tmp_path)
    create_variant(tmp_path, "caption", value="Another caption")
    assert pick_version(tmp_path, project.load(tmp_path), tmp_path) == p["version"] + 1


def test_accent_ties_only_choose_kept_moments(tmp_path):
    from reelengine.variation import resolve
    p, tl = reel(tmp_path)
    p["zooms"][0]["anchor"] = {"from": "w10", "to": "w12"}
    for seed in [0, 1, 2, 3]:
        p["cutStyle"]["seed"] = seed
        effective, _ = resolve(p, tl)
        assert all(tl.is_kept(z["anchor"]["from"]) and tl.is_kept(z["anchor"]["to"])
                   for z in effective["zooms"])
