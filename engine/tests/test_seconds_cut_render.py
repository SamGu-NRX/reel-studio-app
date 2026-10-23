"""A seconds cut of footage with no speech renders: an empty transcript, then analyze, a draft and
the first look, through the CLI the app calls. A 4-second synthetic clip with a silent track."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


def engine(project: Path, *args: str) -> dict:
    env = dict(os.environ, REELENGINE_ROOT=str(project.parent / "root"), REELENGINE_CACHE=str(project.parent / "cache"))
    r = subprocess.run([sys.executable, "-m", "reelengine", *args, "--project", str(project)],
                       cwd=ENGINE, env=env, capture_output=True, text=True, timeout=300)
    last = json.loads(r.stdout.strip().splitlines()[-1])
    assert last["event"] == "done", (last, r.stderr[-2000:])
    return last["result"]


def test_a_seconds_cut_with_no_speech_renders(tmp_path):
    clip = tmp_path / "match.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "4", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip)], check=True)
    pdir = tmp_path / "match"
    engine(pdir, "init", "--title", "Match", str(clip))
    (pdir / "work" / "transcript.json").write_text(json.dumps({"words": [], "segments": []}))
    p = json.loads((pdir / "project.json").read_text())
    p["format"] = {"width": 360, "height": 640, "fps": 30}
    p["cut"]["keep"] = [{"source": "s1", "start": 2.5, "end": 3.5}, {"source": "s1", "start": 0.5, "end": 1.5}]
    p["brief"] = {"sport": "football"}
    (pdir / "project.json").write_text(json.dumps(p))

    engine(pdir, "analyze")
    for flag in ("--draft", "--first-look"):
        made = engine(pdir, "render", flag)
        assert made["duration"] == pytest.approx(2.0, abs=0.01), flag
        assert Path(made["file"]).stat().st_size > 0
