# Engine evaluation

The runner compiles the selected AI source into owned scratch and records Git SHA and dirty
state. It does not edit the selected build. Use `--build /absolute/checkout` or `--branch ref`
(resolved in `--build`, or the harness checkout by default).

```sh
node scripts/eval/run.mjs --build /absolute/checkout \
  --manifest scripts/eval/manifest.example.json \
  --python /absolute/python3 --ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe
```

The example creates a test pattern with each word synthesized in a measured time slot.
Its exact transcript belongs to that generated clip. Local entries use a media path and may
supply an explicit `transcript` JSON path. Without that field the engine transcribes the
media. `--models /absolute/model-directory` selects speech models; otherwise models are
isolated in empty scratch and a missing model fails explicitly. Paths in the manifest are
relative to that file. The runner never discovers old ASR fixtures or invents spoken words.

Each speech clip runs real init, analyze and autocut, then firstEdit and three sequential
notes. Notes declare allowed project JSON pointers in `allowPaths`. A note with quoted
words, `targetPhrase`, or `targetWords` must target words still kept by the baseline edit.
Otherwise the runner records `INVALID-TASK` and does not score the model. Every changed leaf
outside those paths fails scope; only notes, version and updatedAt are ignored. Arrays whose
items all carry an `id` are compared by id, so removing one b-roll does not report the
items after it as changed. One exception is recorded under `scope.consequences`: when the
note's cut removes a word that a b-roll, zoom, music automation or hidden-caption range is
anchored on, that item may be removed or re-anchored onto words still kept. The mock
executes only exact `mockTools` supplied by the manifest and first-edit calls supplied by
the harness. It does not infer requests from prompts. This checks integration and
bookkeeping; a scripted edit is not evidence of model judgment. The mock disables firstLook
and fastNotes to exercise scripts. Live lanes retain both selected-app defaults; reports
record these runtime settings and accept valid no-model fast notes.

Reliability and quality have separate statuses. A completed first edit with a usable saved project is copied
once, and the exact first note is repeated from that baseline three times. Determinism passes
only when all three repeats reliably complete with a substantive edit and identical diffs.
A quality failure remains visible and does not prevent measuring deterministic edits.
Referenced assets survive task cleanup and are hard-linked into each baseline copy.

A clip with a probed missing audio stream may declare `expectedOutcome: "no_audio"` and
an empty notes array. Engine init must reject it with NO_AUDIO and the saved independent
probe must confirm there is no audio stream. This records EXPECTED_REJECTION, with no model
or quality score. It never creates a substitute silent transcript.

For the built-in Claude CLI lane use `--provider claude-cli --model opus`. The runner writes
that selection through the selected build's app settings API, checks the real Claude CLI
availability, and instantiates its actual ClaudeCliProvider. A quota error stops the lane.
Other live providers use `--provider <id> --model <id> --provider-adapter /absolute/module.cjs`.
The module exports an async function receiving
`{AI,host,profileDir,provider,model,build,signal}` and returning a ModelProvider with
`id`, `model`, `supportsImages`, `complete(request)`, optional `dispose()`, optional
`close()` and optional `renderAnimation(template, params, outPath, fps)`. Without the last,
animation tools fail as they would outside the app; those calls are counted as
`environmentErrors`, not as model errors, and the report states how many. `AI` is the compiled selected build; `profileDir` is empty owned scratch. The
adapter owns credential integration; the runner never reads keys, copies a real profile or
implements substitute encryption. `dispose()` follows the actual agent lifecycle and
`close()` is awaited at whole-run end. Temporary provider retries retain actual agent
behavior; quota errors do not retry. Secret-bearing environment names are removed from
Python children. Engine cache and asset cache both point inside scratch.

JSON and Markdown reports go under `/tmp/rs-eval/runs/<timestamp>` (or `--out`). They
aggregate reliability, quality, determinism, model turns, parse failures, retries, validation
and execution errors, caps, wall time and reported token counts. Unreported usage is null.
Per-task evidence retains exact project diffs, saved caption/render/verification reports and
the engine's timeline. Quality metrics report counts and reasons for source-word boundary
interruptions, retained dead-air gaps, caption coverage and word timing, frame bounds,
Instagram's safe band, loudness, duration and verification. Thresholds come from the selected
engine, including frame rounding and caption holds. Missing evidence is UNAVAILABLE.

Before heavy actions the runner requires 3 GiB available disk and less than 2 GiB of owned
scratch. macOS memory pressure must be below 4; other platforms require 3 GiB free memory.
Engine init uses its normal hard-link import; `mediaHardlinked` records whether it did so.
Only regenerable render output and engine audio scratch are removed after each task. Small
JSON evidence remains, and owned scratch is removed after reporting. Real media is read or
linked. No installed app path is selected implicitly.

Optional judging evidence belongs in `judge.json` beside a run report. Nothing invokes a
judge automatically. Use this shape:

```json
{
  "schemaVersion": 1,
  "judge": {"kind": "human", "id": "reviewer"},
  "candidates": [{"id": "left", "run": "run-id", "clip": "clip-id", "video": "review-copy.mp4"}],
  "pairwise": [{"left": "left", "right": "right", "winner": "left", "reason": "Observed difference"}],
  "ratings": [{"candidate": "left", "hook": 3, "pacing": 3, "captions": 3, "visuals": 3, "sound": 3, "instructionFollowing": 3, "reason": "Observed evidence"}]
}
```

Each human 1-5 rating means 1 unusable, 2 major repair, 3 usable with fixes, 4 minor fixes,
5 ready to share. Hook measures opening clarity; pacing measures gaps and repetition;
captions measures speech accuracy and legibility; visuals measures framing and visual
choices; sound measures speech clarity, music balance and audible cuts; instructionFollowing
measures the exact note without unrelated edits. Pairwise winners are `left`, `right` or `tie`.
Judges must inspect actual review copies. Mechanical PASS supplies no taste ratings.
