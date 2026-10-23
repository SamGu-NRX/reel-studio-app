"""Platform export covers."""
import subprocess

from reelengine import export_media, tools


def test_a_cover_scrubbed_to_the_very_end_still_gets_a_frame(tmp_path):
    clip = tmp_path / "export.mp4"
    subprocess.run([tools.ffmpeg(), "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=270x480:rate=30:duration=2",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(clip)], check=True)
    out = tmp_path / "cover.jpg"
    export_media.cover(clip, out, 2.0)
    assert out.read_bytes()[:2] == b"\xff\xd8"


def _mean_luma(path):
    out = subprocess.run([tools.ffmpeg(), "-v", "error", "-i", str(path), "-frames:v", "1", "-vf",
                          "scale=32:32,format=gray", "-f", "rawvideo", "-"], check=True, capture_output=True).stdout
    return sum(out) / len(out)


def _grey_clip(tmp_path):
    clip = tmp_path / "export.mp4"
    subprocess.run([tools.ffmpeg(), "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x606060:size=270x480:rate=30:duration=1",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(clip)], check=True)
    return clip


def test_a_try_2_brightness_step_brightens_the_video_and_its_cover(tmp_path):
    clip = _grey_clip(tmp_path)
    plain, bright = tmp_path / "plain.mp4", tmp_path / "bright.mp4"
    export_media.encode(clip, plain, 720, 1280, 1_000_000)
    export_media.encode(clip, bright, 720, 1280, 1_000_000, brightness=0.1)
    assert _mean_luma(bright) > _mean_luma(plain) + 10
    plain_cover, bright_cover = tmp_path / "plain.jpg", tmp_path / "bright.jpg"
    export_media.cover(clip, plain_cover, 0.5)
    export_media.cover(clip, bright_cover, 0.5, brightness=0.1)
    assert _mean_luma(bright_cover) > _mean_luma(plain_cover) + 10


def test_a_brightness_step_out_of_range_is_refused(tmp_path):
    clip = _grey_clip(tmp_path)
    try:
        export_media.encode(clip, tmp_path / "x.mp4", 720, 1280, 1_000_000, brightness=0.9)
    except export_media.EngineError as e:
        assert e.code == "BAD_ARGS"
    else:
        raise AssertionError("a brightness of 0.9 was accepted")
