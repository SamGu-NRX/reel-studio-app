"""Fails if YuNet can't load its model from a folder whose path has letters outside the Windows code page.

Windows installs a per-user app under C:\\Users\\<name>\\AppData\\Local\\Programs, and the name may be Zoë. OpenCV opened
the model by path, which it does through the ANSI file API on Windows, so the face detector quietly fell back to Haar
(seen in the installed v0.1.3-nightly.20261029.11 under "Programmes Été")."""
import shutil

import pytest

from reelengine import placement


def test_yunet_loads_its_model_from_a_folder_named_with_accents(tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    if not hasattr(cv2, "FaceDetectorYN"):
        pytest.skip("this OpenCV has no FaceDetectorYN")
    folder = tmp_path / "Zoë Müller"
    folder.mkdir()
    model = folder / placement.YUNET_MODEL.name
    shutil.copyfile(placement.YUNET_MODEL, model)
    monkeypatch.setattr(placement, "YUNET_MODEL", model)
    assert placement._Detector(320, 320).kind == "yunet"
