"""Whisper hearing no words: a seconds cut (footage edited elsewhere, maybe with no commentary) still
gets its transcript; any other cut is told there is no speech. Whisper itself is faked."""
import json
import wave

import numpy as np
import pytest

from reelengine import project as projmod, transcribe
from reelengine.proto import EngineError


def _wav(path):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(np.zeros(16000, dtype=np.int16).tobytes())


def _transcribe(tmp_path, monkeypatch, keep):
    pdir = tmp_path / "p"
    (pdir / "media").mkdir(parents=True)
    _wav(pdir / "media" / "match.wav")
    proj = projmod.new_project("Match")
    proj["sources"] = [{"id": "s1", "path": "media/match.wav", "duration": 1.0}]
    proj["cut"]["keep"] = keep
    proj["zooms"] = [{"anchor": {"from": "w0", "to": "w0"}, "scale": 1.1}]
    projmod.save(pdir, proj)
    # an earlier transcript heard a word: re-pointing anchors must cope with hearing none now
    projmod.write_json(pdir / "work" / "transcript.json",
                       {"nextId": 1, "words": [{"id": "w0", "source": "s1", "s": 0.1, "e": 0.4, "w": "goal"}]})
    monkeypatch.setattr(transcribe, "require_model", lambda name: tmp_path)
    monkeypatch.setattr(transcribe, "load_model", lambda name, prefer=None: (object(), "cpu", "int8"))
    monkeypatch.setattr(transcribe, "_transcribe_one", lambda *a, **k: ([], [], "en"))
    monkeypatch.setattr(transcribe, "extract_audio", lambda sp, wav: (wav.parent.mkdir(parents=True, exist_ok=True), _wav(wav)))
    return pdir, transcribe.run(pdir)


def test_a_seconds_cut_gets_an_empty_transcript(tmp_path, monkeypatch):
    keep = [{"source": "s1", "start": 0.0, "end": 1.0}]
    pdir, r = _transcribe(tmp_path, monkeypatch, keep)
    t = json.loads((pdir / "work" / "transcript.json").read_text())
    assert r["words"] == 0 and t["words"] == [] and t["segments"] == [] and t["nextId"] == 1
    proj = projmod.load(pdir)
    assert proj["transcript"]["file"] == projmod.TRANSCRIPT_REL and proj["cut"]["keep"] == keep


def test_a_word_cut_hearing_nothing_is_no_speech(tmp_path, monkeypatch):
    with pytest.raises(EngineError) as e:
        _transcribe(tmp_path, monkeypatch, [{"from": "w0", "to": "w0"}])
    assert e.value.code == "NO_SPEECH"
