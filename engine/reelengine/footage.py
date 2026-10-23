"""Content-addressed Library analysis, committed one stage at a time."""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import tempfile
import time
from contextlib import closing
from pathlib import Path

from . import audio_env, probe, project, tools, transcribe
from .proto import EngineError, log, progress

PROBE_VERSION = 1
TRANSCRIPT_VERSION = 1
SHOTS_VERSION = 1


def file_hash(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _signature(path: Path) -> tuple:
    st = path.stat()
    return st.st_size, st.st_mtime_ns


def _unchanged(path: Path, signature: tuple) -> None:
    if _signature(path) != signature:
        raise EngineError("FOOTAGE_CHANGED", f"{path.name} changed during indexing",
                          "A Library file changed while I was reading it. Run the index again.")


def _open(root: Path) -> sqlite3.Connection:
    folder = root / ".index"
    folder.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(folder / "index.sqlite")
    db.row_factory = sqlite3.Row
    try:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY, label TEXT, root TEXT, network INT);
            CREATE TABLE IF NOT EXISTS paths(place TEXT, rel TEXT, size INT, mtime_ns INT, hash TEXT,
                PRIMARY KEY(place, rel));
            CREATE TABLE IF NOT EXISTS files(hash TEXT PRIMARY KEY, hash_kind TEXT,
                duration REAL, fps REAL, width INT, height INT, rotation INT, has_audio INT);
            CREATE TABLE IF NOT EXISTS stages(hash TEXT, stage TEXT, version INT, done_at TEXT,
                error TEXT, PRIMARY KEY(hash, stage));
            CREATE TABLE IF NOT EXISTS words(hash TEXT, s REAL, e REAL, w TEXT, p REAL, model TEXT);
            CREATE INDEX IF NOT EXISTS words_file_model ON words(hash, model);
            CREATE TABLE IF NOT EXISTS transcripts(hash TEXT, model TEXT, language TEXT, segments TEXT,
                word_metadata TEXT,
                PRIMARY KEY(hash, model));
            CREATE TABLE IF NOT EXISTS shots(hash TEXT, n INT, s REAL, e REAL,
                faces INT, face_area REAL, lufs REAL, thumb TEXT, PRIMARY KEY(hash, n));
        """)
        try:
            db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS text_fts USING fts5("
                       "text, hash UNINDEXED, s UNINDEXED, e UNINDEXED, kind UNINDEXED, model UNINDEXED)")
        except sqlite3.OperationalError as exc:
            if "no such module: fts5" not in str(exc).lower():
                raise
            db.execute("CREATE TABLE IF NOT EXISTS text_fts("
                       "text TEXT, hash TEXT, s REAL, e REAL, kind TEXT, model TEXT)")
        db.commit()
        if not _has_fts(db):
            log("Footage search: SQLite FTS5 is unavailable; using literal text search.")
        return db
    except BaseException:
        db.close()
        raise


def _has_fts(db: sqlite3.Connection) -> bool:
    row = db.execute("SELECT sql FROM sqlite_master WHERE name='text_fts'").fetchone()
    return "USING fts5" in row[0]


def _done(db, digest, stage, version) -> bool:
    row = db.execute("SELECT version, error FROM stages WHERE hash=? AND stage=?",
                     (digest, stage)).fetchone()
    return row is not None and row[0] == version and row[1] is None


def _mark_done(db, digest, stage, version):
    db.execute("INSERT OR REPLACE INTO stages VALUES (?, ?, ?, ?, NULL)",
               (digest, stage, version, project.now_iso()))


def _windows(words):
    window = []
    for word in words:
        window.append(word)
        if re.search(r"[.!?][\"']?$", word["w"]) or word["e"] - window[0]["s"] >= 10:
            yield window
            window = []
    if window:
        yield window


def _speech(path, duration, model):
    with tempfile.TemporaryDirectory(prefix="reel-footage-") as temp:
        wav = transcribe.extract_audio(path, Path(temp) / "audio.wav")
        words, segments, language = transcribe._transcribe_one(model, wav, None, None,
                                                              duration, 0, 100)
        samples = audio_env.read_wav(wav)
        env = audio_env.envelope(samples)
        words.sort(key=lambda word: (word["s"], word["e"]))
        words = audio_env.refine_words(words, env, audio_env.noise_threshold(env),
                                      len(samples) / audio_env.SR)
        counts = {}
        for word in words:
            n = word.get("_seg")
            counts[n] = counts.get(n, 0) + 1
        if None not in counts:
            active = [n for n in range(len(segments)) if counts.get(n)]
            segments = [{**segments[n], "n": counts[n]} for n in active]
            remap = {old: new for new, old in enumerate(active)}
            for word in words:
                word["_seg"] = remap[word["_seg"]]
        return words, segments, language


def _shots(path, duration, has_video):
    cuts = []
    if has_video:
        # 0.3 is an initial scene-score threshold, not measured on user footage. Scale first
        # to keep this pass small; version this stage when detection changes.
        result = tools.text_run([
            tools.ffmpeg(), "-nostdin", "-hide_banner", "-nostats", "-i", str(path),
            "-an", "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo",
            "-f", "null", "-",
        ], 1800, f"find scenes in {path.name}")
        cuts = [float(t) for t in re.findall(r"pts_time:\s*([0-9.eE+-]+)", result.stderr)]
    edges = [0.0] + sorted({t for t in cuts if 0 < t < duration}) + [duration]
    return [(n, s, e) for n, (s, e) in enumerate(zip(edges, edges[1:])) if e > s]


def index(root: Path, *, model_name: str | None = None, budget_seconds: float | None = None) -> dict:
    if budget_seconds is not None and (not math.isfinite(budget_seconds) or budget_seconds < 0):
        raise EngineError("BAD_ARGS", "budget-seconds must be finite and nonnegative",
                          "Choose a time budget of zero seconds or more.")
    root = Path(root)
    library = root / "Library"
    name = model_name or transcribe.default_model()
    stages = [("probe", PROBE_VERSION), (f"transcript:{name}", TRANSCRIPT_VERSION), ("shots", SHOTS_VERSION)]
    deadline = time.monotonic() + budget_seconds if budget_seconds is not None else math.inf
    model = None
    with closing(_open(root)) as db:
        found = []
        with db:
            db.execute("INSERT OR REPLACE INTO places VALUES ('Library', 'Library', 'Library', 0)")
            for path in sorted(library.rglob("*")):
                if path.suffix.lower() not in probe.VIDEO_EXT | probe.AUDIO_EXT or not path.is_file():
                    continue
                if path.is_symlink() or not path.resolve().is_relative_to(library.resolve()):
                    continue
                rel = path.relative_to(library).as_posix()
                signature = _signature(path)
                old = db.execute("SELECT size, mtime_ns, hash FROM paths WHERE place='Library' AND rel=?",
                                 (rel,)).fetchone()
                digest = old[2] if old and tuple(old[:2]) == signature else file_hash(path)
                _unchanged(path, signature)
                db.execute("INSERT OR REPLACE INTO paths VALUES ('Library', ?, ?, ?, ?)",
                           (rel, *signature, digest))
                found.append((path, digest, signature))
            rels = {path.relative_to(library).as_posix() for path, _, _ in found}
            for row in db.execute("SELECT rel FROM paths WHERE place='Library'").fetchall():
                if row[0] not in rels:
                    db.execute("DELETE FROM paths WHERE place='Library' AND rel=?", (row[0],))

        ran = 0
        for path, digest, signature in found:
            for stage, version in stages:
                if _done(db, digest, stage, version):
                    continue
                if time.monotonic() >= deadline:
                    break
                _unchanged(path, signature)
                if stage == "probe":
                    info = probe.probe(path, quick=True)
                    _unchanged(path, signature)
                    with db:
                        db.execute("INSERT OR REPLACE INTO files VALUES (?, 'sha256', ?, ?, ?, ?, ?, ?)",
                                   (digest, info["duration"], info["fps"], info["width"], info["height"],
                                    info["rotation"], int(info["hasAudio"])))
                        _mark_done(db, digest, stage, version)
                else:
                    info = db.execute("SELECT * FROM files WHERE hash=?", (digest,)).fetchone()
                    if stage.startswith("transcript:"):
                        words, segments, language = [], [], None
                        if info["has_audio"]:
                            if model is None:
                                model, _, _ = transcribe.load_model(name)
                            words, segments, language = _speech(path, info["duration"], model)
                        _unchanged(path, signature)
                        with db:
                            db.execute("DELETE FROM words WHERE hash=? AND model=?", (digest, name))
                            db.executemany("INSERT INTO words VALUES (?, ?, ?, ?, ?, ?)",
                                           [(digest, w["s"], w["e"], w["w"], w.get("p"), name) for w in words])
                            # Audio gaps drive cuts; segment tags keep vocabulary joins within a segment.
                            metadata = [{k: v for k, v in w.items() if k not in {"s", "e", "w", "p"}}
                                        for w in words]
                            db.execute("INSERT OR REPLACE INTO transcripts VALUES (?, ?, ?, ?, ?)",
                                       (digest, name, language, json.dumps(segments), json.dumps(metadata)))
                            db.execute("DELETE FROM text_fts WHERE hash=? AND model=?", (digest, name))
                            db.executemany("INSERT INTO text_fts VALUES (?, ?, ?, ?, 'speech', ?)",
                                           [(" ".join(w["w"] for w in win), digest, win[0]["s"], win[-1]["e"], name)
                                            for win in _windows(words)])
                            _mark_done(db, digest, stage, version)
                    else:
                        shots = _shots(path, info["duration"], info["width"] > 0)
                        _unchanged(path, signature)
                        with db:
                            db.execute("DELETE FROM shots WHERE hash=?", (digest,))
                            db.executemany("INSERT INTO shots(hash, n, s, e) VALUES (?, ?, ?, ?)",
                                           [(digest, *shot) for shot in shots])
                            _mark_done(db, digest, stage, version)
                ran += 1
                progress("footage-" + stage.split(":")[0], 100, f"Indexed {path.name}", force=True)
        pending = sum(not _done(db, digest, stage, version) for digest in {d for _, d, _ in found}
                      for stage, version in stages)
        return {"files": len(found), "stagesRun": ran, "pending": pending}


def lookup(root: Path, path: Path, model: str, language: str | None = None):
    """Read only full-hash, current-model words; an absent index costs no writes."""
    database = Path(root).resolve() / ".index" / "index.sqlite"
    if not database.is_file():
        return None
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        digest = file_hash(path)
        if not _done(db, digest, f"transcript:{model}", TRANSCRIPT_VERSION):
            return None
        row = db.execute("SELECT t.* FROM transcripts t JOIN files f USING(hash) "
                         "WHERE t.hash=? AND t.model=? AND f.hash_kind='sha256'", (digest, model)).fetchone()
        if row is None or (language and language != row["language"]):
            return None
        words = [dict(w) for w in db.execute("SELECT s, e, w, p FROM words WHERE hash=? AND model=? ORDER BY s, e",
                                            (digest, model))]
        for word, metadata in zip(words, json.loads(row["word_metadata"])):
            word.update(metadata)
        return words, json.loads(row["segments"]), row["language"]


def search(root: Path, query: str, *, limit: int = 8) -> dict:
    if not query.strip() or not 1 <= limit <= 8:
        raise EngineError("BAD_ARGS", "search needs a query and limit between 1 and 8",
                          "Enter some words to find and choose up to eight results.")
    root = Path(root)
    with closing(_open(root)) as db:
        fts = _has_fts(db)
        if fts:
            rows = db.execute("SELECT * FROM text_fts WHERE text_fts MATCH ? ORDER BY rank, hash, s",
                              ('"' + query.replace('"', '""') + '"',))
        else:
            rows = db.execute("SELECT * FROM text_fts WHERE instr(lower(text), lower(?)) > 0 ORDER BY hash, s",
                              (query,))
        hits, seen = [], set()
        for row in rows:
            digest = row["hash"]
            key = (digest, row["s"], row["e"])
            if key in seen or not _done(db, digest, f"transcript:{row['model']}", TRANSCRIPT_VERSION):
                continue
            paths = db.execute("SELECT * FROM paths WHERE hash=? ORDER BY rel", (digest,)).fetchall()
            current = next((p for p in paths if (root / "Library" / p["rel"]).is_file()
                            and _signature(root / "Library" / p["rel"]) == (p["size"], p["mtime_ns"])), None)
            if not paths or current is None:
                continue
            info = db.execute("SELECT duration FROM files WHERE hash=?", (digest,)).fetchone()
            s, e = row["s"], row["e"]
            if _done(db, digest, "shots", SHOTS_VERSION):
                shot = db.execute("SELECT min(s), max(e) FROM shots WHERE hash=? AND e>? AND s<?",
                                  (digest, s, e)).fetchone()
                if shot[0] is not None:
                    s, e = shot
            hits.append({"hit": f"{digest[:12]}@{s:.2f}-{e:.2f}",
                         "file": {"name": Path(current["rel"]).name, "place": "Library",
                                  "online": True, "duration": info[0]},
                         "t0": s, "t1": e, "said": row["text"]})
            seen.add(key)
            if len(hits) > limit:
                break
        return {"hits": hits[:limit], "more": len(hits) > limit,
                "backend": "fts5" if fts else "literal"}
