import json, os, re, subprocess, time
from pathlib import Path
from reelengine import init, probe, project, render, tools
from reelengine.render_ctx import RenderCtx, Segment

base = Path('/tmp/rs-smooth-fps/bench')
base.mkdir(parents=True, exist_ok=True)
source = base / 'motion60.mp4'
def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, check=True, **kw)
if not source.exists():
    run([tools.ffmpeg(), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60:duration=8',
         '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264',
         '-preset', 'veryfast', '-crf', '10', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(source)])
audio = base / 'audio.wav'
run([tools.ffmpeg(), '-y', '-v', 'error', '-i', str(source), '-vn', '-ar', '48000', '-ac', '2', str(audio)])
info = probe.probe(source, quick=True)
results = []
for draft in [True, False]:
    for fps in [30, 60]:
        directory = base / f'{"draft" if draft else "final"}-{fps}'
        directory.mkdir(exist_ok=True)
        if not (directory / 'project.json').exists():
            init.run(directory, 'Motion fixture', [source], faster_exports=fps == 30)
        proj = project.load(directory)
        assert proj['format']['fps'] == fps
        segments = [Segment('s1', 0, 8, 0)]
        ctx = RenderCtx(proj, directory, base, segments, lambda _:0, 8, proj['format'], draft,
                        directory / 'work', tools.ffmpeg(), tools.ffprobe(), lambda *args:None)
        w, h = (540, 960) if draft else (1080, 1920)
        encoder = tools.draft_encoder() if draft else 'libx264'
        out = directory / 'render.mp4'
        graph = directory / 'graph.txt'
        cmd = render.build_video_cmd(ctx, segments, {'s1':proj['sources'][0]}, {'s1':directory / proj['sources'][0]['path']},
                                     {}, w, h, [], [], None, audio, 0, 8, 0, encoder, out, graph)
        start = time.perf_counter()
        run(cmd, cwd=directory)
        elapsed = time.perf_counter() - start
        output = probe.probe(out, quick=True)
        spatial = f'[0:v]fps={fps},scale={w}:{h}:flags={"fast_bilinear" if draft else "lanczos"},setsar=1,setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[enc];[ref][enc]ssim'
        score = run([tools.ffmpeg(), '-hide_banner', '-i', str(source), '-i', str(out), '-filter_complex', spatial,
                     '-an', '-t', '8', '-f', 'null', '-']).stderr
        match = re.search(r'All:([0-9.]+)', score)
        temporal = f'[0:v]scale={w}:{h}:flags={"fast_bilinear" if draft else "lanczos"},setsar=1[ref];[1:v]fps=60,setpts=PTS-STARTPTS[enc];[ref][enc]ssim'
        temporal_log = run([tools.ffmpeg(), '-hide_banner', '-i', str(source), '-i', str(out), '-filter_complex', temporal,
                           '-an', '-t', '8', '-f', 'null', '-']).stderr
        row = {'mode':'draft' if draft else 'final', 'target_fps':fps, 'output_fps':output['fps'], 'encoder':encoder,
               'seconds':round(elapsed,3), 'bytes':out.stat().st_size, 'mbps':round(out.stat().st_size*8/8/1e6,3),
               'ssim_same_rate':float(match.group(1)), 'ssim_against_60':float(re.search(r'All:([0-9.]+)', temporal_log).group(1))}
        results.append(row)
        print(json.dumps(row), flush=True)
        (base / 'results.json').write_text(json.dumps(results, indent=2))
print('completed', flush=True)
