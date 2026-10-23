"""Footage commands retain completed work and share speech across copied files."""
import json
import os
import shutil
import sqlite3
import subprocess
import sys

import pytest

from reelengine import audio_env, cli, project, transcribe, tools


@pytest.fixture(scope="module")
def clips(tmp_path_factory):
    folder = tmp_path_factory.mktemp("footage-clips")
    paths = []
    for n, colors in enumerate((("red", "blue"), ("green", "white"))):
        out = folder / f"clip{n}.mp4"
        tools.text_run([
            tools.ffmpeg(), "-y", "-nostdin", "-v", "error",
            "-f", "lavfi", "-i", f"color={colors[0]}:s=64x64:r=10:d=1",
            "-f", "lavfi", "-i", f"color={colors[1]}:s=64x64:r=10:d=1",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
            "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(out),
        ], 60, "generate footage fixture")
        paths.append(out)
    return paths


@pytest.fixture
def library(tmp_path, clips, monkeypatch):
    root = tmp_path / "studio"
    lib = root / "Library"
    lib.mkdir(parents=True)
    shutil.copyfile(clips[0], lib / "a.mp4")
    monkeypatch.setenv("REELENGINE_ROOT", str(root))
    monkeypatch.setenv("REELSTUDIO_ROOT", str(root))
    monkeypatch.setenv("REELENGINE_MODEL", "small.en")
    monkeypatch.delenv("REELENGINE_HINTS", raising=False)
    monkeypatch.setenv("REELENGINE_VOCAB", "0")
    calls = []

    def fake_one(model, wav, language, prompt, duration, p0, p1, hotwords=None):
        calls.append(wav)
        return ([{"s": .25, "e": .5, "w": "twenty", "p": .9, "_seg": 0},
                 {"s": .55, "e": .8, "w": "bucks.", "p": .8, "_seg": 0}],
                [{"s": .25, "e": .8, "text": "twenty bucks.", "n": 2}], "en")

    monkeypatch.setattr(transcribe, "require_model", lambda name: tmp_path)
    monkeypatch.setattr(transcribe, "load_model", lambda name, prefer=None: (object(), "cpu", "int8"))
    monkeypatch.setattr(transcribe, "_transcribe_one", fake_one)
    monkeypatch.setattr(audio_env, "refine_words", lambda words, *a, **k: words)
    return root, calls


def command(root, *args):
    parsed = cli.build_parser().parse_args(["footage", *args, "--root", str(root)])
    return parsed.fn(parsed)


def connect(root):
    return sqlite3.connect(root / ".index" / "index.sqlite")


def test_copies_share_one_transcript(library):
    root, calls = library
    shutil.copyfile(root / "Library/a.mp4", root / "Library/copy.mp4")
    result = command(root, "index")
    with connect(root) as db:
        assert db.execute("SELECT count(*) FROM files").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM paths").fetchone()[0] == 2
    assert len(calls) == 1
    assert result == {"files": 2, "stagesRun": 3, "pending": 0}


def test_interrupted_run_keeps_committed_stages(library, clips):
    root, calls = library
    shutil.copyfile(clips[1], root / "Library/b.mp4")
    child = subprocess.run([sys.executable, "-c", """
import os, sys
from pathlib import Path
from reelengine import audio_env, footage, transcribe
root = Path(sys.argv[1])
transcribe.load_model = lambda name: (object(), 'cpu', 'int8')
def fake_one(*args, **kwargs):
    with (root / 'speech-calls').open('a') as calls:
        calls.write('called\\n')
    return ([{'s': .25, 'e': .5, 'w': 'twenty', 'p': .9, '_seg': 0},
             {'s': .55, 'e': .8, 'w': 'bucks.', 'p': .8, '_seg': 0}],
            [{'s': .25, 'e': .8, 'text': 'twenty bucks.', 'n': 2}], 'en')
transcribe._transcribe_one = fake_one
audio_env.refine_words = lambda words, *a, **k: words
def stop(stage, *args, **kwargs):
    if stage == 'footage-transcript':
        os._exit(73)
footage.progress = stop
footage.index(root)
""", str(root)], capture_output=True, text=True, timeout=60)
    assert child.returncode == 73, child.stderr
    with connect(root) as db:
        assert db.execute("SELECT stage FROM stages ORDER BY stage").fetchall() == [
            ("probe",), ("transcript:small.en",)]
        assert db.execute("SELECT count(*) FROM words").fetchone()[0] == 2
    result = command(root, "index")
    assert result["stagesRun"] == 4
    assert result["pending"] == 0
    assert len(calls) == 1
    assert (root / "speech-calls").read_text().splitlines() == ["called"]
    with connect(root) as db:
        assert db.execute("SELECT count(*) FROM stages").fetchone()[0] == 6
        assert db.execute("SELECT count(*) FROM shots").fetchone()[0] == 4


def test_touch_rehashes_without_rerunning_stages(library, monkeypatch):
    root, calls = library
    command(root, "index")
    from reelengine import footage
    hashed = []
    real_hash = footage.file_hash

    def count_hash(path):
        hashed.append(path)
        return real_hash(path)

    monkeypatch.setattr(footage, "file_hash", count_hash)
    assert command(root, "index")["stagesRun"] == 0
    assert not hashed
    clip = root / "Library/a.mp4"
    st = clip.stat()
    os.utime(clip, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    assert command(root, "index")["stagesRun"] == 0
    assert hashed == [clip]
    assert len(calls) == 1


def test_indexed_words_keep_audio_boundaries_and_vocabulary_segments(library, monkeypatch):
    root, _ = library

    def fake_one(*args, **kwargs):
        return ([{"s": .25, "e": .5, "w": "Code", "p": .4, "_seg": 0},
                 {"s": .55, "e": .8, "w": "Rabbit.", "p": .4, "_seg": 0}],
                [{"s": .25, "e": .8, "text": "Code Rabbit.", "n": 2}], "en")

    def refined(words, *args):
        return [{**word, "ws": word["s"] - .01, "we": word["e"] + .01,
                 "gaps": [[.3, .35]]} for word in words]

    monkeypatch.setattr(transcribe, "_transcribe_one", fake_one)
    monkeypatch.setattr(audio_env, "refine_words", refined)
    command(root, "index")
    pdir = root / "Projects/vocab"
    proj = project.new_project("My video")
    proj["sources"] = [{"id": "s1", "path": "Library/a.mp4", "duration": 2.0}]
    project.save(pdir, proj)
    transcribe.run(pdir, model_name="small.en")
    data = project.read_json(pdir / "work/transcript.json")
    assert data["words"][0]["gaps"] == [[.3, .35]]
    assert data["words"][0]["ws"] == .24
    proj = project.load(pdir)
    proj["captions"]["corrections"] = [{"from": "Code Rabbit", "to": "CodeRabbit"}]
    project.save(pdir, proj)
    monkeypatch.setenv("REELENGINE_VOCAB", "1")
    transcribe.run(pdir, model_name="small.en")
    data = project.read_json(pdir / "work/transcript.json")
    assert [word["w"] for word in data["words"]] == ["CodeRabbit."]
    assert data["segments"][0]["from"] == data["segments"][0]["to"]


def test_search_returns_speech_times_snapped_to_shots(library):
    root, _ = library
    command(root, "index")
    result = command(root, "search", "--query", "twenty bucks")
    hit, = result["hits"]
    assert hit["said"] == "twenty bucks."
    assert hit["t0"] == 0 and hit["t1"] == pytest.approx(1, abs=.11)
    assert hit["t0"] <= .25 < .8 <= hit["t1"]
    assert hit["file"] == {"name": "a.mp4", "place": "Library", "online": True, "duration": 2.0}
    assert hit["hit"].endswith(f"@{hit['t0']:.2f}-{hit['t1']:.2f}")
    assert not result["more"]
    assert command(root, "search", "--query", "absent")["hits"] == []


def test_search_without_fts5_reports_literal_fallback(library, monkeypatch, capsys):
    root, _ = library
    from reelengine import footage
    real_connect = sqlite3.connect

    class NoFTS(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            if sql.startswith("CREATE VIRTUAL TABLE"):
                raise sqlite3.OperationalError("no such module: fts5")
            return super().execute(sql, parameters)

    monkeypatch.setattr(footage.sqlite3, "connect",
                        lambda *args, **kwargs: real_connect(*args, factory=NoFTS, **kwargs))
    command(root, "index")
    result = command(root, "search", "--query", "twenty bucks")
    assert result["backend"] == "literal"
    assert result["hits"][0]["said"] == "twenty bucks."
    assert result["hits"][0]["t0"] <= .25 < .8 <= result["hits"][0]["t1"]
    assert "FTS5 is unavailable" in capsys.readouterr().err


def test_budget_and_stage_versions_resume_only_missing_work(library, monkeypatch):
    root, calls = library
    assert command(root, "index", "--budget-seconds", "0") == {
        "files": 1, "stagesRun": 0, "pending": 3}
    assert not calls
    command(root, "index")
    from reelengine import footage
    monkeypatch.setattr(footage, "SHOTS_VERSION", footage.SHOTS_VERSION + 1)
    assert command(root, "index") == {"files": 1, "stagesRun": 1, "pending": 0}
    assert len(calls) == 1
    assert command(root, "index", "--model", "tiny.en")["stagesRun"] == 1
    assert len(calls) == 2
    with connect(root) as db:
        assert db.execute("SELECT DISTINCT model FROM words ORDER BY model").fetchall() == [
            ("small.en",), ("tiny.en",)]


def test_transcribe_imports_indexed_words_with_stable_ids(library, monkeypatch):
    root, calls = library
    command(root, "index")
    pdir = root / "Projects/test"
    (pdir / "media").mkdir(parents=True)
    shutil.copyfile(root / "Library/a.mp4", pdir / "media/take.mp4")
    proj = project.new_project("My video")
    proj["sources"] = [{"id": "s1", "path": "media/take.mp4", "duration": 2.0}]
    project.save(pdir, proj)

    def forbidden(*args, **kwargs):
        pytest.fail("indexed transcription must not load whisper or extract audio")

    monkeypatch.setattr(transcribe, "load_model", forbidden)
    monkeypatch.setattr(transcribe, "require_model", forbidden)
    monkeypatch.setattr(transcribe, "extract_audio", forbidden)
    for _ in range(2):
        transcribe.run(pdir, model_name="small.en")
        data = json.loads((pdir / "work/transcript.json").read_text())
        assert [(w["id"], w["source"], w["s"], w["e"], w["w"]) for w in data["words"]] == [
            ("w0", "s1", .25, .5, "twenty"), ("w1", "s1", .55, .8, "bucks.")]
        assert data["segments"][0]["from"] == "w0"
        assert data["segments"][0]["to"] == "w1"
    assert len(calls) == 1
