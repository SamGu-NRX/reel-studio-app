"""Build a real speech index without a model download."""
import json
import sys
from pathlib import Path

from reelengine import footage, tools, transcribe

root = Path(sys.argv[1])
if len(sys.argv) == 2:
    clip = root / 'Library' / 'take.mp4'
    clip.parent.mkdir(parents=True, exist_ok=True)
    tools.text_run([tools.ffmpeg(), '-y', '-nostdin', '-v', 'error',
                    '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=2',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(clip)], 30, 'fixture')
transcribe.load_model = lambda name: (object(), 'cpu', 'int8')
footage._speech = lambda *args: ([{'s': .25, 'e': .5, 'w': 'twenty'},
                                  {'s': .55, 'e': .8, 'w': 'bucks.'}], [], 'en')
print(json.dumps(footage.index(root)))
