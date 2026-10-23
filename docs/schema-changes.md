# project.json schema changes

All additive (optional fields only), per docs/architecture.md section 3. Schema: `engine/reelengine/schema/project.schema.json`.

## 2026-10-22 (render identity and edit receipts)

- `notes[].receipt` (object, optional): what the version this note ended on changed since the version
  before it, copied from the engine's render result. `jobId` is the app job (null when the engine ran
  without one), `renderId` the render that made the version, `facts` a list of `{kind, before, after}`
  where `kind` is the project.json path (`cut.keep`, `cut.gapCap`, `captions.enabled`, `music.level`,
  `zooms`, ...). `captions.style` facts name the style key in `field`; `broll` and `source` facts name the
  item in `id`, with `before: null` for an added item and `after: null` for a removed one. Facts compare
  the two versions, never the steps between them, so a change made and undone is not a fact.
- `notes[].version` may now be absent. Such a note changed the video and then took the change back, so it
  made no version; the app answered "That left your video the same as before, so I didn't make a new
  version." (or passed on the AI's question). The schema never listed `version` as required, so only the
  TypeScript types change.
- Outside project.json: `versions/vN/receipts.json` lists the receipts of every final render that wrote
  into `vN` and changed something. Versions made before this have none.

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

## 2026-10-21 (cover picker)

- `cover.manual` (bool): the person picked `cover.atSourceTime` from the cover suggestions in the app, so the
  engine renders that exact frame and does no search around it. The app clears it when the slider moves,
  and the AI's `set_cover` clears it. `cover.exact` (the AI looked at this frame; search 0.2 s around it)
  is unchanged.

## 2026-10-22 (note queue)

- `notes[].id` is the queued note's id (app.json `queue[].id`), not a job id. Every note that finishes is
  saved, including one that changed nothing (`applied: []`, `version` unchanged): the app's queue knows a
  note ran by its id here.

## 2026-10-21 (all-or-nothing notes)

- `notes[].id` (string): the app's job id for the note. `notes[].reply` (string): what the editor told the
  user. `notes[].styleRulesAdded`, `notes[].styleSuggestions` (string arrays, only when non-empty): My style
  rules the note asked to remember or the AI proposed. They are saved with the note so that, if the app
  closes right after a note is saved, the next start posts the reply and asks about the rules once
  (`app/src/main/store.ts` `recoverInterrupted`).
- `version` is also what makes a `versions/vN` folder count: a folder above it is a note that was never
  saved (docs/versions.md).

## 2026-10-20 (mirror)

- `sources[].mirror` (boolean, absent = false): the take is mirrored (a front-camera selfie: posters, shirts and
  signs read backwards), so the engine flips the picture left to right. The flip is the LAST step of the face
  picture's chain (after crop, scale and the upright turn) in both the software and the CUDA draft path, so the
  crop window is the same and the output is its mirror image. B-roll, zooms and captions are drawn on top and are
  never flipped; every reader of the face box in output pixels mirrors x (`x' = W - x - w`). Written by the AI's
  `set_mirror` tool and by the "Flip picture (it's mirrored)" toggle in "Edit it myself"; turning it off removes
  the field, so the project matches one that never had it.

## 2026-10-22 (caption presets)

- `captions.style.highlight` (`#RRGGBB`, no alpha, absent = none): the word being spoken is drawn in this colour, one
  word at a time. Each word is lit from its start until the next word starts. A line whose text lost a token
  (a word that was only punctuation) is drawn without the highlight.
- `captions.style.pop` (boolean, absent = false): each line grows from 80% to full size over its first 120 ms,
  carrying on across the word events of a highlighted line.
- `captions.style.preset` names the look the line started from in "Edit it myself" (`clean`, `bold-pop`,
  `karaoke`, `boxed`, `minimal`). The engine draws only the style fields; the name is for the picker. The AI's
  `set_caption_style` removes it when it changes the look itself (pop, the highlight on or off, case, words per
  line), so the picker then matches the look by its fields.
- `captions.style.sizePicked` (boolean, absent = false): the person picked `size` in the Size row of "Edit it
  myself". Picking a look then keeps that size; without it the look's own size applies. `set_caption_style` removes
  it when it changes the size. The engine ignores it.
