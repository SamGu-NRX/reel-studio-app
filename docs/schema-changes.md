# project.json schema changes

Existing project shapes remain valid. New shapes can require a newer engine, as noted below. Schema: `engine/reelengine/schema/project.schema.json`.

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

## 2026-10-23 (multi-source engine)

- `cut.keep[]` accepts a word range `{from, to}` or a clip
  `{clip: "c1", source: "s2", in: 12.4, out: 16.8}` in output order. Clip ids are unique
  within the cut and match `^c[0-9]+$`. Bounds are source seconds, start included and end excluded,
  inside the named source. The engine snaps them to the source frame grid and rejects clips
  shorter than one frame. Clips retain silence and never merge with adjacent word ranges.
- `broll[].anchor` also accepts `{source: "s2", s: 13.0, e: 14.5}` in source seconds.
  Both endpoints map through the cut, so a recut moves the overlay with the footage. An endpoint
  removed by trimming leaves no overlay. Repeated source moments use their first output occurrence.
  Existing lead-in and hold rules still apply. Zooms, captions and music keep their word anchors.
- All-clip cuts render without `work/transcript.json`. When a transcript exists, words intersecting
  clips are captioned on the clip's output clock. Mixed cuts still require a transcript for their
  word ranges. Sources with no audio stream contribute silence, including during `init`.
- Source paths may use the existing `Library/...` form. Indexed footage references, per-clip audio
  controls and framing overrides are outside this slice.
- `schemaVersion` remains 1 and existing projects are not rewritten. Older builds, including main
  at `31382f9`, reject clip items and source-time b-roll anchors with `BAD_PROJECT` because they
  require word-range fields. They must refuse rather than ignore the clips and render a different
  video. Open these projects in a build that supports multi-source cuts.
