# project.json schema changes

All additive (optional fields only), per docs/architecture.md section 3. Schema: `engine/reelengine/schema/project.schema.json`.

## 2026-10-23 (beat accents)

- `beatAccents` (boolean, optional): `true` snaps SFX hits and b-roll starts to the nearest detected
  music beat within 0.12 s, including frame rounding. Missing or `false` preserves existing timing.
  `cutStyle.preset: "hyper"` also enables accents when present. Disabled music or a track with no
  detected beats leaves timing unchanged. Beat times follow the song's `startAt` in the mix.
  A b-roll start cannot precede its anchor word by more than its `leadIn`, or the default card lead.
  SFX tied to b-roll follow that start. Word-anchored speech cuts and word times never move.

## 2026-10-17 (engine-core, A1)

- `sources[].rotation`: defined as the CLOCKWISE degrees (0/90/180/270) the stored picture must be turned
  to display upright. An upright iPhone portrait MOV stored as 1920x1080 has `rotation: 90`.
- `sources[].originalName` (string), `sources[].hdr` (bool): optional, written by `init`.
- `transcript.model` (string): which speech model produced the transcript.
- `cut.source` (string): who wrote the cut (`autocut` | `ai` | `user`).
- `captions.style.outlineColor` (`#RRGGBB`), `captions.style.shadow` (number): optional style knobs.
- `captions.style.size` is in 1080-wide units (scaled for other widths).
- `captions.hidden`: optional list of word-id ranges whose captions are suppressed (e.g. under a
  full-frame card).
- `transcript.json` words may carry `ws`/`we` (whisper's raw times), `p` (probability) and `gaps`
  (silent runs inside the word). `s`/`e` are the MEASURED edges every module should use.
  It also has `segments[{source,s,e,text,from,to}]` and `nextId`.
- Unknown extra fields anywhere are allowed (the schema does not set `additionalProperties: false`).

## 2026-10-20 (0.1.2 F2, note attachments)

- `notes[].attachments` (array of project-relative paths, at most 4): the files the user attached to that
  note, each a `work/assets/attach-<8 hex>-<stem>.<ext>` written by engine `attach`, with a sidecar
  `<asset>.attach.json` next to it (`asset`, `name`, `kind` image|video, `bytes`, `width`, `height`,
  `duration`, `hasAudio`, `fromGif`, `thumb`, `createdAt`). The sidecar is not part of project.json. A note
  may have empty `text` when it has attachments.

## 2026-10-20 (mirror)

- `sources[].mirror` (boolean, absent = false): the take is mirrored (a front-camera selfie: posters, shirts and
  signs read backwards), so the engine flips the picture left to right. The flip is the LAST step of the face
  picture's chain (after crop, scale and the upright turn) in both the software and the CUDA draft path, so the
  crop window is the same and the output is its mirror image. B-roll, zooms and captions are drawn on top and are
  never flipped; every reader of the face box in output pixels mirrors x (`x' = W - x - w`). Written by the AI's
  `set_mirror` tool and by the "Flip picture (it's mirrored)" toggle in "Edit it myself"; turning it off removes
  the field, so the project matches one that never had it.

## 2026-10-23 (cut vocabulary)

- `cutStyle` (optional): `{preset, seed}` selects the reel's fixed cut vocabulary. Presets are `clean`, `standard`, `hyper`, and `punchline`; the seed is an integer used for repeatable within-style choices. The preset values are defined in `engine/reelengine/cut_style.py` and mirrored in the AI package.
## 2026-10-22 (snap zooms)

- `zooms[].style` (`"snap"`, absent = the hard punch-in as before): the zoom eases in over about 0.22 s
  (ease-out) and back over about 0.3 s (a critically damped spring), with motion blur only while the scale
  moves. Motion never runs across a jump cut. Either end falls back to the hard cut of a default zoom where
  easing would look wrong: the punch-in when the zoom directly follows another zoom or a cut falls inside
  it; the release when the zoom runs into the next one, ends under face-hiding b-roll, is too short to
  hold (under about 0.8 s) or has a cut inside its release. A cut right after the last word takes the
  release itself. A snap whose fixed point (the point the picture grows out of) is far enough from the
  face to carry the eyes more than 9% of the frame's width punches in and releases hard, like a default
  zoom. A face-centred zoom gets there when the face sits high and off centre.
  Written by the AI's `set_zoom` tool.
## 2026-10-22 (sound effects)

- `sfx` (array, absent = none): built-in sound effects, `{at, sound, gainDb?}`. `sound` is an id from
  `engine/reelengine/sfx/pack.json`. `at` names one moment: `{word}` (that word starts, if the cut keeps it),
  `{broll}` (that b-roll appears, its lead-in included) or `{cut}` (the cut into a kept range after the first whose
  `from` is that word). The engine lines the sound's measured hit (`onsetMs`) up with that moment on the frame grid
  and plays one at a time, at most one every 2 seconds; an effect that breaks that, or whose build-up would start
  before the video, is left out with a render warning. Its level comes from the measured voice: 10 dB under the
  voice's speech loudness, 6 dB more while the voice is talking, `gainDb` (-24 to +12) on top but never above 4 dB
  under the voice, and its sample peak stays 3 dB under the voice's loudest peak. Word and cut anchors are
  remapped after a re-transcription like the others. Written by the AI's `set_sfx`; an empty list removes the field.

## 2026-10-23 (per-join transitions)

- Each `cut.keep[]` range after the first may carry `join: {transition, frames}`.
  `transition` is `hard`, `j`, `l` or `smash`; `frames` is a non-negative integer in
  output-frame units. Missing joins and explicit `hard` retain hard-cut timing.
  Request 6-12 frames as a starting range, not a measured optimum.
- J adds source audio before the incoming picture starts. L keeps the outgoing
  source audio after its picture ends. The engine clamps these handles at adjacent
  transcript words, source bounds and the neighboring output segment, then rounds
  down to whole output frames. A continuous source span or no room means no bridge.
- Picture timing, kept-word audio timing and total duration do not move. The voice
  renderer overlaps the handles with the existing 6 ms edge fades instead of
  concatenating extra time. Word-anchored captions therefore keep their timestamps.
- `smash` keeps a hard picture cut, derives an `impact-hit` at `at.cut`, and adds a
  200 ms, -6 dB dip through the music automation curve. These sound choices are
  starting values without listening-test evidence. The existing SFX spacing and
  loudness limits still apply; skipped hits produce the existing render warnings.
  An explicit SFX at that cut replaces the automatic hit. The dip uses the existing
  gain smoothing and only applies when a music track plays.
- `frames` has no effect for hard or smash. Derived effects do not modify the saved
  project. Removing a join removes its automatic effects on the next render.
  The AI's `set_cut` accepts joins and forbids J/L with beat accents on the same join
  in its editing guidance; beat-accent scheduling is not part of this schema.
