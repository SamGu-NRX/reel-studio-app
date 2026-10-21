"""Repeat frames_experiment's retained timestamps against main and this worktree.
Each invocation is a fresh process so ru_maxrss belongs to one frame-selection run.
Cover scoring is measured afterward, outside the reported frame-selection RSS.
"""
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time
from types import SimpleNamespace

REPO = Path('~/Programming Projects/reel-studio-app-wt/cover-frame-streaming')
sys.path.insert(0, str(REPO / 'engine'))
os.environ.update(REELENGINE_FFMPEG='/Applications/Reel Studio.app/Contents/Resources/ffmpeg/ffmpeg',
                  REELENGINE_FFPROBE='/Applications/Reel Studio.app/Contents/Resources/ffmpeg/ffprobe',
                  REELENGINE_EXTRA_READ_DIRS='~/Downloads/Video')
from reelengine import compose_util as u, cover

stem, mode = sys.argv[1:]
if mode == 'baseline':
    source = subprocess.check_output(['git', 'show', '8f61817:engine/reelengine/compose_util.py'], cwd=REPO, text=True)
    namespace = dict(u.__dict__)
    exec(compile(source, str(REPO / 'engine/reelengine/compose_util.py'), 'exec'), namespace)
    decode = namespace['decode_frames']
else:
    decode = u.decode_frames
cover.decode_frames = decode
src = Path('~/Downloads/Video') / ('IMG_7303.mov' if stem == 'IMG_7303' else 'aiden-v1-new.mp4')
reference = json.loads(Path(f'/tmp/rs-perf/frames_{stem}_baseline.json').read_text())
times = [row[0] for row in reference['hashes']]
info = u.probe(src)
started = time.perf_counter()
hashes = [(t, hashlib.sha256(frame.tobytes()).hexdigest()) for t, frame in decode(src, 1, 480, times=times)]
elapsed = time.perf_counter() - started
result = {'clip': stem, 'mode': mode, 'base_sha': '8f61817', 'source': str(src), 'seconds': elapsed,
          'rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2,
          'hashes': hashes, 'matches_retained_baseline': hashes == [tuple(row) for row in reference['hashes']],
          'dense_window': u._dense_window(times, info)}
# Use the real cover scorer on the retained candidate list. The old scratch projects
# were removed, so this comparison has no transcript-based between-word bonus.
ctx = SimpleNamespace(project_dir=Path('/tmp/rs-cover'), root=Path('/tmp/rs-cover/root'),
                      project={'sources': [{'id': 's1', 'path': str(src)}]}, words=[])
rows = cover.score_frames(ctx, 's1', times)
best = max(rows, key=lambda row: row.get('score', 0.0))
result.update(chosen=best['t'] if best.get('score') else times[len(times)//2], best=best, scores=rows,
              cover_context='retained candidate times; no transcript bonus')
Path(f'/tmp/rs-cover/frames_{stem}_{mode}.json').write_text(json.dumps(result, indent=2))
print({k:v for k,v in result.items() if k not in ('hashes', 'scores', 'best')}, flush=True)
