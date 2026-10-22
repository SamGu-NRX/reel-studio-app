#!/usr/bin/env python3
"""Mechanical measurements from saved reports and the selected engine's actual timeline."""
import argparse
import json
from pathlib import Path
from dataclasses import asdict

METRICS = ('duration', 'segments', 'wordBoundaries', 'deadAir', 'captionTiming',
           'captionCoverage', 'captionBounds', 'instagramSafeBand', 'loudness', 'verification')


def metric(items, **details):
    return {'status': 'PASS' if not items else 'FAIL', 'count': len(items), 'reasons': items[:30], **details}


def check(root):
    from reelengine import project, verify, captions
    p = project.load(root)
    version = root / 'versions' / f"v{p.get('version', 0)}"
    out = {'status': 'UNAVAILABLE', 'metrics': {n: {'status': 'UNAVAILABLE', 'reasons': ['required evidence missing']} for n in METRICS}, 'reasons': []}
    evidence = {}
    for name in ('captions.json', 'verify.json', 'render.json'):
        try:
            evidence[name] = json.loads((version / name).read_text())
        except (OSError, ValueError) as e:
            out['reasons'].append(f'{name}: {e}')
    try:
        transcript = project.load_transcript(root, p)
        tl = project.timeline(root, p, transcript['words'])
        out['timeline'] = {'duration': tl.duration, 'segments': [asdict(s) for s in tl.segments], 'words': tl.words_out}
    except Exception as e:
        out['reasons'].append(f'timeline: {e}')
        return out
    out['evidence'] = evidence
    m = out['metrics']
    fps = float(p['format']['fps'])
    source_fps = {s['id']: float(s.get('fps') or fps) for s in p['sources']}
    tolerance = 2 / fps + 0.002
    boundary, raw_boundaries, gap_exemptions = [], [], []
    kept = {w['id'] for w in tl.words_out}
    for i, seg in enumerate(tl.segments):
        tol = 1 / source_fps[seg.source] + 0.002
        for w in transcript['words']:
            if w['source'] != seg.source or w['id'] not in kept:
                continue
            for edge, time in (('start', seg.src_start), ('end', seg.src_end)):
                if w['s'] + tol < time < w['e'] - tol:
                    item = {'segment': i, 'edge': edge, 'word': w['id'], 'sourceTime': time, 'wordRange': [w['s'], w['e']]}
                    raw_boundaries.append(item)
                    measured = next((gap for gap in w.get('gaps', []) if gap[0]-tol <= time <= gap[1]+tol), None)
                    if measured is not None:
                        gap_exemptions.append({**item, 'measuredGap': measured, 'frameToleranceSeconds': tol})
                    else:
                        boundary.append(item)
    m['wordBoundaries'] = metric(boundary, segments=len(tl.segments), rawEndpointInterruptions=len(raw_boundaries), measuredGapExemptions=gap_exemptions, policy='No segment edge inside retained speech beyond one source frame plus 2 ms. Explicit measured within-word silence gaps are exempt.')
    cap = float(p['cut']['gapCap'])
    min_saving = float(p['cut'].get('minSaving', 0.08))
    frame_slack = 2 / min(source_fps.values()) + 0.002
    gaps = [{'after': a['id'], 'before': b['id'], 'seconds': round(max(0, b['s'] - a['e']), 4)} for a, b in zip(tl.words_out, tl.words_out[1:])]
    limit = cap + min_saving + frame_slack
    m['deadAir'] = metric([g for g in gaps if g['seconds'] > limit], maxGapSeconds=max((g['seconds'] for g in gaps), default=0), gapCapSeconds=cap, minSavingSeconds=min_saving, frameSlackSeconds=frame_slack, allowedSeconds=limit, pairs=len(gaps))
    render = evidence.get('render.json')
    if isinstance(render, dict):
        actual = render.get('duration')
        if isinstance(actual, (float, int)):
            m['duration'] = metric([] if abs(actual-tl.duration) <= tolerance else [{'actual': actual, 'timeline': tl.duration}], errorSeconds=abs(actual-tl.duration), toleranceSeconds=tolerance)
        detail = render.get('segmentsDetail')
        if isinstance(detail, list):
            m['segments'] = metric([] if detail == [asdict(s) for s in tl.segments][:2000] else ['saved render segments differ from engine timeline'], segments=len(detail), timelineSegments=len(tl.segments))
    verification = evidence.get('verify.json')
    if isinstance(verification, dict) and isinstance(verification.get('checks'), list):
        failed = [c for c in verification['checks'] if c.get('status') == 'FAIL']
        m['verification'] = metric(failed, checks=len(verification['checks']))
        loud = next((c for c in verification['checks'] if c.get('name') == 'loudness'), None)
        if loud:
            value = verification.get('lufs')
            m['loudness'] = metric([] if loud.get('status') == 'PASS' else [loud.get('detail', 'loudness failed')], integratedLUFS=value, targetLUFS=verify.TARGET_LUFS, toleranceLUFS=verify.TOLERANCE, engineStatus=loud.get('status'))
    cues = evidence.get('captions.json', {}).get('cues')
    if isinstance(cues, list):
        missing, timing, off, unsafe = [], [], [], []
        expected_cues = captions.build_cues(tl.words_out, p['captions'], captions.hidden_set(tl, p['captions'])) if p['captions']['enabled'] else []
        W, H = p['format']['width'], p['format']['height']
        if len(cues) != len(expected_cues):
            timing.append({'reason': 'saved cue count differs from engine cue count', 'saved': len(cues), 'expected': len(expected_cues)})
        for i, (cue, expected) in enumerate(zip(cues, expected_cues)):
            if abs(cue.get('s', 0)-expected['s']) > 0.002 or abs(cue.get('e', 0)-expected['e']) > 0.002 or cue.get('ids', []) != expected.get('ids', []):
                timing.append({'cue': i, 'saved': {'s': cue.get('s'), 'e': cue.get('e'), 'ids': cue.get('ids', [])}, 'expected': {'s': expected['s'], 'e': expected['e'], 'ids': expected.get('ids', [])}})
            if not (0 <= cue.get('s', -1) < cue.get('e', -1) <= tl.duration+tolerance): timing.append({'cue': i, 'reason': 'outside timeline'})
            box = cue.get('box', [])
            if len(box) != 4:
                off.append({'cue': i, 'reason': 'box missing'}); unsafe.append({'cue': i, 'reason': 'box missing'}); continue
            x, y, w, h = box
            if x < 0 or y < 0 or x+w > W or y+h > H: off.append({'cue': i, 'box': box})
            if y < H*verify.IG_TOP_FRAC or y+h > H*(1-verify.IG_BOTTOM_FRAC) or x+w > W*(1-verify.IG_RIGHT_FRAC)+40: unsafe.append({'cue': i, 'box': box})
        expected_ids = {wid for cue in expected_cues for wid in cue.get('ids', [])}
        covered = {wid for cue in cues for wid in cue.get('ids', [])}
        missing = [{'word': wid, 'reason': 'no saved caption'} for wid in sorted(expected_ids-covered)]
        m['captionCoverage'] = metric(missing, cues=len(cues), expectedWords=len(expected_ids), coveredWords=len(covered), hiddenWords=len(captions.hidden_set(tl, p['captions'])))
        m['captionTiming'] = metric(timing, cues=len(cues), wordEvidenceMissing=len(missing), startToleranceSeconds=0.002, holdPolicy={'maxHold': captions.MAX_HOLD, 'tail': captions.HOLD_TAIL, 'minCue': captions.MIN_CUE}) if not missing else {'status': 'UNAVAILABLE', 'reasons': missing[:30]}
        m['captionBounds'] = metric(off, cues=len(cues), size=[W, H])
        m['instagramSafeBand'] = metric(unsafe, cues=len(cues), topFraction=verify.IG_TOP_FRAC, bottomFraction=verify.IG_BOTTOM_FRAC, rightFraction=verify.IG_RIGHT_FRAC, engineRightAllowancePixels=40)
    statuses = [x['status'] for x in m.values()]
    out['status'] = 'FAIL' if 'FAIL' in statuses else 'UNAVAILABLE' if 'UNAVAILABLE' in statuses else 'PASS'
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('project', type=Path)
    args = parser.parse_args()
    try:
        result = check(args.project)
    except Exception as e:
        result = {'status': 'UNAVAILABLE', 'reasons': [str(e)], 'metrics': {n: {'status': 'UNAVAILABLE', 'reasons': [str(e)]} for n in METRICS}}
    print(json.dumps(result, indent=2))
