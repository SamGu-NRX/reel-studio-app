"""Shared cut-style vocabulary and render-time visual-change meter."""
from __future__ import annotations

CUT_STYLES = {
    # These values are lead decisions and have not been tested on Reel Studio output yet.
    "clean": {"secondsPerVisualChange": [6, 10], "framingPair": [1.0, 1.1], "jlBridges": 3, "smashes": 0, "sfxOnCuts": 0, "beatAccents": False, "extraVisualsFirst5s": False},
    "standard": {"secondsPerVisualChange": [3, 5], "framingPair": [1.0, 1.15], "jlBridges": 3, "smashes": 1, "sfxOnCuts": 2, "beatAccents": False, "extraVisualsFirst5s": False},
    "hyper": {"secondsPerVisualChange": [1.5, 3], "framingPair": [1.0, 1.3], "jlBridges": 0, "smashes": 2, "sfxOnCuts": 8, "beatAccents": True, "extraVisualsFirst5s": True},
    "punchline": {"secondsPerVisualChange": None, "framingPair": [1.0, 1.25], "jlBridges": 0, "smashes": 4, "sfxOnCuts": 4, "beatAccents": False, "extraVisualsFirst5s": False},
}


def visual_change_meter(duration, segments, broll, zooms, *, visual_offset=0.0):
    """Segments are render-relative; b-roll and zooms use the full output clock.

    Count starts in [0, duration), excluding visuals already active before a window.
    """
    duration = max(0.0, float(duration or 0.0))
    events = {
        "cuts": [float(s.out_start) for s in list(segments)[1:]],
        "brollStarts": [float(x.get("t0")) - visual_offset for x in broll if isinstance(x, dict) and x.get("t0") is not None and not x.get("skipped") and int(x.get("layers", 1) or 0) > 0],
        "zoomStarts": [float(z.t0) - visual_offset for z in zooms],
    }
    def window(seconds):
        end = min(duration, seconds)
        counts = {k: sum(0 <= t < end for t in ts) for k, ts in events.items()}
        total = sum(counts.values())
        return {"seconds": round(end, 3), **counts, "total": total, "perMinute": round(total * 60 / end, 3) if end else 0}
    return {"overall": window(duration), "first5": window(5), "first30": window(30)}
