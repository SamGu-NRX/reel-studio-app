# project.json schema changes

All additive (optional fields only), per docs/architecture.md section 3. Schema: `engine/reelengine/schema/project.schema.json`.

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

## 2026-10-22 (subtitle editing)

- `captions.corrections[].at` (word id, optional): the fix applies to that one word only, before any other
  correction, and only while the transcript still hears it as `from` (after a re-transcription the same id can
  be another word, and the fix then does nothing). With `through` (word id), the words from `at` through
  `through` become one word, as when the subtitle editor fixes a word a phrase correction made of several. An
  empty `to` takes the word off the captions; it is still heard, and it keeps its place, so the lines around it
  are grouped as before. Written when a word is fixed in the Subtitles list of "Edit it myself".
- `captions.split` (word ids): each starts a new caption line. `captions.join` (`{from, to}` word ranges): the
  line that starts at `to` goes onto the line before while that line still ends at `from`. Lines with a long
  silence or a hidden line between them never join. Both change only the lines they touch; every other line is
  grouped as before. Anchored on word ids, so a recut keeps them.
- `work/captions.json` cues gain `tokens` (each word as drawn, before upper-casing, with the transcript word ids
  it came from; a word taken off the captions is `""`) and `run` (lines with different runs can't be joined).

## 2026-10-22 (caption presets)

- `captions.style.highlight` (`#RRGGBB`, no alpha, absent = none): the word being spoken is drawn in this colour, one
  word at a time. Each word is lit from its start until the next word starts. A line whose text lost a token
  (a word that was only punctuation) is drawn without the highlight.
- `captions.style.pop` (boolean, absent = false): each line grows from 80% to full size over its first 120 ms,
  carrying on across the word events of a highlighted line.
- `captions.style.preset` names the look the line started from in "Edit it myself" (`clean`, `bold-pop`,
  `karaoke`, `boxed`, `minimal`). The engine draws only the style fields; the name is for the picker.

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

## 2026-10-22 (Edit it myself in the note queue)

- `handEdits` (string array, absent = none): ids of the "Edit it myself" changes saved in this project, newest last, at
  most 20. A change made while the editor is busy waits in the reel's note queue; the app writes its id here in the
  same project.json write that saves it, after its final render, and that id is the queue's proof it ran (as a note's
  id in `notes` is). Written only by the app (app/src/main/hand-edit.ts); the engine ignores it.

## 2026-10-23 (match clips)

- `cut.keep[]` may also be a seconds range `{source, start, end}`: seconds of one source, played exactly as
  given, with no pause capping and no lead or tail trimming. It keeps the words of that source whose midpoint
  lies inside it, and it needs no words at all, so a cut made only of seconds ranges renders a clip with no
  speech instead of failing with NO_SPEECH. It is for footage whose edit was chosen elsewhere, such as a
  match clip, where capping the pauses between commentary lines would cut out the action. The app's own
  cut tools still write word ranges only.
- `brief` (object, optional): what the video shows when it is not a talking head. The AI editor reads it
  (`ai/src/project.ts` MatchBrief: the match, the team, the moment, minute, score, players with their
  Library photo, a footage description, a planned title, caption and hashtags). With a brief, the first
  edit uses `ai/prompts/systemMatch.md` and `firstEditMatch.md`, keeps the cut, and fetches nothing from
  the web; the only pictures are the brief's own images.
- `zooms[].focus` (`[x, y]`, fractions of the frame), which the engine already read, is now written by
  `set_zoom` in a match edit: `[0.5, 0.5]`, because the match footage is already framed on the play.
