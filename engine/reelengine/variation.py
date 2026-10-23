"""Repeatable choices within a cut style, and edits for one-variable trials."""
from __future__ import annotations

import copy
import math
import os
import random
import secrets
from pathlib import Path

from . import project as projects
from .cut_style import CUT_STYLES
from .proto import EngineError

VARIABLES = ("seed", "hook", "cover", "caption", "brightness")


def resolve(project: dict, timeline) -> tuple[dict, dict | None]:
    p = copy.deepcopy(project)
    style = p.get("cutStyle")
    if not style:
        return p, None
    settings = CUT_STYLES[style["preset"]]
    rng = random.Random(style["seed"])
    pair = [settings["framingPair"][0], round(settings["framingPair"][1] + rng.uniform(-.03, .03), 6)]
    start = rng.randrange(2)
    lead = round(rng.uniform(.10, .16), 6)
    phase = round(rng.uniform(-.5, .5), 6)
    choices, offsets = {}, []
    groups, grouped = {}, set()
    for i, z in enumerate(p.get("zooms") or []):
        group = z.get("accentGroup")
        if isinstance(group, str) and group:
            grouped.add(i)
            anchor = z.get("anchor") or {}
            if timeline.is_kept(anchor.get("from")) and timeline.is_kept(anchor.get("to")):
                groups.setdefault(group, []).append(i)
    for group, indices in groups.items():
        choices[group] = rng.choice(indices)
    selected = set(choices.values())
    p["zooms"] = [z for i, z in enumerate(p.get("zooms") or []) if i not in grouped or i in selected]
    ramps = []
    for z in p["zooms"]:
        z["scale"] = pair[1]
        # All variation draws share this local generator in a fixed order.
        frames = max(1, round(.22 * p["format"]["fps"]) + rng.randint(-2, 2))
        z["resolvedRampFrames"] = frames
        ramps.append(frames)
    for b in p.get("broll") or []:
        b["leadIn"] = lead
    for i, keep in enumerate((p.get("cut") or {}).get("keep") or []):
        join = keep.get("join")
        if isinstance(join, dict) and join.get("transition") in ("j", "l"):
            join["frames"] = rng.randint(6, 12)
            offsets.append({"join": i, "frames": join["frames"]})
    band = settings["secondsPerVisualChange"]
    framing = []
    if timeline.duration > 0:
        changes = [0.0]
        if band:
            cadence = sum(band) / 2
            target = cadence + phase
            boundaries = sorted({float(w["s"]) for w in timeline.words_out if w["s"] > 0})
            while target < timeline.duration:
                candidates = [t for t in boundaries if t > changes[-1] and abs(t - target) <= .5]
                if candidates:
                    changes.append(min(candidates, key=lambda t: (abs(t - target), t)))
                target += cadence
        for i, t0 in enumerate(changes):
            framing.append({"t0": t0, "t1": changes[i + 1] if i + 1 < len(changes) else timeline.duration,
                            "scale": pair[(start + i) % 2]})
    return p, {"seed": style["seed"], "framingPair": pair, "startFraming": start,
               "cardLead": lead, "cadencePhase": phase, "accentChoices": choices,
               "jlOffsets": offsets, "zoomRamps": ramps, "framing": framing}


def _bad(message):
    raise EngineError("BAD_VARIANT", message, message)


def _value(p, variable):
    if variable == "seed":
        return (p.get("cutStyle") or {}).get("seed")
    if variable == "hook":
        return ((p.get("cut") or {}).get("keep") or [None])[0]
    if variable == "cover":
        return p.get("cover")
    if variable == "caption":
        return (p.get("post") or {}).get("caption", "")
    return p.get("exposure", 1.0)


def make_variant(project: dict, variable: str, *, value=None) -> dict:
    """Return a copy changing one edit variable; the editor supplies semantic alternatives."""
    if variable not in VARIABLES:
        _bad("variable must be seed, hook, cover, caption, or brightness")
    p = copy.deepcopy(project)
    before = _value(p, variable)
    if variable == "seed":
        if not p.get("cutStyle"):
            _bad("Choose a cut style before making a seed trial.")
        if value is not None:
            _bad("Seed trials generate their own seed; omit value.")
        seed = secrets.randbelow(2 ** 31)
        while seed == before:
            seed = secrets.randbelow(2 ** 31)
        p["cutStyle"]["seed"] = seed
    elif variable == "hook":
        if not before or not isinstance(value, dict) or set(value) != {"from", "to"} or not all(isinstance(v, str) and v for v in value.values()):
            _bad("A hook trial needs the editor's different opening candidate.")
        p["cut"]["keep"][0] = {**before, **value}
    elif variable == "cover":
        if not isinstance(value, dict) or set(value) - {"atSourceTime", "source", "text", "exact"}:
            _bad("A cover trial needs a source time and source.")
        p["cover"] = {**(before or {}), **value}
        src = next((s for s in p.get("sources", []) if s["id"] == p["cover"].get("source")), None)
        at = p["cover"].get("atSourceTime")
        if not src or type(at) not in (int, float) or not math.isfinite(at) or at < 0 or (src.get("duration") and at >= src["duration"]):
            _bad("The cover time must be inside the source.")
    elif variable == "caption":
        if not isinstance(value, str) or not value.strip():
            _bad("A caption trial needs a non-empty caption.")
        p.setdefault("post", {})["caption"] = value
    else:
        if value is None:
            value = 8
        if type(value) not in (int, float) or value not in (-8, 8):
            _bad("Brightness trials need +8 or -8 percent exposure.")
        p["exposure"] = round(before * (1 + value / 100), 8)
    if _value(p, variable) == before:
        _bad("The alternative must differ from the current edit.")
    problems = projects.validate(p)
    if problems:
        _bad("Invalid variant: " + "; ".join(problems[:8]))
    return p


def create_variant(project_dir: Path, variable: str, *, value=None) -> dict:
    """Save the new edit with its trial record and preserve the parent's version snapshot."""
    project_dir = Path(project_dir)
    lock = project_dir / ".trial-lock"
    try:
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        _bad("Another trial is being saved. Try again when it finishes.")
    try:
        parent = projects.load(project_dir)
        variant = make_variant(parent, variable, value=value)
        if variable == "hook":
            words = projects.load_transcript(project_dir, parent)["words"]
            index = {w["id"]: i for i, w in enumerate(words)}
            seen = set()
            for keep in variant["cut"]["keep"]:
                a, b = index.get(keep["from"]), index.get(keep["to"])
                if a is None or b is None or b < a or seen.intersection(range(a, b + 1)):
                    _bad("The hook must use real, forward word IDs without repeating the body.")
                seen.update(range(a, b + 1))
        trial = {"parent_version": parent.get("version", 0), "variable": variable,
                 "from": _value(parent, variable), "to": _value(variant, variable)}
        trial_path = project_dir / "trials.json"
        trials = projects.read_json(trial_path) if trial_path.exists() else []
        if not isinstance(trials, list):
            _bad("trials.json must contain a list of trials.")
        snapshot = project_dir / "versions" / f"v{parent.get('version', 0)}" / "project.json"
        if not snapshot.exists():
            projects.write_json(snapshot, parent)
        projects.write_json(trial_path, [*trials, trial])
        try:
            projects.save(project_dir, variant, touch=False)
        except Exception:
            projects.write_json(trial_path, trials)
            raise
        return {"project": variant, "trial": trial}
    finally:
        os.close(fd)
        lock.unlink()
