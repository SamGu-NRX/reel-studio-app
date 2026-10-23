"""All cut-vocabulary features share one source/output mapping."""
import json
import subprocess

import numpy as np
import pytest

from conftest import mkwords
from reelengine import captions, music, project, render, sfx, tools, zoom
from reelengine.lint_edit import prepare


def test_seeded_vocabulary_renders_in_sync_with_expected_duration(tmp_path, monkeypatch):
    monkeypatch.setenv('REELENGINE_RENDER_ENCODER', 'libx264')
    p = project.new_project('Cut vocabulary')
    p['format'] = {'width': 160, 'height': 284, 'fps': 30}
    p['cutStyle'] = {'preset': 'hyper', 'seed': 42}
    words = []
    p['sources'] = []
    p['cut']['keep'] = []
    for i in range(3):
        sid = f's{i+1}'
        file = tmp_path / 'media' / f'{sid}.mp4'
        file.parent.mkdir(exist_ok=True)
        # The flash and the tone start at the same source instant. They expose
        # clock drift even after the J-cut's quiet pre-roll and the smash mix.
        subprocess.run([tools.ffmpeg(), '-v', 'error', '-f', 'lavfi', '-i',
                        "color=c=black:s=160x284:r=30:d=4,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1,1.4)'",
                        '-f', 'lavfi', '-i', "aevalsrc=if(between(t\\,1\\,1.4)\\,0.3*sin(2*PI*440*t)\\,0):s=48000:d=4",
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', str(file)], check=True)
        p['sources'].append({'id': sid, 'path': f'media/{sid}.mp4', 'duration': 4, 'fps': 30})
        words.extend(mkwords([(.1, .3, 'Removed.'), (1, 3.4, 'Kept.'), (3.8, 3.9, 'Removed.')], source=sid, start_id=i*3))
        keep = {'from': f'w{i*3+1}', 'to': f'w{i*3+1}'}
        if i:
            keep['join'] = {'transition': 'j' if i == 1 else 'smash', 'frames': 999}
        p['cut']['keep'].append(keep)
    p['zooms'] = [{'kind': kind, 'anchor': {'from': f'w{i*3+1}', 'to': f'w{i*3+1}'}, 'focus': [.5, .5]}
                  for i, kind in enumerate(('snap', 'drift', 'punch'))]
    p['captions']['enabled'] = False
    song = tmp_path / 'media' / 'click.flac'
    subprocess.run([tools.ffmpeg(), '-v', 'error', '-f', 'lavfi', '-i',
                    'aevalsrc=if(lt(mod(t\\,0.5108556833)\\,0.015)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000:d=12',
                    '-ac', '2', str(song)], check=True)
    p['music'].update({'track': 'media/click.flac', 'enabled': True, 'level': 'quiet'})
    p['sfx'] = [{'at': {'word': 'w4'}, 'sound': 'pop-soft'}]
    project.save(tmp_path, p)
    project.write_json(tmp_path / 'work' / 'transcript.json', {'words': words})
    before = project.timeline(tmp_path, p, words)
    expected_duration = before.duration
    ctx = render.make_ctx(tmp_path, p, before, True, tmp_path, tmp_path / 'work')
    result = prepare(ctx, before)
    assert 'jl-budget' in {x['rule'] for x in result['issues']}
    assert 6 <= ctx.variation['jlOffsets'][0]['frames'] <= 12
    assert before.segments[1].audio_lead == pytest.approx(ctx.variation['jlOffsets'][0]['frames'] / 30)
    assert {z.kind for z in ctx.lint_zooms} >= {'snap', 'drift', 'punch'}
    assert any(z.kind == 'drift' and z.ramp_in > 0 for z in ctx.lint_zooms)
    assert any(z.kind == 'snap' and z.ramp_in > 0 for z in ctx.lint_zooms)
    assert music.accent_beats(ctx)
    placed, _ = sfx.plan(ctx)
    assert any(x['at'].get('cut') == 'w7' for x in placed)
    rendered = render.run(tmp_path, draft=True, root=tmp_path, cover=False)
    assert rendered['duration'] == pytest.approx(expected_duration, abs=1/30)
    assert 'issues' in rendered and 'fixed' in rendered
    assert rendered['visualChanges']['overall']['total'] > 0
    data = json.loads(subprocess.run([tools.ffprobe(), '-v', 'error', '-show_streams', '-of', 'json', rendered['file']],
                                    capture_output=True, text=True, check=True).stdout)
    streams = {s['codec_type']: s for s in data['streams']}
    for kind in ('audio', 'video'):
        assert float(streams[kind]['duration']) == pytest.approx(expected_duration, abs=1/30)
    raw_video = subprocess.run([tools.ffmpeg(), '-v', 'error', '-i', rendered['file'], '-vf', 'scale=1:1',
                                '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    brightness = np.frombuffer(raw_video, np.uint8)
    raw_audio = subprocess.run([tools.ffmpeg(), '-v', 'error', '-i', rendered['file'], '-ac', '1', '-ar', '48000',
                                '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    audio = np.frombuffer(raw_audio, '<f4')
    # Detect the 440 Hz speech onset near each expected word, away from SFX.
    for wid in ('w1', 'w4', 'w7'):
        t = before.word_out_time(wid)
        start, end = max(0, round((t - .08) * 30)), round((t + .15) * 30)
        light = next(i / 30 for i in range(start, end) if brightness[i] > 180)
        powers = []
        for frame in range(start, end):
            chunk = audio[frame*1600:(frame+1)*1600]
            powers.append(abs(np.sum(chunk * np.exp(-2j*np.pi*440*np.arange(len(chunk))/48000))))
        sound = (start + next(i for i, value in enumerate(powers) if value > max(powers)*.6)) / 30
        assert abs(light - sound) <= 1/30 + 1e-6
